<script setup>
// Recursive inventory folder row. Self-references by filename (Vue 3 SFC recursion).
import { computed, inject, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { ChevronRightIcon, ChevronDownIcon } from '@lucide/vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon, folderIcon } from '@/utils/inventoryIcons'

const props = defineProps({
	folderId: { type: String, required: true },
	depth:    { type: Number, default: 0 },
})

const inv    = useInventoryStore()
const { fetchFolder, renameItem, renameFolder, trashItem, trashFolder, moveItem, moveFolder } = useInventory()
const f      = inject('invFilter')
const invSel = inject('invSelection')

const folder   = computed(() => inv.folders.get(props.folderId))
const children = computed(() => inv.childFolders(props.folderId).filter(c => f.folderHasMatch(c.folderId)))
const visible  = computed(() => f.folderHasMatch(props.folderId))
// WHY: while filtering, auto-open matching folders so hits are revealed without manual expand.
const open     = computed(() => inv.isExpanded(props.folderId) || f.filtersActive.value)
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
function onDeleteFolder(e) {
	if (renaming.value.id) return   // don't trash while editing
	if (e.key !== 'Delete' && e.key !== 'Backspace') return
	const f2 = folder.value
	if (!f2) return
	if (Number(f2.typeDefault) >= 0) return   // system folder — can't trash
	const { items: ci, folders: cf } = counts.value
	if (ci + cf > 0) {
		// Confirm only for non-empty folders.
		if (!window.confirm(`Move "${f2.name}" and its ${ci + cf} contents to Trash?`)) return
	}
	trashFolder(props.folderId)
}

function onDeleteItem(e, it) {
	if (renaming.value.id) return
	if (e.key !== 'Delete' && e.key !== 'Backspace') return
	trashItem(it.itemId)
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
	beginRename(id, kind)
}

onMounted(() => {
	window.addEventListener('inv:begin-rename', onBeginRenameEvent)
})
onUnmounted(() => {
	window.removeEventListener('inv:begin-rename', onBeginRenameEvent)
})

// ── Drag & drop ──────────────────────────────────────────────────────────────
// dragging.id / dragging.kind is set in the dragstart handler of each row.
const dropTarget = ref(null)   // folderId currently highlighted as a valid drop target

function onDragStartItem(e, it) {
	// Shared store payload is the source of truth (always readable in dragover/drop, cross-floater).
	// dataTransfer is still set so the browser treats the gesture as a real move drag.
	// NOTE: native HTML5 DnD hit-testing is offset under Chrome DevTools device emulation (a Chromium
	// bug — the emulation scale isn't applied to drag coords); works correctly with emulation off.
	inv.setDrag(it.itemId, 'item')
	e.dataTransfer.effectAllowed = 'move'
	try { e.dataTransfer.setData('text/plain', it.itemId) } catch { /* some browsers restrict */ }
}

function onDragStartFolder(e) {
	inv.setDrag(props.folderId, 'folder')
	e.dataTransfer.effectAllowed = 'move'
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
	if (p.kind === 'folder' && isSelfOrDescendant(props.folderId, p.id)) return  // no cycle, no self
	if (p.kind === 'item' && p.id === props.folderId) return
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
	if (p.id === props.folderId) return   // dropped onto itself — no-op
	if (p.kind === 'folder') {
		if (isSelfOrDescendant(props.folderId, p.id)) return  // no dropping into own descendant
		moveFolder(p.id, props.folderId)
	} else {
		moveItem(p.id, props.folderId)
	}
}
</script>

<template>
	<div v-if="folder && visible">
		<div
			class="flex items-center gap-1 px-1 py-0.5 rounded-sm cursor-pointer text-xs text-fg select-none"
			:class="[
				selected ? 'bg-accent/50' : 'hover:bg-accent/20',
				dropTarget === folderId ? 'ring-1 ring-inset ring-accent/70 bg-accent/15' : '',
			]"
			:style="{ paddingLeft: padLeft }"
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
				<span class="truncate">{{ displayName }}</span>
			</template>
			<!-- FS-style count shown only for the anchor (last individually clicked) folder, in parens. -->
			<span v-if="isAnchor && renaming.id !== folderId" class="shrink-0 ml-auto pl-1 text-2xs text-fg/55 tabular-nums">({{ counts.items }}/{{ counts.folders }})</span>
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
				:title="it.desc || it.name"
				tabindex="0"
				draggable="true"
				@click="invSel.selectionSelect(it.itemId, $event)"
				@contextmenu.prevent.stop="onContextMenuItem($event, it)"
				@keydown="onKeydownItem($event, it)"
				@dragstart="onDragStartItem($event, it)"
				@dragend="onDragEnd"
				@dragover="onDragOverFolder"
				@dragleave="onDragLeaveFolder"
				@drop="onDropFolder"
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
					<span class="truncate">{{ it.name }}</span>
					<span v-for="tag in permTags(it)" :key="tag" class="shrink-0 text-2xs text-amber-400/70">({{ tag }})</span>
				</template>
			</div>
			<div v-if="loading" class="px-1 py-0.5 text-2xs italic text-fg/40" :style="{ paddingLeft: itemPad }">Loading…</div>
			<div v-else-if="empty" class="px-1 py-0.5 text-2xs italic text-fg/30" :style="{ paddingLeft: itemPad }">(empty)</div>
		</template>
	</div>
</template>
