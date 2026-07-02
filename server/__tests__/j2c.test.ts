import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeJ2C, j2cToImage, j2cToImageWithAlpha, pixelsHaveAlpha, downscalePixels, encodeWebp, rawFormatFor } from '../lib/j2c'
import { ImageMagick } from '@imagemagick/magick-wasm'

// Real SL terrain texture codestreams — exercise the actual decoder, not a mock. Fixtures live in
// fixtures/ since the runtime copies were replaced by .webp (terrain texturing, 17b14d4).
// WHY join(import.meta.dir, …): resolve relative to this file so the path holds regardless of the
// cwd bun runs from (single-file vs directory test invocation differ).
const img = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name))
const fixture = img('terrain-dirt.j2c')

// RIFF container with a WEBP fourcc — enough to assert "this is a WebP" without a full parse.
const isWebp = (b: Buffer) =>
	b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'
// Bytes 12–15: WebP chunk fourcc. 'VP8 ' = lossy, 'VP8L' = lossless, 'VP8X' = extended container.
const webpFourcc = (b: Buffer) => b.subarray(12, 16).toString('latin1')

describe('j2c', () => {
	it('decodes a J2C codestream to raw pixels with frame info', async () => {
		const r = await decodeJ2C(fixture)
		expect(r.width).toBe(128)
		expect(r.height).toBe(128)
		expect(r.channels).toBe(3)
		expect(r.pixels.length).toBe(128 * 128 * 3)
	})

	it('transcodes an opaque J2C to a valid lossy WebP of the right dimensions', async () => {
		const webp = await j2cToImage(fixture)
		expect(isWebp(webp)).toBe(true)
		expect(webpFourcc(webp)).toBe('VP8 ')
		let w = 0, h = 0
		ImageMagick.read(webp, image => { w = image.width; h = image.height })
		expect(w).toBe(128); expect(h).toBe(128)
	})

	it('copies pixels out of the WASM heap so repeated decodes do not clobber each other', async () => {
		const a = await decodeJ2C(fixture)
		const first = a.pixels[0]
		await decodeJ2C(img('terrain-grass.j2c'))
		expect(a.pixels[0]).toBe(first)   // 'a' must be unaffected by the second decode
	})

	it('reports the opaque RGB terrain texture as having no alpha', async () => {
		const { hasAlpha } = await j2cToImageWithAlpha(fixture)
		expect(hasAlpha).toBe(false)
	})

	it('reports the RGBA foliage texture as having alpha and emits a valid WebP', async () => {
		const { image, hasAlpha } = await j2cToImageWithAlpha(img('palm-frond-rgba.j2c'))
		expect(hasAlpha).toBe(true)
		expect(isWebp(image)).toBe(true)
		expect(webpFourcc(image)).toBe('VP8L')
	})

	it('always reports the TRUE J2C-header dimensions regardless of the downscale cap', async () => {
		// A 128×128 fixture is already within the 512 default cap, so srcWidth/srcHeight == width/height.
		const r = await j2cToImageWithAlpha(fixture)
		expect(r.srcWidth).toBe(128)
		expect(r.srcHeight).toBe(128)
	})

	it('maxDim override downscales (cap<src) vs full-resolution (Infinity keeps src pixels)', async () => {
		// Cap below source → the emitted WebP is downscaled but srcWidth/srcHeight stay the true dims.
		const capped = await j2cToImageWithAlpha(fixture, 64)
		expect(capped.width).toBe(64)
		expect(capped.height).toBe(64)
		expect(capped.srcWidth).toBe(128)
		expect(capped.srcHeight).toBe(128)
		// Full-res (Infinity) → the preview path: emitted pixels equal the true asset dimensions.
		const full = await j2cToImageWithAlpha(fixture, Infinity)
		expect(full.width).toBe(128)
		expect(full.height).toBe(128)
		expect(full.srcWidth).toBe(128)
		expect(full.srcHeight).toBe(128)
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

describe('encodeWebp', () => {
	it('maps channel counts to magick raw formats and rejects out-of-range', () => {
		expect(rawFormatFor(1)).toBe('GRAY')
		expect(rawFormatFor(2)).toBe('GRAYA')
		expect(rawFormatFor(3)).toBe('RGB')
		expect(rawFormatFor(4)).toBe('RGBA')
		expect(() => rawFormatFor(5)).toThrow('webp_unsupported_channels')
	})

	it('lossless-encodes RGBA pixels to a WebP that round-trips exactly', async () => {
		await decodeJ2C(fixture)   // ensure magick is initialized
		// WHY alpha=0 at pixel 2: webp:exact preserves RGB under fully-transparent pixels so the
		// round-trip must be byte-exact even there — this assertion would fail without that artifact.
		const px = new Uint8Array([10, 20, 30, 128, 40, 50, 60, 255, 70, 80, 90, 0, 100, 110, 120, 200]) // 2×2 RGBA
		const webp = encodeWebp(px, 2, 2, 4, true)
		expect(isWebp(webp)).toBe(true)
		let back: Uint8Array | null = null
		ImageMagick.read(webp, img => { img.getPixels(p => { back = new Uint8Array(p.getArea(0, 0, 2, 2)) }) })
		expect(Array.from(back!)).toEqual(Array.from(px))   // lossless → byte-exact
	})

	it('lossless-encodes a GRAY 2×2 buffer to a valid WebP container (raw GRAY import path)', async () => {
		// WHY decodeJ2C first: ensures magick is initialized the same way the neighboring test does.
		await decodeJ2C(fixture)
		const px = new Uint8Array([0, 85, 170, 255]) // 2×2 single-channel GRAY
		// WHY no round-trip assertion: magick reads WebP back as RGB/RGBA, so the gray input path
		// can't be checked pixel-for-pixel here — valid-container check is sufficient.
		expect(isWebp(encodeWebp(px, 2, 2, 1, true))).toBe(true)
	})

	it('throws webp_encode_size_mismatch when pixel buffer length does not match dimensions', () => {
		// WHY synchronous: encodeWebp is sync; the guard fires before any WASM call so no init needed.
		expect(() => encodeWebp(new Uint8Array(8), 2, 2, 4, true)).toThrow('webp_encode_size_mismatch')
	})
})
