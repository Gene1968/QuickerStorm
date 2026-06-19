# Hover Cursor & ClickAction Design

**Date:** 2026-06-18
**Status:** Approved

## Problem

All objects show an enabled Touch item in the right-click menu regardless of whether touching them does anything. No cursor feedback exists on hover — the user has no signal about what clicking an object will do before they click it.

## Goal

Match FS hover behaviour: cursor changes to a hand as soon as the pointer enters a touchable object; a small badge icon next to the pointer communicates the action type (Sit, Buy, Pay, Zoom, etc.); Touch is disabled in the context menu only when the object explicitly declares itself non-interactive.

Tooltip (object name on hover delay) is out of scope — tracked in FEATURE-GAPS line 116.

---

## Data Layer

### Source: `ClickAction` U8 in ObjectUpdate

`ClickAction` is a U8 field in ObjectUpdate's ObjectData block (after `Material`, before `Scale`). It is the single resolved value the simulator broadcasts — no flag-combining needed on the client. It is also present in ObjectUpdateCompressed.

| Value | Meaning |
|-------|---------|
| 0 | Touch (default) |
| 1 | Sit |
| 2 | Buy |
| 3 | Pay |
| 4 | Open |
| 5 | PlayAnim |
| 6 | Zoom |
| 7 | Disabled (no interaction) |

### Server: `server/lib/lludp-codec.ts`

Add `clickAction: number` to both the ObjectUpdate and ObjectUpdateCompressed decode paths. Forward it in the WS message payload alongside existing fields (`localId`, `pos`, etc.). Default `0` if the field is missing or unreadable.

### Client: `src/stores/worldStore.js`

`upsertObject` stores `clickAction` on the object record. Default `0` if absent (existing records and objects that arrive before the field is decoded behave as Touch — safe fallback).

No DB/cache version bump required — ClickAction is volatile per-session data, not persisted geometry.

### Future: ObjectEditFloater line 562

The Click Action dropdown in the edit floater will eventually read and write this field. That is out of scope for this spec.

---

## Hover System

### Listener

A `pointermove` handler on the Three.js canvas, throttled to fire at most every 80 ms. Set up in `mountEngine`, torn down in `unmountEngine` alongside existing click/right-click listeners.

### Raycast

Reuses `_pickTargets` (same array as right-click). On a hit, walk to the root object and read `clickAction` from `worldStore.objects`. Expose a reactive `hoverAction` ref (null | 0–7) and `hoverPos` ref (`{ x, y }`) from `useWorldEngine` to `WorldView`.

On canvas `pointerleave` or no hit: set `hoverAction = null`.

### Edit-floater override

When `uiStore.floaterStack` includes `'object-edit'`, skip the raycast entirely and set canvas `cursor = 'crosshair'`. Hide the badge. Consistent with left-click selecting rather than touching in that mode.

### Canvas cursor

| Condition | `canvas.style.cursor` |
|-----------|----------------------|
| ClickAction 1–6 (any interactive) | `pointer` |
| ClickAction 0 (Touch) | `pointer` |
| ClickAction 7 (Disabled) or no hit | `default` |
| Edit floater open | `crosshair` |

### Badge component: `HoverCursorBadge.vue`

A `pointer-events-none` absolutely-positioned div rendered in `WorldView` (inside the canvas wrapper). Visible only when `hoverAction` is non-null and not 0 (plain Touch needs no badge — hand cursor alone is sufficient).

Positioned at `hoverPos.x + 16, hoverPos.y + 4` (bottom-right of cursor tip).

| ClickAction | Icon |
|-------------|------|
| 1 Sit | chair |
| 2 Buy | shopping-bag |
| 3 Pay | banknotes / coin |
| 4 Open | archive-box / open |
| 5 PlayAnim | play-circle |
| 6 Zoom | magnifying-glass |

Icons sourced from whichever icon set is already in use in the project (Heroicons). Small fixed size (18 × 18 px), `bg-panel/80 rounded-sm` backdrop for legibility over varied backgrounds.

---

## Context Menu

### `ObjectContextMenu.vue` — Touch item

Disable the Touch button when `menu.clickAction === 7`. The menu payload (`uiStore.objectMenu`) already carries `localId`; add `clickAction` to the payload when `openObjectMenu` is called (read from worldStore at that point).

All other ClickAction values leave Touch enabled — any object can be grabbed/touched, and ClickAction 1–6 objects may still respond to touch events in some scripts.

---

## Out of Scope

- Hover tooltip (object name / description delay) — FEATURE-GAPS line 116
- ClickAction editing in ObjectEditFloater — line 562, separate feature
- Avatar hover cursor changes
- Custom cursor images (using icon badge overlay instead)
