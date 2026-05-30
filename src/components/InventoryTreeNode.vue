<script setup>
// Recursive inventory folder row. Self-references by filename (Vue 3 SFC recursion).
import { computed } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@lucide/vue'
import { useInventoryStore } from '@/stores/inventoryStore'

const props = defineProps({
	folderId: { type: String, required: true },
	depth:    { type: Number, default: 0 },
})

const inv      = useInventoryStore()
const folder   = computed(() => inv.folders.get(props.folderId))
const children = computed(() => inv.childFolders(props.folderId))
const items    = computed(() => inv.folderItems(props.folderId))
const open     = computed(() => inv.isExpanded(props.folderId))

// WHY: indent each level; chevron column is fixed so folder glyphs line up.
const padLeft  = computed(() => `${props.depth * 0.85 + 0.25}rem`)
const itemPad  = computed(() => `${(props.depth + 1) * 0.85 + 1.1}rem`)

function toggle() { inv.toggle(props.folderId) }
</script>

<template>
	<div v-if="folder">
		<div
			class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 cursor-pointer text-xs text-t1 select-none"
			:style="{ paddingLeft: padLeft }"
			@click="toggle"
		>
			<component :is="open ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 shrink-0 opacity-60" />
			<span class="shrink-0">{{ open ? '📂' : '📁' }}</span>
			<span class="truncate">{{ folder.name }}</span>
		</div>

		<template v-if="open">
			<InventoryTreeNode
				v-for="c in children"
				:key="c.folderId"
				:folder-id="c.folderId"
				:depth="depth + 1"
			/>
			<!-- Items (populated by FetchInventoryDescendents2 in slice 2; empty until then). -->
			<div
				v-for="it in items"
				:key="it.itemId"
				class="flex items-center gap-1 px-1 py-0.5 rounded hover:bg-white/10 text-xs text-t1/90 select-none"
				:style="{ paddingLeft: itemPad }"
			>
				<span class="shrink-0">📄</span>
				<span class="truncate">{{ it.name }}</span>
			</div>
		</template>
	</div>
</template>
