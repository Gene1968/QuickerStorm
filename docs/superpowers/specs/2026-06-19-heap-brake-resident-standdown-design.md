# Heap soft-brake resident-standdown — design

**Date:** 2026-06-19
**Area:** Render / Cache — FEATURE-GAPS #13/#11 (heavy-region balanced fix, "Lever 3")
**Status:** approved, implementing

## Problem

A heavy region (10k+ objects) settles into a **stable-but-degraded wedge**: the mesh build
queue freezes and never drains, leaving thousands of objects unbuilt, while the scene shows only
a small near bubble.

### Live capture (2026-06-19, 11,538-obj region, frozen for 60s+)

```
[Mem] app 2474/2515MB (98%) heap 3343/4192MB (80%) ⚠THROTTLE(soft-heap)
  | texMB=954 meshCacheMB=256 geomMB=1265 geomCacheMB=95/4096 wBuf=0MB drop=2007
  | tex q=5 cache=4252 | mesh q=0 cache=2258 | objs=11538 evicted=736 buildQ=6139 dd=80m
```

Every value is identical across the whole window — a true equilibrium, not a transient.

### Mechanism

`drainMeshQueue()` and `pumpIngest()` both early-return on `memGovernor.memUnderPressure()`:

```
memUnderPressure() = appRatio > 1 || emergencyHeap() || heapThrottled()
```

In the wedge:
- `appRatio` = 2474/2515 = **0.984** — not `> 1`
- `emergencyHeap()` = false — heap 0.80 < 0.92
- **`heapThrottled()` = true** — the soft-heap brake is *latched* ON. Heap once crossed
  `SOFT_HEAP_ON` (0.85); it now sits 0.79–0.80, which is **above** the `SOFT_HEAP_OFF` (0.78)
  release, so the hysteresis latch never clears.

So builds are paused **permanently** → `buildQ` frozen at 6139. The heap cannot fall below 0.78
because that 80% is the **live resident scene** (app 2474MB + ~870MB engine/worldStore overhead),
not transient garbage — there is nothing for GC to reclaim.

### Why the soft brake misfires here

The soft-heap brake (memGovernor.js) was built for the **cold-churn** case: a heavy cold load
rides heap in the 0.85–0.95 band while `appRatio` stays *low* (~0.07–0.35) because the heap is
the geom write buffer + bake/decode garbage, none of it in `_appBytes`. Pausing intake there is
correct — it lets GC reclaim the transient garbage before the hard brake.

Its corroboration is `_residentCount > MIN_RESIDENT` (the blank-startup guard). But that signal
is true in **both** cases — the cold churn *and* the settled wedge — so it cannot tell them apart.
The distinguishing signal is `appRatio`:

| Case | heap | appRatio | brake should… |
|------|------|----------|----------------|
| Cold churn (transient garbage) | 0.88 | 0.07–0.35 | **fire** — pause, let GC catch up |
| Settled wedge (resident scene) | 0.80 | 0.98 | **stand down** — appRatio controller owns it |

## Approach

Add a **standdown clause** to `heapThrottled()`: when `appRatio()` is at or above a threshold,
the heap is already explained by the resident scene we account for, so the soft brake returns
false and resets its latch — deferring to the appRatio budget controller.

```js
// Stand down when the resident scene (appRatio) already explains the heap. Pausing builds cannot
// shed LIVE data; the appRatio budget controller (eviction + draw-distance step) owns this regime.
// The soft brake exists ONLY for the low-appRatio / high-heap case (transient bake/decode garbage
// not in _appBytes). Without this, a settled heavy region latches the brake forever — heap sits
// ~0.80 (live scene + overhead, above the 0.78 release) so it never releases → buildQ frozen.
if (appRatio() >= SOFT_HEAP_APP_STANDDOWN) { _softBrakeOn = false; return false }
```

New constant `SOFT_HEAP_APP_STANDDOWN = 0.85`, equal to the engine's `CULL_RESUME` — the radius at
which the engine already treats the budget as actively eviction-managed.

The clause goes *after* the `r == null` and `_residentCount <= MIN_RESIDENT` guards and *before*
the hysteresis block, so those existing protections are unchanged.

### Why this is safe

- **No OOM.** In the high-appRatio regime, `emergencyHeap()` (0.92 corroborated by appRatio>0.5,
  or 0.95 unconditional) is the heap guard. Unlike the soft brake it is **not latched** — it
  recomputes from instantaneous `memRatio()` each call, so it self-releases once GC reclaims build
  garbage. It replaces the deadlocking latched brake exactly where the brake was harmful.
- **Resident bytes stay capped.** `appRatio > 1` eviction caps the resident scene at the budget,
  so resuming builds cannot run resident memory away.
- **No futile churn.** Eviction keys on `appRatio` (the legitimate budget controller), not heap —
  so this does not re-introduce the heap-collapse churn (that was eviction-on-heap, already
  removed in the 2026-06-18 graceful-stability fix).

### Behavior change

The frozen-buildQ wedge becomes a **stable, fully-built near bubble**: builds resume, the near set
bakes nearest-first, `appRatio` crosses 1.0, eviction sheds far roots beyond `_effNear`, and
`buildQ` drains to the within-radius set and empties. Draw radius stays ~80m — that is the budget;
raising it is LOD, explicitly out of scope.

## Scope

- **In:** one clause + one constant in `src/lib/memGovernor.js`; tests in
  `src/__tests__/lib/memGovernor.test.js`.
- **Out:** engine edits (the fix flows through `memUnderPressure()` automatically), eviction
  policy, the app-budget heap clamp, LOD, draw-distance changes.

## Testing

TDD in `memGovernor.test.js`:
1. High appRatio (≥0.85) + high heap (soft band) + resident scene → `heapThrottled()` false **and**
   `memUnderPressure()` false [the fix].
2. The latch resets: brake engaged at low appRatio, then appRatio rises above standdown → false.
3. Existing churn-fires test (appRatio ~0.07) and hysteresis test (appRatio ~0) still pass —
   their appRatio is well below standdown so the clause does not trigger.

Plus `build:prod` green.

## Live-verify

On a heavy region (10k+ objs) that drives heap into the soft band with the budget near-full:
`buildQ` drains instead of freezing; `[Mem]` no longer shows a persistent `⚠THROTTLE(soft-heap)`
once the near set is built; the scene fills to a stable near bubble; heap stays under the 0.92
emergency brake (no OOM); no `[Cull] … draw distance ↓` cascade to the 32m floor.
