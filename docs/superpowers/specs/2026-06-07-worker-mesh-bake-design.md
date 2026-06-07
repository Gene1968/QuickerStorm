# Worker Mesh Bake — Design

Date: 2026-06-07
Status: approved, pre-implementation

## Problem

Region geometry build is the throughput ceiling on the Phase-3 render pipeline. After the
2026-06-07 O(n²)→O(children) orphan-index fix, mesh build runs ~30–37/sec — still minutes to
fill a 20k+ prim region, and Chrome background-throttles the `setInterval` drain to ~1/sec when
the tab is not foreground. The heavy cost is **vertex generation** on the main thread:
geometry tessellation (`THREE.BoxGeometry(1,1,1,2,8,2)` etc.), the twist/taper deform loop,
`computeVertexNormals`, and per-vertex scale-bake — all running on the same thread as the
renderer and event loop.

Wrapping already-generated typed arrays into a `BufferGeometry` is cheap (object creation, no
per-vertex JS loop). So the lever is: move vertex *generation* off the main thread; keep the
cheap wrap + scene-graph mutation on it.

## Goal

Move prim-shape and mesh/sculpt geometry baking into a Web Worker. Main thread does only cheap,
non-blocking work per prim (Mesh create, material, texture request, scene insert, reparent);
heavy bake runs in parallel in the worker. Target: drain far more prims per tick, bake throughput
no longer competes with render frame budget.

## Non-goals

- Geometry instancing / draw-call merging (separate lever, separate spec).
- Caching swapped-unscaled mesh geometry across instances (scale is baked per-instance).
- Curing Chrome's background `setInterval` throttle (worker keeps running, but ingestion pacing
  is unchanged; this design parallelizes bake, it does not change the drain cadence policy).

## Architecture

### Core idea
Every mesh gets a cheap **placeholder unit-cube baked to scale** immediately, so scene-insert,
reparent, and positioning never block on geometry. Heavy geometry is baked in the worker and
**hot-swapped** in on return — extending the async hot-swap pattern that mesh/sculpt prims
already use (`getMesh().then(applyDecoded)`) to prim shapes as well.

### 1. Shared module — `src/lib/primGeometry.js`
Move out of `useWorldEngine.js` (single source of truth, imported by both worker and engine):
- `buildPrimGeometry(shape)`
- `applyShapeDeformation(geom, shape)`
- `bakePrimScale(geom, scale)`
- `swapSubmeshesToGeometry(subs, scale)`
- `geometryHasFiniteVerts(geom)`

New helpers:
- `extractGeomArrays(geom)` → `{ position, normal, uv, index, groups }` (typed arrays + group
  list `[{start, count, materialIndex}]`).
- `geometryFromArrays(arrays)` → `BufferGeometry` (setAttribute ×4, setIndex, re-add groups).

These import THREE. Reuses the exact existing geometry code in the worker — zero divergence risk
(the "import Three in worker" decision).

### 2. Worker — `src/workers/meshBake.worker.js`
Module worker (`{ type: 'module' }`), imports `primGeometry.js`. Handles **batched** jobs:
- `prim`:   `{ id, kind:'prim', shape, scale }` → `buildPrimGeometry` + `bakePrimScale`
- `submesh`: `{ id, kind:'submesh', subs, scale }` → `swapSubmeshesToGeometry`

Runs `geometryHasFiniteVerts` in-worker; if non-finite, returns `{ id, bad: true }` instead of
shipping NaN arrays. Posts each batch result back with **transferables** = the output array
buffers (zero-copy).

### 3. Dispatcher — `src/composables/useMeshBaker.js`
- `bake(job) → Promise<arrays | {bad:true}>`.
- Batches jobs submitted within a drain tick into a single `postMessage` (array payload);
  resolves each job's promise by `id` on the matching batch reply.
- **Single worker** to start (one core bakes while main renders). Round-robin pool is a trivial
  later extension — dispatcher keeps a worker array; start with length 1.
- **Fallback:** if worker construction throws (no module-worker support, CSP, etc.), `bake()`
  runs the `primGeometry.js` functions synchronously inline and resolves immediately. Worker is
  an accelerator, not a hard dependency — engine behaves correctly without it.

### 4. `useWorldEngine.js` wiring
- **Prim isNew path:** create the Mesh with a cheap unit cube baked to scale
  (`BoxGeometry(1,1,1)` → `bakePrimScale`, instant) as immediate geometry → call
  `bake({kind:'prim', shape, scale})` → on resolve: `geometryFromArrays` → finite-check (already
  done in worker via `bad`) → hot-swap `mesh.geometry`, dispose old. For actual box prims the
  swap is visually invisible (cube → box).
- **Mesh/sculpt path:** after `getMesh`/`getSculpt` resolves with `subs`, call
  `bake({kind:'submesh', subs, scale})` instead of the inline `swapSubmeshesToGeometry`.
- **`bad` flag:** keep the placeholder cube + placeholder color (existing NaN-guard behavior,
  `geoNaNCount`).
- **`drainMeshQueue`:** unchanged structure, but per-item work is now cheap (no heavy gen) →
  more prims processed per `MESH_DRAIN_BUDGET_MS` tick; heavy work runs parallel in the worker.

## Data flow

```
drainMeshQueue → upsertMesh(obj)
  ├─ (cheap, main thread) Mesh + material + texture req + scene.add + reparent
  └─ bake(job) ──postMessage(batch)──▶ worker
                                         buildPrimGeometry / swapSubmeshesToGeometry
                                         finite check
       ◀──postMessage(arrays, [transfer])──┘
     geometryFromArrays → mesh.geometry = baked; old.dispose()
```

## Transferable correctness

- **Worker OUTPUT** arrays: always transferred (detached on worker side, owned by main after).
- **Job INPUT:**
  - `prim`: `shape`/`scale` are tiny plain objects — structured-clone (no transfer).
  - `submesh`: `subs` are **shared mesh-cache typed arrays** — multiple prims reuse one `meshId`.
    MUST NOT be transferred/detached (would break the cache for sibling instances).
    Use structured-clone copy (default postMessage behavior, no transfer list for inputs).

## Error handling

- Worker `onerror` / `messageerror`: log via `debugStore`, mark worker dead, route subsequent
  `bake()` calls to the synchronous fallback. In-flight promises for that batch resolve via
  fallback re-run or reject → caller keeps placeholder cube.
- `bad:true` result → placeholder cube retained, `geoNaNCount++` (parity with current guard).
- Unmount: terminate worker, reject/settle outstanding promises.

## Testing

- vitest on `primGeometry.js` pure functions (existing behavior preserved post-extraction).
- `extractGeomArrays` → `geometryFromArrays` roundtrip equality (position/normal/uv/index/groups).
- `useMeshBaker` fallback path: when worker unavailable, `bake()` resolves with correct arrays
  synchronously.
- Worker file itself not unit-tested (jsdom has no `Worker`); its logic is the shared module,
  which is covered.

## Risk / open question

Trusting the memory note that geometry bake is the ~37/sec cap. If post-wiring throughput barely
moves, the real cost is scene-graph insert / draw-call count, and the next lever is geometry
instancing/merging — a separate spec. Mitigation: keep the `[Assets]`/build-rate telemetry to
measure before/after.
