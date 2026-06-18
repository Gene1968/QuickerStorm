# Heap-Pressure Graceful Stability — Design

**Date:** 2026-06-18
**Status:** Design (approved, pre-plan)
**Area:** `src/composables/useWorldEngine.js` (cullTick), `src/lib/memGovernor.js` (read-only reference)
**Related:** FEATURE-GAPS #13 / [[heap-blind-governor-cube-blowout]] / [[render-cache-unified-model]] / [[dynamic-draw-distance-governor]]

## Goal

On a heavy cold region (10k+ objects), the viewer must stay **gracefully stable**: never OOM, never
"cube out", never churn the visible scene. Hold a sensible draw distance steadily even if the whole region
can't be resident at once; far objects fill in as the user moves or as heap recovers. We explicitly accept
that a ~4 GB Chrome tab heap cannot hold everything at full draw distance — the requirement is *stability*,
not *completeness*.

## Evidence (live, 2026-06-18, "Never Depot", 10,888 objects, fresh cold login)

`server-watch.log`, captured via the owned Bun bg task:

```
17:14:49  heap 86% ⚠THROTTLE  app 6%  objs=704  buildQ=171  dd=96m  texMB=40
17:15:13  heap 97% ⚠THROTTLE  app 6%  objs=704  buildQ=171  dd=96m  texMB=40
17:15:22  heap 97% ⚠THROTTLE  app 5%  objs=625  buildQ=250  dd=80m  texMB=0   ← textures wiped
17:15:28  heap 99%            app 5%  objs=496  buildQ=379  dd=32m            ← dd cratered to floor
17:15:52  heap 103%           app 5%  objs=275  buildQ=600  dd=32m            ← over the 4192MB limit
```

The tracked caches summed to ~470 MB (`texMB 0 + meshCacheMB 256 + geomMB 44 + geomCacheMB 96 + wBuf 7`)
while the JS heap was at 4131 MB — **~3.7 GB of heap the governor's `app` metric cannot see** (uncollected
GC garbage + the build/ingest backlog + raw object records). The soft-heap brake *did* fire from 86%, but
heap raced past it to 103%, and the scene violently collapsed.

## Root cause — three interlocking factors

1. **Scene-collapse triggers on heap, not just the resident budget.** `cullTick` (useWorldEngine.js:3505,
   3523):
   ```js
   const r = appRatio()                              // resident/VRAM budget — 5% here
   const over = r > CULL_TARGET || emergencyHeap()   // emergencyHeap (heap>0.95) forces over=true
   ```
   When heap crossed 0.95, `emergencyHeap()` forced `over=true`, which drove eviction (3553+),
   `pruneTexturesLRU(96)` (3594), and the `_effNear` step-down (3605–3607). None of these relieve the
   pressure — the ~3.7 GB is garbage/backlog, **not** the resident scene — so the collapse is futile *and*
   destructive (dd 192→32m, textures wiped, 704→275 objects culled). The code's own comment (3518–3522)
   already argues eviction must not react to moderate heap; the `|| emergencyHeap()` clause contradicts it
   at the critical level.

2. **The collapse churns the build queue.** `buildQ` ballooned 171→600 *because of* factor 1: the
   heap-triggered `over` evicts far roots (3567+) into `evicted`, and the stream-in path re-queues evicted
   roots **and their children** within `_effNear` (3537–3546) — so as `_effNear` craters, objects are
   evicted then immediately re-queued, a churn that grows `pendingMeshIds` while build is paused. Fixing
   factor 1 removes this churn at its source. (Note: the `rebuildScene` auto-trigger at 3313–3318 fires
   only when `resident === 0`; `resident` stayed 275–704 here, so it did **not** fire in this trace — but
   gating it under pressure is a cheap defensive guard against a paused-but-emptied scene re-queuing all
   ~10k objects, a known latent failure mode.)

3. **Pause-and-hold is already wired** (`memUnderPressure()` gates `pumpIngest` 3696, the build drain 3753,
   and the texture pump). This part is correct and stays — it lets GC reclaim transient garbage and the
   backlog drain once pressure clears. It just gets defeated by (1) and (2).

## Design

Three surgical changes; no new subsystem.

### Change 1 — collapse responds to the resident budget only

`over` (the eviction / texture-prune / draw-distance step-down trigger) keys on `appRatio` **only**:

```js
const over = r > CULL_TARGET   // resident/VRAM budget; NOT emergencyHeap()
```

Effect: when heap is high but `appRatio` is low (garbage/backlog), the scene **holds** — no dd crater, no
texture wipe, no culling, and (crucially) no evict→reload churn, so the build backlog stops growing. A
genuinely resident-heavy scene (`appRatio > CULL_TARGET`) still evicts exactly as today. We remove only the
futile-and-destructive branch. **This single change addresses both the scene collapse and the `buildQ`
balloon.**

### Change 2 — don't auto-rebuild while intentionally paused (defensive)

Gate the `rebuildScene` auto-trigger (3314) on `!memUnderPressure()`: a scene paused by the heap brake is
not a dead scene. This did not fire in the captured trace (it needs `resident === 0`), but it's a cheap
one-line guard against the known latent failure mode where a paused-but-emptied scene re-queues all ~10k
objects. Manual "Rebuild Scene" (user button, 3208) stays unconditional. Once pressure clears, if the scene
is still genuinely dead, the auto-rebuild fires as before.

### Change 3 — keep pause-and-hold (no code change)

`memUnderPressure()` continues to gate intake/build/ingest. Documented here so the plan doesn't regress it.

### Resulting behavior (10k cold region)

heap rises → soft brake pauses intake + build → scene holds at its current draw distance (no crater, no
churn, no texture loss) → GC reclaims transient garbage + the paused backlog stops growing → brake releases
below 0.78 → loading resumes → far objects fill in as the user moves. No OOM, no cube-out.

## Components & isolation

- **Pure decision helpers (new, unit-testable)** in `useWorldEngine.js` (mirroring the existing
  `drawDistanceMayGrow`):
  - `shouldEvictForBudget(appRatio, cullTarget)` → the `over` decision (resident-budget only).
  - `shouldAutoRebuild(deadScans, threshold, underPressure)` → false while `underPressure`.
  These keep the policy out of the 4000-line engine body and make the change testable without a live scene.
- **cullTick** calls the helpers instead of the inline expressions.
- **memGovernor.js**: unchanged (reference only). `emergencyHeap()` / `heapThrottled()` keep their current
  meaning; we simply stop using `emergencyHeap()` to drive *scene collapse*.

## Testing (`bun:test`, in `src/__tests__/lib/cullPolicy.test.js`)

- `shouldEvictForBudget`: app over target → true; app under target → false. The signature takes no heap
  parameter — that absence IS the core regression guard (heap can no longer force collapse).
- `shouldAutoRebuild`: dead-scan threshold reached + not under pressure → true; same but under pressure →
  false; below threshold → false.
- No live scene needed; the engine wiring is exercised in the live cold-region verify (owned Bun log:
  expect heap to plateau, dd to hold, no `[Cull] … draw distance ↓` cascade, no `[3D] Rebuild Scene` under
  the brake).

## Out of scope (YAGNI)

- A "last-resort relief valve" at critical heap — pause + no-collapse should bound heap; add only if the
  live verify shows heap still creeping to OOM.
- Identifying / shrinking the 3.7 GB untracked heap — that's the "load it fully" ambition, deliberately
  deferred; graceful stability does not require it.
- The inventory stall-backstop nit and the sculpt inline-J2C-decode defect — tracked separately.

## Risks

- **A resident-heavy region that is also heap-heavy still needs to shed.** Covered: `appRatio > CULL_TARGET`
  still triggers eviction. We only removed the *app-low* collapse.
- **Heap could still creep to OOM if the paused backlog is itself too large.** Mitigation: pause stops new
  growth; GC reclaims garbage. If the live verify shows creep, the follow-up is to bound the build backlog
  (the deferred "Approach B" slice) — not to restore the destructive collapse.
- **`CULL_TARGET` may now be the only resident ceiling.** Confirm during planning that `appRatio`-based
  eviction alone keeps the resident set within VRAM on capable and modest GPUs (the Prefs override already
  exists for VRAM headroom).
