<script setup>
import { onMounted, onUnmounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useDebugStore } from '@/stores/debugStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useGridStore } from '@/stores/gridStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'
import { S, C } from '@shared/protocol.js'
import PreferencesFloater from '@/components/PreferencesFloater.vue'

const { on, off, emit, connected } = useRealtimeSocket()
const debug      = useDebugStore()
const session    = useSessionStore()
const grid       = useGridStore()
const ui         = useUiStore()
const worldStore = useWorldStore()
const router     = useRouter()

// WHY: Register handlers at app root so messages are captured regardless of which
// view is currently mounted.

function onDebug(d) {
	debug.push(d.level ?? 'info', d.msg ?? String(d))
}

function onRegionInfo(d) {
	// OSGrid (and many OpenSim grids) omit region_name from login response.
	// The real name arrives via RegionHandshake UDP → S.REGION_INFO from server.
	if (d.name) session.regionName = d.name
	if (typeof d.access === 'number') session.regionAccess = d.access
	// Region-run marker: gates the object-cache replay (see preseedRegionCache in useWorldEngine).
	if (d.cacheId) session.regionCacheId = d.cacheId
	// WHY: water level + terrain textures drive the water plane Y and the terrain colour
	// palette. useWorldEngine watches sessionStore.waterHeight to reposition/recolour.
	if (typeof d.waterHeight === 'number') session.waterHeight = d.waterHeight
	if (Array.isArray(d.terrainDetail)) {
		session.terrainTextures = {
			detail:      d.terrainDetail,
			startHeight: d.terrainStartHeight ?? [0, 0, 0, 0],
			heightRange: d.terrainHeightRange ?? [0, 0, 0, 0],
		}
	}
}

function onDisconnected(d) {
	// Sim terminated circuit (timeout, kick, teleport, etc.)
	const reason = d?.reason ?? 'Disconnected from simulator'
	debug.push('warn', `[DISCONNECT] reason="${reason}" loginState=${grid.loginState} sessionConnected=${session.connected}`)
	// WHY: Don't route immediately — show disconnection overlay on WorldView so user
	// sees why they were dropped and chooses to return to login. session.clearSession()
	// is called by the overlay's "Return to Login" button, not here.
	grid.setDisconnected(reason)
	// WHY: S.DISCONNECTED arrives on a still-open WS (server deletes session then sends this message).
	// onWsOpen won't re-fire to clear the overlay. Probe once — if the circuit somehow
	// survived (edge case), auto-clear; if dead (normal case), leave the overlay up.
	if (connected.value && session.connected) {
		const grd = grid.selectedNick, usr = session.username
		if (grd && usr) {
			emit(C.CHECK_CIRCUIT, { grid: grd, username: usr })
			const t = setTimeout(() => off(S.CIRCUIT_STATUS, onCircuitProbe), 5000)
			function onCircuitProbe(s) {
				clearTimeout(t); off(S.CIRCUIT_STATUS, onCircuitProbe)
				if (s?.alive) { debug.push('info', '[DISCONNECT] circuit alive after S.DISCONNECTED — auto-clearing'); grid.setLoginState('connected') }
			}
			on(S.CIRCUIT_STATUS, onCircuitProbe)
		}
	}
}

// WHY: WS reopened after a mid-session drop. Server may have lost our session
// (Bun hot-reload, crash) and sim may have killed the circuit (60s no-packets).
// Probe with CHECK_CIRCUIT — if server says alive:false, surface the overlay
// instead of pretending the green dot means anything. Only fire when session
// was previously established; skip during initial login flow.
let wasOpenBefore = false
function onWsOpen() {
	const reconnect = wasOpenBefore
	wasOpenBefore = true
	if (!reconnect) return
	if (!session.connected) return
	const grd = grid.selectedNick
	const usr = session.username
	if (!grd || !usr) return
	emit(C.CHECK_CIRCUIT, { grid: grd, username: usr })
	const t = setTimeout(() => {
		off(S.CIRCUIT_STATUS, onStatus)
	}, 5000)
	function onStatus(d) {
		clearTimeout(t)
		off(S.CIRCUIT_STATUS, onStatus)
		// WHY: Read loginState here (at result time) not at probe-launch time. If S.DISCONNECTED
		// arrived while the probe was in-flight, loginState is now 'disconnected' and we should
		// clear it if the circuit is alive — the earlier 'wasDisconnected' capture missed this race.
		if (d?.alive && grid.loginState === 'disconnected') {
			debug.push('info', `[DISCONNECT] circuit survived WS gap — auto-resuming`)
			grid.setLoginState('connected')
		} else if (!d?.alive) {
			debug.push('warn', `[DISCONNECT] probe alive=${d?.alive} loginState=${grid.loginState}`)
			grid.setDisconnected('Also lost server-grid session while disconnected')
		}
	}
	on(S.CIRCUIT_STATUS, onStatus)
}

function onWsLost() {
	// WS down >60s — sim has dropped our circuit by now even if server is alive.
	if (!session.connected) return
	if (grid.loginState === 'disconnected') return
	debug.push('warn', 'WebSocket unreachable for 60s — disconnected')
	grid.setDisconnected('Lost connection to quickerSTORM server')
}

function onAgentSpawnPosRoot(d) {
	// WHY: Register AGENT_SPAWN_POS at app root (always mounted, registered before any route
	// component). This eliminates the race condition where AGENT_SPAWN_POS arrives between
	// LOGIN_OK (which triggers router.push('/world')) and WorldCanvas onMounted completing.
	// Stores the raw unclamped spawn position in worldStore so useWorldEngine can apply it
	// on mount — even if the message arrived before WorldCanvas was mounted.
	const [x, y, z] = d?.pos ?? []
	if (x != null && y != null && z != null && (x !== 0 || y !== 0 || z !== 0)) {
		worldStore.setSpawnPos(x, y, z)
		debug.push('info', `[App] AGENT_SPAWN_POS stored: ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`)
	}
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
	on(S.AGENT_SPAWN_POS, onAgentSpawnPosRoot)
	on('_open', onWsOpen)
	on('_lost', onWsLost)
	window.addEventListener('keydown', onKeyDown)
})
onUnmounted(() => {
	off(S.DEBUG, onDebug)
	off(S.REGION_INFO, onRegionInfo)
	off(S.DISCONNECTED, onDisconnected)
	off(S.AGENT_SPAWN_POS, onAgentSpawnPosRoot)
	off('_open', onWsOpen)
	off('_lost', onWsLost)
	window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
	<RouterView />
	<!-- WHY: PreferencesFloater lives at app root — accessible pre-login and post-login via Ctrl+P -->
	<PreferencesFloater v-if="ui.showPreferences" />
</template>
