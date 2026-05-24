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
	{ id: 'speak',      icon: '🎤', label: 'Speak',     title: 'Toggle Mic',         action: () => voice.toggleMute(),    active: () => voice.isEnabled.value && !voice.isMuted.value },
	{ id: 'voice',      icon: '🔊', label: 'Voice',     title: 'Voice Controls',     action: () => {},                    active: () => false,                disabled: true },
	{ id: 'walk',       icon: '🚶', label: 'Walk',      title: 'Movement Controls',  action: () => {},                    active: () => false,                disabled: true },
	{ id: 'camera',     icon: '🎥', label: 'Camera',    title: 'Camera Controls',    action: () => {},                    active: () => false,                disabled: true },
	{ id: 'chat',       icon: '💬', label: 'Chat',      title: 'Nearby Chat',        action: () => ui.toggleChat(),       active: () => ui.showChat },
	{ id: 'people',     icon: '👥', label: 'Nearby',    title: 'Nearby Avatars',     action: () => ui.toggleAvatarList(), active: () => ui.showAvatarList },
	{ id: 'minimap',    icon: '◈',  label: 'Mini-Map',  title: 'Mini-Map',           action: () => ui.toggleMinimap(),    active: () => ui.showMinimap },
	{ id: 'map',        icon: '🗺', label: 'Map',       title: 'Map (Ctrl+M)',       action: () => ui.toggleMap(),        active: () => ui.showMap },
	{ id: 'inv',        icon: '📦', label: 'Inventory', title: 'Inventory',          action: () => ui.toggleInventory(),  active: () => ui.showInventory },
	{ id: 'appearance', icon: '🪞', label: 'Appear',    title: 'Avatar Appearance',  action: () => {},                    active: () => false,                disabled: true },
	{ id: 'search',     icon: '🔍', label: 'Search',    title: 'Search',             action: () => {},                    active: () => false,                disabled: true },
	{ id: 'snapshot',   icon: '📸', label: 'Snapshot',  title: 'Take Snapshot',      action: () => {},                    active: () => false,                disabled: true },
	{ id: 'ao',         icon: '🤸', label: 'AO',        title: 'Animation Override', action: () => {},                    active: () => false,                disabled: true },
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
	<div class="flex items-center justify-evenly gap-1 px-2 h-10 bg-black/80 border-t border-brd shrink-0 select-none">

		<!-- Tool buttons -->
		<button
			v-for="t in tools"
			:key="t.id"
			class="flex grow flex-col items-center justify-center h-8 rounded text-xs transition-colors"
			:class="t.disabled
				? 'opacity-40 cursor-not-allowed text-white/50'
				: t.active()
					? 'bg-accent/30 text-accent'
					: 'text-white/70 hover:bg-white/10 hover:text-white'"
			:disabled="t.disabled"
			:title="t.title"
			@click="t.action()"
		>
			<span class="text-base leading-none">{{ t.icon }}</span>
			<span class="leading-none mt-0.5 hidden sm:block">{{ t.label }}</span>
		</button>

		<div class="w-px h-5 bg-white/20 mx-1" />

		<!-- 2D / 3D toggle -->
		<button
			class="flex grow flex-col items-center justify-center h-8 rounded text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
			:title="ui.mode === '3d' ? 'Switch to 2D view' : 'Switch to 3D view'"
			@click="ui.toggleMode()"
		>
			<span class="text-base leading-none">{{ ui.mode === '3d' ? '2D' : '3D' }}</span>
			<span class="leading-none mt-0.5 hidden sm:block">View</span>
		</button>

		<div class="w-px h-5 bg-white/20 mx-1" />

		<!-- Debug panel toggle (Ctrl+Shift+4) -->
		<button
			class="flex grow flex-col items-center justify-center h-8 rounded text-xs transition-colors"
			:class="ui.showDebug ? 'bg-yellow-500/20 text-yellow-400' : 'text-white/40 hover:bg-white/10 hover:text-white'"
			title="Debug Panel (Ctrl+Shift+4)"
			@click="ui.toggleDebug()"
		>
			<span class="text-base leading-none">🔌</span>
			<span class="leading-none mt-0.5 hidden sm:block">Debug</span>
		</button>

		<!-- Spacer -->
		<div class="flex-1" />


		<!-- Logout -->
		<!-- <button
			class="px-2 h-7 rounded border border-white/20 text-white/60 text-xs hover:border-red-500/60 hover:text-red-400 transition-colors"
			title="Log out and return to login screen"
			@click="logout"
		>
			Logout
		</button> -->

		<!-- Quick Prefs (last btn, right edge) -->
		<button
			data-quick-prefs-trigger
			class="flex grow flex-col items-center justify-center h-8 rounded text-xs transition-colors"
			:class="ui.showQuickPrefs ? 'bg-accent/30 text-accent' : 'text-white/70 hover:bg-white/10 hover:text-white'"
			title="Quick Preferences"
			@click="ui.toggleQuickPrefs()"
		>
			<span class="text-base leading-none">⚙</span>
			<span class="leading-none mt-0.5 hidden sm:block text-nowrap">Qk Prefs</span>
		</button>

		<!-- Quick Prefs popover (rendered outside toolbar flow, fixed-positioned) -->
		<QuickPrefsPopover v-if="ui.showQuickPrefs" />
	</div>
</template>
