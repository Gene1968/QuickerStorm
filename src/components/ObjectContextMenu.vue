<script setup>
/**
 * ObjectContextMenu — right-click menu on a world prim. Structure + order mirror FS
 * menu_object (lowercased, our convention); enabled items have real backing today,
 * the rest are DISABLED roadmap placeholders (most unlock with the HTTP-caps layer).
 * The FS "Object" submenu (profile/inspect/link/scripts/zoom) is preserved. Rows render via <ContextMenuItem>.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useUiStore }    from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useLLUDP }      from '@/composables/useLLUDP'
import { useTaskInventory } from '@/composables/useTaskInventory'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import { takeGate, takeCopyGate } from '@/utils/takeGating'
import ContextMenuItem   from '@/components/ContextMenuItem.vue'

const ui      = useUiStore()
const world   = useWorldStore()
const inv     = useInventoryStore()
const session = useSessionStore()
const { sendTouch, sendSit, sendDelete, takeObject, takeObjectCopy } = useLLUDP()

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const menu = computed(() => ui.objectMenu)
const showInspect = ref(false)
const confirmDelete = ref(false)

// Measure + slide on-screen on both axes (flips upward near the screen bottom).
const { el: menuEl, style, reflow } = useContextMenuPosition(menu)

function close() { ui.closeObjectMenu(); showInspect.value = false; confirmDelete.value = false }

// Two-step delete: first click arms (row turns red "Confirm delete?"), second click sends ObjectDelete.
// Avoids a native confirm() dialog. The sim enforces permissions, so an unowned object is a no-op.
function del() {
	if (!menu.value) return
	if (!confirmDelete.value) { confirmDelete.value = true; return }
	sendDelete(menu.value.localId)
	close()
}

// FS "Take": DeRezObject Destination=Take(4) into the user's Objects system folder (type 6).
// FS prefers the folder the object was last derezzed from when unambiguous (llviewermenu.cpp
// handle_take:6743-6803) — we don't track node mFolderID, so we always use the FT_OBJECT default
// (llviewermenu.cpp:6799-6802). Zero UUID when inventory isn't loaded yet: OpenSim then routes an
// owner-take to FromFolderID when set, else Lost & Found (InventoryAccessModule.cs:830-834) — the
// item still reaches inventory, just not necessarily the Objects folder. The menu row pre-gates
// via takeGate (client prediction of FS enable_take, llviewermenu.cpp:6900-6940: owner, or
// transfer+modify), but the sim stays authoritative — an untakeable object that slips through
// (unknown perms → enabled by convention) is a no-op. The sim's KillObject removes the mesh
// and BulkUpdateInventory adds the item row; no local mutations here.
function take() {
	if (!menu.value) return
	takeObject(menu.value.localId, inv.findSystemFolder(6) || ZERO_UUID)
	close()
}

// FS "Take copy": DeRezObject Destination=TakeCopy(1) — the copy lands in the Objects folder
// (OpenSim forces it regardless of DestinationID, InventoryAccessModule.cs:838-839) and the
// original STAYS in world (llviewermenu.cpp handle_take_copy:6593-6594).
function takeCopy() {
	if (!menu.value) return
	takeObjectCopy(menu.value.localId)
	close()
}

function touch() {
	if (!menu.value) return
	sendTouch(menu.value.localId)
	close()
}

function sit() {
	if (!menu.value) return
	sendSit(menu.value.fullId)
	close()
}

// Toggle the inline inspect panel; re-measure since it changes the menu height.
async function inspect() { showInspect.value = !showInspect.value; reflow() }

function refreshTextures() {
	if (!menu.value) return
	ui.requestTextureRefresh(menu.value.localId)
	close()
}

function edit() {
	if (!menu.value) return
	const clicked = menu.value.localId
	const obj = world.objects.get(clicked)
	const rootId = obj && (obj.parentId ?? 0) !== 0 ? obj.parentId : clicked
	ui.openObjectEdit(rootId)
	ui.focusFloater('object-edit')
}

// FS "Open" (llfloateropenobject.cpp): copy the prim's contents into a new agent-inventory folder
// named after the object. useTaskInventory fetches contents first if needed and toasts every
// outcome (empty / no reply / copying N items) — fire-and-forget here, the menu closes immediately.
const { openContents } = useTaskInventory()
function openBox() {
	if (!menu.value) return
	const o = world.objects.get(menu.value.localId)
	openContents(menu.value.localId, o?.name)
	close()
}

// FS menu_object order, lowercased; enabled = real backing, else disabled roadmap.
const items = computed(() => {
	// Take / Take-copy perm gating — client-side prediction of OpenSim CanTakeObject /
	// CanTakeCopyObject (PermissionsModule.cs:1963/2004) via takeGating.js (FS enable_take
	// llviewermenu.cpp:6900 / enable_object_take_copy llviewermenu.cpp:10871). Unknown perms
	// (ObjectProperties not yet arrived) → ENABLED per convention: the sel-sync watcher fires
	// sendSelect when this menu opens (useWorldEngine.js:286), so props land moments later and
	// this computed re-evaluates live (world.objects is reactive) — a brief enabled→disabled
	// flip is acceptable. Helpers resolve linkset children to the root internally; avatar rows
	// never reach this menu (AvatarContextMenu is separate).
	const gTake = takeGate(world.objects, menu.value?.localId, session.agentId)
	const gCopy = takeCopyGate(world.objects, menu.value?.localId, session.agentId)
	return [
	{
		label: 'quickerSTORM',
		submenu: [
			{ label: 'Inspect textures!',	disabled: true },
			{
				label: 'Save / export object',
				submenu: [
					{ label: 'Export as Collada (DAE)',	disabled: true },
					{ label: 'Export as glTF (GLB)…',		disabled: true },
					{ label: 'Backup object as OXP',		disabled: true },
					{ sep: true },
					{ label: 'Export as OBJ',				disabled: true },
					{ label: 'Export as XML',				disabled: true },
					{ label: 'Save texture as…',			disabled: true },
				],
			},
			{ label: 'Import…',				disabled: true },
			{ label: 'Inject particles',	disabled: true },
			{ label: 'Send to off-world',	disabled: true },
		],
	},
	{ sep: true },
	{ label: 'Touch',				disabled: menu.value?.clickAction === 7, action: touch },
	{ label: 'Edit…',									action: edit },
	{ label: 'Edit PBR material',	disabled: true },
	{ label: 'Build',				disabled: true },
	{ label: 'Open',				action: openBox },
	{ sep: true },
	{ label: 'Sit here',								action: sit },
	{ sep: true },
	{
		label: 'Object',
		submenu: [
			{ label: 'Zoom in',			disabled: true },
			{ label: 'Profile',			disabled: true },
			{ label: 'Inspect',			checked: () => showInspect.value, action: inspect },
			{ label: 'Script info',		disabled: true },
			{ sep: true },
			{ label: confirmDelete.value ? 'Confirm delete?' : 'Delete', danger: () => confirmDelete.value, action: del },
			{ sep: true },
			{ label: 'Link',			disabled: true },
			{ label: 'Unlink',			disabled: true },
			{ label: 'Edit linked parts',	disabled: true },
			{ sep: true },
			{
				label: 'Scripts',
				submenu: [
					{ label: 'Compile (Mono)',		disabled: true },
					{ label: 'Compile (LSL)',		disabled: true },
					{ label: 'Reset scripts',		disabled: true },
					{ label: 'Run scripts',			disabled: true },
					{ label: 'Stop scripts',		disabled: true },
					{ label: 'Remove scripts',		disabled: true },
				],
			},
			{ sep: true },
			{
				label: 'Annoyance',
				submenu: [
					{ label: 'Derender',			disabled: true },
					{ label: 'Derender + blacklist',	disabled: true },
					{ label: 'Report abuse',		disabled: true },
					{ label: 'Block',				disabled: true },
				],
			},
		],
	},
	{ sep: true },
	{ label: 'Texture refresh',							action: refreshTextures },
	{ label: 'Return',				disabled: true },
	// FS pie order: Take / Take copy between Return and Pay (menu_object.xml:387-408).
	{ label: 'Take',				disabled: gTake.disabled,	title: gTake.title,	action: take },
	{ label: 'Take copy',			disabled: gCopy.disabled,	title: gCopy.title,	action: takeCopy },
	{ label: 'Pay',					disabled: true },
	{ label: 'Buy',					disabled: true },
	]
})

function onDocClick(e) {
	if (!menu.value) return
	if (e.target?.closest?.('[data-object-context-menu]')) return
	close()
}
function onKey(e) { if (e.key === 'Escape' && menu.value) close() }

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
		data-object-context-menu
		:style="style"
		class="fixed z-[200] min-w-[10rem] bg-panel border border-edge rounded-sm shadow-lg text-xs text-fg select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-edge truncate">{{ menu.name }}</div>
		<ContextMenuItem v-for="(it, i) in items" :key="i" :item="it" />
		<div v-if="showInspect" class="px-3 py-1 border-t border-edge text-2xs text-fg/70 font-mono">
			<div>id: {{ menu.localId }}</div>
			<div class="truncate">uuid: {{ menu.fullId }}</div>
			<div v-if="menu.pos">pos: {{ menu.pos.map(v => v.toFixed(1)).join(', ') }}</div>
		</div>
	</div>
</template>
