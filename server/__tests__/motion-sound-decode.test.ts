// server/__tests__/motion-sound-decode.test.ts — wire tests for the 🎬 motion (E+F decode side)
// and 🔊 sound (S-1/S-2/S-3) server layer.
//
// Format authorities (all asserted layouts are ports, not hand-derived):
// - Terse Vel/Acc/Rot/AngVel U16 dequant ranges: FS llviewerobject.cpp:1752-1780
//   (OUT_TERSE_IMPROVED: Vel ±128, Acc ±64, Theta ±1, AngVel ±64) built with
//   llquantize.h:72 U16_to_F32; OpenSim packer LLClientView.cs:6743 CreateImprovedTerseBlock
//   (prim Data=44B :6797, avatar=60B :6778).
// - Compressed Omega = 3×F32 (FS llviewerobject.cpp:1825), compressed Sound =
//   UUID16+Gain4+Flags1+Radius4 (FS llviewerobject.cpp:1949-1952).
// - Full ObjectUpdate ObjectData 60/76B blob: pos|vel|acc|theta|omega ×12B F32
//   (FS llviewerobject.cpp:1395-1430); Sound tail per message_template.msg:3340-3344.
// - Sound messages: message_template.msg SoundTrigger:7357, AttachedSound:7372,
//   AttachedSoundGainChange:7385.
import { describe, it, expect } from 'bun:test'
import {
	decodeImprovedTerseObjectUpdate, decodeObjectUpdate, decodeObjectUpdateCompressed,
	mapSoundTrigger, mapAttachedSound, mapAttachedSoundGainChange, u16ToF32,
} from '../lib/lludp-codec'
import { encode, decode } from '../lib/protocol/codec'
import { buildHeader, uuidToBytes } from '../lib/protocol/wire'

// OpenSim-side quantizer (libomv Utils.FloatToUInt16) — inverse of U16_to_F32.
const f32ToU16 = (v: number, lower: number, upper: number): number =>
	Math.round(((v - lower) / (upper - lower)) * 65535)

const SOUND_ID  = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0001'
const OWNER_ID  = '11111111-2222-3333-4444-555566667777'
const OBJECT_ID = '99999999-8888-7777-6666-555544443333'
const PARENT_ID = '0f0f0f0f-1e1e-2d2d-3c3c-4b4b5a5a6969'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

// ── ImprovedTerseObjectUpdate: Vel + AngVel dequant ──────────────────────────

/** Build a terse packet body (starting at dataOffset=0): RegionHandle+TimeDilation+count+objects. */
function buildTerseBody(objs: Array<{
	localId: number, avatar?: boolean,
	pos: [number, number, number],
	vel: [number, number, number], acc?: [number, number, number],
	rot?: [number, number, number, number],
	angVel: [number, number, number],
}>): Buffer {
	const parts: Buffer[] = []
	const head = Buffer.alloc(11)
	head.writeBigUInt64LE(0n, 0)       // RegionHandle
	head.writeUInt16LE(65535, 8)       // TimeDilation
	head.writeUInt8(objs.length, 10)   // ObjectData count
	parts.push(head)
	for (const o of objs) {
		// Prim Data = 44B, avatar = 60B — OpenSim LLClientView.cs:6797/:6778
		const dataLen = o.avatar ? 60 : 44
		const d = Buffer.alloc(1 + dataLen + 2)   // len prefix + data + empty TE (U16 len 0)
		let p = 0
		d.writeUInt8(dataLen, p); p += 1
		d.writeUInt32LE(o.localId, p); p += 4
		d.writeUInt8(0, p); p += 1                          // State
		d.writeUInt8(o.avatar ? 1 : 0, p); p += 1           // Agent flag
		if (o.avatar) p += 16                               // CollisionPlane
		for (const v of o.pos) { d.writeFloatLE(v, p); p += 4 }
		for (const v of o.vel) { d.writeUInt16LE(f32ToU16(v, -128, 128), p); p += 2 }
		for (const v of o.acc ?? [0, 0, 0]) { d.writeUInt16LE(f32ToU16(v, -64, 64), p); p += 2 }
		for (const v of o.rot ?? [0, 0, 0, 1]) { d.writeUInt16LE(f32ToU16(v, -1, 1), p); p += 2 }
		for (const v of o.angVel) { d.writeUInt16LE(f32ToU16(v, -64, 64), p); p += 2 }
		d.writeUInt16LE(0, p)                               // TextureEntry (Variable2) empty
		parts.push(d)
	}
	return Buffer.concat(parts)
}

describe('decodeImprovedTerseObjectUpdate — Vel/AngVel dequant (44B prim / 60B avatar)', () => {
	it('round-trips prim vel + angVel through the U16 quantizer within one quantum', () => {
		const body = buildTerseBody([{
			localId: 4242,
			pos: [128.5, 64.25, 21.5],
			vel: [10, -5, 0.5],
			rot: [0, 0, 0.7071, 0.7071],
			angVel: [1.57, 0, -3.14],
		}])
		const [o] = decodeImprovedTerseObjectUpdate(body, 0)
		expect(o.localId).toBe(4242)
		expect(o.pos[0]).toBeCloseTo(128.5, 4)
		// Vel quantum = 256/65535 ≈ 0.0039; AngVel quantum = 128/65535 ≈ 0.002
		expect(o.vel).toBeDefined()
		expect(o.vel![0]).toBeCloseTo(10, 2)
		expect(o.vel![1]).toBeCloseTo(-5, 2)
		expect(o.vel![2]).toBeCloseTo(0.5, 2)
		expect(o.angVel).toBeDefined()
		expect(o.angVel![0]).toBeCloseTo(1.57, 2)
		expect(o.angVel![1]).toBe(0)   // exact-zero snap (llquantize.h:72 zero band)
		expect(o.angVel![2]).toBeCloseTo(-3.14, 2)
		expect(o.rot![2]).toBeCloseTo(0.7071, 3)
	})

	it('zero-suppresses: at-rest object carries neither vel nor angVel', () => {
		const body = buildTerseBody([{
			localId: 7, pos: [1, 2, 3], vel: [0, 0, 0], angVel: [0, 0, 0],
		}])
		const [o] = decodeImprovedTerseObjectUpdate(body, 0)
		expect(o.vel).toBeUndefined()
		expect(o.angVel).toBeUndefined()
	})

	it('decodes the avatar (60B, CollisionPlane offset) layout too', () => {
		const body = buildTerseBody([{
			localId: 9, avatar: true, pos: [10, 20, 30], vel: [-2.5, 0, 1.25], angVel: [0, 0.5, 0],
		}])
		const [o] = decodeImprovedTerseObjectUpdate(body, 0)
		expect(o.pos[2]).toBeCloseTo(30, 4)
		expect(o.vel![0]).toBeCloseTo(-2.5, 2)
		expect(o.vel![2]).toBeCloseTo(1.25, 2)
		expect(o.angVel![1]).toBeCloseTo(0.5, 2)
	})

	it('u16ToF32 golden values match FS llquantize.h semantics', () => {
		expect(u16ToF32(0, -128, 128)).toBe(-128)
		expect(u16ToF32(65535, -128, 128)).toBe(128)
		// Midpoint lands inside the zero band → snapped to exactly 0
		expect(u16ToF32(32768, -64, 64)).toBe(0)
		expect(u16ToF32(32767, -64, 64)).toBe(0)
	})
})

// ── Full ObjectUpdate: vel/angVel from the 60B blob + Sound tail ─────────────

/** Hand-build one full-ObjectUpdate body (dataOffset=0) with a 60B prim ObjectData blob. */
function buildFullBody(opts: {
	localId: number,
	vel: [number, number, number], angVel: [number, number, number],
	sound?: { id: string, gain: number, flags: number, radius: number },
}): Buffer {
	const b = Buffer.alloc(512); let p = 0
	b.writeBigUInt64LE(0n, p); p += 8          // RegionHandle
	b.writeUInt16LE(65535, p); p += 2          // TimeDilation
	b.writeUInt8(1, p); p += 1                 // count
	b.writeUInt32LE(opts.localId, p); p += 4   // ID
	b.writeUInt8(0, p); p += 1                 // State
	uuidToBytes(OBJECT_ID).copy(b, p); p += 16 // FullID
	b.writeUInt32LE(123, p); p += 4            // CRC
	b.writeUInt8(9, p); p += 1                 // PCode = prim
	b.writeUInt8(3, p); p += 1                 // Material
	b.writeUInt8(0, p); p += 1                 // ClickAction
	for (const v of [1, 1, 1]) { b.writeFloatLE(v, p); p += 4 }   // Scale
	// ObjectData blob — 60B: Pos|Vel|Acc|Rot|AngVel ×12B F32 (FS llviewerobject.cpp:1395-1430)
	b.writeUInt8(60, p); p += 1
	for (const v of [100, 100, 25]) { b.writeFloatLE(v, p); p += 4 }        // Pos
	for (const v of opts.vel)       { b.writeFloatLE(v, p); p += 4 }        // Vel
	for (const v of [0, 0, 0])      { b.writeFloatLE(v, p); p += 4 }        // Acc
	for (const v of [0, 0, 0])      { b.writeFloatLE(v, p); p += 4 }        // Rot xyz (w derived)
	for (const v of opts.angVel)    { b.writeFloatLE(v, p); p += 4 }        // AngVel
	b.writeUInt32LE(0, p); p += 4              // ParentID
	b.writeUInt32LE(0, p); p += 4              // UpdateFlags
	p += 23                                    // Path/Profile block (zeros = fine)
	b.writeUInt16LE(0, p); p += 2              // TextureEntry (Var2) empty
	b.writeUInt8(0, p); p += 1                 // TextureAnim (Var1) empty
	b.writeUInt16LE(0, p); p += 2              // NameValue (Var2) empty
	b.writeUInt16LE(0, p); p += 2              // Data (Var2) empty
	b.writeUInt8(0, p); p += 1                 // Text (Var1) empty
	p += 4                                     // TextColor Fixed4
	b.writeUInt8(0, p); p += 1                 // MediaURL (Var1) empty
	b.writeUInt8(0, p); p += 1                 // PSBlock (Var1) empty
	b.writeUInt8(0, p); p += 1                 // ExtraParams (Var1) empty
	// Sound tail — message_template.msg:3340-3344
	uuidToBytes(opts.sound?.id ?? ZERO_UUID).copy(b, p); p += 16   // Sound
	uuidToBytes(OWNER_ID).copy(b, p); p += 16                       // OwnerID
	b.writeFloatLE(opts.sound?.gain ?? 0, p); p += 4                // Gain
	b.writeUInt8(opts.sound?.flags ?? 0, p); p += 1                 // Flags
	b.writeFloatLE(opts.sound?.radius ?? 0, p); p += 4              // Radius
	b.writeUInt8(0, p); p += 1                 // JointType
	p += 12                                    // JointPivot
	p += 12                                    // JointAxisOrAnchor
	return b.slice(0, p)
}

describe('decodeObjectUpdate — vel/angVel from ObjectData blob + sound tail (S-3)', () => {
	it('extracts vel + angVel from the 60B prim blob', () => {
		const body = buildFullBody({ localId: 1001, vel: [3.5, -1.25, 0], angVel: [0, 0, 6.28] })
		const [o] = decodeObjectUpdate(body, 0)
		expect(o.localId).toBe(1001)
		expect(o.vel).toEqual([3.5, -1.25, 0])
		expect(o.angVel).toEqual([0, 0, expect.closeTo(6.28, 5) as unknown as number])
		expect(o.sound).toBeUndefined()   // null sound UUID → omitted
	})

	it('zero-suppresses vel/angVel and extracts the sound tail', () => {
		const body = buildFullBody({
			localId: 1002, vel: [0, 0, 0], angVel: [0, 0, 0],
			sound: { id: SOUND_ID, gain: 0.8, flags: 1, radius: 20 },
		})
		const [o] = decodeObjectUpdate(body, 0)
		expect(o.vel).toBeUndefined()
		expect(o.angVel).toBeUndefined()
		expect(o.sound).toBeDefined()
		expect(o.sound!.id).toBe(SOUND_ID)
		expect(o.sound!.gain).toBeCloseTo(0.8, 5)
		expect(o.sound!.flags).toBe(1)
		expect(o.sound!.radius).toBeCloseTo(20, 5)
	})

	it('emits the id:null STOP marker for Sound=Zero + STOP flag (llStopSound — SoundModule.cs:269-276)', () => {
		const body = buildFullBody({
			localId: 1003, vel: [0, 0, 0], angVel: [0, 0, 0],
			sound: { id: ZERO_UUID, gain: 0, flags: 0x20, radius: 0 },   // SOUND_FLAG_STOP
		})
		const [o] = decodeObjectUpdate(body, 0)
		expect(o.sound).toBeDefined()
		expect(o.sound!.id).toBeNull()
		expect(o.sound!.flags).toBe(0x20)
	})

	it('still omits sound entirely for an ordinary soundless prim (Zero UUID, zero flags+gain)', () => {
		const body = buildFullBody({ localId: 1004, vel: [0, 0, 0], angVel: [0, 0, 0] })
		const [o] = decodeObjectUpdate(body, 0)
		expect(o.sound).toBeUndefined()
	})
})

// ── ObjectUpdateCompressed: AngularVelocity (0x80) + Sound (0x10) ────────────

/** Hand-build one compressed-ObjectUpdate body (dataOffset=0). */
function buildCompressedBody(opts: {
	localId: number,
	angVel?: [number, number, number],
	sound?: { id: string, gain: number, flags: number, radius: number },
}): Buffer {
	// Inner Data payload (the Variable2 blob) — layout per CreateCompressedUpdateBlockZC
	const d = Buffer.alloc(256); let p = 0
	uuidToBytes(OBJECT_ID).copy(d, p); p += 16       // FullID
	d.writeUInt32LE(opts.localId, p); p += 4         // LocalID
	d.writeUInt8(9, p); p += 1                       // PCode = prim
	d.writeUInt8(0, p); p += 1                       // State
	d.writeUInt32LE(77, p); p += 4                   // CRC
	d.writeUInt8(3, p); p += 1                       // Material
	d.writeUInt8(0, p); p += 1                       // ClickAction
	for (const v of [1, 1, 1])       { d.writeFloatLE(v, p); p += 4 }   // Scale
	for (const v of [50, 60, 22])    { d.writeFloatLE(v, p); p += 4 }   // Pos
	for (const v of [0, 0, 0])       { d.writeFloatLE(v, p); p += 4 }   // Rot xyz
	const cflags = (opts.angVel ? 0x80 : 0) | (opts.sound ? 0x10 : 0)
	d.writeUInt32LE(cflags, p); p += 4               // CompressedFlags
	uuidToBytes(OWNER_ID).copy(d, p); p += 16        // OwnerID (always present)
	if (opts.angVel) {
		// Omega: 3×F32 — FS llviewerobject.cpp:1825
		for (const v of opts.angVel) { d.writeFloatLE(v, p); p += 4 }
	}
	// no ParentID (0x20 unset), no Text/MediaURL/particles
	d.writeUInt8(0, p); p += 1                       // ExtraParams count = 0
	if (opts.sound) {
		// UUID16 + Gain F32 + Flags U8 + Radius F32 — FS llviewerobject.cpp:1949-1952
		uuidToBytes(opts.sound.id).copy(d, p); p += 16
		d.writeFloatLE(opts.sound.gain, p); p += 4
		d.writeUInt8(opts.sound.flags, p); p += 1
		d.writeFloatLE(opts.sound.radius, p); p += 4
	}
	p += 23                                          // shape block (zeros)
	d.writeUInt32LE(0, p); p += 4                    // TextureEntry U32 len = 0
	const data = d.slice(0, p)

	const b = Buffer.alloc(11 + 6 + data.length); let q = 0
	b.writeBigUInt64LE(0n, q); q += 8                // RegionHandle
	b.writeUInt16LE(65535, q); q += 2                // TimeDilation
	b.writeUInt8(1, q); q += 1                       // count
	b.writeUInt32LE(0, q); q += 4                    // UpdateFlags (cUpdateFlags)
	b.writeUInt16LE(data.length, q); q += 2          // Data Variable2 length
	data.copy(b, q)
	return b
}

describe('decodeObjectUpdateCompressed — AngularVelocity (0x80) + Sound (0x10)', () => {
	it('decodes Omega as 3×F32 into angVel', () => {
		const body = buildCompressedBody({ localId: 2001, angVel: [0.5, 0, -0.25] })
		const [o] = decodeObjectUpdateCompressed(body, 0)
		expect(o.localId).toBe(2001)
		expect(o.angVel).toBeDefined()
		expect(o.angVel![0]).toBeCloseTo(0.5, 5)
		expect(o.angVel![2]).toBeCloseTo(-0.25, 5)
		expect(o.sound).toBeUndefined()
	})

	it('decodes the 25B sound block and keeps downstream fields aligned', () => {
		const body = buildCompressedBody({
			localId: 2002,
			angVel: [0, 0, 1],
			sound: { id: SOUND_ID, gain: 0.6, flags: 0x01, radius: 15 },
		})
		const [o] = decodeObjectUpdateCompressed(body, 0)
		expect(o.sound).toBeDefined()
		expect(o.sound!.id).toBe(SOUND_ID)
		expect(o.sound!.gain).toBeCloseTo(0.6, 5)
		expect(o.sound!.flags).toBe(1)
		expect(o.sound!.radius).toBeCloseTo(15, 5)
		expect(o.angVel![2]).toBeCloseTo(1, 5)
		// shape decoded AFTER the sound block — alignment proof
		expect(o.shape).toBeDefined()
		expect(o.pos[0]).toBeCloseTo(50, 4)
	})

	it('emits the id:null STOP marker for a Zero-UUID sound block with STOP flag', () => {
		const body = buildCompressedBody({
			localId: 2004,
			sound: { id: ZERO_UUID, gain: 0, flags: 0x20, radius: 0 },
		})
		const [o] = decodeObjectUpdateCompressed(body, 0)
		expect(o.sound).toBeDefined()
		expect(o.sound!.id).toBeNull()
		expect(o.sound!.flags).toBe(0x20)
		// downstream alignment intact
		expect(o.shape).toBeDefined()
		expect(o.pos[0]).toBeCloseTo(50, 4)
	})

	it('zero-suppresses angVel when Omega is sent but zero', () => {
		const body = buildCompressedBody({ localId: 2003, angVel: [0, 0, 0] })
		const [o] = decodeObjectUpdateCompressed(body, 0)
		expect(o.angVel).toBeUndefined()
	})
})

// ── Sound messages (generic template codec + payload mappers) ────────────────

describe('SoundTrigger (High 29) — golden bytes + encode/decode round-trip', () => {
	// Hand-built per message_template.msg:7357-7370: SoundID|OwnerID|ObjectID|ParentID
	// UUIDs, Handle U64, Position LLVector3, Gain F32 — single SoundData block.
	function goldenSoundTrigger(): Buffer {
		const body = Buffer.alloc(1 + 88); let p = 0
		body.writeUInt8(29, p); p += 1                 // High-frequency id byte
		uuidToBytes(SOUND_ID).copy(body, p); p += 16
		uuidToBytes(OWNER_ID).copy(body, p); p += 16
		uuidToBytes(OBJECT_ID).copy(body, p); p += 16
		uuidToBytes(PARENT_ID).copy(body, p); p += 16
		body.writeBigUInt64LE(1099511628032n, p); p += 8   // Handle (256<<40 | 256<<8 example)
		body.writeFloatLE(128.5, p); p += 4
		body.writeFloatLE(64.25, p); p += 4
		body.writeFloatLE(22.0, p); p += 4
		body.writeFloatLE(0.75, p); p += 4
		return Buffer.concat([buildHeader({ seq: 1, reliable: false, hasAcks: false, zeroCoded: false }), body])
	}

	it('decodes the hand-built golden packet into the WS payload shape', () => {
		const m = decode(goldenSoundTrigger())
		expect(m.name).toBe('SoundTrigger')
		const d = mapSoundTrigger(m.blocks)!
		expect(d).toEqual({
			soundId: SOUND_ID, ownerId: OWNER_ID, objectId: OBJECT_ID, parentId: PARENT_ID,
			handle: '1099511628032',
			pos: [expect.closeTo(128.5, 4), expect.closeTo(64.25, 4), expect.closeTo(22, 4)] as unknown as [number, number, number],
			gain: 0.75,
		})
	})

	it('round-trips through the template encoder', () => {
		const pkt = encode('SoundTrigger', {
			SoundData: {
				SoundID: SOUND_ID, OwnerID: OWNER_ID, ObjectID: OBJECT_ID, ParentID: ZERO_UUID,
				Handle: 42n, Position: [10, 20, 30], Gain: 1.5,   // out-of-range gain → clamped
			},
		}, { seq: 7 })
		const d = mapSoundTrigger(decode(pkt).blocks)!
		expect(d.parentId).toBe(ZERO_UUID)
		expect(d.handle).toBe('42')
		expect(d.pos[1]).toBeCloseTo(20, 4)
		expect(d.gain).toBe(1)   // llclampf parity (FS llviewermessage.cpp INT-141)
	})

	it('returns null for a null SoundID (nothing to trigger)', () => {
		const pkt = encode('SoundTrigger', {
			SoundData: { SoundID: ZERO_UUID, OwnerID: OWNER_ID, ObjectID: OBJECT_ID, ParentID: ZERO_UUID, Handle: 0n, Position: [0, 0, 0], Gain: 1 },
		}, { seq: 8 })
		expect(mapSoundTrigger(decode(pkt).blocks)).toBeNull()
	})
})

describe('AttachedSound (Medium 13) — golden bytes + round-trip', () => {
	it('decodes a hand-built packet (SoundID|ObjectID|OwnerID|Gain|Flags)', () => {
		// message_template.msg:7372-7383 — single DataBlock
		const body = Buffer.alloc(2 + 53); let p = 0
		body.writeUInt8(0xFF, p); p += 1
		body.writeUInt8(13, p); p += 1                 // Medium-frequency id
		uuidToBytes(SOUND_ID).copy(body, p); p += 16
		uuidToBytes(OBJECT_ID).copy(body, p); p += 16
		uuidToBytes(OWNER_ID).copy(body, p); p += 16
		body.writeFloatLE(0.5, p); p += 4              // Gain
		body.writeUInt8(0x01, p); p += 1               // Flags (loop)
		const pkt = Buffer.concat([buildHeader({ seq: 2, reliable: false, hasAcks: false, zeroCoded: false }), body])
		const m = decode(pkt)
		expect(m.name).toBe('AttachedSound')
		expect(mapAttachedSound(m.blocks)).toEqual({
			soundId: SOUND_ID, objectId: OBJECT_ID, ownerId: OWNER_ID, gain: 0.5, flags: 1,
		})
	})

	it('round-trips through the template encoder', () => {
		const pkt = encode('AttachedSound', {
			DataBlock: { SoundID: SOUND_ID, ObjectID: OBJECT_ID, OwnerID: OWNER_ID, Gain: 0.25, Flags: 0 },
		}, { seq: 9 })
		const d = mapAttachedSound(decode(pkt).blocks)!
		expect(d.gain).toBeCloseTo(0.25, 5)
		expect(d.flags).toBe(0)
	})
})

describe('AttachedSoundGainChange (Medium 14) — golden bytes + round-trip', () => {
	it('decodes a hand-built packet (ObjectID|Gain)', () => {
		// message_template.msg:7385-7394 — single DataBlock
		const body = Buffer.alloc(2 + 20); let p = 0
		body.writeUInt8(0xFF, p); p += 1
		body.writeUInt8(14, p); p += 1                 // Medium-frequency id
		uuidToBytes(OBJECT_ID).copy(body, p); p += 16
		body.writeFloatLE(0.9, p); p += 4
		const pkt = Buffer.concat([buildHeader({ seq: 3, reliable: false, hasAcks: false, zeroCoded: false }), body])
		const m = decode(pkt)
		expect(m.name).toBe('AttachedSoundGainChange')
		const d = mapAttachedSoundGainChange(m.blocks)!
		expect(d.objectId).toBe(OBJECT_ID)
		expect(d.gain).toBeCloseTo(0.9, 5)
	})

	it('round-trips through the template encoder', () => {
		const pkt = encode('AttachedSoundGainChange', {
			DataBlock: { ObjectID: OBJECT_ID, Gain: 0.1 },
		}, { seq: 10 })
		const d = mapAttachedSoundGainChange(decode(pkt).blocks)!
		expect(d.gain).toBeCloseTo(0.1, 5)
	})
})
