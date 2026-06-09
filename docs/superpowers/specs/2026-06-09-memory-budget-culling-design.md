# Memory-Budget Distance Culling — Design

**Date:** 2026-06-09
**Status:** Approved (design); not yet implemented
**Problem owner:** dense-region OOM / "fewer objects" regression

## Problem

A dense region (~20k objects, ~14k textures) cannot be held fully resident in a ~4 GB Chrome tab. The interim fixes — a JS-heap **governor** (pause intake >85%) and a **256² texture cap** — stop the crash but leave the scene loading only partially (the governor pins near the limit and stops). Resident cost is dominated by expanded `BufferGeometry` (a 2,200-tri mesh ≈ 200 KB live; ~1 GB across the region) and textures (~0.86 GB at 256), not the on-disk caches (mesh IDB shows only ~281 MB compressed).

The fix: stop trying to hold the whole region resident. Keep only the objects near the camera built; evict the farthest when memory is tight; stream them back from cache as the camera moves. Memory then stays bounded regardless of region density, and the full region still caches to disk.

## Goals

- No OOM, ever, on any region (hard guarantee).
- Park heap at a comfortable target (~60%) so the governor is a rare backstop, not the steady state.
- Near objects always load; distant ones stream in/out by distance as the camera moves.
- Re-load from local cache (worldStore record + IDB mesh/texture) — **never** a grid re-fetch.
- A visible `% of scene loaded` indicator so partial state reads as intentional.

## Non-goals

- LOD / mesh decimation (future).
- Raising the texture cap back toward 512 (possible later once resident set is bounded; out of scope here).
- Server/protocol changes — this is entirely client-side.

## Mechanism: memory-budget LRU-by-distance eviction

A **cull tick** runs on a ~1 s interval. It reads `memRatio()` (from `memGovernor.js`).

- **Evict** when `memRatio() > CULL_TARGET` (default `0.60`). Select resident meshes **farthest from the camera** (using each object's `pos`), evict them (dispose), capped at `MAX_EVICT_PER_TICK`, repeating across ticks until under target. The 0.85 governor remains the hard floor.
- **Reload** when there is headroom (`memRatio() < CULL_TARGET`): objects in the `evicted` set within `R_near` of the camera are re-queued for build, capped at `MAX_RELOAD_PER_TICK`.
- **Hysteresis:** evict only beyond `R_far`; reload only within `R_near`, with `R_near < R_far`, so an object straddling the boundary doesn't thrash. (Budget pressure can still evict inside `R_far` when truly over target — distance just orders *which* go first.)

### Eviction unit — per object, by distance

Evict individual meshes, farthest first. Linksets are spatially compact, so distance ordering drops whole far groups together without separate linkset bookkeeping.

**Never evict:** avatars (`pcode 47`), the own avatar, and the currently edited/selected object (`uiStore.editObjectId`). The own-avatar guard also protects the follow camera.

### What is dropped vs kept

- **Dropped:** the `THREE.Mesh` via the existing `removeMesh(localId)` (disposes geometry + materials [array-aware] + frees texture references; CSS2D labels already cleaned there). Removed from `meshMap`.
- **Kept:** the `worldStore` object record (lightweight) and the IDB mesh/texture caches. So a rebuild reads decoded data + cached assets with no network round-trip.

### Re-load on approach

- A `residentSet` is just `meshMap`'s keys; an `evicted: Set<localId>` tracks dropped-but-known objects.
- On eviction: add to `evicted`.
- On reload tick: for each `evicted` id whose object is within `R_near` and pcode is buildable, delete from `evicted` and `pendingMeshIds.add(localId)`. The existing drain (`drainMeshQueue` → `upsertMesh`) rebuilds from `worldStore.objects.get(localId)`, pulling mesh/texture from cache. The governor + budget still gate the drain, so reload can't blow past the target.
- An incoming `ObjectUpdate` for an evicted id clears it from `evicted` (normal upsert path takes over).

## `% loaded` indicator

- `loadedPct = round(100 * meshMap.size / max(1, knownCount))`, where `knownCount` = count of buildable objects in `worldStore` for the current region (exclude avatars). Expose via a small reactive value (e.g. on `worldStore` or a `useCullStats` getter).
- **Placement:** the upper-right HUD / lag meter (compact `"scene 72%"`), and a line in the Preferences cache card (`resident N / known M (72%), evicted K for memory`). Wording makes clear eviction is intentional memory management, not data loss.

## Components / file map

- **`src/lib/memGovernor.js`** — add `CULL_TARGET` constant + (optional) a `memOverBudget(target)` helper. Already exposes `memRatio`/`memStats`.
- **`src/composables/useWorldEngine.js`** — the cull manager:
  - `evicted` Set; `cullTick()` (evict/reload logic, distance from `camera.position` vs `slToThree(obj.pos)`); constants `CULL_TARGET`, `R_near`, `R_far`, `MAX_EVICT_PER_TICK`, `MAX_RELOAD_PER_TICK`.
  - Hook `cullTick()` into the existing ~1 s cadence (reuse/add a timer; the 3 s asset timer is too slow, the 30 ms drain too fast — use a dedicated ~1 s timer).
  - Reuse `removeMesh` for eviction; reuse `pendingMeshIds`/`drainMeshQueue` for reload.
  - Maintain a reactive `cullStats` ({ resident, known, evicted, pct }) updated each tick.
- **`src/lib/cullPolicy.js`** *(new, pure)* — `selectEvictions({objects, camPos, residentIds, protectedIds, overBy, maxN})` and `selectReloads({evictedIds, objects, camPos, rNear, maxN})` returning id lists. Pure → unit-testable without THREE/DOM. The engine supplies positions/among inputs; the policy just ranks by distance and applies caps.
- **HUD component** (existing upper-right lag/stats element) + **PreferencesFloater** cache card — render `cullStats`.

## Testing

- `cullPolicy.test.js` (bun): farthest-first selection respects `maxN`; protected ids never selected; reload picks only within `R_near`; empty/edge inputs return `[]`.
- Build green; live: load the dense region — heap parks ~60%, `% loaded` rises, moving the camera streams objects in/out, no crash, no grid re-fetch storm (watch `[Assets]`/`reqMulti` stays ~0 on revisits).

## Risks / mitigations

- **Thrash at boundary** → hysteresis (`R_near < R_far`) + per-tick caps.
- **Frame hitch from mass eviction/build** → `MAX_EVICT_PER_TICK` / `MAX_RELOAD_PER_TICK` spread work across ticks.
- **`performance.memory` unavailable** (non-Chrome) → `memRatio()` returns null → both the governor and culling are inert (no eviction, no intake pause), i.e. current uncapped behavior. Culling is Chrome-gated, same as the governor. Acceptable: the target browser is Chrome.
- **Evicting something visible/near** → distance ordering + protected set keep the camera's immediate surroundings; only far objects go first.
- **Heap/GC lag** → `memRatio` reacts after GC; per-tick caps + a target well under the governor absorb the lag.
