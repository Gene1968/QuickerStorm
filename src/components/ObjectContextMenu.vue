<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useLLUDP }   from '@/composables/useLLUDP'

const ui = useUiStore()
const { sendTouch, sendSit } = useLLUDP()

const menu = computed(() => ui.objectMenu)
const showInspect = ref(false)

const style = computed(() => {
	if (!menu.value) return {}
	const MENU_W = 180
	const MENU_H = 180
	const x = Math.min(menu.value.x, window.innerWidth - MENU_W - 8)
	const y = Math.min(menu.value.y, window.innerHeight - MENU_H - 8)
	return { left: `${x}px`, top: `${y}px` }
})

function close() { ui.closeObjectMenu(); showInspect.value = false }

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

function inspect() { showInspect.value = !showInspect.value }

function edit() {
	if (!menu.value) return
	ui.openObjectEdit(menu.value.localId)
	ui.focusFloater('object-edit')
}

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
		data-object-context-menu
		:style="style"
		class="fixed z-[200] min-w-[10rem] bg-card border border-brd rounded shadow-lg text-xs select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-brd truncate">{{ menu.name }}</div>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="inspect">{{ showInspect ? 'Hide Inspect' : 'Inspect' }}</button>
		<div v-if="showInspect" class="px-3 py-1.5 border-b border-brd text-[0.65rem] text-white/70 font-mono">
			<div>id: {{ menu.localId }}</div>
			<div class="truncate">uuid: {{ menu.fullId }}</div>
			<div v-if="menu.pos">pos: {{ menu.pos.map(v => v.toFixed(1)).join(', ') }}</div>
		</div>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="touch">Touch</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="sit">Sit Here</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="edit">Edit…</button>
		<button class="block w-full text-left px-3 py-1.5 text-white/40 cursor-not-allowed" disabled>Take / Copy (Phase 3)</button>
	</div>
</template>
