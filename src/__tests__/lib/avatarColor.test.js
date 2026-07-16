import { describe, it, expect } from 'bun:test'
import { jellydollColorRGB, jellydollColorHex } from '../../lib/avatarColor.js'

describe('jellydollColor', () => {
	it('is deterministic for the same UUID', () => {
		const id = '3f2a1b9c-0000-0000-0000-000000000000'
		expect(jellydollColorHex(id)).toBe(jellydollColorHex(id))
	})

	it('depends only on the first UUID byte (rest ignored)', () => {
		expect(jellydollColorHex('a1-whatever')).toBe(jellydollColorHex('a1ffffff-1234-5678-9abc-def012345678'))
	})

	it('maps first byte 0x00 to the toned-down pure-red spectrum start', () => {
		// spectrum[0] = red (1,0,0); normalize → (1,0,0); *0.7 → 0.7 → round(178.5)=179=0xB3
		expect(jellydollColorHex('00000000-0000-0000-0000-000000000000')).toBe(0xb30000)
	})

	it('gives visibly different colors across the spectrum', () => {
		const reddish = jellydollColorHex('00000000-0000-0000-0000-000000000000')
		const bluish  = jellydollColorHex('80000000-0000-0000-0000-000000000000') // ~mid → blue/cyan region
		expect(reddish).not.toBe(bluish)
	})

	it('scales with the brightness parameter (FS uses 0.28 for its mute overlay)', () => {
		const dim = jellydollColorRGB('00000000-0000-0000-0000-000000000000', 0.28)
		const bright = jellydollColorRGB('00000000-0000-0000-0000-000000000000', 0.7)
		expect(bright.r).toBeGreaterThan(dim.r)
		expect(dim.r).toBeCloseTo(0.28, 5)   // normalized pure red → r == brightness
	})

	it('never throws on malformed / empty ids (falls back to mid-spectrum)', () => {
		expect(() => jellydollColorHex('')).not.toThrow()
		expect(() => jellydollColorHex(null)).not.toThrow()
		expect(() => jellydollColorHex(undefined)).not.toThrow()
		const hex = jellydollColorHex('zzzz')
		expect(hex).toBeGreaterThanOrEqual(0)
		expect(hex).toBeLessThanOrEqual(0xffffff)
	})
})
