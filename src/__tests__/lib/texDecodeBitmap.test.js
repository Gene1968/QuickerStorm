import { describe, it, expect } from 'vitest'
import { computeDownscale } from '@/lib/texDecodeBitmap.js'

describe('computeDownscale', () => {
	it('returns null when the image already fits within maxDim', () => {
		expect(computeDownscale(256, 256, 256)).toBeNull()
		expect(computeDownscale(128, 64, 256)).toBeNull()
	})
	it('scales the longest edge (landscape) down to maxDim', () => {
		expect(computeDownscale(1024, 512, 256)).toEqual({ w: 256, h: 128 })
	})
	it('scales the longest edge (portrait) down to maxDim', () => {
		expect(computeDownscale(512, 1024, 256)).toEqual({ w: 128, h: 256 })
	})
	it('scales a square to maxDim x maxDim', () => {
		expect(computeDownscale(1024, 1024, 256)).toEqual({ w: 256, h: 256 })
	})
	it('floors the short edge at 1px for extreme aspect ratios', () => {
		expect(computeDownscale(4096, 4, 256)).toEqual({ w: 256, h: 1 })
	})
})
