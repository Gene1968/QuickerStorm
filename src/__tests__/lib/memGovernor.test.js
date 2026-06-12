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
