<script setup>
/**
 * InventoryContextMenu — right-click menu on an inventory item or folder. Structure +
 * order mirror FS menu_inventory (lowercased, our convention); enabled items have real
 * backing today, the rest are DISABLED roadmap placeholders (most unlock with the
 * HTTP-caps inventory layer). Rows render via <ContextMenuItem>. State lives in
 * inventoryStore.contextMenu.
 *
 * Rename contract: this menu does NOT inline-edit (that lives in the tree node). Instead
 * it dispatches a window CustomEvent 'inv:begin-rename' with { id, kind } where:
 *   kind='item'   → id = item.itemId
 *   kind='folder' → id = folder.folderId
 * The tree node (InventoryTreeNode or equivalent) listens for this event and activates
 * the inline input for the matching row. This is a one-way signal; no reply expected.
 */
import { computed, onMounted, onUnmounted } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { assetTypeName } from '@/utils/inventoryIcons'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import ContextMenuItem from '@/components/ContextMenuItem.vue'

const inv  = useInventoryStore()
const { createFolder, trashItem, trashFolder, wearAttachment, detach } = useInventory()
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

/**
 * Emit the 'inv:begin-rename' CustomEvent so the tree node activates its inline input.
 * Contract: { id: string, kind: 'item'|'folder' }. See module-level doc comment.
 */
function beginRename(id, kind) {
	window.dispatchEvent(new CustomEvent('inv:begin-rename', { detail: { id, kind } }))
	inv.closeContextMenu()
}

/**
 * Wear or attach an object-inventory item (assetType 6 / invType 6).
 * Clothing/bodypart wearables (assetType 5 or 13) intentionally stay DISABLED — they
 * require appearance bake which is not yet implemented.
 */
function wearAttach(itemId) {
	wearAttachment(itemId)
	inv.closeContextMenu()
}

/** Detach an attachment. Harmless to call for non-attached items. */
function doDetach(itemId) {
	detach(itemId)
	inv.closeContextMenu()
}

/** Move item to Trash folder. */
function deleteItem(itemId) {
	trashItem(itemId)
	inv.closeContextMenu()
}

/**
 * Move folder to Trash. Guard: system folders (typeDefault >= 0) must never be trashed.
 * typeDefault < 0 means a plain user-created folder.
 */
function deleteFolder(folderId) {
	trashFolder(folderId)
	inv.closeContextMenu()
}

// FS menu_inventory order, lowercased; enabled = real backing, else disabled roadmap.
// Item and folder targets show different sets, as in FS.
const items = computed(() => {
	const m = menu.value
	if (!m) return []
	if (m.kind === 'item') {
		const o = m.obj
		const isMedia    = o.assetType === 1 || o.assetType === 20 || o.assetType === 21
		// Objects (assetType 6, invType 6) can be attached via RezAttachmentFromInv.
		const isObject   = o.assetType === 6
		// Wearables (clothing assetType 5, bodypart assetType 13) need appearance bake → disabled.
		const isWearable = o.assetType === 5 || o.assetType === 13
		return [
			{
				label: 'quickerSTORM',
				submenu: [
					{ label: 'Save as…',		disabled: true },
					{ label: 'Copybot XML',		disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Share',								disabled: true },
			{ label: 'Open',								disabled: true },
			{ label: 'Properties…',							action: properties },
			{ label: 'Rename',								action: () => beginRename(o.itemId, 'item') },
			{ label: 'Image…',								disabled: true },
			{ label: 'Copy asset UUID',						disabled: !o.assetId,	action: () => copy(o.assetId) },
			{ label: 'Copy item UUID',						action: () => copy(o.itemId) },
			{ label: 'Restore to last position',								disabled: true },
			{ sep: true },
			{ label: 'Copy',								disabled: true },
			{ label: 'Cut',									disabled: true },
			{ label: 'Paste',								disabled: true },
			{ label: 'Find all links',						disabled: true },
			{ label: 'Replace links',						disabled: true },
			{ sep: true },
			{ label: 'Delete',								action: () => deleteItem(o.itemId) },
			{ label: 'Move to default folder',						disabled: true },
			{ sep: true },
			{ label: 'Create folder from selected',						disabled: true },
			{ label: 'Add to favorites',					action: addFav },
			...(isMedia ? [{ label: `Play ${assetTypeName(o.assetType)}`, disabled: true }] : []),
			// Objects → wearAttachment; Wearables → disabled with tooltip (needs appearance bake).
			isObject
			? { label: 'Wear / attach',					action: () => wearAttach(o.itemId) }
			: { label: 'Wear / attach',	disabled: true,
			title: isWearable ? 'needs appearance bake (planned)' : undefined },
			{ label: 'Detach',
			disabled: !isObject,
			action: isObject ? () => doDetach(o.itemId) : undefined },
			{ sep: true },
			{ label: 'Find original',		disabled: true },
		]
	}
	// folder
	const o = m.obj
	// System folders (typeDefault >= 0: Objects, Clothing, Trash, etc.) must not be trashed.
	const isSystemFolder = Number(o.typeDefault) >= 0
	return [
		{ label: 'Properties…',							action: properties },
		{ sep: true },
		{ label: 'Share',				disabled: true },
		{ label: 'New folder',								action: newFolder },
		{ label: 'New script',			disabled: true },
		{ label: 'New notecard',		disabled: true },
		{ label: 'New gesture',			disabled: true },
		{ label: 'New outfit',			disabled: true },
		{ label: 'New material',		disabled: true },
		{ label: 'Rename',								action: () => beginRename(o.folderId, 'folder') },
		{ label: 'Image…',				disabled: true },
		{ label: 'Protect',				disabled: true },
		{ label: 'Reload folder',		disabled: true },
		{ label: 'Copy folder UUID',					action: () => copy(o.folderId) },
		{ label: 'Show in new window',	disabled: true },
		{ sep: true },
		{ label: 'Open in new window',	disabled: true },
		{ sep: true },
		{ label: 'Copy',				disabled: true },
		{ label: 'Cut',					disabled: true },
		{ label: 'Paste',				disabled: true },
		{ label: 'Paste as link',		disabled: true },
		{ label: 'Find all links',		disabled: true },
		{
			label: 'Delete',
			disabled: isSystemFolder,
			title: isSystemFolder ? 'system folders cannot be deleted' : undefined,
			action: isSystemFolder ? undefined : () => deleteFolder(o.folderId),
		},
		{ sep: true },
		{ label: 'Create folder from selected',	disabled: true },
		{ label: 'Ungroup folder items',		disabled: true },
		{ label: 'Add to favorites',			disabled: true },
		{ label: inv.isExpanded(o.folderId) ? 'Collapse' : 'Expand',	action: toggleFolder },
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
		<div class="px-3 py-0 text-accent font-medium border-b border-edge truncate">
			{{ menu.obj.name }}
		</div>
		<ContextMenuItem v-for="(it, i) in items" :key="i" :item="it" />
	</div>
</template>
