<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useInstantMessage } from '@/composables/useInstantMessage'
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { useSocial } from '@/composables/useSocial'

const ui = useUiStore()
const im = useInstantMessage()
const social = useGridSocialStore()
const { offerFriendship } = useSocial()

const menu = computed(() => ui.avatarMenu)

// WHY: Reposition menu so it stays on-screen near the click. clamp to viewport on right/bottom.
const style = computed(() => {
	if (!menu.value) return {}
	const MENU_W = 180
	const MENU_H = 188
	const x = Math.min(menu.value.x, window.innerWidth - MENU_W - 8)
	const y = Math.min(menu.value.y, window.innerHeight - MENU_H - 8)
	return { left: `${x}px`, top: `${y}px` }
})

function close() { ui.closeAvatarMenu() }

function startIM() {
	if (!menu.value) return
	im.openWith(menu.value.agentId, menu.value.name)
	ui.showChat = true
	ui.focusFloater('conversations')
	close()
}

function viewProfile() {
	if (!menu.value) return
	ui.openProfile(menu.value.agentId)
	close()
}

function addFriend() {
	if (menu.value) offerFriendship(menu.value.agentId, menu.value.name, 'Will you be my friend?')
	ui.closeAvatarMenu()
}

function refreshTextures() {
	if (!menu.value) return
	ui.requestTextureRefresh(menu.value.localId)
	close()
}

function faceToward() {
	if (!menu.value) return
	window.dispatchEvent(new CustomEvent('qs:face-toward', { detail: { localId: menu.value.localId } }))
	close()
}

function onDocClick(e) {
	if (!menu.value) return
	if (e.target?.closest?.('[data-avatar-context-menu]')) return
	close()
}
function onKey(e) {
	if (e.key === 'Escape' && menu.value) close()
}

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
		data-avatar-context-menu
		:style="style"
		class="fixed z-[200] min-w-[10rem] bg-panel border border-edge rounded-sm shadow-lg text-xs select-none"
		@contextmenu.prevent
	>
		<div class="px-3 py-1.5 text-accent font-medium border-b border-edge truncate">{{ menu.name }}</div>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="startIM">Send IM…</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="viewProfile">View Profile</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="faceToward">Face Toward</button>
		<button class="block w-full text-left px-3 py-1.5 hover:bg-white/10" @click="refreshTextures">Texture refresh</button>
		<button
			v-if="!social.isFriend(menu.agentId)"
			class="block w-full text-left px-3 py-1.5 hover:bg-white/10"
			@click="addFriend"
		>Add Friend</button>
		<button class="block w-full text-left px-3 py-1.5 text-fg/40 cursor-not-allowed" disabled>Mute (Phase 3)</button>
		<button class="block w-full text-left px-3 py-1.5 text-fg/40 cursor-not-allowed" disabled>Follow (Phase 3)</button>
	</div>
</template>
