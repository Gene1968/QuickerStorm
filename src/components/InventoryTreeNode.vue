<script setup>
// Recursive inventory folder row. Self-references by filename (Vue 3 SFC recursion).
import { computed, inject, ref, shallowRef, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@lucide/vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useUiStore } from '@/stores/uiStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon, folderIcon } from '@/utils/inventoryIcons'
import { useInventoryThumbnail } from '@/composables/useInventoryThumbnail'
import TexturePreviewTooltip, { clampPreviewPosition } from '@/components/TexturePreviewTooltip.vue'

const props = defineProps({
	folderId: { type: String, required: true },
	depth:    { type: Number, default: 0 },
})

const inv    = useInventoryStore()
const ui     = useUiStore()
const { fetchFolder, renameItem, renameFolder, trashItem, trashFolder, moveItem, moveFolder, openInventoryItem } = useInventory()
const { thumbnailFor } = useInventoryThumbnail()
const f      = inject('invFilter')
const invSel = inject('invSelection')
// WHY: scope global inv:begin-rename to this floater (null when mounted outside a floater, e.g. tests).
const invFloaterId = inject('invFloaterId', null)
// This floater's expand-state key (per-window). Fallback for standalone mounts (e.g. tests).
const myFid = computed(() => invFloaterId?.value || '__inv_default__')
function isMyFloaterFocused() {
	return !invFloaterId || ui.floaterStack.at(-1) === invFloaterId.value
}

const folder   = computed(() => inv.folders.get(props.folderId))
const children = computed(() => inv.childFolders(props.folderId).filter(c => f.folderHasMatch(c.folderId)))
const visible  = computed(() => f.folderHasMatch(props.folderId))
// WHY: while filtering, folders auto-open to reveal matches — but (FS-style) a click can still
// collapse an individual folder during the filter, tracked in the filter-collapse overlay so it
// doesn't disturb the normal expand set. With no filter, the normal per-window expand state drives.
const open     = computed(() => f.filtersActive.value
	? !inv.isFilterCollapsed(myFid.value, props.folderId)
	: inv.isExpanded(myFid.value, props.folderId))
const loading  = computed(() => inv.isFetching(props.folderId))
const fIcon    = computed(() => folderIcon(folder.value?.typeDefault, open.value))
// FS labels the agent root "Inventory" (the grid skeleton names it "My Inventory").
const displayName = computed(() => props.folderId === inv.rootId ? 'Inventory' : (folder.value?.name ?? ''))
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

// WHY: indent each level; chevron column is fixed so folder glyphs line up.
const padLeft  = computed(() => `${props.depth * 0.75 + 0.125}rem`)
const itemPad  = computed(() => `${(props.depth + 1) * 0.85 + 1}rem`)

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
	if (f.filtersActive.value) {
		// During a filter, toggle the per-window collapse overlay so this folder collapses/re-opens
		// independently without touching the normal expand set. Contents are already fetched (matched).
		inv.toggleFilterCollapse(myFid.value, props.folderId)
		return
	}
	inv.toggle(myFid.value, props.folderId)
	if (inv.isExpanded(myFid.value, props.folderId)) fetchFolder(props.folderId)
}
// WHY: right-clicking an already-selected row keeps the multi-selection so context-menu
// actions ("Delete 3 items", Copy-UUID) act on all of them (FS behavior). Right-clicking an
// UNselected row first clears to a single selection (standard file-manager behavior). When
// the clicked row IS part of a >1 selection, pass the whole set as `targets`; otherwise a
// single target (just the clicked row).
function contextTargetsFor(id, clickedKind, clickedObj) {
	const sel = invSel.selectedIds.value
	if (sel.size > 1 && sel.has(id)) {
		// Anchor (clicked row) first, then the rest of the selection resolved to { kind, obj }.
		const rest = [...sel].filter(x => x !== id).map(x => inv.resolveTarget(x)).filter(Boolean)
		return [{ kind: clickedKind, obj: clickedObj }, ...rest]
	}
	return [{ kind: clickedKind, obj: clickedObj }]
}
function onContextMenuFolder(event) {
	if (!invSel.isSelected(props.folderId)) invSel.selectionSelect(props.folderId, {})
	const targets = contextTargetsFor(props.folderId, 'folder', folder.value)
	inv.openContextMenu(event.clientX, event.clientY, 'folder', folder.value, targets)
}
function onContextMenuItem(event, it) {
	if (!invSel.isSelected(it.itemId)) invSel.selectionSelect(it.itemId, {})
	const targets = contextTargetsFor(it.itemId, 'item', it)
	inv.openContextMenu(event.clientX, event.clientY, 'item', it, targets)
}

// ── Inline rename ────────────────────────────────────────────────────────────
// renaming.id = the id currently being renamed; renaming.kind = 'folder'|'item'
const renaming     = ref({ id: null, kind: null })
const renameInput  = ref(null)
const renameVal    = ref('')

function beginRename(id, kind) {
	// Only handle rows this node owns (folder = folderId, items = itemId in this folder).
	const owns = kind === 'folder'
		? id === props.folderId
		: items.value.some(it => it.itemId === id)
	if (!owns) return
	renaming.value = { id, kind }
	const name = kind === 'folder'
		? (folder.value?.name ?? '')
		: (items.value.find(it => it.itemId === id)?.name ?? '')
	renameVal.value = name
	nextTick(() => {
		// WHY: when ref="renameInput" appears inside a v-for, Vue 3 fills it as an array.
		// Unwrap either form so focus() works regardless of whether this is a folder or item row.
		const el = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value
		if (el) { el.focus(); el.select() }
	})
}

function commitRename() {
	const { id, kind } = renaming.value
	const val = renameVal.value.trim()
	if (val && id) {
		if (kind === 'folder') {
			renameFolder(id, val)
		} else {
			// renameItem needs folderId to look up the current item for unchanged fields.
			const parentFolderId = inv.folderItems(props.folderId).some(it => it.itemId === id)
				? props.folderId
				: ''
			renameItem(id, parentFolderId, val)
		}
	}
	renaming.value = { id: null, kind: null }
	renameVal.value = ''
}

function cancelRename() {
	renaming.value = { id: null, kind: null }
	renameVal.value = ''
}

function onRenameKey(e) {
	if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
	if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
}

// ── Delete key handler (attached to tree rows via keydown on the folder/item divs) ──
// WHY: guard system folders (typeDefault >= 0) — match FS; items never need a confirm.
// Folder with children gets a confirm; everything else trashes directly (FS behavior).

// Rendered row order of a folder's contents (child folder rows first, then item rows) — mirrors
// the template so "next sibling" means the next row the user actually sees. Applies the same
// filter rules as `children`/`items` above but for an ARBITRARY parent (a deleted folder's
// siblings live in ITS parent, which this node doesn't otherwise render).
function _rowOrderOf(parentId) {
	let subs = inv.childFolders(parentId)
	if (f.filtersActive.value) subs = subs.filter(c => f.folderHasMatch(c.folderId))
	let its = inv.folderItems(parentId)
	if (f.filtersActive.value && !(f.filtering.value && f.typeFilter.value === 'all' && f.folderNameMatches(parentId))) {
		its = its.filter(it => f.itemVisible(it))
	}
	return [...subs.map(c => c.folderId), ...inv.sortItems(its).map(i => i.itemId)]
}

// WHY: FS selects the next row after a keyboard delete — LLFolderView::removeSelectedItems
// (llfolderview.cpp:775-846) picks getNextUnselectedItem(): the next visible row, else the
// previous one (llfolderview.cpp:2227-2244). We scope it to the same folder per the row order
// above, falling back to the parent folder row when the folder had no other row left.
function nextRowAfterDelete(deletedId, parentId) {
	const rows = _rowOrderOf(parentId)
	const idx = rows.indexOf(deletedId)
	if (idx === -1) return parentId || null
	return rows[idx + 1] ?? rows[idx - 1] ?? parentId ?? null
}

// WHY focus hand-off: after the delete the focused row unmounts and focus falls to <body>, so a
// second Del press would go dead. FS re-anchors keyboard focus on the new selection
// (llfolderview.cpp:818 setSelection(..., hasFocus) + :846 scrollToShowSelection); mirror that by
// focusing the new row's div. Scope the lookup to this floater's scroll container (data-inv-id
// repeats across inventory windows). closest() runs synchronously — the deleted row's DOM node is
// still mounted here; the query waits for the post-mutation render.
function focusRowAfterDelete(e, id) {
	const scope = e.target?.closest?.('.overflow-y-auto') || document
	nextTick(() => {
		// globalThis.CSS: absent in the unit-test DOM; inventory ids are UUIDs so raw is safe there.
		const sel = globalThis.CSS?.escape?.(id) ?? id
		const el = scope.querySelector(`[data-inv-id="${sel}"]`)
		el?.focus?.({ preventScroll: true })
		el?.scrollIntoView?.({ block: 'nearest' })
	})
}

function onDeleteFolder(e) {
	if (renaming.value.id) return   // don't trash while editing
	if (e.key !== 'Delete' && e.key !== 'Backspace') return
	const f2 = folder.value
	if (!f2) return
	if (Number(f2.typeDefault) >= 0) return   // system folder — can't trash
	// Already in Trash → no-op, like trashFolder's own guard (commit 0283c6a): FS greys out
	// Delete there, so neither the move NOR a selection change may happen.
	if (inv.isInTrash(props.folderId)) return
	const { items: ci, folders: cf } = counts.value
	if (ci + cf > 0) {
		// Confirm only for non-empty folders.
		if (!window.confirm(`Move "${f2.name}" and its ${ci + cf} contents to Trash?`)) return
	}
	// Compute BEFORE the trash mutates the store (the row leaves its parent's lists immediately).
	const nextId = nextRowAfterDelete(props.folderId, f2.parentId)
	trashFolder(props.folderId)
	if (nextId) {
		invSel.selectionSelect(nextId, {})
		focusRowAfterDelete(e, nextId)
	}
}

function onDeleteItem(e, it) {
	if (renaming.value.id) return
	if (e.key !== 'Delete' && e.key !== 'Backspace') return
	// Already in Trash → no-op (mirrors trashItem's guard, commit 0283c6a) — selection stays put.
	if (inv.isInTrash(it.itemId)) return
	// Compute BEFORE the trash mutates the store (optimistic move drops the row instantly).
	const nextId = nextRowAfterDelete(it.itemId, props.folderId)
	trashItem(it.itemId)
	if (nextId) {
		invSel.selectionSelect(nextId, {})
		focusRowAfterDelete(e, nextId)
	}
}

// ── F2 rename (keyboard shortcut for selected row) ──
function onKeydownFolder(e) {
	if (e.key === 'F2' && invSel.isSelected(props.folderId)) {
		e.preventDefault()
		beginRename(props.folderId, 'folder')
	}
	onDeleteFolder(e)
}

function onKeydownItem(e, it) {
	if (e.key === 'F2' && invSel.isSelected(it.itemId)) {
		e.preventDefault()
		beginRename(it.itemId, 'item')
	}
	onDeleteItem(e, it)
}

// ── Custom event listener for inv:begin-rename (dispatched by context menu etc.) ──
function onBeginRenameEvent(e) {
	const { id, kind } = e.detail || {}
	if (!id || !kind) return
	if (!isMyFloaterFocused()) return   // another inventory window is focused — let it handle the rename
	beginRename(id, kind)
}

// WHY: capture-phase scroll catches scrolling on any ancestor (the tree's overflow
// container), not just window — so the fixed-position preview is dismissed when the row
// scrolls out from under the cursor.
onMounted(() => {
	window.addEventListener('inv:begin-rename', onBeginRenameEvent)
	window.addEventListener('scroll', hidePreview, true)
})
onUnmounted(() => {
	window.removeEventListener('inv:begin-rename', onBeginRenameEvent)
	window.removeEventListener('scroll', hidePreview, true)
	hidePreview()
})

// ── Drag & drop ──────────────────────────────────────────────────────────────
// dragging.id / dragging.kind is set in the dragstart handler of each row.
const dropTarget = ref(null)   // folderId currently highlighted as a valid drop target

function onDragStartItem(e, it) {
	// Shared store payload is the source of truth (always readable in dragover/drop, cross-floater).
	// dataTransfer is still set so the browser treats the gesture as a real move drag.
	// NOTE: native HTML5 DnD hit-testing is offset under Chrome DevTools device emulation (a Chromium
	// bug — the emulation scale isn't applied to drag coords); works correctly with emulation off.
	// WHY: file-manager default — if the dragged row is part of a >1 multi-selection, drag ALL selected
	// items. Folders can't be multi-moved this release, so a selection mixing folders falls back to the
	// single anchor. Dragging an UNselected row never disturbs the selection — it's a lone-item drag.
	const sel = invSel.selectedIds.value
	let ids = [it.itemId]
	let kind = 'item'
	if (sel.size > 1 && sel.has(it.itemId)) {
		ids = [it.itemId, ...[...sel].filter(id => id !== it.itemId)]
		kind = dragKindFor(ids)
	}
	inv.setDrag(ids, kind)
	// WHY 'copyMove' not 'move': the rez (world) + give (profile/IM) drop zones request dropEffect='copy';
	// per the HTML5 DnD spec a dropEffect outside effectAllowed is rejected and the drop is SUPPRESSED, so
	// effectAllowed='move' silently blocked every rez/give drop. 'copyMove' permits both move and copy.
	e.dataTransfer.effectAllowed = 'copyMove'
	try { e.dataTransfer.setData('text/plain', it.itemId) } catch { /* some browsers restrict */ }
}

// Classify a drag payload by what its ids contain: 'folder' (all folders), 'item' (all items),
// or 'mixed' (both). The drop handler dispatches per-id anyway, but the kind drives dragover
// hit-testing (a pure-folder drag must reject self/descendant targets).
function dragKindFor(ids) {
	let hasFolder = false, hasItem = false
	for (const id of ids) { if (inv.folders.has(id)) hasFolder = true; else hasItem = true }
	if (hasFolder && hasItem) return 'mixed'
	return hasFolder ? 'folder' : 'item'
}

function onDragStartFolder(e) {
	// WHY: dragging a folder that's part of a multi-selection carries ALL selected ids (anchor
	// first), matching the item path so mixed item+folder selections move together (FS behavior).
	const sel = invSel.selectedIds.value
	let ids = [props.folderId]
	let kind = 'folder'
	if (sel.size > 1 && sel.has(props.folderId)) {
		ids = [props.folderId, ...[...sel].filter(id => id !== props.folderId)]
		kind = dragKindFor(ids)
	}
	inv.setDrag(ids, kind)
	// Match the item drag path: 'copyMove' so a copy-effect drop zone isn't spec-rejected.
	e.dataTransfer.effectAllowed = 'copyMove'
	try { e.dataTransfer.setData('text/plain', props.folderId) } catch { /* some browsers restrict */ }
}

function onDragEnd() { inv.clearDrag() }

// Walk the folder tree upward from `targetId`; return true if `ancestorId` is an ancestor-or-equal.
// WHY: guards against dropping a folder into one of its own descendants (would create a cycle).
function isSelfOrDescendant(targetId, ancestorId) {
	let cur = targetId
	const seen = new Set()
	while (cur) {
		if (cur === ancestorId) return true
		if (seen.has(cur)) break   // cycle guard (shouldn't happen in practice)
		seen.add(cur)
		cur = inv.folders.get(cur)?.parentId ?? ''
	}
	return false
}

function onDragOverFolder(e) {
	// Read the active drag from shared store state (reliable in dragover, unlike dataTransfer.getData).
	// preventDefault here is what tells the browser a drop is allowed — without it, drop never fires.
	const p = inv.dragPayload
	if (!p) return
	// WHY: a payload can carry items, folders, or a mix. Reject this target only if it's invalid for
	// EVERY dragged id (a folder can't drop into itself/a descendant; an item can't "move" into the
	// folder it's already in) — otherwise allow the drop and let onDropFolder skip the no-op ids.
	const ids = p.ids?.length ? p.ids : [p.id]
	const anyValid = ids.some(id => inv.folders.has(id)
		? !isSelfOrDescendant(props.folderId, id)   // folder: not self/descendant
		: id !== props.folderId)                     // item: not already here (best-effort)
	if (!anyValid) return
	e.preventDefault()
	e.dataTransfer.dropEffect = 'move'
	dropTarget.value = props.folderId
}

function onDragLeaveFolder() {
	if (dropTarget.value === props.folderId) dropTarget.value = null
}

function onDropFolder(e) {
	e.preventDefault()
	dropTarget.value = null
	const p = inv.dragPayload
	inv.clearDrag()
	if (!p || !p.id) return
	// WHY: dispatch per id so a single payload can carry items, folders, or a mix (FS behavior).
	// Resolve each id's kind from the store (folder vs item) rather than the payload's summary kind.
	// Falls back to the single anchor when ids is absent (back-compat with single-id payloads).
	for (const id of (p.ids?.length ? p.ids : [p.id])) {
		if (inv.folders.has(id)) {
			// Folder: skip self and any drop into its own descendant (would create a cycle). moveFolder
			// also no-ops a folder already parented here.
			if (id === props.folderId) continue
			if (isSelfOrDescendant(props.folderId, id)) continue
			moveFolder(id, props.folderId)
		} else {
			// Item: moveItem no-ops if it's already in the target folder.
			moveItem(id, props.folderId)
		}
	}
}

// ── Texture hover preview ──────────────────────────────────────────────────────
// FS shows a floating 256px preview when you hover a texture row. We do NOT auto-fetch
// per row (a 24k-texture account would flood the asset service); only on hover-after-delay
// do we kick the on-demand thumbnailFor() fetch. A short timer debounces fast cursor passes.
const HOVER_DELAY_MS = 350

const ASSET_TYPE_TEXTURE = 0
function isTextureItem(it) { return it && it.assetType === ASSET_TYPE_TEXTURE && !!it.assetId }

const preview = ref({ visible: false, src: null, x: 0, y: 0 })
let hoverTimer = null
let hoverItemId = null              // id the pending timer belongs to (guards stale fires)
const boundRef = shallowRef(null)   // the thumbnail Ref the resolved url is read from (cleared on hide)

// WHY: the thumbnail ref starts null and resolves async. Watch the bound ref's value so the
// image paints as soon as it decodes even if the cursor is sitting still (mousemove may never fire).
watch(() => boundRef.value && boundRef.value.value, (url) => {
	if (boundRef.value && preview.value.visible) preview.value = { ...preview.value, src: url }
})

function hidePreview() {
	if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
	hoverItemId = null
	boundRef.value = null
	preview.value = { visible: false, src: null, x: 0, y: 0 }
}

function onItemMouseEnter(e, it) {
	if (!isTextureItem(it)) return
	// Restart the debounce timer for this row; capture cursor for initial placement.
	if (hoverTimer) clearTimeout(hoverTimer)
	hoverItemId = it.itemId
	const startX = e.clientX
	const startY = e.clientY
	hoverTimer = setTimeout(() => {
		hoverTimer = null
		// Pointer may have left (mouseleave clears hoverItemId) before the timer fired.
		if (hoverItemId !== it.itemId) return
		// Kick the on-demand fetch (no-op if already cached) and bind to its reactive ref.
		const urlRef = thumbnailFor(it)
		boundRef.value = urlRef
		const { x, y } = clampPreviewPosition(startX, startY, window.innerWidth, window.innerHeight)
		preview.value = { visible: true, src: urlRef.value, x, y }
	}, HOVER_DELAY_MS)
}

// WHY: the thumbnail ref starts null and resolves async; while the preview is open, mirror
// the bound ref's latest value into preview.src on each move so the image appears once decoded.
function onItemMouseMove(e, it) {
	if (!preview.value.visible || hoverItemId !== it.itemId) return
	const { x, y } = clampPreviewPosition(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
	preview.value = { visible: true, src: boundRef.value ? boundRef.value.value : preview.value.src, x, y }
}

function onItemMouseLeave() { hidePreview() }
</script>

<template>
	<div v-if="folder && visible">
		<div
			class="flex items-center gap-1 px-1 py-[1px] rounded-sm cursor-pointer text-xs text-fg select-none"
			:class="[
				selected ? 'bg-accent/50' : 'hover:bg-accent/20',
				dropTarget === folderId ? 'ring-1 ring-inset ring-accent/70 bg-accent/15' : '',
			]"
			:style="{ paddingLeft: padLeft }"
			:data-inv-id="folderId"
			tabindex="0"
			draggable="true"
			@click="onSelect(folderId, $event)"
			@dblclick="toggleExpand"
			@contextmenu.prevent.stop="onContextMenuFolder($event)"
			@keydown="onKeydownFolder"
			@dragstart="onDragStartFolder"
			@dragend="onDragEnd"
			@dragover="onDragOverFolder"
			@dragleave="onDragLeaveFolder"
			@drop="onDropFolder"
		>
			<component :is="open ? ChevronDownIcon : ChevronRightIcon" class="w-3 h-3 shrink-0 opacity-60 hover:opacity-100" @click.stop="toggleExpand" />
			<span class="shrink-0">{{ fIcon }}</span>
			<!-- Inline rename input swaps in when this folder is being renamed. -->
			<template v-if="renaming.id === folderId && renaming.kind === 'folder'">
				<input
					ref="renameInput"
					v-model="renameVal"
					class="flex-1 min-w-0 bg-card border border-accent rounded-sm px-1 py-0 text-xs text-fg focus:outline-none"
					@keydown="onRenameKey"
					@blur="commitRename"
					@click.stop
				/>
			</template>
			<template v-else>
				<span class="whitespace-nowrap">{{ displayName }}</span>
			</template>
			<!-- FS-style count shown only for the anchor (last individually clicked) folder, in parens. -->
			<span v-if="isAnchor && renaming.id !== folderId" class="shrink-0 ml-auto px-1 text-2xs text-fg/75 font-medium tabular-nums">({{ counts.items }}/{{ counts.folders }})</span>
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
				class="flex items-center gap-1 px-1 py-0.5 rounded-sm text-xs text-fg/90 select-none cursor-pointer"
				:class="[
					invSel.isSelected(it.itemId) ? 'bg-accent/30' : 'hover:bg-white/10',
					dropTarget === folderId ? 'bg-accent/15' : '',
				]"
				:style="{ paddingLeft: itemPad }"
				:data-inv-id="it.itemId"
				:title="it.desc || it.name"
				tabindex="0"
				draggable="true"
				@click="invSel.selectionSelect(it.itemId, $event)"
				@dblclick="openInventoryItem(it)"
				@contextmenu.prevent.stop="onContextMenuItem($event, it)"
				@keydown="onKeydownItem($event, it)"
				@dragstart="onDragStartItem($event, it)"
				@dragend="onDragEnd"
				@dragover="onDragOverFolder"
				@dragleave="onDragLeaveFolder"
				@drop="onDropFolder"
				@mouseenter="onItemMouseEnter($event, it)"
				@mousemove="onItemMouseMove($event, it)"
				@mouseleave="onItemMouseLeave"
			>
				<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
				<!-- Inline rename input swaps in when this item is being renamed. -->
				<template v-if="renaming.id === it.itemId && renaming.kind === 'item'">
					<input
						ref="renameInput"
						v-model="renameVal"
						class="flex-1 min-w-0 bg-card border border-accent rounded-sm px-1 py-0 text-xs text-fg focus:outline-none"
						@keydown="onRenameKey"
						@blur="commitRename"
						@click.stop
					/>
				</template>
				<template v-else>
					<span class="whitespace-nowrap">{{ it.name }}</span>
					<span v-for="tag in permTags(it)" :key="tag" class="shrink-0 text-2xs text-amber-400/70">({{ tag }})</span>
				</template>
			</div>
			<div v-if="loading" class="px-1 py-0.5 text-2xs italic text-fg/40" :style="{ paddingLeft: itemPad }">Loading…</div>
		</template>
		<!-- Teleport to body so the fixed preview is never clipped by a scroll/overflow ancestor. -->
		<Teleport to="body">
			<TexturePreviewTooltip
				v-if="preview.visible"
				:src="preview.src"
				:x="preview.x"
				:y="preview.y"
			/>
		</Teleport>
	</div>
</template>
