<script setup>
import { ref, computed, watch, provide, onMounted, onUnmounted, nextTick } from 'vue'
import { useUiStore, MAX_INVENTORY, INVENTORY_DEFAULT_POS } from '@/stores/uiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon, TYPE_FILTERS, typeFilterLabel, FOLDER_FAVORITES, FOLDER_CURRENT_OUTFIT, itemMatchesType } from '@/utils/inventoryIcons'
import FloaterWindow   from '@/components/FloaterWindow.vue'
import InventoryTreeNode from '@/components/InventoryTreeNode.vue'
import { ChevronDownIcon, EyeIcon, ChevronRightIcon, ChevronLastIcon, CogIcon, PlusIcon, LuggageIcon, FilterIcon, ListIcon, TableOfContentsIcon, Trash2Icon, Loader2Icon, CheckIcon } from '@lucide/vue'

const props = defineProps({
	index: { type: Number, default: 0 },
})

const ui  = useUiStore()
const inv = useInventoryStore()
const { fetchFolder, createFolder } = useInventory()

const showAddMenu = ref(false)

// New Folder from the + menu: nest under the selected folder if one is selected, else My Inventory root.
function newFolderHere() {
	const parentId = inv.folders.has(inv.selectedId) ? inv.selectedId : inv.rootId
	if (!parentId) return
	createFolder({ name: 'New Folder', parentId })
	if (!inv.isExpanded(parentId)) inv.toggle(parentId)
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
	if (activeTab.value === 'worn')      return wornItems.value.length > 0
	if (activeTab.value === 'favorites') return favItems.value.length > 0
	return false
})


// ── Per-instance filter state (not stored globally — each floater is independent) ─────────────
const rawFilter      = ref('')   // bound directly to input (immediate)
const localFilter    = ref('')   // debounced — drives the actual filter computation
const localTypeFilter = ref('all')
let   filterTimer    = null

// Spinner true while debounce is pending
const searching = computed(() => rawFilter.value !== localFilter.value)

watch(rawFilter, (v) => {
	clearTimeout(filterTimer)
	filterTimer = setTimeout(() => { localFilter.value = v }, 280)
})

const filtering     = computed(() => localFilter.value.trim().length > 0)
const filtersActive = computed(() => filtering.value || localTypeFilter.value !== 'all')

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
	return nameMatches(itemSearchText(it)) && itemMatchesType(it, localTypeFilter.value)
}
function folderHasMatch(folderId) {
	if (!filtersActive.value) return true
	if (filtering.value && localTypeFilter.value === 'all' && folderNameMatches(folderId)) return true
	for (const it of inv.folderItems(folderId)) if (itemVisible(it)) return true
	for (const c of inv.childFolders(folderId)) if (folderHasMatch(c.folderId)) return true
	return false
}

// Provide filter context to InventoryTreeNode (recursive, so provide on the floater works).
provide('invFilter', { filtering, filtersActive, typeFilter: localTypeFilter, folderHasMatch, itemVisible, folderNameMatches, nameMatches })

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
		if (inv.isExpanded(folderId) || filtersActive.value) {
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

// Clear stale highlights when the user switches tabs.
watch(activeTab, clearSelection)

provide('invSelection', { selectedIds, anchorId, isSelected, clearSelection, selectionSelect })

// WHY: per-instance id so each floater has its own focus/z-index slot in the floater stack.
const floaterId   = computed(() => `inventory-${props.index}`)
const defaultPos  = computed(() => INVENTORY_DEFAULT_POS[props.index] ?? INVENTORY_DEFAULT_POS[0])
const title       = computed(() => props.index === 0 ? '📦 Inventory' : `📦 Inventory ${props.index + 1}`)
const isLast      = computed(() => props.index >= MAX_INVENTORY - 1)
const nextOpen    = computed(() => ui.inventoryInstances.includes(props.index + 1))


function close()        { ui.closeInventoryAt(props.index) }
function toggleNext()   { if (!isLast.value) ui.toggleInventoryAt(props.index + 1) }

// ── Cog menu (bottom-left) — holds sort options, FS-style ────────────────────────
const showCogMenu = ref(false)
const SORT_OPTIONS = [
	{ id: 'name', label: 'Sort by Name' },
	{ id: 'date', label: 'Sort by Date' },
	{ id: 'type', label: 'Sort by Type' },
]
function pickSort(id) { inv.setSort(id); showCogMenu.value = false }

// ── Type-filter dropdown ───────────────────────────────────────────────────────
const showTypeMenu = ref(false)
const typeLabel    = computed(() => typeFilterLabel(localTypeFilter.value))
function setType(id) { localTypeFilter.value = id; showTypeMenu.value = false }

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

function closeMenus() { showTypeMenu.value = false; showCogMenu.value = false; showAddMenu.value = false }

onMounted(() => {
	nextTick(updateTabOverflow)
	if (tabScrollEl.value && 'ResizeObserver' in window) {
		tabRo = new ResizeObserver(updateTabOverflow)
		tabRo.observe(tabScrollEl.value)
	}
	document.addEventListener('click', closeMenus)
})
onUnmounted(() => {
	tabRo?.disconnect()
	document.removeEventListener('click', closeMenus)
	clearTimeout(filterTimer)
	filterTimer = null
})
</script>

<template>
	<FloaterWindow
		:id="floaterId"
		:title="title"
		:wrap-style="{ width: '16.5vw', height: '47vh', resize: 'both' }"
		:default-pos="defaultPos"
		@close="close"
		class="min-w-[16.5rem]"
	>
		<div class="relative flex p-1">
				<input v-model="rawFilter" class="bg-brd2 rounded-xl w-full px-2 py-1 text-xs text-fg placeholder-white/30 focus:outline-hidden focus:ring-1 focus:ring-inset focus:ring-accent" placeholder="Filter Inventory" type="search" />
				<Loader2Icon v-if="searching" class="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-accent animate-spin pointer-events-none" />
			</div>
		<div class="flex flex-row items-center justify-evenly w-full mb-1 text-fg">
			<div class="flex flex-row items-center justify-start w-full text-2xs">
				<button class="ui-btn me-2 py-0" @click="inv.collapseAll()">Collapse</button>
				<button class="ui-btn me-2 py-0" @click="inv.expandAll()">Expand</button>
				<span class="me-1">Filter:</span>
				<!-- Type-filter dropdown (FS "Filter: All Types ▾") -->
				<div class="relative grow me-1">
					<button class="ui-btn flex w-full items-center justify-between py-0 whitespace-nowrap" @click.stop="showTypeMenu = !showTypeMenu">{{ typeLabel }}<ChevronDownIcon class="w-3" /></button>
					<div v-if="showTypeMenu" class="absolute z-[60] mt-0.5 left-0 min-w-[9rem] max-h-60 overflow-y-auto bg-panel border border-edge rounded-sm shadow-lg" @click.stop>
						<button
							v-for="t in TYPE_FILTERS"
							:key="t.id"
							class="block w-full text-left px-2 py-1 hover:bg-white/10"
							:class="localTypeFilter === t.id ? 'text-accent' : 'text-fg'"
							@click="setType(t.id)"
						>{{ t.label }}</button>
					</div>
				</div>
			</div>
			<button class="ui-btn py-0" title="Show search visibility options"><EyeIcon /><ChevronDownIcon class="w-3" /></button>
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
			<div v-if="inv.rootId" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<InventoryTreeNode :folder-id="inv.rootId" />
				<InventoryTreeNode v-if="inv.libRootId" :folder-id="inv.libRootId" />
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic flex flex-col items-center gap-1 pt-12">
				<p class="mt-8 text-2xl">📦</p>
				<p>No inventory loaded.</p>
				<p class="text-xs mt-2 opacity-60">Folder tree loads at login. Folder contents (items) arrive with the Phase 3 cap layer.</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'recent'">
			<div v-if="recentItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<div v-for="it in recentItems" :key="it.itemId" class="flex items-center gap-1 px-1 py-0.5 rounded-sm text-xs text-fg/90 select-none cursor-pointer" :class="isSelected(it.itemId) ? 'bg-accent/30' : 'hover:bg-white/10'" :title="it.desc || it.name" @click="selectionSelectFlat(it.itemId, recentIds, $event)">
					<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
					<span class="truncate">{{ it.name }}</span>
				</div>
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic pt-12">
				<p>No recent items yet.</p>
				<p class="text-xs mt-2 opacity-60">Expand folders in the Inventory tab to populate recent items.</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'worn'">
			<div v-if="wornItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<div v-for="it in wornItems" :key="it.itemId" class="flex items-center gap-1 px-1 py-0.5 rounded-sm text-xs text-fg/90 select-none cursor-pointer" :class="isSelected(it.itemId) ? 'bg-accent/30' : 'hover:bg-white/10'" :title="it.desc || it.name" @click="selectionSelectFlat(it.itemId, wornIds, $event)">
					<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
					<span class="truncate">{{ it.name }}</span>
				</div>
			</div>
			<div v-else class="p-4 text-center text-fg-muted text-sm italic pt-12">
				<p>{{ cofFolderId ? 'Nothing worn (or still loading).' : 'No Current Outfit folder.' }}</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'favorites'">
			<div v-if="favItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<div v-for="it in favItems" :key="it.itemId" class="flex items-center gap-1 px-1 py-0.5 rounded-sm text-xs text-fg/90 select-none cursor-pointer" :class="isSelected(it.itemId) ? 'bg-accent/30' : 'hover:bg-white/10'" :title="it.desc || it.name" @click="selectionSelectFlat(it.itemId, favIds, $event)">
					<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
					<span class="truncate">{{ it.name }}</span>
				</div>
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
				<button class="ui-btn px-1" title="Show additional options" @click.stop="showCogMenu = !showCogMenu"><CogIcon /><ChevronDownIcon class="w-3" /></button>
				<div v-if="showCogMenu" class="absolute bottom-full mb-1 left-0 z-[60] min-w-[9rem] bg-panel border border-edge rounded-sm shadow-lg" @click.stop>
					<div class="px-2 py-1 text-2xs text-fg-muted border-b border-edge">Sort</div>
					<button
						v-for="o in SORT_OPTIONS"
						:key="o.id"
						class="block w-full text-left px-2 py-1 hover:bg-white/10"
						:class="inv.sortMode === o.id ? 'text-accent' : 'text-fg'"
						@click="pickSort(o.id)"
					>{{ inv.sortMode === o.id ? '✓ ' : '   ' }}{{ o.label }}</button>
				</div>
			</div>
			<div class="relative">
				<button class="ui-btn px-1" title="Add new item" @click.stop="showAddMenu = !showAddMenu"><PlusIcon /></button>
				<div v-if="showAddMenu" class="absolute bottom-full mb-1 left-0 z-[60] min-w-[10rem] bg-panel border border-edge rounded-sm shadow-lg text-xs" @click.stop>
					<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10 text-fg" @click="newFolderHere">New Folder</button>
					<div class="border-t border-edge"></div>
					<!-- red = recognised but not yet implemented -->
					<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>New Script</button>
					<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>New Notecard</button>
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
			><LuggageIcon /></button>
			<button class="ui-btn" title="Show filters - Shows the filter side menu when selected. Becomes highlighted when any filter is enabled. (TO-DO)"><FilterIcon /></button>
			<button v-if="true" class="ui-btn" title="Switch between views (TO-DO)"><ListIcon /></button>
			<button v-else class="ui-btn" title="Switch between views (TO-DO)"><TableOfContentsIcon /></button>
			<div
				:title="inv.allAgentFetched
					? `${inv.agentItemCount} items in ${inv.agentFolderCount} folders (complete)`
					: `Loading inventory… ${inv.agentFetchedCount} of ${inv.agentFolderCount} folders fetched`"
				class="grow border-2 border-edge-strong p-1 text-2xs text-fg truncate user-select-none flex items-center gap-1"
			><CheckIcon v-if="inv.allAgentFetched" class="shrink-0 text-green-400" :size="10" /><Loader2Icon v-else class="shrink-0 animate-spin opacity-60" :size="10" />{{ inv.agentItemCount.toLocaleString() }} Elements<span v-if="!inv.allAgentFetched && inv.agentFetchedCount > 0" class="opacity-60"> · {{ inv.agentFetchedCount }}/{{ inv.agentFolderCount }}</span><span v-else-if="!inv.allAgentFetched && inv.cacheLoaded" class="opacity-50"> · syncing…</span><span v-else-if="!inv.allAgentFetched" class="opacity-60"> · {{ inv.agentFetchedCount }}/{{ inv.agentFolderCount }}…</span></div>
			<button class="ui-btn" title="Remove selected item (TO-DO)"><Trash2Icon /></button>
		</div>
	</FloaterWindow>
</template>

<style scoped>
</style>
