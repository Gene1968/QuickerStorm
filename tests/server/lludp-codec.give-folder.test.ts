import { describe, it, expect } from 'vitest'
import { buildGiveFolderBucket, AT_FOLDER, uuidToBytes } from '../../server/lib/lludp-codec'

// Folder inventory-offer bucket (LLGiveInventory::commitGiveInventoryCategory): byte 0 = AT_FOLDER,
// bytes 1..16 = folder UUID, then [assetType][itemUUID] per DIRECT item (17-byte stride). OpenSim
// (InventoryTransferModule → GiveInventoryFolder) copies subfolders server-side, but gates the top
// folder's DIRECT items on the ids parsed from these entries, so they must be present.

const FOLDER = '44444444-4444-4444-4444-444444444444'
const ITEM_A = '55555555-5555-5555-5555-555555555555'
const ITEM_B = '66666666-6666-6666-6666-666666666666'

describe('buildGiveFolderBucket', () => {
	it('empty folder → 17-byte [AT_FOLDER][folderUUID] bucket', () => {
		const b = buildGiveFolderBucket(FOLDER, [])
		expect(b.length).toBe(17)
		expect(b[0]).toBe(AT_FOLDER)
		expect(b.subarray(1, 17)).toEqual(uuidToBytes(FOLDER))
	})

	it('direct items appended as [assetType][itemUUID], 17-byte stride, matching OpenSim %17==0', () => {
		const b = buildGiveFolderBucket(FOLDER, [
			{ itemId: ITEM_A, assetType: 6 },   // Object
			{ itemId: ITEM_B, assetType: 0 },   // Texture
		])
		expect(b.length).toBe(17 * 3)
		expect(b.length % 17).toBe(0)
		expect(b[0]).toBe(AT_FOLDER)
		expect(b.subarray(1, 17)).toEqual(uuidToBytes(FOLDER))
		// entry 1 (offset 17): Object item
		expect(b[17]).toBe(6)
		expect(b.subarray(18, 34)).toEqual(uuidToBytes(ITEM_A))
		// entry 2 (offset 34): Texture item
		expect(b[34]).toBe(0)
		expect(b.subarray(35, 51)).toEqual(uuidToBytes(ITEM_B))
	})

	it('skips entries with no itemId (defensive)', () => {
		const b = buildGiveFolderBucket(FOLDER, [{ itemId: '', assetType: 6 }])
		expect(b.length).toBe(17)
	})
})
