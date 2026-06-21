# Load-Governor / Render Decouple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scene build reliably to the user's draw distance using available RAM — never capped by frame rate — and shed only the far field under genuine memory pressure.

**Architecture:** Decouple three tangled control loops. (1) Delete the fps-driven `_renderCap` so frame rate no longer gates the build/render radius. (2) Render draws everything within the user draw distance. (3) Add a heap-gated eviction trigger (fires only when the resident scene genuinely explains the heap, `appRatio ≥ 0.85`) so a raised RAM budget settles gracefully instead of wedging. The visibility-cull boundary is left intact as the Phase-2 LOD seam.

**Tech Stack:** Vue 3 `<script setup>`, Three.js, `bun:test` for unit tests, Vite (`npm run build:prod`) for build verification.

**Spec:** `docs/superpowers/specs/2026-06-21-load-governor-render-decouple-design.md`

**Committing:** Per the project's standing rule, **do NOT commit.** Stop each task at "build + tests green." Gene commits the whole change himself after live-verify on Aspen (Task 5).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/lib/cullPolicy.js` | Pure cull/eviction ranking predicates | Add `shouldEvictForHeap` |
| `src/__tests__/lib/cullPolicy.test.js` | Unit tests for cullPolicy | Add `shouldEvictForHeap` tests (incl. 2026-06-18 regression guard) |
| `src/composables/useWorldEngine.js` | Three.js scene, drain, cull governor | Wire heap-eviction into `over`; delete `_renderCap` + fps-stepping; `renderRadius()` = draw distance; `ddTarget` = `_userTarget`; `rcap` telemetry = mirror |
| `src/lib/memGovernor.js` | Memory-pressure governor | Raise resident budget (`APP_BUDGET_CAP`/`APP_BUDGET_FRACTION`) — initial value, tuned live |
| `src/__tests__/lib/memGovernor.test.js` | Unit tests for memGovernor | Update budget expectations to match new constants |

---

## Task 1: Add `shouldEvictForHeap` pure predicate

**Files:**
- Modify: `src/lib/cullPolicy.js` (after `shouldEvictForBudget`, ~line 59)
- Test: `src/__tests__/lib/cullPolicy.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/lib/cullPolicy.test.js`. First add `shouldEvictForHeap` to the existing import line, then append:

```js
describe('shouldEvictForHeap', () => {
	// Resident scene genuinely explains the heap (high app + heap at/over emergency) → evict.
	it('evicts when heap is at emergency AND appRatio is high (resident IS the heap)', () => {
		expect(shouldEvictForHeap(0.98, 0.93, 0.92, 0.85)).toBe(true)
		expect(shouldEvictForHeap(0.85, 0.92, 0.92, 0.85)).toBe(true)
	})
	// 2026-06-18 REGRESSION GUARD: heap high but app LOW = transient garbage, NOT resident.
	// Eviction can't relieve it and cratered draw distance last time. Must NOT fire.
	it('does NOT evict when heap is high but appRatio is low (transient garbage)', () => {
		expect(shouldEvictForHeap(0.05, 0.99, 0.92, 0.85)).toBe(false)
		expect(shouldEvictForHeap(0.50, 0.96, 0.92, 0.85)).toBe(false)
	})
	it('does NOT evict below the emergency heap ratio', () => {
		expect(shouldEvictForHeap(0.98, 0.80, 0.92, 0.85)).toBe(false)
	})
	it('treats null heapRatio (non-Chrome) as no heap pressure', () => {
		expect(shouldEvictForHeap(0.98, null, 0.92, 0.85)).toBe(false)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: FAIL — `shouldEvictForHeap is not a function` (import is undefined).

- [ ] **Step 3: Implement the predicate**

In `src/lib/cullPolicy.js`, immediately after the `shouldEvictForBudget` function (ends ~line 59), add:

```js
// True when the RESIDENT scene is itself the heap problem, so evicting it WILL help. Gated on
// appRatio >= appStanddown to EXCLUDE the transient-garbage regime (heap high, app low) that
// 2026-06-18 proved eviction cannot relieve — there the heap is bake/decode churn + the build
// backlog, and shedding resident assets just craters draw distance for zero relief (handled
// instead by PAUSING build via memGovernor.memUnderPressure). This complements shouldEvictForBudget:
// budget-exceeded fires on appRatio alone; this adds the case where a raised budget keeps appRatio
// under 1.0 while the resident scene has already pushed the process heap to the emergency band.
// heapRatio is null on browsers without performance.memory → no heap pressure (false).
// See docs/superpowers/specs/2026-06-21-load-governor-render-decouple-design.md +
//     docs/superpowers/specs/2026-06-18-heap-graceful-stability-design.md.
export function shouldEvictForHeap(appRatio, heapRatio, heapEmergency, appStanddown) {
	return heapRatio != null && heapRatio >= heapEmergency && appRatio >= appStanddown
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS (all `shouldEvictForHeap` cases green, existing cullPolicy tests still green).

---

## Task 2: Wire heap-gated eviction into the cull governor

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import line ~25; `over` trigger line 3658)

- [ ] **Step 1: Extend the cullPolicy import**

In `src/composables/useWorldEngine.js` line 25, add `shouldEvictForHeap` to the existing `@/lib/cullPolicy.js` import:

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility, shouldEvictForBudget, shouldEvictForHeap, shouldAutoRebuild } from '@/lib/cullPolicy.js'
```

- [ ] **Step 2: Confirm the memGovernor constants are imported**

The `over` trigger needs `EMERGENCY_HEAP_RATIO` and `SOFT_HEAP_APP_STANDDOWN`. Verify the memGovernor import (line 24) — add whichever are missing:

```js
import { memStats, memUnderPressure, memRatio, setAppBytes, appRatio, appBudgetBytes, setAppBudgetOverride, setResidentCount, heapThrottled, EMERGENCY_HEAP_RATIO, SOFT_HEAP_APP_STANDDOWN } from '@/lib/memGovernor.js'
```

(`EMERGENCY_HEAP_RATIO` = 0.92 and `SOFT_HEAP_APP_STANDDOWN` = 0.85 are already exported from `memGovernor.js`.)

- [ ] **Step 3: Update the `over` trigger**

In `src/composables/useWorldEngine.js`, replace line 3658:

```js
		const over = shouldEvictForBudget(r, CULL_TARGET)
```

with:

```js
		// Evict/step-down when the resident set exceeds its budget (appRatio>1) OR when the resident
		// scene has itself pushed the process heap into the emergency band (raised-budget case: appRatio
		// stays <1 but heap hits 0.92). The heap clause is gated on appRatio>=standdown so it fires ONLY
		// when resident genuinely explains the heap — NOT the transient-garbage regime (2026-06-18).
		const over = shouldEvictForBudget(r, CULL_TARGET)
			|| shouldEvictForHeap(r, heapR, EMERGENCY_HEAP_RATIO, SOFT_HEAP_APP_STANDDOWN)
```

(`r` = `appRatio()` and `heapR` = `memRatio()` are already in scope, assigned at lines 3639–3640.)

- [ ] **Step 4: Run the unit suite + build**

Run: `bun test src/__tests__/lib/ && npm run build:prod`
Expected: tests PASS, build succeeds (no new failures vs. baseline).

---

## Task 3: Delete `_renderCap` — decouple build/render from frame rate

**Files:**
- Modify: `src/composables/useWorldEngine.js` (declarations ~383–387; fps block 3753–3766; `renderRadius()` 3795; telemetry 4835)

- [ ] **Step 1: Remove the `_renderCap` declarations and constants**

In `src/composables/useWorldEngine.js`, delete the `_renderCap` declaration block (lines ~383–387):

```js
	let _renderCap = DRAW_DIST_DEFAULT
	let _renderCapTick = 0
	const RENDERCAP_FPS_LOW = 45    // below this → shrink the rendered radius
	const RENDERCAP_FPS_OK  = 58    // above this (and below target) → grow it back
	const RENDERCAP_CADENCE = 6     // step at most once per N cullTicks (~1s) — avoids flicker
```

Replace the preceding multi-line comment block (the `Frame-time AutoTune cap (...)` comment, lines ~374–382) with a one-line pointer:

```js
	// Draw radius is governed by MEMORY only (see cullTick + memGovernor) — NOT frame rate. The former
	// fps-driven _renderCap conflated load-stutter with render cost and floored the build radius; removed
	// 2026-06-21 (docs/superpowers/specs/2026-06-21-load-governor-render-decouple-design.md). Phase-2 LOD
	// renders the far field cheaply so a large radius stays smooth.
```

- [ ] **Step 2: Replace the fps-stepping block with a fps-free draw target**

In `cullTick`, replace lines ~3750–3763 (from the `// Draw-distance recovery ...` comment's `Frame-time AutoTune` paragraph through the `ddTarget` assignment). The exact current text to replace:

```js
		const _userTarget = Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT)
		if ((_renderCapTick++ % RENDERCAP_CADENCE) === 0 && uiStore.fps > 0) {
			if (uiStore.fps < RENDERCAP_FPS_LOW && _renderCap > DRAW_DIST_MIN) _renderCap = Math.max(DRAW_DIST_MIN, _renderCap - DRAW_DIST_STEP)
			else if (uiStore.fps > RENDERCAP_FPS_OK && _renderCap < _userTarget) _renderCap = Math.min(_userTarget, _renderCap + DRAW_DIST_STEP)
		}
		if (_renderCap > _userTarget) _renderCap = _userTarget   // snap down if user lowered the slider
		// Effective target = the smaller of the user's slider and what the frame rate can sustain. Both
		// _effNear (memory/eviction + badge denominator) and renderRadius() clamp to this, so render,
		// eviction, and the load badge all settle at the same frame-rate-bounded radius.
		const ddTarget = Math.min(_userTarget, _renderCap)
```

with:

```js
		// Draw target = the user's slider, period. Memory (eviction + step-down below) is the ONLY thing
		// that shrinks the effective radius; frame rate never caps how much builds or renders.
		const ddTarget = Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT)
```

(The lines just below — `if (_effNear > ddTarget) _effNear = ddTarget` and the `drawDistanceMayGrow` recovery — are unchanged and keep working against the new `ddTarget`.)

- [ ] **Step 3: Make `renderRadius()` fps-free**

Replace line ~3795:

```js
	function renderRadius() { return Math.max(DRAW_DIST_MIN, Math.min(uiStore.drawDistance ?? DRAW_DIST_DEFAULT, _renderCap)) }
```

with:

```js
	// Render everything within the user's draw distance — no fps clamp (see _renderCap removal). The
	// selectVisibility boundary at this radius is the Phase-2 LOD seam ("hide beyond" → "impostor beyond").
	function renderRadius() { return Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT) }
```

- [ ] **Step 4: Keep the `rcap` telemetry token as an informational mirror**

In the `[Mem]` telemetry line (~4835), replace `rcap=${_renderCap}m` with `rcap=${renderRadius()}m` so the token still prints (log tooling/grep unaffected) but reflects the actual render radius:

```js
					` | tex q=${t.queued} cache=${t.cached} | mesh q=${m.queued} cache=${m.cached} | objs=${meshMap.size + (_instancePool?.count() ?? 0)} inst=${_instancePool?.count() ?? 0} evicted=${evicted.size} buildQ=${pendingMeshIds.size} dd=${_effNear}m rcap=${renderRadius()}m fps=${uiStore.fps}`
```

- [ ] **Step 5: Verify no `_renderCap` references remain**

Run: `grep -n "_renderCap\|RENDERCAP_" src/composables/useWorldEngine.js`
Expected: NO output (all references removed).

- [ ] **Step 6: Build**

Run: `npm run build:prod`
Expected: build succeeds, no `_renderCap is not defined` / unused-var errors.

---

## Task 4: Raise the resident budget to use available RAM

**Files:**
- Modify: `src/lib/memGovernor.js` (constants ~22–23)
- Test: `src/__tests__/lib/memGovernor.test.js` (expectations ~65–77)

**Note:** this is the live-tuned knob. The starting values below are a conservative first step above Auto's 2048 MB; Task 5 tunes them on Aspen. The `shouldEvictForHeap` backstop (Task 2) is what makes a higher budget safe — it settles via far-field eviction instead of wedging.

- [ ] **Step 1: Update the failing test expectations first**

In `src/__tests__/lib/memGovernor.test.js`, the budget tests currently assume `APP_BUDGET_CAP=2048` / `FRACTION=0.5`. Update the affected expectations to the new constants. Current lines ~65–77 reference `2515` (the 0.6 override-heap-fraction clamp — unchanged) and an auto-budget assertion. The one that changes is the auto-budget case at line 77:

```js
		try { setHeap(3072); setAppBudgetOverride(3000 * MB); setAppBudgetOverride(null); expect(Math.round(appBudgetBytes() / MB)).toBe(1536) } finally { clearHeap() }
```

With `APP_BUDGET_FRACTION` 0.5 → 0.65, the auto budget on a 3072 MB heap becomes `min(3072, 3072×0.65) = 1997`. Update to:

```js
		try { setHeap(3072); setAppBudgetOverride(3000 * MB); setAppBudgetOverride(null); expect(Math.round(appBudgetBytes() / MB)).toBe(1997) } finally { clearHeap() }
```

Scan the rest of the file for any other expectation that hard-codes the old `2048` cap or `0.5` fraction in an auto-budget (no-override) assertion and update it the same way (`min(CAP, heapMB×0.65)`). Override-clamp assertions (the `2515` / `6144` cases) are driven by `APP_BUDGET_OVERRIDE_HEAP_FRACTION` 0.6 and `APP_BUDGET_CAP` 3072 — re-derive: `setAppBudgetOverride(3000*MB)` on a default 4192 heap clamps to `min(3000, 4192×0.6=2515) = 2515` (unchanged); `6144*MB` on a `setHeap`-cleared/high heap stays per its own `setHeap`.

- [ ] **Step 2: Run the budget tests to verify they fail**

Run: `bun test src/__tests__/lib/memGovernor.test.js`
Expected: FAIL on the updated auto-budget expectation(s) (still using old constants).

- [ ] **Step 3: Raise the constants**

In `src/lib/memGovernor.js`, lines 22–23:

```js
const APP_BUDGET_CAP      = 2048 * 1048576  // hard cap on the resident-asset budget (bytes)
const APP_BUDGET_FRACTION = 0.50            // ...or this fraction of the heap limit, when known
```

change to:

```js
// Raised 2026-06-21 (2048→3072 / 0.50→0.65) to USE available RAM: the old cap settled heavy regions
// at ~50% of the scene with most of the tab heap idle. Safe to raise because shouldEvictForHeap now
// sheds the far field when resident pushes the heap to 0.92 — the budget no longer has to sit below the
// heap brake to avoid a wedge. Tuned live on Aspen; emergencyHeap (0.92) / CRITICAL (0.95) still backstop.
const APP_BUDGET_CAP      = 3072 * 1048576  // hard cap on the resident-asset budget (bytes)
const APP_BUDGET_FRACTION = 0.65            // ...or this fraction of the heap limit, when known
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/__tests__/lib/memGovernor.test.js`
Expected: PASS.

- [ ] **Step 5: Full unit suite + build**

Run: `bun test src/__tests__/lib/ && npm run build:prod`
Expected: all PASS, build succeeds.

---

## Task 5: Verification + live-verify (no commit)

**Files:** none (verification only).

- [ ] **Step 1: Full build + suite green**

Run: `bun test src/__tests__/lib/ && npm run build:prod`
Expected: no new test failures vs. baseline; build succeeds.

- [ ] **Step 2: Live-verify on Aspen (Gene drives the client; I watch `server-watch.log`)**

Gene hard-reloads (Ctrl+Shift+R — required, a TP/relogin keeps the old bundle) and loads Aspen. Watch the `[Mem]` / `[Drain]` telemetry and confirm:
  1. **Build completes past ~50%:** `buildQ` drains toward 0, `objs` climbs well past ~3276 toward the full prim count; the throttle is no longer `brkCap`.
  2. **fps may drop but the scene does NOT wedge:** the build keeps making progress to completion.
  3. **Graceful ceiling:** as resident grows, if heap approaches ~0.92 confirm `shouldEvictForHeap` arms (`[Cull] evicted ... heap=9x%`) and the radius **settles** (no `gov`-pinned freeze, no OOM/tab crash).
  4. **Recovery:** move away / TP; headroom returns; `_effNear` grows back toward target.
  5. **Record the radius at which fps falls off** — this is the Phase-2 LOD threshold.

- [ ] **Step 3: Tune the budget (live)**

If load completes well below the heap with fps acceptable, raise `APP_BUDGET_FRACTION` (and re-run Step 1–2). If the tab nears OOM or stutters into the `emergencyHeap` band before eviction settles it, lower it. Converge on the largest value that loads reliably without crashing. Update the `memGovernor.test.js` expectation to the final value.

- [ ] **Step 4: Hand off to Gene for commit**

Summarize the change + measured before/after telemetry. Gene commits (suggested subject ≤50 chars, e.g. `feat(render): decouple build/render from fps`).

---

## Self-Review

**Spec coverage:**
- Part 1 (build RAM-driven, fps-decoupled) → Task 3 (delete `_renderCap`, `ddTarget` = slider).
- Part 2 (render draws everything in draw distance) → Task 3 (`renderRadius()` fps-free; visibility-cull boundary retained as LOD seam).
- Part 3 (heap-gated eviction) → Tasks 1 + 2 (`shouldEvictForHeap` + `over` wiring).
- Part 3 (use available RAM) → Task 4 (raise budget) + Task 5 (live tune).
- 2026-06-18 reconciliation → Task 1 regression-guard tests.
- LOD seam named → Task 3 Step 3 comment + spec Phase-2 section.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". The budget value is a concrete starting number (3072/0.65) with a defined live-tune procedure (Task 5 Step 3), not a placeholder.

**Type/name consistency:** `shouldEvictForHeap(appRatio, heapRatio, heapEmergency, appStanddown)` — same signature in Task 1 (def + tests) and Task 2 (call site, args `r, heapR, EMERGENCY_HEAP_RATIO, SOFT_HEAP_APP_STANDDOWN`). `renderRadius()`, `ddTarget`, `_effNear`, `_userTarget` used consistently. `EMERGENCY_HEAP_RATIO`/`SOFT_HEAP_APP_STANDDOWN` are existing memGovernor exports.

**Out of scope (noted, not tasked):** PreferencesFloater VRAM-slider relabel — the slider still functions as tuning; cosmetic relabel deferred (spec marked optional).
