<script setup>
// Recursive inventory folder row. Self-references by filename (Vue 3 SFC recursion).
import { computed, inject } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@lucide/vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon, folderIcon } from '@/utils/inventoryIcons'

const props = defineProps({
	folderId: { type: String, required: true },
	depth:    { type: Number, default: 0 },
})

const inv    = useInventoryStore()
const { fetchFolder } = useInventory()
const f      = inject('invFilter')
const invSel = inject('invSelection')

const folder   = computed(() => inv.folders.get(props.folderId))
const children = computed(() => inv.childFolders(props.folderId).filter(c => f.folderHasMatch(c.folderId)))
const visible  = computed(() => f.folderHasMatch(props.folderId))
// WHY: while filtering, auto-open matching folders so hits are revealed without manual expand.
const open     = computed(() => inv.isExpanded(props.folderId) || f.filtersActive.value)
const loading  = computed(() => inv.isFetching(props.folderId))
const fIcon    = computed(() => folderIcon(folder.value?.typeDefault, open.value))
const selected  = computed(() => invSel.isSelected(props.folderId))
const isAnchor  = computed(() => invSel.anchorId.value === props.folderId)
// FS-style "(items/folders)" recursive descendant count badge.
const counts   = computed(() => inv.descendantCounts(props.folderId))
// Item list: when filters active show only matching items; if folder name matched (text only), all.
const items    = computed(() => {
	let all = inv.folderItems(props.folderId)
	if (f.filtersActive.value && !(f.filtering.value && f.typeFilter.value === 'all' && f.folderNameMatches(props.folderId))) {
		all = all.filter(it => f.itemVisible(it))
	}
	return inv.sortItems(all)
})
const empty    = computed(() => !f.filtersActive.value && inv.isFetched(props.folderId) && children.value.length === 0 && inv.folderItems(props.folderId).length === 0)

// WHY: indent each level; chevron column is fixed so folder glyphs line up.
const padLeft  = computed(() => `${props.depth * 0.85 + 0.25}rem`)
const itemPad  = computed(() => `${(props.depth + 1) * 0.85 + 1.1}rem`)

// Build the "(no copy)(no modify)(no transfer)" suffix for an item row.
function permTags(it) {
	const t = []
	if (it.canCopy === false)     t.push('no copy')
	if (it.canModify === false)   t.push('no modify')
	if (it.canTransfer === false) t.push('no transfer')
	return t
}

// WHY: single-click selects (highlight); expand is via the chevron or a double-click — matches FS,
// so browsing/selecting doesn't keep collapsing folders. Fetch items lazily on expand.
function onSelect(id, event)  { invSel.selectionSelect(id, event) }
function toggleExpand() {
	invSel.selectionSelect(props.folderId, {})
	inv.toggle(props.folderId)
	if (inv.isExpanded(props.folderId)) fetchFolder(props.folderId)
}
// WHY: right-clicking an already-selected row keeps the multi-selection so a future
// "Delete X items" context menu action can act on all of them. Clicking an unselected
// row first clears to a single selection (standard file-manager behavior).
function onContextMenuFolder(event) {
	if (!invSel.isSelected(props.folderId)) invSel.selectionSelect(props.folderId, {})
	inv.openContextMenu(event.clientX, event.clientY, 'folder', folder.value)
}
function onContextMenuItem(event, it) {
	if (!invSel.isSelected(it.itemId)) invSel.selectionSelect(it.itemId, {})
	inv.openContextMenu(event.clientX, event.clientY, 'item', it)
}
</script>

<template>
	<div v-if="folder && visible">
		<div
			class="flex items-center gap-1 px-1 py-0.5 rounded-sm cursor-pointer text-xs text-t1 select-none"
			:class="selected ? 'bg-accent/30' : 'hover:bg-white/10'"
			:style="{ paddingLeft: padLeft }"
			@click="onSelect(folderId, $event)"
			@dblclick="toggleExpand"
			@contextmenu.prevent.stop="onContextMenuFolder($event)"
		>
			<component :is="open ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 shrink-0 opacity-60 hover:opacity-100" @click.stop="toggleExpand" />
			<span class="shrink-0">{{ fIcon }}</span>
			<span class="truncate">{{ folder.name }}</span>
			<!-- FS-style count shown only for the anchor (last individually clicked) folder, in parens. -->
			<span v-if="isAnchor" class="shrink-0 ml-auto pl-1 text-2xs text-white/55 tabular-nums">({{ counts.items }}/{{ counts.folders }})</span>
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
				class="flex items-center gap-1 px-1 py-0.5 rounded-sm text-xs text-t1/90 select-none cursor-pointer"
				:class="invSel.isSelected(it.itemId) ? 'bg-accent/30' : 'hover:bg-white/10'"
				:style="{ paddingLeft: itemPad }"
				:title="it.desc || it.name"
				@click="invSel.selectionSelect(it.itemId, $event)"
				@contextmenu.prevent.stop="onContextMenuItem($event, it)"
			>
				<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
				<span class="truncate">{{ it.name }}</span>
				<span v-for="tag in permTags(it)" :key="tag" class="shrink-0 text-2xs text-amber-400/70">({{ tag }})</span>
			</div>
			<div v-if="loading" class="px-1 py-0.5 text-2xs italic text-white/40" :style="{ paddingLeft: itemPad }">Loading…</div>
			<div v-else-if="empty" class="px-1 py-0.5 text-2xs italic text-white/30" :style="{ paddingLeft: itemPad }">(empty)</div>
		</template>
	</div>
</template>
