// ObjectShape (Low 98) golden-byte tests — message_template.msg:2143-2171.
// Same quantization authority as ObjectAdd (llvolumemessage.cpp packProfileParams/packPathParams,
// llvolume.h:75-80 quanta consts) — encodeObjectShape shares quantizeShapeFields with encodeObjectAdd
// (server/lib/lludp-codec.ts), so these values must agree with lludp-codec.objectadd.test.ts's.
//
// The "prism" fixture is the Build-tool primShapes.js `prism` entry (profile SQUARE/path LINE,
// ratio 0/1, shear -0.5/0) — the exact raw shape src/__tests__/lib/primParams.test.js's golden
// PRISM acceptance test also exercises, so the two suites cross-validate the float↔wire mapping.
import { describe, it, expect } from 'bun:test'
import { encodeObjectShape } from '../lib/lludp-codec'
import { decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'

const PRISM = {
	localId: 1234,
	pathCurve: 0x10, profileCurve: 0x01,   // PATH_LINE, PROFILE_SQUARE
	pathBegin: 0, pathEnd: 1,
	pathScaleX: 0, pathScaleY: 1,           // ratio float 0 / 1 → wire 200 / 100
	pathShearX: -0.5, pathShearY: 0,
	pathTwist: 0, pathTwistBegin: 0,
	pathRadiusOffset: 0,
	pathTaperX: 0, pathTaperY: 0,
	pathRevolutions: 1,
	pathSkew: 0,
	profileBegin: 0, profileEnd: 1, profileHollow: 0,
}

describe('encodeObjectShape — golden prism block', () => {
	const msg = decode(encodeObjectShape({ agentId: AGENT_ID, sessionId: SESSION_ID, seq: 1, updates: [PRISM] }))
	it('message identity + AgentData (no GroupID on this message)', () => {
		expect(msg.name).toBe('ObjectShape')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.AgentData[0].SessionID).toBe(SESSION_ID)
	})
	it('ObjectLocalID + curves pass through unquantized', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.ObjectLocalID).toBe(1234)
		expect(od.PathCurve).toBe(0x10)
		expect(od.ProfileCurve).toBe(0x01)
	})
	it('ProfileEnd wire 0 for float 1.0 (50000 - round(1/0.00002) = 0)', () => {
		expect(msg.blocks.ObjectData[0].ProfileEnd).toBe(0)
		expect(msg.blocks.ObjectData[0].ProfileBegin).toBe(0)
		expect(msg.blocks.ObjectData[0].PathBegin).toBe(0)
		expect(msg.blocks.ObjectData[0].PathEnd).toBe(0)
	})
	it('PathScaleX wire 200 for ratio float 0.0 (200 - round(0/0.01) = 200)', () => {
		expect(msg.blocks.ObjectData[0].PathScaleX).toBe(200)
		expect(msg.blocks.ObjectData[0].PathScaleY).toBe(100)
	})
	it('ShearX wire -50 for float -0.5 (U8 two\'s-complement wire field)', () => {
		// PathShearX is a U8 wire field even though it carries a signed value — decode() (like
		// lludp-codec.objectadd.test.ts:124) returns the raw unsigned byte; compare masked.
		expect(msg.blocks.ObjectData[0].PathShearX & 0xFF).toBe((-50) & 0xFF)
		expect(msg.blocks.ObjectData[0].PathShearY).toBe(0)
	})
	it('Revolutions wire 0 for float 1.0 (round((1-1)/0.015) = 0)', () => {
		expect(msg.blocks.ObjectData[0].PathRevolutions).toBe(0)
	})
	it('all-zero twist/taper/radius/skew quantize to 0', () => {
		const od = msg.blocks.ObjectData[0]
		expect(od.PathTwist).toBe(0)
		expect(od.PathTwistBegin).toBe(0)
		expect(od.PathRadiusOffset).toBe(0)
		expect(od.PathTaperX).toBe(0)
		expect(od.PathTaperY).toBe(0)
		expect(od.PathSkew).toBe(0)
		expect(od.ProfileHollow).toBe(0)
	})
})

describe('encodeObjectShape — multi-object packet (2 blocks)', () => {
	const TORUS = {
		localId: 42,
		pathCurve: 0x20, profileCurve: 0x00,   // PATH_CIRCLE, PROFILE_CIRCLE
		pathBegin: 0, pathEnd: 1,
		pathScaleX: 1, pathScaleY: 0.25,
		pathShearX: 0, pathShearY: 0,
		pathTwist: 0.5, pathTwistBegin: 0,
		pathRadiusOffset: 0,
		pathTaperX: 0, pathTaperY: 0,
		pathRevolutions: 1,
		pathSkew: 0,
		profileBegin: 0, profileEnd: 1, profileHollow: 0,
	}
	const msg = decode(encodeObjectShape({
		agentId: AGENT_ID, sessionId: SESSION_ID, seq: 2, updates: [PRISM, TORUS],
	}))
	it('encodes both blocks independently, in order', () => {
		expect(msg.blocks.ObjectData).toHaveLength(2)
		expect(msg.blocks.ObjectData[0].ObjectLocalID).toBe(1234)
		expect(msg.blocks.ObjectData[1].ObjectLocalID).toBe(42)
	})
	it('second block quantizes its own (different) shape params', () => {
		const od = msg.blocks.ObjectData[1]
		expect(od.PathScaleX).toBe(100)          // ratio 1.0 → 200-100=100
		expect(od.PathScaleY).toBe(175)          // ratio 0.25 → 200-25=175
		expect(od.PathTwist).toBe(50)             // round(0.5/0.01)
		expect(od.PathCurve).toBe(0x20)
	})
})
