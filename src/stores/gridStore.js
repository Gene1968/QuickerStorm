// src/stores/gridStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import gridsJson from '@/config/grids.json'

export const useGridStore = defineStore('grid', () => {
	const grids = Object.entries(gridsJson).map(([nick, g]) => ({ nick, ...g }))
	const selectedNick = ref(grids[0]?.nick ?? 'agni')
	const loginState   = ref('idle')  // 'idle' | 'loading' | 'connected' | 'error'
	const loginError   = ref('')

	const selectedGrid = computed(() => grids.find(g => g.nick === selectedNick.value) ?? null)

	function selectGrid(nick) { selectedNick.value = nick }
	function setLoginState(state, error = '') {
		loginState.value = state
		loginError.value = error
	}

	return { grids, selectedNick, selectedGrid, loginState, loginError, selectGrid, setLoginState }
})
