# 2026-06-07 — Render pipeline: worker mesh bake, decode investigation, 3 throughput/quality features

Tool: Claude Code (Opus). Reviewer: Gene. Branch: phase3.

Long session continuing the Phase-3 render/asset work. Resumed from `memory/render-pipeline-state.md`.

## 1. Web Worker mesh bake (committed `08faadb`)
Moved prim + mesh/sculpt geometry baking off the main thread (the #1 open throughput lever).

- `src/lib/primGeometry.js` (new) — extracted `buildPrimGeometry`/`applyShapeDeformation`/`bakePrimScale`/
  `swapSubmeshesToGeometry`/`geometryHasFiniteVerts` out of `useWorldEngine.js` + added
  `extractGeomArrays`/`geometryFromArrays`/`bakeJob`. Single source shared by engine + worker.
- `src/workers/meshBake.worker.js` (new) — module worker; batched jobs; transfers output buffers
  (inputs structured-cloned — submesh `subs` are shared cache arrays).
- `src/composables/useMeshBaker.js` (new) — `bake(job)` microtask-batches a fill burst into one
  postMessage; **sync fallback** when no worker; `outstanding()` backpressure signal.
- `useWorldEngine.js` — prims get a cheap unit-cube placeholder immediately, then hot-swap the
  worker-baked geometry (`applySwap`); mesh/sculpt route decoded submeshes through the worker.
- Bugs caught + fixed in-session: stale-swap scale race (`bakeScale` snapshot + ratio reconcile);
  **DataCloneError** (Vue/Pinia reactive Proxy can't be `postMessage`d → send plain snapshots:
  6 scalar shape fields + `plainSubs`); **OOM** under flood (`BAKE_INFLIGHT_CAP=300` gate at the drain
  loop — the cheap drain outran the single worker, piling job payloads).
- Live: 21k meshes, geoNaN=0, no crash. "Improved."

## 2. Texture decode-failure investigation (root-caused, NOT a bug to fix)
The ~63 permanently-white textures (`j2c_decode_incomplete: got 0 of N`) were systematically traced:

- Deterministic, not concurrency (ok/fail UUID intersection = 0).
- Not transport truncation (`Content-Length == bytes received`; `Range` returns `0-N/N+1` = grid has
  no more bytes). Some assets are literally **3 bytes**.
- **Verdict: truncated/corrupt J2C in the grid's asset store** (failed OpenSim uploads). Unrecoverable.
- Cross-checked Firestorm's cache: it has 17 of them as the *same* truncated bytes (600 B head in
  `texture.cache` + body in `<uuid>.texture`); FS renders them only via **Kakadu** (KDU v8.4.1), which
  tolerates truncation. Our openjpeg-wasm returns 0 even via `decodeSubResolution` (tested). Matching
  that needs Kakadu-grade robustness (not open-source). Accepted as permanent white (~8%).

## 3. Three follow-up features ("all"), committed
- **Persist `failedHard` → IndexedDB** (`textureCache.js` v1→v2 `failed` store, 7-day TTL;
  `useTextureFetch.js`). Reloads stop re-fetching/re-decoding the dead assets.
- **Parallel J2C decode** (`server/lib/j2cPool.ts` + `j2cWorker.ts`; `assets.ts` → `decodeInPool`).
  4 Bun worker threads → decode off the event loop (circuit health, helps #18) + parallel; inline
  fallback; error parity preserved. 91 server tests.
- **Mesh per-face multi-material** (`buildFaceMaterials`/`hasMultiFaceMesh`). Mesh assets with ≥2
  textures → one material per submesh/face. Prims keep the dominant-texture MVP.

## 4. Per-face UV fix (regression → fix, committed `d5b40ab`)
First per-face pass made textured mesh houses look boxy/solid. Root cause: the **full-ObjectUpdate TE
decoder never decoded UV** (stopped after colors); only the compressed path decoded default UV, and
neither captured per-face UV → per-face textures applied at identity UV.

- `lludp-codec.ts`: `parseTextureEntryFields` now captures per-face UV (`faceRepeats/faceOffset/
  faceRotation` via `combineFacePairs`); the full path was **unified onto it** (latent fix — full-update
  prims now get repeats/offset/rotation; previously all 1:1). `full-objupdate-decode.test.ts` added.
- `useWorldEngine.js`: `uvXform()` applies per-face UV and **clamps repeats to ±100** (SL editor max) to
  neutralize a rare garbage scale (`8215` in 1/12 fixtures; other 11 = 1.0). Single-texture + backfill
  paths now honor UV too.

## Tech-debt added
`perface-pbr-skip` (multi-face mesh + PBR mutually exclusive), `worker-bake-placeholder-forever`
(silent lost bake → permanent placeholder cube).

## Still open
- Mesh-build throughput on 20k+ regions (single worker; Chrome bg-throttle).
- Per-load delivery variance ("different objects each login" — grid-side, 9k vs 21k delivered).
- Per-face for PRIMS (box/cyl face→group mapping); full per-face PBR.
- The ~8% truncated grid textures stay white (no open-source fix).
