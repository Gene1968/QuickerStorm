import { describe, it, expect } from 'vitest'
import { shouldDeferInventoryWalk, FETCHALL_DEFER_CEILING_MS } from '@/composables/useInventory.js'

describe('shouldDeferInventoryWalk', () => {
	it('defers while the region is loading and within the ceiling', () => {
		expect(shouldDeferInventoryWalk(true, 0, 240_000)).toBe(true)
		expect(shouldDeferInventoryWalk(true, 239_999, 240_000)).toBe(true)
	})

	it('does NOT defer once the region is idle (regardless of elapsed)', () => {
		expect(shouldDeferInventoryWalk(false, 0, 240_000)).toBe(false)
		expect(shouldDeferInventoryWalk(false, 500_000, 240_000)).toBe(false)
	})

	it('does NOT defer past the ceiling even if still loading (never-starve fallback)', () => {
		expect(shouldDeferInventoryWalk(true, 240_000, 240_000)).toBe(false)
		expect(shouldDeferInventoryWalk(true, 999_999, 240_000)).toBe(false)
	})

	it('exposes a sane default ceiling (minutes, not seconds or hours)', () => {
		expect(FETCHALL_DEFER_CEILING_MS).toBeGreaterThanOrEqual(60_000)
		expect(FETCHALL_DEFER_CEILING_MS).toBeLessThanOrEqual(600_000)
	})
})
