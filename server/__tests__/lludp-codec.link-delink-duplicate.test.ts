// ObjectLink/ObjectDelink (Low 115/116, message_template.msg:2447-2471) + ObjectDuplicate
// (Low 90, message_template.msg:1891-1907) golden-byte + block-order tests.
import { describe, it, expect } from 'bun:test'
import { encodeObjectLink, encodeObjectDelink, encodeObjectDuplicate } from '../lib/lludp-codec'
import { decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'
const ZERO       = '00000000-0000-0000-0000-000000000000'

describe('encodeObjectLink', () => {
	it('preserves ObjectData block order — FIRST id becomes the new root (OpenSim LLClientView.cs:9317)', () => {
		const msg = decode(encodeObjectLink({ agentId: AGENT_ID, sessionId: SESSION_ID, seq: 1, localIds: [300, 100, 200] }))
		expect(msg.name).toBe('ObjectLink')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.AgentData[0].SessionID).toBe(SESSION_ID)
		expect(msg.blocks.ObjectData.map((o: any) => o.ObjectLocalID)).toEqual([300, 100, 200])
	})
	it('single-id link (degenerate but should still encode)', () => {
		const msg = decode(encodeObjectLink({ agentId: AGENT_ID, sessionId: SESSION_ID, seq: 1, localIds: [42] }))
		expect(msg.blocks.ObjectData).toHaveLength(1)
		expect(msg.blocks.ObjectData[0].ObjectLocalID).toBe(42)
	})
})

describe('encodeObjectDelink', () => {
	it('preserves ObjectData block order (order doesn\'t matter for delink but must round-trip)', () => {
		const msg = decode(encodeObjectDelink({ agentId: AGENT_ID, sessionId: SESSION_ID, seq: 2, localIds: [7, 8, 9] }))
		expect(msg.name).toBe('ObjectDelink')
		expect(msg.blocks.ObjectData.map((o: any) => o.ObjectLocalID)).toEqual([7, 8, 9])
	})
})

describe('encodeObjectDuplicate', () => {
	it('GroupID Zero, Offset + DuplicateFlags in SharedData, one ObjectData block per id', () => {
		const msg = decode(encodeObjectDuplicate({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 3,
			localIds: [11, 22, 33], offset: [1.5, -2.25, 0.125], duplicateFlags: 0x01,
		}))
		expect(msg.name).toBe('ObjectDuplicate')
		expect(msg.blocks.AgentData[0].GroupID).toBe(ZERO)
		expect(msg.blocks.SharedData[0].Offset).toEqual([1.5, -2.25, 0.125])
		expect(msg.blocks.SharedData[0].DuplicateFlags).toBe(0x01)
		expect(msg.blocks.ObjectData.map((o: any) => o.ObjectLocalID)).toEqual([11, 22, 33])
	})
	it('duplicateFlags defaults to 0', () => {
		const msg = decode(encodeObjectDuplicate({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 4, localIds: [1], offset: [0, 0, 0],
		}))
		expect(msg.blocks.SharedData[0].DuplicateFlags).toBe(0)
	})
})
