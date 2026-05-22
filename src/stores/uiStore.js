// src/stores/uiStore.js — UI mode and panel visibility
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
	const mode           = ref('3d')      // '3d' | '2d'
	const showAvatarList = ref(true)
	const showMinimap    = ref(true)
	const showChat       = ref(true)

	function toggleMode() { mode.value = mode.value === '3d' ? '2d' : '3d' }

	return { mode, showAvatarList, showMinimap, showChat, toggleMode }
})
