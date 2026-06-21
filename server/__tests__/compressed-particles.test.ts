import { describe, it, expect } from 'bun:test'
import { decodeObjectUpdateCompressed } from '../lib/lludp-codec'
import { PS } from '../lib/particleCodec'

// Synthetic ObjectUpdateCompressed packets that exercise the particle-flag path
// (CompressedFlags 0x08 HasParticlesLegacy / 0x400 HasParticlesNew). Bytes are laid out per
// OpenSim LLClientView.CreateCompressedUpdateBlockZC. The point: a particle-flagged prim must now
// decode its psys AND still decode the TextureEntry that follows (the legacy block sits BEFORE the
// TE, so a wrong-size consume would shift/garble it → the old pastel-plane bug).

function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff, 0); return b }
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }
function f32(n: number) { const b = Buffer.alloc(4); b.writeFloatLE(n, 0); return b }
function fixedU(value: number, intBits: number, fracBits: number): Buffer {
	const total = intBits + fracBits
	const raw = Math.round(value * (1 << fracBits))
	if (total <= 8) return Buffer.from([raw & 0xff])
	const b = Buffer.alloc(2); b.writeUInt16LE(raw & 0xffff, 0); return b
}
function fixedS(value: number, intBits: number, fracBits: number): Buffer {
	const raw = Math.round((value + (1 << intBits)) * (1 << fracBits))
	if (intBits + fracBits + 1 <= 8) return Buffer.from([raw & 0xff])
	const b = Buffer.alloc(2); b.writeUInt16LE(raw & 0xffff, 0); return b
}
const ZERO16 = Buffer.alloc(16)

// 86-byte legacy particle system (mirrors particleCodec.test.ts legacyBlock()).
function legacyPS(): Buffer {
	const blk = Buffer.concat([
		u32(0x12345678), u32(0), Buffer.from([PS.PATTERN_ANGLE_CONE]),
		fixedU(2.0, 8, 8), fixedU(0.0, 8, 8), fixedU(0.5, 3, 5), fixedU(1.5, 3, 5),
		fixedU(0.1, 8, 8), fixedU(0.0, 8, 8), fixedU(1.0, 8, 8), fixedU(2.0, 8, 8),
		Buffer.from([4]),
		fixedS(0, 8, 7), fixedS(0, 8, 7), fixedS(0, 8, 7),
		fixedS(0, 8, 7), fixedS(0, 8, 7), fixedS(-1.5, 8, 7),
		ZERO16, ZERO16,
		u32(PS.PART_INTERP_COLOR | PS.PART_INTERP_SCALE),
		fixedU(3.0, 8, 8),
		Buffer.from([255, 0, 0, 255]), Buffer.from([0, 0, 255, 0]),
		fixedU(0.5, 3, 5), fixedU(0.5, 3, 5), fixedU(1.0, 3, 5), fixedU(1.0, 3, 5),
	])
	if (blk.length !== 86) throw new Error(`legacyPS built ${blk.length}, expected 86`)
	return blk
}

// New-format particle system (>86, self-describing) with glow + blend (mirrors particleCodec.test).
function newPS(): Buffer {
	const sys = legacyPS().subarray(0, 68)
	const part = Buffer.concat([
		u32(PS.PART_DATA_GLOW | PS.PART_DATA_BLEND), fixedU(3.0, 8, 8),
		Buffer.from([255, 255, 255, 255]), Buffer.from([255, 255, 255, 0]),
		fixedU(1, 3, 5), fixedU(1, 3, 5), fixedU(1, 3, 5), fixedU(1, 3, 5),
		Buffer.from([128]), Buffer.from([64]), Buffer.from([7]), Buffer.from([9]),
	])
	return Buffer.concat([u32(68), sys, u32(part.length), part])
}

const TEX_UUID = '11111111-1111-1111-1111-111111111111'

// Minimal TextureEntry: each field = default value + single 0x00 override-terminator.
function buildTE(): Buffer {
	const tex = Buffer.from(TEX_UUID.replace(/-/g, ''), 'hex')   // 16B
	const term = Buffer.from([0])
	return Buffer.concat([
		tex, term,                                  // defaultTexture
		Buffer.from([0, 0, 0, 0]), term,            // color (inverted → white)
		f32(1), term, f32(1), term,                 // scaleS / scaleT
		u16(0), term, u16(0), term,                 // offsetS / offsetT
		u16(0), term,                               // rotation
		Buffer.from([0]), term,                     // bump
		Buffer.from([0]), term,                     // media
		Buffer.from([0]), term,                     // glow
	])
}

const SHAPE23 = (() => { const b = Buffer.alloc(23); b[0] = 16; b[16] = 1; return b })()  // pathCurve, profileCurve

// One compressed object data block (the Variable2 payload), per the ZC encoder field order.
function buildObjData(localId: number, cflags: number): Buffer {
	const te = buildTE()
	const parts: Buffer[] = [
		ZERO16,                       // fullId
		u32(localId),
		Buffer.from([9]),             // pcode = prim
		Buffer.from([0]),             // state
		u32(99999),                   // PseudoCRC
		Buffer.from([0]),             // material
		Buffer.from([0]),             // clickAction
		f32(1), f32(1), f32(0.1),     // scale
		f32(128), f32(128), f32(25),  // pos
		f32(0), f32(0), f32(0),       // rot (rw derived)
		u32(cflags),
		ZERO16,                       // OwnerID
	]
	if (cflags & 0x08) parts.push(legacyPS())   // legacy PS sits BEFORE ExtraParams
	parts.push(Buffer.from([0]))                // ExtraParams count = 0
	parts.push(SHAPE23)
	parts.push(u32(te.length), te)              // TextureEntry (U32 length prefix)
	if (cflags & 0x400) parts.push(newPS())     // new PS is the LAST field
	return Buffer.concat(parts)
}

function buildPacket(...objs: Buffer[]): Buffer {
	const frames = objs.map(d => Buffer.concat([u32(0), u16(d.length), d]))  // UpdateFlags + Variable2
	return Buffer.concat([Buffer.alloc(8), u16(0), Buffer.from([objs.length]), ...frames])  // RegionHandle + TimeDilation + count
}

describe('decodeObjectUpdateCompressed — particle prims (0x08 legacy / 0x400 new)', () => {
	it('decodes a legacy particle system AND keeps the TextureEntry aligned', () => {
		const o = decodeObjectUpdateCompressed(buildPacket(buildObjData(955628718, 0x08)), 0)[0]
		expect(o.localId).toBe(955628718)
		// psys decoded (was undefined → no emitter → no particles before the fix)
		expect(o.psys).toBeDefined()
		expect(o.psys!.pattern).toBe(PS.PATTERN_ANGLE_CONE)
		expect(o.psys!.burstPartCount).toBe(4)
		// DESYNC GUARD: TE that follows the 86-byte legacy block must still decode correctly.
		expect(o.defaultTexture).toBe(TEX_UUID)
		expect(o.shape).toBeDefined()
		expect(o.shape!.pathCurve).toBe(16)
	})

	it('decodes a new-format particle system (after TE) without disturbing the TE', () => {
		const o = decodeObjectUpdateCompressed(buildPacket(buildObjData(955628792, 0x400)), 0)[0]
		expect(o.localId).toBe(955628792)
		expect(o.psys).toBeDefined()
		expect(o.psys!.blendFuncSource).toBe(7)
		expect(o.psys!.blendFuncDest).toBe(9)
		expect(o.psys!.startGlow).toBeCloseTo(128 / 255, 3)
		expect(o.defaultTexture).toBe(TEX_UUID)   // TE precedes new PS — must be intact
	})

	it('does not desync a following object in the same packet', () => {
		const objs = decodeObjectUpdateCompressed(
			buildPacket(buildObjData(955628718, 0x08), buildObjData(424242, 0x00)), 0)
		expect(objs).toHaveLength(2)
		expect(objs[0].localId).toBe(955628718)
		expect(objs[0].psys).toBeDefined()
		// The second (plain) prim must decode fully — no carry-over from the particle block.
		expect(objs[1].localId).toBe(424242)
		expect(objs[1].psys).toBeUndefined()
		expect(objs[1].defaultTexture).toBe(TEX_UUID)
	})
})
