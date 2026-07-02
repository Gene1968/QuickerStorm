import { describe, it, expect } from 'vitest'
import {
	encodeImprovedInstantMessage,
	decodeImprovedInstantMessage,
	uuidToBytes,
} from '../../server/lib/lludp-codec'

const A = '11111111-1111-1111-1111-111111111111'   // giver agentId
const S = '22222222-2222-2222-2222-222222222222'   // giver sessionId
const TO = '33333333-3333-3333-3333-333333333333'  // recipient agentId
const ITEM = '55555555-5555-5555-5555-555555555555'

// Re-encode + round-trip through the decoder. The encoder emits a full ImprovedInstantMessage; the
// decoder walks from the AgentData offset after the Low 254 message-number bytes (0xff 0xff 0x00 0xfe).
function decodeFromPacket(pkt: Buffer) {
	const idx = pkt.indexOf(Buffer.from([0xff, 0xff, 0x00, 0xfe]))
	expect(idx).toBeGreaterThanOrEqual(0)
	return decodeImprovedInstantMessage(pkt, idx + 4)
}

// Mirror the C.GIVE_INVENTORY handler's bucket construction (server/handlers/lludp.ts): a single
// item give = [S8 assetType][16-byte item UUID] (LLGiveInventory::commitGiveInventoryItem BUCKET_SIZE).
function giveBucket(assetType: number, itemId: string): Buffer {
	return Buffer.concat([Buffer.from([(assetType | 0) & 0xff]), uuidToBytes(itemId)])
}

describe('give inventory — outbound offer encode', () => {
	it('emits dialog 4 (IM_INVENTORY_OFFERED) with the [assetType][item UUID] bucket', () => {
		const messageId = crypto.randomUUID()   // giver owns a fresh transaction id
		const bucket = giveBucket(0 /* Texture */, ITEM)
		const pkt = encodeImprovedInstantMessage({
			agentId: A, sessionId: S, seq: 7,
			toAgentId: TO, fromAgentName: 'Giver Resident', message: 'Cool Texture',
			dialog: 4, messageId, binaryBucket: bucket,
		})
		const d = decodeFromPacket(pkt)
		expect(d.dialog).toBe(4)
		expect(d.toAgentId).toBe(TO.toLowerCase())
		expect(d.message).toBe('Cool Texture')
		expect(d.imId).toBe(messageId.toLowerCase())
		// bucket round-trips: 1 type byte + 16 raw UUID bytes
		const raw = Buffer.from(d.binaryBucket, 'base64')
		expect(raw.length).toBe(17)
		expect(raw[0]).toBe(0)   // assetType Texture
		expect(raw.subarray(1).equals(uuidToBytes(ITEM))).toBe(true)
	})

	it('encodes a non-zero asset type in the bucket byte', () => {
		const bucket = giveBucket(6 /* Object */, ITEM)
		const pkt = encodeImprovedInstantMessage({
			agentId: A, sessionId: S, seq: 8,
			toAgentId: TO, fromAgentName: 'Giver', message: 'My Object',
			dialog: 4, messageId: crypto.randomUUID(), binaryBucket: bucket,
		})
		const d = decodeFromPacket(pkt)
		expect(d.dialog).toBe(4)
		const raw = Buffer.from(d.binaryBucket, 'base64')
		expect(raw[0]).toBe(6)   // assetType Object
		expect(raw.subarray(1).equals(uuidToBytes(ITEM))).toBe(true)
	})

	it('gives each item its own fresh transaction id (multi-select emits distinct offers)', () => {
		const id1 = crypto.randomUUID()
		const id2 = crypto.randomUUID()
		expect(id1).not.toBe(id2)
		const p1 = encodeImprovedInstantMessage({
			agentId: A, sessionId: S, seq: 9, toAgentId: TO, fromAgentName: 'G',
			message: 'item1', dialog: 4, messageId: id1, binaryBucket: giveBucket(0, ITEM),
		})
		const p2 = encodeImprovedInstantMessage({
			agentId: A, sessionId: S, seq: 10, toAgentId: TO, fromAgentName: 'G',
			message: 'item2', dialog: 4, messageId: id2, binaryBucket: giveBucket(0, ITEM),
		})
		expect(decodeFromPacket(p1).imId).toBe(id1.toLowerCase())
		expect(decodeFromPacket(p2).imId).toBe(id2.toLowerCase())
	})
})
