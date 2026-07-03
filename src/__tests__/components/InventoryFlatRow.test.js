// Tests for InventoryFlatRow — the flat Recent/Worn/Favorites tab row. Covers Gap C: the
// flat-tab rows must carry the same row interactions as the main tree (InventoryTreeNode):
// right-click → context menu, F2 / context-menu Rename → inline rename → renameItem, and
// double-click → OPEN the item (openInventoryItem; rename stays on F2 + context menu). We mock
// useInventory so the rename/move/open wiring is asserted without
// a live circuit, and use a real Pinia store for openContextMenu state.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

// Mock the composable so we can spy on the server-side write calls.
const renameItem        = vi.fn()
const moveItem          = vi.fn()
const openInventoryItem = vi.fn()
vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({ renameItem, moveItem, openInventoryItem }),
}))

import InventoryFlatRow from '@/components/InventoryFlatRow.vue'
import { useInventoryStore } from '@/stores/inventoryStore'

const ITEM = {
	itemId: 'item-1',
	parentId: 'folder-A',
	name: 'Hat',
	assetType: 6,
	invType: 6,
}

let selectedIds, anchorId, selectFlat, openContextMenu

function mountRow(item = ITEM) {
	selectedIds = ref(new Set())
	anchorId    = ref(null)
	selectFlat  = vi.fn((id) => { selectedIds.value = new Set([id]); anchorId.value = id })
	const invSel = {
		selectedIds,
		anchorId,
		isSelected: (id) => selectedIds.value.has(id),
		clearSelection: () => { selectedIds.value = new Set() },
		selectionSelect: vi.fn(),
	}
	return mount(InventoryFlatRow, {
		props: { item, order: [item.itemId] },
		global: {
			provide: {
				invSelection: invSel,
				invSelectionFlat: selectFlat,
			},
		},
	})
}

beforeEach(() => {
	setActivePinia(createPinia())
	renameItem.mockClear()
	moveItem.mockClear()
	openInventoryItem.mockClear()
	const inv = useInventoryStore()
	openContextMenu = vi.spyOn(inv, 'openContextMenu')
})

describe('InventoryFlatRow — context menu', () => {
	it('right-click opens the inventory context menu for this item', async () => {
		const w = mountRow()
		await w.find('div').trigger('contextmenu', { clientX: 120, clientY: 80 })
		expect(openContextMenu).toHaveBeenCalledTimes(1)
		const [x, y, kind, obj] = openContextMenu.mock.calls[0]
		expect(x).toBe(120)
		expect(y).toBe(80)
		expect(kind).toBe('item')
		expect(obj.itemId).toBe('item-1')
	})

	it('right-clicking an unselected row selects it first (single-select)', async () => {
		const w = mountRow()
		await w.find('div').trigger('contextmenu', { clientX: 1, clientY: 1 })
		expect(selectFlat).toHaveBeenCalledWith('item-1', ['item-1'], {})
	})
})

describe('InventoryFlatRow — rename', () => {
	it('F2 on a selected row opens the inline rename input', async () => {
		const w = mountRow()
		selectedIds.value = new Set(['item-1'])
		await w.find('div').trigger('keydown', { key: 'F2' })
		expect(w.find('input').exists()).toBe(true)
		expect(w.find('input').element.value).toBe('Hat')
	})

	it('committing the rename (Enter) calls renameItem with the parent folder', async () => {
		const w = mountRow()
		selectedIds.value = new Set(['item-1'])
		await w.find('div').trigger('keydown', { key: 'F2' })
		const input = w.find('input')
		await input.setValue('Fancy Hat')
		await input.trigger('keydown', { key: 'Enter' })
		expect(renameItem).toHaveBeenCalledWith('item-1', 'folder-A', 'Fancy Hat')
		// input swaps back out after commit
		expect(w.find('input').exists()).toBe(false)
	})

	it('Escape cancels the rename without calling renameItem', async () => {
		const w = mountRow()
		selectedIds.value = new Set(['item-1'])
		await w.find('div').trigger('keydown', { key: 'F2' })
		await w.find('input').trigger('keydown', { key: 'Escape' })
		expect(renameItem).not.toHaveBeenCalled()
		expect(w.find('input').exists()).toBe(false)
	})

	it('the inv:begin-rename CustomEvent (from the context menu) opens this row for rename', async () => {
		const w = mountRow()
		window.dispatchEvent(new CustomEvent('inv:begin-rename', { detail: { id: 'item-1', kind: 'item' } }))
		await w.vm.$nextTick()
		expect(w.find('input').exists()).toBe(true)
	})

	it('ignores inv:begin-rename targeting a different item', async () => {
		const w = mountRow()
		window.dispatchEvent(new CustomEvent('inv:begin-rename', { detail: { id: 'other', kind: 'item' } }))
		await w.vm.$nextTick()
		expect(w.find('input').exists()).toBe(false)
	})

	it('double-click OPENS the item (not rename); rename stays on F2 / context menu', async () => {
		const w = mountRow()
		await w.find('div').trigger('dblclick')
		// No inline-rename input — dblclick now dispatches openInventoryItem instead.
		expect(w.find('input').exists()).toBe(false)
		expect(openInventoryItem).toHaveBeenCalledTimes(1)
		expect(openInventoryItem.mock.calls[0][0].itemId).toBe('item-1')
	})
})

describe('InventoryFlatRow — drag', () => {
	it('dragstart registers a drag payload for this item', async () => {
		const inv = useInventoryStore()
		const setDrag = vi.spyOn(inv, 'setDrag')
		const w = mountRow()
		const dt = { effectAllowed: '', setData: vi.fn() }
		await w.find('div').trigger('dragstart', { dataTransfer: dt })
		expect(setDrag).toHaveBeenCalledWith(['item-1'], 'item')
		// WHY 'copyMove': rez (world) + give (profile/IM) drop zones request dropEffect='copy';
		// effectAllowed='move' spec-rejects those drops (see the component's dragstart WHY comment).
		expect(dt.effectAllowed).toBe('copyMove')
	})

	it('dragging a mixed item+folder selection carries all ids with kind "mixed" (anchor first)', async () => {
		const inv = useInventoryStore()
		// A folder is present in the selection alongside this item → 'mixed'.
		inv.folders.set('folder-X', { folderId: 'folder-X', parentId: 'root', name: 'Sub', typeDefault: -1 })
		const setDrag = vi.spyOn(inv, 'setDrag')
		const w = mountRow()
		// Multi-select: this row's item + a folder (folder can only come from the tree, but the shared
		// selection spans both surfaces).
		selectedIds.value = new Set(['item-1', 'folder-X'])
		const dt = { effectAllowed: '', setData: vi.fn() }
		await w.find('div').trigger('dragstart', { dataTransfer: dt })
		const [ids, kind] = setDrag.mock.calls[0]
		expect(ids[0]).toBe('item-1')            // anchor first
		expect(new Set(ids)).toEqual(new Set(['item-1', 'folder-X']))
		expect(kind).toBe('mixed')
	})

	it('dragging an all-items multi-selection keeps kind "item"', async () => {
		const inv = useInventoryStore()
		const setDrag = vi.spyOn(inv, 'setDrag')
		const w = mountRow()
		selectedIds.value = new Set(['item-1', 'item-2'])
		const dt = { effectAllowed: '', setData: vi.fn() }
		await w.find('div').trigger('dragstart', { dataTransfer: dt })
		const [ids, kind] = setDrag.mock.calls[0]
		expect(ids[0]).toBe('item-1')
		expect(new Set(ids)).toEqual(new Set(['item-1', 'item-2']))
		expect(kind).toBe('item')
	})
})
