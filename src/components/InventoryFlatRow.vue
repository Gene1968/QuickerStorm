<script setup>
// Flat inventory row for the Recent / Worn / Favorites tabs. These tabs render a flat
// item list (no folders, no expand), so they can't reuse InventoryTreeNode directly —
// but they MUST carry the same row interactions as the tree: right-click context menu,
// F2/menu rename, double-click, and drag. This component mirrors InventoryTreeNode's
// item-row handlers exactly, reusing the same store + useInventory + injected selection
// plumbing — no forked rename/drag/context implementation.
import { computed, inject, ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useUiStore } from '@/stores/uiStore'
import { useInventory } from '@/composables/useInventory'
import { itemIcon } from '@/utils/inventoryIcons'

const props = defineProps({
	item:  { type: Object, required: true },
	// Ordered list of item ids in this flat tab, for shift-click range selection.
	order: { type: Array, default: () => [] },
})

const inv = useInventoryStore()
const ui = useUiStore()
const { renameItem, moveItem } = useInventory()
const invSel = inject('invSelection')
// WHY: scope global inv:begin-rename to this floater (null when mounted outside a floater, e.g. tests).
const invFloaterId = inject('invFloaterId', null)
function isMyFloaterFocused() {
	return !invFloaterId || ui.floaterStack.at(-1) === invFloaterId.value
}
// Flat tabs pass selectionSelectFlat (range uses the tab's own order, not the tree order).
const selectFlat = inject('invSelectionFlat')

const it = computed(() => props.item)
const selected = computed(() => invSel.isSelected(it.value.itemId))

// WHY: the item carries its parentId (set by the store on ingest/move) — renameItem and
// drag need the owning folder, which a flat tab doesn't otherwise know.
const parentFolderId = computed(() => it.value.parentId || '')

function permTags(item) {
	const t = []
	if (item.canCopy === false)     t.push('no copy')
	if (item.canModify === false)   t.push('no modify')
	if (item.canTransfer === false) t.push('no transfer')
	return t
}

function onSelect(event) { selectFlat(it.value.itemId, props.order, event) }

// WHY: right-clicking an already-selected row keeps the multi-selection (so a future
// multi-delete acts on all); clicking an unselected row first reduces to a single select.
function onContextMenu(event) {
	if (!invSel.isSelected(it.value.itemId)) selectFlat(it.value.itemId, props.order, {})
	inv.openContextMenu(event.clientX, event.clientY, 'item', it.value)
}

// ── Inline rename (mirrors InventoryTreeNode) ──────────────────────────────────
const renaming    = ref(false)
const renameInput = ref(null)
const renameVal   = ref('')

function beginRename(id) {
	if (id !== it.value.itemId) return   // only this row's item
	renaming.value = true
	renameVal.value = it.value.name ?? ''
	nextTick(() => {
		const el = renameInput.value
		if (el) { el.focus(); el.select() }
	})
}

function commitRename() {
	const val = renameVal.value.trim()
	if (val && renaming.value) renameItem(it.value.itemId, parentFolderId.value, val)
	renaming.value = false
	renameVal.value = ''
}

function cancelRename() {
	renaming.value = false
	renameVal.value = ''
}

function onRenameKey(e) {
	if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
	if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
}

// Double-click a row to rename (FS double-clicks open; flat tabs have no opener yet, so we
// match the tree's rename affordance — F2 and double-click both begin rename here).
function onDblClick() { beginRename(it.value.itemId) }

// F2 / Delete on the focused row, mirroring InventoryTreeNode.onKeydownItem.
function onKeydown(e) {
	if (renaming.value) return
	if (e.key === 'F2' && invSel.isSelected(it.value.itemId)) {
		e.preventDefault()
		beginRename(it.value.itemId)
	}
}

// Context menu dispatches 'inv:begin-rename'; own it only when it targets this item.
function onBeginRenameEvent(e) {
	const { id, kind } = e.detail || {}
	if (!isMyFloaterFocused()) return   // another inventory window is focused — let it handle the rename
	if (kind === 'item') beginRename(id)
}
onMounted(()   => window.addEventListener('inv:begin-rename', onBeginRenameEvent))
onUnmounted(() => window.removeEventListener('inv:begin-rename', onBeginRenameEvent))

// ── Drag (mirrors InventoryTreeNode.onDragStartItem) ───────────────────────────
function onDragStart(e) {
	const sel = invSel.selectedIds.value
	let ids = [it.value.itemId]
	if (sel.size > 1 && sel.has(it.value.itemId)) {
		const onlyItems = [...sel].every(id => !inv.folders.has(id))
		if (onlyItems) ids = [it.value.itemId, ...[...sel].filter(id => id !== it.value.itemId)]
	}
	inv.setDrag(ids, 'item')
	e.dataTransfer.effectAllowed = 'move'
	try { e.dataTransfer.setData('text/plain', it.value.itemId) } catch { /* some browsers restrict */ }
}
function onDragEnd() { inv.clearDrag() }
</script>

<template>
	<div
		class="flex items-center gap-1 px-1 py-0.5 rounded-sm text-xs text-fg/90 select-none cursor-pointer"
		:class="selected ? 'bg-accent/30' : 'hover:bg-white/10'"
		:title="it.desc || it.name"
		tabindex="0"
		draggable="true"
		@click="onSelect($event)"
		@dblclick="onDblClick"
		@contextmenu.prevent.stop="onContextMenu($event)"
		@keydown="onKeydown"
		@dragstart="onDragStart($event)"
		@dragend="onDragEnd"
	>
		<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
		<template v-if="renaming">
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
</template>
