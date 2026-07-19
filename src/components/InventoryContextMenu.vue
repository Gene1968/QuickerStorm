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
import { useUiStore } from '@/stores/uiStore'
import { useInventory } from '@/composables/useInventory'
import { useInventoryClipboard } from '@/composables/useInventoryClipboard'
import { useInstantMessage } from '@/composables/useInstantMessage'
import { assetTypeName } from '@/utils/inventoryIcons'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import ContextMenuItem from '@/components/ContextMenuItem.vue'

const inv  = useInventoryStore()
const ui   = useUiStore()
const { createFolder, createBlankItem, createFolderFromSelected, trashItem, trashFolder, emptyTrash, purgeItem, purgeFolder, restoreItem, restoreFolder, wearAttachment, wearWearable, detach, isItemWorn, pasteInto, giveInventory, shareToAgent, rezObject, openInventoryItem } = useInventory()
const { clipboard, setCut, setCopy, clear: clearClipboard } = useInventoryClipboard()
const im = useInstantMessage()
const menu = computed(() => inv.contextMenu)

// Full right-click selection the menu acts on. Single-select → one entry (the clicked row);
// multi-select → the clicked row (anchor) plus the rest of the selection (FS behavior).
const targets = computed(() => menu.value?.targets || [])
const itemTargets   = computed(() => targets.value.filter(t => t.kind === 'item'))
const folderTargets = computed(() => targets.value.filter(t => t.kind === 'folder'))
// System folders (typeDefault >= 0) can never be trashed — exclude them from the delete loop.
const deletableFolderTargets = computed(() => folderTargets.value.filter(t => Number(t.obj?.typeDefault) < 0))
const multi = computed(() => targets.value.length > 1)

// Delete label: plain "Delete" for a single row (unchanged from before); counts only when the
// selection is >1 → "Delete N items" / "Delete N folders" / "Delete N items, M folders" (FS).
function deleteLabel() {
	if (!multi.value) return 'Delete'
	const ni = itemTargets.value.length
	const nf = deletableFolderTargets.value.length
	const parts = []
	if (ni) parts.push(`${ni} ${ni === 1 ? 'item' : 'items'}`)
	if (nf) parts.push(`${nf} ${nf === 1 ? 'folder' : 'folders'}`)
	return parts.length ? `Delete ${parts.join(', ')}` : 'Delete'
}
// WHY: this menu is mounted ONCE globally, so expand/collapse must target whichever inventory
// window is focused (the one just right-clicked = top of the floater stack), not a shared set.
function activeFid() { return ui.floaterStack.at(-1) }

// Measure + slide on-screen on both axes (flips upward near the screen bottom).
const { el: menuEl, style } = useContextMenuPosition(menu)

// Create a subfolder under the right-clicked folder, expand the parent so it shows.
function newFolder() {
	const parentId = menu.value?.obj?.folderId
	if (!parentId) return
	createFolder({ name: 'New Folder', parentId })   // createFolder auto-expands the parent in the focused window
	inv.closeContextMenu()
}

// New notecard / script INSIDE the right-clicked folder (explicit parent = o.folderId). Double-click the
// new row to edit + save content (2-step upload cap).
function newBlankInFolder(kind) {
	const parentId = menu.value?.obj?.folderId
	if (!parentId) return
	createBlankItem({ kind, parentId })
	inv.closeContextMenu()
}

async function copy(text) {
	try { await navigator.clipboard.writeText(text || '') } catch { /* clipboard blocked */ }
	inv.closeContextMenu()
}

function properties() { inv.showProperties(menu.value.kind, menu.value.obj) }

function addFav() { inv.addToFavorites(menu.value.obj); inv.closeContextMenu() }

function toggleFolder() {
	inv.toggle(activeFid(), menu.value.obj.folderId)
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

/** 7·B-4: wear a clothing/body-part item — COF link + AgentIsNowWearing (no visual change until
 *  the bake pipeline; keeps worn-state truthful across COF, sim wearables table, Now-wearing). */
function wearClothing(item) {
	wearWearable(item)
	inv.closeContextMenu()
}

/**
 * Rez an OBJECT-inventory item into the world (~2m in front of the avatar). Enabled only for
 * object-type items (guarded again in rezObject). FS "Rez in world" on the item context menu.
 */
function rezInWorld(itemId) {
	rezObject(itemId)
	inv.closeContextMenu()
}

/**
 * Move the WHOLE selection to Trash: every selected item (trashItem) and every deletable folder
 * (trashFolder). System folders (typeDefault >= 0) are already filtered out of the loop. Single-
 * selection collapses to one call — identical to the old per-row behavior.
 */
function deleteSelection() {
	for (const t of itemTargets.value) trashItem(t.obj.itemId)
	for (const t of deletableFolderTargets.value) trashFolder(t.obj.folderId)
	inv.closeContextMenu()
}

/** Move a single folder to Trash (system-folder guard applied at the call site). */
function deleteFolder(folderId) {
	trashFolder(folderId)
	inv.closeContextMenu()
}

// SL preferred folder type for Trash (LLFolderType::FT_TRASH) — drives the short Trash menu.
const FOLDER_TYPE_TRASH = 14

/**
 * Empty Trash — FS trash-folder menu (llinventorybridge.cpp:5054 "Empty Trash") → confirm →
 * purge_descendents_of. Confirm text mirrors FS ConfirmEmptyTrash (notifications.xml:7049:
 * "[COUNT] items and folders will be permanently deleted. Are you sure you want to permanently
 * delete the contents of your Trash?"). window.confirm is this codebase's confirm pattern
 * (same as the non-empty-folder trash confirms in InventoryTreeNode.vue / InventoryFloater.vue).
 */
function emptyTrashAction() {
	const o = menu.value?.obj
	if (!o?.folderId) { inv.closeContextMenu(); return }
	const { items: ci, folders: cf } = inv.descendantCounts(o.folderId)
	if (window.confirm(`${ci + cf} items and folders will be permanently deleted. Are you sure you want to permanently delete the contents of your Trash?`)) {
		emptyTrash()
	}
	inv.closeContextMenu()
}

// FS disables Empty Trash while a WORN attachment sits in the Trash
// (llinventorybridge.cpp:5068 gAgentAvatarp->hasAttachmentsInTrash(), llvoavatarself.cpp:1785) —
// purging would delete the inventory row out from under a live attachment. Same walk here over
// the loaded descendant item lists.
function trashHasWornAttachment(trashId) {
	const stack = [trashId]
	const seen = new Set()
	while (stack.length) {
		const id = stack.pop()
		if (seen.has(id)) continue
		seen.add(id)
		for (const it of inv.folderItems(id)) if (isItemWorn(it.itemId)) return true
		for (const c of inv.childFolders(id)) stack.push(c.folderId)
	}
	return false
}

// ── Rows INSIDE Trash: FS replaces the whole normal menu with the trash menu —
// addTrashContextMenuOptions (llinventorybridge.cpp:1151-1169): "Purge Item" (disabled when
// !isItemRemovable, e.g. worn) + "Restore Item". The link-only "Find Original" and the generic
// Replace-Links / Move-to-Default tail are omitted — inventory links aren't implemented here.
// The Trash ROOT itself keeps its own Empty-Trash menu (typeDefault check below).
const inTrashSelection = computed(() => {
	const m = menu.value
	if (!m?.obj) return false
	if (m.kind === 'folder' && Number(m.obj.typeDefault) === FOLDER_TYPE_TRASH) return false
	const id = m.obj.itemId || m.obj.folderId
	return !!id && inv.isInTrash(id)
})
// FS Purge gate (llinventorybridge.cpp:1164 isItemRemovable): a worn attachment — or a folder
// still holding one — must not be purged out from under the live attachment.
const purgeBlockedByWorn = computed(() =>
	itemTargets.value.some(t => isItemWorn(t.obj.itemId)) ||
	folderTargets.value.some(t => trashHasWornAttachment(t.obj.folderId)))

function purgeSelection() {
	const n = targets.value.length
	// FS purges without an extra prompt; we confirm — RemoveInventory* is irreversible (deliberate deviation).
	const what = n > 1 ? `${n} rows` : `"${menu.value.obj.name}"`
	if (window.confirm(`Permanently delete ${what} from Trash? This cannot be undone.`)) {
		for (const t of itemTargets.value) purgeItem(t.obj.itemId)
		for (const t of folderTargets.value) purgeFolder(t.obj.folderId)
	}
	inv.closeContextMenu()
}
function restoreSelection() {
	for (const t of itemTargets.value) restoreItem(t.obj.itemId)
	for (const t of folderTargets.value) restoreFolder(t.obj.folderId)
	inv.closeContextMenu()
}

// FS gates "New folder from selected" to an all-items or all-folders selection —
// llinventorybridge.cpp:915-919 disables it unless is_only_items_selected || is_only_cats_selected.
// We additionally exclude system folders (typeDefault >= 0): they must never be moved.
const canCreateFolderFromSelected = computed(() => {
	if (!targets.value.length) return false
	const onlyItems   = folderTargets.value.length === 0
	const onlyFolders = itemTargets.value.length === 0
	if (!onlyItems && !onlyFolders) return false
	return !folderTargets.value.some(t => Number(t.obj?.typeDefault) >= 0)
})
// Create a new folder in the selection's common parent and move the whole selection into it.
// Same-parent validation (FS SameFolderRequired) happens inside createFolderFromSelected.
function createFolderFromSelection() {
	createFolderFromSelected(selectionIds())
	inv.closeContextMenu()
}

// ── Inventory clipboard (Cut / Copy / Paste), multi-aware ──────────────────────
// The selection ids the menu acts on: an item target contributes its itemId, a folder its folderId.
function selectionIds() {
	return targets.value.map(t => t.obj?.itemId || t.obj?.folderId).filter(Boolean)
}
// COPY is only meaningful for copyable items; folders are skipped on paste (folder-copy deferred).
// Enable COPY whenever any target is a copyable item OR a folder (folders can be CUT-moved).
const anyCopyableItem = computed(() => itemTargets.value.some(t => t.obj?.canCopy !== false))

// PASTE target = the right-clicked FOLDER (folder menu), or the item's parent folder (item menu).
function pasteTargetFolderId() {
	const m = menu.value
	if (!m) return ''
	if (m.kind === 'folder') return m.obj.folderId
	const found = inv.findItem(m.obj.itemId)
	return found ? found.folderId : ''
}
const canPaste = computed(() => clipboard.value.ids.length > 0 && !!pasteTargetFolderId())

// ── Give to the active IM recipient ────────────────────────────────────────
// Enabled only when an IM conversation is active AND the selection has item targets (folder-give is
// a follow-up this pass). Gives the WHOLE item selection to that agent.
const activeIm = computed(() => {
	const id = im.activeId.value
	if (!id) return null
	return im.conversations.value.get(id) || { agentId: id, agentName: id }
})
// Give the whole selection (items AND/OR folders) to the active IM recipient — shareToAgent routes each.
const canGiveToIm = computed(() => !!activeIm.value && selectionIds().length > 0)
function giveToIm() {
	const c = activeIm.value
	if (!c) { inv.closeContextMenu(); return }
	const ids = selectionIds()
	if (ids.length) shareToAgent(ids, c.agentId, c.agentName)
	inv.closeContextMenu()
}
// FS: "Open" = the double-click open-by-type dispatch (texture → preview floater, etc.).
function openItem() { const it = menu.value?.obj; if (it) openInventoryItem(it); inv.closeContextMenu() }

function cutSelection() {
	const ids = selectionIds()
	if (ids.length) setCut(ids)
	inv.closeContextMenu()
}
function copySelection() {
	const ids = selectionIds()
	if (ids.length) setCopy(ids)
	inv.closeContextMenu()
}
function pasteSelection() {
	const target = pasteTargetFolderId()
	if (target) pasteInto(clipboard.value, target, clearClipboard)
	inv.closeContextMenu()
}

/**
 * Copy UUID(s) to the clipboard. For a multi-selection, join the ids of every selected row
 * with newlines (FS behavior). `pick` extracts the wanted id from each target's obj.
 */
function copyUuids(pick) {
	const ids = targets.value.map(t => pick(t)).filter(Boolean)
	copy(ids.join('\n'))
}

// FS menu_inventory order, lowercased; enabled = real backing, else disabled roadmap.
// Item and folder targets show different sets, as in FS.
const items = computed(() => {
	const m = menu.value
	if (!m) return []
	// Rows INSIDE Trash get FS's short trash menu instead of the normal item/folder sets.
	if (inTrashSelection.value) {
		return [
			{
				label: multi.value ? `Purge ${targets.value.length} rows` : 'Purge Item',
				disabled: purgeBlockedByWorn.value,
				title: purgeBlockedByWorn.value ? 'detach the worn attachment first' : undefined,
				action: purgeBlockedByWorn.value ? undefined : purgeSelection,
			},
			{ label: multi.value ? `Restore ${targets.value.length} rows` : 'Restore Item',	action: restoreSelection },
		]
	}
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
			// "Give to <IM recipient>" — enabled only while an IM conversation is active; gives the
			// whole item selection to that agent. Arbitrary-recipient picker is a follow-up.
			...(canGiveToIm.value
				? [{ label: `Give to ${activeIm.value.agentName}`, action: giveToIm }]
				: [{ label: 'Give to…', disabled: true, title: 'open an IM conversation to give to that resident' }]),
			{ label: 'Open',								action: openItem },
			{ label: 'Properties…',							action: properties },
			// Rename is single-target only (FS hides it in a multi-selection).
			...(multi.value ? [] : [{ label: 'Rename',		action: () => beginRename(o.itemId, 'item') }]),
			{ label: 'Image…',								disabled: true },
			// Copy-UUID: single row copies the one id; multi copies newline-joined ids of the whole selection.
			{ label: multi.value ? 'Copy asset UUIDs' : 'Copy asset UUID',	disabled: !o.assetId && !multi.value,	action: () => copyUuids(t => t.obj.assetId) },
			{ label: multi.value ? 'Copy item UUIDs' : 'Copy item UUID',	action: () => copyUuids(t => t.obj.itemId || t.obj.folderId) },
			{ label: 'Restore to last position',								disabled: true },
			{ sep: true },
			{ label: 'Copy',	disabled: !anyCopyableItem.value,	action: copySelection },
			{ label: 'Cut',										action: cutSelection },
			{ label: 'Paste',	disabled: !canPaste.value,		action: pasteSelection },
			{ label: 'Find all links',						disabled: true },
			{ label: 'Replace links',						disabled: true },
			{ sep: true },
			{ label: deleteLabel(),							action: deleteSelection },
			{ label: 'Move to default folder',						disabled: true },
			{ sep: true },
			// FS "New folder from selected" (llinventorybridge.cpp:912): create a subfolder in the
			// selection's common parent and move the selection into it. Disabled for a mixed
			// item+folder selection (FS is_only_items/is_only_cats gate) or a system folder.
			{
				label: 'Create folder from selected',
				disabled: !canCreateFolderFromSelected.value,
				title: !canCreateFolderFromSelected.value ? 'select only items or only folders' : undefined,
				action: canCreateFolderFromSelected.value ? createFolderFromSelection : undefined,
			},
			{ label: 'Add to favorites',					action: addFav },
			...(isMedia ? [{ label: `Play ${assetTypeName(o.assetType)}`, disabled: true }] : []),
			// FS LLObjectBridge::buildContextMenu (llinventorybridge.cpp:8245-8272): a WORN object
			// (get_is_item_worn) offers "Detach From Yourself" INSTEAD of the Wear/Attach (and Rez)
			// rows; a non-worn object offers Wear + Rez and no Detach.
			...(isObject && isItemWorn(o.itemId)
			? [{ label: 'Detach from yourself',				action: () => doDetach(o.itemId) }]
			: [
				// Objects → wearAttachment; Wearables (7·B-4) → COF link + AgentIsNowWearing. The
				// wearable is bookkept truthfully (COF, sim wearables table, "Now wearing" floater)
				// even though nothing changes visually until the bake pipeline composites textures.
				isObject
				? { label: 'Wear / attach',					action: () => wearAttach(o.itemId) }
				: isWearable
				? { label: 'Wear',							action: () => wearClothing(o) }
				: { label: 'Wear / attach',	disabled: true },
				// Rez in world: object items only (rezObject re-guards). Rezzes ~2m in front of the avatar.
				isObject
				? { label: 'Rez in world',						action: () => rezInWorld(o.itemId) }
				: { label: 'Rez in world',	disabled: true,	title: 'only objects can be rezzed' },
			]),
			{ sep: true },
			{ label: 'Find original',		disabled: true },
		]
	}
	// folder
	const o = m.obj
	// TRASH system folder → FS's SHORT menu (llinventorybridge.cpp:5049-5075: trash_id == mUUID
	// pushes "Empty Trash" and none of the Delete/Cut/Rename/New-folder rows — it's a system
	// folder). Empty Trash is enabled "only when there is something to act upon" (:5058) and not
	// while a worn attachment sits inside (:5068 hasAttachmentsInTrash).
	if (Number(o.typeDefault) === FOLDER_TYPE_TRASH) {
		const counts = inv.descendantCounts(o.folderId)
		const isEmpty = counts.items + counts.folders === 0
		const wornInside = !isEmpty && trashHasWornAttachment(o.folderId)
		return [
			{
				label: 'Empty Trash',
				disabled: isEmpty || wornInside,
				// WHY the "(or not loaded)" hedge: descendantCounts only sees folders fetched this
				// session — an unfetched Trash reads 0 even when the grid has rows (FS disables on
				// VERSION_UNKNOWN the same way, llinventorybridge.cpp:5058).
				title: isEmpty ? 'Trash is empty (or not loaded yet — expand it first)' : (wornInside ? 'detach the worn attachment in Trash first' : undefined),
				action: (isEmpty || wornInside) ? undefined : emptyTrashAction,
			},
			{ sep: true },
			{ label: inv.isExpanded(activeFid(), o.folderId) ? 'Collapse' : 'Expand',	action: toggleFolder },
			{ label: 'Properties…',							action: properties },
		]
	}
	// System folders (typeDefault >= 0: Objects, Clothing, Trash, etc.) must not be trashed.
	const isSystemFolder = Number(o.typeDefault) >= 0
	return [
		{ label: 'Properties…',							action: properties },
		{ sep: true },
		{ label: 'Share',				disabled: true },
		// "Give to <IM recipient>" — folder-give routes the folder (+ its direct items) to that agent.
		...(canGiveToIm.value
			? [{ label: `Give to ${activeIm.value.agentName}`, action: giveToIm }]
			: [{ label: 'Give to…', disabled: true, title: 'open an IM conversation to give to that resident' }]),
		{ label: 'New folder',								action: newFolder },
		{ label: 'New script',			action: () => newBlankInFolder('script') },
		{ label: 'New notecard',		action: () => newBlankInFolder('notecard') },
		{ label: 'New gesture',			disabled: true },
		{ label: 'New outfit',			disabled: true },
		{ label: 'New material',		disabled: true },
		// Rename is single-target only (FS hides it in a multi-selection).
		...(multi.value ? [] : [{ label: 'Rename',		action: () => beginRename(o.folderId, 'folder') }]),
		{ label: 'Image…',				disabled: true },
		{ label: 'Protect',				disabled: true },
		{ label: 'Reload folder',		disabled: true },
		// Copy-UUID: single row copies the one id; multi copies newline-joined ids of the whole selection.
		{ label: multi.value ? 'Copy UUIDs' : 'Copy folder UUID',	action: () => copyUuids(t => t.obj.folderId || t.obj.itemId) },
		{ label: 'Show in new window',	disabled: true },
		{ sep: true },
		{ label: 'Open in new window',	disabled: true },
		{ sep: true },
		// Folders can be CUT (moved on paste); folder-COPY is deferred (see docs/FEATURE-GAPS.md), so
		// Copy stays disabled for folders. Paste drops the clipboard INTO this folder.
		{ label: 'Copy',				disabled: true },
		{ label: 'Cut',					action: cutSelection },
		{ label: 'Paste',				disabled: !canPaste.value,	action: pasteSelection },
		{ label: 'Paste as link',		disabled: true },
		{ label: 'Find all links',		disabled: true },
		// Multi-selection deletes every deletable target (system folders excluded); single-selection
		// keeps the exact old behavior (disabled + tooltip for a system folder).
		multi.value
		? {
			label: deleteLabel(),
			disabled: itemTargets.value.length === 0 && deletableFolderTargets.value.length === 0,
			title: deletableFolderTargets.value.length < folderTargets.value.length ? 'system folders are skipped' : undefined,
			action: deleteSelection,
		}
		: {
			label: 'Delete',
			disabled: isSystemFolder,
			title: isSystemFolder ? 'system folders cannot be deleted' : undefined,
			action: isSystemFolder ? undefined : () => deleteFolder(o.folderId),
		},
		{ sep: true },
		// FS "New folder from selected" — same action + gating as the item menu (llinventorybridge.cpp:912-919).
		{
			label: 'Create folder from selected',
			disabled: !canCreateFolderFromSelected.value,
			title: !canCreateFolderFromSelected.value ? 'select only items or only folders (no system folders)' : undefined,
			action: canCreateFolderFromSelected.value ? createFolderFromSelection : undefined,
		},
		{ label: 'Ungroup folder items',		disabled: true },
		{ label: 'Add to favorites',			disabled: true },
		{ label: inv.isExpanded(activeFid(), o.folderId) ? 'Collapse' : 'Expand',	action: toggleFolder },
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
