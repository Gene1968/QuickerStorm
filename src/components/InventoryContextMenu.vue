<script setup>
// Right-click menu for inventory folders + items. State lives in inventoryStore.contextMenu.
import { computed, onMounted, onUnmounted } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { assetTypeName } from '@/utils/inventoryIcons'

const inv  = useInventoryStore()
const { createFolder } = useInventory()
const menu = computed(() => inv.contextMenu)

// Create a subfolder under the right-clicked folder, expand the parent so it shows.
function newFolder() {
	const parentId = menu.value?.obj?.folderId
	if (!parentId) return
	createFolder({ name: 'New Folder', parentId })
	if (!inv.isExpanded(parentId)) inv.toggle(parentId)
	inv.closeContextMenu()
}

const style = computed(() => {
	if (!menu.value) return {}
	const W = 190, H = 200
	return {
		left: `${Math.min(menu.value.x, window.innerWidth - W - 8)}px`,
		top:  `${Math.min(menu.value.y, window.innerHeight - H - 8)}px`,
	}
})

async function copy(text) {
	try { await navigator.clipboard.writeText(text || '') } catch { /* clipboard blocked */ }
	inv.closeContextMenu()
}

function properties() { inv.showProperties(menu.value.kind, menu.value.obj) }

function addFav() { inv.addToFavorites(menu.value.obj); inv.closeContextMenu() }

function toggleFolder() {
	inv.toggle(menu.value.obj.folderId)
	inv.closeContextMenu()
}

function onDocClick(e) {
	if (!menu.value) return
	if (e.target?.closest?.('[data-inv-context-menu]')) return
	inv.closeContextMenu()
}
function onKey(e) { if (e.key === 'Escape') inv.closeContextMenu() }

onMounted(() => {
	document.addEventListener('click', onDocClick)
	window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
	document.removeEventListener('click', onDocClick)
	window.removeEventListener('keydown', onKey)
})
</script>

<template>
	<div
		v-if="menu"
		data-inv-context-menu
		:style="style"
		class="fixed z-[200] min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg text-xs select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-edge truncate">
			{{ menu.kind === 'folder' ? menu.obj.name : menu.obj.name }}
		</div>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="properties">Properties…</button>
		<template v-if="menu.kind === 'item'">
			<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="addFav">Add to Favorites</button>
			<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="copy(menu.obj.itemId)">Copy Item UUID</button>
			<!-- grey = disabled for context (item has no asset), NOT unimplemented -->
			<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" :class="{ 'text-fg/40 cursor-not-allowed': !menu.obj.assetId }" :disabled="!menu.obj.assetId" @click="copy(menu.obj.assetId)">Copy Asset UUID</button>
			<!-- red = not yet implemented -->
			<button v-if="menu.obj.assetType == 1 || menu.obj.assetType == 20 || menu.obj.assetType == 21" class="block w-full text-left px-3 py-1.5 inv-todo" disabled>Play {{ assetTypeName(menu.obj.assetType) }}</button>
			<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>Wear / Attach</button>
			<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>Rename</button>
			<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>Delete</button>
		</template>
		<template v-else>
			<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="newFolder">New Folder</button>
			<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="copy(menu.obj.folderId)">Copy Folder UUID</button>
			<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="toggleFolder">{{ inv.isExpanded(menu.obj.folderId) ? 'Collapse' : 'Expand' }}</button>
			<!-- red = not yet implemented -->
			<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>Rename</button>
			<button class="block w-full text-left px-3 py-1.5 inv-todo" disabled>Delete</button>
		</template>
	</div>
</template>
