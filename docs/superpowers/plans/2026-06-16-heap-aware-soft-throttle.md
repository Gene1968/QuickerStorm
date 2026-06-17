# Heap-aware Soft Throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the heavy-cold-load churn by pausing mesh build, prim ingest, and texture intake when the JS heap rides high (0.85–0.95 band) — closing the gap below the existing 0.95 hard brake — corroborated by resident scene size so a hard-reload's inherited garbage can't blank the region.

**Architecture:** Add one hysteretic soft-heap signal `heapThrottled()` to `memGovernor.js`, fed a resident-mesh count the engine already has (`meshMap.size`) via `setResidentCount()`. Fold it into `memUnderPressure()` (which the build drain already gates on) and add it to the texture pump and the ingest pump. The 0.95 `emergencyHeap()` brake is untouched as the final backstop.

**Tech Stack:** Vanilla JS ES modules, Vue 3 composables, Three.js, bun test (Vitest-compatible API).

---

## Context the engineer needs

- **Governor lives in** `src/lib/memGovernor.js` — pure module, no Vue. `memRatio()` returns
  `usedJSHeapSize / jsHeapSizeLimit` (Chrome-only; **null** elsewhere, including in bun test unless
  `performance.memory` is stubbed). `appRatio()` is self-accounted resident bytes / budget — it does
  **not** see transient heap (write buffer, bake/decode garbage), which is why heap can hit 0.89 while
  appRatio reads 0.35.
- **Why a soft brake at all:** `memUnderPressure()` (gates the build drain at
  `useWorldEngine.js:3680`) and the texture pump (`useTextureFetch.js:120`) only engage at
  `memRatio>0.95` or `0.92 + appRatio>0.5`. The captured churn (heap 0.89 / app 0.35) slips under both
  → nothing throttles → bake/decode garbage outpaces GC → heap pins, buildQ runs away.
- **Why resident-count corroboration (not appRatio):** a hard-reloaded page can inherit the previous
  page's ~90% uncollected heap. Throttling on raw `memRatio>0.85` would refuse to build the first
  frame → blank region. We corroborate with `meshMap.size > 500` instead — a blank startup has
  `meshMap≈0`; the churn had `meshMap=17471`. (`appRatio>0.5` was the old corroboration and it's
  exactly what failed.)
- **Test runner:** `bun test` (the repo uses bun; `npm run dev:server` etc. are bun). The existing
  governor test is `src/__tests__/lib/memGovernor.test.js` and stubs heap via
  `globalThis.performance.memory = { usedJSHeapSize, jsHeapSizeLimit }`. Follow that exactly.
- **ESLint is broken repo-wide** (flat-config issue) — do NOT rely on `npm run lint`. Verify via
  `bun test` + `npm run build:prod`.
- **Do NOT bump any cache version** (no GEOM_VERSION / DB_VERSION change — this touches no persisted
  format).

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/memGovernor.js` | the pressure signals | ADD `setResidentCount`, `heapThrottled`, 3 constants; fold `heapThrottled()` into `memUnderPressure()` |
| `src/__tests__/lib/memGovernor.test.js` | governor unit tests | ADD a `soft-heap brake` describe; reset resident count in `beforeEach` |
| `src/composables/useWorldEngine.js` | engine: cull tick + ingest pump | ADD `setResidentCount(meshMap.size)` in `cullTick`; gate `pumpIngest()` on `memUnderPressure()`; import update |
| `src/composables/useTextureFetch.js` | texture fetch pump | import `heapThrottled`; add to the pump while-condition |

---

### Task 1: Soft-heap brake in the governor (TDD)

**Files:**
- Modify: `src/lib/memGovernor.js`
- Test: `src/__tests__/lib/memGovernor.test.js`

- [ ] **Step 1: Add `setResidentCount(0)` to the test's `beforeEach`**

In `src/__tests__/lib/memGovernor.test.js`, update the import (line 2-5) to include the new symbols
and update the top-level `beforeEach` (line 10) so the hysteresis latch can't leak between tests:

```js
import { describe, it, expect, beforeEach } from 'bun:test'
import {
	setAppBytes, appRatio, appBudgetBytes, memUnderPressure, memRatio, emergencyHeap,
	APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO, setAppBudgetOverride,
	setResidentCount, heapThrottled, SOFT_HEAP_ON, SOFT_HEAP_OFF, MIN_RESIDENT,
} from '@/lib/memGovernor.js'

// bun test has no performance.memory → memRatio() is null, budget falls back to the fixed default.
// That makes the self-accounted path (the part that matters cross-browser) fully testable here.

beforeEach(() => { setAppBytes(0); setResidentCount(0) })
```

- [ ] **Step 2: Write the failing `soft-heap brake` describe block**

Append this describe block to the end of `src/__tests__/lib/memGovernor.test.js`:

```js
// FEATURE-GAPS #11 churn: a heavy cold load rides heap ~0.85–0.95 while appRatio stays ~0.35 (the
// real heap is write buffer + bake/decode garbage, not in _appBytes). Below the 0.95 hard brake and
// below the 0.92+appRatio>0.5 corroboration, NOTHING throttled → buildQ ran away, scene churned.
// The soft brake closes that band, corroborated by a real resident scene (meshMap.size) so a
// hard-reload inheriting ~90% garbage heap with no scene can't be blanked.
describe('soft-heap brake (heavy-cold-load churn)', () => {
	const MB = 1048576
	const setHeap = (usedMB, limitMB) => { globalThis.performance.memory = { usedJSHeapSize: usedMB * MB, jsHeapSizeLimit: limitMB * MB } }
	const clearHeap = () => { try { delete globalThis.performance.memory } catch { globalThis.performance.memory = undefined } }

	it('exports a sane hysteresis band and resident floor', () => {
		expect(SOFT_HEAP_ON).toBeGreaterThan(SOFT_HEAP_OFF)
		expect(SOFT_HEAP_ON).toBeLessThan(0.95)        // below the hard brake
		expect(MIN_RESIDENT).toBeGreaterThan(0)
	})

	it('fires on the churn signature (heap 0.88, real scene) even though appRatio < 0.5', () => {
		setHeap(3690, 4192)              // ratio ~0.88 — in the soft band, below 0.95
		setAppBytes(100 * MB)            // appRatio ~0.065 — the unaccounted-heap signature
		setResidentCount(17471)          // a genuinely large resident scene
		try {
			expect(memRatio()).toBeGreaterThan(SOFT_HEAP_ON)
			expect(appRatio()).toBeLessThan(0.5)
			expect(heapThrottled()).toBe(true)
			expect(memUnderPressure()).toBe(true)
		} finally { clearHeap() }
	})

	it('does NOT fire with no resident scene (hard-reload inherited-garbage blank-startup guard)', () => {
		setHeap(3690, 4192)              // ratio ~0.88 — same high heap...
		setResidentCount(0)              // ...but no scene yet → must still build (no blank region)
		try { expect(heapThrottled()).toBe(false) } finally { clearHeap() }
	})

	it('hysteresis: engages above ON, stays engaged mid-band, releases below OFF', () => {
		setResidentCount(17471)
		try {
			setHeap(3610, 4192)          // ~0.861 > 0.85 ON → engage
			expect(heapThrottled()).toBe(true)
			setHeap(3360, 4192)          // ~0.801 between OFF and ON → stay engaged (latched)
			expect(heapThrottled()).toBe(true)
			setHeap(3220, 4192)          // ~0.768 < 0.78 OFF → release
			expect(heapThrottled()).toBe(false)
		} finally { clearHeap() }
	})

	it('never fires without a measurable heap (non-Chrome safety), regardless of resident count', () => {
		clearHeap()
		setResidentCount(50000)
		expect(memRatio()).toBeNull()
		expect(heapThrottled()).toBe(false)
	})
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/memGovernor.test.js`
Expected: FAIL — `heapThrottled`, `setResidentCount`, `SOFT_HEAP_ON`, `SOFT_HEAP_OFF`, `MIN_RESIDENT`
are not exported (import errors / undefined).

- [ ] **Step 4: Implement the soft brake in `memGovernor.js`**

In `src/lib/memGovernor.js`, after the `CRITICAL_HEAP_RATIO` constant (line 28) add the band constants:

```js
// Soft-heap brake (FEATURE-GAPS #11 churn): a heavy COLD load rides heap in this band while appRatio
// stays low (the real heap is the write buffer + bake/decode garbage, none of it in _appBytes). The
// 0.95 hard brake + 0.92/appRatio>0.5 corroboration both slip under heap 0.89/app 0.35 → nothing
// throttled → buildQ ran away + the scene churned. This brake pauses intake in the band so GC reclaims
// the transient garbage before heap reaches the hard brake. Corroborated by a real resident scene
// (meshMap.size > MIN_RESIDENT) NOT appRatio: a hard-reloaded page inherits the prior page's ~90%
// uncollected heap, so throttling on raw memRatio would refuse the first build → blank region; but an
// inherited-garbage startup holds no scene (meshMap≈0), while the churn held meshMap=17471.
const SOFT_HEAP_ON  = 0.85   // engage the soft brake above this heap ratio (with resident corroboration)
const SOFT_HEAP_OFF = 0.78   // release below this (hysteresis — let GC reclaim before resuming intake)
const MIN_RESIDENT  = 500    // require a real resident scene to corroborate (blank-startup guard)
```

Then add the resident-count state next to `_appBytes` (line 30-31):

```js
let _appBytes = 0
let _residentCount = 0   // engine pushes meshMap.size (cull tick); corroborates the soft-heap brake
let _softBrakeOn = false // hysteresis latch for heapThrottled()
let _appBudgetOverride = 0   // 0 = auto (heap-scaled default); >0 = user override (clamped). See setAppBudgetOverride.
```

Add the `setResidentCount` setter next to `setAppBytes` (after line 68):

```js
/** Engine pushes its live resident mesh count (meshMap.size) here; corroborates the soft-heap brake. */
export function setResidentCount(n) {
	_residentCount = Number.isFinite(n) && n > 0 ? n : 0
}
```

Add `heapThrottled()` just above `memUnderPressure()` (before line 104):

```js
// Soft-heap brake: pause intake while the process heap rides in the 0.85–0.95 band AND we genuinely
// hold a resident scene (so a hard-reload's inherited garbage — heap high, no scene — can't blank the
// region). Hysteresis (engage > ON, release < OFF) prevents per-tick chatter as a single bake nudges
// heap across the line. Returns false when heap is unmeasurable (non-Chrome) — same safety as
// emergencyHeap. The 0.95 emergencyHeap brake remains the unconditional backstop above this band.
export function heapThrottled() {
	const r = memRatio()
	if (r == null) { _softBrakeOn = false; return false }
	if (_residentCount <= MIN_RESIDENT) { _softBrakeOn = false; return false }
	if (_softBrakeOn) {
		if (r < SOFT_HEAP_OFF) _softBrakeOn = false
	} else {
		if (r > SOFT_HEAP_ON) _softBrakeOn = true
	}
	return _softBrakeOn
}
```

Fold it into `memUnderPressure()` (line 104-106):

```js
// True when intake (texture fetches, mesh bakes, prim ingest) should pause: over the self-accounted
// budget, genuinely near OOM (emergencyHeap), or in the soft-heap band with a real scene (heapThrottled).
export function memUnderPressure() {
	return appRatio() > 1 || emergencyHeap() || heapThrottled()
}
```

Add the new symbols to the bottom export (line 108):

```js
export { APP_BUDGET_CAP, APP_BUDGET_FRACTION, APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO, CRITICAL_HEAP_RATIO,
	SOFT_HEAP_ON, SOFT_HEAP_OFF, MIN_RESIDENT }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/__tests__/lib/memGovernor.test.js`
Expected: PASS — all new `soft-heap brake` cases plus the existing `critical-heap brake` and budget
cases still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/memGovernor.js src/__tests__/lib/memGovernor.test.js
git commit -m "feat(gov): heap-aware soft throttle signal"
```

---

### Task 2: Wire the soft brake into the engine (resident count + ingest gate)

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import line 22; `cullTick` ~3412; `pumpIngest` ~3622)

- [ ] **Step 1: Add `setResidentCount` to the governor import**

In `src/composables/useWorldEngine.js` line 22, add `setResidentCount` to the existing import:

```js
import { memStats, memUnderPressure, memRatio, setAppBytes, appRatio, appBudgetBytes, emergencyHeap, setAppBudgetOverride, setResidentCount } from '@/lib/memGovernor.js'
```

- [ ] **Step 2: Push the resident mesh count in `cullTick`**

In `cullTick`, immediately after the existing `setAppBytes(...)` call (line 3412), add:

```js
		setAppBytes(getTextureBytes() + getMeshBytes() + _lastGeomB)
		// Corroborates the soft-heap brake (memGovernor.heapThrottled): a real resident scene means a
		// high heap is OUR load (throttle), not a hard-reload inheriting the prior page's garbage (build).
		setResidentCount(meshMap.size)
```

- [ ] **Step 3: Gate `pumpIngest` on memory pressure**

In `pumpIngest()` (line 3622), add the pressure gate right after the empty-queue early return
(after line 3623 `if (!_ingestQueue.length) return`):

```js
	function pumpIngest() {
		if (!_ingestQueue.length) return
		// Memory governor: pause pulling prims off the ingest queue under pressure (heap soft-brake,
		// VRAM budget, or the 0.95 OOM brake). Each ingest does upsertObject + queues a mesh build, so
		// continuing would feed buildQ + worldStore while the heap is already tight (the cold-load churn:
		// buildQ ran away to 42k). The queue retains its items and drains once pressure clears.
		if (memUnderPressure()) return
		const hidden = (typeof document !== 'undefined' && document.hidden)
```

- [ ] **Step 4: Verify the build still compiles**

Run: `npm run build:prod`
Expected: build succeeds (no syntax/import errors). The wiring has no unit test (it's engine glue
around the Task 1 signal that IS unit-tested); build + the existing suite are the guard.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `bun test`
Expected: PASS — same baseline as before (no new failures). Note any pre-existing failures are
unrelated (see [[eslint-broken-flat-config]] — lint is broken, tests are the gate).

- [ ] **Step 6: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "perf(engine): heap-throttle build + prim ingest"
```

---

### Task 3: Gate the texture pump on the soft brake

**Files:**
- Modify: `src/composables/useTextureFetch.js` (import line 10; pump while-condition line 120)

- [ ] **Step 1: Import `heapThrottled`**

In `src/composables/useTextureFetch.js` line 10, add `heapThrottled` to the existing import:

```js
import { emergencyHeap, appRatio, heapThrottled } from '@/lib/memGovernor.js'
```

- [ ] **Step 2: Add the soft brake to the pump's while-condition**

At line 120, add `|| heapThrottled()` to the loop guard:

```js
	while (active < MAX_INFLIGHT && netQueue.length && !(emergencyHeap() || appRatio() >= 1.0 || heapThrottled())) {
```

Leave the surrounding comment (lines 115-119) as-is — the `appRatio` headroom rationale still holds;
the soft brake is an ADDITIONAL pause for genuine heap pressure (texture decode is a major
heap-garbage source, so it must pause alongside the build drain).

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 4: Run the full test suite**

Run: `bun test`
Expected: PASS — baseline, no new failures.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useTextureFetch.js
git commit -m "perf(tex): heap-throttle texture intake"
```

---

### Task 4: Final verification + docs

**Files:**
- Modify: `docs/FEATURE-GAPS.md` (the #11 churn item — mark the fix landed, NEEDS live-verify)

- [ ] **Step 1: Full build + test pass**

Run: `npm run build:prod && bun test`
Expected: build succeeds; test suite at baseline (the new soft-brake cases pass, nothing else
regressed).

- [ ] **Step 2: Update FEATURE-GAPS #11 churn item**

In `docs/FEATURE-GAPS.md`, on the `Scene doesn't fully settle on a heavy COLD load` checkbox item,
append a status note (do NOT check the box — it needs live-verify first):

```markdown
  **→ FIX IMPLEMENTED 2026-06-16 (UNCOMMITTED until Gene verifies / NEEDS LIVE-VERIFY):** heap-aware
  soft throttle — `memGovernor.heapThrottled()` (hysteresis 0.85/0.78, corroborated by `meshMap.size>500`
  so a hard-reload's inherited garbage can't blank the region) folded into `memUnderPressure()`; gates
  the build drain (already), `pumpIngest` (new), and the texture pump (new). Closes the 0.85–0.95 band
  that had no throttle below the 0.95 hard brake. Scene-clear (objs 17471→5482, evicted=0) deliberately
  left for a separate live-trace slice — may relieve as a side effect.
```

- [ ] **Step 3: Commit the docs**

```bash
git add docs/FEATURE-GAPS.md
git commit -m "docs: heap-aware soft throttle landed"
```

- [ ] **Step 4: Hand off for live-verify**

Report to Gene: implemented + unit-tested + build green; NEEDS live-verify on the ~17k+ obj region
that churned. Watch the `[Mem]` line: heap should hold ≤~0.90 (not climb toward OOM), `buildQ` should
stop the runaway climb, and the rAF-violation flood should drop. Confirm the scene loads progressively
(near-first) without the disappear+redraw churn. Gene commits (thrash-prone history: he commits).

---

## Notes for the implementer

- **Line numbers are approximate** (`useWorldEngine.js` is ~4741 lines and shifts as you edit). Anchor
  on the quoted surrounding code, not the line number.
- **Commit cadence:** one commit per task as written. Gene's standing rule is that HE commits — so if
  running interactively, propose the commit and let him run it; the `git commit` steps document the
  intended message (≤50-char subject, per [[commit-subject-50-chars]]). If running via subagents, the
  agent may commit and Gene reviews.
- **No cache-version bump anywhere** — this change touches no persisted format.
- **Do not touch** the `emergencyHeap` 0.95 logic or the geom-mem-cap (0.82/0.68) logic — they are
  orthogonal backstops and were tuned separately.
