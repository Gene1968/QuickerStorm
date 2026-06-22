# Load-Time Render Pacing — Design

**Date:** 2026-06-21
**Status:** Approved (design), pre-implementation
**Branch:** `ai/mesh-lod` (sits under the mesh-LOD WIP; this is the starvation fix LOD depends on)

## Problem

On a warm heavy region (Aspen, 6.64 GB cached), the load crawls (~24 obj/s, ~16 min) even
though the warm cache is provably hittable (live `idb=162` in one window). Root cause is
the long-standing main-thread starvation (`[[idb-mainthread-starvation-rootcause]]`):
rendering ~24k objects within the full 192 m draw distance eats each frame, so the cache
worker's reply *macrotasks* (`postMessage` → resolves `geomCacheGetMany`) don't get
scheduled. `_geomPending` then sticks at `BAKE_INFLIGHT_CAP` (300), the drain breaks on the
cap every tick (`brkCap`), and missed reads re-bake → re-fetch → re-saturate. `idb` oscillates
`162 → 0 → 0`.

Phase 1 removed the fps-driven `_renderCap`, which had incidentally kept frames short enough
for replies to flow. We need that protection back — but **gated on load state, not fps**, so
it always recovers (the old cap floored at 32 m and never came back, which is why it was removed).

## Goal

While the scene is actively loading, keep frames cheap (render a near bubble) so worker replies
flow and the warm cache fills fast; then **fully restore** the user's 192 m view the instant the
load settles. Only what is *drawn* shrinks, briefly — the *build* radius (`_effNear`) and eviction
stay at the user target throughout, so the whole scene still builds (near-first) and is resident,
just hidden beyond the bubble until settle.

## Non-goals

- No change to `_effNear` (build/eviction radius), the memory governor, or LOD.
- No permanent draw-distance reduction. No fps-driven behavior.
- qs-mesh off-thread (the deferred cache-IO-worker Phase 2) is a *separate, complementary* item
  for cold loads — not this spec.

## Design

Two small additions in `useWorldEngine.js`; everything downstream already keys off `renderRadius()`.

### 1. Load-active detector (`_loadActive`)

Computed in `cullTick` (~5 Hz) with hysteresis on `pendingMeshIds.size` (the build queue):

- **Engage** when `pendingMeshIds.size > LOAD_ON` (≈400).
- **Release** when `pendingMeshIds.size < LOAD_OFF` (≈64).
- **Stall failsafe:** also release if `pendingMeshIds.size` has not *decreased* for `LOAD_STALL_MS`
  (≈10 s). Tracked via `_loadLastQ` / `_loadLastProgressAt`, updated each cullTick. This guarantees
  the clamp can never latch the way the old fps cap did — if pacing isn't producing progress, full
  render is no worse, so we lift it.

### 2. `renderRadius()` clamp

```js
function renderRadius() {
	const target = Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT)
	return _loadActive ? Math.min(target, LOAD_RENDER_RADIUS) : target
}
```

That is the only behavior change. The `selectVisibility` cull (hide beyond `renderRadius()`), the
near-aware diffuse-texture gate (`camDistToObj(obj) <= renderRadius()`), and the `rcap` telemetry
all already read `renderRadius()`, so they shrink to the bubble during load and restore on settle
with no further changes.

### Constants (live-tunable)

| Name | Value | Role |
|------|-------|------|
| `LOAD_RENDER_RADIUS` | 64 m | rendered radius while loading |
| `LOAD_ON` | 400 | engage clamp above this buildQ |
| `LOAD_OFF` | 64 | release clamp below this buildQ |
| `LOAD_STALL_MS` | 10000 | release if buildQ hasn't dropped in this long (anti-latch) |

## Why it works

Cheap frames (≈64 m bubble = ~11% of the 192 m disc area) → the event loop processes the worker's
reply macrotasks between frames → `geomCacheGetMany` resolves → `_geomPending` drains below the cap
→ the drain runs → warm-cache hits (geom + the LOD warm-high fallback) build objects fast → buildQ
drains → `_loadActive` releases → full 192 m view, with the already-built far objects shown from cache.

## Testing

- **Unit:** extract the pacing decision as a pure helper if clean, or rely on the existing cull
  tests; the clamp is a one-line min(). Build + 254 lib tests stay green.
- **Live-verify on warm Aspen (hard reload):** `idb` stays **high** during load (no `→0` collapse),
  `buildQ` drains fast, a ~64 m bubble renders during load, then the full 192 m scene appears within
  a second or two of settle; `rcap` shows ~64 → 192. No latch (radius always returns to 192 m).

## Risk

- **Bubble feels small during a long load** — acceptable (transient, SL-like near-first reveal),
  and `LOAD_RENDER_RADIUS` is tunable up if 64 m is too tight.
- **Latch** — covered by the stall failsafe.
- **Thrash at the hysteresis boundary** — `LOAD_ON`/`LOAD_OFF` gap (400 vs 64) prevents flapping.
