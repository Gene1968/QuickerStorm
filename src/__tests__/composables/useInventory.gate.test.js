import { describe, it, expect } from 'vitest'
import {
	shouldDeferInventoryWalk,
	FETCHALL_STALL_MS, FETCHALL_PREPOPULATE_MS, FETCHALL_DEFER_CEILING_MS,
} from '@/composables/useInventory.js'

// Explicit thresholds so these tests don't couple to constant tuning.
const OPTS = { stallMs: 30_000, prepopulateMs: 20_000, ceilingMs: 900_000 }
// args: (sawLoading, sceneLoading, msSinceProgress, msSinceCapsReady, opts)

describe('shouldDeferInventoryWalk', () => {
	it('before the region ever shows load, defers within the prepopulate window then opens', () => {
		expect(shouldDeferInventoryWalk(false, false, 0, 0, OPTS)).toBe(true)
		expect(shouldDeferInventoryWalk(false, false, 0, 19_999, OPTS)).toBe(true)
		// nothing ever loaded within the window → no contention to wait out, walk now
		expect(shouldDeferInventoryWalk(false, false, 0, 20_000, OPTS)).toBe(false)
	})

	it('defers a populated region that is actively loading AND making progress', () => {
		expect(shouldDeferInventoryWalk(true, true, 0, 60_000, OPTS)).toBe(true)
		// still deferring deep into a heavy load as long as progress is recent (the heavy-region fix)
		expect(shouldDeferInventoryWalk(true, true, 29_999, 800_000, OPTS)).toBe(true)
	})

	it('opens once the region is idle/drained, regardless of elapsed', () => {
		expect(shouldDeferInventoryWalk(true, false, 0, 5_000, OPTS)).toBe(false)
		expect(shouldDeferInventoryWalk(true, false, 0, 500_000, OPTS)).toBe(false)
	})

	it('opens if loading but stalled (no asset progress for stallMs) — never-starve backstop', () => {
		expect(shouldDeferInventoryWalk(true, true, 30_000, 60_000, OPTS)).toBe(false)
		expect(shouldDeferInventoryWalk(true, true, 120_000, 60_000, OPTS)).toBe(false)
	})

	it('opens past the absolute ceiling even while still progressing (final safety)', () => {
		expect(shouldDeferInventoryWalk(true, true, 0, 900_000, OPTS)).toBe(false)
		expect(shouldDeferInventoryWalk(true, true, 0, 1_500_000, OPTS)).toBe(false)
	})

	it('exposes sane default constants', () => {
		expect(FETCHALL_STALL_MS).toBeGreaterThanOrEqual(10_000)
		expect(FETCHALL_STALL_MS).toBeLessThanOrEqual(120_000)
		expect(FETCHALL_PREPOPULATE_MS).toBeGreaterThanOrEqual(5_000)
		expect(FETCHALL_PREPOPULATE_MS).toBeLessThanOrEqual(60_000)
		expect(FETCHALL_DEFER_CEILING_MS).toBeGreaterThanOrEqual(300_000)
		expect(FETCHALL_DEFER_CEILING_MS).toBeLessThanOrEqual(1_800_000)
	})
})
