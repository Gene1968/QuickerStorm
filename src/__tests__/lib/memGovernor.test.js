import { describe, it, expect, beforeEach } from 'bun:test'
import {
	setAppBytes, appRatio, appBudgetBytes, memUnderPressure, memRatio, emergencyHeap,
	APP_BUDGET_FALLBACK, EMERGENCY_HEAP_RATIO,
} from '@/lib/memGovernor.js'

// bun test has no performance.memory → memRatio() is null, budget falls back to the fixed default.
// That makes the self-accounted path (the part that matters cross-browser) fully testable here.

beforeEach(() => setAppBytes(0))

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
