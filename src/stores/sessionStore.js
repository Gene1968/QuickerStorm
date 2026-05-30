// src/stores/sessionStore.js — avatar session data in memory only (never persisted)
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
	const agentId       = ref('')
	const sessionId     = ref('')
	// WHY: Original login username ("First Last"). Needed for CHECK_CIRCUIT probe
	// on mid-session WS reconnect — server keys circuits by `${grid}:${username}`.
	const username      = ref('')
	const simIp         = ref('')
	const simPort       = ref(0)
	const seedCap       = ref('')
	const regionName    = ref('')
	const regionX       = ref(0)    // global region X (world map coords)
	const regionY       = ref(0)
	// WHY: regionSizeX/Y are the sim region dimensions in metres (256 standard, 512 var-region).
	// Used by useWorldEngine for terrain geometry, dead-reckoning clamps, and coordinate display.
	const regionSizeX   = ref(256)
	const regionSizeY   = ref(256)
	const startLocation = ref('')   // 'last', 'home', or 'uri:...' as echoed by grid
	const agentAccess   = ref('')   // 'M', 'A', etc — agent's account access cap (XML-RPC)
	const regionAccess  = ref(0)    // SL access code from RegionHandshake: 13=PG, 21=Mature, 42=Adult, 254=down
	// WHY: render-critical environment from RegionHandshake. waterHeight anchors the water plane
	// and the terrain colour palette (sea level varies per region). terrainTextures holds the 4
	// detail-texture UUIDs + per-corner blend heights for future textured terrain (J2C pipeline).
	const waterHeight   = ref(20)
	const terrainTextures = ref({ detail: ['', '', '', ''], startHeight: [0, 0, 0, 0], heightRange: [0, 0, 0, 0] })
	const connected     = ref(false)

	function setSession(data) {
		agentId.value       = data.agentId       ?? ''
		sessionId.value     = data.sessionId     ?? ''
		username.value      = data.username      ?? username.value
		simIp.value         = data.simIp         ?? ''
		simPort.value       = data.simPort        ?? 0
		seedCap.value       = data.seedCap       ?? ''
		regionName.value    = data.regionName    ?? ''
		regionX.value       = data.regionX       ?? 0
		regionY.value       = data.regionY       ?? 0
		regionSizeX.value   = data.regionSizeX   ?? 256
		regionSizeY.value   = data.regionSizeY   ?? 256
		startLocation.value = data.startLocation ?? ''
		agentAccess.value   = data.agentAccess   ?? ''
		connected.value     = true
	}

	function clearSession() {
		agentId.value = sessionId.value = simIp.value = seedCap.value = ''
		username.value = ''
		regionName.value = startLocation.value = agentAccess.value = ''
		simPort.value = regionX.value = regionY.value = 0
		regionSizeX.value = regionSizeY.value = 256
		waterHeight.value = 20
		terrainTextures.value = { detail: ['', '', '', ''], startHeight: [0, 0, 0, 0], heightRange: [0, 0, 0, 0] }
		connected.value = false
	}

	return {
		agentId, sessionId, username, simIp, simPort, seedCap,
		regionName, regionX, regionY, regionSizeX, regionSizeY,
		startLocation, agentAccess, regionAccess, waterHeight, terrainTextures,
		connected, setSession, clearSession,
	}
})
