import { describe, it, expect, beforeEach } from 'bun:test'
import {
	setAppBytes, appRatio, appBudgetBytes, memUnderPressure, memRatio, emergencyHeap,
	APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO, setAppBudgetOverride,
	setResidentCount, heapThrottled, SOFT_HEAP_ON, SOFT_HEAP_OFF, MIN_RESIDENT,
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

	it('default is min(2048MB cap, 0.50 × heap)', () => {
		setHeap(3072); try { expect(Math.round(appBudgetBytes() / MB)).toBe(1536) } finally { clearHeap() }  // 0.50×3072
		setHeap(8192); try { expect(Math.round(appBudgetBytes() / MB)).toBe(2048) } finally { clearHeap() }  // capped
	})
	it('user override wins, clamped to [512, 6144] MB', () => {
		try {
			setHeap(4192)
			setAppBudgetOverride(3000 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(3000)
			setAppBudgetOverride(99999 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(6144)  // clamp high
			setAppBudgetOverride(1 * MB); expect(Math.round(appBudgetBytes() / MB)).toBe(512)        // clamp low
		} finally { setAppBudgetOverride(null); clearHeap() }
	})
	it('override of null restores the heap-scaled default', () => {
		try { setHeap(3072); setAppBudgetOverride(3000 * MB); setAppBudgetOverride(null); expect(Math.round(appBudgetBytes() / MB)).toBe(1536) } finally { clearHeap() }
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
