import { describe, it, expect } from 'vitest'
import { terrainRegionDim } from '@/lib/terrainSize'

describe('terrainRegionDim', () => {
	it('derives 1024 from a patch at index 63 (the far edge of a 1024m region)', () => {
		expect(terrainRegionDim([{ x: 6, y: 63 }, { x: 15, y: 63 }], 16)).toBe(1024)
	})
	it('derives 256 from the far edge of a standard region (index 15)', () => {
		expect(terrainRegionDim([{ x: 15, y: 15 }], 16)).toBe(256)
	})
	it('uses the max of x and y per patch (an x-only far patch still implies width)', () => {
		expect(terrainRegionDim([{ x: 63, y: 0 }], 16)).toBe(1024)
	})
	it('takes the largest index across the whole batch', () => {
		expect(terrainRegionDim([{ x: 0, y: 0 }, { x: 31, y: 2 }, { x: 5, y: 5 }], 16)).toBe(512)
	})
	it('returns 0 for an empty / missing batch (caller treats as no-op)', () => {
		expect(terrainRegionDim([], 16)).toBe(0)
		expect(terrainRegionDim(undefined, 16)).toBe(0)
	})
	it('defaults patchSize to 16', () => {
		expect(terrainRegionDim([{ x: 15, y: 15 }])).toBe(256)
	})
})
