<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'

const ui      = useUiStore()
const session = useSessionStore()

const menu = computed(() => ui.landMenu)

const style = computed(() => {
	if (!menu.value) return {}
	const MENU_W = 192
	const MENU_H = 160
	const x = Math.min(menu.value.x, window.innerWidth  - MENU_W - 8)
	const y = Math.min(menu.value.y, window.innerHeight - MENU_H - 8)
	return { left: `${x}px`, top: `${y}px` }
})

function close() { ui.closeLandMenu() }

function posLabel() {
	const p = menu.value?.pos
	if (!p) return ''
	return `${p[0].toFixed(0)}, ${p[1].toFixed(0)}, ${p[2].toFixed(0)}`
}

function walkTo() {
	if (!menu.value) return
	const [x, y, z] = menu.value.pos
	ui.requestWarp(x, y, z)
	close()
}

function landmarkHere() {
	ui.openCreateLandmark({ name: session.regionName || 'Landmark' })
	close()
}

function openMap() {
	ui.toggleMap()
	close()
}

function onDocClick(e) {
	if (!menu.value) return
	if (e.target?.closest?.('[data-land-context-menu]')) return
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
		data-land-context-menu
		:style="style"
		class="fixed z-[200] min-w-[12rem] bg-card border border-brd rounded-sm shadow-lg text-xs select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-brd truncate">
			{{ session.regionName || 'Land' }}
			<span class="text-t1/50 font-normal ml-1">({{ posLabel() }})</span>
		</div>
		<button class="block w-full text-left px-3 py-1.5 text-t1/40 cursor-not-allowed" disabled>About Land…</button>
		<button class="block w-full text-left px-3 py-1.5 text-t1/40 cursor-not-allowed" disabled>Sit Here</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="walkTo">Walk To</button>
		<div class="border-t border-brd my-0.5" />
		<button class="block w-full text-left px-3 py-1.5 text-t1/40 cursor-not-allowed" disabled>Build</button>
		<button class="block w-full text-left px-3 py-1.5 text-t1/40 cursor-not-allowed" disabled>Edit Terrain</button>
		<div class="border-t border-brd my-0.5" />
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="landmarkHere">Landmark This Place</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="openMap">World Map</button>
		<button class="block w-full text-left px-3 py-1.5 text-t1/40 cursor-not-allowed" disabled>Set Home Here</button>
	</div>
</template>
