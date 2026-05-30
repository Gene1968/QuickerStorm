<script setup>
import { ref, computed, watch } from 'vue'
import { useUiStore, MAX_INVENTORY, INVENTORY_DEFAULT_POS } from '@/stores/uiStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon, FOLDER_FAVORITES, FOLDER_CURRENT_OUTFIT } from '@/utils/inventoryIcons'
import FloaterWindow   from '@/components/FloaterWindow.vue'
import InventoryTreeNode from '@/components/InventoryTreeNode.vue'
import { ChevronDownIcon, EyeIcon, ChevronRightIcon, ChevronLastIcon, CogIcon, PlusIcon, LuggageIcon, FilterIcon, ListIcon, TableOfContentsIcon, Trash2Icon } from '@lucide/vue'

const props = defineProps({
	index: { type: Number, default: 0 },
})

const ui  = useUiStore()
const inv = useInventoryStore()
const { fetchFolder } = useInventory()

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


// WHY: per-instance id so each floater has its own focus/z-index slot in the floater stack.
const floaterId   = computed(() => `inventory-${props.index}`)
const defaultPos  = computed(() => INVENTORY_DEFAULT_POS[props.index] ?? INVENTORY_DEFAULT_POS[0])
const title       = computed(() => props.index === 0 ? '📦 Inventory' : `📦 Inventory ${props.index + 1}`)
const isLast      = computed(() => props.index >= MAX_INVENTORY - 1)
const nextOpen    = computed(() => ui.inventoryInstances.includes(props.index + 1))


function close()        { ui.closeInventoryAt(props.index) }
function toggleNext()   { if (!isLast.value) ui.toggleInventoryAt(props.index + 1) }
</script>

<template>
	<FloaterWindow
		:id="floaterId"
		:title="title"
		:wrap-style="{ width: '15.5vw', height: '47vh', resize: 'both' }"
		:default-pos="defaultPos"
		@close="close"
		class="min-w-[18rem]"
	>
		<div class="flex p-1"><input v-model="inv.filterText" class="bg-brd2 rounded-xl w-full px-2 py-1 text-xs text-t1 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent" placeholder="Filter Inventory" type="search" /></div>
		<div class="flex flex-row items-center justify-evenly w-full mb-1 text-white">
			<div class="flex flex-row items-center justify-start w-full overflow-hidden text-2xs">
				<button class="me-2 py-0" @click="inv.collapseAll()">Collapse</button>
				<button class="me-2 py-0" @click="inv.expandAll()">Expand</button>
				<span class="me-1">Filter:</span>
				<button class="flex grow items-center justify-between me-1 py-0 whitespace-nowrap">All Types<ChevronDownIcon class="w-3" /></button>
			</div>
			<button title="Show search visibility options" class="py-0"><EyeIcon /><ChevronDownIcon class="w-3" /></button>
		</div>
		<!-- Locked edge btns, and special Tab strip w/ overflow! -->
		<div class="flex flex-row items-start w-full text-2xs text-white">
			<button v-if="true" class="arrowctrl"><ChevronLastIcon class="rotate-180" /></button>
			<button v-if="true" class="arrowctrl"><ChevronRightIcon class="rotate-180" /></button>
			<div class="w-full overflow-x-auto">
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
			<button v-if="true" class="arrowctrl"><ChevronRightIcon /></button>
			<button v-if="true" class="arrowctrl"><ChevronLastIcon /></button>
		</div>

		<template v-if="activeTab === 'inventory'">
			<div v-if="inv.rootId" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<InventoryTreeNode :folder-id="inv.rootId" />
				<InventoryTreeNode v-if="inv.libRootId" :folder-id="inv.libRootId" />
			</div>
			<div v-else class="p-4 text-center text-tm text-sm italic flex flex-col items-center gap-1 pt-12">
				<p class="mt-8 text-2xl">📦</p>
				<p>No inventory loaded.</p>
				<p class="text-xs mt-2 opacity-60">Folder tree loads at login. Folder contents (items) arrive with the Phase 3 cap layer.</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'recent'">
			<div v-if="recentItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<div v-for="it in recentItems" :key="it.itemId" class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 text-xs text-t1/90 select-none" :title="it.desc || it.name">
					<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
					<span class="truncate">{{ it.name }}</span>
				</div>
			</div>
			<div v-else class="p-4 text-center text-tm text-sm italic pt-12">
				<p>No recent items yet.</p>
				<p class="text-xs mt-2 opacity-60">Expand folders in the Inventory tab to populate recent items.</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'worn'">
			<div v-if="wornItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<div v-for="it in wornItems" :key="it.itemId" class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 text-xs text-t1/90 select-none" :title="it.desc || it.name">
					<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
					<span class="truncate">{{ it.name }}</span>
				</div>
			</div>
			<div v-else class="p-4 text-center text-tm text-sm italic pt-12">
				<p>{{ cofFolderId ? 'Nothing worn (or still loading).' : 'No Current Outfit folder.' }}</p>
			</div>
		</template>
		<template v-else-if="activeTab === 'favorites'">
			<div v-if="favItems.length" class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
				<div v-for="it in favItems" :key="it.itemId" class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 text-xs text-t1/90 select-none" :title="it.desc || it.name">
					<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
					<span class="truncate">{{ it.name }}</span>
				</div>
			</div>
			<div v-else class="p-4 text-center text-tm text-sm italic pt-12">
				<p>No favorites.</p>
				<p class="text-xs mt-2 opacity-60">Items in your Favorites folder appear here.</p>
			</div>
		</template>

		<!-- WHY: spacer only when the active tab isn't already filling the column (flex-1). -->
		<div v-if="!tabFills" class="flex-1"/>
		<div class="flex flex-row items-center justify-between shrink-0 text-xs text-white">
			<button title="Show additional options (TO-DO)" class="px-1"><CogIcon /><ChevronDownIcon class="w-3" /></button>
			<button title="Add new item (TO-DO)"><PlusIcon /></button>
			<button
				:title="isLast
					? `Maximum of ${MAX_INVENTORY} inventory floaters reached`
					: nextOpen ? `Close Inventory ${index + 2}` : `Open Inventory ${index + 2}`"
				:disabled="isLast"
				:class="isLast ? 'opacity-40 cursor-not-allowed' : nextOpen ? 'text-accent border-accent' : ''"
				@click="toggleNext"
			><LuggageIcon /></button>
			<button title="Show filters - Shows the filter side menu when selected. Becomes highlighted when any filter is enabled. (TO-DO)"><FilterIcon /></button>
			<button v-if="true" title="Switch between views (TO-DO)"><ListIcon /></button>
			<button v-else title="Switch between views (TO-DO)"><TableOfContentsIcon /></button>
			<div :title="`${inv.itemCount} Items, ${inv.folderCount} Folders`" class="grow border-2 border-brd2 p-1 text-2xs text-t1 truncate user-select-none">{{ inv.folderCount }} Folders<span v-if="inv.itemCount">, {{ inv.itemCount }} Items</span></div>
			<button title="Remove selected item (TO-DO)"><Trash2Icon /></button>
		</div>
	</FloaterWindow>
</template>

<style scoped>

</style>
