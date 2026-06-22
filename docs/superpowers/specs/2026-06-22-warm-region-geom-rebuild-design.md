# Warm-Region Geometry Rebuild — Bulk Warm-Load (Approach A)

**Date:** 2026-06-22
**Branch context:** `ai/mesh-lod`
**Status:** Design approved (Gene, 2026-06-22). Awaiting spec review → implementation plan.
**Scope:** Approach **A** (bulk region warm-load). Approach **C** (packed rebuild-ready buffers) is
sketched as the planned follow-on, not specified here.

---

## 1. Problem

Re-entering a region we have cached "many times" (e.g. *Aspen Homesites*, a 512 m var-region,
`patches=1024`, ~24,356 prims) does **not** rebuild quickly from disk. Symptoms Gene reports:

- ~3–4 min before the immediate bubble looks meshed; ~15 min for "a good amount" of scenery.
- Badge says "thousands of objects still to download (and increasing)."
- Draw-distance bubble feels too small to be natural.
- "Why download again once cached?"

### Evidence (live `server-watch.log`, two Aspen loads, 2026-06-22)

The disk geometry cache **holds the data and serves it fast — then is intermittently starved**:

```
hit=359 (mem=73 idb=286) miss=15     ← cache FEEDING: 286 disk hits, almost no rebake
hit=348 (mem=58 idb=290) miss=10     ← still feeding
hit=68  (mem=68 idb=0)   miss=244    ← STARVED: 0 disk hits, 244 rebakes
hit=89  (mem=89 idb=0)   miss=213    ← still starved
```

Other confirming signals during the load:

- `[Drain] queued=14766 → 12724`, `built` averaging ~20/s, bursty (2–59/s) → the ~15-min trickle.
- `geomCache ... pend=301` pinned at the `BAKE_INFLIGHT_CAP` (~300) ceiling the entire time.
- `near=22m` (effective draw distance) pinned for the whole load → the small bubble.
- **Mesh/sculpt cache (qs-mesh) is NOT the problem this load**: `mesh q=0, inflight=0, cache` climbing —
  meshes are served from cache, not re-downloaded.

### Root cause

The geometry cache (`qs-geom`) lives in a **worker** (`geomCacheCore.js`), but:

1. The on-entry `geomManifestPrefetch` warms the worker **mem-tier**, which is a fixed **128 MB**
   (`geomCacheCore.js:101`; main-thread client L1 is 64 MB, `geomCache.js:28`). A 24k-prim region's
   working set vastly exceeds that, so most warmed geoms are **evicted from RAM before the drain
   reaches them**.
2. The drain (`drainMeshQueue` → `requestGeometry` → `_flushGeomLookups` → `geomCacheGetMany`,
   `useWorldEngine.js:453, 3995`) then issues **per-frame IDB reads** for the evicted keys.
3. Under main-thread saturation (baking, mesh build, texture decode/upload, render), those per-frame
   reads / their worker replies are delayed; the `useCacheIO` 30 s request watchdog
   (`useCacheIO.js:12`, `REQUEST_TIMEOUT_MS`) trips → returns an **empty** map → the engine **bakes**
   instead (counted as `miss`).
4. Re-baking refills the geometry RAM budget → `appRatio` stays high → the memory governor **pins
   `_effNear`** at ~22 m and pauses intake (`memGovernor.js`; `cullTick` grow/shrink).

It is a **read-starvation → rebake spiral**, not a re-download. The cache is **defeated at read time**,
in bursts. (Confirms mem [[idb-mainthread-starvation-rootcause]].)

---

## 2. Goal & Success Criteria

**Goal:** Re-entry to a cached region rebuilds in **seconds**, from a RAM-resident working set, so the
per-frame drain **never touches IDB mid-load** and never re-bakes a geom we already have on disk. As a
direct consequence the rebake pressure drops and `_effNear` grows off the floor on its own.

Verify on a warm Aspen reload via `server-watch.log` (live experience, not just green tests — per
[[no-regressions-once-stable]]):

| Signal | Today | Target after A |
|---|---|---|
| geom `miss` during warm reload | spikes to 200–280/window | near-zero (only genuinely-new geoms bake) |
| geom hits | bursty `idb`, drops to 0 | high + steady (from RAM; `idb=0` becomes *good*) |
| `[Drain] queued` | trickles ~15 min | collapses in seconds |
| `near=` | pinned ~22 m | climbs off the floor unaided |
| Badge | "Objects N downloading" (wrong) | "Rebuilding from cache" briefly, then clears |

---

## 3. Design — Approach A: bulk region warm-load

### 3.1 Region-sized warm working set

On region entry (the existing region-change detection in `cullTick`, `useWorldEngine.js:3668`), replace
the fire-and-forget mem-tier prefetch with a **bulk region warm-load** in the worker:

- Read the region manifest keys (`geomManifestGetKeys`, already present) and bulk-read their geometry
  into a **region-scoped RAM tier** sized to hold the whole working set, **capped** (see §3.2).
- Reads are issued as **a few large batched transactions** (not 24k individual `get`s), done **once up
  front**, inside the worker — so the slow, watchdog-trippable IDB work happens in one burst, not
  per-frame under contention.
- The warmed geometry is **pinned** in the region tier (not subject to the small 128 MB LRU) until the
  region changes, so it cannot be evicted out from under the drain.

### 3.2 Memory budget & graceful fallback

- The warm working set is **CPU-RAM**, already decoupled from the VRAM/app governor (per
  [[render-cache-unified-model]]), so warming it does **not** fight `appRatio` eviction.
- It gets its own cap, **auto-sized** from `deviceMemory`/heap with the existing **Prefs override**.
- **If a region's cached geometry exceeds the cap:** warm the **nearest** keys that fit (near-first,
  §3.3) and let the far field stream via the current per-frame path. No regression — just a smaller
  guaranteed-instant bubble. **This cap is exactly the seam Approach C later widens** (packed buffers
  make the far field cheap enough to warm too).
- **Hard-bounded / never hangs:** if the bulk read fails or a key is absent (cold/evicted), fall back to
  the existing per-frame `geomCacheGetMany` path.

### 3.3 Near-first warm order

Warm-load in the same avatar-anchored near-first order the drain already uses (`nearRefDist` /
`orderByDistance`, `cullPolicy.js`), so the bubble fills from the avatar outward and the first geoms the
drain asks for are already resident.

### 3.4 Drain reads RAM, never IDB mid-load

Once warmed, per-frame `geomCacheGetMany` calls are **region-tier hits** → fast worker replies, no IDB,
no watchdog trips, no rebake. `idb=0` in the logs then means "served from RAM," which is the goal — not
starvation.

### 3.5 No cache-format change

Approach A reads the **existing** `qs-geom` store and manifest as-is. **No `GEOM_VERSION` bump.** (The
format change is deferred to Approach C, so we bump the cache format **once**, per the cache-version
discipline in [[render-cache-backlog]].)

---

## 4. loadBadge accuracy

`loadBadge.js` currently collapses everything into **"Objects N downloading,"** which is misleading: the
real wait is CPU **baking**, not network download. Split using counters we already track
(`updateCullStats`, `useWorldEngine.js:3489`; `cullStats` fields):

| Dominant condition | Label |
|---|---|
| geom bake/`miss` queue dominant, region warm | **`Rebuilding from cache — N objects`** |
| geom bake queue dominant, region cold | **`Building scene — N objects`** |
| mesh/sculpt/texture **network** fetches in flight | **`Downloading N objects`** (genuine network case) |
| both present | show the deeper one (**bake first** — it is the real wait) |

This requires distinguishing **bake-pending** (geom miss / build queue) from **network-pending**
(`getMeshStats`/`getSculptStats`/`getTextureStats` `inflight`) when computing the badge counts. The
pure view logic stays unit-testable in `loadBadge.js`; the new counters are sourced in
`updateCullStats`. "Warm vs cold" can be derived from whether a region manifest existed at entry.

---

## 5. Approach C (planned follow-on — NOT specified here)

Once A proves the warm path is solid, C raises the ceiling and is the "bubble-outward" half of Gene's
option 3:

- Persist **per-region packed/merged geometry buffers** (grouped by material) so re-entry is a handful
  of large reads + near-zero bake, and the **far field** can render as merged static meshes (folds in
  the static-merge idea from the prior session, see [[next-tasks-queue]]).
- This is where the §3.2 cap stops mattering — packed far-field is cheap enough to warm.
- Requires a **`GEOM_VERSION` bump** and touches the **render path**; gets its own spec.

---

## 6. Out of scope / YAGNI

- No change to mesh/sculpt/texture caches (qs-mesh working fine this load).
- No render/LOD/static-merge work (that's C).
- No `GEOM_VERSION` bump (that's C).
- The **terrain fall-to-1m bug** on Aspen is logged separately in `docs/FEATURE-GAPS.md`
  (Movement & Physics) and explicitly **not** part of this work.

---

## 7. Files likely touched

| File | Change |
|---|---|
| `src/lib/geomCacheCore.js` | region-scoped warm tier + bulk batched read + pin-until-region-change |
| `src/workers/cacheIO.worker.js` | new bulk warm-load op (replaces/extends `geomManifestPrefetch`) |
| `src/lib/geomCache.js` | main-thread client passthrough + fallback |
| `src/composables/useWorldEngine.js` | fire bulk warm-load on region entry; warm/cold flag for badge |
| `src/lib/loadBadge.js` | bake vs download labels |
| Prefs (existing RAM-budget slider) | expose/clamp the warm-tier cap |
| `src/__tests__/...` | warm-tier sizing/cap/fallback unit tests; loadBadge label tests |

---

## 8. Testing

- **Unit:** warm-tier cap sizing + over-cap nearest-fit selection; fallback when key absent; loadBadge
  bake-vs-download label matrix (pure, like the existing 13 loadBadge tests).
- **Live (the real bar):** warm Aspen reload shows `miss`→~0, `queued` collapses in seconds, `near=`
  climbs unaided, badge reads "Rebuilding from cache" briefly. Light↔heavy round-trips rebuild fast.
