# Selection Edge Highlights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw yellow edge-highlight overlays on the selected prim (root) and light-blue overlays on all linked children while Build Tools is open, matching Firestorm's selection feedback.

**Architecture:** `EdgesGeometry` + `LineSegments` parented to each target mesh (inherits transform for free). A `highlightLines[]` array tracks live overlays for disposal. Three new functions (`_addHighlight`, `clearHighlight`, `refreshHighlight`) and one new watch live in the existing gizmo section of `useWorldEngine.js`. No per-frame repositioning needed — overlays move with their parent meshes.

**Tech Stack:** Three.js (`EdgesGeometry`, `LineSegments`, `LineBasicMaterial`), Vue `watch`, existing `useWorldEngine.js` gizmo infrastructure.

---

### Task 1: State, constants, and helper functions

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Add `highlightLines` state variable after the gizmo state block**

In `useWorldEngine.js`, find the two lines at ~689–690:
```js
let gizmoGroup    = null  // THREE.Group | null
let gizmoMeshId   = null  // localId the gizmo is currently tracking, for repositioning
```
Add one line immediately after them:
```js
let highlightLines = []   // LineSegments[] — one per highlighted prim, cleared on selection change
```

- [ ] **Step 2: Add color constants near the existing gizmo color constants**

Find the existing gizmo color block at ~1683–1686:
```js
const _GIZMO_X = 0xff5555
const _GIZMO_Y = 0x55ff55
const _GIZMO_Z = 0x5588ff
```
Add two lines immediately after them:
```js
const _HL_ROOT  = 0xffee00  // FS gold-yellow — selected root or solo prim
const _HL_CHILD = 0x7ab8ff  // FS light blue  — linked child prims
```

- [ ] **Step 3: Add `clearHighlight` and `_addHighlight` and `refreshHighlight` functions**

Find the end of `resolveRootLocalId` (~line 1767) — the closing `}` before the blank line before `function refreshGizmo()`. Insert the three new functions in that gap:

```js
	function clearHighlight() {
		for (const ls of highlightLines) {
			ls.geometry.dispose()
			ls.material.dispose()
			ls.parent?.remove(ls)
		}
		highlightLines = []
	}

	function _addHighlight(localId, color) {
		if (uiStore.instancing) promoteOut(localId)
		const mesh = meshMap.get(localId)
		if (!mesh || !mesh.geometry) return
		const edges = new THREE.EdgesGeometry(mesh.geometry)
		const mat   = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })
		const lines = new THREE.LineSegments(edges, mat)
		lines.renderOrder = 998
		mesh.add(lines)
		highlightLines.push(lines)
	}

	function refreshHighlight() {
		clearHighlight()
		if (!uiStore.showObjectEdit || !uiStore.editObjectId) return
		const id = uiStore.editObjectId
		if (uiStore.editLinked) {
			// Single prim (root or child depending on what was clicked) — yellow only.
			_addHighlight(id, _HL_ROOT)
		} else {
			// Whole linkset: root=yellow, children=light blue.
			// editObjectId is always the root when editLinked is false (enforced by click handler + openObjectEdit).
			_addHighlight(id, _HL_ROOT)
			for (const [cid, o] of worldStore.objects) {
				if ((o.parentId ?? 0) === id) _addHighlight(cid, _HL_CHILD)
			}
		}
	}
```

- [ ] **Step 4: Run tests to confirm no regressions**

```
npm run build:staging
```
Expected: build completes with no errors (no vitest failures on pure lib tests since Three.js scene code is not unit-tested).

- [ ] **Step 5: Commit**

```
git add src/composables/useWorldEngine.js
git commit -m "feat(engine): selection edge highlight functions"
```

---

### Task 2: Wire watches and unmount cleanup

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Expand `stopGizmoSelWatch` to also call `refreshHighlight`**

Find line ~234:
```js
	const stopGizmoSelWatch  = watch(() => uiStore.editObjectId,    () => refreshGizmo())
```
Replace with:
```js
	const stopGizmoSelWatch  = watch(() => uiStore.editObjectId,    () => { refreshGizmo(); refreshHighlight() })
```

- [ ] **Step 2: Expand `stopGizmoVisWatch` to also manage highlights**

Find line ~250:
```js
	const stopGizmoVisWatch  = watch(() => uiStore.showObjectEdit, (v) => { if (!v) clearGizmo(); else refreshGizmo() })
```
Replace with:
```js
	const stopGizmoVisWatch  = watch(() => uiStore.showObjectEdit, (v) => { if (!v) { clearGizmo(); clearHighlight() } else { refreshGizmo(); refreshHighlight() } })
```

- [ ] **Step 3: Add new watch for `editLinked` toggle**

Immediately after the `stopGizmoVisWatch` line (line ~250), add:
```js
	const stopHlLinkedWatch  = watch(() => uiStore.editLinked,     () => refreshHighlight())
```

- [ ] **Step 4: Stop the new watch in the unmount block**

Find the unmount stop-watch cluster at ~4708–4710:
```js
		stopGizmoSelWatch()
		stopGizmoModeWatch()
		stopGizmoVisWatch()
```
Add the new stop call as a fourth line:
```js
		stopGizmoSelWatch()
		stopGizmoModeWatch()
		stopGizmoVisWatch()
		stopHlLinkedWatch()
```

- [ ] **Step 5: Call `clearHighlight()` in the unmount cleanup block**

Find line ~4721:
```js
		clearGizmo()
```
Replace with:
```js
		clearGizmo()
		clearHighlight()
```

- [ ] **Step 6: Run tests to confirm no regressions**

```
npm run build:staging
```
Expected: clean build, no errors.

- [ ] **Step 7: Commit**

```
git add src/composables/useWorldEngine.js
git commit -m "feat(engine): wire selection highlight watches + unmount"
```

---

### Task 3: Manual visual verification

**Files:** none — observation only

- [ ] **Step 1: Start the dev server**

```
npm run dev
```
Log in to a region with at least one multi-prim linkset visible.

- [ ] **Step 2: Verify linkset root selection — whole linkset, editLinked OFF**

Right-click a prim that is the root of a linkset → Edit…

Expected:
- Root prim: yellow edge overlay visible
- Every child prim: light-blue edge overlay visible
- Gizmo arrows appear as normal
- Build Tools floater opens with "Edit linked" checkbox unchecked

- [ ] **Step 3: Verify linkset child right-click → Edit resolves to root**

Right-click a known child prim of a linkset → Edit…

Expected: same as Step 2 — root gets yellow, all children get light blue (root was resolved by `openObjectEdit`).

- [ ] **Step 4: Verify single unlinked prim**

Right-click or left-click an unlinked prim (no children, no parent) → Edit…

Expected: yellow overlay on that prim only, no light-blue overlays.

- [ ] **Step 5: Verify editLinked ON — click child**

With Build Tools open, check "Edit linked" checkbox, then left-click a child prim of a linkset.

Expected:
- Only the clicked child has a yellow overlay
- No light-blue overlays on siblings or root
- Gizmo repositions to the child

- [ ] **Step 6: Verify editLinked toggle on existing selection**

Select a linkset root (editLinked OFF → root=yellow, children=blue), then check "Edit linked".

Expected:
- Light-blue overlays disappear from children
- Root retains yellow (it's still `editObjectId`)

Uncheck "Edit linked".

Expected: light-blue overlays reappear on children.

- [ ] **Step 7: Verify closing Build Tools clears overlays**

With a linkset selected and overlays visible, close the Build Tools floater (✕ button or click away).

Expected: all edge overlays disappear immediately, gizmo also disappears.

- [ ] **Step 8: Commit any fix if something was wrong; otherwise done**

If all steps pass, no commit needed. If a bug was found and fixed, commit with:
```
git add src/composables/useWorldEngine.js
git commit -m "fix(engine): <describe what was wrong>"
```
