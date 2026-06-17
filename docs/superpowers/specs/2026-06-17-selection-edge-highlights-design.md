# Selection Edge Highlights Design

**Date:** 2026-06-17
**Scope:** `src/composables/useWorldEngine.js` only (~80 lines)
**Status:** Approved

## Problem

When Build Tools (ObjectEditFloater) is open and an object is selected, there is no visual on-mesh feedback beyond the gizmo arrows/rings. Firestorm highlights the selected object's edges in yellow (root or solo prim) and children in light blue, making it immediately obvious which prim(s) belong to the linkset being edited.

## Approach

`EdgesGeometry` + `LineSegments` parented directly to each target mesh. Parenting to the mesh means the overlay inherits the mesh's world transform for free — no per-frame repositioning needed (unlike the gizmo, which is at scene root). Disposal on clear is the only lifecycle concern.

Chosen over:
- `material.wireframe = true` — modifies existing material state, hard to restore correctly across face-material arrays
- `WireframeGeometry` — draws every triangle interior edge, looks noisy on sculpts/mesh
- `OutlinePass` (EffectComposer) — requires render pipeline rework, out of scope

## State

```js
let highlightLines = []  // LineSegments[], one per highlighted prim — for disposal
```

## Constants

```js
const _HL_ROOT  = 0xffee00  // FS gold-yellow — root prim or solo selection
const _HL_CHILD = 0x7ab8ff  // FS light blue  — child prims
```

## Functions

### `_addHighlight(localId, color)`

1. If instancing is on, call `promoteOut(localId)` (same as gizmo) so an individual mesh exists.
2. `const mesh = meshMap.get(localId)` — return early if absent or `!mesh.geometry`.
3. `const edges = new THREE.EdgesGeometry(mesh.geometry)`
4. `const mat   = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 })`
5. `const lines = new THREE.LineSegments(edges, mat)`
6. `lines.renderOrder = 998` — renders above scene but below gizmo (999).
7. `mesh.add(lines)` — inherits transform.
8. `highlightLines.push(lines)`

### `clearHighlight()`

```
for (const ls of highlightLines) {
    ls.geometry.dispose()
    ls.material.dispose()
    ls.parent?.remove(ls)
}
highlightLines = []
```

### `refreshHighlight()`

1. `clearHighlight()`
2. Guard: if `!uiStore.showObjectEdit || !uiStore.editObjectId` → return.
3. `const id = uiStore.editObjectId`
4. **`editLinked` ON** → `_addHighlight(id, _HL_ROOT)` — single prim (could be root or a child), yellow.
5. **`editLinked` OFF** → `_addHighlight(id, _HL_ROOT)` for root, then scan `worldStore.objects` for every entry whose `(o.parentId ?? 0) === id` and `_addHighlight(childId, _HL_CHILD)`.

When `editLinked` is off, `editObjectId` is always the root (enforced by the click handler and `openObjectEdit`), so using it directly as the root key for the children scan is safe.

## Wiring

### Existing watch callbacks — expand in-place (no new `stop*Watch` vars)

| Watch | Current | Addition |
|---|---|---|
| `editObjectId` | `refreshGizmo()` | `+ refreshHighlight()` |
| `gizmoMode` | `refreshGizmo()` | _(no change needed — highlight doesn't depend on gizmo mode)_ |
| `showObjectEdit` | `clearGizmo()` or `refreshGizmo()` | `+ clearHighlight()` or `+ refreshHighlight()` |

### New watch

```js
const stopHlLinkedWatch = watch(() => uiStore.editLinked, () => refreshHighlight())
```

Registered alongside the other gizmo watches; stopped in `onUnmounted`.

### Unmount

```js
clearHighlight()
```

Added next to the existing `clearGizmo()` call in the unmount cleanup block.

## Behavior Summary

| Scenario | Highlight result |
|---|---|
| Build Tools closed | Nothing |
| Build Tools open, single unlinked prim selected | Yellow edges on that prim |
| Build Tools open, linkset root selected (`editLinked` OFF) | Yellow on root, light blue on every child |
| Build Tools open, child selected (`editLinked` ON) | Yellow on that child only |
| Selection changes (new `editObjectId`) | Old highlights cleared, new ones drawn |
| `editLinked` toggled | `refreshHighlight()` redraws accordingly |

## Edge Cases

- **Instanced prim selected**: `promoteOut` is called before mesh lookup — same as gizmo. If the mesh isn't available yet after promotion, `_addHighlight` returns early; the next selection event retries.
- **Evicted mesh**: `LineSegments` is parented to the mesh. If the mesh is removed from the scene during eviction, the overlay disappears with it. The next `clearHighlight()` still disposes geometry/material correctly via `ls.parent?.remove`.
- **High-poly sculpts/mesh prims**: `EdgesGeometry` on dense geometry produces many line segments but they render as a `LineSegments` draw call — inexpensive. Visual noise on very high-poly mesh is a known trade-off; refinement (e.g. `crease-angle` threshold) deferred.
- **Face-material meshes** (`Array.isArray(mesh.material)`): geometry is a single `BufferGeometry` regardless — `EdgesGeometry` works identically.

## Out of Scope

- Animated highlight (pulse/glow) — post-processing required
- Per-face highlight when a face is selected in face-edit mode
- Highlight for multi-object selections (Phase 3+)
