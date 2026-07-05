// MultipleObjectUpdate (Medium 2) golden-byte tests.
// Packer authority: FS llselectmgr.cpp:4922 packMultipleUpdate — Data order STRICTLY
// pos(12) → rot(12, quat packed to 3 floats) → scale(12), only flagged fields present.
// Flags: llselectmgr.h:60-65 (POSITION 0x01, ROTATION 0x02, SCALE 0x04, LINKED_SETS 0x08, UNIFORM 0x10).
// Decode-side authority for ACCEPTED Type bytes: opensim LLClientView.cs:12298 HandleMultipleObjUpdate
// (1,2,3,4,5,0x14,0x15,9,0x0A,0x0B,0x0C,0x0D,0x1C,0x1D).
import { describe, it, expect } from 'bun:test'
import {
	encodeMultipleObjectUpdate, packQuatToVector3,
	UPD_POSITION, UPD_ROTATION, UPD_SCALE, UPD_LINKED_SETS, UPD_UNIFORM,
	MULTI_UPDATE_ACCEPTED_TYPES,
} from '../lib/lludp-codec'
import { decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'

// The exact OpenSim switch-case table (LLClientView.cs:12298 HandleMultipleObjUpdate).
const OPENSIM_TABLE = new Set([1, 2, 3, 4, 5, 0x14, 0x15, 9, 0x0A, 0x0B, 0x0C, 0x0D, 0x1C, 0x1D])

const POS:   [number, number, number] = [128.5, 64.25, 21.125]
const SCALE: [number, number, number] = [2.0, 0.5, 10.0]
// 90° about Z: q = [0, 0, sin45, cos45]
const ROT: [number, number, number, number] = [0, 0, 0.7071068, 0.7071068]

function enc(updates: Parameters<typeof encodeMultipleObjectUpdate>[0]['updates'], opts: { linked?: boolean; uniform?: boolean } = {}) {
	const buf = encodeMultipleObjectUpdate({
		agentId: AGENT_ID, sessionId: SESSION_ID, seq: 11, updates, ...opts,
	})
	return decode(buf)
}

const f32 = (b: Buffer, off: number) => b.readFloatLE(off)
const expectVec3At = (b: Buffer, off: number, v: number[]) => {
	expect(f32(b, off)).toBeCloseTo(v[0], 5)
	expect(f32(b, off + 4)).toBeCloseTo(v[1], 5)
	expect(f32(b, off + 8)).toBeCloseTo(v[2], 5)
}

describe('UPD_* flag constants (llselectmgr.h:60-65)', () => {
	it('match FS values', () => {
		expect(UPD_POSITION).toBe(0x01)
		expect(UPD_ROTATION).toBe(0x02)
		expect(UPD_SCALE).toBe(0x04)
		expect(UPD_LINKED_SETS).toBe(0x08)
		expect(UPD_UNIFORM).toBe(0x10)
	})
	it('exported accepted-type table equals the OpenSim switch table', () => {
		expect([...MULTI_UPDATE_ACCEPTED_TYPES].sort((a, b) => a - b)).toEqual([...OPENSIM_TABLE].sort((a, b) => a - b))
	})
})

describe('encodeMultipleObjectUpdate — golden bytes per combo', () => {
	it('pos-only → Type 1 (OpenSim case 1: position at 0), Data = 12B', () => {
		const msg = enc([{ localId: 4242, position: POS }])
		expect(msg.name).toBe('MultipleObjectUpdate')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		const b = msg.blocks.ObjectData[0]
		expect(b.ObjectLocalID).toBe(4242)
		expect(b.Type).toBe(1)
		const data = b.Data as Buffer
		expect(data.length).toBe(12)
		expectVec3At(data, 0, POS)
		expect(OPENSIM_TABLE.has(b.Type as number)).toBe(true)
	})

	it('rot-only → Type 2 (OpenSim case 2: rotation at 0), Data = 12B packed quat', () => {
		const msg = enc([{ localId: 7, rotation: ROT }])
		const b = msg.blocks.ObjectData[0]
		expect(b.Type).toBe(2)
		const data = b.Data as Buffer
		expect(data.length).toBe(12)
		expectVec3At(data, 0, [0, 0, 0.7071068])
		expect(OPENSIM_TABLE.has(b.Type as number)).toBe(true)
	})

	it('rot+pos → Type 3 (OpenSim case 3: position at 0, rotation at 12) — the FS rotation send (llpanelobject.cpp:2187)', () => {
		const msg = enc([{ localId: 7, position: POS, rotation: ROT }])
		const b = msg.blocks.ObjectData[0]
		expect(b.Type).toBe(3)
		const data = b.Data as Buffer
		expect(data.length).toBe(24)
		expectVec3At(data, 0, POS)                    // pos FIRST
		expectVec3At(data, 12, [0, 0, 0.7071068])     // packed quat at 12
		expect(OPENSIM_TABLE.has(b.Type as number)).toBe(true)
	})

	it('scale-only → Type 4 (OpenSim case 4: scale at 0)', () => {
		const msg = enc([{ localId: 9, scale: SCALE }])
		const b = msg.blocks.ObjectData[0]
		expect(b.Type).toBe(4)
		expectVec3At(b.Data as Buffer, 0, SCALE)
		expect(OPENSIM_TABLE.has(b.Type as number)).toBe(true)
	})

	it('scale+pos → Type 5 (OpenSim case 5: position at 0, scale at 12) — the FS scale send (llpanelobject.cpp:2236)', () => {
		const msg = enc([{ localId: 9, position: POS, scale: SCALE }])
		const b = msg.blocks.ObjectData[0]
		expect(b.Type).toBe(5)
		const data = b.Data as Buffer
		expect(data.length).toBe(24)
		expectVec3At(data, 0, POS)
		expectVec3At(data, 12, SCALE)
		expect(OPENSIM_TABLE.has(b.Type as number)).toBe(true)
	})

	it('linked variants → 9 / 0x0A / 0x0B / 0x0C / 0x0D (OpenSim group cases)', () => {
		expect(enc([{ localId: 1, position: POS }], { linked: true }).blocks.ObjectData[0].Type).toBe(9)
		expect(enc([{ localId: 1, rotation: ROT }], { linked: true }).blocks.ObjectData[0].Type).toBe(0x0A)
		const pr = enc([{ localId: 1, position: POS, rotation: ROT }], { linked: true }).blocks.ObjectData[0]
		expect(pr.Type).toBe(0x0B)
		expectVec3At(pr.Data as Buffer, 0, POS)      // group rot+pos: pos at 0, rot at 12 (case 0x0B)
		expectVec3At(pr.Data as Buffer, 12, [0, 0, 0.7071068])
		expect(enc([{ localId: 1, scale: SCALE }], { linked: true }).blocks.ObjectData[0].Type).toBe(0x0C)
		expect(enc([{ localId: 1, position: POS, scale: SCALE }], { linked: true }).blocks.ObjectData[0].Type).toBe(0x0D)
		for (const t of [9, 0x0A, 0x0B, 0x0C, 0x0D]) expect(OPENSIM_TABLE.has(t)).toBe(true)
	})

	it('uniform scale → 0x14 / 0x15 / 0x1C / 0x1D', () => {
		expect(enc([{ localId: 1, scale: SCALE }], { uniform: true }).blocks.ObjectData[0].Type).toBe(0x14)
		const us = enc([{ localId: 1, position: POS, scale: SCALE }], { uniform: true }).blocks.ObjectData[0]
		expect(us.Type).toBe(0x15)
		expectVec3At(us.Data as Buffer, 0, POS)      // uniform scale+pos: pos at 0, scale at 12 (case 0x15)
		expectVec3At(us.Data as Buffer, 12, SCALE)
		expect(enc([{ localId: 1, scale: SCALE }], { linked: true, uniform: true }).blocks.ObjectData[0].Type).toBe(0x1C)
		expect(enc([{ localId: 1, position: POS, scale: SCALE }], { linked: true, uniform: true }).blocks.ObjectData[0].Type).toBe(0x1D)
		for (const t of [0x14, 0x15, 0x1C, 0x1D]) expect(OPENSIM_TABLE.has(t)).toBe(true)
	})

	it('multiple blocks encode independently', () => {
		const msg = enc([
			{ localId: 100, position: POS },
			{ localId: 200, position: [1, 2, 3] },
		])
		expect(msg.blocks.ObjectData).toHaveLength(2)
		expect(msg.blocks.ObjectData[1].ObjectLocalID).toBe(200)
		expectVec3At(msg.blocks.ObjectData[1].Data as Buffer, 0, [1, 2, 3])
	})

	it('REFUSES combos outside the OpenSim table (rot+scale = 7, uniform without scale = 0x11)', () => {
		expect(() => enc([{ localId: 1, rotation: ROT, scale: SCALE }])).toThrow(/not in OpenSim/)
		expect(() => enc([{ localId: 1, position: POS }], { uniform: true })).toThrow(/not in OpenSim/)
	})
})

describe('packQuatToVector3 (llquaternion.cpp:919)', () => {
	it('drops W and keeps xyz when W ≥ 0', () => {
		const [x, y, z] = packQuatToVector3([0, 0, 0.7071068, 0.7071068])
		expect(x).toBeCloseTo(0, 6)
		expect(y).toBeCloseTo(0, 6)
		expect(z).toBeCloseTo(0.7071068, 6)
	})
	it('negates xyz when W < 0 (same rotation, receiver re-derives positive W)', () => {
		const [x, y, z] = packQuatToVector3([0.5, -0.5, 0.5, -0.5])
		expect(x).toBeCloseTo(-0.5, 6)
		expect(y).toBeCloseTo(0.5, 6)
		expect(z).toBeCloseTo(-0.5, 6)
	})
	it('normalizes by 4-component magnitude', () => {
		const [x, y, z] = packQuatToVector3([0, 0, 2, 2])   // unnormalized 90°-about-Z
		expect(x).toBeCloseTo(0, 6)
		expect(y).toBeCloseTo(0, 6)
		expect(z).toBeCloseTo(0.7071068, 5)
	})
})
