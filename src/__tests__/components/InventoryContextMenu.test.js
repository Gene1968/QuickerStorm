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
const wearAttachment = vi.fn()
const detach         = vi.fn()
vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({ createFolder, trashItem, trashFolder, wearAttachment, detach }),
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
	createFolder.mockClear(); wearAttachment.mockClear(); detach.mockClear()
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
