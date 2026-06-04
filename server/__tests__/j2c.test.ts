import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeJ2C, j2cToPng } from '../lib/j2c'
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
})
