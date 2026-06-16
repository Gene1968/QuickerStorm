# Render-distance Visibility Cull Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `WebGLRenderer.render` scene-graph traversal cost on heavy regions by hiding (`mesh.visible=false`) root meshes beyond the governor radius `_effNear`, decoupled from memory eviction — so far objects stop being traversed every frame even when memory has headroom.

**Architecture:** A new pure decision function `selectVisibility` in `src/lib/cullPolicy.js` (mirrors `selectEvictions`/`selectReloads` — total, THREE-free, unit-tested). A ~5Hz timer in `useWorldEngine.js` computes per-root camera distance, calls `selectVisibility`, and applies `mesh.visible`. Roots-only: `projectObject` early-returns on an invisible parent and skips its whole subtree, so one `.visible` test collapses traversal of a linkset. Hide-don't-evict: far meshes stay resident in `meshMap` (instant re-show, no rebuild); memory eviction (`cullTick`) is unchanged.

**Tech Stack:** Vanilla JS, Three.js, `bun test` (lib unit tests), `vite build --mode staging` (build verification).

**Reference:** spec `docs/superpowers/specs/2026-06-15-render-distance-cull-design.md`. Model `docs/render-cache-model.md`. Slice 2 (static-flag) is separable and conditional on re-measuring after Slice 1.

---

## File Structure

- `src/lib/cullPolicy.js` — **modify**: add `selectVisibility(candidates, effNear, hysteresis)`. Pure ranking/decision module, no THREE/DOM.
- `src/__tests__/lib/cullPolicy.test.js` — **modify**: add `selectVisibility` describe block; update the import line.
- `src/composables/useWorldEngine.js` — **modify**: add `visibilityTick()` + a `_visTimer` (~200ms) started near `_cullTimer` (line ~4308) and cleared on unmount (line ~4578). Slice 2 also touches mesh build/position sites.

---

## Slice 1 — Visibility cull (the framerate win)

### Task 1: `selectVisibility` pure decision function

**Files:**
- Modify: `src/lib/cullPolicy.js` (append new export)
- Test: `src/__tests__/lib/cullPolicy.test.js`

- [ ] **Step 1: Write the failing tests**

Update the import on line 2 of `src/__tests__/lib/cullPolicy.test.js` to add `selectVisibility`:

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility } from '@/lib/cullPolicy.js'
```

Append this describe block to the end of `src/__tests__/lib/cullPolicy.test.js`:

```js
// FEATURE-GAPS #13 (render ceiling): the render-distance visibility cull hides root meshes beyond the
// governor radius _effNear (decoupled from memory eviction) so far objects stop being traversed every
// frame. Pure decision: distance-only with a hysteresis dead-zone; the engine pre-filters protected ids
// (avatars/own/edited) and passes each root's current .visible so only CHANGES are emitted.
describe('selectVisibility (#13 render-distance cull)', () => {
	it('hides currently-visible roots beyond effNear', () => {
		const cands = [{ id: 1, dist: 300, visible: true }, { id: 2, dist: 50, visible: true }]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [1] })
	})
	it('shows currently-hidden roots within (effNear - hysteresis)', () => {
		const cands = [{ id: 1, dist: 50, visible: false }, { id: 2, dist: 300, visible: false }]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [1], hide: [] })
	})
	it('hysteresis dead-zone: roots between (effNear - hyst) and effNear keep their state (no churn)', () => {
		// effNear=192, hyst=16 → dead zone (176, 192]
		const cands = [
			{ id: 1, dist: 185, visible: true },   // visible in band → stays visible (not re-hidden)
			{ id: 2, dist: 185, visible: false },  // hidden in band → stays hidden (not re-shown)
		]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('emits ONLY state changes (already-correct roots omitted)', () => {
		const cands = [
			{ id: 1, dist: 50, visible: true },    // near + already visible → no-op
			{ id: 2, dist: 300, visible: false },  // far + already hidden → no-op
		]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('boundary: dist exactly == effNear is NOT hidden (strict >)', () => {
		const cands = [{ id: 1, dist: 192, visible: true }]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('empty candidates → {show:[], hide:[]}', () => {
		expect(selectVisibility([], 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('does not mutate the input array', () => {
		const cands = [{ id: 1, dist: 300, visible: true }, { id: 2, dist: 50, visible: false }]
		selectVisibility(cands, 192, 16)
		expect(cands.map(c => c.id)).toEqual([1, 2])
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: FAIL — `selectVisibility is not a function` (or import error) on the new block; the existing 18 tests still pass.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/cullPolicy.js`:

```js
// Render-distance visibility cull (FEATURE-GAPS #13, render ceiling). Decides which ROOT meshes to
// show/hide by camera distance, with a hysteresis dead-zone so objects parked at the boundary don't
// flicker. WHY decoupled from selectEvictions: eviction only runs when OVER BUDGET, so on a region that
// fits in the heap nothing beyond _effNear is evicted and it all stays in the scene graph being
// traversed every frame (the "300m+ drawn at dd=192m" cost). Hiding a root makes THREE's projectObject
// early-return and skip its entire subtree → one .visible test collapses a whole linkset's traversal.
// The engine pre-filters protected ids (avatars/own/edited) — they are never passed here, so never
// hidden. `visible` is each root's current mesh.visible; we emit ONLY ids whose state must change so the
// caller writes the minimum number of .visible flags. Pure + total (no THREE/DOM).
export function selectVisibility(candidates, effNear, hysteresis) {
	const showAt = effNear - hysteresis
	const show = [], hide = []
	for (const c of candidates) {
		if (c.dist > effNear) { if (c.visible) hide.push(c.id) }       // beyond radius → hide if shown
		else if (c.dist < showAt) { if (!c.visible) show.push(c.id) }  // well inside → show if hidden
		// else: dead-zone (showAt, effNear] → keep current visibility
	}
	return { show, hide }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS — 25 tests pass (18 existing + 7 new), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cullPolicy.js src/__tests__/lib/cullPolicy.test.js
git commit -m "feat(render): add selectVisibility cull policy (#13)"
```

---

### Task 2: Wire the visibility pass into the engine

**Files:**
- Modify: `src/composables/useWorldEngine.js`
  - import (top of file, the existing `cullPolicy.js` import line)
  - constant + `visibilityTick()` near `cullTick` (function at line ~3374; add the new function just before or after it)
  - timer start near line ~4308 (`_cullTimer = setInterval(...)`)
  - timer teardown near line ~4578 (`if (_cullTimer) { clearInterval(_cullTimer); ... }`)

This task has no unit test (it touches THREE/camera/DOM); it is verified by `bun test` (no regressions) + `vite build --mode staging` green + live re-measure with the `[Main] phases` probe.

- [ ] **Step 1: Add `selectVisibility` to the cullPolicy import**

Find the existing import of `cullPolicy.js` in `src/composables/useWorldEngine.js` (it imports `selectEvictions`, `selectReloads`, `groupChildrenByRoot`, `drawDistanceMayGrow`, `orderByDistance`). Add `selectVisibility` to that destructured import. Example shape (match the actual existing line — do not duplicate the import):

```js
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility } from '@/lib/cullPolicy.js'
```

- [ ] **Step 2: Add the hysteresis constant and the `_visTimer` handle**

Near the other draw-distance constants (after `DRAW_DIST_STEP` at line ~340) add:

```js
	// Render-distance visibility cull (FEATURE-GAPS #13, render ceiling): hysteresis band (m) for the
	// show/hide boundary at _effNear. Hidden beyond _effNear, shown within (_effNear - this) → no flicker
	// for objects parked at the edge. Runs ~5×/s (own timer) — far cheaper than the per-frame traversal
	// it removes. Hides only (keeps meshes resident for instant re-show); eviction stays VRAM-driven.
	const VIS_CULL_HYSTERESIS = 16
```

Near `let _cullTimer = null` (line ~310) add:

```js
	let _visTimer = null         // render-distance visibility cull tick (~200ms) — FEATURE-GAPS #13
```

- [ ] **Step 3: Write `visibilityTick()`**

Add this function adjacent to `cullTick` (e.g. immediately after the `function cullTick() { ... }` block, before `function reparentOrphans`/whatever follows). It reuses `camDistToObj`, `meshMap`, `worldStore`, `_effNear`, `PCODE_AVATAR`, `ownAvatarLocalId`, `uiStore`, and the `selectVisibility` import — all already in scope:

```js
	// Render-distance visibility cull (FEATURE-GAPS #13, render ceiling). Hide ROOT meshes beyond the
	// governor radius _effNear so WebGLRenderer.render stops traversing them every frame; show them again
	// within the hysteresis band. Decoupled from memory eviction (cullTick): eviction only fires over
	// budget, so on a region that fits the heap nothing beyond _effNear is otherwise removed → it all gets
	// traversed (the 3–6fps "300m+ drawn at dd=192m" cost). Roots only — projectObject early-returns on an
	// invisible parent and skips the whole subtree, so one .visible flag collapses a linkset's traversal.
	// Hide, don't evict: meshes stay resident in meshMap (instant re-show, no rebuild). Cheap: a distance
	// compare + boolean write per root, no allocation in the hot loop. ~5Hz is enough for snappy
	// pop-in. Protected ids (avatars/own/edited) are excluded here → never hidden.
	function visibilityTick() {
		if (!camera) return
		const editId = uiStore.editObjectId
		const cands = []
		for (const [id, mesh] of meshMap) {
			const obj = worldStore.objects.get(id)
			if (!obj) continue                          // KillObject race — leave for cullTick/removeMesh
			if ((obj.parentId ?? 0) !== 0) continue     // children ride their root's visibility
			if (obj.pcode === PCODE_AVATAR) continue    // never hide avatars
			if (id === ownAvatarLocalId || id === editId) continue  // never hide own/edited
			cands.push({ id, dist: camDistToObj(obj), visible: mesh.visible })
		}
		const { show, hide } = selectVisibility(cands, _effNear, VIS_CULL_HYSTERESIS)
		for (const id of show) { const m = meshMap.get(id); if (m) m.visible = true }
		for (const id of hide) { const m = meshMap.get(id); if (m) m.visible = false }
	}
```

- [ ] **Step 4: Start the timer**

After the `_cullTimer = setInterval(...)` line (~4308) add:

```js
		_visTimer = setInterval(() => timed('vis', visibilityTick), 200)
```

- [ ] **Step 5: Tear down the timer on unmount**

Next to the `_cullTimer` teardown (~4578: `if (_cullTimer) { clearInterval(_cullTimer); _cullTimer = null }`) add:

```js
		if (_visTimer) { clearInterval(_visTimer); _visTimer = null }
```

- [ ] **Step 6: Verify no test regressions**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS — 25 tests, 0 fail (engine wiring doesn't touch the lib tests; this confirms nothing broke).

- [ ] **Step 7: Verify the build**

Run: `npm run build:staging`
Expected: build completes with no errors (dist/staging/ written).

- [ ] **Step 8: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): hide roots beyond _effNear via vis cull (#13)"
```

- [ ] **Step 9: Live verification (with Gene)**

On a heavy region with the `[Main] phases` probe active: confirm `render=…ms/window` drops substantially vs the pre-change 1671–2546ms, frames climb toward 30–60, and springback (AgentUpdate-starved snap-back) is gone, with no near-scene popping or missing surroundings. Record the before/after `render` numbers — they feed the Slice 2 go/no-go decision. Per [[no-regressions-once-stable]], "done" = usable experience, not green tests; Gene commits.

---

## Slice 2 — Static-flag (`updateMatrixWorld`) — CONDITIONAL

> **Do NOT start Slice 2 until Slice 1 is live-verified and the re-measured `render` number is known.**
> Slice 1 removes `projectObject` traversal of hidden subtrees. Slice 2 targets the *separate*
> per-frame `updateMatrixWorld` recursion (paid even by hidden nodes). Build it ONLY if `updateMatrixWorld`
> is still a meaningful share of `render` after Slice 1. If Slice 1 already hits the framerate goal, this
> slice is YAGNI — stop and close #13's render slice.

### Task 3: Disable per-frame matrix recompute on static prims

**Files:**
- Modify: `src/composables/useWorldEngine.js` — the mesh-build site (where a prim mesh is created and first positioned, around the `scene.add(mesh)` / `parentMesh.add(mesh)` block ~line 2197–2253) and every site that mutates a built prim's position/rotation/scale (the TerseUpdate/ObjectUpdate position-apply path).

This task has no unit test (THREE/DOM); verified by `bun test` (no regressions) + `vite build --mode staging` + live re-measure.

- [ ] **Step 1: Flag prim meshes static at build time**

At the prim-mesh build site, after the mesh's initial position/quaternion/scale are set and before/after `scene.add`, mark static prims so THREE stops recomputing their world matrix every frame. Do NOT apply to avatars (PCODE_AVATAR) or any mesh that animates. Pattern:

```js
		// Static prims don't move after placement → skip the per-frame updateMatrixWorld recompute
		// (FEATURE-GAPS #13 render ceiling, Slice 2). Avatars keep autoUpdate (they move every frame).
		// Any code that later mutates this mesh's transform MUST call mesh.updateMatrix() (see position-apply path).
		if (obj.pcode !== PCODE_AVATAR) {
			mesh.matrixAutoUpdate = false
			mesh.updateMatrix()
		}
```

- [ ] **Step 2: Refresh the matrix wherever a built prim is repositioned**

In the position/rotation apply path for already-built prims (the TerseUpdate / `updateObjectPos` consumer that sets `mesh.position` / `mesh.quaternion` on an existing mesh — NOT the GSAP-tweened avatar path), add an explicit matrix refresh after the transform write:

```js
		// matrixAutoUpdate is false on static prims (#13 Slice 2) → must refresh the matrix by hand
		// after a sim-driven move, or the mesh renders at its stale placement.
		if (mesh.matrixAutoUpdate === false) mesh.updateMatrix()
```

(If the avatar position path uses GSAP onUpdate, leave it untouched — avatars keep `matrixAutoUpdate = true`.)

- [ ] **Step 3: Verify no test regressions**

Run: `bun test src/__tests__/lib/cullPolicy.test.js`
Expected: PASS — 25 tests, 0 fail.

- [ ] **Step 4: Verify the build**

Run: `npm run build:staging`
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "perf(render): static matrix flag on prims (#13)"
```

- [ ] **Step 6: Live verification (with Gene)**

Confirm static prims still render at correct positions, sim-moved prims (animated/scripted) still track, avatars move smoothly, and `render`/`updateMatrixWorld` share drops further. Gene commits.

---

## Post-implementation

- Update `docs/FEATURE-GAPS.md` #11/#13 rows + `docs/render-cache-model.md` Next-work list with measured before/after `render` numbers and whether Slice 2 was needed.
- Update memory: a new `render-distance-cull-shipped` note (link `[[texture-read-starvation-tamed]]`, `[[render-cache-unified-model]]`).
- If Slice 1 alone meets the goal, mark Slice 2 stood-down (YAGNI) rather than leaving it open.
