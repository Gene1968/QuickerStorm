// ObjectAdd (Medium 1) golden-byte tests — message_template.msg:1824-1867.
// Quantization authority: FS indra/llvolume.h:75-80 (quanta consts) + indra/llprimitive/
// llvolumemessage.cpp packProfileParams (:39-65) / packPathParams (:208-263).
// PCode authority: LL_PCODE_VOLUME=9 (llvolume.h:102), the value every regular-prim "Add" sends
// (lltoolplacer.cpp:349-483 — every shape case sets volume_pcode = LL_PCODE_VOLUME).
import { describe, it, expect } from 'bun:test'
import { encodeObjectAdd } from '../lib/lludp-codec'
import { decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'
const ZERO       = '00000000-0000-0000-0000-000000000000'

// LL_PCODE_PROFILE_SQUARE (llvolume.h:142) + LL_PCODE_PATH_LINE (llvolume.h:160) — default cube,
// per FS lltoolplacer.cpp LL_PCODE_CUBE case (ratio 1,1 / begin-end 0..1 / shear 0,0).
const CUBE = {
	agentId: AGENT_ID, sessionId: SESSION_ID, seq: 1,
	material: 3, addFlags: 0,
	pathCurve: 0x10, profileCurve: 0x01,
	pathBegin: 0, pathEnd: 1,
	pathScaleX: 1, pathScaleY: 1,
	pathShearX: 0, pathShearY: 0,
	pathTwist: 0, pathTwistBegin: 0,
	pathRadiusOffset: 0,
	pathTaperX: 0, pathTaperY: 0,
	pathRevolutions: 1,
	pathSkew: 0,
	profileBegin: 0, profileEnd: 1, profileHollow: 0,
	rayStart: [1, 2, 3] as [number, number, number],
	rayEnd:   [4, 5, 6] as [number, number, number],
	scale:    [0.5, 0.5, 0.5] as [number, number, number],
	rotation: [0, 0, 0, 1] as [number, number, number, number],
}

describe('encodeObjectAdd — default cube quantization (all-zero path/profile fields)', () => {
	const msg = decode(encodeObjectAdd(CUBE))
	it('message identity + AgentData', () => {
		expect(msg.name).toBe('ObjectAdd')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.AgentData[0].SessionID).toBe(SESSION_ID)
		expect(msg.blocks.AgentData[0].GroupID).toBe(ZERO)   // no active-group concept — always Zero
	})
	it('PCode defaults to LL_PCODE_VOLUME (9)', () => {
		expect(msg.blocks.ObjectData[0].PCode).toBe(9)
	})
	it('Material + AddFlags + curves pass through unquantized', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.Material).toBe(3)
		expect(od.AddFlags).toBe(0)
		expect(od.PathCurve).toBe(0x10)
		expect(od.ProfileCurve).toBe(0x01)
	})
	it('Begin=0/End=1 (S/T span, hollow=0) quantize to zero on the wire (CUT_QUANTA cancels exactly)', () => {
		const od = msg.blocks.ObjectData[0]
		// begin: round(0/quanta)=0; end: 50000-round(1/quanta)=50000-50000=0
		expect(od.PathBegin).toBe(0)
		expect(od.PathEnd).toBe(0)
		expect(od.ProfileBegin).toBe(0)
		expect(od.ProfileEnd).toBe(0)
		expect(od.ProfileHollow).toBe(0)
	})
	it('ScaleX/Y=1 (no taper) → PathScaleX/Y = 200 - round(1/0.01) = 100', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.PathScaleX).toBe(100)
		expect(od.PathScaleY).toBe(100)
	})
	it('all-zero shear/twist/taper/skew quantize to 0', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.PathShearX).toBe(0)
		expect(od.PathShearY).toBe(0)
		expect(od.PathTwist).toBe(0)
		expect(od.PathTwistBegin).toBe(0)
		expect(od.PathRadiusOffset).toBe(0)
		expect(od.PathTaperX).toBe(0)
		expect(od.PathTaperY).toBe(0)
		expect(od.PathSkew).toBe(0)
	})
	it('Revolutions=1 → round((1-1)/0.015) = 0', () => {
		expect(msg.blocks.ObjectData[0].PathRevolutions).toBe(0)
	})
	it('RayStart/RayEnd/Scale pass through as LLVector3', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.RayStart).toEqual([1, 2, 3])
		expect(od.RayEnd).toEqual([4, 5, 6])
		expect(od.Scale).toEqual([0.5, 0.5, 0.5])
	})
	it('RayTargetID defaults to Zero when omitted; BypassRaycast/RayEndIsIntersection default false', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.RayTargetID).toBe(ZERO)
		expect(od.BypassRaycast).toBe(0)
		expect(od.RayEndIsIntersection).toBe(0)
	})
	it('identity rotation [0,0,0,1] packs to [0,0,0] (packQuatToVector3, w≥0 keeps xyz)', () => {
		const rot = msg.blocks.ObjectData[0].Rotation as number[]
		expect(rot[0]).toBeCloseTo(0, 5)
		expect(rot[1]).toBeCloseTo(0, 5)
		expect(rot[2]).toBeCloseTo(0, 5)
	})
	it('State defaults to 0', () => {
		expect(msg.blocks.ObjectData[0].State).toBe(0)
	})
})

describe('encodeObjectAdd — non-trivial quantization + explicit overrides', () => {
	it('taper/hollow/shear/skew/twist round correctly per llvolumemessage.cpp formulas', () => {
		const msg = decode(encodeObjectAdd({
			...CUBE,
			pcode: 9,
			pathScaleX: 0.5, pathScaleY: 0.25,   // 200-round(v/0.01)
			pathShearX: -0.25, pathShearY: 0.1,  // round(v/0.01), stored as U8 two's complement
			pathTwist: -1, pathTwistBegin: 0.5,  // round(v/0.01), S8
			pathRadiusOffset: -0.5,
			pathTaperX: 1, pathTaperY: -1,       // round(v/0.01), S8 clamp
			pathRevolutions: 3,                  // round((3-1)/0.015) = 133
			pathSkew: -1,
			profileHollow: 0.3,                  // round(0.3/0.00002) = 15000
			rayTargetId: '55556666-7777-8888-9999-aaaabbbbcccc',
			bypassRaycast: true, rayEndIsIntersection: true,
			state: 7,
		}))
		const od = msg.blocks.ObjectData[0]
		expect(od.PathScaleX).toBe(200 - 50)   // 150
		expect(od.PathScaleY).toBe(200 - 25)   // 175
		expect(od.PathShearX & 0xFF).toBe((-25) & 0xFF)  // two's complement of -25
		expect(od.PathShearY).toBe(10)
		expect(od.PathTwist).toBe(-100)
		expect(od.PathTwistBegin).toBe(50)
		expect(od.PathRadiusOffset).toBe(-50)
		expect(od.PathTaperX).toBe(100)
		expect(od.PathTaperY).toBe(-100)
		expect(od.PathRevolutions).toBe(Math.round(2 / 0.015))
		expect(od.PathSkew).toBe(-100)
		expect(od.ProfileHollow).toBe(15000)
		expect(od.RayTargetID).toBe('55556666-7777-8888-9999-aaaabbbbcccc')
		expect(od.BypassRaycast).toBe(1)
		expect(od.RayEndIsIntersection).toBe(1)
		expect(od.State).toBe(7)
	})
})
