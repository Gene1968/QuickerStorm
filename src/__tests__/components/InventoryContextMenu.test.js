// Tests for InventoryContextMenu — the global right-click menu. Focus: multi-selection actions
// operate on the WHOLE selection (Firestorm behavior). Right-clicking within a multi-selection
// deletes/copies-UUID for every selected row; Rename stays single-target (hidden when >1); labels
// show counts. Single-selection behavior is unchanged. We mock useInventory to spy on the
// server-side mutators and use a real Pinia store for the contextMenu + targets state.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// Spy on the write mutators used in the action loop.
const trashItem      = vi.fn()
const trashFolder    = vi.fn()
const createFolder   = vi.fn()
const createFolderFromSelected = vi.fn()
const emptyTrash     = vi.fn()
const wearAttachment = vi.fn()
const detach         = vi.fn()
const isItemWorn     = vi.fn(() => false)
const purgeItem      = vi.fn()
const purgeFolder    = vi.fn()
const restoreItem    = vi.fn()
const restoreFolder  = vi.fn()
vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({
		createFolder, createFolderFromSelected, trashItem, trashFolder, emptyTrash,
		wearAttachment, detach, isItemWorn,
		purgeItem, purgeFolder, restoreItem, restoreFolder,
	}),
}))
// Silence the tick sound on click.
vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn() }))

import InventoryContextMenu from '@/components/InventoryContextMenu.vue'
import { useInventoryStore } from '@/stores/inventoryStore'

let inv, writeText

// Populate the store so resolveTarget can find rows, then open the context menu with targets.
function seed() {
	inv = useInventoryStore()
	// Two user items in folder-A, one user folder + one system folder under root.
	inv.folders.set('root',    { folderId: 'root',    parentId: '',    name: 'Inventory', typeDefault: 8,  source: 'agent' })
	inv.folders.set('folderU', { folderId: 'folderU', parentId: 'root', name: 'My Folder', typeDefault: -1, source: 'agent' })
	inv.folders.set('folderS', { folderId: 'folderS', parentId: 'root', name: 'Objects',  typeDefault: 6,  source: 'agent' })
	inv.setItems('folder-A', [
		{ itemId: 'item-1', parentId: 'folder-A', name: 'Hat',   assetType: 6, invType: 6, assetId: 'asset-1' },
		{ itemId: 'item-2', parentId: 'folder-A', name: 'Boots', assetType: 6, invType: 6, assetId: 'asset-2' },
	])
}

function labels(w) {
	return w.findAll('button').map(b => b.text())
}
function clickLabel(w, text) {
	const btn = w.findAll('button').find(b => b.text() === text)
	return btn.trigger('click')
}

beforeEach(() => {
	setActivePinia(createPinia())
	trashItem.mockClear(); trashFolder.mockClear()
	createFolder.mockClear(); createFolderFromSelected.mockClear(); emptyTrash.mockClear()
	wearAttachment.mockClear(); detach.mockClear()
	purgeItem.mockClear(); purgeFolder.mockClear(); restoreItem.mockClear(); restoreFolder.mockClear()
	isItemWorn.mockReset(); isItemWorn.mockReturnValue(false)
	writeText = vi.fn().mockResolvedValue(undefined)
	// jsdom has no clipboard by default.
	Object.assign(navigator, { clipboard: { writeText } })
	seed()
})

describe('InventoryContextMenu — single selection (unchanged behavior)', () => {
	it('Delete on one item trashes just that item, label is plain "Delete"', async () => {
		const item = inv.folderItems('folder-A')[0]
		inv.openContextMenu(10, 10, 'item', item)   // no targets → single
		const w = mount(InventoryContextMenu)
		expect(labels(w)).toContain('Delete')
		await clickLabel(w, 'Delete')
		expect(trashItem).toHaveBeenCalledTimes(1)
		expect(trashItem).toHaveBeenCalledWith('item-1')
	})

	it('Rename is present for a single item', () => {
		const item = inv.folderItems('folder-A')[0]
		inv.openContextMenu(10, 10, 'item', item)
		const w = mount(InventoryContextMenu)
		expect(labels(w)).toContain('Rename')
	})
})

describe('InventoryContextMenu — multi selection (item-anchored)', () => {
	function openMulti() {
		const [a, b] = inv.folderItems('folder-A')
		inv.openContextMenu(10, 10, 'item', a, [
			{ kind: 'item', obj: a },
			{ kind: 'item', obj: b },
		])
		return mount(InventoryContextMenu)
	}

	it('Delete trashes EVERY selected item and labels with the count', async () => {
		const w = openMulti()
		expect(labels(w)).toContain('Delete 2 items')
		await clickLabel(w, 'Delete 2 items')
		expect(trashItem).toHaveBeenCalledTimes(2)
		expect(trashItem.mock.calls.map(c => c[0])).toEqual(['item-1', 'item-2'])
	})

	it('Rename is hidden in a multi-selection', () => {
		const w = openMulti()
		expect(labels(w)).not.toContain('Rename')
	})

	it('Copy item UUIDs copies newline-joined ids of the whole selection', async () => {
		const w = openMulti()
		await clickLabel(w, 'Copy item UUIDs')
		expect(writeText).toHaveBeenCalledWith('item-1\nitem-2')
	})
})

describe('InventoryContextMenu — multi selection (folder-anchored, mixed + system guard)', () => {
	it('deletes items + user folders but SKIPS system folders', async () => {
		const item = inv.folderItems('folder-A')[0]
		const fU   = inv.folders.get('folderU')
		const fS   = inv.folders.get('folderS')
		// Folder-anchored menu (anchor is the user folder) with an item + a system folder in the set.
		inv.openContextMenu(10, 10, 'folder', fU, [
			{ kind: 'folder', obj: fU },
			{ kind: 'item',   obj: item },
			{ kind: 'folder', obj: fS },
		])
		const w = mount(InventoryContextMenu)
		// One item + one deletable folder (system folder excluded from the count).
		expect(labels(w)).toContain('Delete 1 item, 1 folder')
		await clickLabel(w, 'Delete 1 item, 1 folder')
		expect(trashItem).toHaveBeenCalledWith('item-1')
		expect(trashFolder).toHaveBeenCalledTimes(1)
		expect(trashFolder).toHaveBeenCalledWith('folderU')   // system folder folderS skipped
	})
})

// ── Create folder from selected (FS llinventorybridge.cpp:912 "New folder from selected") ──
describe('InventoryContextMenu — Create folder from selected', () => {
	it('acts on the whole item selection', async () => {
		const [a, b] = inv.folderItems('folder-A')
		inv.openContextMenu(10, 10, 'item', a, [
			{ kind: 'item', obj: a },
			{ kind: 'item', obj: b },
		])
		const w = mount(InventoryContextMenu)
		await clickLabel(w, 'Create folder from selected')
		expect(createFolderFromSelected).toHaveBeenCalledTimes(1)
		expect(createFolderFromSelected).toHaveBeenCalledWith(['item-1', 'item-2'])
	})

	it('is disabled for a MIXED item+folder selection (FS is_only_items/is_only_cats gate)', () => {
		const item = inv.folderItems('folder-A')[0]
		const fU   = inv.folders.get('folderU')
		inv.openContextMenu(10, 10, 'item', item, [
			{ kind: 'item',   obj: item },
			{ kind: 'folder', obj: fU },
		])
		const w = mount(InventoryContextMenu)
		const btn = w.findAll('button').find(b => b.text() === 'Create folder from selected')
		expect(btn.attributes('disabled')).toBeDefined()
	})

	it('is disabled when a SYSTEM folder is selected', () => {
		const fS = inv.folders.get('folderS')
		inv.openContextMenu(10, 10, 'folder', fS)   // single-select the Objects system folder
		const w = mount(InventoryContextMenu)
		const btn = w.findAll('button').find(b => b.text() === 'Create folder from selected')
		expect(btn.attributes('disabled')).toBeDefined()
	})

	it('is enabled + wired on a folder-anchored all-folders selection', async () => {
		const fU = inv.folders.get('folderU')
		inv.openContextMenu(10, 10, 'folder', fU)
		const w = mount(InventoryContextMenu)
		await clickLabel(w, 'Create folder from selected')
		expect(createFolderFromSelected).toHaveBeenCalledWith(['folderU'])
	})
})

// ── Trash system folder → FS short menu (llinventorybridge.cpp:5049-5075) ──
describe('InventoryContextMenu — Trash folder menu', () => {
	function seedTrash({ withItem = true } = {}) {
		inv.folders.set('trash', { folderId: 'trash', parentId: 'root', name: 'Trash', typeDefault: 14, source: 'agent' })
		if (withItem) inv.setItems('trash', [{ itemId: 'dead-1', parentId: 'trash', name: 'Old Hat', assetType: 6 }])
		inv.openContextMenu(10, 10, 'folder', inv.folders.get('trash'))
		return mount(InventoryContextMenu)
	}

	it('shows the SHORT menu: Empty Trash + Expand + Properties, and NO Delete/Cut/Rename/New folder', () => {
		const w = seedTrash()
		const l = labels(w)
		expect(l).toContain('Empty Trash')
		expect(l).toContain('Expand')
		expect(l).toContain('Properties…')
		expect(l).not.toContain('Delete')
		expect(l).not.toContain('Cut')
		expect(l).not.toContain('Rename')
		expect(l).not.toContain('New folder')
		expect(l).not.toContain('Create folder from selected')
	})

	it('Empty Trash confirms (FS ConfirmEmptyTrash) then purges', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
		const w = seedTrash()
		await clickLabel(w, 'Empty Trash')
		expect(confirmSpy).toHaveBeenCalledTimes(1)
		expect(confirmSpy.mock.calls[0][0]).toMatch(/^1 items and folders will be permanently deleted/)
		expect(emptyTrash).toHaveBeenCalledTimes(1)
		confirmSpy.mockRestore()
	})

	it('cancelling the confirm does NOT purge', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
		const w = seedTrash()
		await clickLabel(w, 'Empty Trash')
		expect(emptyTrash).not.toHaveBeenCalled()
		confirmSpy.mockRestore()
	})

	it('Empty Trash is disabled when the Trash is empty (FS :5058)', () => {
		const w = seedTrash({ withItem: false })
		const btn = w.findAll('button').find(b => b.text() === 'Empty Trash')
		expect(btn.attributes('disabled')).toBeDefined()
	})

	it('Empty Trash is disabled while a WORN attachment sits in the Trash (FS hasAttachmentsInTrash)', () => {
		isItemWorn.mockImplementation(id => id === 'dead-1')
		const w = seedTrash()
		const btn = w.findAll('button').find(b => b.text() === 'Empty Trash')
		expect(btn.attributes('disabled')).toBeDefined()
	})
})

// ── Worn attachment → Detach (FS llinventorybridge.cpp:8245-8272 + get_is_item_worn) ──
describe('InventoryContextMenu — worn object shows Detach, not Wear', () => {
	it('non-worn object item shows Wear / attach + Rez in world, no Detach', () => {
		const item = inv.folderItems('folder-A')[0]
		inv.openContextMenu(10, 10, 'item', item)
		const w = mount(InventoryContextMenu)
		const l = labels(w)
		expect(l).toContain('Wear / attach')
		expect(l).toContain('Rez in world')
		expect(l).not.toContain('Detach from yourself')
	})

	it('WORN object item shows Detach from yourself instead of Wear/Rez', () => {
		isItemWorn.mockImplementation(id => id === 'item-1')
		const item = inv.folderItems('folder-A')[0]
		inv.openContextMenu(10, 10, 'item', item)
		const w = mount(InventoryContextMenu)
		const l = labels(w)
		expect(l).toContain('Detach from yourself')
		expect(l).not.toContain('Wear / attach')
		expect(l).not.toContain('Rez in world')
	})

	it('Detach from yourself calls detach(itemId)', async () => {
		isItemWorn.mockReturnValue(true)
		const item = inv.folderItems('folder-A')[0]
		inv.openContextMenu(10, 10, 'item', item)
		const w = mount(InventoryContextMenu)
		await clickLabel(w, 'Detach from yourself')
		expect(detach).toHaveBeenCalledWith('item-1')
	})
})

// ── Rows INSIDE Trash → FS trash menu (llinventorybridge.cpp:1151-1169 addTrashContextMenuOptions) ──
describe('InventoryContextMenu — rows inside Trash get Purge/Restore', () => {
	function seedTrashRows() {
		inv.folders.set('trash',   { folderId: 'trash',   parentId: 'root',  name: 'Trash',   typeDefault: 14, source: 'agent' })
		inv.folders.set('deadDir', { folderId: 'deadDir', parentId: 'trash', name: 'Old Box', typeDefault: -1, source: 'agent' })
		inv.setItems('trash', [{ itemId: 'dead-1', parentId: 'trash', name: 'Old Hat', assetType: 6 }])
	}

	it('item in Trash shows ONLY Purge Item + Restore Item (no Delete/Wear/Rename)', () => {
		seedTrashRows()
		inv.openContextMenu(10, 10, 'item', inv.folderItems('trash')[0])
		const w = mount(InventoryContextMenu)
		const l = labels(w)
		expect(l).toContain('Purge Item')
		expect(l).toContain('Restore Item')
		expect(l).not.toContain('Delete')
		expect(l).not.toContain('Wear / attach')
		expect(l).not.toContain('Rename')
	})

	it('Purge Item confirms then purges the item', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
		seedTrashRows()
		inv.openContextMenu(10, 10, 'item', inv.folderItems('trash')[0])
		const w = mount(InventoryContextMenu)
		await clickLabel(w, 'Purge Item')
		expect(purgeItem).toHaveBeenCalledWith('dead-1')
		confirmSpy.mockRestore()
	})

	it('cancelling the confirm purges nothing', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
		seedTrashRows()
		inv.openContextMenu(10, 10, 'item', inv.folderItems('trash')[0])
		const w = mount(InventoryContextMenu)
		await clickLabel(w, 'Purge Item')
		expect(purgeItem).not.toHaveBeenCalled()
		confirmSpy.mockRestore()
	})

	it('Restore Item restores the item (no confirm)', async () => {
		seedTrashRows()
		inv.openContextMenu(10, 10, 'item', inv.folderItems('trash')[0])
		const w = mount(InventoryContextMenu)
		await clickLabel(w, 'Restore Item')
		expect(restoreItem).toHaveBeenCalledWith('dead-1')
	})

	it('folder in Trash purges via purgeFolder and restores via restoreFolder', async () => {
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
		seedTrashRows()
		inv.openContextMenu(10, 10, 'folder', inv.folders.get('deadDir'))
		let w = mount(InventoryContextMenu)
		await clickLabel(w, 'Purge Item')
		expect(purgeFolder).toHaveBeenCalledWith('deadDir')
		inv.openContextMenu(10, 10, 'folder', inv.folders.get('deadDir'))
		w = mount(InventoryContextMenu)
		await clickLabel(w, 'Restore Item')
		expect(restoreFolder).toHaveBeenCalledWith('deadDir')
		confirmSpy.mockRestore()
	})

	it('Purge is disabled for a WORN item in Trash (FS isItemRemovable gate)', () => {
		isItemWorn.mockImplementation(id => id === 'dead-1')
		seedTrashRows()
		inv.openContextMenu(10, 10, 'item', inv.folderItems('trash')[0])
		const w = mount(InventoryContextMenu)
		const btn = w.findAll('button').find(b => b.text() === 'Purge Item')
		expect(btn.attributes('disabled')).toBeDefined()
	})

	it('the Trash ROOT itself still shows Empty Trash, not Purge/Restore', () => {
		seedTrashRows()
		inv.openContextMenu(10, 10, 'folder', inv.folders.get('trash'))
		const w = mount(InventoryContextMenu)
		const l = labels(w)
		expect(l).toContain('Empty Trash')
		expect(l).not.toContain('Purge Item')
	})
})
