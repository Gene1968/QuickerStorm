// src/stores/sessionStore.js — avatar session data in memory only (never persisted)
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
	const agentId       = ref('')
	const sessionId     = ref('')
	const simIp         = ref('')
	const simPort       = ref(0)
	const seedCap       = ref('')
	const regionName    = ref('')
	const regionX       = ref(0)    // global region X (world map coords)
	const regionY       = ref(0)
	const startLocation = ref('')   // 'last', 'home', or 'uri:...' as echoed by grid
	const agentAccess   = ref('')   // 'M', 'A', etc
	const connected     = ref(false)

	function setSession(data) {
		agentId.value       = data.agentId       ?? ''
		sessionId.value     = data.sessionId     ?? ''
		simIp.value         = data.simIp         ?? ''
		simPort.value       = data.simPort        ?? 0
		seedCap.value       = data.seedCap       ?? ''
		regionName.value    = data.regionName    ?? ''
		regionX.value       = data.regionX       ?? 0
		regionY.value       = data.regionY       ?? 0
		startLocation.value = data.startLocation ?? ''
		agentAccess.value   = data.agentAccess   ?? ''
		connected.value     = true
	}

	function clearSession() {
		agentId.value = sessionId.value = simIp.value = seedCap.value = ''
		regionName.value = startLocation.value = agentAccess.value = ''
		simPort.value = regionX.value = regionY.value = 0
		connected.value = false
	}

	return {
		agentId, sessionId, simIp, simPort, seedCap,
		regionName, regionX, regionY, startLocation, agentAccess,
		connected, setSession, clearSession,
	}
})
