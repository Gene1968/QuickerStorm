# Mesh LOD (fetch-on-demand) — Design

**Date:** 2026-06-21
**Status:** Approved (design), pre-implementation
**Phase:** 2 of the redesign→LOD program (Phase 1 = load-governor/render decouple, committed). Prim & sculpt LOD are named follow-on sub-phases, out of scope here.

## Problem

Phase 1 made the scene build reliably to the full draw distance, but exposed the render
wall: a ~24,858-prim region (Aspen, 10,527 of them **mesh** objects) renders at fps
**11–20** at 192 m, and the resident set settles at ~11k objects / ~2900 MB because every
mesh is held and drawn at **full (high) detail** regardless of distance.

**Root finding:** SL mesh assets ship four LOD levels (`high_lod`, `medium_lod`,
`low_lod`, `lowest_lod`). The server already parses all four (`server/lib/meshDecode.ts`
builds `lods: { high, medium, low, lowest }`), but the handler
(`server/handlers/mesh.ts:33`) always picks `high ?? medium ?? low ?? lowest` — it decodes
and serves **only the high LOD**. The cheap, low-triangle versions sit unused in every
asset. We render the whole region at maximum detail.

## Goals

- **Render far meshes at a cheaper LOD**, selected by distance/screen-size, Firestorm-faithful.
- **Cut load cost, RAM, and render time for far objects:** a far mesh should only ever
  fetch / decode / bake / hold its *cheap* level — never the high LOD it can't be seen at.
- **Lift Phase 1's ceiling:** lighter resident geometry → more of the region fits and
  draws smoothly.
- **Reuse the existing pipeline** (cull/distance, near-first drain, cache worker, geometry
  swap, eviction) — minimal new surface, inherit Phase 1's stability.
- **Reliability:** no LOD thrash while moving; graceful fallback when a mesh lacks a level.

## Non-goals (this spec)

- Prim tessellation LOD (`primGeometry.js`) — follow-on sub-phase.
- Sculpt detail LOD (`sculptDecode.ts` already has a detail budget) — follow-on sub-phase.
- Impostors / merged-static far-field rendering — not needed for meshes (SL ships the LODs).
- Raising the default draw distance — a later tuning lever, once far is cheap.
- Changing `renderRadius()` / the `selectVisibility` hide-beyond boundary — unchanged.

## Design

### 1. LOD selection — pure, Firestorm-faithful (`src/lib/lodPolicy.js`, NEW)

`selectLod(radius, dist, lodFactor) → 0|1|2|3` (0=high … 3=lowest). Mirrors the SL viewer's
projected-area rule: detail falls with `radius² / dist²` (proportional to on-screen size),
compared against switch thresholds scaled by `lodFactor` (Firestorm `RenderVolumeLODFactor`
default ≈ 1.125). Includes a hysteresis margin so an object straddling a boundary does not
oscillate between two levels frame-to-frame. Pure + total (no THREE/DOM) → unit-tested.

- `radius` = the object root's bounding-sphere radius (derived from its scale / built bbox).
- `dist` = camera distance to the root (already computed in `cullTick` for visibility/eviction).
- Returns the index into the *available* levels; see fallback in §2.

### 2. Fetch / serve by level (server + client mesh fetch)

- The client mesh request carries a desired `lod` (0..3). The server handler decodes **that**
  block instead of always-high. `meshDecode.decodeMeshLOD(buf, headerSize, lodRef)` already
  decodes an arbitrary level — only the handler's level *pick* changes.
- **Fallback:** if the requested level is absent in the asset, serve the nearest available level,
  preferring the **coarser** neighbour (cheaper + Firestorm-faithful). Some meshes ship only `high`.
- **Caching of fallbacks (v1 simplification):** the client caches under the **requested** level, not
  the served one. Correct geometry is always shown; the only cost is that a mesh *missing* the
  requested level may store the same fallback geometry under more than one `(uuid, lod)` key. This
  affects only the minority of assets missing levels and is bounded by the qs-mesh/qs-geom LRU caps,
  so echoing/keying-by the served level (a protocol round-trip) is deferred.

### 3. Cache keyed by `(uuid, lod)`

Both decoded-submesh (qs-mesh) and baked-geometry (qs-geom) cache keys gain the level
(e.g. `uuid|lod`). This is an **additive key change**: existing UUID-only entries simply
miss once and re-fetch/re-bake at their level (same one-time cost as the qs-mesh v3 LRU
drop). No DB version-bump machinery is required. Memory budgets are unchanged; lower LODs
are smaller, so the cache holds more.

### 4. Swap via the existing drain (`useWorldEngine.js` cullTick + build path)

- In `cullTick`, alongside the existing per-root distance/visibility/eviction pass, compute
  each resident root's **desired LOD** via `selectLod`. Track the **built LOD** per root.
- When `desired !== built` (after the hysteresis margin), enqueue the root (and its children,
  via the existing `groupChildrenByRoot` index) into `pendingMeshIds`. The existing drain
  bakes the mesh at the new level (fetch-on-demand → `(uuid, lod)`), and `applySwap` replaces
  the geometry exactly as it does today. Throttled by the existing per-tick caps
  (`MAX_*_PER_TICK`) so LOD churn stays smooth and the circuit/movement stay healthy.
- Cached levels swap instantly on revisit (both levels resident in the cache after first use).
- Only **mesh** roots get a desired LOD; prims/sculpts keep their single detail (out of scope).

### 5. Interaction with Phase 1

- `renderRadius()` and the `selectVisibility` "hide beyond radius" boundary are unchanged.
  LOD operates *within* the visible radius: far-but-visible meshes drop to a cheap level.
- Lighter resident geometry feeds straight into Phase 1's budget/eviction loop
  (`shouldEvictForBudget` / `shouldEvictForHeap`) — the same control loop, smaller per-object
  bytes → the ~11k / ~2900 MB ceiling rises and fps at 192 m improves. No governor change.

## Components

| File | Change |
|------|--------|
| `src/lib/lodPolicy.js` | NEW — pure `selectLod(radius, dist, lodFactor)` + hysteresis. |
| `src/__tests__/lib/lodPolicy.test.js` | NEW — threshold + hysteresis + fallback-index tests. |
| `server/handlers/mesh.ts` | Accept a `lod` param; decode the requested level (not always high); return the level actually served. |
| `src/composables/useMeshFetch.js` | Request a specific `lod`; key the decoded-submesh cache by `(uuid, lod)`. |
| `src/composables/useWorldEngine.js` | cullTick: compute desired LOD per resident mesh root, track built LOD, enqueue re-bake on change (hysteresis); thread `lod` through the bake/fetch + `(uuid, lod)` geom-cache key. |

## Testing

**Unit (pure):**
- `selectLod`: near object → 0 (high); progressively farther → 1, 2, 3; hysteresis margin
  prevents flip-flop across a boundary; `lodFactor` scales switch distances.
- `(uuid, lod)` cache-key composition is stable and collision-free vs. the old UUID key.

**Server:** `decodeMeshLOD` returns the requested level; handler falls back when a level is
absent and reports the served level.

**Live-verify on Aspen (Gene drives, I watch `server-watch.log`):**
1. Mesh detail visibly steps down with distance; near meshes stay high.
2. fps at 192 m rises materially vs. the Phase-1 baseline (11–20).
3. Resident object count / radius climbs (lighter far geometry; the ceiling lifts).
4. **No LOD thrash** while walking (hysteresis holds; the drain doesn't churn re-bakes).
5. Walking toward a far mesh refines it to high (brief pop, SL-faithful); revisits are instant.
6. No regression on light/cold/var/multi-region loads.

## Risks & mitigations

- **LOD thrash / re-bake churn** while moving → hysteresis margin in `selectLod` + the
  existing per-tick build caps + `(uuid, lod)` caching (repeat swaps are free).
- **One-time re-fetch** of all meshes (key change) → expected and bounded; far meshes now
  fetch only their cheap level, so the *next* load is cheaper than today, not costlier.
- **Meshes missing levels** → handler fallback to nearest available; client caches the
  served level.
- **Pop-in when approaching** (low→high refine) → SL-faithful and acceptable; the lowest-LOD
  preload option was deliberately deferred (YAGNI for v1).
- **Budget interaction** → none new; LOD only reduces per-object bytes feeding the unchanged
  Phase-1 loop.

## Follow-on (named, not this spec)

- **Prim LOD:** lower profile-sides / height-segments in `primGeometry.js` for far prims.
- **Sculpt LOD:** select a lower `detail` (vertex budget already in `sculptDecode.ts`) for far sculpts.
- **Draw-distance lift:** once far is cheap, raise the default render radius as a tuning step.
- **Instancing + LOD:** `geomKeyFor`/`describeForPool` key on the *desired* LOD, not the *built*
  LOD (`mesh.userData.meshLod`), so a LOD-shifted mesh is skipped by the instance pool until it
  re-streams. Harmless while instancing is off-by-default; fix (read the built LOD) before re-enabling
  the instancing flag. The DEV draw-call census (`qsCensus`) has the same desired-vs-built key skew.
- **`lodFactor` slider:** `uiStore.lodFactor` is read with a `?? 1.125` fallback; expose it in
  QuickPrefs ▸ Graphics for live quality tuning.
