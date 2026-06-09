// src/lib/memGovernor.js — JS-heap pressure governor.
// WHY: a dense region (20k objects / ~14k textures) cold-loads everything at once. The in-memory
// THREE.Texture cache + geometries grow unbounded and the tab OOM-crashes (seen near textureCache
// _touchLater — just where the allocation tips over). Until the resident footprint is bounded
// (LRU texture eviction / lower texture dim), this governor stops the bleeding: when the JS heap
// nears its limit, callers PAUSE new texture fetches + mesh bakes so the tab survives at a partial
// load instead of crashing. No disposal here — pure backpressure, so nothing blanks.
//
// performance.memory is Chrome-only and non-standard (usedJSHeapSize / jsHeapSizeLimit in bytes).
// When unavailable, memRatio() returns null → memUnderPressure() is false → zero behavior change
// (current uncapped behavior on non-Chrome).

const DEFAULT_HIGH = 0.85   // pause intake above this fraction of the heap limit
const DEFAULT_LOW  = 0.78   // (reserved) resume hysteresis target

function _mem() {
	const m = typeof performance !== 'undefined' && performance.memory
	return m && m.jsHeapSizeLimit ? m : null
}

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

// True when the JS heap is above `threshold` of its limit. False when unmeasurable (no throttle).
export function memUnderPressure(threshold = DEFAULT_HIGH) {
	const r = memRatio()
	return r != null && r > threshold
}

export { DEFAULT_HIGH, DEFAULT_LOW }
