import { describe, it, expect } from 'vitest'
import {
	decodeBulkUpdateInventory,
	decodeBulkUpdateInventoryFromLLSD,
	decodeUpdateCreateInventoryItem,
	uuidToBytes,
} from '../../server/lib/lludp-codec'

// Regression coverage for the inventory PERMISSIONS decode bug: single received items showed
// NM/NC/NT despite correct perms because the decoders surfaced only ownerMask (and the caller
// derived badges from it). Assert all five masks are decoded on BOTH BulkUpdate paths (UDP +
// LLSD) and on the single-item UpdateCreateInventoryItem UDP path.

const A = '11111111-1111-1111-1111-111111111111'
const ITEM = '33333333-3333-3333-3333-333333333333'
const FOLDER = '44444444-4444-4444-4444-444444444444'
const ASSET = '66666666-6666-6666-6666-666666666666'
const ZERO = '00000000-0000-0000-0000-000000000000'

const BASE      = 0x7fffffff
const OWNER     = 0x0008e000 // MODIFY|COPY|TRANSFER (0x4000|0x8000|0x2000) + MOVE bits
const GROUP     = 0x00008000 // COPY only (group "Share")
const EVERYONE  = 0x00008000 // COPY only (anyone "Copy")
const NEXTOWNER = 0x00082000 // TRANSFER only for next owner (+ MOVE)

const v1 = (s: string) => {
	const buf = Buffer.from(s + '\0', 'utf8')
	return Buffer.concat([Buffer.from([buf.length]), buf])
}
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b }
const s32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b }

describe('decodeBulkUpdateInventory (Low 281) — all perm masks', () => {
	it('decodes base/owner/group/everyone/nextOwner masks from the ItemData block', () => {
		const body = Buffer.concat([
			uuidToBytes(A),                // AgentID
			uuidToBytes(ZERO),             // TransactionID
			Buffer.from([0]),              // FolderData count = 0
			Buffer.from([1]),              // ItemData count = 1
			uuidToBytes(ITEM),             // ItemID
			u32(0),                        // CallbackID
			uuidToBytes(FOLDER),           // FolderID (parent)
			uuidToBytes(A),                // CreatorID
			uuidToBytes(A),                // OwnerID
			uuidToBytes(ZERO),             // GroupID
			u32(BASE),                     // BaseMask
			u32(OWNER),                    // OwnerMask
			u32(GROUP),                    // GroupMask
			u32(EVERYONE),                 // EveryoneMask
			u32(NEXTOWNER),                // NextOwnerMask
			Buffer.from([0]),              // GroupOwned
			uuidToBytes(ASSET),            // AssetID
			Buffer.from([5 & 0xff]),       // Type S8
			Buffer.from([18 & 0xff]),      // InvType S8
			u32(0),                        // Flags
			Buffer.from([0]),              // SaleType
			s32(0),                        // SalePrice
			v1('Cool Shirt'),             // Name
			v1('desc'),                    // Description
			s32(1700000000),               // CreationDate
			u32(0),                        // CRC
		])

		const out = decodeBulkUpdateInventory(body, 0)
		expect(out.items).toHaveLength(1)
		const it = out.items[0]
		expect(it.baseMask).toBe(BASE)
		expect(it.ownerMask).toBe(OWNER)
		expect(it.groupMask).toBe(GROUP)
		expect(it.everyoneMask).toBe(EVERYONE)
		expect(it.nextOwnerMask).toBe(NEXTOWNER)
		// ownerMask carries all three current-owner perms → badges must read true.
		expect((it.ownerMask & 0x4000) !== 0).toBe(true) // MODIFY
		expect((it.ownerMask & 0x8000) !== 0).toBe(true) // COPY
		expect((it.ownerMask & 0x2000) !== 0).toBe(true) // TRANSFER
	})
})

describe('decodeUpdateCreateInventoryItem (Low 267) — single item, all perm masks', () => {
	it('decodes base/owner/group/everyone/nextOwner masks (single-item path)', () => {
		const body = Buffer.concat([
			uuidToBytes(A),                // AgentID
			Buffer.from([1]),              // SimApproved BOOL
			uuidToBytes(ZERO),             // TransactionID
			Buffer.from([1]),              // InventoryData count = 1
			uuidToBytes(ITEM),             // ItemID
			uuidToBytes(FOLDER),           // FolderID
			u32(0),                        // CallbackID
			uuidToBytes(A),                // CreatorID
			uuidToBytes(A),                // OwnerID
			uuidToBytes(ZERO),             // GroupID
			u32(BASE),                     // BaseMask
			u32(OWNER),                    // OwnerMask
			u32(GROUP),                    // GroupMask
			u32(EVERYONE),                 // EveryoneMask
			u32(NEXTOWNER),                // NextOwnerMask
			Buffer.from([0]),              // GroupOwned
			uuidToBytes(ASSET),            // AssetID
			Buffer.from([5 & 0xff]),       // Type S8
			Buffer.from([18 & 0xff]),      // InvType S8
			u32(0),                        // Flags
			Buffer.from([0]),              // SaleType
			s32(0),                        // SalePrice
			v1('Received Item'),          // Name
			v1('desc'),                    // Description
			s32(1700000000),               // CreationDate
			u32(0),                        // CRC
		])

		const items = decodeUpdateCreateInventoryItem(body, 0)
		expect(items).toHaveLength(1)
		const it = items[0]
		expect(it.itemId).toBe(ITEM)
		expect(it.parentId).toBe(FOLDER)
		expect(it.baseMask).toBe(BASE)
		expect(it.ownerMask).toBe(OWNER)
		expect(it.groupMask).toBe(GROUP)
		expect(it.everyoneMask).toBe(EVERYONE)
		expect(it.nextOwnerMask).toBe(NEXTOWNER)
	})
})

describe('decodeBulkUpdateInventoryFromLLSD — all perm masks', () => {
	it('surfaces base/owner/group/everyone/nextOwner from the LLSD ItemData', () => {
		const out = decodeBulkUpdateInventoryFromLLSD({
			AgentData: [{ AgentID: A, TransactionID: ZERO }],
			FolderData: [],
			ItemData: [{
				ItemID: ITEM,
				FolderID: FOLDER,
				CreatorID: A,
				OwnerID: A,
				GroupID: ZERO,
				BaseMask: BASE,
				OwnerMask: OWNER,
				GroupMask: GROUP,
				EveryoneMask: EVERYONE,
				NextOwnerMask: NEXTOWNER,
				AssetID: ASSET,
				Type: 5,
				InvType: 18,
				Flags: 0,
				Name: 'Cool Shirt',
				Description: 'desc',
				CreationDate: 1700000000,
			}],
		})
		expect(out.items).toHaveLength(1)
		const it = out.items[0]
		expect(it.baseMask).toBe(BASE)
		expect(it.ownerMask).toBe(OWNER)
		expect(it.groupMask).toBe(GROUP)
		expect(it.everyoneMask).toBe(EVERYONE)
		expect(it.nextOwnerMask).toBe(NEXTOWNER)
	})
})
