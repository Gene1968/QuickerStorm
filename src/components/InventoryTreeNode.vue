<script setup>
// Recursive inventory folder row. Self-references by filename (Vue 3 SFC recursion).
import { computed } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@lucide/vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon, folderIcon } from '@/utils/inventoryIcons'

const props = defineProps({
	folderId: { type: String, required: true },
	depth:    { type: Number, default: 0 },
})

const inv = useInventoryStore()
const { fetchFolder } = useInventory()
const folder   = computed(() => inv.folders.get(props.folderId))
const children = computed(() => inv.childFolders(props.folderId).filter(c => inv.folderHasMatch(c.folderId)))
const visible  = computed(() => inv.folderHasMatch(props.folderId))
// WHY: while filtering, auto-open matching folders so hits are revealed without manual expand.
const open     = computed(() => inv.isExpanded(props.folderId) || inv.filtering)
const loading  = computed(() => inv.isFetching(props.folderId))
const fIcon    = computed(() => folderIcon(folder.value?.typeDefault, open.value))
// Item list, filtered to matches unless the folder name itself matched (then show all).
const items    = computed(() => {
	const all = inv.folderItems(props.folderId)
	if (!inv.filtering || inv.folderNameMatches(props.folderId)) return all
	return all.filter(it => inv.nameMatches(it.name))
})
const empty    = computed(() => !inv.filtering && inv.isFetched(props.folderId) && children.value.length === 0 && inv.folderItems(props.folderId).length === 0)

// WHY: indent each level; chevron column is fixed so folder glyphs line up.
const padLeft  = computed(() => `${props.depth * 0.85 + 0.25}rem`)
const itemPad  = computed(() => `${(props.depth + 1) * 0.85 + 1.1}rem`)

// WHY: fetch items lazily when a folder is opened (skeleton has folders, not items).
function toggle() {
	inv.toggle(props.folderId)
	if (inv.isExpanded(props.folderId)) fetchFolder(props.folderId)
}
</script>

<template>
	<div v-if="folder && visible">
		<div
			class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 cursor-pointer text-xs text-t1 select-none"
			:style="{ paddingLeft: padLeft }"
			@click="toggle"
		>
			<component :is="open ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 shrink-0 opacity-60" />
			<span class="shrink-0">{{ fIcon }}</span>
			<span class="truncate">{{ folder.name }}</span>
		</div>

		<template v-if="open">
			<InventoryTreeNode
				v-for="c in children"
				:key="c.folderId"
				:folder-id="c.folderId"
				:depth="depth + 1"
			/>
			<!-- Items fetched via FetchInventoryDescendents2. -->
			<div
				v-for="it in items"
				:key="it.itemId"
				class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 text-xs text-t1/90 select-none"
				:style="{ paddingLeft: itemPad }"
				:title="it.desc || it.name"
			>
				<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
				<span class="truncate">{{ it.name }}</span>
			</div>
			<div v-if="loading" class="px-1 py-0.5 text-2xs italic text-white/40" :style="{ paddingLeft: itemPad }">Loading…</div>
			<div v-else-if="empty" class="px-1 py-0.5 text-2xs italic text-white/30" :style="{ paddingLeft: itemPad }">(empty)</div>
		</template>
	</div>
</template>
