# Instant-Load Geometry Cache — Design

Date: 2026-06-12 · Branch: phase3 · Author: Gene (with Claude/Fable)
Status: approved design, pre-plan

## Problem

Every session re-bakes all region geometry. On a 10–24k-prim region that means:

- Every prim re-tessellates in the bake worker (`meshBake.worker.js`), each with a
  placeholder-cube alloc → hot-swap → dispose cycle on the main thread.
- Every mesh/sculpt prim re-reads raw submeshes from `qs-mesh` and re-structured-clones
  them into the worker before baking.
- The resulting cold-load storm (applySwap, placeholder churn, GC) saturates the main
  thread and starves the async texture fetch legs — root cause #1 of the texture trickle
  diagnosed 2026-06-12 (see `docs/superpowers/specs/2026-06-07-worker-mesh-bake-design.md`
  for the bake pipeline this builds on).

Bake output is already plain typed arrays — `{ position, normal, uv, index, groups }`
from `extractGeomArrays` — which structured-clone natively into IndexedDB. Nothing about
the bake result is session-specific: it is a pure function of (shape, scale) for prims
and (asset, scale) for mesh/sculpt. So the rebake is pure waste after the first visit.

Additionally, identical shape+scale prims (linkset walls, fences, railings) each get
their own bake today, even within one session.

## Goals

- Re-entry of a previously seen region rebuilds geometry from cache, not from bake —
  freeing the main thread and worker for texture work (primary).
- Identical shape+scale prims bake at most once per session, even on first visit.
- Mesh/sculpt cache hits skip the `qs-mesh` raw read and worker clone entirely.
- Degrade exactly to current behavior when the cache is unavailable.
- Measurable: bake-avoided counters next to the existing `[Bake]`/`[Drain]` telemetry,
  with the per-leg texture timing (`__texStats`) as the cross-check.

## Non-goals / follow-ups (recorded, not designed here)

- **crc-probe-audit** — the sim re-feeds ~19.9k of 24k objects on reload; separate
  diagnosis-first effort, next after this ships.
- **Texture queue full stall** (observed live 2026-06-12) and `texCacheGet` read
  starvation (3.3–3.7 s avg behind write locks). This design is expected to relieve the
  saturation that causes the trickle, but if textures are not bulletproof after it
  ships, the stall/starvation gets its own investigation. A fully-stalled queue (vs. a
  trickle) may be a distinct wedge bug.
- Shared/refcounted `BufferGeometry` instances across identical prims (bigger memory
  win, but requires refcounted dispose and copy-on-write for the in-place rescale path;
  deferred).
- Caching baked geometry per-object (regionKey+localId); the shape+scale key dedupes
  across objects and regions, which is strictly more general.

## Decisions (from brainstorming)

- **Cache depth: IDB + in-memory dedup.** Persist baked arrays in IDB AND keep an
  in-session memory tier so identical prims bake once on first visit. Each mesh still
  gets its own `BufferGeometry` (no shared instances).
- **Coverage: all bake kinds.** Prim, mesh, and sculpt bakes are all cached. On a baked
  hit for mesh/sculpt, skip the `qs-mesh` raw read. Raw `qs-mesh` remains the fallback
  for new scales of a known asset.
- **Read pattern: drain-aligned batch reads.** One readonly `getAll`-style transaction
  per drain tick for that tick's keys — bounded memory, no per-prim transaction storm
  (the pattern that starved `texCacheGet`). Full-region preload rejected (OOM history);
  per-prim gets rejected (transaction storm).
- **Scope: geometry cache only.** crc-probe-audit and texture contention are separate
  follow-ups (see Non-goals).

## Architecture

Three tiers, one new module, one new hash util.

### 1. `src/lib/fnv1a.js` — hash util

FNV-1a 64-bit (two 32-bit lanes, hex-string output) over a packed byte buffer. The repo
has no hash utility today; no cryptographic strength needed. Pure, trivially testable.

### 2. `src/lib/geomCache.js` — the cache module

**DB `qs-geom` v1** — a separate database, deliberately: IDB locking is per-DB, so
`qs-tex` write locks can never starve geometry reads. Stores:

- `geom` — keyPath `key`. Record:
  `{ key, position, normal, uv, index, groups, bytes, savedAt, lastUsed }`
  (typed arrays stored directly via structured clone; `groups` is the plain
  `[{start, count, materialIndex}]` list).
- `meta` — keyPath `k`, single `{ k:'stats', totalBytes, count }` record. Stats are
  served from an in-memory `_lastStats` mirror (the Prefs-starvation lesson); IDB read
  is cold-start fallback only.

**API:**

- `geomCacheGetMany(keys) → Map<key, record>` — one readonly txn per call (the
  drain-tick batch read).
- `geomCachePut(key, arrays, bytes)` — buffered: coalesce window ~300 ms / hard-flush
  at a record cap (objectCache writeBuf pattern), relaxed durability.
- `geomCacheTouch(key)` — accumulates `lastUsed` in memory; one batched readwrite
  flush every ~10 s. Never a per-read write. Loss on crash is acceptable.
- `initGeomCacheCap()` — `navigator.storage.estimate()` FIRST, then cap =
  `min(20% of quota, 2 GB)`; logs `[GeomCache] cap NMB` (initCacheCap pattern from
  textureCache).
- LRU eviction by `lastUsed` in batches when `totalBytes` exceeds cap.
- `getGeomCacheStats()` — for the Prefs Network/Cache tab (meshCache pattern).

### 3. Tier 1 — in-memory dedup map

The existing `byteLRU` util (from `useMeshFetch.js`), keyed identically, cap ~128 MB.
Bytes reported into the `[Mem]` line and the memory governor's self-accounting (the
governor lesson: every cache accounts for itself).

### 4. Tier 2 — IDB (`qs-geom`), Tier 3 — worker bake (unchanged)

Misses fall through to `meshBaker.bake()` exactly as today; results are promoted into
tiers 1 and 2.

## Keying

- **Prim:** `p1:<GEOM_VERSION>:<fnv1a64(all 18 shape fields + scale float bits)>`.
  ALL 18 `PrimShape` fields are hashed — not just the 6 consumed by `buildPrimGeometry`
  today — so when hollow/cut/shear deformations land (Phase-3 backlog), shapes that
  differ only in those fields never collide with stale entries.
- **Mesh:** `m1:<GEOM_VERSION>:<assetUuid>:<scaleHash>`.
- **Sculpt:** `s1:<GEOM_VERSION>:<sculptTextureUuid>:<sculpt params affecting decode>:<scaleHash>`.
  The exact param set (type/mirror/invert) is verified against the decode path at
  implementation time — every input that changes decoded vertices must be in the key.
- **Scale:** hashed from exact Float32 bit patterns, no quantization — the sim re-feeds
  bit-identical values for unchanged objects.
- **`GEOM_VERSION`:** a constant in `primGeometry.js`, bumped whenever bake output
  changes for the same inputs. Old entries become unreachable and age out via LRU —
  no migration logic.

## Data flow (drain tick)

```
drainMeshQueue tick (existing 30ms cadence, budget, BAKE_INFLIGHT_CAP)
  1. compute keys synchronously for the tick's batch
  2. tier-1 (memory) hits → build FINAL geometry immediately in upsertMesh
       — no placeholder cube at all for these
  3. remaining keys → ONE geomCacheGetMany(keys) readonly txn
       hits  → geometryFromArrays(copy) → hot-swap (applySwap path) → promote to tier 1
       misses → existing path: placeholder cube + meshBaker.bake(job)
  4. bake completes → applySwap + promote to tier 1 + geomCachePut (buffered)
```

Mesh/sculpt bonus: the key is computable before `getMesh()`/`getSculpt()` is called, so
a baked hit skips the `qs-mesh` read and the worker structured-clone entirely. Only on a
miss does the raw-submesh fetch run.

Cull interaction: evicted prims re-entering via the R_NEAR stream-in re-queue into
`pendingMeshIds` and now hit tier 1/2 instead of re-baking — re-stream becomes
near-free.

## Array ownership (correctness-critical)

`geometryFromArrays` wraps arrays without copying, and the engine's in-place ratio
rescale on scale change (`mesh.geometry.scale(rx, ry, rz)`) mutates the underlying
arrays. Therefore:

- **Invariant: a cache entry's arrays are never aliased by any mesh.** On hit, the
  mesh receives per-array `slice()` copies. On a worker-bake miss, one copy is made and
  the other side keeps the transferred originals — which side copies is an
  implementation choice; the invariant is exactly one copy per hand-out (one memcpy,
  cheap relative to a bake).
- Nothing mutated after hand-out can corrupt an entry.

## Error handling / degrade

- IDB open/read failure → cache disabled for the session → every lookup is a miss →
  exactly today's behavior.
- Corrupt or unwrappable entry on hit → treat as miss, evict the entry, bake normally.
- `{ bad: true }` bake results (non-finite verts) are never persisted.
- Worker-dead sync-fallback bakes still put/get through the cache normally.
- All IDB calls wrapped; the drain loop never throws on cache failure.

## Telemetry

- `[Bake]` line gains: `geomCache hit=N (mem=N idb=N) miss=N`.
- `[Mem]` line gains: `geomCacheMB` (tier-1 bytes; IDB totalBytes in Prefs stats).
- Prefs Network/Cache tab row via `getGeomCacheStats()`.
- Before/after metric: `[Drain] built=N (N/s)` on a warm region re-entry, plus the
  per-leg texture timing (`getTextureStats().timing` / `__texStats`) showing texture
  legs unstarved.

## Testing

`bun test` with fake-indexeddb (already a devDep, textureCache pattern):

- `fnv1a`: determinism, lane independence, known-vector sanity.
- Key derivation: determinism; sensitivity (each of the 18 shape fields and each scale
  component changes the key); GEOM_VERSION bump changes the key.
- `geomCache`: put/getMany/evict/cap/stats; touch batching flushes once, not per read;
  write coalescing; cap eviction order by `lastUsed`.
- Copy-on-hand-out: mutating arrays returned to a mesh does not change a subsequent
  read of the same key.
- Drain integration (mocked baker): tier-1 hit builds without bake and without
  placeholder; idb hit swaps without bake; miss bakes once then both tiers hit;
  `bad:true` not persisted.

## Phasing

1. **Units:** `fnv1a.js` + `geomCache.js` + key derivation (pure, fully testable).
2. **Wiring:** drain-tick batch lookup + upsertMesh hit paths + put-on-bake in
   `useWorldEngine.js` / `useMeshBaker.js` integration points.
3. **Telemetry + cap/LRU + Prefs row.**
4. **Live verify:** cold visit → reload same region; compare `[Drain]` build rate,
   `[Bake]` hit/miss, texture timing legs, and time-to-fully-rendered.
