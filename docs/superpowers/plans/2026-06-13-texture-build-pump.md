# Throttled Texture Build + GPU-Upload Pump — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spread the texture build (decode + downscale) and GPU upload cost across frames via a per-frame budgeted pump, so a heavy-region load no longer bursts the main thread (which starves IDB read callbacks and trips watchdogs — FEATURE-GAPS #11, pass 1 of 2).

**Architecture:** Decouple "blob ready" (cheap) from "texture built + uploaded" (expensive). Blob-ready enqueues a build job; a per-frame budgeted pump drains the queue, building + uploading (`renderer.initTexture`) at a controlled rate, then resolves the promise consumers already await — so the ~5 scattered apply sites are untouched. The scheduling core is a pure, unit-tested helper.

**Tech Stack:** Vanilla JS ES modules; Three.js (`WebGLRenderer.initTexture`, `THREE.Texture`); `bun:test` for the pure helper; the texture path is a module singleton in `useTextureFetch.js`; the engine (`useWorldEngine.js`) owns the renderer and the `animate()` loop.

**Verification note:** `npm run lint` is broken repo-wide — verify via `bun test` + `npm run build:staging`. The DOM/THREE-bound pump can't be unit-tested in `bun` (`createImageBitmap`/canvas/WebGL absent); its scheduling logic is unit-tested via the pure helper, and the integration is verified by build + live console (build backlog draining, rAF max-frame-ms + watchdog trips dropping on a hard reload).

**No protocol / cache-version change** — pure client-side scheduling. No user cache wipe.

---

## File Structure

- `src/lib/budgetedDrain.js` — NEW. Pure, synchronous, frame-budgeted FIFO drain helper. One responsibility: "process up to N items or until a time budget, calling a processOne fn." No DOM/THREE deps → unit-testable.
- `src/composables/useTextureFetch.js` — MODIFY. Add a build queue + `pumpTextureBuilds` + `setTextureRenderer`; defer `buildTexture` out of `getBaseTexture` into the pump; add a `buildQueued` stat.
- `src/composables/useWorldEngine.js` — MODIFY. Inject the renderer, drive `pumpTextureBuilds()` once per frame in `animate()`, surface the build backlog in telemetry.
- `src/__tests__/lib/budgetedDrain.test.js` — NEW. Unit tests for the helper.

---

## Task 1: `budgetedDrain` — pure frame-budgeted FIFO drain

**Files:**
- Create: `src/lib/budgetedDrain.js`
- Test: `src/__tests__/lib/budgetedDrain.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/budgetedDrain.test.js`:

```js
// src/__tests__/lib/budgetedDrain.test.js
import { describe, it, expect } from 'bun:test'
import { drainWithinBudget } from '@/lib/budgetedDrain.js'

const fakeClock = (step = 1) => { let t = 0; return () => { const v = t; t += step; return v } }

describe('drainWithinBudget', () => {
	it('processes up to maxItems then stops, leaving the rest queued', () => {
		const q = [1, 2, 3, 4, 5]
		const seen = []
		const n = drainWithinBudget({ queue: q, maxItems: 2, budgetMs: 1e9, now: () => 0, processOne: (x) => seen.push(x) })
		expect(n).toBe(2)
		expect(seen).toEqual([1, 2])     // FIFO
		expect(q).toEqual([3, 4, 5])     // remainder stays queued
	})

	it('stops when the time budget is exceeded mid-drain (still does at least one)', () => {
		const q = [1, 2, 3, 4, 5]
		const seen = []
		// clock advances 1ms per call; budget 3ms → processes ~3 before the check trips
		const n = drainWithinBudget({ queue: q, maxItems: 100, budgetMs: 3, now: fakeClock(1), processOne: (x) => seen.push(x) })
		expect(n).toBe(3)
		expect(seen).toEqual([1, 2, 3])
	})

	it('always processes at least one item even if already over budget', () => {
		const q = [1, 2]
		const seen = []
		// clock jumps way past budget immediately, but the first item must still run
		const n = drainWithinBudget({ queue: q, maxItems: 100, budgetMs: 1, now: fakeClock(1000), processOne: (x) => seen.push(x) })
		expect(n).toBe(1)
		expect(seen).toEqual([1])
	})

	it('empty queue processes zero, no throw', () => {
		expect(drainWithinBudget({ queue: [], maxItems: 10, budgetMs: 5, now: () => 0, processOne: () => {} })).toBe(0)
	})

	it('a throwing processOne is counted, surfaced via onError, and does not abort the loop', () => {
		const q = [1, 2, 3]
		const seen = [], errs = []
		const n = drainWithinBudget({
			queue: q, maxItems: 10, budgetMs: 1e9, now: () => 0,
			processOne: (x) => { if (x === 2) throw new Error('boom'); seen.push(x) },
			onError: (e, item) => errs.push(item),
		})
		expect(n).toBe(3)            // all three consumed (incl. the thrower)
		expect(seen).toEqual([1, 3]) // 1 and 3 succeeded
		expect(errs).toEqual([2])    // 2 surfaced to onError
		expect(q).toEqual([])        // queue fully drained
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/budgetedDrain.test.js`
Expected: FAIL — module `@/lib/budgetedDrain.js` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/budgetedDrain.js`:

```js
// src/lib/budgetedDrain.js — frame-budgeted FIFO drain. Pure + synchronous so it is unit-testable
// without a DOM/renderer. Used by the texture build pump (useTextureFetch) to spread decode+upload
// cost across frames instead of bursting (FEATURE-GAPS #11). `processOne` MAY start async work; this
// helper only bounds how many items are STARTED per call (a count cap + a wall-clock budget on the
// synchronous portion of the loop). It always processes at least one item so a single already-long
// frame can never stall the queue forever.
//
// `now` is injected (defaults to performance.now) so tests pass a deterministic fake clock.
export function drainWithinBudget({ queue, maxItems = 32, budgetMs = 4, now = () => performance.now(), processOne, onError = null }) {
	if (!queue || !queue.length || typeof processOne !== 'function') return 0
	const start = now()
	let processed = 0
	while (queue.length && processed < maxItems) {
		// Time cap is checked only after the first item, so we always make ≥1 unit of progress.
		if (processed > 0 && now() - start >= budgetMs) break
		const item = queue.shift()
		processed++
		try { processOne(item) } catch (e) { if (onError) onError(e, item) }
	}
	return processed
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/budgetedDrain.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/budgetedDrain.js src/__tests__/lib/budgetedDrain.test.js
git commit -m "feat: budgetedDrain frame-budgeted FIFO helper"
```

---

## Task 2: texture build queue + pump + renderer injection

Defer `buildTexture` out of `getBaseTexture` into a per-frame budgeted pump; upload via `renderer.initTexture`; expose `setTextureRenderer` and a `buildQueued` stat.

**Files:**
- Modify: `src/composables/useTextureFetch.js` (`MAX_INFLIGHT` consts area `:32`, `getBaseTexture` `:265-288`, `getTextureStats` `:178-186`, exports)
- Read first: the file's top imports (confirm `THREE`, `alphaCache`, `blobCache`, `cache`, `lastUsed`, `texInflight`, `getBlob`, `buildTexture` are all module-scope — they are).

- [ ] **Step 1: Add module state + constants**

Near `const MAX_INFLIGHT = 12` (`:32`), add:

```js
// Per-frame texture build/upload pump (FEATURE-GAPS #11). Blob-ready enqueues a build job; the
// engine drains buildQueue once per frame via pumpTextureBuilds(), spreading the decode/downscale/
// upload cost instead of bursting it (which jams the main thread and starves IDB read callbacks).
const TEX_BUILD_MAX_PER_FRAME = 32   // cap builds STARTED per frame (the real throttle)
const TEX_BUILD_BUDGET_MS     = 4    // wall-clock cap on the synchronous dispatch loop
const buildQueue = []                // { uuid, blob, resolve }
let _renderer = null                 // injected by the engine; if null, uploads stay lazy
let _builtN = 0                      // rolling counter (telemetry)
```

- [ ] **Step 2: Add `setTextureRenderer` and import the helper**

At the top of the file, add to the imports (match the existing import style):

```js
import { drainWithinBudget } from '@/lib/budgetedDrain.js'
```

Near the other exported control functions (e.g. just after `export function pumpTextures() { _pump() }` at `:98`), add:

```js
/** Engine injects the THREE renderer so the build pump can upload deterministically (initTexture).
 *  If never set (e.g. tests, pre-init), textures fall back to lazy upload at render() — no hard dep. */
export function setTextureRenderer(r) { _renderer = r }
```

- [ ] **Step 3: Defer the build in `getBaseTexture`**

Replace the body of `getBaseTexture` (`:265-288`) so blob-ready ENQUEUES rather than building inline. The post-build bookkeeping (cache/alpha/lastUsed/blobCache) moves into the pump's `_processBuild`:

```js
function getBaseTexture(uuid) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (cache.has(uuid))       { lastUsed.set(uuid, Date.now()); return Promise.resolve(cache.get(uuid)) }
	if (texInflight.has(uuid)) return texInflight.get(uuid)

	// Blob-ready is cheap; defer the expensive buildTexture+upload to the per-frame budgeted pump.
	const p = getBlob(uuid).then(blob => {
		if (!blob) { texInflight.delete(uuid); return null }
		return new Promise((resolve) => { buildQueue.push({ uuid, blob, resolve }) })
	})

	texInflight.set(uuid, p)
	return p
}
```

- [ ] **Step 4: Add the build processor + pump**

Immediately after `getBaseTexture`, add:

```js
// One build job: decode+downscale (buildTexture), upload now (initTexture, off the render() critical
// path), then run the post-build bookkeeping that getBaseTexture used to do and resolve the awaiting
// promise. Async — the pump dispatches these at a bounded rate; their continuations land as decode
// completes. A failed decode resolves null (consumer keeps its placeholder).
async function _processBuild({ uuid, blob, resolve }) {
	const tex = await buildTexture(blob)
	texInflight.delete(uuid)
	if (tex) {
		try { _renderer?.initTexture(tex) } catch { /* lazy upload at render() remains the fallback */ }
		tex.userData.hasAlpha = alphaCache.get(uuid) || false
		cache.set(uuid, tex)
		lastUsed.set(uuid, Date.now())
		blobCache.delete(uuid)
		_builtN++
	}
	resolve(tex)
}

/** Drain the texture build queue within this frame's budget. Driven once per frame by the engine. */
export function pumpTextureBuilds() {
	return drainWithinBudget({
		queue: buildQueue,
		maxItems: TEX_BUILD_MAX_PER_FRAME,
		budgetMs: TEX_BUILD_BUDGET_MS,
		processOne: _processBuild,
		onError: (e) => console.warn('[Tex] build pump error:', e),
	})
}
```

- [ ] **Step 5: Surface the backlog in stats**

In `getTextureStats` (`:182-185`), add `buildQueued` to the returned object:

```js
		...stats, inflight: active, queued: netQueue.length, buildQueued: buildQueue.length, cached: cache.size, hardFail: failedHard.size, softWait: softAttempts.size,
```

- [ ] **Step 6: Verify the build**

Run: `npm run build:staging`
Expected: success. (Confirm `alphaCache`, `blobCache`, `cache`, `lastUsed`, `texInflight`, `getBlob`, `buildTexture`, `ZERO_UUID` are all in module scope — they were used by the original `getBaseTexture`, so they are. `pumpTextureBuilds`/`setTextureRenderer` are now module-level exports the engine can import.)

- [ ] **Step 7: Commit**

```bash
git add src/composables/useTextureFetch.js
git commit -m "feat: defer texture build to a per-frame budgeted pump"
```

---

## Task 3: engine wiring — inject renderer, drive pump per frame, telemetry

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import `:21`, renderer creation `:1427`, `animate()` before `renderer.render()` `:3864`, the `[Drain]` 5s report line `~:3964`)

- [ ] **Step 1: Import the new texture functions**

Change the texture-fetch import (`:21`) to add the two new exports:

```js
import { getTextureStats, getTextureBytes, pumpTextures, pruneTexturesLRU, pumpTextureBuilds, setTextureRenderer } from './useTextureFetch.js'
```

- [ ] **Step 2: Inject the renderer after creation**

Immediately after `renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })` (`:1427`), add:

```js
		// Give the texture build pump the renderer so it can upload deterministically (initTexture),
		// keeping GPU uploads off the render() critical path (FEATURE-GAPS #11).
		setTextureRenderer(renderer)
```

- [ ] **Step 3: Drive the pump once per frame in `animate()`**

In `animate()`, immediately BEFORE the `try { renderer.render(scene, camera) … }` block (`:3864` — it is preceded by the long `// WHY try/catch + quarantine:` comment), add:

```js
			// Spread texture build+upload across frames (FEATURE-GAPS #11): drain a budgeted slice of
			// the build queue here so freshly-uploaded textures are GPU-resident before render() and
			// the per-frame upload count is bounded (no burst spike).
			pumpTextureBuilds()
```

- [ ] **Step 4: Surface the build backlog in the `[Drain]` telemetry**

Find the 5s report `[Drain]` line (`~:3964`, begins `const dline = \`[Drain] built=...\``). Append the texture build backlog to that line so it shows in the live console. Locate the end of the `dline` template (before its closing backtick) and add ` texBuildQ=${getTextureStats().buildQueued}`. For example, if the line ends with `…hidden=${…}\``, change the tail to:

```js
			` texBuildQ=${getTextureStats().buildQueued}`
```

appended to the existing `dline` expression (read the exact current concatenation and add this segment without disturbing the rest). `getTextureStats()` is already imported and called elsewhere; calling it once per 5s report is negligible.

- [ ] **Step 5: Verify the build**

Run: `npm run build:staging`
Expected: success.

- [ ] **Step 6: Live verification (the real bar)**

Run `npm run dev` + the Bun WS server; hard-reload a heavy region and watch the engine console / debug panel:
- `[Drain]` shows `texBuildQ` draining steadily (a backlog that shrinks), not pinned.
- `[Main]` max frame time no longer spikes to multi-hundred-ms on the texture burst (was up to ~1049 ms).
- Geom `wdog` and `[TexCache] get watchdog … miss` trip counts drop sharply vs the ~271 / ~1700 baseline.
- Textures still appear (no permanently-bare regression); flying around (already fast) is not regressed.

(Use the claude-in-chrome MCP `read_console_messages` on the localhost tab to read the `console.warn`/`console.debug` lines — note `[Main]`/`[Drain]`/`[Mem]` go to the in-app debug panel, not the browser console.)

- [ ] **Step 7: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat: drive per-frame texture build pump + inject renderer"
```

---

## Self-Review

**Spec coverage:**
- Budgeted scheduler (pure, unit-testable) → Task 1 (`budgetedDrain` + 5 tests). ✓
- Build queue + pump in useTextureFetch, consumers unchanged → Task 2 (enqueue in `getBaseTexture`, `_processBuild` does the former post-build bookkeeping, `pumpTextureBuilds`). ✓
- Renderer injection with graceful fallback → Task 2 (`setTextureRenderer`, `_renderer?.initTexture` in try/catch, null → lazy upload). ✓
- Drive per-frame before render → Task 3 Step 3. ✓
- Telemetry (build backlog) → Task 2 Step 5 (`buildQueued` stat) + Task 3 Step 4 (`texBuildQ` in `[Drain]`). ✓
- Error handling (decode null, initTexture throw, processOne throw, backpressure unchanged) → Task 1 (onError) + Task 2 (`_processBuild` try/catch, null resolve). ✓
- Out of scope (b64ToBlob, decode worker, xform clones) → not touched. ✓

**Placeholder scan:** No TBD/TODO. Task 3 Step 4 (telemetry append) is the only soft locator — it depends on the exact current `dline` concatenation, so it instructs reading the line and appending one segment; concrete anchor (`[Drain] built=`) given, non-critical line, bounded.

**Type/name consistency:** `drainWithinBudget({queue,maxItems,budgetMs,now,processOne,onError})`, `setTextureRenderer`, `pumpTextureBuilds`, `_processBuild`, `buildQueue`, `_renderer`, `TEX_BUILD_MAX_PER_FRAME`, `TEX_BUILD_BUDGET_MS`, `buildQueued` (stat) / `texBuildQ` (log label) — used consistently across tasks. `pumpTextureBuilds`/`setTextureRenderer` exported from useTextureFetch (Task 2) and imported in the engine (Task 3). The pump reuses the same `alphaCache`/`blobCache`/`cache`/`lastUsed`/`texInflight` the original `getBaseTexture` used.
