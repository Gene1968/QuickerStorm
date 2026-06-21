# Off-Main-Thread Cache I/O Worker (qs-geom + qs-mesh) — Design

> Status: design approved 2026-06-21 (brainstorm). Root-cause fix for the heavy-region
> "warm cache loads cold" problem. See mem [[idb-mainthread-starvation-rootcause]].

## Problem (root-caused, evidence-backed)

On a heavy region (Aspen, 24,355 objects), a *warm* revisit re-bakes all geometry
(`geomCache idb=0`) and re-downloads all meshes from the grid (`[Mesh]` decodes climbing ~7/min),
taking 1–2 hours despite the region having been loaded many times.

Confirmed root cause: **main-thread saturation starves IndexedDB completion callbacks.** The
build/bake/render/ingest work monopolizes the main thread, so the IDB `onsuccess` callbacks that
`geomCacheGetMany` / `meshCacheGet` depend on never get scheduled in time → the 4 s geom watchdog
trips and **degrades to all-miss → re-bake**, which adds *more* main-thread work → self-sustaining
spiral. Decisive evidence: a plain `indexedDB.open('qs-geom')` in the console never settled while the
region was loading (the data is present — 6.6 GB used, `GEOM_VERSION=1` stable — the tab just can't
finish reading it). The many prior point-fixes (mem-tier prefetch, write-deferral, watchdogs,
heap-sizing) treated symptoms; this is architectural.

Secondary (out of scope here): `navigator.storage.persisted() === false` → cross-session evictability.

## Goal

Move qs-geom + qs-mesh IndexedDB I/O (reads AND writes) and the large geometry/mesh RAM cache off
the main thread into a dedicated Web Worker, so cache reads can't be starved by main-thread load and
the engine stops re-baking/re-downloading data it already has. **Success = a warm Aspen revisit loads
in minutes, not hours**, with no regression to cold/light/var/multi-region loading.

## Non-goals (v1)

- Texture cache (qs-tex) — keeps its current path (it has a decode worker and renders late, not as
  cubes; touching its intricate decode+write-deferral pipeline risks regressing a working path).
- The `PERSISTED false` cross-session eviction — separate follow-up; a different problem from the
  in-session starvation this fixes.
- Merging this worker with the existing meshBake worker.

## Approach (chosen: A — worker owns the cache)

A single Web Worker is the **sole owner** of the qs-geom and qs-mesh IndexedDB connections and the
large RAM mem-tiers. The main thread keeps a **small synchronous L1** (instant repeat-hits) and a
**synchronous fallback** (the same core logic, run on-main if the worker dies). Single owner per DB →
**no cross-connection contention** (the flaw that ruled out a reads-only worker, since mesh writes
happen during load).

### Modules

| Module | Kind | Responsibility |
|--------|------|----------------|
| `src/lib/geomCacheCore.js` | refactor (extract) | All qs-geom IDB logic: open, `getMany`, `store`, write-deferral (`setLoading`, ceilings, hard-cap, `_writeBuf`), eviction, manifest, caps, stats. DOM-free → runs in worker AND on main (fallback). Owns the **large** geom mem-tier (byteLRU). |
| `src/lib/geomCache.js` | rewrite → thin client | Sync **L1** mem-tier (small) + `geomMemGet`; routes misses + stores to the worker via `useCacheIO`; **sync fallback** to `geomCacheCore` when the worker is dead. Preserves today's exported API (`geomCacheGetMany`, `geomCacheStore`, `geomMemGet`, manifest fns, stats, caps, `setGeomCacheLoading`, …) so callers are unchanged. |
| `src/lib/meshCacheCore.js` | refactor (extract) | qs-mesh IDB logic: open, `get`, `put` (+ LRU eviction, caps, stats, watchdog). DOM-free. |
| `src/lib/meshCache.js` | rewrite → thin client | Routes `meshCacheGet`/`meshCachePut` to the worker; sync fallback to `meshCacheCore`. Preserves API. |
| `src/workers/cacheIO.worker.js` | new | Imports both cores; owns the IDB connections + large mem-tiers; handles `geomGet`/`geomStore`/`meshGet`/`meshPut`/`geomManifest*`/`setLoading`/`clear`/`stats` messages. |
| `src/composables/useCacheIO.js` | new | Worker lifecycle + protocol wrapper (mirrors `useMeshBaker`): instantiate, `Map<id,{resolve}>` correlation, `outstanding()`, `dead`-flag → `onerror`/`onmessageerror` → sync fallback, `RECYCLE_AFTER_JOBS`, `takeStats`, `isDead()`. |
| `src/stores/uiStore.js` | edit | `cacheWorker` kill-switch flag (default true). |
| `src/composables/useWorldEngine.js` | edit | `_flushGeomLookups`: sync-L1-first; remove the re-bake watchdog (see below); `[Bake]` telemetry adds worker stats. |

### Worker message protocol & array ownership (correctness-critical)

Mirror the meshBaker pattern: `new Worker(new URL('../workers/cacheIO.worker.js', import.meta.url),
{ type: 'module' })`; every request carries an `id`; the worker echoes `id`; correlation via
`Map<id,{resolve}>`; output buffers **transferred**.

- **`geomGet`**: main posts `{id, kind:'geomGet', keys:[…]}`. Worker: per key, mem-tier → IDB → deserialize;
  posts `{id, hits, misses}` where `hits` carries arrays with their buffers **transferred**. The worker
  sends a **clone** of each hit so its own mem-tier copy is not detached by the transfer; the clone is
  produced **in the worker** (off-main). Main receives fresh, owned arrays.
- **`geomStore`**: after a bake, main builds the mesh from the baked arrays, then posts a **clone**
  (`{id?, kind:'geomStore', key, arrays}`, buffers transferred) to the worker for IDB + worker mem-tier.
- **`meshGet`** / **`meshPut`**: same shape for `submeshes`.
- **INVARIANT (preserved):** a cache entry's arrays are never aliased by any mesh. The clone-at-the-
  worker-boundary rule enforces this exactly as `geomCache.cloneArrays` does today. `geometryFromArrays`
  wraps without copying, so main must clone **before** transferring (or transfer a clone) — never hand
  the mesh's live buffers to `postMessage`, which would detach them.

### Main-thread integration — the spiral-breaker

In `useWorldEngine.js` `_flushGeomLookups` (currently calls `geomCacheGetMany` with a 4 s
watchdog that degrades to all-miss):

1. **Sync L1 first:** check `geomMemGet(key)` for each unique key; serve L1 hits synchronously
   (count `_geomHitMem`), no worker round-trip. Only L1 misses are sent to the worker.
2. **Authoritative hit/miss from the worker:** `geomGet` returns exactly which keys are `hits`
   (serve via `applySwap`, count `_geomHitIdb`) and which are `misses` (→ `_bakeGeomGroup`, count
   `_geomMiss`). **No watchdog-guessing.**
3. **Remove the "4 s → all-miss → re-bake" path.** A slow-but-present read now **waits** for the
   worker's verdict instead of re-baking. The only timeout retained is a long **dead-worker backstop**
   (e.g. 60 s) → switch to the **sync fallback** (run `geomCacheCore.getMany` on main = today's
   behavior), never a blind re-bake. This is the change that stops re-baking cached data and de-saturates
   the thread.

Mesh: `useMeshFetch.getMesh`'s tier-2 step (`meshCacheGet`) routes to the worker; a true miss → network
as today. The 30 s mesh watchdog becomes a dead-worker backstop only.

### Coherence & contention

Single owner per DB ⇒ no cross-connection serialization. `postMessage` preserves per-channel order, so a
`geomStore` posted before a later `geomGet` for the same key is processed first in the worker. Just-baked
keys are also covered by the main L1 (siblings/post-bake serve sync from L1, as today). Write-deferral
(`setGeomCacheLoading`), byte/time ceilings, the 256 MB write-buffer hard-cap, and the LRU caps all move
into `geomCacheCore` with unchanged semantics — the engine still calls `setGeomCacheLoading(true/false)`,
which now forwards to the worker.

### Heap

The large geom/mesh RAM mem-tiers move into the worker's **own V8 isolate/heap**, so they no longer count
against the main thread's ~4 GB. Main keeps a **small** L1 (e.g. 64 MB). Net: main-thread heap pressure
*drops*, which also relieves the heap-pressure cap that was evicting the prefetched mem-tier.

## No-regression safety

- **Sync fallback** (worker dead/error/`DataCloneError`/unsupported) → main runs the cores directly =
  today's exact code path. Worst case = status quo, never worse.
- **Kill-switch** `uiStore.cacheWorker` (default true); off forces the main-thread path.
- Same keys (`GEOM_VERSION=1`), same `regionKey`, same bake-on-miss → cold/light/var/multi-region behave
  identically; the worker only relocates where IDB runs.

## Testing

- `geomCacheCore` / `meshCacheCore`: the existing geomCache/meshCache unit tests (fake-indexeddb) move to
  target the cores and must stay green (read/write/evict/manifest/watchdog/caps). No behavior change.
- `useCacheIO`: unit-test the wrapper like `useMeshBaker` — id-correlation, `outstanding()` backpressure,
  and the **dead-flag → sync fallback** path (kill the worker, assert calls resolve via the core).
- Ownership: a test asserting a served hit's buffers are independent from the worker/core's retained copy
  (no aliasing after transfer).
- **Live-verify on warm Aspen:** `[Bake] geomCache idb=` flips 0 → high; `[Mesh]` grid decodes ≈ 0;
  load completes in minutes; no main-thread freeze; cold/light/var timings unchanged.

## Rollout

No cache-version bump (keys unchanged). Behind the `cacheWorker` flag with the sync fallback as the floor.
Land + live-verify on Aspen before flipping any default.
