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
const APP_BUDGET_CAP      = 2048 * 1048576  // hard cap on the resident-asset budget (bytes)
const APP_BUDGET_FRACTION = 0.50            // ...or this fraction of the heap limit, when known
const APP_BUDGET_FALLBACK = 1024 * 1048576  // budget when the heap limit is unmeasurable
const APP_BUDGET_OVERRIDE_MIN = 512  * 1048576   // user-override clamp (bytes)
const APP_BUDGET_OVERRIDE_MAX = 6144 * 1048576
const EMERGENCY_HEAP_RATIO = 0.92           // process-heap fraction that means pressure WHEN corroborated
const CRITICAL_HEAP_RATIO  = 0.95           // process-heap fraction that ALWAYS means pressure (no corroboration)

let _appBytes = 0
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

/** Resident-asset budget in bytes. User override (clamped) wins; else heap-scaled default. */
export function appBudgetBytes() {
	if (_appBudgetOverride > 0) return _appBudgetOverride
	const m = _mem()
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

// True when intake (texture fetches, mesh bakes) should pause: over the self-accounted budget,
// or genuinely near OOM (see emergencyHeap).
export function memUnderPressure() {
	return appRatio() > 1 || emergencyHeap()
}

export { APP_BUDGET_CAP, APP_BUDGET_FRACTION, APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO, CRITICAL_HEAP_RATIO }
