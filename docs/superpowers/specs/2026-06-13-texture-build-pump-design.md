# Throttled Texture Build + GPU-Upload Pump — Design

> Spec for FEATURE-GAPS #11 (heavy-region main-thread saturation), **pass 1 of 2**.
> Date: 2026-06-13. Branch: phase3.
> Pass 2 (a texture decode Web Worker) is a separate, later spec — see "Out of scope".

---

## Problem

On a heavy region load (especially a full-page hard reload), the texture pipeline saturates the
main thread, which starves IndexedDB read callbacks and trips watchdogs. Console evidence from a
live hard reload (post-#10 build):

- `[GeomCache] deferred flush forced: time-ceiling 68→153MB buffered` — #10 write-deferral is
  working, write contention is gone — yet `wdog=271` geom cache reads **still timed out** and
  re-baked. Write contention removed, reads still starve ⇒ root cause is **main-thread saturation**,
  not IDB write contention.
- **~1700 `[TexCache] get watchdog (10000ms) → miss` trips** in one load window — the texture
  decode/upload storm jams the main thread, starving both texture (10 s) and geom (4 s) read
  callbacks (different DBs, shared main thread).

The texture path's main-thread hot spots this pass targets:
1. `buildTexture` (`useTextureFetch.js:242`) — `createImageBitmap` continuation + main-thread canvas
   downscale (`document.createElement('canvas')` + `drawImage`, `:251`) + `new
   THREE.Texture(needsUpdate=true)`. Up to `MAX_INFLIGHT = 12` blobs resolve near-together → a burst
   of all this work in one task.
2. **GPU upload** — Three.js lazily `texImage2D`'s every `needsUpdate` texture during
   `renderer.render()` (`useWorldEngine.js:3865`); 100+ textures/sec accumulate then upload in a
   single frame → the rAF spike.

(`b64ToBlob`'s synchronous `atob` in the WS handler is hot spot #1 but belongs to pass 2 — see
"Out of scope".)

## Goal

Spread the texture **build + GPU-upload** cost across frames via a per-frame budgeted pump, so no
single frame does a burst of decode/downscale/upload. Freed main-thread time lets IDB read callbacks
fire → fewer geom *and* texture watchdog trips, faster warm loads.

Non-goal: making a full-region hard reload instant. The cache removes the re-*bake* cost; the
per-object decode/upload/render cost is irreducible on the main thread. Success = the work is
*spread* (no multi-hundred-ms frames) and reads *succeed* (watchdog trips drop sharply).

---

## Current flow (for reference)

`useTextureFetch.js` is a module singleton. `getBaseTexture(uuid)` (`:265`):

```
getBlob(uuid) ─.then→ buildTexture(blob) ─.then→ cache.set(uuid, tex); resolve
```

`buildTexture` runs inline the moment each blob resolves — no per-frame throttle beyond the
`MAX_INFLIGHT = 12` network gate. Consumers call `getTexture`/`getBaseTexture` and apply in a
`.then` (`mat.map = tex; mat.needsUpdate = true`) at ~5 scattered sites in `useWorldEngine.js`
(`:2038`, `:2069`, `:2084`, `:3414`, `:3493`). The engine already drives `pumpTextures()` (the
network pump) from the 30 ms drain (`useWorldEngine.js:3952`). The renderer is created at
`useWorldEngine.js:1427` and is NOT visible to `useTextureFetch`.

---

## Architecture

Decouple "blob ready" (cheap) from "texture built + uploaded" (expensive). Blob-ready enqueues a
build job; a per-frame **budgeted pump** drains the queue, building + uploading at a controlled
rate, then resolving the promise the consumer is awaiting. Because consumers already await the
promise, the ~5 apply sites are unchanged — they simply resolve at the budgeted rate, which also
spreads the `material.needsUpdate` apply/shader-recompile cost.

### Components

**1. Budgeted scheduler — `src/lib/budgetedDrain.js` (new, pure, unit-testable)**

A tiny helper with no DOM/THREE dependency so it can be tested in `bun:test`:

```
drainWithinBudget({ queue, maxItems, budgetMs, now, processOne })
```

- `queue` — an array used as FIFO (`shift()`).
- Drains items while `processed < maxItems` AND `now() - start < budgetMs` AND `queue.length`.
- Calls `processOne(item)` per item. Returns the count processed.
- `now` is injected (defaults to `performance.now`) so tests pass a fake clock.
- A `processOne` that throws must not abort the loop — it is caught, counted as processed, and the
  error surfaced via a `onError` callback (so one bad blob can't wedge the pump). 

**2. Build queue + pump in `useTextureFetch.js`**

- New module state: `const buildQueue = []` (entries `{ uuid, blob, resolve }`), and
  `let _renderer = null`.
- `export function setTextureRenderer(r) { _renderer = r }` — engine injects the THREE renderer.
- `getBaseTexture` change: replace the inline `.then(buildTexture).then(cache…)` with: on blob
  resolve, push `{ uuid, blob, resolve }` to `buildQueue` (the returned promise resolves later, from
  the pump). A null/failed blob resolves the promise with `null` immediately (no enqueue).
- `export function pumpTextureBuilds(now = performance.now)` — calls `drainWithinBudget` with
  `maxItems = TEX_BUILD_MAX_PER_FRAME` (32), `budgetMs = TEX_BUILD_BUDGET_MS` (4), and a
  `processOne` that:
  1. `tex = await buildTexture(blob)` — NOTE: `buildTexture` is async (`createImageBitmap`). To keep
     the budget meaningful, the pump dispatches builds but the per-frame budget bounds how many it
     *starts* and the synchronous downscale/Texture-construction cost; see "Async note" below.
  2. if `tex && _renderer` → `_renderer.initTexture(tex)` (deterministic GPU upload now, off the
     `render()` critical path). Wrapped in try/catch — a failed upload still resolves the texture
     (lazy upload remains the fallback).
  3. `cache.set(uuid, tex)`, `lastUsed.set`, `blobCache.delete(uuid)`, `tex.userData.hasAlpha = …`
     (preserve current `getBaseTexture` post-build bookkeeping), then `resolve(tex)`.
- Telemetry: extend `getTextureStats()` to include `buildQueued: buildQueue.length` and a
  rolling `builtPerSec` (or expose a `buildBacklog` count). Reported in the existing `[Main]`/`[Tex]`
  line.

**Async note (important for the plan):** `buildTexture` is `async` (`createImageBitmap`). A strict
per-frame *time* budget can't fully bound async decode latency, but the browser already runs the
actual `createImageBitmap` decode off-thread; the main-thread costs we are spreading are (a) the
synchronous canvas `drawImage` downscale, (b) `new THREE.Texture` + `initTexture` (`texImage2D`), and
(c) the `.then` apply. The pump therefore bounds **how many builds are dispatched per frame**
(`maxItems`) and, because `initTexture` + the synchronous downscale are the costly main-thread parts,
this is what spreads the spike. The `budgetMs` guard covers the synchronous portion that runs before
the pump yields. Builds dispatched but not yet resolved do not block the next frame's pump.

**3. Engine integration — `src/composables/useWorldEngine.js`**

- After the renderer is created (`:1427`), call `setTextureRenderer(renderer)`.
- Import `pumpTextureBuilds` and call it once per frame inside `animate()`, BEFORE `renderer.render()`
  (so freshly-uploaded textures are ready and the budget tracks real frames). Keep the existing
  `pumpTextures()` (network pump) in the 30 ms drain unchanged.
- Add the new build-backlog stat to the `[Main]`/`[Tex]` telemetry line.

---

## Data flow (after)

```
WS asset-data → blob ready ──push {uuid,blob,resolve}──▶ buildQueue
animate() frame:
  pumpTextureBuilds()  ─ drain ≤32 items or ≤4ms ─▶ per item:
        buildTexture (decode + downscale) → renderer.initTexture (upload now)
        → cache.set → resolve(tex)
  consumer .then(apply): mat.map = tex; mat.needsUpdate = true   (spread at budget rate)
  renderer.render()  ← textures already GPU-resident → no upload spike
[overflow stays queued → next frame]
```

## Error handling / degradation

- `buildTexture` returning null (decode failure) → resolve(null); consumer keeps placeholder (current
  behavior).
- `_renderer` unset (e.g. before engine init, or in tests) → skip `initTexture`; texture uploads
  lazily at `render()` as today (graceful fallback, no hard dependency).
- `initTexture` throw → caught; resolve the texture anyway (lazy upload fallback).
- A `processOne` throw → caught by `drainWithinBudget`, counted, surfaced via `onError`; the pump
  continues with the next item (one bad blob can't wedge the queue).
- Backpressure: the existing `TEX_INTAKE_BUDGET` / `emergencyHeap()` network gate (`_pump`, `:92`) is
  unchanged. `buildQueue` holds only blob refs (compressed WebP bytes) — cheap; it drains at budget.

---

## Scope

**In:** `src/lib/budgetedDrain.js` (new), `src/composables/useTextureFetch.js` (build queue + pump +
`setTextureRenderer` + stats), `src/composables/useWorldEngine.js` (inject renderer, drive pump per
frame, telemetry). Tests for `budgetedDrain`.

**Out (→ pass 2, the decode Web Worker — separate spec):**
- Moving `b64ToBlob` (`atob`) off the WS-handler critical path.
- Moving `createImageBitmap` + downscale off the main thread via a worker + `OffscreenCanvas`
  (returning transferable `ImageBitmap`s). The pump built here keeps its upload-throttle role when
  the worker lands; only the decode work relocates into the worker.
- xform-clone upload throttling (`getTexture` non-identity clones, `:304`) — fewer in number; revisit
  if still spiky after pass 1.
- Anything in #10 (geom) — shipped/committed.

---

## Testing

**Unit (`bun:test`, `src/__tests__/lib/budgetedDrain.test.js`):**
- Drains up to `maxItems` then stops (count cap), leaving the remainder queued.
- Stops when the injected clock exceeds `budgetMs` mid-drain (time cap), even below `maxItems`.
- Empty queue → processes 0, no throw.
- `processOne` throw → counted, loop continues to next item, `onError` invoked.
- FIFO order preserved.

**Live (the real bar, per the no-regressions rule — verify via the engine console):**
- Hard reload of a heavy region: `[Main]` max frame time drops (was up to ~1049 ms); geom `wdog` and
  TexCache watchdog trip counts drop sharply vs the ~271 / ~1700 baseline; build backlog drains
  steadily rather than spiking; textures still appear (no permanently-bare regression).
- Flying around (the case #10 already made fast): no regression — small batches still apply promptly.
- `build:staging` clean.

## Cache-version / protocol note

No cache format, GEOM_VERSION, or WS protocol change — pure client-side scheduling. No user cache
wipe.
