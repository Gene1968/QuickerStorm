import { describe, it, expect } from 'bun:test'
import { decodeAnimAsset } from '../../shared/animDecode.js'

// ---- synthetic .anim encoder (mirrors the LLKeyframeMotion binary format) ----

function u16(n: number): Buffer {
	const b = Buffer.alloc(2)
	b.writeUInt16LE(n & 0xffff, 0)
	return b
}
function u32(n: number): Buffer {
	const b = Buffer.alloc(4)
	b.writeUInt32LE(n >>> 0, 0)
	return b
}
function s32(n: number): Buffer {
	const b = Buffer.alloc(4)
	b.writeInt32LE(n | 0, 0)
	return b
}
function f32(n: number): Buffer {
	const b = Buffer.alloc(4)
	b.writeFloatLE(n, 0)
	return b
}
function cstr(s: string): Buffer {
	return Buffer.concat([Buffer.from(s, 'utf-8'), Buffer.from([0])])
}

// F32_to_U16 (llquantize.h), matches the spec's encoder mirror.
function F32_to_U16(val: number, lower: number, upper: number): number {
	const clamped = Math.min(Math.max(val, lower), upper)
	const norm = (clamped - lower) / (upper - lower)
	return Math.floor(norm * 65535)
}
function quantU16(val: number, lower: number, upper: number): Buffer {
	return u16(F32_to_U16(val, lower, upper))
}

interface RotKeySpec {
	time: number
	x: number
	y: number
	z: number
}
interface PosKeySpec {
	time: number
	x: number
	y: number
	z: number
}
interface JointSpec {
	name: string
	priority: number
	rotKeys: RotKeySpec[]
	posKeys: PosKeySpec[]
}

interface HeaderSpec {
	basePriority?: number
	duration?: number
	emoteName?: string
	loopIn?: number
	loopOut?: number
	loop?: number
	easeIn?: number
	easeOut?: number
	handPose?: number
}

function encodeCurrentAnim(header: HeaderSpec, joints: JointSpec[], numConstraints = 0): Buffer {
	const duration = header.duration ?? 2.0
	const parts: Buffer[] = []
	parts.push(u16(1), u16(0)) // version, sub_version
	parts.push(s32(header.basePriority ?? 3))
	parts.push(f32(duration))
	parts.push(cstr(header.emoteName ?? ''))
	parts.push(f32(header.loopIn ?? 0))
	parts.push(f32(header.loopOut ?? duration))
	parts.push(s32(header.loop ?? 1))
	parts.push(f32(header.easeIn ?? 0.1))
	parts.push(f32(header.easeOut ?? 0.1))
	parts.push(u32(header.handPose ?? 0))
	parts.push(u32(joints.length))

	for (const j of joints) {
		parts.push(cstr(j.name))
		parts.push(s32(j.priority))
		parts.push(s32(j.rotKeys.length))
		for (const k of j.rotKeys) {
			parts.push(quantU16(k.time, 0, duration))
			parts.push(quantU16(k.x, -1, 1))
			parts.push(quantU16(k.y, -1, 1))
			parts.push(quantU16(k.z, -1, 1))
		}
		parts.push(s32(j.posKeys.length))
		for (const k of j.posKeys) {
			parts.push(quantU16(k.time, 0, duration))
			parts.push(quantU16(k.x, -5, 5))
			parts.push(quantU16(k.y, -5, 5))
			parts.push(quantU16(k.z, -5, 5))
		}
	}

	parts.push(s32(numConstraints))
	for (let i = 0; i < numConstraints; i++) {
		parts.push(Buffer.alloc(86)) // zero-ish constraint payload; we only skip these
	}

	return Buffer.concat(parts)
}

function encodeLegacyAnim(header: HeaderSpec, joints: JointSpec[]): Buffer {
	const duration = header.duration ?? 2.0
	const parts: Buffer[] = []
	parts.push(u16(0), u16(1)) // version, sub_version = legacy
	parts.push(s32(header.basePriority ?? 3))
	parts.push(f32(duration))
	parts.push(cstr(header.emoteName ?? ''))
	parts.push(f32(header.loopIn ?? 0))
	parts.push(f32(header.loopOut ?? duration))
	parts.push(s32(header.loop ?? 0))
	parts.push(f32(header.easeIn ?? 0.1))
	parts.push(f32(header.easeOut ?? 0.1))
	parts.push(u32(header.handPose ?? 0))
	parts.push(u32(joints.length))

	for (const j of joints) {
		parts.push(cstr(j.name))
		parts.push(s32(j.priority))
		parts.push(s32(j.rotKeys.length))
		for (const k of j.rotKeys) {
			// legacy rotation keys: F32 time + 3xF32 euler degrees (ZYX order)
			parts.push(f32(k.time), f32(k.x), f32(k.y), f32(k.z))
		}
		parts.push(s32(j.posKeys.length))
		for (const k of j.posKeys) {
			parts.push(f32(k.time), f32(k.x), f32(k.y), f32(k.z))
		}
	}

	parts.push(s32(0)) // num_constraints
	return Buffer.concat(parts)
}

function toU8(b: Buffer): Uint8Array {
	return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

describe('decodeAnimAsset — round trip (current quantized format)', () => {
	it('decodes a 2-joint anim with header fields, key counts, and dequantized values', () => {
		const duration = 2.0
		const buf = encodeCurrentAnim(
			{ basePriority: 3, duration, emoteName: '', loopIn: 0, loopOut: duration, loop: 1, easeIn: 0.25, easeOut: 0.25, handPose: 0 },
			[
				{
					name: 'mPelvis',
					priority: 4,
					rotKeys: [
						{ time: 0, x: 0, y: 0, z: 0 },
						{ time: 1, x: 0.3, y: -0.2, z: 0.1 },
					],
					posKeys: [
						{ time: 0, x: 0, y: 0, z: 0 },
						{ time: 1, x: 1.25, y: -3.5, z: 4.9 },
					],
				},
				{
					name: 'mChest',
					priority: 4,
					rotKeys: [{ time: 0.5, x: 0.1, y: 0.1, z: 0.1 }],
					posKeys: [],
				},
			],
		)

		const anim = decodeAnimAsset(toU8(buf))

		expect(anim.version).toBe(1)
		expect(anim.subVersion).toBe(0)
		expect(anim.basePriority).toBe(3)
		expect(anim.duration).toBeCloseTo(duration, 5)
		expect(anim.emoteName).toBe('')
		expect(anim.loopIn).toBeCloseTo(0, 5)
		expect(anim.loopOut).toBeCloseTo(duration, 5)
		expect(anim.loop).toBe(true)
		expect(anim.easeIn).toBeCloseTo(0.25, 5)
		expect(anim.easeOut).toBeCloseTo(0.25, 5)
		expect(anim.handPose).toBe(0)

		expect(anim.joints.length).toBe(2)
		const pelvis = anim.joints[0]
		expect(pelvis.name).toBe('mPelvis')
		expect(pelvis.priority).toBe(4)
		expect(pelvis.rotKeys.length).toBe(2)
		expect(pelvis.posKeys.length).toBe(2)

		// second rotation key: time=1, x=0.3, y=-0.2, z=0.1 (quantized to [-1,1], error bound ~3e-5)
		const [rt, rx, ry, rz] = pelvis.rotKeys[1]
		expect(rt).toBeCloseTo(1, 3)
		expect(rx).toBeCloseTo(0.3, 3)
		expect(ry).toBeCloseTo(-0.2, 3)
		expect(rz).toBeCloseTo(0.1, 3)

		// second position key: time=1, x=1.25, y=-3.5, z=4.9 (quantized to [-5,5], error bound ~1.6e-4)
		const [pt, px, py, pz] = pelvis.posKeys[1]
		expect(pt).toBeCloseTo(1, 3)
		expect(px).toBeCloseTo(1.25, 3)
		expect(py).toBeCloseTo(-3.5, 3)
		expect(pz).toBeCloseTo(4.9, 3)

		const chest = anim.joints[1]
		expect(chest.name).toBe('mChest')
		expect(chest.rotKeys.length).toBe(1)
		expect(chest.posKeys.length).toBe(0)
	})

	it('reconstructs quaternion w for a known 90-degree Z rotation', () => {
		// x=0, y=0, z=sin(45deg)=0.7071, w should reconstruct to ~0.7071
		const buf = encodeCurrentAnim({ duration: 1 }, [
			{
				name: 'mChest',
				priority: 4,
				rotKeys: [{ time: 0, x: 0, y: 0, z: 0.7071067812 }],
				posKeys: [],
			},
		])
		const anim = decodeAnimAsset(toU8(buf))
		const [, qx, qy, qz, qw] = anim.joints[0].rotKeys[0]
		expect(qx).toBeCloseTo(0, 3)
		expect(qy).toBeCloseTo(0, 3)
		expect(qz).toBeCloseTo(0.7071, 3)
		expect(qw).toBeCloseTo(0.7071, 3)
	})

	it('snaps a midpoint-quantized value to exactly 0', () => {
		// midpoint of [-1,1] quantizes to ival=32767 or 32768 depending on rounding;
		// use the exact value that F32_to_U16 maps to the midpoint index and confirm
		// u16ToF32 snaps it to 0 via the max-error check.
		const buf = encodeCurrentAnim({ duration: 1 }, [
			{
				name: 'mChest',
				priority: 4,
				rotKeys: [{ time: 0, x: 0, y: 0, z: 0 }],
				posKeys: [{ time: 0, x: 0, y: 0, z: 0 }],
			},
		])
		const anim = decodeAnimAsset(toU8(buf))
		const [, qx, qy, qz] = anim.joints[0].rotKeys[0]
		expect(qx).toBe(0)
		expect(qy).toBe(0)
		expect(qz).toBe(0)
		const [, px, py, pz] = anim.joints[0].posKeys[0]
		expect(px).toBe(0)
		expect(py).toBe(0)
		expect(pz).toBe(0)
	})
})

describe('decodeAnimAsset — constraints', () => {
	it('skips constraint bytes and still decodes successfully', () => {
		const buf = encodeCurrentAnim(
			{ duration: 1 },
			[{ name: 'mPelvis', priority: 4, rotKeys: [{ time: 0, x: 0, y: 0, z: 0 }], posKeys: [] }],
			2,
		)
		const anim = decodeAnimAsset(toU8(buf))
		expect(anim.joints.length).toBe(1)
	})
})

describe('decodeAnimAsset — rejects malformed input', () => {
	it('throws on bad version', () => {
		const buf = Buffer.concat([u16(2), u16(0), s32(0), f32(1), cstr(''), f32(0), f32(1), s32(0), f32(0), f32(0), u32(0), u32(1)])
		expect(() => decodeAnimAsset(toU8(buf))).toThrow()
	})

	it('throws on num_joints == 0', () => {
		const buf = encodeCurrentAnim({ duration: 1 }, [])
		expect(() => decodeAnimAsset(toU8(buf))).toThrow()
	})

	it("throws on joint name 'mRoot'", () => {
		const buf = encodeCurrentAnim({ duration: 1 }, [{ name: 'mRoot', priority: 4, rotKeys: [], posKeys: [] }])
		expect(() => decodeAnimAsset(toU8(buf))).toThrow()
	})

	it('throws on a truncated buffer mid-keys', () => {
		const full = encodeCurrentAnim({ duration: 1 }, [
			{
				name: 'mPelvis',
				priority: 4,
				rotKeys: [
					{ time: 0, x: 0, y: 0, z: 0 },
					{ time: 1, x: 0.1, y: 0.1, z: 0.1 },
				],
				posKeys: [],
			},
		])
		const truncated = full.subarray(0, full.length - 10)
		expect(() => decodeAnimAsset(toU8(truncated))).toThrow()
	})

	it('throws on non-finite duration', () => {
		const parts: Buffer[] = [u16(1), u16(0), s32(0), f32(Infinity), cstr(''), f32(0), f32(1), s32(0), f32(0), f32(0), u32(0), u32(1)]
		const buf = Buffer.concat(parts)
		expect(() => decodeAnimAsset(toU8(buf))).toThrow()
	})
})

describe('decodeAnimAsset — legacy (0,1) float format', () => {
	it('decodes a single F32 rot/pos key without throwing, producing a unit quaternion', () => {
		const buf = encodeLegacyAnim({ duration: 1 }, [
			{
				name: 'mChest',
				priority: 4,
				rotKeys: [{ time: 0.5, x: 10, y: 20, z: 30 }], // degrees, ZYX order
				posKeys: [{ time: 0.5, x: 1.5, y: -2.5, z: 3.5 }],
			},
		])
		const anim = decodeAnimAsset(toU8(buf))
		expect(anim.version).toBe(0)
		expect(anim.subVersion).toBe(1)
		expect(anim.joints.length).toBe(1)

		const joint = anim.joints[0]
		expect(joint.rotKeys.length).toBe(1)
		expect(joint.posKeys.length).toBe(1)

		const [rt, qx, qy, qz, qw] = joint.rotKeys[0]
		expect(rt).toBeCloseTo(0.5, 5)
		const mag = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
		expect(mag).toBeCloseTo(1, 3)

		const [pt, px, py, pz] = joint.posKeys[0]
		expect(pt).toBeCloseTo(0.5, 5)
		expect(px).toBeCloseTo(1.5, 5)
		expect(py).toBeCloseTo(-2.5, 5)
		expect(pz).toBeCloseTo(3.5, 5)
	})
})
