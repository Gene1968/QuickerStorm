<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useGridStore } from '@/stores/gridStore'
import { useRouter } from 'vue-router'
import QuickPrefsPopover from '@/components/QuickPrefsPopover.vue'
import { useProximityVoice } from '@/composables/useProximityVoice'

const ui			= useUiStore()
const session = useSessionStore()
const grid		= useGridStore()
const router	= useRouter()
const voice		= useProximityVoice()

function logout() {
	session.clearSession()
	grid.setLoginState('idle')
	router.push('/landing')
}

// Toolbar button definition — label, icon, action, active flag, disabled flag, tooltip
// disabled: true → stub not yet implemented; renders with opacity-40 cursor-not-allowed
const tools = [
	{ id: 'chat',       icon: '💬', label: 'Chat',      title: 'Nearby Chat',        action: () => ui.toggleChat(),       active: () => ui.showChat },
	{ id: 'speak',      icon: '🎙️', label: 'Speak',     title: 'Toggle Mic',         action: () => voice.toggleMute(),    active: () => voice.isEnabled.value && !voice.isMuted.value },
	{ id: 'voice',      icon: '🎧', label: 'Nearby Voice',     title: 'Voice Controls',     action: () => {},                    active: () => false,                disabled: true },
	{ id: 'walk',       icon: '🚶', label: 'Walk·Run·Fly',      title: 'Movement Controls',  action: () => ui.toggleMoveControls(), active: () => ui.showMoveControls },
	{ id: 'camera',     icon: '🎥', label: 'Camera',    title: 'Camera Controls',    action: () => ui.toggleCameraControls(), active: () => ui.showCameraControls },
	{ id: 'people',     icon: '👥', label: 'People',    title: 'People',             action: () => {},                    active: () => false,                disabled: true },
	{ id: 'places',     icon: '📌', label: 'Places',    title: 'Places',             action: () => ui.togglePlaces(), active: () => ui.showPlaces },
	{ id: 'appearance', icon: '🪞', label: 'Appearance',    title: 'Avatar Appearance',  action: () => ui.toggleAppearance(), active: () => ui.showAppearance },
	{ id: 'search',     icon: '🔍', label: 'Search',    title: 'Search',             action: () => {},                    active: () => false,                disabled: true },
	{ id: 'map',        icon: '🗺', label: 'Map',       title: 'Map - Map of the World (Ctrl+M)',       action: () => ui.toggleMap(),        active: () => ui.showMap },
	{ id: 'minimap',    icon: '𖣠',  label: 'Mini-Map',  title: 'Mini-Map - Show nearby people (Ctrl+Shift+M)',           action: () => ui.toggleMinimap(),    active: () => ui.showMinimap },
	{ id: 'snapshot',   icon: '📸', label: 'Snapshot',  title: 'Snapshot - Take a picture (To-Do)',      action: () => {},                    active: () => false,                disabled: true },
	{ id: 'inv',        icon: '📦', label: 'Inventory', title: 'Inventory - View and use your belongings (Ctrl+I)',          action: () => ui.toggleInventory(),  active: () => ui.showInventory },
	{ id: 'ao',         icon: '🤸', label: 'AO',        title: 'Animation Override', action: () => {},                    active: () => false,                disabled: true },
	{ id: 'people',     icon: '👥', label: 'Nearby',    title: 'Nearby Avatars',     action: () => ui.toggleAvatarList(), active: () => ui.showAvatarList },
]

// Keyboard shortcuts
function onKeyDown(e) {
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
	if (e.ctrlKey && e.key === 'm') { e.preventDefault(); ui.toggleMap() }
	if (e.ctrlKey && e.shiftKey && e.code === 'Digit4') { e.preventDefault(); ui.toggleDebug() }
	// Ctrl+P → open Preferences (also handled globally in App.vue for pre-login)
	if (e.ctrlKey && e.key === 'p') { e.preventDefault(); ui.openPreferences() }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
	<div class="flex flex-row items-center justify-evenly gap-1 px-1 h-10 bg-black/80 border-t border-brd shrink-0 select-none">

		<!-- Tool buttons -->
		<button
			v-for="t in tools"
			:key="t.id"
			class="flex flex-1 flex-col items-center justify-center h-8 rounded text-2xs truncate transition-colors"
			:class="t.disabled
				? 'opacity-40 cursor-not-allowed text-white/50'
				: t.active()
					? 'bg-white/5 text-accent3'
					: 'text-white/70 hover:bg-white/10 hover:text-white'"
			:disabled="t.disabled"
			:title="t.title"
			@click="t.action()"
		>
			<span class="text-base leading-none">{{ t.icon }}</span>
			<span class="leading-none my-0.5 hidden sm:block">{{ t.label }}</span>
		</button>

		<!-- 2D / 3D toggle -->
		<button
			class="flex flex-1 flex-col items-center justify-center h-8 rounded text-2xs truncate transition-colors text-white/70 hover:bg-white/10 hover:text-white"
			:title="ui.mode === '3d' ? 'Switch to 2D view' : 'Switch to 3D view'"
			@click="ui.toggleMode()"
		>
			<span class="text-base leading-none">{{ ui.mode === '3d' ? '2D' : '3D' }}</span>
			<span class="leading-none my-0.5 hidden sm:block">View</span>
		</button>

		<!-- Debug panel toggle (Ctrl+Shift+4) -->
		<button
			class="flex flex-1 flex-col items-center justify-center h-8 rounded text-2xs truncate transition-colors"
			:class="ui.showDebug ? 'bg-white/5 text-accent3' : 'text-white/70 hover:bg-white/10 hover:text-white'"
			title="Debug Panel (Ctrl+Shift+4)"
			@click="ui.toggleDebug()"
		>
			<span class="text-base leading-none">🔌</span>
			<span class="leading-none my-0.5 hidden sm:block">Debug</span>
		</button>

		<!-- Logout -->
		<!-- <button
			class="px-2 h-7 rounded border border-white/20 text-white/60 text-2xs hover:border-red-500/60 hover:text-red-400 transition-colors"
			title="Log out and return to login screen"
			@click="logout"
		>
			Logout
		</button> -->

		<!-- Notifications: moved to the top-right tray (TopRightTray.vue), FS-style. Bottombar
		     entry removed per design — notifications open from the top-right envelope button. -->
		<!-- <button
			class="flex flex-1 flex-col items-center justify-center h-8 rounded text-2xs truncate transition-colors"
			:class="ui.showNotifications ? 'bg-white/5 text-accent3' : 'text-white/70 hover:bg-white/10 hover:text-white'"
			title="Notifications"
			@click="ui.toggleNotifications()"
		>
			<span class="relative text-base leading-none">
				🔔
				<span v-if="notif.totalUnread" class="absolute -top-1 -right-2 bg-red-600 text-white rounded-full text-[0.6rem] leading-none px-1 py-0.5 min-w-[1rem] text-center">{{ notif.totalUnread }}</span>
			</span>
			<span class="leading-none my-0.5 hidden sm:block">Notifs</span>
		</button> -->

		<!-- Quick Prefs (last btn, right edge) -->
		<button
			data-quick-prefs-trigger
			class="flex flex-1 flex-col items-center justify-center h-8 rounded text-2xs truncate transition-colors"
			:class="ui.showQuickPrefs ? 'bg-white/5 text-accent3' : 'text-white/70 hover:bg-white/10 hover:text-white'"
			title="Quick Preferences"
			@click="ui.toggleQuickPrefs()"
		>
			<span class="text-base leading-none">⚙</span>
			<span class="leading-none my-0.5 hidden sm:block">Quick Prefs</span>
		</button>

		<!-- Quick Prefs popover (rendered outside toolbar flow, fixed-positioned) -->
		<QuickPrefsPopover v-if="ui.showQuickPrefs" />
	</div>
</template>

<style scoped>

</style>
