// DeRezObject Take / TakeCopy + PurgeInventoryDescendents wire tests.
// DeRezAction values per opensim OpenSim/Framework/IScene.cs:47-55 (TakeCopy=1, Take=4, Delete=6)
// and FS indra/newview/llselectmgr.h:83-98 (EDeRezDestination).
import { describe, it, expect } from 'bun:test'
import {
	encodeDeRezObject, DEREZ_TAKE, DEREZ_TAKE_COPY,
	encodePurgeInventoryDescendents,
} from '../lib/lludp-codec'
import { decode } from '../lib/protocol/codec.ts'

const AGENT_ID   = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'
const FOLDER_ID  = '99998888-7777-6666-5555-444433332222'
const ZERO       = '00000000-0000-0000-0000-000000000000'

describe('DeRezAction constants (opensim IScene.cs:47-55)', () => {
	it('Take=4, TakeCopy=1', () => {
		expect(DEREZ_TAKE).toBe(4)
		expect(DEREZ_TAKE_COPY).toBe(1)
	})
})

describe('encodeDeRezObject — Take', () => {
	it('encodes Destination=4 with the destination folder UUID (FS confirm_take)', () => {
		const buf = encodeDeRezObject({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 7,
			localIds: [123456, 789012], destination: DEREZ_TAKE, destinationId: FOLDER_ID,
		})
		const msg = decode(buf)
		expect(msg.name).toBe('DeRezObject')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.AgentBlock[0].Destination).toBe(DEREZ_TAKE)
		expect(msg.blocks.AgentBlock[0].DestinationID).toBe(FOLDER_ID)
		expect(msg.blocks.ObjectData.map((o: any) => o.ObjectLocalID)).toEqual([123456, 789012])
	})
})

describe('encodeDeRezObject — TakeCopy', () => {
	it('encodes Destination=1 with zero DestinationID (OpenSim forces Objects folder anyway)', () => {
		const buf = encodeDeRezObject({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 8,
			localIds: [42], destination: DEREZ_TAKE_COPY,
		})
		const msg = decode(buf)
		expect(msg.name).toBe('DeRezObject')
		expect(msg.blocks.AgentBlock[0].Destination).toBe(DEREZ_TAKE_COPY)
		expect(msg.blocks.AgentBlock[0].DestinationID).toBe(ZERO)
		expect(msg.blocks.ObjectData).toHaveLength(1)
		expect(msg.blocks.ObjectData[0].ObjectLocalID).toBe(42)
	})
})

describe('encodePurgeInventoryDescendents (Low 285, message_template.msg:6405)', () => {
	it('round-trips AgentData + InventoryData.FolderID', () => {
		const buf = encodePurgeInventoryDescendents({
			agentId: AGENT_ID, sessionId: SESSION_ID, seq: 9, folderId: FOLDER_ID,
		})
		const msg = decode(buf)
		expect(msg.name).toBe('PurgeInventoryDescendents')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT_ID)
		expect(msg.blocks.AgentData[0].SessionID).toBe(SESSION_ID)
		expect(msg.blocks.InventoryData[0].FolderID).toBe(FOLDER_ID)
	})
})
