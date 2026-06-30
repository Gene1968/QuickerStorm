import { describe, it, expect } from 'vitest'
import { generateWaterNormalData } from './waterNormalTexture.js'

describe('generateWaterNormalData', () => {
	it('produces size*size*4 RGBA bytes', () => {
		const size = 8
		const data = generateWaterNormalData(size)
		expect(data.length).toBe(size * size * 4)
	})

	it('packs wave height into alpha (varies, not all opaque)', () => {
		const data = generateWaterNormalData(16)
		const alphas = new Set()
		for (let i = 3; i < data.length; i += 4) alphas.add(data[i])
		// Height field is non-constant, so alpha must take more than one value.
		expect(alphas.size).toBeGreaterThan(1)
	})

	it('encodes mostly-upward normals (blue/z channel > 127)', () => {
		const size = 16
		const data = generateWaterNormalData(size)
		let upward = 0
		const texels = size * size
		for (let i = 0; i < texels; i++) if (data[i * 4 + 2] > 127) upward++
		// A water surface normal map should point up nearly everywhere.
		expect(upward).toBeGreaterThan(texels * 0.9)
	})

	it('all channel values stay in byte range', () => {
		const data = generateWaterNormalData(8)
		for (const v of data) {
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThanOrEqual(255)
		}
	})

	it('is deterministic (same input → same bytes)', () => {
		const a = generateWaterNormalData(8)
		const b = generateWaterNormalData(8)
		expect(Array.from(a)).toEqual(Array.from(b))
	})

	it('tiles seamlessly: column 0 normals ≈ wrap of last column', () => {
		// Finite differences wrap, so the gradient at x=0 uses x=size-1; the map must be continuous
		// across the seam. Check the z (up) channel matches closely on opposing edges.
		const size = 16
		const data = generateWaterNormalData(size)
		for (let y = 0; y < size; y++) {
			const left = data[(y * size + 0) * 4 + 2]
			const right = data[(y * size + (size - 1)) * 4 + 2]
			expect(Math.abs(left - right)).toBeLessThan(60)
		}
	})
})
