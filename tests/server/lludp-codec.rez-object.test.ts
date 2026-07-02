import { describe, it, expect } from 'vitest'
import { encodeRezObject, uuidToBytes } from '../../server/lib/lludp-codec'
import { decodeZeroCoded } from '../../server/lib/protocol/wire'

const FLAG_ZERO_CODED = 0x80

const A = '11111111-1111-1111-1111-111111111111'
const S = '22222222-2222-2222-2222-222222222222'
const ITEM = '33333333-3333-3333-3333-333333333333'
const FOLDER = '44444444-4444-4444-4444-444444444444'
const ZERO = '00000000-0000-0000-0000-000000000000'

// Low-freq id prefix = 0xFF 0xFF + U16BE(messageNumber).
function lowPrefix(num: number): Buffer {
	const b = Buffer.alloc(4)
	b[0] = 0xff; b[1] = 0xff
	b.writeUInt16BE(num, 2)
	return b
}
// RezObject is a Zerocoded Low message, so its body is compressed. Un-zerocode the post-header
// region (header = flags(1) + seq(4) + extra(1) = 6 bytes) before asserting fixed field offsets —
// otherwise the interior zero UUIDs (FromTaskID, RayTargetID) shift every later offset.
function bodyAfterPrefix(pkt: Buffer, num: number): Buffer {
	const zeroCoded = (pkt[0] & FLAG_ZERO_CODED) !== 0
	const afterHeader = pkt.subarray(6)
	const decoded = zeroCoded ? decodeZeroCoded(afterHeader) : afterHeader
	const idx = decoded.indexOf(lowPrefix(num))
	expect(idx).toBeGreaterThanOrEqual(0)
	return decoded.subarray(idx + 4)
}

// Re-implement the InventoryData CRC (mirrors inventoryCRC in lludp-codec.ts) so the test asserts an
// exact, independently-computed value rather than trusting the encoder's own helper output blindly.
function uuidCRC32(uuid: string): number {
	const b = uuidToBytes(uuid)
	let crc = 0
	for (let i = 0; i < 4; i++) crc = (crc + b.readUInt32LE(i * 4)) >>> 0
	return crc >>> 0
}
function expectedCRC(p: {
	creationDate: number; saleType: number; invType: number; type: number
	assetId: string; groupId: string; salePrice: number
	ownerId: string; creatorId: string; itemId: string; folderId: string
	everyoneMask: number; flags: number; ownerMask: number; groupMask: number; nextOwnerMask: number
}): number {
	let crc = p.creationDate >>> 0
	crc = (crc + ((p.saleType * 0x07073096) >>> 0)) >>> 0
	crc = (crc + (p.invType >>> 0)) >>> 0
	crc = (crc + (p.type >>> 0)) >>> 0
	crc = (crc + uuidCRC32(p.assetId)) >>> 0
	crc = (crc + uuidCRC32(p.groupId)) >>> 0
	crc = (crc + (p.salePrice >>> 0)) >>> 0
	crc = (crc + ((uuidCRC32(p.ownerId) + uuidCRC32(p.creatorId) + uuidCRC32(p.itemId) + uuidCRC32(p.folderId)) >>> 0)) >>> 0
	crc = (crc + (p.everyoneMask >>> 0)) >>> 0
	crc = (crc + (p.flags >>> 0)) >>> 0
	crc = (crc + (p.ownerMask >>> 0)) >>> 0
	crc = (crc + (p.groupMask >>> 0)) >>> 0
	crc = (crc + (p.nextOwnerMask >>> 0)) >>> 0
	return crc >>> 0
}

describe('encodeRezObject (Low 293)', () => {
	it('emits Low 293 with AgentData { AgentID, SessionID, GroupID }', () => {
		const pkt = encodeRezObject({
			agentId: A, sessionId: S, seq: 1,
			rayStart: [128, 64, 25], rayEnd: [128, 64, 25],
			inventoryData: { itemId: ITEM, folderId: FOLDER, name: 'Box' },
		})
		const body = bodyAfterPrefix(pkt, 293)
		// AgentData Single (no count prefix): AgentID, SessionID, GroupID(zero default)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(S))).toBe(true)
		expect(body.subarray(32, 48).equals(uuidToBytes(ZERO))).toBe(true)
	})

	it('packs RezData with BypassRaycast=1, RayEnd=position, RayEndIsIntersection=0', () => {
		const pkt = encodeRezObject({
			agentId: A, sessionId: S, seq: 1,
			rayStart: [128, 64, 25], rayEnd: [200, 30, 22.5],
			inventoryData: { itemId: ITEM, folderId: FOLDER },
		})
		const body = bodyAfterPrefix(pkt, 293)
		// RezData Single starts at 48. FromTaskID(16) zero, BypassRaycast U8, RayStart(12), RayEnd(12), ...
		const rez = 48
		expect(body.subarray(rez, rez + 16).equals(uuidToBytes(ZERO))).toBe(true) // FromTaskID
		expect(body[rez + 16]).toBe(1)                                            // BypassRaycast
		const rayStart = rez + 17
		expect(body.readFloatLE(rayStart)).toBeCloseTo(128)
		expect(body.readFloatLE(rayStart + 4)).toBeCloseTo(64)
		expect(body.readFloatLE(rayStart + 8)).toBeCloseTo(25)
		const rayEnd = rayStart + 12
		expect(body.readFloatLE(rayEnd)).toBeCloseTo(200)
		expect(body.readFloatLE(rayEnd + 4)).toBeCloseTo(30)
		expect(body.readFloatLE(rayEnd + 8)).toBeCloseTo(22.5)
		const rayTarget = rayEnd + 12
		expect(body.subarray(rayTarget, rayTarget + 16).equals(uuidToBytes(ZERO))).toBe(true) // RayTargetID
		const bools = rayTarget + 16
		expect(body[bools]).toBe(0)     // RayEndIsIntersection = false
		expect(body[bools + 1]).toBe(0) // RezSelected default false
		expect(body[bools + 2]).toBe(0) // RemoveItem default false (copyable)
	})

	it('sets RemoveItem=1 when RezSelected/RemoveItem are requested', () => {
		const pkt = encodeRezObject({
			agentId: A, sessionId: S, seq: 1,
			rayStart: [1, 2, 3], rayEnd: [1, 2, 3],
			rezSelected: true, removeItem: true,
			inventoryData: { itemId: ITEM, folderId: FOLDER },
		})
		const body = bodyAfterPrefix(pkt, 293)
		const bools = 48 + 16 + 1 + 12 + 12 + 16 // FromTaskID+Bypass+RayStart+RayEnd+RayTargetID
		expect(body[bools]).toBe(0)     // RayEndIsIntersection
		expect(body[bools + 1]).toBe(1) // RezSelected
		expect(body[bools + 2]).toBe(1) // RemoveItem
	})

	it('packs InventoryData Single with ItemID, FolderID and a matching CRC', () => {
		const createdAt = 1700000000
		const pkt = encodeRezObject({
			agentId: A, sessionId: S, seq: 1,
			rayStart: [10, 20, 30], rayEnd: [10, 20, 30],
			inventoryData: {
				itemId: ITEM, folderId: FOLDER, name: 'Box', description: 'd',
				assetType: 6, invType: 6, ownerMask: 0x7fffffff, nextOwnerMask: 0x0008e000,
				createdAt,
			},
		})
		const body = bodyAfterPrefix(pkt, 293)
		// InventoryData Single starts right after RezData. AgentData = 48 (3 UUIDs). RezData = 76:
		// FromTaskID(16)+Bypass(1)+RayStart(12)+RayEnd(12)+RayTargetID(16)+3 BOOLs(3)+4 U32(16) = 76.
		const inv = 48 + 76
		expect(body.subarray(inv, inv + 16).equals(uuidToBytes(ITEM))).toBe(true)     // ItemID
		expect(body.subarray(inv + 16, inv + 32).equals(uuidToBytes(FOLDER))).toBe(true) // FolderID
		// CreatorID(16)=owner default(=agent), OwnerID(16)=agent, GroupID(16)=zero,
		// then 5×U32 masks, GroupOwned(1), TransactionID(16), Type S8, InvType S8 ...
		const typeOff = inv + 32 + 16 + 16 + 16 + (5 * 4) + 1 + 16
		expect(body.readInt8(typeOff)).toBe(6)      // Type S8
		expect(body.readInt8(typeOff + 1)).toBe(6)  // InvType S8

		// CRC is the final U32 of the body.
		const crc = body.readUInt32LE(body.length - 4)
		const want = expectedCRC({
			creationDate: createdAt, saleType: 0, invType: 6, type: 6,
			assetId: ZERO, groupId: ZERO, salePrice: 0,
			ownerId: A, creatorId: A, itemId: ITEM, folderId: FOLDER,
			everyoneMask: 0, flags: 0, ownerMask: 0x7fffffff, groupMask: 0, nextOwnerMask: 0x0008e000,
		})
		expect(crc).toBe(want)
		expect(crc).not.toBe(0)
	})
})
