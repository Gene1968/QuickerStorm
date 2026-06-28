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

	it('setDrag normalizes a single id to { id, ids, count } (back-compat)', () => {
		const inv = seed()
		inv.setDrag('i1', 'item')
		expect(inv.dragPayload).toEqual({ id: 'i1', ids: ['i1'], kind: 'item', count: 1 })
	})

	it('setDrag accepts an array of ids for a multi-select drag', () => {
		const inv = seed()
		inv.setDrag(['i1', 'i2'], 'item')
		expect(inv.dragPayload.id).toBe('i1')          // anchor stays the first id
		expect(inv.dragPayload.ids).toEqual(['i1', 'i2'])
		expect(inv.dragPayload.count).toBe(2)
	})

	it('setDrag with empty/falsy input clears the payload', () => {
		const inv = seed()
		inv.setDrag([], 'item')
		expect(inv.dragPayload).toBe(null)
		inv.setDrag('', 'item')
		expect(inv.dragPayload).toBe(null)
	})

	it('a multi-id drag payload moves every selected item to the destination', () => {
		const inv = seed()
		// Simulate the drag-start: every selected item id is staged on the shared payload.
		inv.setDrag(['i1', 'i2'], 'item')
		// onDropFolder iterates payload.ids and moves each one.
		for (const id of inv.dragPayload.ids) inv.moveItemLocal(id, 'trash')
		expect(inv.folderItems('objs')).toEqual([])
		expect(inv.folderItems('trash').map(i => i.itemId).sort()).toEqual(['i1', 'i2'])
		expect(inv.folderItems('trash').every(i => i.parentId === 'trash')).toBe(true)
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

describe('per-floater expand state (multi-window isolation)', () => {
	beforeEach(() => { setActivePinia(createPinia()) })

	it('expand/collapse in one window does not affect another', () => {
		const inv = seed()
		inv.ensureExpand('inventory-0')
		inv.ensureExpand('inventory-1')
		// Both seed with the root auto-expanded.
		expect(inv.isExpanded('inventory-0', 'root')).toBe(true)
		expect(inv.isExpanded('inventory-1', 'root')).toBe(true)
		// Expand Objects only in window 0.
		inv.toggle('inventory-0', 'objs')
		expect(inv.isExpanded('inventory-0', 'objs')).toBe(true)
		expect(inv.isExpanded('inventory-1', 'objs')).toBe(false)   // window 1 unaffected
		// Collapse Trash in window 1 (seeded only with root, so toggling adds then this adds it)…
		inv.toggle('inventory-1', 'trash')
		expect(inv.isExpanded('inventory-1', 'trash')).toBe(true)
		expect(inv.isExpanded('inventory-0', 'trash')).toBe(false)  // window 0 unaffected
	})

	it('collapseAll / expandAll are scoped per window', () => {
		const inv = seed()
		inv.ensureExpand('inventory-0')
		inv.ensureExpand('inventory-1')
		inv.expandAll('inventory-0')
		expect(inv.isExpanded('inventory-0', 'objs')).toBe(true)
		expect(inv.isExpanded('inventory-0', 'trash')).toBe(true)
		expect(inv.isExpanded('inventory-1', 'objs')).toBe(false)   // other window untouched
		inv.collapseAll('inventory-0')
		expect(inv.isExpanded('inventory-0', 'objs')).toBe(false)
		expect(inv.isExpanded('inventory-0', 'root')).toBe(true)    // collapseAll keeps root
	})

	it('expandedUnion gathers every window plus root; dropExpand removes a window', () => {
		const inv = seed()
		inv.ensureExpand('inventory-0')
		inv.ensureExpand('inventory-1')
		inv.toggle('inventory-0', 'objs')
		inv.toggle('inventory-1', 'trash')
		const union = inv.expandedUnion()
		expect(union.has('root')).toBe(true)
		expect(union.has('objs')).toBe(true)
		expect(union.has('trash')).toBe(true)
		inv.dropExpand('inventory-0')
		expect(inv.isExpanded('inventory-0', 'objs')).toBe(false)   // its set is gone
		expect(inv.isExpanded('inventory-1', 'trash')).toBe(true)   // sibling survives
	})

	it('filter-collapse overlay is per-window and clears independently of the expand set', () => {
		const inv = seed()
		// During a filter, a folder is open by DEFAULT (not in the overlay), and a click collapses it.
		expect(inv.isFilterCollapsed('inventory-0', 'objs')).toBe(false)
		inv.toggleFilterCollapse('inventory-0', 'objs')
		expect(inv.isFilterCollapsed('inventory-0', 'objs')).toBe(true)
		expect(inv.isFilterCollapsed('inventory-1', 'objs')).toBe(false)   // sibling window unaffected
		// The overlay must NOT touch the normal expand set.
		inv.ensureExpand('inventory-0')
		expect(inv.isExpanded('inventory-0', 'objs')).toBe(false)          // never added to expand set
		// Clearing the overlay (filter cleared) re-reveals.
		inv.clearFilterCollapse('inventory-0')
		expect(inv.isFilterCollapsed('inventory-0', 'objs')).toBe(false)
	})
})
