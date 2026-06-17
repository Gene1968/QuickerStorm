# Defer Inventory Bulk-Walk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the greedy full-inventory prefetch (`useInventory.fetchAll`) from starving region asset loading on a cold load by gating the bulk walk until the region's assets have drained (the scene is idle), bounded by a safety ceiling.

**Architecture:** The engine already computes a per-tick `loading` signal in `cullTick`. Publish it as `worldStore.sceneLoading`. The inventory `fetchAll` pump consults a pure predicate `shouldDeferInventoryWalk(sceneLoading, elapsedMs, ceilingMs)` each tick and skips the walk while the region is loading (until the ceiling). On-expand folder fetches stay immediate.

**Tech Stack:** Vue 3 composables, Pinia, Vitest (frontend tests — `npx vitest run`), jsdom.

---

## Context the engineer needs

- **Root cause (FEATURE-GAPS cold-pipeline #2):** `fetchAll()` walks the entire agent inventory tree at
  caps-ready; processing big `INV_FOLDER` responses (up to 3404 items) on the client main thread blocks
  it (~2 fps, ~3.85s/window of long tasks) for ~7 min, starving region texture/mesh loading. Proven via
  live `[Main]` telemetry: throughput jumps ~25× the instant inventory finishes.
- **Two test runners in this repo:** `bun test` (server + pure `bun:test` files) and **Vitest**
  (`src/**` composable/store tests, jsdom, `vi.mock`). **The new tests here are Vitest.** Run a single
  file with `npx vitest run <path>` (jsdom env setup takes ~30s — be patient). Do NOT run these with
  `bun test`.
- **Pre-existing failures are NOT yours:** the Vitest suite has some pre-existing failing tests (e.g.
  `useTeleport.test.js` TELEPORT_SOURCES drift). Judge regressions per-file: your NEW test files must
  pass, and you must not break a file you edited.
- **worldStore** is a Pinia composition store (`src/stores/worldStore.js`); store tests use
  `setActivePinia(createPinia())` then `useWorldStore()`. Composables consume it via
  `import { useWorldStore } from '@/stores/worldStore'; const world = useWorldStore()`.
- **useInventory** (`src/composables/useInventory.js`, 151 lines): `fetchAll()` (lines 43–52) starts a
  `setInterval` pump (`PUMP_MS=150`, `MAX_INFLIGHT=80`). `onCapsReady` (lines 89–109) loads cache, then
  calls `fetchAll()` (line 108). Module constants at lines 14–16. Module-level `let pump = null`
  (line 19).
- **Do NOT commit** — the repo owner commits. `git commit` blocks below document intended ≤50-char
  subjects only.
- ESLint is broken repo-wide — do NOT run `npm run lint`. Use Vitest + `npm run build:prod`.
- Use **TABS** for indentation (repo enforces tabs).

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/stores/worldStore.js` | publish `sceneLoading` flag | MODIFY |
| `src/composables/useInventory.js` | pure gate predicate + gate the `fetchAll` pump | MODIFY (export predicate, gate pump, capsReadyAt) |
| `src/composables/useWorldEngine.js` | publish `sceneLoading` from `cullTick`'s existing `loading` | MODIFY (1 line) |
| `src/__tests__/stores/worldStore.sceneLoading.test.js` | store flag test | CREATE |
| `src/__tests__/composables/useInventory.gate.test.js` | predicate test | CREATE |

---

### Task 1: `worldStore.sceneLoading` flag (TDD, Vitest)

**Files:**
- Modify: `src/stores/worldStore.js`
- Test: `src/__tests__/stores/worldStore.sceneLoading.test.js` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/stores/worldStore.sceneLoading.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorldStore } from '@/stores/worldStore'

beforeEach(() => setActivePinia(createPinia()))

describe('worldStore.sceneLoading', () => {
	it('defaults to true (assume loading until the engine reports a settle)', () => {
		const w = useWorldStore()
		expect(w.sceneLoading).toBe(true)
	})

	it('setSceneLoading coerces to boolean', () => {
		const w = useWorldStore()
		w.setSceneLoading(false)
		expect(w.sceneLoading).toBe(false)
		w.setSceneLoading(1)
		expect(w.sceneLoading).toBe(true)
		w.setSceneLoading(0)
		expect(w.sceneLoading).toBe(false)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/stores/worldStore.sceneLoading.test.js`
Expected: FAIL — `w.sceneLoading` is `undefined` / `w.setSceneLoading` is not a function.

- [ ] **Step 3: Add the flag to `worldStore.js`**

In `src/stores/worldStore.js`, near the `cullStats` ref/action (line 33–34), add:

```js
	const sceneLoading = ref(true)   // region assets still draining? published from useWorldEngine.cullTick
	function setSceneLoading(v) { sceneLoading.value = !!v }
```

Add `sceneLoading, setSceneLoading` to the store's returned object (the `return { ... }` near line 161,
alongside `cullStats, setCullStats`):

```js
		objects, avatars, prims, cullStats, setCullStats, sceneLoading, setSceneLoading,
```
(Append `sceneLoading, setSceneLoading` to the existing return list — do not remove anything.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/stores/worldStore.sceneLoading.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/worldStore.js src/__tests__/stores/worldStore.sceneLoading.test.js
git commit -m "feat(store): publish worldStore.sceneLoading"
```

---

### Task 2: Pure gate predicate `shouldDeferInventoryWalk` (TDD, Vitest)

**Files:**
- Modify: `src/composables/useInventory.js` (export a pure helper + constant)
- Test: `src/__tests__/composables/useInventory.gate.test.js` (CREATE)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/composables/useInventory.gate.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { shouldDeferInventoryWalk, FETCHALL_DEFER_CEILING_MS } from '@/composables/useInventory.js'

describe('shouldDeferInventoryWalk', () => {
	it('defers while the region is loading and within the ceiling', () => {
		expect(shouldDeferInventoryWalk(true, 0, 240_000)).toBe(true)
		expect(shouldDeferInventoryWalk(true, 239_999, 240_000)).toBe(true)
	})

	it('does NOT defer once the region is idle (regardless of elapsed)', () => {
		expect(shouldDeferInventoryWalk(false, 0, 240_000)).toBe(false)
		expect(shouldDeferInventoryWalk(false, 500_000, 240_000)).toBe(false)
	})

	it('does NOT defer past the ceiling even if still loading (never-starve fallback)', () => {
		expect(shouldDeferInventoryWalk(true, 240_000, 240_000)).toBe(false)
		expect(shouldDeferInventoryWalk(true, 999_999, 240_000)).toBe(false)
	})

	it('exposes a sane default ceiling (minutes, not seconds or hours)', () => {
		expect(FETCHALL_DEFER_CEILING_MS).toBeGreaterThanOrEqual(60_000)
		expect(FETCHALL_DEFER_CEILING_MS).toBeLessThanOrEqual(600_000)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/composables/useInventory.gate.test.js`
Expected: FAIL — `shouldDeferInventoryWalk` / `FETCHALL_DEFER_CEILING_MS` are not exported.

- [ ] **Step 3: Add the predicate + constant to `useInventory.js`**

In `src/composables/useInventory.js`, at module scope near the other constants (after line 16,
`const PUMP_MS = 150`), add:

```js
// Defer the background full-inventory walk until the region's assets have drained (worldStore.sceneLoading
// false), so it doesn't peg the client main thread and starve region texture/mesh loading on a cold load
// (FEATURE-GAPS cold-pipeline #2). Bounded by a ceiling so a never-settling region still loads inventory.
export const FETCHALL_DEFER_CEILING_MS = 240_000

/** True while the bulk walk should wait: the region is still loading AND we are within the ceiling. */
export function shouldDeferInventoryWalk(sceneLoading, elapsedMs, ceilingMs = FETCHALL_DEFER_CEILING_MS) {
	return !!sceneLoading && elapsedMs < ceilingMs
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/composables/useInventory.gate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useInventory.js src/__tests__/composables/useInventory.gate.test.js
git commit -m "feat(inv): pure gate predicate for bulk walk"
```

---

### Task 3: Gate the `fetchAll` pump on the predicate

**Files:**
- Modify: `src/composables/useInventory.js` (import worldStore, capsReadyAt, gate the pump tick)

- [ ] **Step 1: Import the world store**

In `src/composables/useInventory.js`, add to the imports (near line 10–11, the other store imports):

```js
import { useWorldStore } from '@/stores/worldStore'
```

In `useInventory()` (near line 23, where `inv`/`session` are obtained), add:

```js
	const world   = useWorldStore()
```

Add a module-level timestamp next to `let pump = null` (line 19):

```js
let pump = null
let capsReadyAt = 0   // performance.now() at caps-ready; the bulk-walk defer ceiling is measured from here
```

- [ ] **Step 2: Gate the pump tick**

In `fetchAll()` (lines 43–52), add the gate as the second guard in the interval callback (after the
`capsReady` check, before computing slots):

```js
	function fetchAll() {
		if (pump) return
		pump = setInterval(() => {
			if (!inv.capsReady) return
			// Hold the full walk until the region's assets have drained (bounded) — see
			// shouldDeferInventoryWalk. Prevents the cold-load main-thread starvation of texture/mesh load.
			if (shouldDeferInventoryWalk(world.sceneLoading, performance.now() - capsReadyAt)) return
			const slots = MAX_INFLIGHT - inv.fetching.size
			const pending = inv.pendingAgentFolders()
			if (pending.length === 0 && inv.fetching.size === 0) { stopFetchAll(); return }
			if (slots > 0 && pending.length > 0) fetchFolders(pending.slice(0, slots))
		}, PUMP_MS)
	}
```

- [ ] **Step 3: Record `capsReadyAt` in `onCapsReady`**

In `onCapsReady` (lines 89–109), set the timestamp before the `fetchAll()` call. Add right after
`inv.setCaps(d?.caps || [])` (line 90):

```js
		capsReadyAt = performance.now()
```

(The existing `fetchAll()` call at line 108 stays — the pump now self-gates. The expanded-folder
backfill loop at line 106 and `fetchFolder`/`fetchFolders` stay UNCHANGED and immediate.)

- [ ] **Step 4: Verify build + the gate predicate test still pass**

Run:
```bash
npm run build:prod
npx vitest run src/__tests__/composables/useInventory.gate.test.js
```
Expected: build succeeds; predicate test PASS. (The wiring itself is exercised live; the pure predicate
is the unit-tested decision logic.)

- [ ] **Step 5: Commit**

```bash
git add src/composables/useInventory.js
git commit -m "perf(inv): gate bulk walk until region idle"
```

---

### Task 4: Publish `sceneLoading` from the engine

**Files:**
- Modify: `src/composables/useWorldEngine.js` (`cullTick`, ~line 3435–3438)

- [ ] **Step 1: Add the publish line**

In `src/composables/useWorldEngine.js`, in `cullTick`, find the existing block where `loading` is
computed and used:

```js
		const tStat = getTextureStats(), mStat = getMeshStats()
		const loading = pendingMeshIds.size > 50 || tStat.queued > 0 || tStat.inflight > 0 || mStat.queued > 0 || _geomPending > 25
		setGeomCacheLoading(loading)
		setTexCacheLoading(loading)   // same load signal: suspend qs-tex flushes so reads aren't starved
```

Add one line immediately after `setTexCacheLoading(loading)`:

```js
		worldStore.setSceneLoading(loading)   // publish region-idle signal (gates the inventory bulk walk)
```

(`worldStore` is already in scope — `const worldStore = useWorldStore()` at line ~193.)

- [ ] **Step 2: Verify build**

Run: `npm run build:prod`
Expected: build succeeds (no syntax/import errors).

- [ ] **Step 3: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(engine): publish sceneLoading for inv gate"
```

---

### Task 5: Final verification + docs

**Files:**
- Modify: `docs/FEATURE-GAPS.md` (cold-pipeline #2 → implemented, NEEDS live-verify)

- [ ] **Step 1: Run the new tests + build**

Run:
```bash
npx vitest run src/__tests__/stores/worldStore.sceneLoading.test.js src/__tests__/composables/useInventory.gate.test.js
npm run build:prod
```
Expected: both new test files PASS (2 + 4 tests); build succeeds.

- [ ] **Step 2: Update FEATURE-GAPS cold-pipeline #2**

In `docs/FEATURE-GAPS.md`, on the cold-asset-pipeline list **item 2** (the ~5-min front stall
investigation), append:

```markdown
   **→ ROOT-CAUSED + FIX IMPLEMENTED 2026-06-17 (NEEDS LIVE-VERIFY):** the stall was CONTENTION, not
   throughput — `useInventory.fetchAll()` greedily walks the whole inventory tree at caps-ready,
   processing big INV_FOLDER batches on the client main thread (~2 fps, ~3.85s/window long tasks) for
   ~7 min, starving region texture/mesh load (decode pool idle, fetches <1s; throughput jumps ~25× the
   instant inventory finishes). FIX: publish `worldStore.sceneLoading` from cullTick; the fetchAll pump
   defers via `shouldDeferInventoryWalk(sceneLoading, elapsed, FETCHALL_DEFER_CEILING_MS=240s)` until the
   region's assets drain (on-expand fetches stay immediate). Expected cold load ~13min → ~4min. Spec/plan
   under docs/superpowers/. LIVE-VERIFY: cold-load — [Main] longtasks stay low early, [Inv] fetches don't
   begin until assets drain, texture throughput steady from the start.
```

- [ ] **Step 3: Commit**

```bash
git add docs/FEATURE-GAPS.md
git commit -m "docs: inventory bulk-walk gate landed"
```

- [ ] **Step 4: Hand off for live-verify**

Report: implemented + unit-tested (worldStore flag + gate predicate) + build green. NEEDS live-verify on
a cold region: the controller watches `server-watch.log` — `[Inv]` fetches should NOT start until the
region's assets drain (or 240s), client `[Main]` should not show the multi-second `longtasks` block in
the first minutes, and texture/mesh throughput should be steady from the start (no ~5–7 min stall).
Gene commits.

---

## Notes for the implementer

- **Line numbers are approximate** — anchor on the quoted surrounding code.
- **New tests are Vitest** — run with `npx vitest run <path>` (NOT `bun test`). jsdom setup is slow
  (~30s); that's normal.
- **Do NOT commit** (the repo owner commits). The `git commit` blocks document intended ≤50-char
  subjects only.
- **Scope discipline:** only the background `fetchAll` walk is gated. Do NOT gate `fetchFolder` /
  `fetchFolders` (on-expand) or the expanded-folder backfill loop — those must stay immediate.
- **No cache-version bump** — pure client runtime behavior.
