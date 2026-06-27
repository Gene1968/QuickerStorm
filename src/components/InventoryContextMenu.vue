<script setup>
/**
 * InventoryContextMenu — right-click menu on an inventory item or folder. Structure +
 * order mirror FS menu_inventory (lowercased, our convention); enabled items have real
 * backing today, the rest are DISABLED roadmap placeholders (most unlock with the
 * HTTP-caps inventory layer). The FS "ShareStorm" save/export cluster becomes our
 * "quickerSTORM" submenu. Rows render via <ContextMenuItem>. State lives in
 * inventoryStore.contextMenu.
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { assetTypeName } from '@/utils/inventoryIcons'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import ContextMenuItem from '@/components/ContextMenuItem.vue'

const inv  = useInventoryStore()
const { createFolder } = useInventory()
const menu = computed(() => inv.contextMenu)

// Measure + slide on-screen on both axes (flips upward near the screen bottom).
const { el: menuEl, style } = useContextMenuPosition(menu)

// Create a subfolder under the right-clicked folder, expand the parent so it shows.
function newFolder() {
	const parentId = menu.value?.obj?.folderId
	if (!parentId) return
	createFolder({ name: 'New Folder', parentId })
	if (!inv.isExpanded(parentId)) inv.toggle(parentId)
	inv.closeContextMenu()
}

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

// FS menu_inventory order, lowercased; enabled = real backing, else disabled roadmap.
// Item and folder targets show different sets, as in FS.
const items = computed(() => {
	const m = menu.value
	if (!m) return []
	if (m.kind === 'item') {
		const o = m.obj
		const isMedia = o.assetType === 1 || o.assetType === 20 || o.assetType === 21
		return [
			{
				label: 'quickerSTORM',
				submenu: [
					{ label: 'Save as…',		disabled: true },
					{ label: 'Copybot XML',		disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Open',				disabled: true },
			...(isMedia ? [{ label: `Play ${assetTypeName(o.assetType)}`, disabled: true }] : []),
			{ label: 'Properties…',							action: properties },
			{ sep: true },
			{ label: 'Wear / attach',		disabled: true },
			{ sep: true },
			{ label: 'Add to favorites',						action: addFav },
			{ label: 'Find original',		disabled: true },
			{ sep: true },
			{ label: 'Rename',				disabled: true },
			{ label: 'Delete',				disabled: true },
			{ sep: true },
			{ label: 'Copy item UUID',							action: () => copy(o.itemId) },
			{ label: 'Copy asset UUID',		disabled: !o.assetId,	action: () => copy(o.assetId) },
		]
	}
	// folder
	const o = m.obj
	return [
		{ label: 'Properties…',							action: properties },
		{ sep: true },
		{ label: 'New folder',								action: newFolder },
		{ label: 'New outfit',			disabled: true },
		{ label: 'New notecard',		disabled: true },
		{ label: 'New script',			disabled: true },
		{ sep: true },
		{ label: inv.isExpanded(o.folderId) ? 'Collapse' : 'Expand',	action: toggleFolder },
		{ sep: true },
		{ label: 'Rename',				disabled: true },
		{ label: 'Delete',				disabled: true },
		{ sep: true },
		{ label: 'Copy folder UUID',						action: () => copy(o.folderId) },
	]
})

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
		ref="menuEl"
		data-inv-context-menu
		:style="style"
		class="fixed z-[200] min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg text-xs text-fg select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-edge truncate">
			{{ menu.obj.name }}
		</div>
		<ContextMenuItem v-for="(it, i) in items" :key="i" :item="it" />
	</div>
</template>
