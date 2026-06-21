import { describe, it, expect } from 'bun:test'
import { decodeParticleSystem, PS } from './particleCodec.ts'

function fixedU(value: number, intBits: number, fracBits: number): Buffer {
	const total = intBits + fracBits
	const raw = Math.round(value * (1 << fracBits))
	if (total <= 8) return Buffer.from([raw & 0xff])
	const b = Buffer.alloc(2); b.writeUInt16LE(raw & 0xffff, 0); return b
}
function fixedS(value: number, intBits: number, fracBits: number): Buffer {
	const total = intBits + fracBits + 1
	const raw = Math.round((value + (1 << intBits)) * (1 << fracBits))
	if (total <= 8) return Buffer.from([raw & 0xff])
	const b = Buffer.alloc(2); b.writeUInt16LE(raw & 0xffff, 0); return b
}
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }
const ZERO16 = Buffer.alloc(16)

function legacyBlock(): Buffer {
	return Buffer.concat([
		u32(0x12345678),
		u32(0),
		Buffer.from([PS.PATTERN_ANGLE_CONE]),
		fixedU(2.0, 8, 8),
		fixedU(0.0, 8, 8),
		fixedU(0.5, 3, 5),
		fixedU(1.5, 3, 5),
		fixedU(0.1, 8, 8),
		fixedU(0.0, 8, 8),
		fixedU(1.0, 8, 8),
		fixedU(2.0, 8, 8),
		Buffer.from([4]),
		fixedS(0, 8, 7), fixedS(0, 8, 7), fixedS(0, 8, 7),
		fixedS(0, 8, 7), fixedS(0, 8, 7), fixedS(-1.5, 8, 7),
		ZERO16,
		ZERO16,
		u32(PS.PART_INTERP_COLOR | PS.PART_INTERP_SCALE),
		fixedU(3.0, 8, 8),
		Buffer.from([255, 0, 0, 255]),
		Buffer.from([0, 0, 255, 0]),
		fixedU(0.5, 3, 5), fixedU(0.5, 3, 5),
		fixedU(1.0, 3, 5), fixedU(1.0, 3, 5),
	])
}

describe('decodeParticleSystem', () => {
	it('decodes a legacy 86-byte block', () => {
		const blk = legacyBlock()
		expect(blk.length).toBe(86)
		const ps = decodeParticleSystem(blk, 0, blk.length)!
		expect(ps).not.toBeNull()
		expect(ps.pattern).toBe(PS.PATTERN_ANGLE_CONE)
		expect(ps.maxAge).toBeCloseTo(2.0, 2)
		expect(ps.burstRate).toBeCloseTo(0.1, 2)
		expect(ps.burstPartCount).toBe(4)
		expect(ps.partAccel[2]).toBeCloseTo(-1.5, 1)
		expect(ps.texture).toBeNull()
		expect(ps.startColor).toEqual([1, 0, 0, 1])
		expect(ps.endColor).toEqual([0, 0, 1, 0])
		expect(ps.startScale[0]).toBeCloseTo(0.5, 2)
		expect(ps.partFlags & PS.PART_INTERP_COLOR).toBeTruthy()
	})

	it('returns null on empty, oversize, and crc=0', () => {
		expect(decodeParticleSystem(Buffer.alloc(0), 0, 0)).toBeNull()
		expect(decodeParticleSystem(Buffer.alloc(200), 0, 120)).toBeNull()
		const z = legacyBlock(); z.writeUInt32LE(0, 0)
		expect(decodeParticleSystem(z, 0, z.length)).toBeNull()
	})

	it('does not throw on a truncated block', () => {
		const blk = legacyBlock().subarray(0, 40)
		expect(() => decodeParticleSystem(blk, 0, 40)).not.toThrow()
		expect(decodeParticleSystem(blk, 0, 40)).toBeNull()
	})

	it('decodes a new-format block with glow + blend', () => {
		const sys = legacyBlock().subarray(0, 68)
		const part = Buffer.concat([
			u32(PS.PART_DATA_GLOW | PS.PART_DATA_BLEND),
			fixedU(3.0, 8, 8),
			Buffer.from([255, 255, 255, 255]), Buffer.from([255, 255, 255, 0]),
			fixedU(1, 3, 5), fixedU(1, 3, 5), fixedU(1, 3, 5), fixedU(1, 3, 5),
			Buffer.from([128]), Buffer.from([64]),
			Buffer.from([7]), Buffer.from([9]),
		])
		const blk = Buffer.concat([u32(68), sys, u32(part.length), part])
		const ps = decodeParticleSystem(blk, 0, blk.length)!
		expect(ps).not.toBeNull()
		expect(ps.startGlow).toBeCloseTo(128 / 255, 3)
		expect(ps.blendFuncSource).toBe(7)
		expect(ps.blendFuncDest).toBe(9)
	})
})
