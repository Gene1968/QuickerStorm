// src/stores/sessionStore.js — avatar session data in memory only (never persisted)
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
	const agentId    = ref('')
	const sessionId  = ref('')
	const simIp      = ref('')
	const simPort    = ref(0)
	const seedCap    = ref('')
	const regionName = ref('')
	const connected  = ref(false)

	function setSession(data) {
		agentId.value    = data.agentId ?? ''
		sessionId.value  = data.sessionId ?? ''
		simIp.value      = data.simIp ?? ''
		simPort.value    = data.simPort ?? 0
		seedCap.value    = data.seedCap ?? ''
		regionName.value = data.regionName ?? ''
		connected.value  = true
	}

	function clearSession() {
		agentId.value = sessionId.value = simIp.value = seedCap.value = regionName.value = ''
		simPort.value = 0
		connected.value = false
	}

	return { agentId, sessionId, simIp, simPort, seedCap, regionName, connected, setSession, clearSession }
})
