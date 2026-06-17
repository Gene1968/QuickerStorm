# Heap-aware soft throttle for build + ingest + texture intake

> Design spec, 2026-06-16. Fix for the "scene never settles / objects disappear+redraw / textures
> climb over and over" churn on a heavy COLD load — the [[heap-blind-governor-cube-blowout]] issue,
> captured live (FEATURE-GAPS #11 churn item). Read `docs/render-cache-model.md` first.

## Problem

On a heavy cold load the captured `[Mem]` line shows `app 23–35%` (UNDER the VRAM/app budget) yet
`heap 89%` (3.7/4.2 GB, near-OOM), `buildQ 30593→42582` (mesh queue exploding), and thousands of
`requestAnimationFrame took ~100ms` violations.

Every existing intake throttle engages too late:

| Consumer | Current gate | Code |
|---|---|---|
| mesh build drain | `memUnderPressure()` | `useWorldEngine.js:3680` |
| texture fetch pump | `emergencyHeap() \|\| appRatio() >= 1.0` | `useTextureFetch.js:120` |
| ingest pump | **nothing heap-related** | `useWorldEngine.js:3622` |

`memUnderPressure()` = `appRatio()>1 || emergencyHeap()`, and `emergencyHeap()` fires only at
`memRatio > 0.95` (the critical brake) or `memRatio > 0.92 && appRatio > 0.5`. The captured churn was
heap **0.89** / app **0.35** → below 0.95, and `0.35 < 0.5` so the corroboration branch never fires →
**nothing throttles** in the 0.85–0.95 band.

So the client keeps baking geometry + decoding textures full-tilt, generating transient
bake/decode garbage faster than GC can reclaim it. Heap pins high, the frame budget is blown
(~100 ms rAF tasks), and `buildQ` runs away because ingest keeps feeding it.

The render/cache model's prescribed response to heap pressure is **pause intake so GC catches up**
(eviction never relieves heap — it's transient garbage, not the resident scene). We already do that —
but only at the 0.95 cliff, after the damage is done.

### Why the obvious fix (lower the threshold) is a trap

The `0.95` / `0.92 + appRatio>0.5` design exists **deliberately** to dodge a known regression: a
hard-reloaded page can inherit the previous page's ~90% uncollected heap in the same renderer process.
If we throttled on raw `memRatio > 0.85`, that fresh page would refuse to build its first frame →
**blank region**. The `appRatio > 0.5` corroboration was meant to prove "we are the ones holding the
memory" — but that is exactly the signal that failed here (real heap lives in the write buffer + bake
garbage + texture queue, none of which is in `_appBytes`, so appRatio read 0.35).

We need a *different* corroboration that proves an active, real scene without depending on `_appBytes`.

## Approach — one new governor signal, three consumers gate on it

### 1. `src/lib/memGovernor.js` — hysteretic soft-heap brake

Add a soft brake that engages in the 0.85–0.95 band, corroborated by **resident scene size** (a count
the engine already has: `meshMap.size`). A blank inherited-garbage reload has `meshMap ≈ 0`, so it
cannot false-trigger — preserving the anti-blank-startup guarantee. The captured churn had
`meshMap = 17471`, so it engages.

New module state + API:

```
const SOFT_HEAP_ON   = 0.85   // engage the soft brake above this heap ratio (with resident corroboration)
const SOFT_HEAP_OFF  = 0.78   // release below this (hysteresis — let GC reclaim before resuming)
const MIN_RESIDENT   = 500    // require a real resident scene to corroborate (blank-startup guard)

let _residentCount = 0        // engine pushes meshMap.size via setResidentCount()
let _softBrakeOn   = false    // hysteresis latch

export function setResidentCount(n) { _residentCount = Number.isFinite(n) && n > 0 ? n : 0 }

export function heapThrottled() {
	const r = memRatio()
	if (r == null) return false                       // non-Chrome / unmeasurable → never throttle (safety)
	if (_residentCount <= MIN_RESIDENT) { _softBrakeOn = false; return false }  // no real scene → can't be our load
	if (_softBrakeOn) {                               // engaged: stay engaged until heap falls below OFF
		if (r < SOFT_HEAP_OFF) _softBrakeOn = false
	} else {                                          // idle: engage when heap rises above ON
		if (r > SOFT_HEAP_ON) _softBrakeOn = true
	}
	return _softBrakeOn
}
```

`memUnderPressure()` folds it in (the 0.95 hard brake via `emergencyHeap()` stays untouched as the
final backstop):

```
export function memUnderPressure() {
	return appRatio() > 1 || emergencyHeap() || heapThrottled()
}
```

Export the three constants alongside the existing ones for test assertions.

WHY hysteresis (not a single threshold): without a release band the brake would chatter on/off every
tick as a single bake nudges heap across 0.85. The 0.85/0.78 band mirrors the existing geom-mem-cap
band (`GEOM_MEM_HEAP_CAP_AT 0.82` / `RELEASE_AT 0.68`) in `useWorldEngine.js`.

WHY resident-count corroboration lives as governor state (not passed per-call): the texture pump and
the engine both consult the brake; threading the count through every call site is noise. The engine
already pushes `setAppBytes()` once per cull tick — `setResidentCount()` rides the same site.

### 2. `src/composables/useWorldEngine.js`

- **`cullTick`** (next to the existing `setAppBytes(...)` at ~`:3412`): add
  `setResidentCount(meshMap.size)`.
- **`pumpIngest()`** (`:3622`): early-return when `memUnderPressure()` — stop pulling off
  `_ingestQueue` (which does `worldStore.upsertObject` + `pendingMeshIds.add`) under pressure. The
  queue retains its items and drains once pressure clears. Mirrors the `drainMeshQueue` gate.
- **build drain** (`:3680`): already gates on `memUnderPressure()` → inherits the soft brake with no
  change.

### 3. `src/composables/useTextureFetch.js`

Import `heapThrottled` and add it to the pump's while-condition (`:120`):

```
while (active < MAX_INFLIGHT && netQueue.length && !(emergencyHeap() || appRatio() >= 1.0 || heapThrottled())) {
```

Keeps the deliberate `appRatio`-headroom behavior; just adds the soft heap brake (texture decode is a
major heap-garbage source, so it must pause too).

## Why this converges instead of climbing

Build/decode a batch → heap rises past 0.85 → all three intakes pause → GC reclaims the transient
bake/decode garbage → heap falls below 0.78 → resume. The load self-paces under the heap ceiling
instead of racing to OOM and churning.

If heap *stays* pinned in the band because the resident scene genuinely doesn't fit 4 GB, the build
stays paused and the scene holds at what's built (nearest-first, so it's the player's surroundings).
That is the correct "load what fits, don't OOM" behavior — full 48k coverage still needs LOD (#13),
which is documented and out of scope here.

**Side benefit:** fewer bakes → fewer geom-cache writes → the `wBuf=256MB drop=7580` write-buffer
pegging relieves itself. No separate write-buffer work needed.

## Out of scope

The `objs 17471→5482, evicted=0` scene-clear (12k meshes vanishing without going through eviction,
the dead-scene rebuild, or the TP clear) is a **separate slice** that needs its own live trace. It is
NOT blind-fixed here. The soft throttle may relieve it as a side effect by stopping the climb that
triggers whatever clears the scene — we verify on the live load, we don't guess.

## Tests (test-first — `src/__tests__/lib/memGovernor.test.js`)

Extend the existing `critical-heap brake` describe with a `soft-heap brake` describe, using the same
`setHeap(usedMB, limitMB)` / `clearHeap()` helpers:

1. **fires on the churn signature** — heap 0.88 + `setResidentCount(17471)` → `heapThrottled()` true
   and `memUnderPressure()` true, even though `appRatio() < 0.5`.
2. **blank-startup guard** — heap 0.88 + `setResidentCount(0)` → `heapThrottled()` false (no resident
   scene to corroborate; the inherited-garbage reload must still build).
3. **hysteresis** — engage at 0.86 (resident 17471), still engaged at 0.80 (between OFF and ON),
   releases at 0.77 (below OFF).
4. **non-Chrome safety** — `clearHeap()` (memRatio null) → `heapThrottled()` false regardless of
   resident count.
5. **hard brake unchanged** — the existing 0.95-always and 0.92+appRatio>0.5 `emergencyHeap` tests
   still pass.

Reset `setResidentCount(0)` in `beforeEach` alongside `setAppBytes(0)` so the hysteresis latch can't
leak between tests.

## Acceptance

- Vitest (bun test) + `npm run build:prod` green; no new failures vs baseline.
- Live heavy cold load (the ~17k+ obj region that churned): heap holds at ≤~0.90 instead of climbing
  toward OOM; `buildQ` stops the runaway climb; the rAF-violation flood drops; scene loads
  progressively (near-first) without the disappear+redraw churn.
- Gene commits (this is thrash-prone history — evidence-first, one slice, he commits).

## Tuning knobs (defaults chosen, flag for live tuning)

- `SOFT_HEAP_ON` / `SOFT_HEAP_OFF` = `0.85` / `0.78`
- `MIN_RESIDENT` = `500`
