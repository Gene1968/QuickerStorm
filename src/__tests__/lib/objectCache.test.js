import { describe, it, expect } from 'bun:test'
import { planRegionEvictions } from '@/lib/objectCache.js'

describe('planRegionEvictions (region LRU)', () => {
	it('keeps all when at or under the cap', () => {
		const regions = [
			{ regionKey: 'a', newestSavedAt: 1 },
			{ regionKey: 'b', newestSavedAt: 2 },
		]
		expect(planRegionEvictions(regions, 2)).toEqual([])
		expect(planRegionEvictions(regions, 5)).toEqual([])
	})

	it('drops the oldest regions (by newestSavedAt) beyond the cap', () => {
		const regions = [
			{ regionKey: 'new', newestSavedAt: 30 },
			{ regionKey: 'old', newestSavedAt: 10 },
			{ regionKey: 'mid', newestSavedAt: 20 },
		]
		// cap 1 → keep only 'new'; drop the two oldest, oldest-first
		expect(planRegionEvictions(regions, 1)).toEqual(['old', 'mid'])
	})
})
