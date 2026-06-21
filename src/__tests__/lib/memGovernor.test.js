import { describe, it, expect, beforeEach } from 'bun:test'
import {
	setAppBytes, appRatio, appBudgetBytes, memUnderPressure, memRatio, emergencyHeap,
	APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO, setAppBudgetOverride,
	setResidentCount, heapThrottled, SOFT_HEAP_ON, SOFT_HEAP_OFF, MIN_RESIDENT,
	resolveOverrideBudget, APP_BUDGET_OVERRIDE_HEAP_FRACTION, SOFT_HEAP_APP_STANDDOWN,
} from '@/lib/memGovernor.js'

// bun test has no performance.memory → memRatio() is null, budget falls back to the fixed default.
// That makes the self-accounted path (the part that matters cross-browser) fully testable here.

beforeEach(() => { setAppBytes(0); setResidentCount(0) })

describe('self-accounted app budget', () => {
	it('memRatio is null without performance.memory (non-Chrome path)', () => {
		expect(memRatio()).toBeNull()
	})

	it('budget falls back to the fixed default when heap limit is unmeasurable', () => {
		expect(appBudgetBytes()).toBe(APP_BUDGET_FALLBACK)
	})

	it('appRatio tracks setAppBytes against the budget', () => {
		setAppBytes(appBudgetBytes() / 2)
		expect(appRatio()).toBeCloseTo(0.5)
	})

	it('not under pressure below budget — even though the OLD heap-based path would be blind here', () => {
		setAppBytes(appBudgetBytes() * 0.9)
		expect(memUnderPressure()).toBe(false)
	})

	it('under pressure once self-accounted bytes exceed the budget (no process heap needed)', () => {
		setAppBytes(appBudgetBytes() * 1.1)
		expect(memUnderPressure()).toBe(true)
	})

	it('exports a sane emergency heap threshold', () => {
		expect(EMERGENCY_HEAP_RATIO).toBeGreaterThan(0.85)
		expect(EMERGENCY_HEAP_RATIO).toBeLessThan(1)
	})

	it('emergency brake never fires without a measurable heap (and so never on inherited-garbage-only signals)', () => {
		setAppBytes(appBudgetBytes() * 0.9)
		expect(emergencyHeap()).toBe(false)
	})
})

// FEATURE-GAPS #13: the app/VRAM budget gates the draw-distance governor. 1536MB capped dd at ~48-64m
// on dense regions even though heap had huge headroom (28%). Raised default (heap-scaled) + a user
// override (Prefs slider) so capable machines show more scene; the heap-aware governor backstops CPU
// heap, and live-verify checks VRAM (unqueryable).
describe('app/VRAM budget — raised default + user override', () => {
	const MB = 1048576
	const setHeap = (limMB) => { globalThis.performance.memory = { usedJSHeapSize: 0, jsHeapSizeLimit: limMB * MB } }
	const clearHeap = () => { try { delete globalThis.performance.memory } catch { globalThis.performance.memory = undefined } }

	it('default is min(3072MB cap, 0.65 × heap)', () => {
		setHeap(3072); try { expect(Math.round(appBudgetBytes() / MB)).toBe(1997) } finally { clearHeap() }  // 0.65×3072=1996.8→1997
		setHeap(8192); try { expect(Math.round(appBudgetBytes() / MB)).toBe(3072) } finally { clearHeap() }  // capped at 3072
	})
	it('user override clamped to [512MB, 0.6 × heap] on Chrome (heap-safe ceiling)', () => {
		try {
			setHeap(4192)   // 0.6 × 4192 ≈ 2515MB heap-safe ceiling
			setAppBudgetOverride(3000 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(2515)  // clamped to heap ceiling
			setAppBudgetOverride(99999 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(2515) // clamp high → heap ceiling
			setAppBudgetOverride(1 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(512)        // clamp low
		} finally { setAppBudgetOverride(null); clearHeap() }
	})
	it('override honored up to the fixed max on a roomy heap', () => {
		try {
			setHeap(16384)  // 0.6 × 16384 ≈ 9830MB > 6144 fixed max → override honored
			setAppBudgetOverride(6144 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(6144)
		} finally { setAppBudgetOverride(null); clearHeap() }
	})
	it('override of null restores the heap-scaled default', () => {
		try { setHeap(3072); setAppBudgetOverride(3000 * MB); setAppBudgetOverride(null); expect(Math.round(appBudgetBytes() / MB)).toBe(1997) } finally { clearHeap() }
	})
})

// The resident-asset override must never exceed a fraction of the TAB HEAP LIMIT — else appRatio can't
// reach 1.0 (the eviction trigger) before heap OOMs. Live 2026-06-18: a 6144MB override on a 4192MB-heap
// tab let resident grow to ~5GB → heap 138%, eviction never fired, stuck textures.
describe('resolveOverrideBudget (heap-safe override ceiling)', () => {
	const MB = 1048576
	it('clamps the override to 0.6 × heap limit on Chrome', () => {
		expect(Math.round(resolveOverrideBudget(6144 * MB, 4192 * MB) / MB)).toBe(2515)   // 0.6×4192
		expect(Math.round(resolveOverrideBudget(2000 * MB, 4192 * MB) / MB)).toBe(2000)   // under ceiling → honored
	})
	it('honors a large override on a roomy heap (ceiling above the fixed max)', () => {
		expect(Math.round(resolveOverrideBudget(6144 * MB, 16384 * MB) / MB)).toBe(6144)  // 0.6×16384 ≈ 9830 > 6144
	})
	it('falls back to the fixed cap when the heap limit is unknown (non-Chrome)', () => {
		expect(Math.round(resolveOverrideBudget(6144 * MB, 0) / MB)).toBe(6144)
	})
	it('exposes a sane heap fraction (leaves room for garbage/overhead)', () => {
		expect(APP_BUDGET_OVERRIDE_HEAP_FRACTION).toBeGreaterThan(0.3)
		expect(APP_BUDGET_OVERRIDE_HEAP_FRACTION).toBeLessThanOrEqual(0.8)
	})
})

// FEATURE-GAPS #13/#11: a full cold load blew the heap to 147% while the SELF-ACCOUNTED appRatio was
// only 0.48 — the ~5GB of real heap (write buffer, bake garbage, texture queue) is not in _appBytes,
// so it slipped under emergencyHeap's appRatio>0.5 corroboration → the drain/intake never throttled
// (memUnderPressure stayed false) → 147% → textures wiped, geometry placeholdered ("cubes").
describe('critical-heap brake (heap-aware throttle)', () => {
	const MB = 1048576
	const setHeap = (usedMB, limitMB) => { globalThis.performance.memory = { usedJSHeapSize: usedMB * MB, jsHeapSizeLimit: limitMB * MB } }
	const clearHeap = () => { try { delete globalThis.performance.memory } catch { globalThis.performance.memory = undefined } }

	it('fires on critically high heap even when appRatio is below the 0.5 corroboration (the blowout case)', () => {
		setHeap(4000, 4192)          // ratio ~0.954 — critically high
		setAppBytes(100 * MB)        // appRatio ~0.065 — unaccounted heap, the real blowout signature
		try {
			expect(memRatio()).toBeGreaterThan(0.95)
			expect(appRatio()).toBeLessThan(0.5)
			expect(emergencyHeap()).toBe(true)       // throttle must engage despite low appRatio
			expect(memUnderPressure()).toBe(true)
		} finally { clearHeap() }
	})

	it('does NOT fire below critical with low appRatio (startup inherited-garbage guard preserved)', () => {
		setHeap(3870, 4192)          // ratio ~0.923 — high but below critical (the startup-blank scenario)
		setAppBytes(50 * MB)         // ~zero app content
		try { expect(emergencyHeap()).toBe(false) } finally { clearHeap() }
	})

	it('still fires via the existing 0.92 + appRatio>0.5 corroboration path', () => {
		setHeap(3870, 4192)          // ratio ~0.923
		setAppBytes(appBudgetBytes() * 0.6)   // appRatio 0.6 > 0.5
		try { expect(emergencyHeap()).toBe(true) } finally { clearHeap() }
	})
})

// FEATURE-GAPS #11 churn: a heavy cold load rides heap ~0.85–0.95 while appRatio stays ~0.35 (the
// real heap is write buffer + bake/decode garbage, not in _appBytes). Below the 0.95 hard brake and
// below the 0.92+appRatio>0.5 corroboration, NOTHING throttled → buildQ ran away, scene churned.
// The soft brake closes that band, corroborated by a real resident scene (meshMap.size) so a
// hard-reload inheriting ~90% garbage heap with no scene can't be blanked.
describe('soft-heap brake (heavy-cold-load churn)', () => {
	const MB = 1048576
	const setHeap = (usedMB, limitMB) => { globalThis.performance.memory = { usedJSHeapSize: usedMB * MB, jsHeapSizeLimit: limitMB * MB } }
	const clearHeap = () => { try { delete globalThis.performance.memory } catch { globalThis.performance.memory = undefined } }

	it('exports a sane hysteresis band and resident floor', () => {
		expect(SOFT_HEAP_ON).toBeGreaterThan(SOFT_HEAP_OFF)
		expect(SOFT_HEAP_ON).toBeLessThan(0.95)        // below the hard brake
		expect(MIN_RESIDENT).toBeGreaterThan(0)
	})

	it('fires on the churn signature (heap 0.88, real scene) even though appRatio < 0.5', () => {
		setHeap(3690, 4192)              // ratio ~0.88 — in the soft band, below 0.95
		setAppBytes(100 * MB)            // appRatio ~0.065 — the unaccounted-heap signature
		setResidentCount(17471)          // a genuinely large resident scene
		try {
			expect(memRatio()).toBeGreaterThan(SOFT_HEAP_ON)
			expect(appRatio()).toBeLessThan(0.5)
			expect(heapThrottled()).toBe(true)
			expect(memUnderPressure()).toBe(true)
		} finally { clearHeap() }
	})

	it('does NOT fire with no resident scene (hard-reload inherited-garbage blank-startup guard)', () => {
		setHeap(3690, 4192)              // ratio ~0.88 — same high heap...
		setResidentCount(0)              // ...but no scene yet → must still build (no blank region)
		try { expect(heapThrottled()).toBe(false) } finally { clearHeap() }
	})

	it('hysteresis: engages above ON, stays engaged mid-band, releases below OFF', () => {
		setResidentCount(17471)
		try {
			setHeap(3610, 4192)          // ~0.861 > 0.85 ON → engage
			expect(heapThrottled()).toBe(true)
			setHeap(3360, 4192)          // ~0.801 between OFF and ON → stay engaged (latched)
			expect(heapThrottled()).toBe(true)
			setHeap(3220, 4192)          // ~0.768 < 0.78 OFF → release
			expect(heapThrottled()).toBe(false)
		} finally { clearHeap() }
	})

	it('never fires without a measurable heap (non-Chrome safety), regardless of resident count', () => {
		clearHeap()
		setResidentCount(50000)
		expect(memRatio()).toBeNull()
		expect(heapThrottled()).toBe(false)
	})
})

// FEATURE-GAPS #13/#11 "Lever 3" (2026-06-19): a SETTLED heavy region wedges — heap rides ~0.80
// (above the 0.78 release) while appRatio is ~0.98, so the LATCHED soft brake never clears and the
// build queue freezes forever. That 0.80 heap is the LIVE resident scene (in _appBytes), not garbage,
// so pausing builds reclaims nothing. The brake must STAND DOWN when appRatio already explains the
// heap and defer to the appRatio budget controller (eviction + draw-distance step). See
// docs/superpowers/specs/2026-06-19-heap-brake-resident-standdown-design.md.
describe('soft-heap brake — resident-explained standdown', () => {
	const MB = 1048576
	const setHeap = (usedMB, limitMB) => { globalThis.performance.memory = { usedJSHeapSize: usedMB * MB, jsHeapSizeLimit: limitMB * MB } }
	const clearHeap = () => { try { delete globalThis.performance.memory } catch { globalThis.performance.memory = undefined } }

	it('exports a sane standdown threshold (between the churn appRatio and a full budget)', () => {
		expect(SOFT_HEAP_APP_STANDDOWN).toBeGreaterThan(0.5)
		expect(SOFT_HEAP_APP_STANDDOWN).toBeLessThan(1)
	})

	it('stands down when the resident scene explains the heap (high appRatio in the soft band) — the wedge fix', () => {
		setHeap(3690, 4192)                          // ratio ~0.88 — in the soft band, above SOFT_HEAP_ON
		setResidentCount(11538)                      // a genuinely large resident scene
		setAppBytes(appBudgetBytes() * 0.98)         // appRatio ~0.98 — heap is the resident scene, accounted
		try {
			expect(memRatio()).toBeGreaterThan(SOFT_HEAP_ON)
			expect(appRatio()).toBeGreaterThanOrEqual(SOFT_HEAP_APP_STANDDOWN)
			expect(heapThrottled()).toBe(false)      // brake stands down → builds resume (no more frozen buildQ)
			expect(memUnderPressure()).toBe(false)   // appRatio<1, emergencyHeap false, brake stood down
		} finally { clearHeap() }
	})

	it('resets the latch when appRatio rises above standdown (no lingering throttle)', () => {
		setResidentCount(11538)
		try {
			setHeap(3610, 4192)                      // ~0.861 > ON, appRatio ~0 → engage the latch
			setAppBytes(100 * MB)
			expect(heapThrottled()).toBe(true)
			setHeap(3360, 4192)                      // ~0.801 mid-band — latched brake would normally STAY on
			setAppBytes(appBudgetBytes() * 0.9)      // appRatio 0.9 ≥ standdown → stand down, clear the latch
			expect(heapThrottled()).toBe(false)
			// Prove the latch was actually cleared (not just masked): drop appRatio back low at the same
			// mid-band heap (0.801 < ON) — a cleared latch stays off; a still-set latch would read true.
			setAppBytes(100 * MB)
			expect(heapThrottled()).toBe(false)
		} finally { clearHeap() }
	})

	it('still fires on the churn signature (low appRatio, high heap) — standdown does not weaken it', () => {
		setHeap(3690, 4192)                          // ~0.88
		setResidentCount(17471)
		setAppBytes(100 * MB)                        // appRatio ~0.05 — below standdown → brake still fires
		try {
			expect(appRatio()).toBeLessThan(SOFT_HEAP_APP_STANDDOWN)
			expect(heapThrottled()).toBe(true)
		} finally { clearHeap() }
	})
})
