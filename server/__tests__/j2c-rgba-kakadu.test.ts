import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeJ2C, j2cToPngWithAlpha } from '../lib/j2c'

// Live-captured RGBA foliage texture (palm frond, 59c3769c…, encoded by Kakadu-v4.2.1, 6 quality
// layers, 4 components, 9-7 irreversible + ICT). The cornerstone openjpeg-wasm build mis-decoded
// this codestream class — luma/chroma/alpha all corrupted (background came back opaque white, the
// frond translucent purple) so foliage cutouts rendered as white blobs in-world. Ground truth below
// cross-checked with two independent OpenJPEG decoders (Pillow + ImageMagick), which agree exactly.
const fixture = readFileSync(join(import.meta.dir, 'fixtures/palm-frond-rgba.j2c'))

describe('j2c RGBA multi-layer Kakadu codestream', () => {
	it('decodes to 512×512 RGBA', async () => {
		const r = await decodeJ2C(fixture)
		expect(r.width).toBe(512)
		expect(r.height).toBe(512)
		expect(r.channels).toBe(4)
		expect(r.pixels.length).toBe(512 * 512 * 4)
	})

	it('decodes the transparent background as transparent (alpha 0), not opaque white', async () => {
		const r = await decodeJ2C(fixture)
		// (0,0) is background: ground truth rgba=(255,255,255,0)
		expect(r.pixels[3]).toBeLessThan(8)
	})

	it('decodes the frond center as opaque olive-green', async () => {
		const r = await decodeJ2C(fixture)
		const o = (256 * 512 + 256) * 4
		const [red, green, blue, alpha] = [r.pixels[o], r.pixels[o + 1], r.pixels[o + 2], r.pixels[o + 3]]
		// ground truth rgba=(46,57,16,255); allow small decoder tolerance
		expect(Math.abs(red - 46)).toBeLessThan(8)
		expect(Math.abs(green - 57)).toBeLessThan(8)
		expect(Math.abs(blue - 16)).toBeLessThan(8)
		expect(alpha).toBeGreaterThan(247)
	})

	it('reports real transparency via j2cToPngWithAlpha', async () => {
		const { hasAlpha, width, height } = await j2cToPngWithAlpha(fixture)
		expect(hasAlpha).toBe(true)
		expect(width).toBe(512)
		expect(height).toBe(512)
	})
})
