// src/stores/uiStore.js — UI mode, panel visibility, camera position readout
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'

export const useUiStore = defineStore('ui', () => {
	const mode           = ref('3d')      // '3d' | '2d'
	const showAvatarList = ref(true)
	const showMinimap    = ref(true)
	const showChat       = ref(true)
	const showInventory  = ref(false)
	const showMap        = ref(false)
	const showSettings   = ref(false)
	const showDebug      = ref(false)    // debug/connection panel

	function toggleMode()      { mode.value = mode.value === '3d' ? '2d' : '3d' }
	function toggleAvatarList(){ showAvatarList.value = !showAvatarList.value }
	function toggleMinimap()   { showMinimap.value   = !showMinimap.value }
	function toggleChat()      { showChat.value       = !showChat.value }
	function toggleInventory() { showInventory.value  = !showInventory.value }
	function toggleMap()       { showMap.value        = !showMap.value }
	function toggleSettings()  { showSettings.value   = !showSettings.value }
	function toggleDebug()     { showDebug.value      = !showDebug.value }

	// Camera position — updated by useWorldEngine at ~4 Hz, not every frame
	const cameraPos = shallowRef({ x: 128, y: 25, z: 128 })  // SL coords (x, z=height, y)
	function setCameraPos(x, y, z) {
		cameraPos.value = { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
	}

	return {
		mode, showAvatarList, showMinimap, showChat,
		showInventory, showMap, showSettings, showDebug,
		toggleMode, toggleAvatarList, toggleMinimap, toggleChat,
		toggleInventory, toggleMap, toggleSettings, toggleDebug,
		cameraPos, setCameraPos,
	}
})
