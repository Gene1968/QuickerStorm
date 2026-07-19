<script>
// ── Search-visibility scope helpers (pure — exported for unit tests) ─────────────────────────────
// FS's eye menu (menu_inventory_search_visibility.xml) excludes whole SUBTREES from search results
// while a filter string is active: llinventoryfilter.cpp:739-774 checkAgainstSearchVisibility()
// rejects rows in Trash (:763 isItemInTrash), the Library (:769 !isAgentInventory) and outfit
// folders (:757 isItemInOutfits = COF or under My Outfits, llinventorybridge.cpp:1445-1453).

// System-folder preferred types (message_template / FolderType): Trash=14, My Outfits=48.
export const FOLDER_TRASH = 14
export const FOLDER_MY_OUTFITS = 48

// Root folder ids to EXCLUDE from search for the given scope state ({ outfits, trash, library }).
export function scopeExcludedRoots(scopes, { trashId, libRootId, cofId, myOutfitsId }) {
	const roots = []
	if (scopes.trash === false && trashId) roots.push(trashId)
	if (scopes.library === false && libRootId) roots.push(libRootId)
	if (scopes.outfits === false) {
		// FS isItemInOutfits() = in the Current Outfit folder OR My Outfits-or-descendant
		// (llinventorybridge.cpp:1445-1453).
		if (cofId) roots.push(cofId)
		if (myOutfitsId) roots.push(myOutfitsId)
	}
	return roots
}

// True when `id` (folder or item) IS one of / lives UNDER any excluded root. Cycle-safe parent
// walk (same guard as inventoryStore.isInTrash). `folders` is the store Map, `findItem` resolves
// an item id → { folderId } (or null).
export function idInScopeExclusion(id, excludedRoots, folders, findItem) {
	if (!id || excludedRoots.length === 0) return false
	let cur = folders.has(id) ? id : (findItem(id)?.folderId || '')
	const seen = new Set()
	while (cur && !seen.has(cur)) {
		if (excludedRoots.includes(cur)) return true
		seen.add(cur)
		cur = folders.get(cur)?.parentId || ''
	}
	return false
}
</script>

<script setup>
import { ref, computed, watch, provide, onMounted, onUnmounted, nextTick } from 'vue'
import { useUiStore, MAX_INVENTORY, INVENTORY_DEFAULT_POS } from '@/stores/uiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { useInventoryClipboard } from '@/composables/useInventoryClipboard'
import { TYPE_FILTERS, typeFilterLabel, FOLDER_FAVORITES, FOLDER_CURRENT_OUTFIT, itemMatchesTypeSet } from '@/utils/inventoryIcons'
import FloaterWindow   from '@/components/FloaterWindow.vue'
import InventoryTreeNode from '@/components/InventoryTreeNode.vue'
import InventoryFlatRow from '@/components/InventoryFlatRow.vue'
import InventoryFiltersPanel from '@/components/InventoryFiltersPanel.vue'
import InventorySearchVisibilityMenu from '@/components/InventorySearchVisibilityMenu.vue'
import InventoryFolderListView from '@/components/InventoryFolderListView.vue'
import InventoryScopedTree from '@/components/InventoryScopedTree.vue'
import { useUploadActions } from '@/composables/useUploadActions'
import { ChevronDownIcon, ChevronRightIcon, ChevronLastIcon, CogIcon, PlusIcon, LuggageIcon, FilterIcon, ListIcon, TableOfContentsIcon, Trash2Icon, Loader2Icon, CheckIcon } from '@lucide/vue'

const props = defineProps({
	index: { type: Number, default: 0 },
})

const ui  = useUiStore()
const inv = useInventoryStore()
const { fetchFolder, createFolder, createBlankItem, trashItem, trashFolder, pasteInto, isItemWorn } = useInventory()
const { uploadSound, uploadTexture } = useUploadActions()
const { clipboard, setCut, setCopy, clear: clearClipboard } = useInventoryClipboard()

const showAddMenu = ref(false)

// Upload sound routes through the shared useUploadActions (same action MenuBar uses). Close the menu first.
function uploadSoundHere() {
	showAddMenu.value = false
	uploadSound()
}

// Upload texture routes through the shared useUploadActions (same action MenuBar uses). Close the menu first.
function uploadTextureHere() {
	showAddMenu.value = false
	uploadTexture()
}

// New Folder from the + menu: nest under the selected folder if one is selected, else My Inventory root.
function newFolderHere() {
	const parentId = inv.folders.has(inv.selectedId) ? inv.selectedId : inv.rootId
	if (!parentId) return
	createFolder({ name: 'New Folder', parentId })   // createFolder auto-expands the parent in the focused window
	showAddMenu.value = false
}

// New Notecard / New Script from the + menu. createBlankItem resolves the target folder from the current
// selection (selected folder, or a selected item's parent, else root). Double-click the new row to edit.
function newBlankHere(kind) {
	createBlankItem({ kind })
	showAddMenu.value = false
}

const tabs = [
	{ id: 'inventory',  label: 'Inventory' },
	{ id: 'recent',   label: 'Recent' },
	{ id: 'worn', label: 'Worn' },
	{ id: 'favorites',  label: 'Favorites' },
]
const activeTab = ref('inventory')

// ── Special-folder tabs (use existing data — Favorites + Current Outfit are system folders) ──
const favFolderId = computed(() => inv.findSystemFolder(FOLDER_FAVORITES))
const cofFolderId = computed(() => inv.findSystemFolder(FOLDER_CURRENT_OUTFIT))
const favItems    = computed(() => inv.folderItems(favFolderId.value))
const wornItems   = computed(() => inv.folderItems(cofFolderId.value))
// Recent: newest items across already-fetched folders (created_at desc).
const recentItems = computed(() => {
	const all = []
	inv.items.forEach(list => all.push(...list))
	return all.filter(i => i.createdAt).sort((a, b) => b.createdAt - a.createdAt).slice(0, 40)
})

// Fetch the backing folder when its tab is opened (lazy, like tree expand).
watch(activeTab, (t) => {
	if (t === 'favorites' && favFolderId.value) fetchFolder(favFolderId.value)
	if (t === 'worn'      && cofFolderId.value) fetchFolder(cofFolderId.value)
}, { immediate: true })

// WHY: true when the active tab renders a flex-1 scroll list (so the footer spacer is omitted).
const tabFills = computed(() => {
	if (activeTab.value === 'inventory') return !!inv.rootId
	if (activeTab.value === 'recent')    return recentItems.value.length > 0
	if (activeTab.value === 'worn')      return wornItems.value.length > 0 || wornIdSet.value.size > 0
	if (activeTab.value === 'favorites') return favItems.value.length > 0
	return false
})


// ── Per-instance filter state (not stored globally — each floater is independent) ─────────────
const rawFilter      = ref('')   // bound directly to input (immediate)
const localFilter    = ref('')   // debounced — drives the actual filter computation
// WHY: multi-select type filter (Set of TYPE_FILTERS ids). Empty Set = "All Types". Both the header
// dropdown (single-pick) and the Filters panel (multi-check) mutate this one source of truth.
const typeIds        = ref(new Set())
// "Show empty folders" (FS filter): when off, folders whose subtree has zero ITEMS are hidden.
const showEmptyFolders = ref(true)
let   filterTimer    = null

// ── Search-visibility scopes (the eye menu — FS menu_inventory_search_visibility.xml) ───────────
// true = scope INCLUDED in search results. FS defaults ALL scopes on (llinventoryfilter.h:173
// Params default search_visibility = 0xFFFFFFFF). Persisted per the app's qs_* localStorage
// convention (cf. qs_inv_viewmode below). "Include links" is omitted — see the menu component.
const SEARCH_VIZ_KEY = 'qs_inv_search_viz'
const searchScopes = ref((() => {
	const def = { outfits: true, trash: true, library: true }
	try { return { ...def, ...JSON.parse(localStorage.getItem(SEARCH_VIZ_KEY) || '{}') } } catch { return def }
})())
function toggleSearchScope(key) {
	searchScopes.value = { ...searchScopes.value, [key]: searchScopes.value[key] === false }
	try { localStorage.setItem(SEARCH_VIZ_KEY, JSON.stringify(searchScopes.value)) } catch { /* private mode etc. */ }
}
// Subtree roots currently excluded from search (recomputed when the skeleton or scopes change).
const excludedScopeRoots = computed(() => scopeExcludedRoots(searchScopes.value, {
	trashId:     inv.findSystemFolder(FOLDER_TRASH),
	libRootId:   inv.libRootId,
	cofId:       cofFolderId.value,
	myOutfitsId: inv.findSystemFolder(FOLDER_MY_OUTFITS),
}))
// WHY only while text-searching: FS applies scope exclusion ONLY when a filter string is active
// (llinventoryfilter.cpp:741 `if (!listener || !hasFilterString()) return true`) — type-only
// filtering and normal browsing are untouched.
function searchScopeAllows(id) {
	if (!filtering.value) return true
	return !idInScopeExclusion(id, excludedScopeRoots.value, inv.folders, inv.findItem)
}

// Spinner true while debounce is pending
const searching = computed(() => rawFilter.value !== localFilter.value)

watch(rawFilter, (v) => {
	clearTimeout(filterTimer)
	filterTimer = setTimeout(() => { localFilter.value = v }, 280)
})

// WHY: the injected tree still keys one branch off a single 'all' sentinel — report 'all' when no
// type filter is active, else a non-'all' marker so the "text-only, folder-name matched → show all
// items" shortcut only applies when there's genuinely no type filter.
const typeFilterMarker = computed(() => (typeIds.value.size === 0 ? 'all' : 'multi'))
const typeLabel = computed(() => {
	if (typeIds.value.size === 0) return 'All Types'
	if (typeIds.value.size === 1) return typeFilterLabel([...typeIds.value][0])
	return `${typeIds.value.size} types`
})

const filtering     = computed(() => localFilter.value.trim().length > 0)
const filtersActive = computed(() => filtering.value || typeIds.value.size > 0 || !showEmptyFolders.value)

function nameMatches(name) {
	return (name || '').toLowerCase().includes(localFilter.value.trim().toLowerCase())
}
function folderNameMatches(folderId) {
	const f = inv.folders.get(folderId)
	return !!f && nameMatches(f.name)
}
function itemSearchText(it) {
	let s = it.name || ''
	if (it.canCopy === false)     s += ' no copy'
	if (it.canModify === false)   s += ' no modify'
	if (it.canTransfer === false) s += ' no transfer'
	return s
}
function itemVisible(it) {
	// Search-visibility scope first (no-op unless a filter string is active — FS semantics).
	return searchScopeAllows(it.itemId) && nameMatches(itemSearchText(it)) && itemMatchesTypeSet(it, typeIds.value)
}
// WHY: "Show empty folders" off → a folder is only shown if it (or a descendant) holds a visible ITEM.
function folderHasItem(folderId) {
	for (const it of inv.folderItems(folderId)) if (itemVisible(it)) return true
	for (const c of inv.childFolders(folderId)) if (folderHasItem(c.folderId)) return true
	return false
}
function folderHasMatch(folderId) {
	if (!filtersActive.value) return true
	// Search-visibility scope: while text-searching, an excluded subtree (Trash / Library / outfit
	// folders with their scope off) never matches — killing the whole branch here mirrors FS's
	// per-row checkAgainstSearchVisibility (llinventoryfilter.cpp:180) since descendants recurse
	// through this same gate.
	if (!searchScopeAllows(folderId)) return false
	// Empty-folder hiding is orthogonal to name/type match: hide a folder with no visible items.
	if (!showEmptyFolders.value && !folderHasItem(folderId)) return false
	if (!filtering.value && typeIds.value.size === 0) return true   // only empty-folder filter active
	if (filtering.value && typeIds.value.size === 0 && folderNameMatches(folderId)) return true
	for (const it of inv.folderItems(folderId)) if (itemVisible(it)) return true
	for (const c of inv.childFolders(folderId)) if (folderHasMatch(c.folderId)) return true
	return false
}

// Provide filter context to InventoryTreeNode (recursive, so provide on the floater works).
provide('invFilter', { filtering, filtersActive, typeFilter: typeFilterMarker, folderHasMatch, itemVisible, folderNameMatches, nameMatches })

// ── Per-floater multi-selection ───────────────────────────────────────────────
// State is local so each of the up-to-6 inventory windows has independent selection.
const selectedIds = ref(new Set())
const anchorId    = ref(null)

function isSelected(id)  { return selectedIds.value.has(id) }
function clearSelection() { selectedIds.value = new Set(); anchorId.value = null }

function _applyRange(id, order) {
	const a = order.indexOf(anchorId.value), b = order.indexOf(id)
	if (a === -1 || b === -1) { selectedIds.value = new Set([id]); return }
	const [lo, hi] = a < b ? [a, b] : [b, a]
	selectedIds.value = new Set(order.slice(lo, hi + 1))
}

// Flat ordered list of visible IDs in the Inventory tree, mirroring render order
// (folder → child folders recursively → folder's items). Used for shift-click range.
function buildTreeOrder() {
	const order = []
	function walk(folderId) {
		if (!folderHasMatch(folderId)) return
		order.push(folderId)
		const isOpen = filtersActive.value
			? !inv.isFilterCollapsed(floaterId.value, folderId)
			: inv.isExpanded(floaterId.value, folderId)
		if (isOpen) {
			for (const c of inv.childFolders(folderId).filter(ch => folderHasMatch(ch.folderId))) walk(c.folderId)
			let its = inv.folderItems(folderId)
			if (filtersActive.value) its = its.filter(it => itemVisible(it))
			for (const it of inv.sortItems(its)) order.push(it.itemId)
		}
	}
	if (inv.rootId) walk(inv.rootId)
	if (inv.libRootId) walk(inv.libRootId)
	return order
}

// Used by InventoryTreeNode (injected). Shift=range via tree order, Ctrl/Meta=toggle.
function selectionSelect(id, event) {
	if (event?.shiftKey && anchorId.value) {
		_applyRange(id, buildTreeOrder())
	} else if (event?.ctrlKey || event?.metaKey) {
		const s = new Set(selectedIds.value)
		if (s.has(id)) s.delete(id); else s.add(id)
		selectedIds.value = s
		anchorId.value = id
	} else {
		selectedIds.value = new Set([id])
		anchorId.value = id
	}
}

// Used by flat tabs (Recent/Worn/Favorites). Caller passes the ordered ID list.
function selectionSelectFlat(id, order, event) {
	if (event?.shiftKey && anchorId.value) {
		_applyRange(id, order)
	} else if (event?.ctrlKey || event?.metaKey) {
		const s = new Set(selectedIds.value)
		if (s.has(id)) s.delete(id); else s.add(id)
		selectedIds.value = s
		anchorId.value = id
	} else {
		selectedIds.value = new Set([id])
		anchorId.value = id
	}
}

const recentIds = computed(() => recentItems.value.map(i => i.itemId))
const wornIds   = computed(() => wornItems.value.map(i => i.itemId))
const favIds    = computed(() => favItems.value.map(i => i.itemId))

// ── Scoped-tree id sets for the Recent / Worn TREE views (FS renders those tabs as filtered
// inventory-panel trees — see InventoryScopedTree). Recent keeps the flat tab's exact
// membership (top-40 newest). Worn = COF contents + anything isItemWorn flags (attachments
// worn via the wear/detach paths or detected from scene AttachItemID).
const recentIdSet = computed(() => new Set(recentIds.value))
const wornIdSet = computed(() => {
	const s = new Set(wornIds.value)
	inv.items.forEach(list => { for (const it of list) if (isItemWorn(it.itemId)) s.add(it.itemId) })
	return s
})

// ── Footer Trash button: trash the anchor (last-clicked) row ─────────────────
// WHY: mirrors the Trash2Icon button that was previously a TO-DO. Guarding system
// folders (typeDefault >= 0) matches FS behavior; folder-with-children gets a confirm.
function trashSelected() {
	const id = anchorId.value
	if (!id) return
	const folder = inv.folders.get(id)
	if (folder) {
		// It's a folder.
		if (Number(folder.typeDefault) >= 0) return   // system folder — refuse silently
		const { items: ci, folders: cf } = inv.descendantCounts(id)
		if (ci + cf > 0) {
			if (!window.confirm(`Move "${folder.name}" and its ${ci + cf} contents to Trash?`)) return
		}
		trashFolder(id)
		clearSelection()
	} else {
		// It's an item row — just trash it, no confirm (FS behavior).
		trashItem(id)
		clearSelection()
	}
}

// Clear stale highlights when the user switches tabs.
watch(activeTab, clearSelection)

provide('invSelection', { selectedIds, anchorId, isSelected, clearSelection, selectionSelect })
// Flat tabs (Recent/Worn/Favorites) select via the tab's own ordered id list, not the tree order.
provide('invSelectionFlat', selectionSelectFlat)

// WHY: per-instance id so each floater has its own focus/z-index slot in the floater stack.
const floaterId   = computed(() => `inventory-${props.index}`)
// WHY: the inv:begin-rename / context-menu actions are dispatched as GLOBAL window events, but the
// inventory store is a singleton shared by every floater — so rows in OTHER open inventory windows
// would also react and steal focus. Provide this floater's id so descendant rows can scope a global
// event to the floater the user is actually acting in (= the focused one, top of the floater stack).
provide('invFloaterId', floaterId)
const defaultPos  = computed(() => INVENTORY_DEFAULT_POS[props.index] ?? INVENTORY_DEFAULT_POS[0])
const title       = computed(() => props.index === 0 ? 'Inventory' : `Inventory ${props.index + 1}`)
const isLast      = computed(() => props.index >= MAX_INVENTORY - 1)
const nextOpen    = computed(() => ui.inventoryInstances.includes(props.index + 1))


// ── Clipboard (Ctrl+X cut / Ctrl+C copy / Ctrl+V paste) ──────────────────────
// FS semantics: CUT→PASTE moves; COPY→PASTE duplicates copyable items. Scoped to the FOCUSED
// inventory floater (top of the stack) so an open-but-background window never steals the shortcut.

// The paste target: an anchor folder pastes INTO itself; an anchor item pastes into its parent
// folder; nothing selected → My Inventory root. (FS pastes into the current/selected folder.)
function pasteTargetFolderId() {
	const id = anchorId.value
	if (id && inv.folders.has(id)) return id                 // folder anchor → into it
	if (id) { const f = inv.findItem(id); if (f) return f.folderId }   // item anchor → its folder
	return inv.rootId
}

function isFocusedFloater() { return ui.floaterStack.at(-1) === floaterId.value }

// Don't hijack Ctrl+C/X/V while the user is typing in an input/textarea/contenteditable
// (the filter box, an inline-rename field, etc.) — let the browser handle native copy/paste there.
function isTextEditing(e) {
	const t = e.target
	if (!t) return false
	const tag = t.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable === true
}

function onClipboardKey(e) {
	if (!isFocusedFloater() || isTextEditing(e)) return
	const mod = e.ctrlKey || e.metaKey
	if (!mod) return
	const k = e.key.toLowerCase()
	if (k === 'c') {
		const ids = [...selectedIds.value]
		if (!ids.length) return
		setCopy(ids, pasteTargetFolderId())
		e.preventDefault()
	} else if (k === 'x') {
		const ids = [...selectedIds.value]
		if (!ids.length) return
		setCut(ids, pasteTargetFolderId())
		e.preventDefault()
	} else if (k === 'v') {
		if (!clipboard.value.ids.length) return
		pasteInto(clipboard.value, pasteTargetFolderId(), clearClipboard)
		e.preventDefault()
	}
}

function close()        { ui.closeInventoryAt(props.index) }
function toggleNext()   { if (!isLast.value) ui.toggleInventoryAt(props.index + 1) }

// ── Clearing search + filters (Collapse also resets the text search, FS-style) ──
function clearSearch() {
	clearTimeout(filterTimer)
	rawFilter.value = ''
	localFilter.value = ''
}
function resetFilters() {
	clearSearch()
	typeIds.value = new Set()
	showEmptyFolders.value = true
}
// Collapse All: FS also drops the active text search when you collapse the tree.
// WHY suppressReveal: clearing the search normally re-reveals the selected row (see the
// filtersActive watch) — but an explicit Collapse All must actually collapse, so skip it once.
let suppressReveal = false
function collapseAll() {
	suppressReveal = true
	inv.collapseAll(floaterId.value)
	clearSearch()
	// The filtersActive watch (flush 'pre') runs before nextTick callbacks — reset afterwards so
	// the flag can't linger when a type filter keeps filtersActive true past the search clear.
	nextTick(() => { suppressReveal = false })
}
function expandAllFolders() { inv.expandAll(floaterId.value) }

// ── Cog / gear menu (mirrors menu_inventory_gear_default.xml) ────────────────────
const showCogMenu   = ref(false)
const showSortSub   = ref(false)
const SORT_OPTIONS = [
	{ id: 'name', label: 'Sort by Name' },
	{ id: 'date', label: 'Sort by Most Recent' },
	{ id: 'type', label: 'Sort by Type' },
]
function pickSort(id) { inv.setSort(id) }
function newInventoryWindow() { ui.openNextInventory(); showCogMenu.value = false }
function gearShowFilters()   { showFilters.value = true; showCogMenu.value = false }
function gearReset()         { resetFilters(); showCogMenu.value = false }
function gearCollapse()      { collapseAll(); showCogMenu.value = false }
function gearExpand()        { expandAllFolders(); showCogMenu.value = false }
function gearCloseAll()      { for (let i = 0; i < MAX_INVENTORY; i++) ui.closeInventoryAt(i) }
function toggleSysTop()      { inv.toggleSystemFoldersToTop() }

// ── Type-filter dropdown (single-pick; syncs the shared multi-select Set) ────────
const showTypeMenu = ref(false)
function typeChecked(id) {
	if (id === 'all') return typeIds.value.size === 0
	return typeIds.value.has(id)
}
function setType(id) {
	// Header dropdown behaves as a single-pick: 'all' clears, any other replaces the set.
	typeIds.value = id === 'all' ? new Set() : new Set([id])
	showTypeMenu.value = false
}
function toggleTypeId(id) {
	const s = new Set(typeIds.value)
	if (s.has(id)) s.delete(id); else s.add(id)
	typeIds.value = s
}

// ── Filters side panel (Show Filters button) ─────────────────────────────────────
const showFilters = ref(false)

// ── Search-bar "viz" eye dropdown (FS options_visibility_btn — llpanelmaininventory.cpp:426,
// :2171-2172 menu_inventory_search_visibility.xml). It toggles the SEARCH SCOPES above — where
// the search looks — not item types (the Filters side panel owns type filtering). ──
const showVizMenu = ref(false)

// ── View mode: tree ⇄ single-folder flat list (FS view_mode_btn → single-folder "list view",
// llpanelmaininventory.cpp:434 + :2143 + :2267-2321 onViewModeClick/toggleViewMode). Persisted in
// localStorage (the app-wide qs_* pref convention, e.g. useTheme/useAudio). ──
const VIEW_MODE_KEY = 'qs_inv_viewmode'
const viewMode = ref((() => {
	try { return localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'tree' } catch { return 'tree' }
})())
const listRootId    = ref('')   // current single-folder root ('' → agent root)
const listBackStack = ref([])   // back history for the list view's Back button
function toggleViewMode() {
	if (viewMode.value === 'tree') {
		// FS onViewModeClick: the single-folder view roots at the selected folder; a selected
		// ITEM roots at its parent folder (llpanelmaininventory.cpp:2277-2299). No selection → root.
		let root = ''
		const id = anchorId.value
		if (id && inv.folders.has(id)) root = id
		else if (id) root = inv.findItem(id)?.folderId || ''
		listRootId.value = root || inv.rootId
		listBackStack.value = []
		viewMode.value = 'list'
	} else {
		// FS: leaving single-folder mode selects the folder you were in, revealed in the tree
		// (llpanelmaininventory.cpp:2313-2320 setSelection on the previous root).
		const cur = listRootId.value
		viewMode.value = 'tree'
		if (cur && inv.folders.has(cur)) {
			selectionSelect(cur, {})
			revealInTree(cur)
		}
	}
	try { localStorage.setItem(VIEW_MODE_KEY, viewMode.value) } catch { /* private mode etc. */ }
}

// ── Horizontal tab strip: wheel-scroll + edge arrows only when overflowing ───────
const tabScrollEl = ref(null)
const tabOverflow = ref(false)
const canLeft     = ref(false)
const canRight    = ref(false)
let tabRo = null

function updateTabOverflow() {
	const el = tabScrollEl.value
	if (!el) return
	tabOverflow.value = el.scrollWidth > el.clientWidth + 1
	canLeft.value  = el.scrollLeft > 1
	canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
function onTabWheel(e) {
	const el = tabScrollEl.value
	if (!el || !tabOverflow.value) return
	// Translate vertical wheel into horizontal scroll over the tab strip.
	e.preventDefault()
	el.scrollLeft += (e.deltaY !== 0 ? e.deltaY : e.deltaX)
	updateTabOverflow()
}
function scrollTabs(kind) {
	const el = tabScrollEl.value
	if (!el) return
	const step = Math.max(60, el.clientWidth * 0.6)
	const map = { start: -el.scrollWidth, left: -step, right: step, end: el.scrollWidth }
	el.scrollBy({ left: map[kind] ?? 0, behavior: 'smooth' })
	setTimeout(updateTabOverflow, 250)
}

function closeMenus() { showTypeMenu.value = false; showCogMenu.value = false; showSortSub.value = false; showAddMenu.value = false; showFilters.value = false; showVizMenu.value = false }

// ── Reveal + scroll a row into view in the tree ─────────────────────────────────
// Expands every ANCESTOR folder of `id` in this window's expand set (the row itself may be a
// collapsed folder and stays collapsed), then scrolls its row into view. Mirrors FS, which keeps
// the selection across a filter edit and pins/scrolls it on screen (llfolderview.cpp:1902-1930
// "during filtering process, try to pin selected item's location on screen"; llfolderview.cpp:846
// scrollToShowSelection). Cycle-safe parent walk, same guard as inventoryStore.isInTrash.
const treeScrollEl = ref(null)
function revealInTree(id) {
	if (!id) return
	let cur = inv.folders.has(id) ? (inv.folders.get(id)?.parentId || '') : (inv.findItem(id)?.folderId || '')
	const seen = new Set()
	while (cur && !seen.has(cur)) {
		seen.add(cur)
		if (!inv.isExpanded(floaterId.value, cur)) inv.toggle(floaterId.value, cur)
		cur = inv.folders.get(cur)?.parentId || ''
	}
	nextTick(() => {
		const el = treeScrollEl.value?.querySelector(`[data-inv-id="${CSS.escape(id)}"]`)
		el?.scrollIntoView?.({ block: 'nearest' })
	})
}

// WHY: seed this window's per-instance expand set (root auto-expanded). immediate handles the
// common case (rootId already loaded at mount); the watch covers a window that opens before login.
watch(() => inv.rootId, (rid) => { if (rid) inv.ensureExpand(floaterId.value) }, { immediate: true })

// WHY: when the filter clears, drop this window's filter-collapse overlay so the next filter
// session starts fully revealed (and the normal expand state resumes cleanly). The selection is
// PRESERVED across the clear (FS pins the selected row on screen through filter edits —
// llfolderview.cpp:1902-1930): expand the anchor's ancestors so its row doesn't unmount inside a
// collapsed branch, and scroll it back into view.
watch(filtersActive, (active) => {
	if (active) return
	inv.clearFilterCollapse(floaterId.value)
	if (!suppressReveal && anchorId.value) revealInTree(anchorId.value)
})

onMounted(() => {
	inv.ensureExpand(floaterId.value)
	nextTick(updateTabOverflow)
	if (tabScrollEl.value && 'ResizeObserver' in window) {
		tabRo = new ResizeObserver(updateTabOverflow)
		tabRo.observe(tabScrollEl.value)
	}
	document.addEventListener('click', closeMenus)
	window.addEventListener('keydown', onClipboardKey)
})
onUnmounted(() => {
	inv.dropExpand(floaterId.value)
	tabRo?.disconnect()
	document.removeEventListener('click', closeMenus)
	window.removeEventListener('keydown', onClipboardKey)
	clearTimeout(filterTimer)
	filterTimer = null
})
</script>

<template>
	<FloaterWindow
		:id="floaterId"
		:title="'📦&hairsp;' + title"
		:wrap-style="{ width: '17.25rem', height: '28rem', resize: 'both' }"
		:default-pos="defaultPos"
		@close="close"
		class="min-w-[16.5rem] pullicontitleleft"
	>
		<div class="relative flex py-1 px-1.5">
				<input v-model="rawFilter" class="flex-1 bg-fg/10 rounded-xl w-full px-2 py-0.5 text-xs text-fg placeholder-fg/70 focus:outline-hidden focus:ring-1 focus:ring-inset focus:ring-accent" placeholder="Filter Inventory&#8230;" type="search" />
				<Loader2Icon v-if="searching" class="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-accent animate-spin pointer-events-none" />
			</div>
		<div class="flex flex-row items-center justify-evenly w-full mb-1 text-fg">
			<div class="flex flex-row items-center justify-start w-full text-2xs">
				<!-- FS hides Collapse/Expand in single-folder mode (llpanelmaininventory.cpp:2248). -->
				<template v-if="!(viewMode === 'list' && activeTab === 'inventory')">
					<button class="ui-btn me-2 py-0" title="Collapse all folders (clears the search filter)" @click="collapseAll">Collapse</button>
					<button class="ui-btn me-2 py-0" title="Expand all folders" @click="expandAllFolders">Expand</button>
				</template>
				<span class="me-1">Filter:</span>
				<!-- Type-filter dropdown (FS "Filter: All Types ▾") -->
				<div class="relative grow me-1">
					<button class="ui-btn flex w-full items-center justify-between py-0 whitespace-nowrap" @click.stop="showTypeMenu = !showTypeMenu">{{ typeLabel }}<ChevronDownIcon class="w-3" /></button>
					<div v-if="showTypeMenu" class="absolute z-[60] mt-0.5 left-0 min-w-[9rem] max-h-60 overflow-y-auto bg-panel border border-edge rounded-sm shadow-lg" @click.stop>
						<button
							v-for="t in TYPE_FILTERS"
							:key="t.id"
							class="flex items-center justify-start w-full px-2 py-1 hover:bg-white/10"
							:class="typeChecked(t.id) ? 'text-accent' : 'text-fg'"
							@click="setType(t.id)"
						><span class="w-3">{{ typeChecked(t.id) ? '✓' : '' }}</span>{{ t.label }}</button>
						<button
							class="flex items-center justify-start border-y px-2 py-1 w-full hover:bg-white/10"
						>⬜ Only coalesced (to-do)</button>
						<button
							class="flex items-center justify-start w-full px-2 py-1 hover:bg-white/10"
							:class="showFilters ? 'text-accent' : 'text-fg'"
							@click.stop="showFilters = !showFilters; showTypeMenu = false"
						>{{ showFilters ? '✓ ' : '   ' }}Custom</button>
					</div>
				</div>
			</div>
			<InventorySearchVisibilityMenu
				:open="showVizMenu"
				:scopes="searchScopes"
				@toggle-open="showVizMenu = !showVizMenu"
				@toggle-scope="toggleSearchScope"
			/>
		</div>
		<!-- Tab strip: edge arrows appear only when overflowing; wheel scrolls horizontally. -->
		<div class="flex flex-row items-start w-full text-2xs text-fg">
			<button v-if="tabOverflow" class="arrowctrl" :disabled="!canLeft" :class="{ 'opacity-30 cursor-default': !canLeft }" title="Scroll to start" @click="scrollTabs('start')"><ChevronLastIcon class="rotate-180" /></button>
			<button v-if="tabOverflow" class="arrowctrl" :disabled="!canLeft" :class="{ 'opacity-30 cursor-default': !canLeft }" title="Scroll left" @click="scrollTabs('left')"><ChevronRightIcon class="rotate-180" /></button>
			<div ref="tabScrollEl" class="w-full overflow-x-auto scrollbar-none" @wheel="onTabWheel" @scroll="updateTabOverflow">
				<nav class="tabs">
					<button
						v-for="tab in tabs"
						:key="tab.id"
						:class="activeTab === tab.id
							? 'active'
							: ''"
						@click="activeTab = tab.id"
					>{{ tab.label }}</button>
					<button class="sq max-w-[1.875rem] p-1" title="Add a custom tab (TO-DO)"><PlusIcon /></button>
				</nav>
			</div>
			<button v-if="tabOverflow" class="arrowctrl" :disabled="!canRight" :class="{ 'opacity-30 cursor-default': !canRight }" title="Scroll right" @click="scrollTabs('right')"><ChevronRightIcon /></button>
			<button v-if="tabOverflow" class="arrowctrl" :disabled="!canRight" :class="{ 'opacity-30 cursor-default': !canRight }" title="Scroll to end" @click="scrollTabs('end')"><ChevronLastIcon /></button>
		</div>

		<template v-if="activeTab === 'inventory'">
			<!-- Single-folder flat list (FS single-folder "list view") — tree stays the default. -->
			<InventoryFolderListView
				v-if="inv.rootId && viewMode === 'list'"
				:root-id="listRootId || inv.rootId"
				:back-stack="listBackStack"
				@update:root-id="listRootId = $event"
				@update:back-stack="listBackStack = $event"
			/>
			<div v-else-if="inv.rootId" ref="treeScrollEl" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<InventoryTreeNode :folder-id="inv.rootId" />
				<InventoryTreeNode v-if="inv.libRootId" :folder-id="inv.libRootId" />
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic flex flex-col items-center gap-1 pt-12">
				<p class="mt-8 text-2xl">📦</p>
				<p>No inventory loaded.</p>
				<p class="text-xs mt-2 opacity-60">Folder tree loads at login. Folder contents (items) arrive with the to-do cap layer.</p>
			</div>
		</template>
		<!-- Recent/Worn: TREE by default (FS renders these tabs as filtered inventory panels);
		     the view-mode toggle's "list" shows the original flat rows. -->
		<template v-else-if="activeTab === 'recent'">
			<InventoryScopedTree v-if="recentItems.length && viewMode !== 'list'" :item-ids="recentIdSet" />
			<div v-else-if="recentItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<InventoryFlatRow v-for="it in recentItems" :key="it.itemId" :item="it" :order="recentIds" />
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic pt-12">
				<p>No recent items yet.</p>
				<p class="text-xs mt-2 opacity-60">Expand folders in the Inventory tab to populate recent items.</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'worn'">
			<InventoryScopedTree v-if="wornIdSet.size && viewMode !== 'list'" :item-ids="wornIdSet" />
			<div v-else-if="wornItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<InventoryFlatRow v-for="it in wornItems" :key="it.itemId" :item="it" :order="wornIds" />
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic pt-12">
				<p>{{ cofFolderId ? 'Nothing worn (or still loading).' : 'No Current Outfit folder.' }}</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'favorites'">
			<div v-if="favItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<InventoryFlatRow v-for="it in favItems" :key="it.itemId" :item="it" :order="favIds" />
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic pt-12">
				<p>No favorites.</p>
				<p class="text-xs mt-2 opacity-60">Items in your Favorites folder appear here.</p>
			</div>
		</template>

		<!-- WHY: spacer only when the active tab isn't already filling the column (flex-1). -->
		<div v-if="!tabFills" class="flex-1"/>
		<div class="flex flex-row items-center justify-between shrink-0 text-xs text-fg">
			<div class="relative">
				<button class="ui-btn pe-0.5 ps-1" title="Show additional options" @click.stop="showCogMenu = !showCogMenu"><CogIcon class="w-3.5 h-3.5" /><ChevronDownIcon class="w-2.5 h-3.5" /></button>
				<!-- Gear menu — mirrors menu_inventory_gear_default.xml, backed items only. -->
				<div v-if="showCogMenu" class="absolute bottom-full mb-1 left-0 z-[60] min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg text-2xs" @click.stop>
					<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg disabled:opacity-40" :disabled="isLast" title="Open another inventory window" @click="newInventoryWindow">New Inventory Window</button>
					<div class="border-t border-edge"></div>
					<div class="relative">
						<button class="flex w-full items-center justify-between px-2 py-1.5 hover:bg-white/10 text-fg" @click.stop="showSortSub = !showSortSub">Sorting<ChevronRightIcon class="w-3" /></button>
						<div v-if="showSortSub" class="absolute bottom-0 left-full ml-0.5 z-[61] min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg" @click.stop>
							<button
								v-for="o in SORT_OPTIONS"
								:key="o.id"
								class="block w-full text-left px-2 py-1 hover:bg-white/10"
								:class="inv.sortMode === o.id ? 'text-accent' : 'text-fg'"
								@click="pickSort(o.id)"
							>{{ inv.sortMode === o.id ? '✓ ' : '   ' }}{{ o.label }}</button>
							<div class="border-t border-edge"></div>
							<button
								class="block w-full text-left px-2 py-1 hover:bg-white/10"
								:class="inv.systemFoldersToTop ? 'text-accent' : 'text-fg'"
								@click="toggleSysTop"
							>{{ inv.systemFoldersToTop ? '✓ ' : '   ' }}System Folders to Top</button>
						</div>
					</div>
					<div class="border-t border-edge"></div>
					<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg" @click="gearShowFilters">Show Filters…</button>
					<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg" @click="gearReset">Reset Filters</button>
					<div class="border-t border-edge"></div>
					<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg" @click="gearCollapse">Collapse All Folders</button>
					<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg" @click="gearExpand">Expand All Folders</button>
					<div class="border-t border-edge"></div>
					<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg" @click="gearCloseAll">Close All Windows</button>
				</div>
			</div>
			<div class="relative">
				<button class="ui-btn px-1" title="Add new item" @click.stop="showAddMenu = !showAddMenu"><PlusIcon class="w-3.5 h-3.5" /></button>
				<div v-if="showAddMenu" class="absolute bottom-full mb-1 left-0 z-[60] min-w-[10rem] bg-panel border border-edge rounded-sm shadow-lg text-xs" @click.stop>
					<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10 text-fg" @click="newFolderHere">New Folder</button>
					<div class="border-t border-edge"></div>
					<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10 text-fg" @click="newBlankHere('script')">New Script</button>
					<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10 text-fg" @click="newBlankHere('notecard')">New Notecard</button>
					<div class="border-t border-edge"></div>
					<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10 text-fg" @click="uploadSoundHere">Upload Sound (OGG)…</button>
					<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10 text-fg" @click="uploadTextureHere">Upload Texture…</button>
					<div class="border-t border-edge"></div>
					<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>New Gesture</button>
					<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>New Clothing</button>
					<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>New Body Part</button>
					<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>New Settings</button>
				</div>
			</div>
			<button
				:title="isLast
					? `Maximum of ${MAX_INVENTORY} inventory floaters reached`
					: nextOpen ? `Close Inventory ${index + 2}` : `Open Inventory ${index + 2}`"
				:disabled="isLast"
				:class="isLast ? 'opacity-40 cursor-not-allowed' : nextOpen ? 'text-accent border-accent' : ''"
				class="ui-btn"
				@click="toggleNext"
			><LuggageIcon class="w-3.5 h-3.5" /></button>
			<div class="not-relative">
				<button
					class="ui-btn"
					:class="filtersActive ? 'text-accent border-accent' : ''"
					title="Show filters - filter the inventory by type and hide empty folders. Highlighted when any filter is enabled."
					@click.stop="showFilters = !showFilters"
				><FilterIcon class="w-3.5 h-3.5" /></button>
				<InventoryFiltersPanel
					v-if="showFilters"
					:type-ids="typeIds"
					:show-empty-folders="showEmptyFolders"
					@toggle-type="toggleTypeId"
					@update:show-empty-folders="showEmptyFolders = $event"
					@reset="resetFilters"
					@close="showFilters = false"
				/>
			</div>
			<!-- View-mode toggle (FS view_mode_btn, llpanelmaininventory.cpp:434/2143): tree ⇄ single-folder list. -->
			<button
				class="ui-btn"
				:class="viewMode === 'list' ? 'text-accent border-accent' : ''"
				:title="viewMode === 'list' ? 'Switch to folder tree view' : 'Switch to single-folder list view'"
				@click="toggleViewMode"
			><TableOfContentsIcon v-if="viewMode === 'list'" class="w-3.5 h-3.5" /><ListIcon v-else class="w-3.5 h-3.5" /></button>
			<div
				:title="inv.allAgentFetched
					? `${inv.agentItemCount} items in ${inv.agentFolderCount} folders (complete)`
					: `Loading inventory… ${inv.agentFetchedCount} of ${inv.agentFolderCount} folders fetched`"
				class="grow border-1 border-edge p-0.5 text-2xs text-fg truncate user-select-none flex items-center gap-1"
			><CheckIcon v-if="inv.allAgentFetched" class="shrink-0 w-3 h-3 text-green-400" /><Loader2Icon v-else class="shrink-0 w-3 h-3 animate-spin opacity-60" />{{ inv.agentItemCount.toLocaleString() }} Items<span v-if="!inv.allAgentFetched && inv.agentFetchedCount > 0" class="opacity-60"> · {{ inv.agentFetchedCount }}/{{ inv.agentFolderCount }}</span><span v-else-if="!inv.allAgentFetched && inv.cacheLoaded" class="opacity-50"> · syncing…</span><span v-else-if="!inv.allAgentFetched" class="opacity-60"> · {{ inv.agentFetchedCount }}/{{ inv.agentFolderCount }}…</span></div>
			<button class="ui-btn px-1" :class="anchorId ? '' : 'opacity-40 cursor-not-allowed'" :disabled="!anchorId" title="Move selected item to Trash" @click="trashSelected"><Trash2Icon class="w-3.5 h-3.5" /></button>
		</div>
	</FloaterWindow>
</template>

<style scoped>
</style>
