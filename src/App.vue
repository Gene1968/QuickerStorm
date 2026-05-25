<script setup>
import { onMounted, onUnmounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useDebugStore } from '@/stores/debugStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useGridStore } from '@/stores/gridStore'
import { useUiStore } from '@/stores/uiStore'
import { S } from '@shared/protocol.js'
import PreferencesFloater from '@/components/PreferencesFloater.vue'

const { on, off } = useRealtimeSocket()
const debug   = useDebugStore()
const session = useSessionStore()
const grid    = useGridStore()
const ui      = useUiStore()
const router  = useRouter()

// WHY: Register handlers at app root so messages are captured regardless of which
// view is currently mounted.

function onDebug(d) {
	debug.push(d.level ?? 'info', d.msg ?? String(d))
}

function onRegionInfo(d) {
	// OSGrid (and many OpenSim grids) omit region_name from login response.
	// The real name arrives via RegionHandshake UDP → S.REGION_INFO from server.
	if (d.name) session.regionName = d.name
}

function onDisconnected(d) {
	// Sim terminated circuit (timeout, kick, teleport, etc.)
	const reason = d?.reason ?? 'Disconnected from simulator'
	debug.push('warn', `Disconnected: ${reason}`)
	// WHY: Don't route immediately — show disconnection overlay on WorldView so user
	// sees why they were dropped and chooses to return to login. session.clearSession()
	// is called by the overlay's "Return to Login" button, not here.
	grid.setDisconnected(reason)
}

// WHY: Ctrl+P opens Preferences globally — works pre-login and post-login.
// BottomToolbar also handles it post-login but this covers all routes.
function onKeyDown(e) {
	if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
	if (e.ctrlKey && e.key === 'p') {
		e.preventDefault()
		ui.togglePreferences()
	}
}

onMounted(() => {
	on(S.DEBUG, onDebug)
	on(S.REGION_INFO, onRegionInfo)
	on(S.DISCONNECTED, onDisconnected)
	window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
	off(S.DEBUG, onDebug)
	off(S.REGION_INFO, onRegionInfo)
	off(S.DISCONNECTED, onDisconnected)
	window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
	<RouterView />
	<!-- WHY: PreferencesFloater lives at app root — accessible pre-login and post-login via Ctrl+P -->
	<PreferencesFloater v-if="ui.showPreferences" />
</template>
