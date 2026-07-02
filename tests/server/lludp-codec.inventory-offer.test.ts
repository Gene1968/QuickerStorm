import { describe, it, expect } from 'vitest'
import {
	encodeImprovedInstantMessage,
	decodeImprovedInstantMessage,
	uuidToBytes,
} from '../../server/lib/lludp-codec'

const A = '11111111-1111-1111-1111-111111111111'
const S = '22222222-2222-2222-2222-222222222222'
const FROM = '33333333-3333-3333-3333-333333333333'
const TX = '44444444-4444-4444-4444-444444444444'
const ITEM = '55555555-5555-5555-5555-555555555555'
const FOLDER = '66666666-6666-6666-6666-666666666666'

// Build a MessageBlock BinaryBucket the way an OpenSim/SL agent inventory offer does:
// S8 asset_type + 16-byte item UUID (llimprocessing.cpp offer_agent_bucket_t).
function offerBucket(assetType: number, itemId: string): Buffer {
	return Buffer.concat([Buffer.from([assetType & 0xff]), uuidToBytes(itemId)])
}

// Re-encode an inbound offer via the encoder so we can round-trip through the decoder. The encoder
// emits a full ImprovedInstantMessage; the decoder walks from the AgentData offset. We locate the
// Low 254 message-number bytes (0xff 0xff 0x00 0xfe) and decode the body after them.
function decodeFromPacket(pkt: Buffer) {
	const idx = pkt.indexOf(Buffer.from([0xff, 0xff, 0x00, 0xfe]))
	expect(idx).toBeGreaterThanOrEqual(0)
	// NOTE: the generic encoder zero-codes this NotTrusted Zerocoded message, but the fixed prefix
	// bytes we test on are non-zero, so decode against the raw body after the message-id.
	return decodeImprovedInstantMessage(pkt, idx + 4)
}

describe('decodeImprovedInstantMessage — BinaryBucket', () => {
	it('extracts the agent inventory-offer bucket (assetType + item UUID) as base64', () => {
		const bucket = offerBucket(0 /* Texture */, ITEM)
		const pkt = encodeImprovedInstantMessage({
			agentId: FROM, sessionId: S, seq: 1,
			toAgentId: A, fromAgentName: 'Giver', message: 'here you go',
			dialog: 4, messageId: TX, binaryBucket: bucket,
		})
		const d = decodeFromPacket(pkt)
		expect(d.dialog).toBe(4)
		expect(d.imId).toBe(TX.toLowerCase())
		expect(d.message).toBe('here you go')
		// bucket round-trips losslessly
		const raw = Buffer.from(d.binaryBucket, 'base64')
		expect(raw.length).toBe(17)
		expect(raw[0]).toBe(0)
		expect(raw.subarray(1).equals(uuidToBytes(ITEM))).toBe(true)
	})

	it('yields an empty bucket string when none is present (normal chat IM)', () => {
		const pkt = encodeImprovedInstantMessage({
			agentId: FROM, sessionId: S, seq: 2,
			toAgentId: A, fromAgentName: 'Chatter', message: 'hi',
			dialog: 0,
		})
		const d = decodeFromPacket(pkt)
		expect(d.dialog).toBe(0)
		expect(d.binaryBucket).toBe('')
	})
})

describe('encodeImprovedInstantMessage — offer reply', () => {
	it('echoes the offer transaction id and carries the destination-folder bucket on accept', () => {
		const pkt = encodeImprovedInstantMessage({
			agentId: A, sessionId: S, seq: 3,
			toAgentId: FROM, fromAgentName: 'Me', message: '',
			dialog: 5 /* IM_INVENTORY_ACCEPTED = offer(4)+1 */,
			messageId: TX, binaryBucket: uuidToBytes(FOLDER),
		})
		const d = decodeFromPacket(pkt)
		expect(d.dialog).toBe(5)
		expect(d.toAgentId).toBe(FROM.toLowerCase())
		expect(d.imId).toBe(TX.toLowerCase())        // echoed transaction id
		const raw = Buffer.from(d.binaryBucket, 'base64')
		expect(raw.equals(uuidToBytes(FOLDER))).toBe(true)
	})

	it('carries an empty bucket on decline (offer+2)', () => {
		const pkt = encodeImprovedInstantMessage({
			agentId: A, sessionId: S, seq: 4,
			toAgentId: FROM, fromAgentName: 'Me', message: '',
			dialog: 6 /* IM_INVENTORY_DECLINED = offer(4)+2 */,
			messageId: TX, binaryBucket: Buffer.alloc(0),
		})
		const d = decodeFromPacket(pkt)
		expect(d.dialog).toBe(6)
		expect(d.imId).toBe(TX.toLowerCase())
		expect(d.binaryBucket).toBe('')
	})
})
