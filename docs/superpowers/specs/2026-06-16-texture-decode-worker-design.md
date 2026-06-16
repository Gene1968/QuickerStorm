# Off-main-thread texture decode — FEATURE-GAPS #11 Pass 2

**Date:** 2026-06-16
**Area:** Render / Cache (#11 main-thread saturation)
**Status:** design approved, pre-implementation

## Problem

After #13 (the visibility cull) shipped and live-verified 2026-06-16, the render traversal cost
collapsed (`render` 1671–2546 → 127–968 ms/window, ~5 → 55–90 fps). The exposed next ceiling is the
**main thread being pegged by texture decode + GPU upload**, plus the IDB-read starvation that rides on
it:

- Live `__texStats` round 2/3 (2026-06-16): the build pump is unwedged (`inflight 0→6`, `done 24→128`)
  but the texture queue still climbs at ~8 fps; `idb avg=8546 ms` (later 15.5 s) — IDB read callbacks
  are starved behind main-thread work, so `_wsFetch.run`'s IDB recheck holds each of the 6 network slots
  ~9 s → throughput collapses and the queue refills faster than it drains.
- Bottom-Up self-time names `createImageBitmap` + `renderer.initTexture` (the `buildQueue` pump) as the
  main-thread hog once render is culled. Draw distance is deliberately kept low (~120 m) purely to
  protect fps against this cost.

**Standing decision (mem `render-distance-cull-shipped`, FEATURE-GAPS header):** the fix is to move
`createImageBitmap` + downscale **off the main thread into a worker** (mirror `meshBake.worker.js`); the
existing Pass-1 upload-throttle pump survives that move because the GPU upload (`initTexture`) must stay
on the main thread.

This is **Pass 2** of #11. Pass 1 (2026-06-13, committed) deferred `buildTexture` out of
`getBaseTexture` into a per-frame budgeted pump (`pumpTextureBuilds`, `src/lib/budgetedDrain.js`). Pass 2
was deferred at the time because that profile didn't name decode — superseded now that #13 culled render
and decode/upload is the measured top cost.

## Goal

Move the texture **decode** (`createImageBitmap` + downscale → `ImageBitmap`) off the main thread, so:
1. `createImageBitmap`/downscale CPU leaves the main thread → fps holds while textures fill.
2. Freed main thread lets the starved IDB read callbacks (`texCacheGet`) complete → fewer false-misses,
   network slots cycle fast, queue drains instead of climbing.
3. Eventually lets draw distance rise without tanking fps (a downstream payoff, not part of this slice).

**Non-goals (deferred):**
- Moving `b64ToBlob` / `atob` into the worker. It runs only on **network** arrivals (gated ≤6 concurrent,
  ~1.3/s) and never on the painful **warm** region case (all blobs come from IDB). The 06-16 profile did
  not name atob. Keeping the worker boundary a uniform **Blob → ImageBitmap** (identical for IDB hits and
  network arrivals) is cleaner and lower-risk than threading atob + Blob-reconstruction through the
  network-persist path. Follow-up if a later profile names atob.
- A worker **pool**. Single worker (see below). The named ceiling is the main thread being *pegged*, not
  decode throughput — one extra thread frees main, lets IDB complete, recovers fps. The grid network
  (~1–2 s/fetch ×6) is a separate throughput limiter a pool wouldn't help. Add a pool later only if
  decode throughput is the proven residual.
- Adaptive build-pump throttle, per-face near-gate extension (separate items in #13 follow-ups).
- No `GEOM_VERSION` / cache-version bump — this changes the decode *path*, not stored geometry/texture
  bytes.

## Architecture — two-phase pump

`_processBuild` today does decode **and** upload back-to-back on the main thread. Pass 2 splits them,
both still driven by the existing once-per-frame `pumpTextureBuilds()`:

- **Phase A — dispatch (off-thread):** a blob-ready job posts its `Blob` to the decode worker. Blob
  structured-clone into a worker is cheap (shares the backing store by reference, no byte copy). Bounded
  by a **backpressure cap** on outstanding decodes (`texDecoder.outstanding()`), so decoded `ImageBitmap`s
  (which hold decoded RGBA in memory) cannot pile up faster than Phase B drains them.
- **Phase B — upload (main-thread, throttled):** the worker transfers the decoded+downscaled `ImageBitmap`
  back (zero-copy via transfer list). That enqueues an upload job; the per-frame pump drains it within the
  existing count+wall-clock budget: `new THREE.Texture(bitmap)` (+ `flipY=false`, sRGB, RepeatWrapping,
  `needsUpdate`) → `renderer.initTexture(tex)` → the existing post-build bookkeeping
  (`userData.hasAlpha`, `cache.set`, `lastUsed`, free `blobCache`) → `resolve(tex)`.

The decode-failure / null path still resolves the consumer's promise (consumer keeps its placeholder),
exactly as today — no permanently-white texture if decode throws.

## Components

### NEW `src/lib/texDecodeBitmap.js` — shared decode primitive
Imported by **both** the worker and the main-thread fallback. Self-contained, no THREE dependency.

- `computeDownscale(w, h, maxDim) → { w, h } | null` — pure: returns null if `max(w,h) <= maxDim`
  (no downscale), else the scaled `{w,h}` with a ≥1 px floor. **Unit-tested.**
- `decodeToBitmap(blob, maxDim) → Promise<ImageBitmap | null>`:
  - `createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })` (preserves the
    Pass-1 orientation + straight-alpha guarantees — WebGL ignores the pixel-store flip/premultiply flags
    for ImageBitmap sources, so they are baked at decode time).
  - if `computeDownscale` returns dims: `new OffscreenCanvas(w,h)` → `getContext('2d').drawImage` →
    `createImageBitmap(canvas)`, then `bitmap.close()` on the full-size intermediate.
  - returns `null` on any failure (missing `createImageBitmap` in jsdom, malformed blob) — never throws.
  - Works on both main thread and worker (`OffscreenCanvas` is available in both; the worker cannot use
    `document.createElement('canvas')`, which is why the downscale uses `OffscreenCanvas`).

### NEW `src/workers/texDecode.worker.js` — module worker (mirrors `meshBake.worker.js`)
- `onmessage` receives `{ id, blob, maxDim }`, calls `decodeToBitmap`, posts `{ id, bitmap }` with
  `[bitmap]` in the transfer list (zero-copy), or `{ id, bad: true }` on null/throw.
- Per-job messaging (not batched): the per-frame pump already controls rate, blobs clone cheap, bitmaps
  transfer zero-copy — batching would add complexity for no measured win.

### NEW `src/composables/useTexDecoder.js` — module singleton (mirrors `useMeshBaker.js`)
- `decode(blob) → Promise<ImageBitmap | null>` — assigns a job id, posts to the worker, resolves on the
  correlated reply.
- Lazy worker init: `new Worker(new URL('../workers/texDecode.worker.js', import.meta.url), {type:'module'})`.
- `dead` flag + sync fallback: on construct failure / `onerror` / `onmessageerror`, tear down and resolve
  every pending (and all future) `decode()` via the main-thread `decodeToBitmap` — identical to today's
  behavior where workers are unavailable (CSP, test env).
- `outstanding()` — jobs posted-but-unresolved, for Phase-A backpressure.
- `RECYCLE_AFTER_JOBS` — terminate + respawn at a quiet moment after N jobs, for parity with the
  process-heap-summing concern that drove `useMeshBaker`'s recycle (Chrome's `performance.memory` sums
  all worker isolates; the governor reads it). Lighter here since `ImageBitmap`s are transferred OUT, but
  kept for safety.
- `takeStats()` → `{ jobs, decodeMs }` snapshot+reset for telemetry.
- `dispose()` — terminate, resolve pending to null.

### `useTextureFetch.js` changes
- `buildTexture(blob)` → split: `decodeToBitmap` (now imported from the lib) provides the bitmap;
  `bitmapToTexture(bitmap, uuid)` does the THREE wrap (`new THREE.Texture` + flags). The sync-fallback
  composition (`decodeToBitmap` then `bitmapToTexture`) preserves exactly the old output.
- `_processBuild({uuid, blob, resolve})` → Phase A: `texDecoder.decode(blob)`; on resolve push
  `{uuid, bitmap, resolve}` to a new `uploadQueue` (or resolve null on a null bitmap, deleting
  `texInflight`).
- NEW `_processUpload({uuid, bitmap, resolve})` → Phase B: `bitmapToTexture` + `initTexture` +
  existing bookkeeping + `resolve(tex)`.
- `pumpTextureBuilds()` → within the per-frame budget: (1) dispatch from `buildQueue` to
  `texDecoder.decode` while `texDecoder.outstanding() < DECODE_INFLIGHT_CAP`; (2) drain `uploadQueue` via
  `drainWithinBudget` (the throttled GPU work — the existing `TEX_BUILD_MAX_PER_FRAME` / `TEX_BUILD_BUDGET_MS`
  apply to uploads now, since that is the remaining main-thread cost).
- `getTextureStats()` adds `uploadQueued` (= `uploadQueue.length`) and `decodeOutstanding`.
- `clearTextureCache()` is **not** changed to dispose the decoder. The decoder is a stateless,
  tab-lifetime module singleton that self-recycles its isolate (`RECYCLE_AFTER_JOBS`); disposing it on a
  per-region teardown would set `dead=true` permanently and silently downgrade every later region to
  main-thread decode. `dispose()` exists for symmetry/tests but is not wired into the per-region path.

### `useWorldEngine.js` changes
- None structural: it already calls `pumpTextureBuilds()` once per frame (`:4303`, under
  `timed('texbuild', …)`) and `setTextureRenderer` at init (`:1490`). Optionally add
  `decodeMs`/`decodeOutstanding` to the `[Drain]` telemetry line for live attribution.

## Data flow

```
getBaseTexture(uuid)
  → getBlob(uuid)                 [blobCache | IDB | network — unchanged]
  → buildQueue.push({uuid, blob, resolve})

pumpTextureBuilds()  (once per frame)
  Phase A: while outstanding < CAP and buildQueue not empty:
             job = buildQueue.shift()
             texDecoder.decode(job.blob)            ── postMessage(blob) ──▶ [worker]
                .then(bitmap => bitmap                                         createImageBitmap
                   ? uploadQueue.push({uuid, bitmap, resolve})                 + OffscreenCanvas downscale
                   : (texInflight.delete(uuid), resolve(null)))   ◀── transfer [bitmap] ──
  Phase B: drainWithinBudget(uploadQueue, max=32, budget=4ms):
             new THREE.Texture(bitmap) + flags + initTexture
             + bookkeeping (hasAlpha, cache.set, lastUsed, blobCache.delete)
             + resolve(tex)
```

## Error handling
- Worker can't construct / errors → `dead` flag → `decode()` runs `decodeToBitmap` inline (= today). No
  regression where workers are unavailable.
- `decodeToBitmap` returns null (bad blob, no `createImageBitmap`) → consumer promise resolves null,
  `texInflight` cleared, placeholder kept. Same guarantee as Pass 1's try/catch.
- `dispose()` mid-flight resolves all pending to null — promises never hang (mirrors `useMeshBaker`).
- Backpressure cap bounds resident `ImageBitmap`s so a fill flood can't OOM via decoded-but-not-uploaded
  bitmaps.

## Testing
- `src/__tests__/lib/texDecodeBitmap.test.js` — `computeDownscale`: no-op at/under cap; longest-edge
  scaling (landscape, portrait, square); ≥1 px floor on extreme aspect ratios.
- `src/__tests__/composables/useTexDecoder.test.js` — mirror `useMeshBaker.test.js`: in jsdom the module
  worker can't construct → exercises the sync-fallback path. `decode(blob)` resolves `null` gracefully
  (no `createImageBitmap` in jsdom) and **does not hang**; `dispose()` mid-flight settles pending to null.
- Full suite + `npm run build:staging` green.
- **Live-verify (Gene, heavy/warm region):** `[Main] phases texbuild=…` drops sharply; fps holds while
  textures fill; `idb` avg eases from ~8–15 s as read callbacks stop queueing behind decode; queue drains
  instead of climbing; orientation/alpha of textures unchanged (no flipped/darkened faces).

## Risks / watch items
- `OffscreenCanvas` 2D downscale fidelity vs the old `<canvas>` path — same `drawImage` call, expected
  identical; live-verify orientation + alpha.
- ImageBitmap memory in flight — bounded by `DECODE_INFLIGHT_CAP`; tune if a heavy load shows a bitmap
  pileup in heap.
- Worker recycle interplay with the governor's `performance.memory` reading — mirrors the proven
  `useMeshBaker` recycle; lighter here.
- Focus-gating: the pump still lives downstream of `animate()`'s `!document.hasFocus()` early-return
  (accepted Pass-1 limit, unchanged).
