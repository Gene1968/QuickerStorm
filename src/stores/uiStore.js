// src/stores/uiStore.js — UI mode, panel visibility, camera position readout
import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { useChatStore } from './chatStore'

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
	const showPlaces         = ref(false)    // Places floater (landmarks + favorites)
	const preferenceActiveTab = ref('appearance') // active tab id in Preferences floater
	const showProfile        = ref(false)    // profile floater
	const profileTargetId    = ref(null)     // null = self; UUID string = other user
	const floaterStack       = ref([])       // ordered by focus; last = topmost/active floater
	const alwaysRun          = ref(false)    // SL AGENT_CONTROL_ALWAYS_RUN flag — Ctrl+R toggle
	const flying             = ref(false)    // mirrors engine isFlying for UI button state

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
	function togglePlaces()         { showPlaces.value         = !showPlaces.value }
	// WHY: FS parity — emit "Always Run enabled./disabled." into Nearby Chat on state change
	function _notifyAlwaysRun() {
		useChatStore().addMessage({
			fromName: 'System',
			message:  `Always Run ${alwaysRun.value ? 'enabled' : 'disabled'}.`,
			chatType: 0,
		})
	}
	function toggleAlwaysRun() {
		alwaysRun.value = !alwaysRun.value
		_notifyAlwaysRun()
	}
	function setAlwaysRun(v) {
		const next = !!v
		if (next === alwaysRun.value) return
		alwaysRun.value = next
		_notifyAlwaysRun()
	}
	function setFlying(v) { flying.value = !!v }
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

	const uiVisible = ref(true)
	function toggleUiVisible() { uiVisible.value = !uiVisible.value }

	// WHY: Ctrl+W closes topmost floater by mapping FloaterWindow id → show ref.
	// Stack may have stale IDs (FloaterWindow doesn't clean up on unmount), so always
	// remove the popped ID from the stack regardless.
	const _FLOATER_CLOSE = {
		conversations:   () => { showChat.value         = false },
		map:             () => { showMap.value           = false },
		inventory:       () => { showInventory.value     = false },
		appearance:      () => { showAppearance.value    = false },
		move:            () => { showMoveControls.value  = false },
		camera:          () => { showCameraControls.value = false },
		places:          () => { showPlaces.value        = false },
		'object-edit':   () => { showObjectEdit.value    = false },
		preferences:     () => { showPreferences.value   = false },
		profile:         () => { showProfile.value       = false },
		'movement-help': () => { showMovementHelp.value  = false },
	}
	function closeActiveFloater() {
		if (!floaterStack.value.length) return
		const topId = floaterStack.value.at(-1)
		floaterStack.value = floaterStack.value.filter(f => f !== topId)
		_FLOATER_CLOSE[topId]?.()
	}

	// Camera position + heading — updated by useWorldEngine at ~4 Hz, not every frame
	const cameraPos = shallowRef({ x: 128, y: 25, z: 128 })  // SL coords (x, z=height, y)
	function setCameraPos(x, y, z) {
		cameraPos.value = { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
	}

	// Three.js yaw radians; 0 = facing North (SL +Y). SL world angle = π/2 + cameraYaw.
	const cameraYaw = ref(0)
	function setCameraYaw(y) { cameraYaw.value = y }

	// WHY: avatar context menu — populated by useWorldEngine raycast contextmenu handler.
	// `target` carries the picked avatar's identity + screen position so AvatarContextMenu.vue
	// can render at the click point and dispatch IM / Face Toward / Profile actions.
	const avatarMenu = ref(null)  // null | { agentId, name, localId, x, y }
	function openAvatarMenu(target) { avatarMenu.value = target }
	function closeAvatarMenu()      { avatarMenu.value = null }

	// WHY: object (prim) context menu — Inspect / Touch / Sit. Phase 2 subset; edit/take/copy
	// require HTTP caps + perms (Phase 3).
	const objectMenu = ref(null)  // null | { localId, fullId, name, pos, x, y }
	function openObjectMenu(target) { objectMenu.value = target }
	function closeObjectMenu()      { objectMenu.value = null }

	// WHY: ObjectEditFloater target — single localId driving the inspector. Right-click menu
	// "Edit" sets this and toggles showObjectEdit. null = floater shows empty-state.
	const showObjectEdit = ref(false)
	const editObjectId   = ref(null)
	// WHY: Phase 2 prim-handle preview — gizmo type rendered around the selected prim while
	// Build Tools is open. Ctrl → 'rotate' rings, Ctrl+Shift → 'scale' cubes, default 'move' arrows.
	// Edit actions are Phase 3 (HTTP-cap perms); this is purely the visual scaffold.
	const gizmoMode      = ref('move')
	function setGizmoMode(m) { gizmoMode.value = m }
	function openObjectEdit(localId) { editObjectId.value = localId; showObjectEdit.value = true; closeObjectMenu() }
	function toggleObjectEdit()      { showObjectEdit.value = !showObjectEdit.value }

	return {
		mode, showAvatarList, showMinimap, showChat,
		showInventory, showMap, showSettings, showDebug,
		showPreferences, showQuickPrefs,
		showVoiceControls, showMoveControls, showCameraControls,
		showAppearance, showSearch, showSnapshot, showAO,
		showMovementHelp, showPlaces, preferenceActiveTab,
		showProfile, profileTargetId,
		toggleMode, toggleAvatarList, toggleMinimap, toggleChat,
		toggleInventory, toggleMap, toggleSettings, toggleDebug,
		togglePreferences, openPreferences, toggleQuickPrefs,
		toggleVoiceControls, toggleMoveControls, toggleCameraControls,
		toggleAppearance, toggleSearch, toggleSnapshot, toggleAO,
		toggleMovementHelp, togglePlaces, openPreferencesOnTab,
		alwaysRun, toggleAlwaysRun, setAlwaysRun,
		flying, setFlying,
		openProfile, toggleProfile,
		floaterStack, focusFloater,
		uiVisible, toggleUiVisible, closeActiveFloater,
		cameraPos, setCameraPos,
		cameraYaw, setCameraYaw,
		avatarMenu, openAvatarMenu, closeAvatarMenu,
		objectMenu, openObjectMenu, closeObjectMenu,
		showObjectEdit, editObjectId, openObjectEdit, toggleObjectEdit,
		gizmoMode, setGizmoMode,
	}
})
