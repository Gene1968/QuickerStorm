import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useInventoryStore } from './inventoryStore'

// Seed a minimal two-folder tree with a couple of items so the optimistic mutations have
// something to act on. Mirrors the real shapes: folders carry source:'agent'; items carry
// itemId/parentId/name + perm masks.
function seed() {
	const inv = useInventoryStore()
	inv.loadFromLogin({
		inventoryRoot: 'root',
		inventorySkeleton: [
			{ folderId: 'root',  parentId: '',     name: 'My Inventory', typeDefault: 8,  version: 1 },
			{ folderId: 'objs',  parentId: 'root', name: 'Objects',      typeDefault: 6,  version: 1 },
			{ folderId: 'trash', parentId: 'root', name: 'Trash',        typeDefault: 14, version: 1 },
		],
	})
	inv.setItems('objs', [
		{ itemId: 'i1', parentId: 'objs', name: 'Cube',  ownerMask: 0xE000 },
		{ itemId: 'i2', parentId: 'objs', name: 'Ball',  ownerMask: 0xE000 },
	])
	inv.setItems('trash', [])
	return inv
}

describe('inventoryStore optimistic mutations', () => {
	beforeEach(() => { setActivePinia(createPinia()) })

	it('renameItemLocal renames in place', () => {
		const inv = seed()
		inv.renameItemLocal('i1', 'Renamed')
		expect(inv.folderItems('objs').find(i => i.itemId === 'i1').name).toBe('Renamed')
	})

	it('renameItemLocal is a no-op for unknown item', () => {
		const inv = seed()
		inv.renameItemLocal('nope', 'X')
		expect(inv.folderItems('objs').length).toBe(2)
	})

	it('renameFolderLocal renames a folder', () => {
		const inv = seed()
		inv.renameFolderLocal('objs', 'Stuff')
		expect(inv.folders.get('objs').name).toBe('Stuff')
	})

	it('moveItemLocal moves between folders and updates parentId', () => {
		const inv = seed()
		inv.moveItemLocal('i1', 'trash')
		expect(inv.folderItems('objs').map(i => i.itemId)).toEqual(['i2'])
		const moved = inv.folderItems('trash').find(i => i.itemId === 'i1')
		expect(moved).toBeTruthy()
		expect(moved.parentId).toBe('trash')
	})

	it('moveItemLocal is a no-op when already in destination', () => {
		const inv = seed()
		inv.moveItemLocal('i1', 'objs')
		expect(inv.folderItems('objs').length).toBe(2)
	})

	it('moveFolderLocal reparents a folder', () => {
		const inv = seed()
		inv.moveFolderLocal('objs', 'trash')
		expect(inv.folders.get('objs').parentId).toBe('trash')
	})

	it('removeItemLocal drops the item', () => {
		const inv = seed()
		inv.removeItemLocal('i2')
		expect(inv.folderItems('objs').map(i => i.itemId)).toEqual(['i1'])
	})

	it('removeFolderLocal drops the folder and its items', () => {
		const inv = seed()
		inv.removeFolderLocal('objs')
		expect(inv.folders.has('objs')).toBe(false)
		expect(inv.folderItems('objs')).toEqual([])
	})

	it('updateItemPermsLocal recomputes canCopy/canModify/canTransfer from ownerMask', () => {
		const inv = seed()
		// ownerMask 0x8000 = copy only (no modify, no transfer)
		inv.updateItemPermsLocal('i1', { ownerMask: 0x8000, nextOwnerMask: 0x8000 })
		const it = inv.folderItems('objs').find(i => i.itemId === 'i1')
		expect(it.ownerMask).toBe(0x8000)
		expect(it.nextOwnerMask).toBe(0x8000)
		expect(it.canCopy).toBe(true)
		expect(it.canModify).toBe(false)
		expect(it.canTransfer).toBe(false)
	})

	it('updateItemPermsLocal full mask sets all three flags', () => {
		const inv = seed()
		inv.updateItemPermsLocal('i2', { ownerMask: 0xE000 })
		const it = inv.folderItems('objs').find(i => i.itemId === 'i2')
		expect(it.canCopy).toBe(true)
		expect(it.canModify).toBe(true)
		expect(it.canTransfer).toBe(true)
	})

	it('applyBulkUpdate upserts folders preserving source', () => {
		const inv = seed()
		inv.applyBulkUpdate({ folders: [{ folderId: 'objs', name: 'Objects2', parentId: 'root' }] })
		expect(inv.folders.get('objs').name).toBe('Objects2')
		expect(inv.folders.get('objs').source).toBe('agent')
	})

	it('applyBulkUpdate inserts a new folder with default agent source', () => {
		const inv = seed()
		inv.applyBulkUpdate({ folders: [{ folderId: 'new', name: 'New', parentId: 'root', typeDefault: -1 }] })
		expect(inv.folders.get('new').source).toBe('agent')
	})

	it('applyBulkUpdate migrates an item to its authoritative parent', () => {
		const inv = seed()
		// Sim says i1 now lives in trash.
		inv.applyBulkUpdate({ items: [{ itemId: 'i1', parentId: 'trash', name: 'Cube' }] })
		expect(inv.folderItems('objs').map(i => i.itemId)).toEqual(['i2'])
		expect(inv.folderItems('trash').map(i => i.itemId)).toEqual(['i1'])
	})

	it('applyBulkUpdate updates an item in place when parent unchanged', () => {
		const inv = seed()
		inv.applyBulkUpdate({ items: [{ itemId: 'i1', parentId: 'objs', name: 'Cube!' }] })
		expect(inv.folderItems('objs').length).toBe(2)
		expect(inv.folderItems('objs').find(i => i.itemId === 'i1').name).toBe('Cube!')
	})

	it('mutations do not throw on empty/missing input', () => {
		const inv = seed()
		expect(() => {
			inv.renameItemLocal('', 'x')
			inv.moveItemLocal('i1', '')
			inv.moveFolderLocal('', 'root')
			inv.removeItemLocal('zzz')
			inv.removeFolderLocal('zzz')
			inv.updateItemPermsLocal('zzz', { ownerMask: 0 })
			inv.applyBulkUpdate({})
			inv.applyBulkUpdate(undefined)
		}).not.toThrow()
	})
})
