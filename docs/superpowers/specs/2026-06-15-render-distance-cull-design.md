# Render-distance visibility cull — design (FEATURE-GAPS #13, render ceiling)

> Written 2026-06-15 after #11 (texture read-starvation) was tamed and committed. The exposed ceiling
> is now **render**: `[Main] phases render=1671–2546ms/window` dominates as objects build; far objects
> (~300m+) are drawn while `dd=192m` → 3–6fps + springback (AgentUpdate starved). Read
> `docs/render-cache-model.md` first — this is the "cull far OUT of the scene graph" item from its
> Next-work list, the smallest high-leverage slice of the render ceiling.

## Problem

`WebGLRenderer.render` walks the scene graph every frame — `projectObject` + `updateMatrixWorld` over
~9k+ nodes. Frustum culling already cuts actual **draw calls** to 8–663/frame (which is why #6
draw-call instancing was stood down), so the lever is **traversing fewer nodes**, not drawing fewer.

Root cause of "300m+ drawn at dd=192m": memory eviction (`cullTick`) only fires when **over budget**
(`appRatio > 1.0` or heap crisis). When memory has headroom, nothing beyond `_effNear` is evicted *or
hidden* — every object the sim ever sent stays resident **and visible**, so it is all traversed every
frame. `_effNear` is a *memory-eviction* radius, not a *render-distance* cull.

## Goal

Target **A**: smooth framerate (~30–60fps) + kill springback on heavy regions. NOT bigger draw distance
(B) and NOT fitting bigger regions in the 4GB heap (C) — those are deferred.

## Design

### 1. Render-distance visibility cull (slice 1, the win)

A lightweight pass that toggles `mesh.visible` on **root** meshes by camera distance, decoupled from
the memory-eviction path. One radius (`_effNear`), two consequences: **hide always**; **evict only
under budget pressure** (unchanged).

- **Hide** a root when `camDist > _effNear`.
- **Show** a root when `camDist < _effNear − HYSTERESIS` (band ~16m → no edge flicker for objects
  parked at the boundary).
- Roots between the band keep their current visibility (hysteresis dead-zone).
- **Roots only.** Children ride their parent: `projectObject` early-returns on an invisible parent and
  never visits the subtree (verified THREE behavior), so hiding one linkset root collapses traversal of
  all its prims in a single `.visible` test. This is the entire framerate win. Iterate roots in
  `meshMap` (those with `parentId === 0`, or absent from a parent).
- **Hide, don't evict.** Far objects stay resident in `meshMap` → instant re-show on approach, no
  rebuild, no IDB/bake churn. Helps framerate (A), intentionally does NOT help heap (C).
- **Protected set** (never hidden): avatars (`pcode === PCODE_AVATAR`), `ownAvatarLocalId`, and the
  currently edited object (`uiStore.editObjectId`). Mirrors the eviction protected-set so a seated/edited
  object never vanishes.
- Interaction with eviction: when memory pressure shrinks `_effNear`, beyond-`_effNear` objects are
  hidden by this pass AND disposed by `cullTick` — disposal removes them from `meshMap` so the next
  visibility pass simply skips them. No double-system, no conflict. When pressure clears and `_effNear`
  grows back, `cullTick` rebuilds (already-resident-or-reloaded) and the visibility pass shows them.

### 2. Cadence

- Run the visibility pass on a **throttled timer at ~5Hz (every ~200ms)**, separate from the 1s
  `cullTick`. The test is sub-millisecond (a squared-distance compare + boolean set per root, no
  allocation) — far cheaper than the per-frame `projectObject` cost it removes.
- Use **squared distance** vs `_effNear²` (and `(_effNear − HYSTERESIS)²`) — no `sqrt`.
- Read `_effNear` live each pass so visibility follows the governor as it shrinks/grows.
- Deliberately NOT on the per-frame `animate()` loop — 5Hz makes pop-in feel immediate at ~zero cost.

### 3. Static-flag optimization (slice 2, separable — land + measure after slice 1)

`updateMatrixWorld` recurses every frame over the whole graph regardless of `.visible`. Prims are static:

- Set `mesh.matrixAutoUpdate = false` on static prim meshes after positioning; call `mesh.updateMatrix()`
  once when the transform is set, and again on each TerseUpdate position change (sim-moved prims are the
  rare exception that still need it).
- Avatars and actively-moving/edited objects keep `matrixAutoUpdate = true`.
- **Sequencing:** land slice 1 first, re-measure with the `[Main] phases` probe; add slice 2 only if
  `updateMatrixWorld` is still a meaningful share of `render`. Keeps each change independently verifiable.

## Components / boundaries

- **`src/lib/cullPolicy.js`** — new pure function `selectVisibility(candidates, effNear, hysteresis)`
  where `candidates = [{ id, dist, visible }]` → `{ show: id[], hide: id[] }`. No THREE, no DOM. Mirrors
  the existing `selectEvictions` / `selectReloads` / `orderByDistance` style (total, unit-testable). Only
  emits ids whose visibility must CHANGE (objects already in the correct state are omitted → minimal
  `.visible` writes).
- **`src/composables/useWorldEngine.js`** — owns THREE/camera; computes `camDistToObj` per root, calls
  `selectVisibility`, applies `mesh.visible = …`, and drives the ~5Hz timer (alongside the existing
  `_cullTimer`). Slice 2 touches the mesh-build/position sites for `matrixAutoUpdate`.

## Error handling / edge cases

- Stale ids: a root in `meshMap` whose `worldStore.objects` entry is gone → skip (KillObject race), same
  guard as `cullTick`.
- A hidden root that the edit/selection system later targets: the protected-set check runs each pass, so
  selecting a far object (e.g. via Map/double-click) re-shows it on the next tick; if instant visibility
  is needed at selection time, the selection handler can force `.visible = true` directly.
- Children evicted then a root re-shown: visibility only sets `.visible` on what's in `meshMap`; rebuild
  of evicted children remains `cullTick`'s job (unchanged).

## Testing

- **Unit (vitest):** `selectVisibility` — hysteresis dead-zone (no churn mid-band), boundary at exactly
  `_effNear`, protected ids excluded by the caller (policy is distance-only; caller filters protected),
  only-changed-ids emitted, empty input.
- **Live:** `[Main] phases` probe already reports `render=…ms/window`. Success = that number drops
  substantially on a heavy region and frames climb toward 30–60 with no springback. Confirm with Gene on
  a live heavy region before calling done (per [[no-regressions-once-stable]]: "done" = usable, not green
  tests).

## Out of scope (YAGNI)

- Distance fade / soft horizon (rejected: re-introduces transparency draw-order cost, works against A).
- Spatial bucketing / octree (Option B) — the structural follow-up if slice-1 near-set traversal is still
  heavy; separate spec.
- Off-thread / OffscreenCanvas render (Option C) — deep ceiling fix, deferred.
- Proactive eviction beyond render distance — intentionally not done; hide-resident is the framerate win.
