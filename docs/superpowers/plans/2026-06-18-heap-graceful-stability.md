# Heap-Pressure Graceful Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a heavy cold region, stop the heap-triggered scene collapse (draw-distance crater, texture wipe, evict→reload churn) so the viewer holds steady under memory pressure instead of cubing-out.

**Architecture:** Move two policy decisions out of the 4000-line `useWorldEngine.js` cullTick into pure, unit-testable helpers in `src/lib/cullPolicy.js` (the existing home for cull policy). (1) Eviction/texture-prune/draw-distance step-down trigger keys on the resident/VRAM budget (`appRatio`) ONLY — never on raw heap; this also kills the evict→reload churn that ballooned the build queue. (2) The auto-rebuild won't fire while intake is intentionally paused by the heap brake. The existing `memUnderPressure()` intake/build pause is unchanged.

**Tech Stack:** Vue 3 composable (`useWorldEngine.js`); pure helpers in `src/lib/cullPolicy.js`; tests in `bun:test` (run with `bun test`), build check with `npm run build:prod`.

---

## Context the engineer needs

- **Spec:** `docs/superpowers/specs/2026-06-18-heap-graceful-stability-design.md` — read it first.
- **Root cause:** `useWorldEngine.js:3523` currently reads `const over = r > CULL_TARGET || emergencyHeap()`
  where `r = appRatio()`. When the process heap crosses ~0.95, `emergencyHeap()` forces `over=true`, which
  drives eviction (3553+), `pruneTexturesLRU(96)` (3594), and the `_effNear` draw-distance step-down
  (3605–3607). On a heavy cold region the heap is dominated by transient GC garbage + the build backlog
  (NOT the resident scene: live evidence had heap 99% while `appRatio` was 5%), so this collapse relieves
  nothing and just craters draw distance to the 32m floor, wipes textures, and churns evict→reload.
- **Two test runners in this repo:** `bun test` (server + pure `bun:test` files, including
  `src/__tests__/lib/*.test.js`) and **Vitest** (`vi.mock`/jsdom store+composable tests). **The tests in
  this plan are `bun:test`** — run with `bun test <path>`, NOT `npx vitest`.
- **ESLint is broken repo-wide** — do NOT run `npm run lint`. Verify with `bun test` + `npm run build:prod`.
- **Use TABS** for indentation (repo enforces tabs via `.editorconfig`).
- **Do NOT commit** — the repo owner (Gene) commits. The `git commit` blocks below document the intended
  ≤50-char subject lines only; leave the changes staged/unstaged for him.
- `cullPolicy.js` helpers are pure (no THREE/DOM) and imported into `useWorldEngine.js` at line 23:
  `import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility } from '@/lib/cullPolicy.js'`.
- `memUnderPressure` is already imported in `useWorldEngine.js` (line 22) and already gates `pumpIngest`
  (3696), the build drain (3753), and the texture pump. That pause-and-hold behavior STAYS — do not touch it.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/cullPolicy.js` | pure cull-policy decisions | MODIFY — add `shouldEvictForBudget`, `shouldAutoRebuild` |
| `src/__tests__/lib/cullPolicy.test.js` | unit tests for the above | MODIFY — add two describe blocks |
| `src/composables/useWorldEngine.js` | engine cullTick wiring | MODIFY — use the helpers; drop the `emergencyHeap` import |
| `docs/FEATURE-GAPS.md` | tracker | MODIFY (Task 3) — mark the heap-collapse item fixed, NEEDS live-verify |

---

### Task 1: `shouldEvictForBudget` — eviction triggers on the resident budget only

**Files:**
- Modify: `src/lib/cullPolicy.js`
- Modify: `src/__tests__/lib/cullPolicy.test.js`
- Modify: `src/composables/useWorldEngine.js` (import line 23; line 22; the `over` expression ~3517–3523)

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/lib/cullPolicy.test.js`:

```js
import { shouldEvictForBudget } from '@/lib/cullPolicy.js'

describe('shouldEvictForBudget', () => {
	// Eviction/texture-prune/draw-distance step-down must trigger ONLY on the resident/VRAM budget
	// (appRatio), never on raw process heap — evicting resident assets cannot relieve heap held by
	// transient garbage/backlog. The signature deliberately omits any heap parameter (regression guard
	// against re-introducing `|| emergencyHeap()`).
	it('evicts when the resident budget is exceeded', () => {
		expect(shouldEvictForBudget(1.01, 1.0)).toBe(true)
		expect(shouldEvictForBudget(2.0, 1.0)).toBe(true)
	})

	it('does NOT evict at or under the resident budget', () => {
		expect(shouldEvictForBudget(1.0, 1.0)).toBe(false)
		expect(shouldEvictForBudget(0.05, 1.0)).toBe(false)   // app 5% — the heap-99%/app-5% collapse case
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: FAIL — `shouldEvictForBudget is not a function` / import error.

- [ ] **Step 3: Implement the helper**

In `src/lib/cullPolicy.js`, after the `drawDistanceMayGrow` function (ends line 48), add:

```js
// True when the resident-asset working set should shed (evict far roots, prune textures, step the
// draw distance down). Keys on the self-accounted resident/VRAM budget ONLY — deliberately NOT on the
// process heap. WHY: on a heavy cold region the heap is dominated by transient GC garbage + the build
// backlog, not the resident scene (live 2026-06-18: heap 99% while appRatio 5%); evicting resident
// assets then relieves nothing and just craters draw distance, wipes near textures, and churns
// evict→reload. Heap pressure is handled upstream by PAUSING intake/build (memGovernor.memUnderPressure),
// letting GC reclaim the garbage. See docs/superpowers/specs/2026-06-18-heap-graceful-stability-design.md.
export function shouldEvictForBudget(appRatio, cullTarget) {
	return appRatio > cullTarget
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS (the two new `shouldEvictForBudget` tests + all existing cullPolicy tests).

- [ ] **Step 5: Wire it into the engine and drop the dead `emergencyHeap` import**

In `src/composables/useWorldEngine.js`:

(a) Line 23 — add `shouldEvictForBudget` to the cullPolicy import:

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility, shouldEvictForBudget } from '@/lib/cullPolicy.js'
```

(b) Line 22 — remove `emergencyHeap` from the memGovernor import (it becomes unused after this task; it is referenced ONLY at the `over` line):

```js
import { memStats, memUnderPressure, memRatio, setAppBytes, appRatio, appBudgetBytes, setAppBudgetOverride, setResidentCount, heapThrottled } from '@/lib/memGovernor.js'
```

(c) Replace the `over` expression and update the now-stale comment above it. Find (~3517–3523):

```js
		// EVICTION + texture-prune trigger = VRAM/app budget exceeded, or a genuine heap CRISIS
		// (emergencyHeap, ~0.95). WHY NOT moderate heap (>0.82): evicting resident assets does NOT
		// relieve heap (it's held by transient bake/decode garbage, not the resident scene) — it just
		// churns the visible world to cubes and prunes near textures away for no benefit (live: eviction
		// firing every tick at app=43% heap=84%, textures vanishing). Moderate heap pressure is handled
		// by PAUSING intake (memUnderPressure/the critical brake), not by evicting. See FEATURE-GAPS #13.
		const over = r > CULL_TARGET || emergencyHeap()
```

Replace with:

```js
		// EVICTION + texture-prune + draw-distance step-down trigger = resident/VRAM (app) budget exceeded
		// ONLY. Heap pressure does NOT trigger eviction: evicting resident assets cannot relieve heap held
		// by transient bake/decode garbage + the build backlog, not the resident scene. At heap 99%/app 5%
		// (live 2026-06-18, Never Depot 10.9k objs) the old `|| emergencyHeap()` clause just cratered draw
		// distance to the 32m floor, wiped near textures, and churned evict→reload for zero heap relief.
		// Heap pressure is handled by PAUSING intake/build (memUnderPressure), letting GC reclaim the
		// garbage. See docs/superpowers/specs/2026-06-18-heap-graceful-stability-design.md.
		const over = shouldEvictForBudget(r, CULL_TARGET)
```

- [ ] **Step 6: Verify the build**

Run: `npm run build:prod`
Expected: `✓ built` with no errors (the chunk-size warning is pre-existing and fine).

- [ ] **Step 7: Commit** (repo owner runs this)

```bash
git add src/lib/cullPolicy.js src/__tests__/lib/cullPolicy.test.js src/composables/useWorldEngine.js
git commit -m "fix(engine): evict on resident budget, not heap"
```

---

### Task 2: `shouldAutoRebuild` — no auto-rebuild while intentionally paused

**Files:**
- Modify: `src/lib/cullPolicy.js`
- Modify: `src/__tests__/lib/cullPolicy.test.js`
- Modify: `src/composables/useWorldEngine.js` (the auto-rebuild trigger ~3313–3318)

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/lib/cullPolicy.test.js`:

```js
import { shouldAutoRebuild } from '@/lib/cullPolicy.js'

describe('shouldAutoRebuild', () => {
	// The auto-rebuild re-queues every object; it must NOT fire while intake is intentionally paused by
	// the heap brake (a paused scene is not a dead scene). Fires only on a real dead-scene signal.
	it('fires when dead-scan threshold is reached and NOT under pressure', () => {
		expect(shouldAutoRebuild(3, 3, false)).toBe(true)
		expect(shouldAutoRebuild(5, 3, false)).toBe(true)
	})

	it('does NOT fire while under memory pressure (paused, not dead)', () => {
		expect(shouldAutoRebuild(3, 3, true)).toBe(false)
		expect(shouldAutoRebuild(99, 3, true)).toBe(false)
	})

	it('does NOT fire below the dead-scan threshold', () => {
		expect(shouldAutoRebuild(2, 3, false)).toBe(false)
		expect(shouldAutoRebuild(0, 3, false)).toBe(false)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: FAIL — `shouldAutoRebuild is not a function`.

- [ ] **Step 3: Implement the helper**

In `src/lib/cullPolicy.js`, after `shouldEvictForBudget`, add:

```js
// True when the dead-scene auto-rebuild (which re-queues EVERY object) should fire. Requires the
// dead-scan count to have reached its threshold AND the engine not to be under memory pressure: a scene
// the heap brake has intentionally paused looks "dead" (no build progress) but must not be re-queued —
// that would balloon the build backlog at the worst moment. Caller still applies its own time cooldown.
export function shouldAutoRebuild(deadScans, threshold, underPressure) {
	return deadScans >= threshold && !underPressure
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS (all `shouldEvictForBudget` + `shouldAutoRebuild` tests + existing cullPolicy tests).

- [ ] **Step 5: Wire it into the engine**

In `src/composables/useWorldEngine.js`, add `shouldAutoRebuild` to the cullPolicy import (line 23, alongside `shouldEvictForBudget` from Task 1):

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility, shouldEvictForBudget, shouldAutoRebuild } from '@/lib/cullPolicy.js'
```

Find the auto-rebuild trigger (~3313–3318):

```js
		_deadScans = (known > 200 && resident === 0) ? _deadScans + 1 : 0
		if (_deadScans >= 3 && Date.now() - _lastAutoRebuild > 120_000) {
			_lastAutoRebuild = Date.now()
			_deadScans = 0
			rebuildScene('auto: dead scene detected')
		}
```

Replace the `if` condition (keep the body and the `_deadScans` line unchanged):

```js
		_deadScans = (known > 200 && resident === 0) ? _deadScans + 1 : 0
		// Don't auto-rebuild while the heap brake has intentionally paused intake — a paused scene is not
		// a dead scene, and re-queuing every object would balloon the build backlog (graceful-stability spec).
		if (shouldAutoRebuild(_deadScans, 3, memUnderPressure()) && Date.now() - _lastAutoRebuild > 120_000) {
			_lastAutoRebuild = Date.now()
			_deadScans = 0
			rebuildScene('auto: dead scene detected')
		}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build:prod`
Expected: `✓ built` with no errors.

- [ ] **Step 7: Commit** (repo owner runs this)

```bash
git add src/lib/cullPolicy.js src/__tests__/lib/cullPolicy.test.js src/composables/useWorldEngine.js
git commit -m "fix(engine): no auto-rebuild while heap-paused"
```

---

### Task 3: Full verification + tracker update + live-verify handoff

**Files:**
- Modify: `docs/FEATURE-GAPS.md`

- [ ] **Step 1: Run the full pure-lib suite**

Run: `bun test src/__tests__/lib/`
Expected: all green, no new failures vs baseline (the new cullPolicy tests included).

- [ ] **Step 2: Production build**

Run: `npm run build:prod`
Expected: `✓ built`, only the pre-existing chunk-size warning.

- [ ] **Step 3: Update the tracker**

In `docs/FEATURE-GAPS.md`, on the heap-blind-governor / cube-blowout item (FEATURE-GAPS #13 area), append:

```markdown
   **→ GRACEFUL-STABILITY FIX IMPLEMENTED 2026-06-18 (NEEDS LIVE-VERIFY):** heavy cold regions cratered
   because cullTick triggered eviction + texture-prune + draw-distance step-down on `emergencyHeap()`
   (heap>0.95) even when the resident budget was tiny (live: heap 99%/app 5% on Never Depot 10.9k objs) —
   futile, since the heap was transient garbage + build backlog, not the resident scene. FIX: eviction now
   keys on the resident/VRAM budget (`appRatio`) ONLY (`shouldEvictForBudget`), and the dead-scene
   auto-rebuild no longer fires while intake is heap-paused (`shouldAutoRebuild`). Heap pressure is handled
   by the existing `memUnderPressure` intake/build pause. LIVE-VERIFY on a heavy cold region: heap should
   plateau (no climb to 100%+), draw distance should HOLD (no `[Cull] … draw distance ↓` cascade to 32m),
   no texture wipe, no `[3D] Rebuild Scene` under the brake; far objects fill in as you move.
```

- [ ] **Step 4: Commit** (repo owner runs this)

```bash
git add docs/FEATURE-GAPS.md
git commit -m "docs: heap graceful-stability fix landed"
```

- [ ] **Step 5: Live-verify handoff**

Report to the controller: implemented + unit-tested (`shouldEvictForBudget`, `shouldAutoRebuild`) + build
green. NEEDS live-verify on a HEAVY COLD region (10k+ objects, fresh login). The controller owns the Bun WS
server (background task) and reads `server-watch.log`: expect heap to PLATEAU under the brake (not climb to
100%+), `dd` to HOLD (no draw-distance-down cascade to 32m), no texture wipe (`texMB` not dropping to 0),
and no auto-`[3D] Rebuild Scene` while throttled. Gene commits.

---

## Notes for the implementer

- **Line numbers are approximate** — anchor on the quoted surrounding code.
- **New tests are `bun:test`** — run with `bun test <path>` (NOT Vitest).
- **Do NOT commit** — the repo owner commits; the `git commit` blocks document intended ≤50-char subjects.
- **Scope discipline:** only the `over` trigger and the auto-rebuild condition change. Do NOT touch the
  `memUnderPressure` intake/build pause (it's the correct pause-and-hold behavior), the eviction ranking
  (`selectEvictions`), or the draw-distance recovery (`drawDistanceMayGrow`).
- **No last-resort relief valve** (YAGNI per spec) — if live-verify shows heap still creeping to OOM, the
  follow-up is to bound the build backlog, NOT to restore the heap-triggered collapse.
