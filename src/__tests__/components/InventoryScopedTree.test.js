// Tests for InventoryScopedTree — the Recent/Worn TREE tabs (FS renders these as filtered
// inventory panels: panel_main_inventory.xml "Recent Items" <inventory_panel>). Only folders
// whose descendants hold in-scope items render; in-scope items show, out-of-scope items don't,
// and branches auto-open (filtersActive pinned true → the search auto-reveal path).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({
		fetchFolder: vi.fn(), renameItem: vi.fn(), renameFolder: vi.fn(),
		trashItem: vi.fn(), trashFolder: vi.fn(), moveItem: vi.fn(), moveFolder: vi.fn(),
		openInventoryItem: vi.fn(),
	}),
}))
vi.mock('@/composables/useInventoryThumbnail', () => ({
	useInventoryThumbnail: () => ({ thumbnailFor: () => ref(null) }),
}))

import InventoryScopedTree from '@/components/InventoryScopedTree.vue'
import { useInventoryStore } from '@/stores/inventoryStore'

let inv

function seed() {
	inv = useInventoryStore()
	inv.rootId = 'root'
	inv.folders.set('root',    { folderId: 'root',    parentId: '',     name: 'My Inventory', typeDefault: 8,  source: 'agent' })
	inv.folders.set('folderA', { folderId: 'folderA', parentId: 'root', name: 'Alpha',        typeDefault: -1, source: 'agent' })
	inv.folders.set('folderB', { folderId: 'folderB', parentId: 'root', name: 'Bravo',        typeDefault: -1, source: 'agent' })
	inv.setItems('folderA', [
		{ itemId: 'in-scope',  parentId: 'folderA', name: 'Fresh Hat', assetType: 6, invType: 6, createdAt: 2 },
		{ itemId: 'off-scope', parentId: 'folderA', name: 'Old Sock',  assetType: 6, invType: 6, createdAt: 1 },
	])
	inv.setItems('folderB', [
		{ itemId: 'also-off', parentId: 'folderB', name: 'Dusty Box', assetType: 6, invType: 6, createdAt: 1 },
	])
}

function make(itemIds) {
	return mount(InventoryScopedTree, {
		props: { itemIds },
		global: {
			provide: {
				invSelection: {
					selectedIds: ref(new Set()), anchorId: ref(null),
					isSelected: () => false, clearSelection: vi.fn(), selectionSelect: vi.fn(),
				},
				invSelectionFlat: vi.fn(),
			},
		},
	})
}

beforeEach(() => {
	setActivePinia(createPinia())
	seed()
})

describe('InventoryScopedTree', () => {
	it('renders only folders holding in-scope items, auto-opened, with in-scope rows visible', () => {
		const w = make(new Set(['in-scope']))
		const text = w.text()
		expect(text).toContain('Alpha')       // folder with the scoped item
		expect(text).toContain('Fresh Hat')   // the scoped item row (branch auto-opens)
		expect(text).not.toContain('Bravo')   // no in-scope descendants → hidden
		expect(text).not.toContain('Old Sock')// sibling item out of scope → hidden
	})

	it('renders nothing below the root when the scope set is empty', () => {
		const w = make(new Set())
		expect(w.text()).not.toContain('Alpha')
		expect(w.text()).not.toContain('Bravo')
	})

	it('reacts to a scope change (new Set identity)', async () => {
		const w = make(new Set(['in-scope']))
		await w.setProps({ itemIds: new Set(['also-off']) })
		expect(w.text()).toContain('Bravo')
		expect(w.text()).toContain('Dusty Box')
		expect(w.text()).not.toContain('Fresh Hat')
	})
})
