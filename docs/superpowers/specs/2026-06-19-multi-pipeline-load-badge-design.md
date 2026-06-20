# Multi-pipeline load badge — design

**Date:** 2026-06-19
**Area:** UI — SceneLoadBadge / scene-load telemetry
**Status:** approved, implementing

## Problem

The scene-load badge tracks only **prim geometry %** and **textures**. It hides (reads "done")
when geometry `pct` reaches 100 and textures are quiescent — but the **mesh-asset** and **sculpt-asset**
download pipelines are invisible to it. A mesh/sculpt object's placeholder box is already in `meshMap`,
so it counts as "resident" → `pct` hits 100 while the object is still a cube awaiting its asset.

Observed live (2026-06-19, Bountiful Sandbox): prim `pct=100`, textures warm, badge **hidden**, while
~460 mesh assets trickled in at ~0.4/s for ~15 minutes (the qs-mesh LRU had been evicted by a prior
heavy region, so a "warm" region was cold for meshes). The user saw cubes with no indication anything
was still loading. The badge said "done" while the scene was visibly wrong.

## Goal

The badge reflects every active asset pipeline (geometry, mesh/sculpt object downloads, textures), so:
1. It never hides while any pipeline still has pending work.
2. A multi-minute trickle is visible as a ticking count (the user can tell it's still working).
3. The current stage is named ("Objects N downloading", "Textures N left", etc.).

## Approach

A **prioritized single line** (the badge is small, ~9.2vw): show the deepest-incomplete stage with a
live count; full breakdown in the hover tooltip. (Chosen over a combined/multi-line layout — keeps the
small badge readable.)

### Data flow

`updateCullStats()` (cullTick, ~every 3s) already gathers geometry `pct` + `getTextureStats()`. Extend
it to also gather:
- `getMeshStats()` — already imported; `queued + inflight` = pending, `failed` = hard failures.
- `getSculptStats()` — **new** export on `useSculptFetch.js` (`{ inflight: active, queued: queue.length }`),
  mirroring `getMeshStats()`.

Fold into `cullStats`:
- `objPending` = `mesh.queued + mesh.inflight + sculpt.queued + sculpt.inflight`
- `objFailed`  = `mesh.failed`

(Existing `texPending` = `tx.queued + tx.inflight + tx.buildQueued`, `texFailed` = `tx.hardFail` — unchanged.)

`worldStore.cullStats` default ref shape gains `objPending: 0, objFailed: 0`.

### Badge logic — pure module `src/lib/loadBadge.js`

Extract the show/label/title decision out of `SceneLoadBadge.vue` into pure, testable functions
(`loadBadgeView(cullStats, entering, terrainPatchCount) → { show, label, title }`). Priority, deepest
incomplete first:

| Condition (in order) | Label |
|----------------------|-------|
| `entering` && `terrainPatchCount === 0` | `Entering region…` |
| `entering` | `Loading terrain…` |
| `pct < 100` | `${massive ? 'Major new scenery to cache: ' : ''}${atTarget ? 'Overall' : 'Nearby'} scene ${pct}% loaded` |
| `objPending > 0` | `Objects ${objPending} downloading` |
| `texPending > 0` | `Textures ${texPending} left` |
| else | (hidden) |

`show` = `entering || pct < 100 || objPending > 0 || texPending > 0`.

`title` (tooltip) = full breakdown, e.g.
`Resident 412 / known 573 within 192m draw distance · objects 460 (12 active) · textures 88 left · evicted 31 for memory`,
appending ` · N objects / M textures failed (right-click an object → Texture refresh)` when either fail
count is > 0 (keeps the existing Texture-refresh hint).

### Components touched

| File | Change |
|------|--------|
| `src/composables/useSculptFetch.js` | add `getSculptStats()` export |
| `src/composables/useWorldEngine.js` | `updateCullStats`: gather mesh+sculpt, add `objPending`/`objFailed` to `setCullStats` |
| `src/stores/worldStore.js` | extend `cullStats` default shape with `objPending`/`objFailed` |
| `src/lib/loadBadge.js` | **new** pure module: `loadBadgeView` (show/label/title) |
| `src/components/SceneLoadBadge.vue` | replace inline computeds with `loadBadgeView` |

## Trickle / retry visibility

Counts are live queue depths refreshed ~every 3s, so the mesh drain shows `Objects 460 downloading`
ticking down over minutes. Failures appear in the **tooltip** only; the badge tracks *pending* work, so
unrecoverable 404s do not pin a permanent badge. Wording stays honest — nothing is labeled "retrying"
because mesh failures do not currently auto-retry (a separate gap, logged but out of scope here).

## Testing (TDD)

Unit-test `src/lib/loadBadge.js` (pure, no DOM):
1. Priority ordering — geometry `pct<100` wins over objects/textures pending.
2. **The bug case** — `pct=100`, `objPending=460`, `texPending=0` → `show=true`, label `Objects 460 downloading`.
3. Geometry done, objects done, textures pending → `Textures N left`.
4. All quiescent (`pct=100, objPending=0, texPending=0`) → `show=false`.
5. Entering states (terrain present vs not).
6. Tooltip includes object + texture fail counts + the Texture-refresh hint when failures > 0.

Plus `build:prod` green.

## Scope guardrails

Badge/telemetry only. No change to pipeline throughput, retry, or eviction (that is the separate
cold-asset-pipeline / qs-mesh-retention project). No widening the badge. `getSculptStats()` is additive
(new export, no behavior change to sculpt fetching).
