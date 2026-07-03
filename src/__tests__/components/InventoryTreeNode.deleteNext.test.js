// Tests for InventoryTreeNode keyboard-delete selection: after Del, the NEXT sibling row in the
// same folder is selected (fallback: previous sibling, then the parent folder) — FS
// LLFolderView::removeSelectedItems → getNextUnselectedItem (llfolderview.cpp:775-846, 2227-2244).
// Also verifies the commit-0283c6a guard: Del on a row already in Trash is a FULL no-op — no
// trash call AND no selection change.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const trashItem   = vi.fn()
const trashFolder = vi.fn()
vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({
		fetchFolder: vi.fn(), renameItem: vi.fn(), renameFolder: vi.fn(),
		trashItem, trashFolder, moveItem: vi.fn(), moveFolder: vi.fn(), openInventoryItem: vi.fn(),
	}),
}))
vi.mock('@/composables/useInventoryThumbnail', () => ({
	useInventoryThumbnail: () => ({ thumbnailFor: () => ref(null) }),
}))

import InventoryTreeNode from '@/components/InventoryTreeNode.vue'
import { useInventoryStore } from '@/stores/inventoryStore'

let inv
const FID = '__inv_default__'   // TreeNode's fallback floater id when mounted standalone

const selectionSelect = vi.fn()

function seed() {
	inv = useInventoryStore()
	inv.rootId = 'root'
	inv.folders.set('root',    { folderId: 'root',    parentId: '',     name: 'My Inventory', typeDefault: 8,  source: 'agent' })
	inv.folders.set('folderA', { folderId: 'folderA', parentId: 'root', name: 'Alpha',        typeDefault: -1, source: 'agent' })
	// Two empty user subfolders inside folderA (sorted by name: Beta, Gamma), then three items.
	inv.folders.set('folderB', { folderId: 'folderB', parentId: 'folderA', name: 'Beta',  typeDefault: -1, source: 'agent' })
	inv.folders.set('folderC', { folderId: 'folderC', parentId: 'folderA', name: 'Gamma', typeDefault: -1, source: 'agent' })
	// Trash system folder (type 14) with one item, for the no-op guard.
	inv.folders.set('trash', { folderId: 'trash', parentId: 'root', name: 'Trash', typeDefault: 14, source: 'agent' })
	// createdAt descending → default 'date' sort renders i1, i2, i3.
	inv.setItems('folderA', [
		{ itemId: 'i1', parentId: 'folderA', name: 'One',   assetType: 6, invType: 6, createdAt: 3 },
		{ itemId: 'i2', parentId: 'folderA', name: 'Two',   assetType: 6, invType: 6, createdAt: 2 },
		{ itemId: 'i3', parentId: 'folderA', name: 'Three', assetType: 6, invType: 6, createdAt: 1 },
	])
	inv.setItems('trash', [
		{ itemId: 'binned', parentId: 'trash', name: 'Binned', assetType: 6, invType: 6, createdAt: 1 },
	])
	// Expand folderA (and trash) in the standalone expand set so item rows render.
	inv.ensureExpand(FID)
	inv.toggle(FID, 'folderA')
	inv.toggle(FID, 'trash')
}

function make(folderId) {
	return mount(InventoryTreeNode, {
		props: { folderId },
		global: {
			provide: {
				invFilter: {
					filtering: ref(false), filtersActive: ref(false), typeFilter: ref('all'),
					folderHasMatch: () => true, itemVisible: () => true,
					folderNameMatches: () => false, nameMatches: () => true,
				},
				invSelection: {
					selectedIds: ref(new Set()), anchorId: ref(null),
					isSelected: () => false, clearSelection: vi.fn(), selectionSelect,
				},
				invSelectionFlat: vi.fn(),
			},
		},
	})
}

async function pressDelete(w, invId) {
	const row = w.find(`[data-inv-id="${invId}"]`)
	expect(row.exists()).toBe(true)
	await row.trigger('keydown', { key: 'Delete' })
}

beforeEach(async () => {
	setActivePinia(createPinia())
	trashItem.mockClear(); trashFolder.mockClear(); selectionSelect.mockClear()
	seed()
	await Promise.resolve()   // flush the store's batched trigger
})

describe('InventoryTreeNode — Del selects the next row (FS removeSelectedItems)', () => {
	it('deleting an item selects the NEXT sibling item in the same folder', async () => {
		const w = make('folderA')
		await pressDelete(w, 'i1')
		expect(trashItem).toHaveBeenCalledWith('i1')
		expect(selectionSelect).toHaveBeenCalledWith('i2', {})
	})

	it('deleting the LAST item falls back to the PREVIOUS sibling', async () => {
		const w = make('folderA')
		await pressDelete(w, 'i3')
		expect(trashItem).toHaveBeenCalledWith('i3')
		expect(selectionSelect).toHaveBeenCalledWith('i2', {})
	})

	it('deleting the only row falls back to the parent folder', async () => {
		inv.setItems('folderA', [{ itemId: 'solo', parentId: 'folderA', name: 'Solo', assetType: 6, invType: 6, createdAt: 1 }])
		// remove the sibling subfolders so `solo` is the only row
		inv.folders.delete('folderB'); inv.folders.delete('folderC')
		await Promise.resolve()
		const w = make('folderA')
		await pressDelete(w, 'solo')
		expect(trashItem).toHaveBeenCalledWith('solo')
		expect(selectionSelect).toHaveBeenCalledWith('folderA', {})
	})

	it('deleting a folder selects its next sibling row (folder rows precede item rows)', async () => {
		const w = make('folderA')
		await pressDelete(w, 'folderB')
		expect(trashFolder).toHaveBeenCalledWith('folderB')
		expect(selectionSelect).toHaveBeenCalledWith('folderC', {})
	})

	it('deleting the last subfolder selects the next ROW — the first item after the folder block', async () => {
		const w = make('folderA')
		await pressDelete(w, 'folderC')
		expect(trashFolder).toHaveBeenCalledWith('folderC')
		expect(selectionSelect).toHaveBeenCalledWith('i1', {})
	})

	it('Del on an item already in Trash is a FULL no-op (0283c6a guard preserved)', async () => {
		const w = make('trash')
		await pressDelete(w, 'binned')
		expect(trashItem).not.toHaveBeenCalled()
		expect(selectionSelect).not.toHaveBeenCalled()
	})

	it('system folders still refuse Del (no trash call, no selection change)', async () => {
		const w = make('root')
		await pressDelete(w, 'root')
		expect(trashFolder).not.toHaveBeenCalled()
		expect(selectionSelect).not.toHaveBeenCalled()
	})
})
