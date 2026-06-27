# fullId Cache Dedup — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Bug:** `docs/FEATURE-GAPS.md` "Stale-scene" (#412, re-diagnosed 2026-06-27)
**Supersedes:** `2026-06-27-stale-scene-ghost-reconciliation-design.md` (localId-based reconcile — reverted; wrong identity)

## Problem (root cause, evidence-backed)

The persistent object cache (`qs-objects`, `src/lib/objectCache.js`) keys records by `[regionKey, localId]`.
But **localId is not a stable object identity** — OpenSim reassigns it on sim restart / object re-rez,
while the object's `fullId` (UUID) is stable. `regionKey` is grid coords (stable), and the CacheID purge
gate only fires when the RegionHandshake CacheID changes — which it does *not* on object-localId churn.

So a region revisited across churn re-caches the same physical objects under new localIds without replacing
the old records. Measured live on osgrid "Lazarus Taxon 6" (Gene's Island): **9300 cached records for only
5332 distinct fullIds** (2497 objects under 2–3 localIds each), accumulated over 71.9h. Every non-churning
region in the cache is 1:1.

Two user-visible harms:
1. **Cache bloat + double memory** — 9300 records / meshes for 5332 objects.
2. **Un-killable ghost copies** — on warm preseed the old-localId record paints; the sim updates only the
   *new* localId (it doesn't know the old one), so the stale copy lingers forever (the "deleted objects
   persisting" report — actually stale duplicates of still-existing objects, visible when the object moved).

(A localId-based "reconcile cache vs sim's current localIds" was built and live-tested 2026-06-27; localId
churn made 81% of the cache look deleted when 0 were → it gutted the scene. Reverted. The fix must key on
`fullId`.)

## Principle

**`fullId` is the object identity; dedup by it.** Two touch points, one principle. Entirely client-side
(no server/protocol change). **No IndexedDB schema bump** — the index is in-memory; cache cleanup deletes
stale records by existing primary key.

## Component 1 — `worldStore`: in-memory `fullId → localId` index

Add a non-reactive `_byFullId = new Map()`.
- `_index(localId, rec)`: when `rec.pcode === PCODE_PRIM` and `rec.fullId`, `_byFullId.set(rec.fullId, localId)`.
  (Avatars excluded — their localId is session-stable and they have a delicate own-avatar lifecycle.)
- `removeObject(localId)`: look up the record first; if `_byFullId.get(rec.fullId) === localId`, delete the
  entry (guard so a newer localId that already claimed the fullId isn't clobbered). Then delete + `_unindex`.
- `clearAll()`: `_byFullId.clear()`.
- Expose `localIdForFullId(fullId) → number | undefined`.

This also lets `applyObjectProperties` (currently an O(n) walk by fullId) use the index — a small free win.

## Component 2 — Engine ingest: live fullId reconciliation

In `pumpIngest`'s `processOne` (`useWorldEngine.js:4006`), **before** `worldStore.upsertObject(o)`:

```
if o.fullId and o.pcode !== PCODE_AVATAR:
    prev = worldStore.localIdForFullId(o.fullId)
    if prev != null and prev !== o.localId:        # localId churned → evict the stale twin
        pendingMeshIds.delete(prev); evicted.delete(prev)
        removeMesh(prev)
        worldStore.removeObject(prev)
        key = regionCacheKey(); if key: objCacheEvict(key, prev)
        (sampled log: "[3D] fullId-dedup: evicted stale localId <prev> for <fullId> (now <localId>)")
```

So the instant the live copy of a churned object arrives, its stale duplicate is removed from scene, mesh,
and cache — including moved objects. Module counter `_fullIdDedupN` for sampled logging. Covers the
live / in-interest path.

## Component 3 — `objectCache`: preseed dedup + one-time bloat cleanup

New `objCacheDedupRegion(regionKey) → data[]`:
- Await any in-flight flush (so pending writes land), then read all region records (existing `regionKey` index).
- Group by `fullId`, keep the record with the newest `savedAt`; collect the older same-fullId localIds as
  *stale*. Records with **null fullId are kept as-is** (legacy; can't dedup).
- Delete the stale records by primary key `[regionKey, localId]` in one readwrite txn (mirrors
  `objCacheClearRegion`'s bounded range-delete pattern; mark `_metaDirty`).
- Return the survivors' `data` (same shape `objCacheGetAll` returns).
- On any error, fall back to `objCacheGetAll` (paint without dedup — never block preseed).

`preseedRegionCache` calls `objCacheDedupRegion(key)` instead of `objCacheGetAll(key)`. On next load of a
bloated region this collapses 9300→5332 permanently and paints each object once; the crcMap seed (built from
`cached`) naturally carries the newest localId per fullId. Covers the accumulated + out-of-interest bloat.

## Why this is complete + coherent

- CacheID gate unchanged → handles region-identity changes.
- Component 2 → live/in-interest object-identity churn (real-time ghost removal).
- Component 3 → accumulated bloat + out-of-interest stale records (cleaned at load).
- One principle (fullId = identity); the two components cover the two paths an object reaches the client
  (live update vs warm preseed).

## Error handling

- `objCacheDedupRegion` swallows IDB errors → falls back to `objCacheGetAll` (degrade to no-dedup paint).
- Ingest reconciliation is guarded by `o.fullId` presence + `pcode !== avatar`; a null/absent prev is a no-op.
- `removeObject` index-delete is guarded against clobbering a fullId already reclaimed by a newer localId.

## Files & tests (all client-side)

| File | Change |
|------|--------|
| `src/stores/worldStore.js` | `_byFullId` index + `localIdForFullId`; maintain in `_index`/`removeObject`/`clearAll`. |
| `src/__tests__/stores/worldStore.test.js` *(new or existing)* | index maintained on upsert/remove; avatars excluded; latest-localId wins. |
| `src/lib/objectCache.js` | `objCacheDedupRegion(regionKey)`. |
| `src/__tests__/lib/objectCache.test.js` | dedup keeps newest per fullId, deletes stale, keeps null-fullId, returns survivors. |
| `src/composables/useWorldEngine.js` | preseed: `objCacheGetAll`→`objCacheDedupRegion`; `pumpIngest` ingest reconciliation + `_fullIdDedupN`. |

Gates: Vitest for the two pure-ish units (ESLint broken repo-wide — see `[[eslint-broken-flat-config]]`),
`npm run build:prod` green, then live-verify. No server changes → no Bun restart, Vite HMR throughout.

## Live verification

Reload into Gene's Island (Lazarus Taxon 6): `[ObjCache] fullId-dedup … 9300→5332 (deleted 3968 …)` on
first load; cache stays ~5332 on subsequent loads; memory roughly halved for the region; no duplicate/ghost
copies of moved objects. Move/re-rez an object while logged in elsewhere, return → the stale copy is gone
(Component 2). Confirm non-churning regions are unaffected (dedup deletes 0).
