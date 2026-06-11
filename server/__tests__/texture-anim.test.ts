import { describe, it, expect } from 'bun:test'
import { parseTextureAnim } from '../lib/lludp-codec'

// Wire format: mode u8, face s8, sizeX u8, sizeY u8, start f32le, length f32le, rate f32le (16B).
function taBuf(mode: number, face: number, sizeX: number, sizeY: number, start: number, length: number, rate: number): Buffer {
	const b = Buffer.alloc(16)
	b.writeUInt8(mode, 0)
	b.writeInt8(face, 1)
	b.writeUInt8(sizeX, 2)
	b.writeUInt8(sizeY, 3)
	b.writeFloatLE(start, 4)
	b.writeFloatLE(length, 8)
	b.writeFloatLE(rate, 12)
	return b
}

describe('parseTextureAnim', () => {
	it('parses a 16-byte ANIM_ON block', () => {
		// SMOOTH(0x10) | LOOP(0x02) | ON(0x01) on all faces — the static UV-scale trick.
		const b = taBuf(0x13, -1, 4, 4, 0, 1, 0.5)
		const ta = parseTextureAnim(b, 0, 16)
		expect(ta).toEqual({ mode: 0x13, face: -1, sizeX: 4, sizeY: 4, start: 0, length: 1, rate: 0.5 })
	})

	it('parses at a non-zero offset (embedded in a packet)', () => {
		const b = Buffer.concat([Buffer.from([0xaa, 0xbb]), taBuf(0x01, 2, 1, 1, 0, 0, 1)])
		const ta = parseTextureAnim(b, 2, 16)
		expect(ta?.face).toBe(2)
		expect(ta?.rate).toBe(1)
	})

	it('returns null when ANIM_ON is clear (no render effect)', () => {
		expect(parseTextureAnim(taBuf(0x10, -1, 4, 4, 0, 1, 1), 0, 16)).toBeNull()
	})

	it('returns null for absent/short blocks (legacy 4-byte and empty)', () => {
		expect(parseTextureAnim(Buffer.alloc(0), 0, 0)).toBeNull()
		expect(parseTextureAnim(Buffer.from([0x01, 0xff, 4, 4]), 0, 4)).toBeNull()
	})

	it('returns null when the declared length overruns the buffer', () => {
		expect(parseTextureAnim(Buffer.alloc(10), 0, 16)).toBeNull()
	})
})
