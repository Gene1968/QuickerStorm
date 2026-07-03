<script setup>
// Single-folder flat list — the "list view" of Firestorm's single-folder mode. FS's view_mode_btn
// flips the whole inventory tree into a one-folder view (llpanelmaininventory.cpp:2230-2321
// toggleViewMode/onViewModeClick); inside it, opening a folder DESCENDS by re-rooting the panel
// and pushing the old root onto a back history (llinventorypanel.cpp:3000-3011
// LLInventorySingleFolderPanel::changeFolderRoot, invoked from the folder bridge at
// llinventorybridge.cpp:486), while the back/up buttons pop that history / go to the parent
// (llpanelmaininventory.cpp:2323-2360 onUpFolderClicked/onBackFolderClicked; up disabled at the
// root — :3447 mUpBtn->setEnabled). We mirror that interaction model: double-click a folder row
// to descend, Back pops history, Up goes to the parent, and a clickable breadcrumb shows the path.
//
// Item rows reuse InventoryFlatRow (same rows as the Recent/Worn/Favorites tabs) so rename/drag/
// context-menu/open behavior is identical to the rest of the floater. Folder rows are local to
// this component (flat tabs never show folders) but reuse the injected selection + context-menu
// plumbing, so multi-select and right-click actions behave exactly like the tree.
import { computed, inject, watch } from 'vue'
import { ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useInventory } from '@/composables/useInventory'
import { folderIcon } from '@/utils/inventoryIcons'
import InventoryFlatRow from '@/components/InventoryFlatRow.vue'

const props = defineProps({
	// Current single-folder root. The floater owns it so the position survives tab switches
	// and the tree⇄list toggle can hand the folder back to the tree (FS keeps root on the panel).
	rootId: { type: String, required: true },
	// Back history (folderIds, oldest first) — owned by the floater for the same reason.
	backStack: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:rootId', 'update:backStack'])

const inv = useInventoryStore()
const { fetchFolder } = useInventory()
const f      = inject('invFilter', null)
const invSel = inject('invSelection')
// Flat rows select via the flat path: shift-range uses THIS view's row order, not the tree order.
const selectFlat = inject('invSelectionFlat')

// Fetch the current folder's contents lazily, like a tree expand does.
watch(() => props.rootId, (id) => { if (id) fetchFolder(id) }, { immediate: true })

// ── Navigation (FS changeFolderRoot semantics: descend pushes the old root onto back history) ──
function navigate(id) {
	if (!id || id === props.rootId || !inv.folders.has(id)) return
	emit('update:backStack', [...props.backStack, props.rootId])
	emit('update:rootId', id)
}
function goBack() {
	// Pop dead history entries (a folder trashed/purged while in the stack) instead of returning
	// early — otherwise the Back button stays enabled (backStack.length > 0) but permanently inert.
	const stack = [...props.backStack]
	while (stack.length) {
		const prev = stack.pop()
		if (inv.folders.has(prev)) {
			emit('update:backStack', stack)
			emit('update:rootId', prev)
			return
		}
	}
	emit('update:backStack', stack)   // all entries were dead — drain so Back disables
}
const parentId = computed(() => {
	const p = inv.folders.get(props.rootId)?.parentId || ''
	return inv.folders.has(p) ? p : ''
})
function goUp() { if (parentId.value) navigate(parentId.value) }

// Breadcrumb: ancestor chain root→current, clickable. Cycle-safe walk (mirrors isInTrash's guard).
const crumbs = computed(() => {
	const out = []
	let cur = props.rootId
	const seen = new Set()
	while (cur && !seen.has(cur)) {
		seen.add(cur)
		const fo = inv.folders.get(cur)
		if (!fo) break
		out.unshift({ folderId: cur, name: cur === inv.rootId ? 'Inventory' : fo.name })
		cur = fo.parentId
	}
	return out
})

// ── Rows: child folders first, then items — same order as the tree renders a folder. ──
const folderRows = computed(() => {
	let list = inv.childFolders(props.rootId)
	if (f?.filtersActive.value) list = list.filter(c => f.folderHasMatch(c.folderId))
	return list
})
const itemRows = computed(() => {
	let all = inv.folderItems(props.rootId)
	if (f?.filtersActive.value) all = all.filter(it => f.itemVisible(it))
	return inv.sortItems(all)
})
// Ordered id list for shift-click range selection across folder AND item rows.
const order   = computed(() => [...folderRows.value.map(c => c.folderId), ...itemRows.value.map(i => i.itemId)])
const loading = computed(() => inv.isFetching(props.rootId))

function onSelectFolder(id, event) { selectFlat(id, order.value, event) }

// Right-click on a folder row: keep a multi-selection that includes it (targets carry the whole
// selection), otherwise reduce to a single selection first — same rules as InventoryTreeNode.
function onContextMenuFolder(event, fo) {
	if (!invSel.isSelected(fo.folderId)) selectFlat(fo.folderId, order.value, {})
	const sel = invSel.selectedIds.value
	let targets = [{ kind: 'folder', obj: fo }]
	if (sel.size > 1 && sel.has(fo.folderId)) {
		const rest = [...sel].filter(x => x !== fo.folderId).map(x => inv.resolveTarget(x)).filter(Boolean)
		targets = [{ kind: 'folder', obj: fo }, ...rest]
	}
	inv.openContextMenu(event.clientX, event.clientY, 'folder', fo, targets)
}
</script>

<template>
	<div class="flex flex-col flex-1 min-h-0">
		<!-- Nav header: Back (history) + Up (parent) + clickable breadcrumb path. -->
		<div class="flex items-center gap-0.5 px-1 py-0.5 border-b border-edge text-2xs text-fg shrink-0">
			<button
				class="ui-btn px-0.5 py-0"
				:disabled="!backStack.length"
				:class="backStack.length ? '' : 'opacity-40 cursor-default'"
				title="Back to the previous folder"
				@click="goBack"
			><ChevronLeftIcon class="w-3.5 h-3.5" /></button>
			<button
				class="ui-btn px-0.5 py-0"
				:disabled="!parentId"
				:class="parentId ? '' : 'opacity-40 cursor-default'"
				title="Up to the parent folder"
				@click="goUp"
			><ArrowUpIcon class="w-3.5 h-3.5" /></button>
			<div class="flex items-center min-w-0 overflow-x-auto scrollbar-none whitespace-nowrap">
				<template v-for="(c, i) in crumbs" :key="c.folderId">
					<ChevronRightIcon v-if="i > 0" class="w-3 h-3 shrink-0 opacity-40" />
					<button
						class="px-0.5 rounded-sm hover:bg-white/10 shrink-0"
						:class="c.folderId === rootId ? 'text-accent font-semibold' : 'text-fg/80'"
						:title="c.name"
						@click="navigate(c.folderId)"
					>{{ c.name }}</button>
				</template>
			</div>
		</div>

		<!-- Flat contents of ONE folder: folder rows (double-click descends), then item rows. -->
		<div class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
			<div
				v-for="fo in folderRows"
				:key="fo.folderId"
				class="flex items-center gap-1 px-1 py-0.5 rounded-sm cursor-pointer text-xs text-fg select-none"
				:class="invSel.isSelected(fo.folderId) ? 'bg-accent/50' : 'hover:bg-accent/20'"
				:title="fo.name"
				@click="onSelectFolder(fo.folderId, $event)"
				@dblclick="navigate(fo.folderId)"
				@contextmenu.prevent.stop="onContextMenuFolder($event, fo)"
			>
				<span class="shrink-0">{{ folderIcon(fo.typeDefault, false) }}</span>
				<span class="truncate">{{ fo.name }}</span>
			</div>
			<InventoryFlatRow v-for="it in itemRows" :key="it.itemId" :item="it" :order="order" />
			<div v-if="loading" class="px-1 py-0.5 text-2xs italic text-fg/40">Loading…</div>
			<div v-else-if="!folderRows.length && !itemRows.length" class="px-1 py-2 text-2xs italic text-fg/40 text-center">Empty folder</div>
		</div>
	</div>
</template>

<style scoped>
</style>
