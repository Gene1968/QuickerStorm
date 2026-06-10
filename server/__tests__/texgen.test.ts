import { describe, it, expect } from 'bun:test'
import { texGenFromMediaByte } from '../lib/lludp-codec'

// TexGen lives in the TE MediaFlags byte, bits 1-2 (mask 0x06). Bit 0 = media-present flag (ignored).
describe('texGenFromMediaByte', () => {
	it('0x00 → 0 (DEFAULT)', () => {
		expect(texGenFromMediaByte(0x00)).toBe(0)
	})
	it('0x02 → 1 (PLANAR)', () => {
		expect(texGenFromMediaByte(0x02)).toBe(1)
	})
	it('ignores the media-present bit (bit 0)', () => {
		expect(texGenFromMediaByte(0x01)).toBe(0)  // media flag only → still DEFAULT
		expect(texGenFromMediaByte(0x03)).toBe(1)  // media flag + planar → PLANAR
	})
	it('reads the 2-bit field (0x04 → 2, 0x06 → 3)', () => {
		expect(texGenFromMediaByte(0x04)).toBe(2)
		expect(texGenFromMediaByte(0x06)).toBe(3)
	})
})
