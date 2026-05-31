// src/stores/uiStore.js — UI mode, panel visibility, camera position readout
import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { useChatStore } from './chatStore'

// WHY: Inventory supports up to 6 simultaneous floaters (per-bag, multi-view).
// Default positions are arranged in a brick pattern so opening many at once
// keeps them legible — row 1: #1+#2 side-by-side; row 2: #3 half-offset above;
// row 3: #4+#5 full; row 4: #6 half-offset. User drag overrides defaultPos.
export const MAX_INVENTORY = 6
const INV_ROW_BOTTOM = [
	'2.575rem',
	'calc(2.575rem + 47vh + 0.125rem)',
	'calc(2.575rem + 92vh + 0.0625rem)',
]
export const INVENTORY_DEFAULT_POS = [
	{ left: '0.0625vw', bottom: INV_ROW_BOTTOM[0] }, // #1
	{ left: '15.5625vw', bottom: INV_ROW_BOTTOM[0] }, // #2
	{ left: '7.8125vw', bottom: INV_ROW_BOTTOM[1] }, // #3
	{ left: '31.0625vw', bottom: INV_ROW_BOTTOM[0] }, // #4
	{ left: '23.3125vw', bottom: INV_ROW_BOTTOM[1] }, // #5
	{ left: '46.5625vw', bottom: INV_ROW_BOTTOM[0] }, // #6
]

export const useUiStore = defineStore('ui', () => {
	const mode           = ref('3d')      // '3d' | '2d'
	const showAvatarList = ref(true)
	const showMinimap    = ref(true)
	const showChat       = ref(true)
	// WHY: Inventory is multi-instance — array of indices currently open (0..MAX_INVENTORY-1).
	// showInventory kept as a computed for legacy callers (toolbar/menu active state); they
	// reflect whether instance #0 is open. Suitcase button inside floater #N opens floater #N+1.
	const inventoryInstances = ref([])
	const showInventory      = computed(() => inventoryInstances.value.includes(0))
	const showMap        = ref(false)
	const showNotifications = ref(false)
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
	const placesActiveTab    = ref('favorites') // 'favorites' | 'landmarks' | 'history'
	const preferenceActiveTab = ref('appearance') // active tab id in Preferences floater
	const showProfile        = ref(false)    // profile floater
	const profileTargetId    = ref(null)     // null = self; UUID string = other user
	const showCreateLandmark = ref(false)    // "Create Landmark" dialog (World→Landmark This Place / star)
	const createLandmarkPrefill = ref(null)  // { name } default for the dialog (region name)
	const floaterStack       = ref([])       // ordered by focus; last = topmost/active floater
	const alwaysRun          = ref(false)    // SL AGENT_CONTROL_ALWAYS_RUN flag — Ctrl+R toggle
	const flying             = ref(false)    // mirrors engine isFlying for UI button state

	function toggleMode()        { mode.value = mode.value === '3d' ? '2d' : '3d' }
	function toggleAvatarList()  { showAvatarList.value  = !showAvatarList.value }
	function toggleMinimap()     { showMinimap.value     = !showMinimap.value }
	function toggleChat()        { showChat.value        = !showChat.value }
	function openInventoryAt(idx) {
		if (idx < 0 || idx >= MAX_INVENTORY) return
		if (inventoryInstances.value.includes(idx)) return
		inventoryInstances.value = [...inventoryInstances.value, idx].sort((a, b) => a - b)
	}
	function closeInventoryAt(idx) {
		if (!inventoryInstances.value.includes(idx)) return
		inventoryInstances.value = inventoryInstances.value.filter(i => i !== idx)
		// Remove from floater stack too, otherwise Ctrl+W finds a stale id.
		floaterStack.value = floaterStack.value.filter(f => f !== `inventory-${idx}`)
	}
	function toggleInventoryAt(idx) {
		if (inventoryInstances.value.includes(idx)) closeInventoryAt(idx)
		else openInventoryAt(idx)
	}
	// WHY: Ctrl+Shift+I opens the next available slot (0..MAX). Returns the opened idx
	// or -1 if all slots are full so callers can stop.
	function openNextInventory() {
		for (let i = 0; i < MAX_INVENTORY; i++) {
			if (!inventoryInstances.value.includes(i)) { openInventoryAt(i); return i }
		}
		return -1
	}
	function toggleInventory() { toggleInventoryAt(0) }
	function toggleMap()         { showMap.value         = !showMap.value }
	function toggleNotifications() { showNotifications.value = !showNotifications.value }
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
	function openPlacesOnTab(tabId) { placesActiveTab.value = tabId; showPlaces.value = true }
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
	function openCreateLandmark(prefill = null) { createLandmarkPrefill.value = prefill; showCreateLandmark.value = true }
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
		notifications:   () => { showNotifications.value = false },
		appearance:      () => { showAppearance.value    = false },
		move:            () => { showMoveControls.value  = false },
		camera:          () => { showCameraControls.value = false },
		places:          () => { showPlaces.value        = false },
		'object-edit':   () => { showObjectEdit.value    = false },
		preferences:     () => { showPreferences.value   = false },
		profile:         () => { showProfile.value       = false },
		'create-landmark': () => { showCreateLandmark.value = false },
		'movement-help': () => { showMovementHelp.value  = false },
		quickprefs:      () => { showQuickPrefs.value    = false },
	}
	function closeActiveFloater() {
		if (!floaterStack.value.length) return
		const topId = floaterStack.value.at(-1)
		floaterStack.value = floaterStack.value.filter(f => f !== topId)
		// WHY: inventory ids are 'inventory-N' (multi-instance). Map back to instance close.
		if (typeof topId === 'string' && topId.startsWith('inventory-')) {
			const idx = Number(topId.slice('inventory-'.length))
			if (Number.isFinite(idx)) closeInventoryAt(idx)
			return
		}
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
		showInventory, showMap, showNotifications, showSettings, showDebug,
		showPreferences, showQuickPrefs,
		showVoiceControls, showMoveControls, showCameraControls,
		showAppearance, showSearch, showSnapshot, showAO,
		showMovementHelp, showPlaces, preferenceActiveTab,
		showProfile, profileTargetId,
		toggleMode, toggleAvatarList, toggleMinimap, toggleChat,
		toggleInventory, toggleMap, toggleNotifications, toggleSettings, toggleDebug,
		inventoryInstances, openInventoryAt, closeInventoryAt, toggleInventoryAt, openNextInventory,
		togglePreferences, openPreferences, toggleQuickPrefs,
		toggleVoiceControls, toggleMoveControls, toggleCameraControls,
		toggleAppearance, toggleSearch, toggleSnapshot, toggleAO,
		toggleMovementHelp, togglePlaces, openPlacesOnTab, placesActiveTab, openPreferencesOnTab,
		alwaysRun, toggleAlwaysRun, setAlwaysRun,
		flying, setFlying,
		openProfile, toggleProfile,
		showCreateLandmark, createLandmarkPrefill, openCreateLandmark,
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
