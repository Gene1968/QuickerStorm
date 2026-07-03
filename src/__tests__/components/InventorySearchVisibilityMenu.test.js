// Tests for the search-bar "viz" eye dropdown — Firestorm's SEARCH VISIBILITY menu
// (menu_inventory_search_visibility.xml: search_outfits / search_trash / search_library →
// llpanelmaininventory.cpp:2639-2657 toggleSearchVisibility*). It toggles WHERE search looks
// (scopes), NOT item types — type filtering belongs to the Filters side panel. "Include links"
// is intentionally omitted (inventory links not implemented; see the component comment).
// Also covers the scope PLUMBING: the floater's pure exclusion helpers and the end-to-end
// behavior that an item in Trash drops out of search matches when "Search Trash" is off
// (llinventoryfilter.cpp:739-774 checkAgainstSearchVisibility, applied only while a filter
// string is active — :741).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// InventoryFloater + InventoryTreeNode dependencies (network side mocked out).
vi.mock('@/composables/useInventory', () => ({
	useInventory: () => ({
		fetchFolder: vi.fn(), createFolder: vi.fn(), trashItem: vi.fn(), trashFolder: vi.fn(),
		pasteInto: vi.fn(), renameItem: vi.fn(), renameFolder: vi.fn(), moveItem: vi.fn(),
		moveFolder: vi.fn(), openInventoryItem: vi.fn(),
	}),
}))
vi.mock('@/composables/useInventoryClipboard', async () => {
	const { ref } = await import('vue')
	return { useInventoryClipboard: () => ({ clipboard: ref({ ids: [] }), setCut: vi.fn(), setCopy: vi.fn(), clear: vi.fn() }) }
})
vi.mock('@/composables/useInventoryThumbnail', async () => {
	const { ref } = await import('vue')
	return { useInventoryThumbnail: () => ({ thumbnailFor: () => ref(null) }) }
})

import InventorySearchVisibilityMenu from '@/components/InventorySearchVisibilityMenu.vue'
import InventoryFloater, { scopeExcludedRoots, idInScopeExclusion, FOLDER_TRASH, FOLDER_MY_OUTFITS } from '@/components/InventoryFloater.vue'
import { useInventoryStore } from '@/stores/inventoryStore'

const SCOPE_LABELS = ['Search outfit folders', 'Search Trash', 'Search Library']

function makeMenu(props = {}) {
	return mount(InventorySearchVisibilityMenu, {
		props: { open: true, scopes: { outfits: true, trash: true, library: true }, ...props },
	})
}
function buttonByText(w, text) {
	return w.findAll('button').find(b => b.text().includes(text))
}

describe('InventorySearchVisibilityMenu (FS menu_inventory_search_visibility.xml)', () => {
	it('renders nothing but the eye button when closed', () => {
		const w = makeMenu({ open: false })
		expect(w.findAll('button').length).toBe(1)   // just the toggle
	})

	it('eye button emits toggle-open (floater owns the open flag for shared dismissal)', async () => {
		const w = makeMenu({ open: false })
		await w.find('button').trigger('click')
		expect(w.emitted('toggle-open')).toHaveLength(1)
	})

	it('open menu lists exactly the FS search scopes — no type checkboxes, no "Include links"', () => {
		const w = makeMenu()
		for (const label of SCOPE_LABELS) expect(buttonByText(w, label)).toBeTruthy()
		// The eye + three scope rows and nothing else.
		expect(w.findAll('button').length).toBe(1 + SCOPE_LABELS.length)
		expect(w.text()).not.toContain('Include links')      // links omitted (no Appearance pipeline yet)
		expect(w.text()).not.toContain('Textures')           // type filtering lives in the Filters panel
		expect(w.text()).not.toContain('Show empty folders')
	})

	it('clicking a scope emits toggle-scope with its key', async () => {
		const w = makeMenu()
		await buttonByText(w, 'Search Trash').trigger('click')
		await buttonByText(w, 'Search Library').trigger('click')
		await buttonByText(w, 'Search outfit folders').trigger('click')
		expect(w.emitted('toggle-scope')).toEqual([['trash'], ['library'], ['outfits']])
	})

	it('checkmark reflects the scope state (FS default: all ON)', () => {
		const on = makeMenu()
		for (const label of SCOPE_LABELS) expect(buttonByText(on, label).text()).toContain('✓')
		const off = makeMenu({ scopes: { outfits: true, trash: false, library: true } })
		expect(buttonByText(off, 'Search Trash').text()).not.toContain('✓')
		expect(buttonByText(off, 'Search Library').text()).toContain('✓')
	})

	it('highlights the eye only when a scope is narrowing the search', () => {
		const allOn = makeMenu({ open: false })
		expect(allOn.find('button').classes()).not.toContain('text-accent')
		const oneOff = makeMenu({ open: false, scopes: { outfits: true, trash: false, library: true } })
		expect(oneOff.find('button').classes()).toContain('text-accent')
	})
})

// ── Pure scope-exclusion helpers (exported from InventoryFloater.vue) ────────────────────────────

describe('scopeExcludedRoots / idInScopeExclusion', () => {
	const ids = { trashId: 'T', libRootId: 'L', cofId: 'C', myOutfitsId: 'M' }

	it('excludes nothing when every scope is on (FS default 0xFFFFFFFF)', () => {
		expect(scopeExcludedRoots({ outfits: true, trash: true, library: true }, ids)).toEqual([])
	})

	it('maps each disabled scope to its subtree root(s)', () => {
		expect(scopeExcludedRoots({ outfits: true, trash: false, library: true }, ids)).toEqual(['T'])
		expect(scopeExcludedRoots({ outfits: true, trash: true, library: false }, ids)).toEqual(['L'])
		// Outfits = Current Outfit folder + My Outfits subtree (llinventorybridge.cpp:1445-1453).
		expect(scopeExcludedRoots({ outfits: false, trash: true, library: true }, ids)).toEqual(['C', 'M'])
	})

	it('skips roots the skeleton does not have (e.g. no My Outfits on a fresh OpenSim account)', () => {
		expect(scopeExcludedRoots({ outfits: false, trash: false, library: false },
			{ trashId: 'T', libRootId: '', cofId: 'C', myOutfitsId: '' })).toEqual(['T', 'C'])
	})

	it('flags folders and items that are, or live under, an excluded root (cycle-safe walk)', () => {
		const folders = new Map([
			['root',  { folderId: 'root',  parentId: '' }],
			['T',     { folderId: 'T',     parentId: 'root' }],   // Trash
			['tSub',  { folderId: 'tSub',  parentId: 'T' }],      // folder inside Trash
			['docs',  { folderId: 'docs',  parentId: 'root' }],
		])
		const findItem = (id) => (id === 'binned' ? { folderId: 'tSub' } : id === 'plain' ? { folderId: 'docs' } : null)
		expect(idInScopeExclusion('T',      ['T'], folders, findItem)).toBe(true)   // the root itself
		expect(idInScopeExclusion('tSub',   ['T'], folders, findItem)).toBe(true)   // nested folder
		expect(idInScopeExclusion('binned', ['T'], folders, findItem)).toBe(true)   // item deep in Trash
		expect(idInScopeExclusion('plain',  ['T'], folders, findItem)).toBe(false)  // agent item elsewhere
		expect(idInScopeExclusion('binned', [],    folders, findItem)).toBe(false)  // nothing excluded
	})
})

// ── End-to-end: scopes actually gate search matches in the floater's tree ────────────────────────

describe('InventoryFloater search-visibility scopes', () => {
	let inv

	function seed() {
		inv = useInventoryStore()
		inv.rootId = 'root'
		inv.folders.set('root',  { folderId: 'root',  parentId: '',     name: 'My Inventory', typeDefault: 8,  source: 'agent' })
		inv.folders.set('docs',  { folderId: 'docs',  parentId: 'root', name: 'Documents',    typeDefault: -1, source: 'agent' })
		inv.folders.set('trash', { folderId: 'trash', parentId: 'root', name: 'Trash',        typeDefault: FOLDER_TRASH, source: 'agent' })
		inv.setItems('docs',  [{ itemId: 'kept',   parentId: 'docs',  name: 'Widget kept',   assetType: 6, invType: 6, createdAt: 2 }])
		inv.setItems('trash', [{ itemId: 'binned', parentId: 'trash', name: 'Widget binned', assetType: 6, invType: 6, createdAt: 1 }])
	}

	function makeFloater() {
		return mount(InventoryFloater, {
			props: { index: 0 },
			global: {
				stubs: {
					// Chrome only — the floater's content renders through the default slot.
					FloaterWindow: { template: '<div class="floater-stub"><slot /></div>' },
				},
			},
		})
	}

	// Type text into the filter box and flush the 280 ms debounce.
	async function search(w, text) {
		await w.find('input[type="search"]').setValue(text)
		vi.advanceTimersByTime(300)
		await nextTick()
		await nextTick()
	}

	beforeEach(async () => {
		setActivePinia(createPinia())
		localStorage.clear()
		vi.useFakeTimers()
		seed()
		await Promise.resolve()   // flush the store's batched trigger
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('Search Trash ON (default): a matching item inside Trash appears in results', async () => {
		const w = makeFloater()
		await search(w, 'Widget')
		expect(w.text()).toContain('Widget binned')
		expect(w.text()).toContain('Widget kept')
	})

	it('Search Trash OFF: the Trash subtree is excluded from matches, and re-ON restores it', async () => {
		const w = makeFloater()
		await search(w, 'Widget')
		// Open the eye dropdown, then toggle "Search Trash" off through the menu UI.
		await w.find('button[title^="Search visibility"]').trigger('click')
		await buttonByText(w, 'Search Trash').trigger('click')
		await nextTick()
		expect(w.text()).not.toContain('Widget binned')
		expect(w.text()).toContain('Widget kept')      // agent match unaffected
		// Persisted under the qs_* convention.
		expect(JSON.parse(localStorage.getItem('qs_inv_search_viz')).trash).toBe(false)
		// Back on → included again.
		await buttonByText(w, 'Search Trash').trigger('click')
		await nextTick()
		expect(w.text()).toContain('Widget binned')
	})

	it('scopes apply ONLY while a filter string is active (llinventoryfilter.cpp:741)', async () => {
		localStorage.setItem('qs_inv_search_viz', JSON.stringify({ outfits: true, trash: false, library: true }))
		const w = makeFloater()
		// No search text: browsing the expanded Trash still shows its contents.
		inv.toggle('inventory-0', 'trash')
		await nextTick()
		expect(w.text()).toContain('Widget binned')
	})

	it('exports the folder-type constants used for scope roots', () => {
		expect(FOLDER_TRASH).toBe(14)
		expect(FOLDER_MY_OUTFITS).toBe(48)
	})
})
