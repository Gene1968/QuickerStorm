// src/stores/debugStore.js — ring-buffer for server log lines forwarded via S.DEBUG
// WHY: S.DEBUG messages are emitted at login time before the DebugPanel is mounted.
// Buffering here means opening the panel after login still shows the full history.
import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX = 80

export const useDebugStore = defineStore('debug', () => {
	const lines = ref([])  // [{ level, msg, id }]
	let nextId = 0

	function push(level, msg) {
		lines.value.push({ level, msg, id: nextId++ })
		if (lines.value.length > MAX) lines.value.splice(0, lines.value.length - MAX)
	}

	function clear() { lines.value = [] }

	return { lines, push, clear }
})
