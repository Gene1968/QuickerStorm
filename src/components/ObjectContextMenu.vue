<script setup>
/**
 * ObjectContextMenu — right-click menu on a world prim. Structure + order mirror FS
 * menu_object (lowercased, our convention); enabled items have real backing today,
 * the rest are DISABLED roadmap placeholders (most unlock with the HTTP-caps layer).
 * The FS "ShareStorm" export/import/particle cluster injected at the top of the
 * object menu becomes our "quickerSTORM" submenu, and the FS "Object" submenu
 * (profile/inspect/link/scripts/zoom) is preserved. Rows render via <ContextMenuItem>.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useUiStore }    from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'
import { useLLUDP }      from '@/composables/useLLUDP'
import { useContextMenuPosition } from '@/composables/useContextMenuPosition'
import ContextMenuItem   from '@/components/ContextMenuItem.vue'

const ui    = useUiStore()
const world = useWorldStore()
const { sendTouch, sendSit, sendDelete } = useLLUDP()

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

// FS menu_object order, lowercased; enabled = real backing, else disabled roadmap.
const items = computed(() => [
	{
		label: 'quickerSTORM',
		submenu: [
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
	{ label: 'Open',				disabled: true },
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
	{ label: 'Take',				disabled: true },
	{ label: 'Take copy',			disabled: true },
	{ label: 'Pay',					disabled: true },
	{ label: 'Buy',					disabled: true },
])

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
		<div v-if="showInspect" class="px-3 py-1.5 border-t border-edge text-2xs text-fg/70 font-mono">
			<div>id: {{ menu.localId }}</div>
			<div class="truncate">uuid: {{ menu.fullId }}</div>
			<div v-if="menu.pos">pos: {{ menu.pos.map(v => v.toFixed(1)).join(', ') }}</div>
		</div>
	</div>
</template>
