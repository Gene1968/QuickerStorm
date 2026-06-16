# Off-main-thread Texture Decode (FEATURE-GAPS #11 Pass 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WebP texture decode (`createImageBitmap` + downscale) off the main thread into a module worker, keeping the throttled GPU upload (`initTexture`) on the main thread, so fps holds while textures fill and starved IDB read callbacks complete.

**Architecture:** A pure `Blob → ImageBitmap` decode primitive (`texDecodeBitmap.js`) is run inside a module worker (`texDecode.worker.js`) via a `useMeshBaker`-style composable (`useTexDecoder.js`) with a main-thread sync fallback. `useTextureFetch.js`'s per-frame pump becomes two-phase: dispatch blobs to the worker (bounded), then drain returned bitmaps to the GPU (throttled). No cache-version bump.

**Tech Stack:** Vite module workers (`new Worker(new URL(...), {type:'module'})`), Three.js (`THREE.Texture`, `renderer.initTexture`), `OffscreenCanvas`, Vitest + jsdom, existing `src/lib/budgetedDrain.js`.

**Reference:** spec `docs/superpowers/specs/2026-06-16-texture-decode-worker-design.md`. Mirror patterns from `src/composables/useMeshBaker.js` + `src/workers/meshBake.worker.js`.

**Code style reminder:** this repo uses **tabs**, not spaces (`.editorconfig`). All code blocks below use tabs.

---

## File Structure

- **Create** `src/lib/texDecodeBitmap.js` — pure decode primitive: `computeDownscale` (math) + `decodeToBitmap` (createImageBitmap + OffscreenCanvas downscale). No THREE dep. Runs in worker AND main thread.
- **Create** `src/workers/texDecode.worker.js` — module worker; `{id,blob,maxDim}` → `decodeToBitmap` → transfer `{id,bitmap}` back.
- **Create** `src/composables/useTexDecoder.js` — worker dispatcher + sync fallback (mirrors `useMeshBaker.js`).
- **Modify** `src/composables/useTextureFetch.js` — replace `buildTexture`/`_processBuild` with the two-phase pump (`bitmapToTexture`, `_dispatchDecodes`, `_processUpload`, `uploadQueue`); extend `getTextureStats`.
- **Modify** `src/composables/useWorldEngine.js:4583` — add `texUpQ` / `texDec` to the `[Drain]` telemetry line.
- **Create** `src/__tests__/lib/texDecodeBitmap.test.js` — `computeDownscale` unit tests.
- **Create** `src/__tests__/composables/useTexDecoder.test.js` — fallback/dispose tests (mirror `useMeshBaker.test.js`).

---

## Task 1: Decode primitive — `texDecodeBitmap.js`

**Files:**
- Create: `src/lib/texDecodeBitmap.js`
- Test: `src/__tests__/lib/texDecodeBitmap.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/texDecodeBitmap.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { computeDownscale } from '@/lib/texDecodeBitmap.js'

describe('computeDownscale', () => {
	it('returns null when the image already fits within maxDim', () => {
		expect(computeDownscale(256, 256, 256)).toBeNull()
		expect(computeDownscale(128, 64, 256)).toBeNull()
	})
	it('scales the longest edge (landscape) down to maxDim', () => {
		expect(computeDownscale(1024, 512, 256)).toEqual({ w: 256, h: 128 })
	})
	it('scales the longest edge (portrait) down to maxDim', () => {
		expect(computeDownscale(512, 1024, 256)).toEqual({ w: 128, h: 256 })
	})
	it('scales a square to maxDim x maxDim', () => {
		expect(computeDownscale(1024, 1024, 256)).toEqual({ w: 256, h: 256 })
	})
	it('floors the short edge at 1px for extreme aspect ratios', () => {
		expect(computeDownscale(4096, 4, 256)).toEqual({ w: 256, h: 1 })
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/texDecodeBitmap.test.js`
Expected: FAIL — cannot resolve `@/lib/texDecodeBitmap.js` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/lib/texDecodeBitmap.js`:

```js
// src/lib/texDecodeBitmap.js — decode an image Blob (WebP from our pipeline) into a downscaled
// ImageBitmap, with NO THREE dependency so it can run inside texDecode.worker.js OR inline on the main
// thread as a fallback. FEATURE-GAPS #11 Pass 2: moves createImageBitmap + downscale off the main thread.

// Pure: the resident-texture dimension cap. Returns the scaled {w,h} (longest edge = maxDim, each axis
// floored at 1px), or null when the image already fits (no downscale). Mirrors useTextureFetch MAX_TEX_DIM.
export function computeDownscale(w, h, maxDim) {
	const longest = Math.max(w, h)
	if (longest <= maxDim) return null
	const s = maxDim / longest
	return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

// Decode `blob` to an ImageBitmap whose longest edge is ≤ maxDim. Pre-flips Y and pins straight alpha at
// decode time: WebGL ignores texture.flipY (UNPACK_FLIP_Y) and texture.premultiplyAlpha for ImageBitmap
// sources, so both must be baked here to match the old <img> path. Returns null on ANY failure (no
// createImageBitmap in jsdom, malformed blob, no 2D context) — never throws. Uses OffscreenCanvas because
// it works on the main thread AND in a worker (document.createElement('canvas') does not exist in a worker).
export async function decodeToBitmap(blob, maxDim) {
	if (typeof createImageBitmap !== 'function') return null
	let bitmap
	try {
		bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })
	} catch { return null }
	const ds = computeDownscale(bitmap.width, bitmap.height, maxDim)
	if (!ds) return bitmap
	try {
		const canvas = new OffscreenCanvas(ds.w, ds.h)
		const ctx = canvas.getContext('2d')
		if (!ctx) return bitmap                 // no 2D context: keep the full-size bitmap (correct, larger)
		ctx.drawImage(bitmap, 0, 0, ds.w, ds.h)
		const scaled = await createImageBitmap(canvas)
		bitmap.close?.()                        // free the full-size intermediate
		return scaled
	} catch {
		return bitmap                           // downscale failed: use full-size bitmap
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/texDecodeBitmap.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/texDecodeBitmap.js src/__tests__/lib/texDecodeBitmap.test.js
git commit -m "feat(tex): add Blob→ImageBitmap decode primitive"
```

---

## Task 2: Decode worker — `texDecode.worker.js`

**Files:**
- Create: `src/workers/texDecode.worker.js`

(No direct unit test — module workers can't be constructed in jsdom; its logic is the `decodeToBitmap`
primitive tested in Task 1, and the dispatch/fallback contract is tested in Task 3. This mirrors
`meshBake.worker.js`, which is likewise untested directly.)

- [ ] **Step 1: Write the worker**

Create `src/workers/texDecode.worker.js`:

```js
// Module worker: decodes an image Blob into a downscaled ImageBitmap off the main thread.
// Receives { id, blob, maxDim }. Replies { id, bitmap } with the bitmap TRANSFERRED (zero-copy),
// or { id, bad: true } when decode yields null/throws. FEATURE-GAPS #11 Pass 2 — mirrors meshBake.worker.js.
import { decodeToBitmap } from '@/lib/texDecodeBitmap.js'

self.onmessage = async (e) => {
	const { id, blob, maxDim } = e.data
	let bitmap = null
	try { bitmap = await decodeToBitmap(blob, maxDim) } catch { bitmap = null }
	if (bitmap) self.postMessage({ id, bitmap }, [bitmap])
	else self.postMessage({ id, bad: true })
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build:staging`
Expected: build succeeds (Vite bundles the new worker chunk; the `@/` alias resolves in workers, same as `meshBake.worker.js`).

- [ ] **Step 3: Commit**

```bash
git add src/workers/texDecode.worker.js
git commit -m "feat(tex): add texDecode module worker"
```

---

## Task 3: Worker dispatcher — `useTexDecoder.js`

**Files:**
- Create: `src/composables/useTexDecoder.js`
- Test: `src/__tests__/composables/useTexDecoder.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/composables/useTexDecoder.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { useTexDecoder } from '@/composables/useTexDecoder.js'

// jsdom: constructing a module Worker from a file URL throws → exercises the sync fallback. jsdom also
// has no createImageBitmap, so the fallback decodeToBitmap resolves null. The contract under test is
// "degrades to null WITHOUT hanging", which is exactly the worker-unavailable path real browsers never hit.
describe('useTexDecoder (fallback)', () => {
	let dec
	beforeEach(() => { dec = useTexDecoder() })

	it('resolves null (does not hang) when the worker is unavailable and decode cannot run', async () => {
		const out = await dec.decode(new Blob(['x']), 256)
		expect(out).toBeNull()
		dec.dispose()
	})

	it('settles the decode promise when dispose() is called mid-flight (no hang)', async () => {
		const p = dec.decode(new Blob(['x']), 256)
		dec.dispose()
		const out = await p
		expect(out).toBeNull()
	})

	it('reports outstanding() as 0 after a fallback decode resolves', async () => {
		await dec.decode(new Blob(['x']), 256)
		expect(dec.outstanding()).toBe(0)
	})

	it('takeStats() returns a job count and resets it', async () => {
		await dec.decode(new Blob(['x']), 256)
		const s = dec.takeStats()
		expect(s.jobs).toBe(1)
		expect(dec.takeStats().jobs).toBe(0)
		dec.dispose()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/useTexDecoder.test.js`
Expected: FAIL — cannot resolve `@/composables/useTexDecoder.js`.

- [ ] **Step 3: Write the implementation**

Create `src/composables/useTexDecoder.js`:

```js
import { decodeToBitmap } from '@/lib/texDecodeBitmap.js'

// Dispatches Blob→ImageBitmap decode to a module worker (off the main thread), falling back to
// synchronous main-thread decode when the worker can't be constructed (no module-worker support, CSP,
// test env) or errors out. FEATURE-GAPS #11 Pass 2 — mirrors useMeshBaker.
//
//   decode(blob, maxDim) → Promise<ImageBitmap | null>
export function useTexDecoder() {
	let worker = null
	let dead = false
	let nextId = 1
	const pending = new Map()              // id → { resolve, blob, maxDim }
	const stats = { jobs: 0, decodeMs: 0 } // snapshot+reset by takeStats (5s telemetry)
	// WHY recycle (parity with useMeshBaker): Chrome's performance.memory — the memory governor's signal —
	// sums ALL worker isolates in the process, and an idle worker never GCs its own intermediates.
	// Terminating frees the isolate instantly; the worker is stateless so respawn is just module re-init.
	// Lighter need here (ImageBitmaps are transferred OUT, not retained) but kept as a safety valve.
	const RECYCLE_AFTER_JOBS = 2000
	let jobsSinceSpawn = 0

	function initWorker() {
		if (worker || dead) return
		try {
			worker = new Worker(new URL('../workers/texDecode.worker.js', import.meta.url), { type: 'module' })
			worker.onmessage = (e) => {
				const { id, bitmap } = e.data
				const p = pending.get(id)
				if (p) { pending.delete(id); p.resolve(bitmap || null) }
				jobsSinceSpawn++
				if (jobsSinceSpawn >= RECYCLE_AFTER_JOBS && pending.size === 0) {
					jobsSinceSpawn = 0
					try { worker.terminate() } catch { /* ignore */ }
					worker = null              // initWorker() respawns on next decode; `dead` stays false
				}
			}
			worker.onerror = (e) => { console.warn('[texDecoder] worker error → sync fallback', e?.message || e); killWorker() }
			worker.onmessageerror = (e) => { console.warn('[texDecoder] worker message error → sync fallback', e); killWorker() }
		} catch {
			dead = true
			worker = null
		}
	}

	// Worker failed: tear it down and resolve everything still pending via the main-thread fallback.
	function killWorker() {
		dead = true
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		for (const [, p] of pending) p.resolve(decodeToBitmap(p.blob, p.maxDim))
		pending.clear()
	}

	function decode(blob, maxDim) {
		const t0 = performance.now()
		stats.jobs++
		initWorker()
		// No worker (won't build / killed) → decode inline on the main thread (= pre-Pass-2 behavior).
		if (dead || !worker) {
			return Promise.resolve(decodeToBitmap(blob, maxDim)).then(b => { stats.decodeMs += performance.now() - t0; return b })
		}
		const id = nextId++
		return new Promise((resolve) => {
			pending.set(id, { resolve, blob, maxDim })
			// WHY try/catch: a non-cloneable payload throws DataCloneError synchronously here; without
			// this the promise would hang forever (texture stuck white). Fall back to sync decode.
			try {
				worker.postMessage({ id, blob, maxDim })
			} catch (err) {
				console.warn('[texDecoder] postMessage failed → sync fallback', err?.message || err)
				pending.delete(id)
				resolve(decodeToBitmap(blob, maxDim))
			}
		}).then(b => { stats.decodeMs += performance.now() - t0; return b })
	}

	// Backpressure signal: decodes posted but not yet returned. The pump throttles dispatch on this so
	// decoded ImageBitmaps (resident RGBA) can't outpace the upload drain.
	function outstanding() { return pending.size }

	// Snapshot + reset the throughput counters (5s telemetry cadence).
	function takeStats() {
		const s = { ...stats }
		stats.jobs = 0; stats.decodeMs = 0
		return s
	}

	function dispose() {
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		dead = true
		for (const [, p] of pending) p.resolve(null)
		pending.clear()
	}

	return { decode, dispose, outstanding, takeStats }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/useTexDecoder.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useTexDecoder.js src/__tests__/composables/useTexDecoder.test.js
git commit -m "feat(tex): add useTexDecoder worker dispatcher"
```

---

## Task 4: Two-phase pump in `useTextureFetch.js`

**Files:**
- Modify: `src/composables/useTextureFetch.js` (imports; `buildQueue` comment; replace `buildTexture` `:268-288`; replace `_processBuild`/`pumpTextureBuilds` `:306-336`; `getTextureStats` `:201-209`)

No new unit test in this task — correctness of the pieces is covered by Tasks 1 & 3; this task is integration wiring verified by the full suite + build (Step 6) and Gene's live-verify. (Existing `textureCache.test.js` etc. must stay green.)

- [ ] **Step 1: Add the import**

In `src/composables/useTextureFetch.js`, after the existing import block (the line `import { drainWithinBudget } from '@/lib/budgetedDrain.js'`, currently line 12), add:

```js
import { useTexDecoder } from './useTexDecoder.js'
```

- [ ] **Step 2: Replace the build-pump constants block with the two-phase declarations**

Replace the whole build-pump comment + constants block (currently lines 41-47: the comment starting
`// Per-frame texture build/upload pump (FEATURE-GAPS #11).` through `let _renderer = null`) with the
following single block. This re-declares the existing constants (so nothing is duplicated) and adds the
new decoder instance, upload queue, and backpressure cap together:

```js
// Per-frame texture pipeline (FEATURE-GAPS #11). Two phases, both driven once per frame by
// pumpTextureBuilds(): (A) dispatch blob-ready jobs to the decode worker (off-thread, bounded by
// DECODE_INFLIGHT_CAP); (B) drain decoded ImageBitmaps to the GPU (initTexture) within a frame budget.
// Splitting decode from upload keeps createImageBitmap/downscale off the main thread while the upload
// (which must stay main-thread) is still throttled, so the texture burst no longer jams the main thread
// or starves IDB read callbacks.
const TEX_BUILD_MAX_PER_FRAME = 32   // cap UPLOADS started per frame (the main-thread throttle)
const TEX_BUILD_BUDGET_MS     = 4    // wall-clock cap on the synchronous upload-dispatch loop
const buildQueue = []                // { uuid, blob, resolve }  — awaiting decode dispatch
let _renderer = null                 // injected by the engine; if null, uploads stay lazy
// Decode (createImageBitmap + downscale) runs OFF the main thread in this worker; only the GPU upload
// (initTexture) stays here. uploadQueue holds decoded ImageBitmaps awaiting that throttled upload.
const texDecoder = useTexDecoder()
const uploadQueue = []               // { uuid, bitmap, resolve }
// Bound resident decoded ImageBitmaps so a fill flood can't pile them up faster than upload drains.
// ~0.25 MB each at 256² → 64 ≈ a 16 MB ceiling of decoded-but-not-uploaded bitmaps.
const DECODE_INFLIGHT_CAP = 64
```

- [ ] **Step 3: Replace `buildTexture` with `bitmapToTexture`**

Replace the entire `buildTexture` function (currently `:258-288`, the comment block starting
`// Client-side resident-texture dimension cap.` through the end of `async function buildTexture`) with the
following. Keep the `const MAX_TEX_DIM = 256` declaration — it is now passed to the decoder:

```js
// Client-side resident-texture dimension cap. WHY: a dense region holds thousands of THREE.Textures;
// each retains its decoded image at the source size (~1 MB at 512²). Downscaling the resident image to
// ≤256² quarters that (~0.9 GB for 3.4k textures) so the whole region fits Chrome's ~4 GB tab heap.
// The downscale itself now happens in the decode worker (decodeToBitmap); MAX_TEX_DIM is passed to it.
const MAX_TEX_DIM = 256

// Wrap a decoded ImageBitmap (already flipped + straight-alpha + downscaled by decodeToBitmap) in a
// THREE.Texture. No GPU upload here — _processUpload calls initTexture. WHY flipY=false: the Y-flip was
// baked at decode time (WebGL ignores UNPACK_FLIP_Y for ImageBitmap sources), so Three's flip is
// disabled to keep UVs matching the previous <img> path; straight alpha was likewise pinned at decode.
function bitmapToTexture(bitmap) {
	const tex = new THREE.Texture(bitmap)
	tex.flipY = false
	tex.colorSpace = THREE.SRGBColorSpace
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.needsUpdate = true
	return tex
}
```

- [ ] **Step 4: Replace `_processBuild` + `pumpTextureBuilds` with the two-phase pump**

Replace the block from the comment `// One build job: decode+downscale (buildTexture)...` through the end
of `export function pumpTextureBuilds()` (currently `:306-336`) with:

```js
// Phase A: dispatch blob-ready jobs to the decode worker (off the main thread). Bounded by
// DECODE_INFLIGHT_CAP so decoded ImageBitmaps can't outpace the upload drain. Posting a Blob to a worker
// is cheap (structured clone shares the backing store by reference — no byte copy). A null bitmap
// (decode failed / dead UUID) clears texInflight and resolves the consumer's promise with null so it
// keeps its placeholder — same guarantee as the old _processBuild try/catch.
function _dispatchDecodes() {
	while (buildQueue.length && texDecoder.outstanding() < DECODE_INFLIGHT_CAP) {
		const { uuid, blob, resolve } = buildQueue.shift()
		texDecoder.decode(blob, MAX_TEX_DIM).then((bitmap) => {
			if (!bitmap) { texInflight.delete(uuid); resolve(null); return }
			uploadQueue.push({ uuid, bitmap, resolve })
		})
	}
}

// Phase B (one upload job): wrap the decoded bitmap in a THREE.Texture, upload now (initTexture, off the
// render() critical path), run the post-build bookkeeping getBaseTexture used to do, resolve. Synchronous
// so drainWithinBudget actually bounds this main-thread GPU cost.
function _processUpload({ uuid, bitmap, resolve }) {
	const tex = bitmapToTexture(bitmap)
	texInflight.delete(uuid)
	try { _renderer?.initTexture(tex) } catch { /* lazy upload at render() remains the fallback */ }
	tex.userData.hasAlpha = alphaCache.get(uuid) || false
	cache.set(uuid, tex)
	lastUsed.set(uuid, Date.now())
	// Free the in-memory Blob mirror now the GPU texture exists — thousands of resident Blobs would be
	// their own heap hog. Previews re-read IndexedDB on demand via getTextureUrl.
	blobCache.delete(uuid)
	resolve(tex)
}

/** Drive the texture pipeline once per frame (called by the engine in animate()): dispatch decodes
 *  off-thread (bounded), then drain completed decodes to the GPU within this frame's budget. */
export function pumpTextureBuilds() {
	_dispatchDecodes()
	return drainWithinBudget({
		queue: uploadQueue,
		maxItems: TEX_BUILD_MAX_PER_FRAME,
		budgetMs: TEX_BUILD_BUDGET_MS,
		processOne: _processUpload,
		onError: (e) => console.warn('[Tex] upload pump error:', e),
	})
}
```

- [ ] **Step 5: Extend `getTextureStats`**

In `getTextureStats` (currently `:201-209`), in the returned object replace the existing
`buildQueued: buildQueue.length,` entry with:

```js
		buildQueued: buildQueue.length, uploadQueued: uploadQueue.length, decodeOutstanding: texDecoder.outstanding(),
```

(Leave the rest of the returned object — `inflight`, `queued`, `cached`, `hardFail`, `softWait`, `timing` — unchanged.)

- [ ] **Step 6: Run the full suite + build to verify no regression**

Run: `npx vitest run`
Expected: PASS — same baseline as before plus the new Task 1 & 3 tests; no new failures.

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useTextureFetch.js
git commit -m "feat(tex): off-thread decode via two-phase pump"
```

---

## Task 5: Telemetry — surface decode/upload queues on `[Drain]`

**Files:**
- Modify: `src/composables/useWorldEngine.js:4583`

- [ ] **Step 1: Add the new fields to the `[Drain]` line**

In `src/composables/useWorldEngine.js`, line 4583 currently ends with:

```js
				` | ticks=${_dtTicks} empty=${_dtEmpty} gov=${_dtGov} brkCap=${_dtBrkCap} brkBudget=${_dtBrkBudget} texBuildQ=${getTextureStats().buildQueued}`
```

Replace it with (single `getTextureStats()` call into a local so the three reads are consistent):

```js
				` | ticks=${_dtTicks} empty=${_dtEmpty} gov=${_dtGov} brkCap=${_dtBrkCap} brkBudget=${_dtBrkBudget}` +
				(() => { const _ts = getTextureStats(); return ` texBuildQ=${_ts.buildQueued} texUpQ=${_ts.uploadQueued} texDec=${_ts.decodeOutstanding}` })()
```

- [ ] **Step 2: Verify build**

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "chore(tex): log decode/upload queue depths"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: all green; new tests (`texDecodeBitmap`, `useTexDecoder`) included; no new failures vs baseline.

- [ ] **Step 2: Production build**

Run: `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 3: Live-verify handoff (Gene)**

On a heavy/warm region (e.g. NW Welcome), hard reload and watch the console:
- `[Main] phases … texbuild=…` should drop sharply (decode left the main thread; only dispatch + upload remain).
- fps holds while textures fill (no ~8 fps decode peg).
- `[Drain] … idb avg` eases from ~8–15 s as read callbacks stop queueing behind decode.
- `texUpQ` / `texDec` stay bounded (DECODE_INFLIGHT_CAP holds; uploads drain).
- Texture orientation + alpha unchanged (no upside-down or darkened-cutout faces).

---

## Notes for the implementer
- **Tabs, not spaces** — match the file you're editing.
- Do **not** wire `texDecoder.dispose()` into `clearTextureCache()` — it would permanently kill the singleton worker and downgrade later regions to main-thread decode. The worker is tab-lifetime + self-recycling.
- Do **not** bump `GEOM_VERSION` or any cache version — this changes the decode path, not stored bytes.
- The `MAX_INFLIGHT` network gate, `getBlob`/`getBaseTexture` cache layering, `_pump`/`pumpTextures`, `pruneTexturesLRU`, `refreshTextures`, and `getTexture` UV-transform path are all unchanged.
