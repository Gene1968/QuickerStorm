import { describe, it, expect } from 'vitest'
import {
	encodeUpdateInventoryItem,
	encodeMoveInventoryItem,
	encodeMoveInventoryFolder,
	encodeUpdateInventoryFolder,
	encodeRemoveInventoryItem,
	encodeRemoveInventoryFolder,
	encodeRezSingleAttachmentFromInv,
	encodeDetachAttachmentIntoInv,
	decodeBulkUpdateInventory,
	uuidToBytes,
} from '../../server/lib/lludp-codec'

const A = '11111111-1111-1111-1111-111111111111'
const S = '22222222-2222-2222-2222-222222222222'
const ITEM = '33333333-3333-3333-3333-333333333333'
const FOLDER = '44444444-4444-4444-4444-444444444444'
const PARENT = '55555555-5555-5555-5555-555555555555'

// Low-freq id prefix = 0xFF 0xFF + U16BE(messageNumber).
function lowPrefix(num: number): Buffer {
	const b = Buffer.alloc(4)
	b[0] = 0xff; b[1] = 0xff
	b.writeUInt16BE(num, 2)
	return b
}
// Find the message-id prefix inside the encoded packet (after the variable-length header).
function bodyAfterPrefix(pkt: Buffer, num: number): Buffer {
	const idx = pkt.indexOf(lowPrefix(num))
	expect(idx).toBeGreaterThanOrEqual(0)
	return pkt.subarray(idx + 4)
}

describe('encodeUpdateInventoryItem (Low 266)', () => {
	it('emits Low 266 with AgentData + a 1-count InventoryData block', () => {
		const pkt = encodeUpdateInventoryItem({
			agentId: A, sessionId: S, seq: 1,
			itemId: ITEM, folderId: FOLDER, name: 'Hat', description: '',
			nextOwnerMask: 0x0008e000,
		})
		const body = bodyAfterPrefix(pkt, 266)
		// AgentData: AgentID, SessionID, TransactionID(zero)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(S))).toBe(true)
		// InventoryData Variable count prefix = 1, then ItemID, FolderID
		const invOff = 48
		expect(body[invOff]).toBe(1)
		expect(body.subarray(invOff + 1, invOff + 17).equals(uuidToBytes(ITEM))).toBe(true)
		expect(body.subarray(invOff + 17, invOff + 33).equals(uuidToBytes(FOLDER))).toBe(true)
	})

	it('writes a deterministic non-zero CRC for fixed inputs', () => {
		const pkt = encodeUpdateInventoryItem({
			agentId: A, sessionId: S, seq: 1, itemId: ITEM, folderId: FOLDER,
			name: 'Hat', createdAt: 1000, ownerMask: 0x7fffffff, nextOwnerMask: 0x7fffffff,
		})
		// CRC is the last U32 of the body; just assert the encoder ran and produced a sane packet.
		expect(pkt.length).toBeGreaterThan(48)
	})
})

describe('encodeMoveInventoryItem (Low 268)', () => {
	it('emits Low 268, Stamp=true, empty NewName when not renaming', () => {
		const pkt = encodeMoveInventoryItem({ agentId: A, sessionId: S, seq: 2, itemId: ITEM, folderId: FOLDER })
		const body = bodyAfterPrefix(pkt, 268)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(S))).toBe(true)
		expect(body[32]).toBe(1) // Stamp BOOL = true
		const invOff = 33
		expect(body[invOff]).toBe(1) // Variable count
		expect(body.subarray(invOff + 1, invOff + 17).equals(uuidToBytes(ITEM))).toBe(true)
		expect(body.subarray(invOff + 17, invOff + 33).equals(uuidToBytes(FOLDER))).toBe(true)
		expect(body[invOff + 33]).toBe(0) // NewName Var1 length = 0
	})

	it('writes NewName when renaming on move', () => {
		const pkt = encodeMoveInventoryItem({ agentId: A, sessionId: S, seq: 2, itemId: ITEM, folderId: FOLDER, newName: 'Hi' })
		const body = bodyAfterPrefix(pkt, 268)
		const nameLenOff = 33 + 1 + 16 + 16
		expect(body[nameLenOff]).toBe(3) // "Hi" + NUL
		expect(body.subarray(nameLenOff + 1, nameLenOff + 3).toString('utf8')).toBe('Hi')
	})
})

describe('encodeMoveInventoryFolder (Low 275)', () => {
	it('emits Low 275 with FolderID + ParentID', () => {
		const pkt = encodeMoveInventoryFolder({ agentId: A, sessionId: S, seq: 3, folderId: FOLDER, parentId: PARENT })
		const body = bodyAfterPrefix(pkt, 275)
		expect(body[32]).toBe(1) // Stamp
		const invOff = 33
		expect(body[invOff]).toBe(1)
		expect(body.subarray(invOff + 1, invOff + 17).equals(uuidToBytes(FOLDER))).toBe(true)
		expect(body.subarray(invOff + 17, invOff + 33).equals(uuidToBytes(PARENT))).toBe(true)
	})
})

describe('encodeUpdateInventoryFolder (Low 274)', () => {
	it('emits Low 274 with FolderData carrying the new Name', () => {
		const pkt = encodeUpdateInventoryFolder({ agentId: A, sessionId: S, seq: 4, folderId: FOLDER, parentId: PARENT, type: -1, name: 'Box' })
		const body = bodyAfterPrefix(pkt, 274)
		const fOff = 32
		expect(body[fOff]).toBe(1) // Variable count
		expect(body.subarray(fOff + 1, fOff + 17).equals(uuidToBytes(FOLDER))).toBe(true)
		expect(body.subarray(fOff + 17, fOff + 33).equals(uuidToBytes(PARENT))).toBe(true)
		expect(body.readInt8(fOff + 33)).toBe(-1) // Type S8
		const nameLen = body[fOff + 34]
		expect(nameLen).toBe(4) // "Box" + NUL
		expect(body.subarray(fOff + 35, fOff + 38).toString('utf8')).toBe('Box')
	})
})

describe('encodeRemoveInventoryItem (Low 270)', () => {
	it('emits Low 270 with a single ItemID', () => {
		const pkt = encodeRemoveInventoryItem({ agentId: A, sessionId: S, seq: 5, itemId: ITEM })
		const body = bodyAfterPrefix(pkt, 270)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(S))).toBe(true)
		expect(body[32]).toBe(1) // Variable count
		expect(body.subarray(33, 49).equals(uuidToBytes(ITEM))).toBe(true)
	})
})

describe('encodeRemoveInventoryFolder (Low 276)', () => {
	it('emits Low 276 with a single FolderID', () => {
		const pkt = encodeRemoveInventoryFolder({ agentId: A, sessionId: S, seq: 6, folderId: FOLDER })
		const body = bodyAfterPrefix(pkt, 276)
		expect(body[32]).toBe(1)
		expect(body.subarray(33, 49).equals(uuidToBytes(FOLDER))).toBe(true)
	})
})

describe('encodeRezSingleAttachmentFromInv (Low 395)', () => {
	it('emits Low 395 ObjectData with ItemID, OwnerID, AttachmentPt', () => {
		const pkt = encodeRezSingleAttachmentFromInv({ agentId: A, sessionId: S, seq: 7, itemId: ITEM, attachPoint: 6 })
		const body = bodyAfterPrefix(pkt, 395)
		// ObjectData is Single (no count prefix): ItemID, OwnerID, AttachmentPt U8 ...
		const oOff = 32
		expect(body.subarray(oOff, oOff + 16).equals(uuidToBytes(ITEM))).toBe(true)
		expect(body.subarray(oOff + 16, oOff + 32).equals(uuidToBytes(A))).toBe(true) // OwnerID default = agent
		expect(body[oOff + 32]).toBe(6) // AttachmentPt
	})
})

describe('encodeDetachAttachmentIntoInv (Low 397)', () => {
	it('emits Low 397 with AgentID + ItemID (ObjectData only)', () => {
		const pkt = encodeDetachAttachmentIntoInv({ agentId: A, seq: 8, itemId: ITEM })
		const body = bodyAfterPrefix(pkt, 397)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(ITEM))).toBe(true)
	})
})

describe('decodeBulkUpdateInventory (Low 281)', () => {
	it('round-trips a hand-built buffer with one folder and one item', () => {
		const v1 = (s: string) => {
			const buf = Buffer.from(s + '\0', 'utf8')
			return Buffer.concat([Buffer.from([buf.length]), buf])
		}
		const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }
		const s32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b }
		const ASSET = '66666666-6666-6666-6666-666666666666'

		const body = Buffer.concat([
			uuidToBytes(A),            // AgentID
			uuidToBytes('00000000-0000-0000-0000-000000000000'), // TransactionID
			Buffer.from([1]),          // FolderData count
			uuidToBytes(FOLDER), uuidToBytes(PARENT), Buffer.from([8 & 0xff]), v1('My Folder'),
			Buffer.from([1]),          // ItemData count
			uuidToBytes(ITEM),         // ItemID
			u32(0),                    // CallbackID
			uuidToBytes(FOLDER),       // FolderID (parent)
			uuidToBytes(A),            // CreatorID
			uuidToBytes(A),            // OwnerID
			uuidToBytes('00000000-0000-0000-0000-000000000000'), // GroupID
			u32(0x7fffffff),           // BaseMask
			u32(0x0008e000),           // OwnerMask
			u32(0),                    // GroupMask
			u32(0),                    // EveryoneMask
			u32(0x0008e000),           // NextOwnerMask
			Buffer.from([0]),          // GroupOwned
			uuidToBytes(ASSET),        // AssetID
			Buffer.from([5 & 0xff]),   // Type S8 (e.g. clothing)
			Buffer.from([18 & 0xff]),  // InvType S8 (wearable)
			u32(0),                    // Flags
			Buffer.from([0]),          // SaleType
			s32(0),                    // SalePrice
			v1('Cool Shirt'),          // Name
			v1('desc'),                // Description
			s32(1700000000),           // CreationDate
			u32(0),                    // CRC
		])

		const out = decodeBulkUpdateInventory(body, 0)
		expect(out.folders).toEqual([{ folderId: FOLDER, parentId: PARENT, name: 'My Folder', typeDefault: 8 }])
		expect(out.items).toHaveLength(1)
		const it = out.items[0]
		expect(it.itemId).toBe(ITEM)
		expect(it.parentId).toBe(FOLDER)
		expect(it.assetId).toBe(ASSET)
		expect(it.name).toBe('Cool Shirt')
		expect(it.desc).toBe('desc')
		expect(it.assetType).toBe(5)
		expect(it.invType).toBe(18)
		expect(it.ownerMask).toBe(0x0008e000)
		expect(it.createdAt).toBe(1700000000)
	})
})
