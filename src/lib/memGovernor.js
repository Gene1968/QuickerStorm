// src/lib/memGovernor.js — memory-pressure governor for asset intake + scene residency.
//
// WHY self-accounted bytes (v2): the original governor keyed everything off
// performance.memory.usedJSHeapSize. That signal lied to us two ways and caused the busy-region
// death spiral (objects evicted to zero, blank alternate reloads):
//   1. It counts UNCOLLECTED GARBAGE — during a cold load the heap reads 90%+ while the live set
//      is a fraction of that, so the culler never stopped evicting.
//   2. A hard-reloaded page can inherit the previous page's heap in the same renderer process —
//      heap reads 92% with ZERO app content, so intake was blocked from the first frame (blank).
// We already compute exactly what WE hold: texture bitmaps + decoded mesh assets + live geometry.
// That number is truthful, immediate, and works on every browser (no performance.memory needed).
// The process-heap ratio is kept ONLY as an emergency brake near genuine OOM.
//
// Wiring: useWorldEngine pushes the byte total via setAppBytes() (cull tick ~1s + telemetry ~3s);
// consumers (texture intake pump, mesh drain, culler) read appRatio()/memUnderPressure().

// Resident-asset (VRAM-proxy) budget. Raised from 1536/0.40 → 2048/0.50 (FEATURE-GAPS #13): on a
// dense region the old cap pinned the draw-distance governor at ~48-64m while CPU heap had huge
// headroom (~28%). The heap-aware governor now backstops CPU heap, so we can hold more resident for a
// larger visible radius. VRAM is unqueryable, so the default stays moderate and a user override
// (Prefs slider) lets capable GPUs go higher; live-verify is the only real VRAM check.
// Raised 2026-06-21 (2048→3072 / 0.50→0.65) to USE available RAM: the old cap settled heavy regions
// at ~50% of the scene with most of the tab heap idle. Safe to raise because shouldEvictForHeap now
// sheds the far field when resident pushes the heap to 0.92 — the budget no longer has to sit below the
// heap brake to avoid a wedge. Tuned live on Aspen; emergencyHeap (0.92) / CRITICAL (0.95) still backstop.
const APP_BUDGET_CAP      = 3072 * 1048576  // hard cap on the resident-asset budget (bytes)
const APP_BUDGET_FRACTION = 0.65            // ...or this fraction of the heap limit, when known
const APP_BUDGET_FALLBACK = 1024 * 1048576  // budget when the heap limit is unmeasurable
const APP_BUDGET_OVERRIDE_MIN = 512  * 1048576   // user-override clamp (bytes)
const APP_BUDGET_OVERRIDE_MAX = 6144 * 1048576
// The override is ADDITIONALLY clamped to this fraction of the tab HEAP LIMIT. WHY: the resident-asset
// budget + transient bake/decode garbage + scene/worldStore overhead must all fit the heap, so the
// override can never exceed this share — else appRatio can't reach 1.0 (the eviction trigger) before heap
// OOMs. Live 2026-06-18: a 6144MB override on a 4192MB-heap tab let resident grow to ~5GB → heap 138%,
// eviction never fired (appRatio 0.85<1), stuck textures. 0.6 leaves ~40% of heap for the rest. It also
// makes the effective max HEAP-RELATIVE: a small-heap machine self-limits, a roomy one scales up safely.
const APP_BUDGET_OVERRIDE_HEAP_FRACTION = 0.6
const EMERGENCY_HEAP_RATIO = 0.92           // process-heap fraction that means pressure WHEN corroborated
const CRITICAL_HEAP_RATIO  = 0.95           // process-heap fraction that ALWAYS means pressure (no corroboration)

// Soft-heap brake (FEATURE-GAPS #11 churn): a heavy COLD load rides heap in this band while appRatio
// stays low (the real heap is the write buffer + bake/decode garbage, none of it in _appBytes). The
// 0.95 hard brake + 0.92/appRatio>0.5 corroboration both slip under heap 0.89/app 0.35 → nothing
// throttled → buildQ ran away + the scene churned. This brake pauses intake in the band so GC reclaims
// the transient garbage before heap reaches the hard brake. Corroborated by a real resident scene
// (meshMap.size > MIN_RESIDENT) NOT appRatio: a hard-reloaded page inherits the prior page's ~90%
// uncollected heap, so throttling on raw memRatio would refuse the first build → blank region; but an
// inherited-garbage startup holds no scene (meshMap≈0), while the churn held meshMap=17471.
const SOFT_HEAP_ON  = 0.85   // engage the soft brake above this heap ratio (with resident corroboration)
const SOFT_HEAP_OFF = 0.78   // release below this (hysteresis — let GC reclaim before resuming intake)
const MIN_RESIDENT  = 500    // require a real resident scene to corroborate (blank-startup guard)
// Stand the soft brake DOWN when the resident scene already explains the heap (appRatio at/above this).
// WHY (FEATURE-GAPS #13/#11 "Lever 3", live 2026-06-19): a SETTLED heavy region rides heap ~0.80 (above
// the 0.78 release) while appRatio ~0.98 — that heap is LIVE resident assets (in _appBytes), not
// transient garbage, so pausing builds reclaims nothing and the latch never clears → buildQ frozen
// forever (the wedge). The soft brake exists ONLY for the low-appRatio / high-heap case (bake/decode
// garbage NOT in _appBytes). When appRatio explains the heap, the appRatio budget controller (eviction +
// draw-distance step) owns the regime and emergencyHeap (self-releasing, unlatched) backstops OOM. =
// CULL_RESUME, the radius the engine already treats as actively eviction-managed.
const SOFT_HEAP_APP_STANDDOWN = 0.85

let _appBytes = 0
let _residentCount = 0   // engine pushes meshMap.size (cull tick); corroborates the soft-heap brake
let _softBrakeOn = false // hysteresis latch for heapThrottled()
let _appBudgetOverride = 0   // 0 = auto (heap-scaled default); >0 = user override (clamped). See setAppBudgetOverride.

/**
 * User override for the resident-asset/VRAM budget (Prefs slider). Pass null/0 to restore the
 * heap-scaled default. Clamped to [512MB, 6144MB] — going higher risks VRAM (unqueryable), so the
 * user opts in per machine; the heap-aware draw-distance governor still backstops CPU heap.
 */
export function setAppBudgetOverride(bytes) {
	_appBudgetOverride = (bytes == null || bytes <= 0)
		? 0
		: Math.max(APP_BUDGET_OVERRIDE_MIN, Math.min(APP_BUDGET_OVERRIDE_MAX, Math.floor(bytes)))
}

function _mem() {
	const m = typeof performance !== 'undefined' && performance.memory
	return m && m.jsHeapSizeLimit ? m : null
}

/** Process-heap fraction (Chrome-only, garbage-inclusive). null when unmeasurable. */
export function memRatio() {
	const m = _mem()
	return m ? m.usedJSHeapSize / m.jsHeapSizeLimit : null
}

export function memStats() {
	const m = _mem()
	if (!m) return null
	return {
		usedMB:  Math.round(m.usedJSHeapSize / 1048576),
		limitMB: Math.round(m.jsHeapSizeLimit / 1048576),
		ratio:   m.usedJSHeapSize / m.jsHeapSizeLimit,
	}
}

/** Engine pushes its truthful resident-asset byte total here (tex + mesh cache + geometry). */
export function setAppBytes(b) {
	_appBytes = Number.isFinite(b) && b > 0 ? b : 0
}

/** Engine pushes its live resident mesh count (meshMap.size) here; corroborates the soft-heap brake. */
export function setResidentCount(n) {
	_residentCount = Number.isFinite(n) && n > 0 ? n : 0
}

// Pure: clamp the resident-asset override to a heap-safe ceiling (`fraction` × heap limit). heapLimitBytes
// <= 0 (non-Chrome, no performance.memory) → fall back to the fixed cap (can't measure heap, so honor the
// user's explicit value up to the absolute max — heap-pause/eviction-on-heap don't apply there anyway).
// Exported for unit tests (no navigator/performance dep). See APP_BUDGET_OVERRIDE_HEAP_FRACTION.
export function resolveOverrideBudget(overrideBytes, heapLimitBytes,
	fraction = APP_BUDGET_OVERRIDE_HEAP_FRACTION, fallbackCap = APP_BUDGET_OVERRIDE_MAX) {
	const ceil = heapLimitBytes > 0 ? Math.floor(heapLimitBytes * fraction) : fallbackCap
	return Math.min(overrideBytes, ceil)
}

/** Resident-asset budget in bytes. User override (heap-safe-clamped) wins; else heap-scaled default. */
export function appBudgetBytes() {
	const m = _mem()
	if (_appBudgetOverride > 0) return resolveOverrideBudget(_appBudgetOverride, m ? m.jsHeapSizeLimit : 0)
	return m ? Math.min(APP_BUDGET_CAP, m.jsHeapSizeLimit * APP_BUDGET_FRACTION) : APP_BUDGET_FALLBACK
}

/** Self-accounted bytes / budget. Always a number; >1 means over budget. */
export function appRatio() {
	return _appBytes / appBudgetBytes()
}

// Emergency brake: process heap near its limit AND our own accounting corroborates that we hold a
// substantial share of it. WHY the corroboration: a hard-reloaded page can inherit the previous
// page's uncollected heap (observed: 92% heap with ~zero app content) — blocking intake then
// recreates the blank-region bug, and V8 will GC that garbage long before OOM. Only when WE are
// the ones holding the memory is near-limit heap a real stop signal.
export function emergencyHeap() {
	const r = memRatio()
	if (r == null) return false
	// Critically over the limit → real pressure that GC could not relieve, so throttle REGARDLESS of
	// appRatio. WHY no corroboration here: a full cold load blew the heap to 147% while appRatio was
	// only 0.48 — the ~5GB of real heap (geom write buffer + bake garbage + texture queue) is not in
	// _appBytes, so it slipped under the 0.5 corroboration and the drain/intake never throttled. Above
	// CRITICAL the inherited-garbage false-positive can't apply: V8 force-GCs collectable garbage long
	// before the ratio reaches here, so a reading this high is memory we genuinely cannot shed yet.
	if (r > CRITICAL_HEAP_RATIO) return true
	// Below critical, keep the corroboration (appRatio>0.5) that guards the hard-reload startup-blank
	// bug (page inherits ~0.92 heap with ~zero app content; blocking intake then would re-blank it).
	return r > EMERGENCY_HEAP_RATIO && appRatio() > 0.5
}

// Soft-heap brake: pause intake while the process heap rides in the 0.85–0.95 band AND we genuinely
// hold a resident scene (so a hard-reload's inherited garbage — heap high, no scene — can't blank the
// region). Hysteresis (engage > ON, release < OFF) prevents per-tick chatter as a single bake nudges
// heap across the line. Returns false when heap is unmeasurable (non-Chrome) — same safety as
// emergencyHeap. The 0.95 emergencyHeap brake remains the unconditional backstop above this band.
export function heapThrottled() {
	const r = memRatio()
	if (r == null) { _softBrakeOn = false; return false }
	if (_residentCount <= MIN_RESIDENT) { _softBrakeOn = false; return false }
	// Resident-explained standdown: when the self-accounted scene (appRatio) already accounts for the
	// heap, pausing builds cannot shed LIVE data — the appRatio budget controller (eviction + draw
	// distance step) owns this regime and emergencyHeap backstops genuine OOM. Reset the latch so a
	// later low-appRatio churn re-engages cleanly. Without this a settled heavy region latches the
	// brake forever (heap ~0.80 > the 0.78 release) → frozen buildQ. See SOFT_HEAP_APP_STANDDOWN.
	if (appRatio() >= SOFT_HEAP_APP_STANDDOWN) { _softBrakeOn = false; return false }
	if (_softBrakeOn) {
		if (r < SOFT_HEAP_OFF) _softBrakeOn = false
	} else {
		if (r > SOFT_HEAP_ON) _softBrakeOn = true
	}
	return _softBrakeOn
}

// True when intake (texture fetches, mesh bakes, prim ingest) should pause: over the self-accounted
// budget, genuinely near OOM (emergencyHeap), or in the soft-heap band with a real scene (heapThrottled).
export function memUnderPressure() {
	return appRatio() > 1 || emergencyHeap() || heapThrottled()
}

export { APP_BUDGET_CAP, APP_BUDGET_FRACTION, APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO, CRITICAL_HEAP_RATIO,
	SOFT_HEAP_ON, SOFT_HEAP_OFF, MIN_RESIDENT, APP_BUDGET_OVERRIDE_HEAP_FRACTION, SOFT_HEAP_APP_STANDDOWN }
