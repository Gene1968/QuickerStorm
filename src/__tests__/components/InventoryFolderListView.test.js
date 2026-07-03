// Tests for InventoryFolderListView — the single-folder flat list (FS single-folder "list view",
// llpanelmaininventory.cpp toggleViewMode / llinventorypanel.cpp changeFolderRoot). Navigation is
// prop-controlled (the floater owns rootId + backStack) so descend/up/back/breadcrumb are asserted
// via the update:rootId / update:backStack emissions.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

const fetchFolder = vi.fn()
vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({
		fetchFolder,
		renameItem: vi.fn(), moveItem: vi.fn(), openInventoryItem: vi.fn(),
	}),
}))

import InventoryFolderListView from '@/components/InventoryFolderListView.vue'
import { useInventoryStore } from '@/stores/inventoryStore'

let inv

function seed() {
	inv = useInventoryStore()
	inv.rootId = 'root'
	inv.folders.set('root',    { folderId: 'root',    parentId: '',        name: 'My Inventory', typeDefault: 8,  source: 'agent' })
	inv.folders.set('folderA', { folderId: 'folderA', parentId: 'root',    name: 'Alpha',        typeDefault: -1, source: 'agent' })
	inv.folders.set('folderB', { folderId: 'folderB', parentId: 'folderA', name: 'Beta',         typeDefault: -1, source: 'agent' })
	inv.setItems('folderA', [
		{ itemId: 'i1', parentId: 'folderA', name: 'Hat',   assetType: 6, invType: 6, createdAt: 3 },
		{ itemId: 'i2', parentId: 'folderA', name: 'Boots', assetType: 6, invType: 6, createdAt: 2 },
	])
}

const selectionSelect = vi.fn()
const selectFlat      = vi.fn()

function make(props = {}) {
	return mount(InventoryFolderListView, {
		props: { rootId: 'folderA', backStack: [], ...props },
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
				invSelectionFlat: selectFlat,
				invFloaterId: null,
			},
		},
	})
}

beforeEach(async () => {
	setActivePinia(createPinia())
	fetchFolder.mockClear(); selectionSelect.mockClear(); selectFlat.mockClear()
	seed()
	// flush the store's batched trigger
	await Promise.resolve()
})

describe('InventoryFolderListView', () => {
	it('renders folder rows then item rows for ONE folder, and fetches it lazily', async () => {
		const w = make()
		await Promise.resolve()
		expect(fetchFolder).toHaveBeenCalledWith('folderA')
		const text = w.text()
		expect(text).toContain('Beta')   // child folder row
		expect(text).toContain('Hat')    // items via InventoryFlatRow
		expect(text).toContain('Boots')
		// Does NOT render other folders' contents (single-folder view).
		expect(text).not.toContain('My Inventory' + 'Hat')
	})

	it('breadcrumb shows the ancestor path with the agent root labelled "Inventory"', () => {
		const w = make()
		const text = w.text()
		expect(text).toContain('Inventory')   // root crumb label (FS labels the agent root)
		expect(text).toContain('Alpha')       // current folder crumb
	})

	it('double-clicking a folder row DESCENDS: emits new root + pushes old root on back history', async () => {
		const w = make()
		const row = w.findAll('div').find(d => d.text() === '📁Beta' || (d.text().includes('Beta') && d.classes().includes('cursor-pointer')))
		await row.trigger('dblclick')
		expect(w.emitted('update:rootId')).toEqual([['folderB']])
		expect(w.emitted('update:backStack')).toEqual([[['folderA']]])
	})

	it('Up button navigates to the parent folder', async () => {
		const w = make()
		const up = w.findAll('button').find(b => b.attributes('title') === 'Up to the parent folder')
		expect(up.attributes('disabled')).toBeUndefined()
		await up.trigger('click')
		expect(w.emitted('update:rootId')).toEqual([['root']])
	})

	it('Up is disabled at the agent root (FS mUpBtn setEnabled analog)', () => {
		const w = make({ rootId: 'root' })
		const up = w.findAll('button').find(b => b.attributes('title') === 'Up to the parent folder')
		expect(up.attributes('disabled')).toBeDefined()
	})

	it('Back pops the history stack (FS onBackwardFolder analog)', async () => {
		const w = make({ rootId: 'folderB', backStack: ['folderA'] })
		const back = w.findAll('button').find(b => b.attributes('title') === 'Back to the previous folder')
		await back.trigger('click')
		expect(w.emitted('update:rootId')).toEqual([['folderA']])
		expect(w.emitted('update:backStack')).toEqual([[[]]])
	})

	it('Back is disabled with an empty history', () => {
		const w = make()
		const back = w.findAll('button').find(b => b.attributes('title') === 'Back to the previous folder')
		expect(back.attributes('disabled')).toBeDefined()
	})

	it('clicking a breadcrumb ancestor navigates there (and pushes history)', async () => {
		const w = make({ rootId: 'folderB', backStack: [] })
		const crumb = w.findAll('button').find(b => b.text() === 'Alpha')
		await crumb.trigger('click')
		expect(w.emitted('update:rootId')).toEqual([['folderA']])
		expect(w.emitted('update:backStack')).toEqual([[['folderB']]])
	})

	it('folder row click selects via the FLAT selection path with the view row order', async () => {
		const w = make()
		const row = w.findAll('div').find(d => d.text().includes('Beta') && d.classes().includes('cursor-pointer'))
		await row.trigger('click')
		expect(selectFlat).toHaveBeenCalledTimes(1)
		const [id, order] = selectFlat.mock.calls[0]
		expect(id).toBe('folderB')
		expect(order).toEqual(['folderB', 'i1', 'i2'])   // folders first, then date-sorted items
	})
})
