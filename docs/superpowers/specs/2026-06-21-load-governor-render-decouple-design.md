# Load-Governor / Render Decouple — Design

**Date:** 2026-06-21
**Status:** Approved (design), pre-implementation
**Phase:** 1 of a 2-phase program (Phase 2 = far-field LOD; this spec lays its foundation)

## Problem

Aspen (a ~24,858-prim region) "used to fully load" but now stalls at a small bubble
(~32 m) with most of the scene unbuilt — even when most of the tab's RAM is idle.

### Root cause (live evidence, this session)

Three control loops are wired so a transient signal (frame rate) caps a durable
resource (how much of the scene builds):

1. **`_renderCap` (fps-driven) gates the build radius.** The mesh drain only builds
   objects within `rcap`. `_renderCap` steps down whenever `fps < 45` and recovers only
   when `fps > 58`. During loading, fps is dominated by **build/ingest/cull longtasks**
   (measured: `drain=81–173ms`, `vis=85–99ms`, single `obj_upd` batch `48–55ms`,
   longtasks `70–86ms`), **not** render cost. So:

   > loading → build longtasks → fps dips < 45 → `_renderCap` floors to 32m → build
   > radius gated to 32m → scene can't finish → still loading → fps stays low → cap
   > stays floored. **A self-defeating loop.**

   Confirmed on the Auto-budget reload: `heap 27%`, `app 42%` (RAM wide open), yet
   `buildQ=21701` frozen, `gov=0` (governor NOT throttling), throttle attributed to
   **`brkCap`** (the render cap). The cap, not memory, was starving the build.

2. **Eviction can't fire before the heap brake (the high-budget wedge).** With the
   "Scene Detail (VRAM budget)" slider raised, the resident budget clamped to
   `0.6 × heap = 2515 MB`. Resident filled to `2470/2515 = appRatio 0.98` — just under
   the `appRatio > 1` eviction trigger — while total heap hit **92%**, tripping
   `emergencyHeap` (≥0.92). Result: builds throttled (`gov` 171→3122, 1250/s→38/s) but
   eviction never armed (its trigger was just out of reach) → permanent wedge holding
   2470 MB resident built out to 166 m while rendering a 32 m bubble.

The sliders had become load-bearing safety knobs: the wrong value wedges or starves.

## Goals

- **Load reliably, always.** The full target radius builds to completion whenever it
  fits in available RAM. No fps-driven cap on *how much* builds.
- **Use available RAM.** Don't cap resident well below what the heap can hold.
- **Auto-throttle / near-first only when necessary** — to modulate build *rate* and
  *order* and shed the *far* field under genuine memory pressure, never to permanently
  limit total load.
- **Render policy (user decision):** draw everything built within the draw distance,
  accepting lower fps on the heaviest regions. (LOD restores fps in Phase 2.)
- **Graceful ceiling.** When a region genuinely cannot fully fit, hold the largest
  near-first radius that fits — reliably, no wedge, no crash — and recover when headroom
  returns.
- **Sliders become optional tuning, not safety.**

## Non-goals (Phase 1)

- Far-field LOD / impostors / static-merge. That is **Phase 2** — its own spec. This
  design names the seam (the visibility-cull boundary) but does not implement it.
- Reducing per-object geometry cost / geometry sharing / instancing changes.
- Texture-pipeline changes beyond what already exists.

## Design

### Part 1 — Build is RAM-driven and always completes

- The mesh-build drain stops gating on `_renderCap`. The effective build/residency
  radius `_effNear` targets the **user draw distance** (`_userTarget`), governed only by
  memory (Part 3), never by fps.
- Near-first ordering is unchanged (`orderByDistance`), as are the small per-tick caps
  (`MAX_EVICT_PER_TICK`, `MAX_RELOAD_PER_TICK`) that keep movement/the circuit healthy.
- With RAM free, `_effNear` grows to the full target and the scene finishes — reliably.

### Part 2 — Render draws everything built within the draw distance

- **Delete `_renderCap`** and its fps-stepping block entirely (`_renderCap`,
  `_renderCapTick`, `RENDERCAP_FPS_LOW`, `RENDERCAP_FPS_OK`, `RENDERCAP_CADENCE`).
- `renderRadius()` returns the user draw distance only:
  `Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT)` — no fps clamp.
- `ddTarget` (the `_effNear` target) becomes `_userTarget` (no `_renderCap` clamp).
- The `rcap` telemetry token stays as an **informational mirror** of `renderRadius()`
  so existing log tooling/grep keeps working; it no longer represents a cap.
- The visibility cull (`selectVisibility` at the `renderRadius()` boundary) is retained
  and is the **Phase-2 LOD hook**: "hide beyond X" becomes "impostor beyond X" later.
  No other change here.

### Part 3 — Graceful RAM ceiling: heap-gated eviction + use available RAM

The eviction/step-down trigger today is `shouldEvictForBudget(appRatio, CULL_TARGET)`
= `appRatio > 1` only. We **add** a heap-driven trigger that is gated on the resident
scene actually explaining the heap, so it cannot reproduce the 2026-06-18 backfire:

- New pure predicate in `cullPolicy.js`:

  ```js
  // True when the RESIDENT scene is itself the heap problem (so eviction will help).
  // Gated on appRatio >= appStanddown to EXCLUDE the transient-garbage case
  // (heap high, app low) that 2026-06-18 proved eviction cannot relieve.
  export function shouldEvictForHeap(appRatio, heapRatio, heapEmergency, appStanddown) {
    return heapRatio != null && heapRatio >= heapEmergency && appRatio >= appStanddown
  }
  ```

- Eviction/step-down trigger becomes:
  `over = shouldEvictForBudget(r, CULL_TARGET) || shouldEvictForHeap(r, heapR, EMERGENCY_HEAP_RATIO, SOFT_HEAP_APP_STANDDOWN)`
  (reusing the existing `EMERGENCY_HEAP_RATIO` 0.92 and `SOFT_HEAP_APP_STANDDOWN` 0.85).
- **Why this reconciles with 2026-06-18:** that decision refused `|| emergencyHeap()`
  because `emergencyHeap`'s CRITICAL branch (heap > 0.95) returns true *regardless of
  appRatio* — so at "heap 99% / app 5%" it cratered draw distance to shed transient
  garbage that eviction can't touch. `shouldEvictForHeap` requires `appRatio ≥ 0.85`, so
  it fires **only** in the resident-explained regime (the high-budget wedge), and stays
  silent in the transient-garbage regime, where `memUnderPressure` pausing the build (as
  today) lets GC reclaim. Two regimes, two mechanisms, no overlap.
- **Use available RAM:** raise the resident budget so it uses more of the heap. Concretely,
  lift `APP_BUDGET_CAP` and/or `APP_BUDGET_FRACTION` in `memGovernor.js` toward a value
  that leaves headroom for loading-transient overhead below the 0.92 heap brake. The
  exact number is **tuned live on Aspen** (see Testing); the heap-gated eviction above is
  the backstop that makes a higher budget safe (it settles instead of wedging).
- Recovery (`drawDistanceMayGrow`, both app- and heap-headroom gated) is unchanged: when
  pressure clears, `_effNear` grows back toward target.

Net behaviour: build out toward the target using RAM; if budget or heap binds, shed the
far field nearest-first and settle at the largest sustainable radius; recover on headroom.
Self-balancing, unlatched, no fps coupling.

## Components touched

| File | Change |
|------|--------|
| `src/composables/useWorldEngine.js` | Remove `_renderCap` + fps-stepping; `renderRadius()` = draw distance; `ddTarget` = `_userTarget`; `over` trigger adds `shouldEvictForHeap`; `rcap` telemetry = informational mirror. |
| `src/lib/cullPolicy.js` | Add pure `shouldEvictForHeap`; keep `shouldEvictForBudget` as-is. |
| `src/lib/memGovernor.js` | Raise resident budget (`APP_BUDGET_CAP` / `APP_BUDGET_FRACTION`) — value tuned live. No change to `emergencyHeap` / `heapThrottled` / `memUnderPressure`. |
| `src/components/PreferencesFloater.vue` | (Optional) reframe the VRAM slider as tuning, not safety. May defer. |

## Testing

**Unit (pure, no DOM/THREE):**
- `shouldEvictForHeap`: true at (app 0.98, heap 0.93); false at (app 0.05, heap 0.99) —
  the 2026-06-18 regression guard; false when `heapRatio == null`.
- `renderRadius()` no longer depends on fps (verify via the extracted logic / no
  `_renderCap` reference remains).
- Existing `cullPolicy` / `memGovernor` tests stay green.

**Live-verify on Aspen (Gene drives client, I watch `server-watch.log`):**
1. Hard reload (Ctrl+Shift+R). Confirm the scene builds past ~50% toward the full
   target radius (buildQ drains; `objs` climbs well beyond ~3276; `gov`/`brkCap` no
   longer the limiter).
2. Confirm fps may drop but the build **completes** and does not wedge.
3. Tune the budget: raise until heap approaches ~0.90 at full load; confirm
   `shouldEvictForHeap` arms and the radius **settles** (no `gov`-pinned freeze, no OOM).
4. Confirm graceful recovery: move away / TP, headroom returns, `_effNear` grows back.
5. Record the radius at which fps falls off — this is the **Phase-2 LOD threshold**.

## Risks & mitigations

- **fps on the heaviest regions will be low** (accepted by the user; Phase 2 LOD fixes).
- **Budget too high → OOM crash.** Mitigated by `shouldEvictForHeap` (sheds resident at
  heap 0.92 + high appRatio) and `emergencyHeap`/`CRITICAL` (0.95) build-pause backstop.
  Tune conservatively from Auto (2048) upward, live.
- **Re-introducing the 2026-06-18 evict-on-heap churn.** Mitigated by the `appStanddown`
  gate; covered by the explicit unit regression test.
- **`rcap` telemetry consumers.** Kept as an informational mirror so log tooling is
  unaffected.

## Phase-2 seam (LOD)

The visibility-cull boundary (`selectVisibility` at `renderRadius()`) is the single
insertion point for far-field LOD: today it hides beyond the radius; Phase 2 swaps "hide"
for "render as impostor / merged-static." Parts 1 and 3 (RAM-driven build, heap-gated
eviction) are unchanged by LOD; LOD only makes the far field cheaper in render and RAM,
raising both the fps and the graceful-ceiling radius. This spec is deliberately the
foundation LOD extends, not a patch around it.
