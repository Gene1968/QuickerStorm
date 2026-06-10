import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeJ2C, j2cToPng, j2cToPngWithAlpha, pixelsHaveAlpha, downscalePixels } from '../lib/j2c'
import { decode as decodePng } from 'fast-png'

// Real SL terrain texture codestreams staged in the repo — exercise the actual decoder, not a mock.
// WHY join(import.meta.dir, …): resolve relative to this file so the path holds regardless of the
// cwd bun runs from (single-file vs directory test invocation differ).
const img = (name: string) => readFileSync(join(import.meta.dir, '../../src/assets/img', name))
const fixture = img('terrain-dirt.j2c')

describe('j2c', () => {
	it('decodes a J2C codestream to raw pixels with frame info', async () => {
		const r = await decodeJ2C(fixture)
		expect(r.width).toBe(128)
		expect(r.height).toBe(128)
		expect(r.channels).toBe(3)
		expect(r.pixels.length).toBe(128 * 128 * 3)
	})

	it('transcodes J2C to a valid PNG of the same dimensions', async () => {
		const png = await j2cToPng(fixture)
		const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		expect(png.subarray(0, 8).equals(sig)).toBe(true)
		const img = decodePng(png)
		expect(img.width).toBe(128)
		expect(img.height).toBe(128)
	})

	it('copies pixels out of the WASM heap so repeated decodes do not clobber each other', async () => {
		const a = await decodeJ2C(fixture)
		const first = a.pixels[0]
		await decodeJ2C(img('terrain-grass.j2c'))
		expect(a.pixels[0]).toBe(first)   // 'a' must be unaffected by the second decode
	})

	it('reports the opaque RGB terrain texture as having no alpha', async () => {
		const { hasAlpha } = await j2cToPngWithAlpha(fixture)
		expect(hasAlpha).toBe(false)
	})
})

describe('downscalePixels', () => {
	it('leaves images already within the cap untouched', () => {
		const px = new Uint8Array([1, 2, 3, 4]) // 2×2 grey (1ch)
		const r = downscalePixels(px, 2, 2, 1, 512)
		expect(r.width).toBe(2); expect(r.height).toBe(2)
		expect(Array.from(r.pixels)).toEqual([1, 2, 3, 4])
	})
	it('halves a 4×4 down to 2×2 averaging each 2×2 block (1 channel)', () => {
		// 4×4 where each 2×2 quadrant is constant 0/40/80/120 → averages stay 0/40/80/120
		const px = new Uint8Array([
			0, 0, 40, 40,
			0, 0, 40, 40,
			80, 80, 120, 120,
			80, 80, 120, 120,
		])
		const r = downscalePixels(px, 4, 4, 1, 2)
		expect(r.width).toBe(2); expect(r.height).toBe(2)
		expect(Array.from(r.pixels)).toEqual([0, 40, 80, 120])
	})
	it('halves repeatedly until within the cap (8→2 when max=2)', () => {
		const px = new Uint8Array(8 * 8 * 3).fill(100)
		const r = downscalePixels(px, 8, 8, 3, 2)
		expect(r.width).toBe(2); expect(r.height).toBe(2)
		expect(r.pixels.every(v => v === 100)).toBe(true)  // constant image stays constant
	})
	it('bails on odd dimensions rather than reading out of bounds', () => {
		const px = new Uint8Array(3 * 3).fill(7)
		const r = downscalePixels(px, 3, 3, 1, 2)
		expect(r.width).toBe(3); expect(r.height).toBe(3)  // 3 is odd → cannot cleanly halve
	})
	it('preserves RGBA channel interleave', () => {
		const px = new Uint8Array([
			10, 20, 30, 255,  10, 20, 30, 255,
			10, 20, 30, 255,  10, 20, 30, 255,
		]) // 2×2 uniform RGBA
		const r = downscalePixels(px, 2, 2, 4, 1)
		expect(r.width).toBe(1); expect(r.height).toBe(1)
		expect(Array.from(r.pixels)).toEqual([10, 20, 30, 255])
	})
})

describe('pixelsHaveAlpha', () => {
	it('returns false for non-RGBA channel counts', () => {
		expect(pixelsHaveAlpha(new Uint8Array([10, 20, 30]), 3)).toBe(false)
		expect(pixelsHaveAlpha(new Uint8Array([10]), 1)).toBe(false)
	})
	it('returns false when every alpha sample is fully opaque', () => {
		expect(pixelsHaveAlpha(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]), 4)).toBe(false)
	})
	it('returns true when any alpha sample is sub-255', () => {
		expect(pixelsHaveAlpha(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]), 4)).toBe(true)
		expect(pixelsHaveAlpha(new Uint8Array([1, 2, 3, 0]), 4)).toBe(true)
	})
})
