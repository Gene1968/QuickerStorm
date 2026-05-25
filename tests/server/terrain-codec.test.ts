import { describe, it, expect } from 'vitest'
import { BitReader, PATCH_SIZE } from '../../server/lib/terrain-codec'

describe('BitReader', () => {
	it('reads 8 bits correctly', () => {
		const buf = Buffer.from([0b10110100])
		const r = new BitReader(buf)
		expect(r.readBits(8)).toBe(0b10110100)
	})

	it('reads bits across byte boundary', () => {
		const buf = Buffer.from([0b11110000, 0b00001111])
		const r = new BitReader(buf)
		expect(r.readBits(4)).toBe(0b1111)
		expect(r.readBits(4)).toBe(0b0000)
		expect(r.readBits(4)).toBe(0b0000)
		expect(r.readBits(4)).toBe(0b1111)
	})

	it('reads IEEE 754 float32', () => {
		// 25.5 as IEEE 754 BE: 0x41CC0000
		const buf = Buffer.from([0x41, 0xCC, 0x00, 0x00])
		const r = new BitReader(buf)
		expect(r.readFloat32()).toBeCloseTo(25.5, 4)
	})

	it('tracks bytesRead', () => {
		const buf = Buffer.alloc(4)
		const r = new BitReader(buf)
		r.readBits(9)
		expect(r.bytesRead).toBe(2)
	})
})
