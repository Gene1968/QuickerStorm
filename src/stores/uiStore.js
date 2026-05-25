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
	const showSettings       = ref(false)
	const showDebug          = ref(false)    // debug/connection panel
	const showPreferences    = ref(false)    // full Preferences floater (Ctrl+P)
	const showQuickPrefs     = ref(false)    // Quick Prefs popover (bottom-bar btn)
	const showVoiceControls  = ref(false)    // voice controls floater (stub)
	const showMoveControls   = ref(false)    // movement controls floater (stub)
	const showCameraControls = ref(false)    // camera controls floater (stub)
	const showAppearance     = ref(false)    // avatar appearance floater (stub)
	const showSearch         = ref(false)    // search floater (stub)
	const showSnapshot       = ref(false)    // snapshot/screenshot floater (stub)
	const showAO             = ref(false)    // animation override floater (stub)
	const showMovementHelp   = ref(false)    // movement help floater
	const preferenceActiveTab = ref('appearance') // active tab id in Preferences floater
	const showProfile        = ref(false)    // profile floater
	const profileTargetId    = ref(null)     // null = self; UUID string = other user
	const floaterStack       = ref([])       // ordered by focus; last = topmost/active floater

	function toggleMode()        { mode.value = mode.value === '3d' ? '2d' : '3d' }
	function toggleAvatarList()  { showAvatarList.value  = !showAvatarList.value }
	function toggleMinimap()     { showMinimap.value     = !showMinimap.value }
	function toggleChat()        { showChat.value        = !showChat.value }
	function toggleInventory()   { showInventory.value   = !showInventory.value }
	function toggleMap()         { showMap.value         = !showMap.value }
	function toggleSettings()    { showSettings.value    = !showSettings.value }
	function toggleDebug()       { showDebug.value       = !showDebug.value }
	function togglePreferences()    { showPreferences.value    = !showPreferences.value; showQuickPrefs.value = false }
	function openPreferences()      { showPreferences.value    = true;  showQuickPrefs.value = false }
	function toggleQuickPrefs()     { showQuickPrefs.value     = !showQuickPrefs.value; showPreferences.value = false }
	function toggleVoiceControls()  { showVoiceControls.value  = !showVoiceControls.value }
	function toggleMoveControls()   { showMoveControls.value   = !showMoveControls.value }
	function toggleCameraControls() { showCameraControls.value = !showCameraControls.value }
	function toggleAppearance()     { showAppearance.value     = !showAppearance.value }
	function toggleSearch()         { showSearch.value         = !showSearch.value }
	function toggleSnapshot()       { showSnapshot.value       = !showSnapshot.value }
	function toggleAO()             { showAO.value             = !showAO.value }
	function toggleMovementHelp()   { showMovementHelp.value   = !showMovementHelp.value }
	function openPreferencesOnTab(tabId) {
		preferenceActiveTab.value = tabId
		showPreferences.value     = true
		showQuickPrefs.value      = false
	}
	function openProfile(id = null) { profileTargetId.value = id; showProfile.value = true }
	function toggleProfile()        { showProfile.value = !showProfile.value }
	// WHY: push to top of stack on focus; remove+re-add keeps order clean
	function focusFloater(id) {
		floaterStack.value = [...floaterStack.value.filter(f => f !== id), id]
	}

	// Camera position + heading — updated by useWorldEngine at ~4 Hz, not every frame
	const cameraPos = shallowRef({ x: 128, y: 25, z: 128 })  // SL coords (x, z=height, y)
	function setCameraPos(x, y, z) {
		cameraPos.value = { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
	}

	// Three.js yaw radians; 0 = facing North (SL +Y). SL world angle = π/2 + cameraYaw.
	const cameraYaw = ref(0)
	function setCameraYaw(y) { cameraYaw.value = y }

	return {
		mode, showAvatarList, showMinimap, showChat,
		showInventory, showMap, showSettings, showDebug,
		showPreferences, showQuickPrefs,
		showVoiceControls, showMoveControls, showCameraControls,
		showAppearance, showSearch, showSnapshot, showAO,
		showMovementHelp, preferenceActiveTab,
		showProfile, profileTargetId,
		toggleMode, toggleAvatarList, toggleMinimap, toggleChat,
		toggleInventory, toggleMap, toggleSettings, toggleDebug,
		togglePreferences, openPreferences, toggleQuickPrefs,
		toggleVoiceControls, toggleMoveControls, toggleCameraControls,
		toggleAppearance, toggleSearch, toggleSnapshot, toggleAO,
		toggleMovementHelp, openPreferencesOnTab,
		openProfile, toggleProfile,
		floaterStack, focusFloater,
		cameraPos, setCameraPos,
		cameraYaw, setCameraYaw,
	}
})
