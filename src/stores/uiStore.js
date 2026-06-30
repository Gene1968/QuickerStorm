// src/stores/uiStore.js — UI mode, panel visibility, camera position readout
import { defineStore } from 'pinia'
import { ref, computed, shallowRef, watch } from 'vue'
import { useChatStore } from './chatStore'
import { computeAutoGeomCacheMb } from '@/lib/geomCache.js'

// WHY: One-shot guard so the Inventory floater auto-opens on the first world load of the
// page session, but an SPA re-login (which re-mounts WorldView) respects a manual close —
// see autoOpenInventoryOnce. Module-level (not a store ref) so it survives store re-creation
// across re-login while still resetting on a real page reload.
let _inventoryAutoOpened = false

// WHY: Inventory supports up to 6 simultaneous floaters (per-bag, multi-view).
// Default positions are arranged in a brick pattern so opening many at once
// keeps them legible — row 1: #1+#2 side-by-side; row 2: #3 half-offset above;
// row 3: #4+#5 full; row 4: #6 half-offset. User drag overrides defaultPos.
export const MAX_INVENTORY = 6
const INV_ROW_TOP = [
	'calc(100vh - 2.175rem - 28rem)',
	'calc(100vh - 2.175rem - 56rem - 0.125rem)',
]
export const INVENTORY_DEFAULT_POS = [
	{ left: '0.0625rem', top: INV_ROW_TOP[0] },// #1
	{ left: '17.3125rem', top: INV_ROW_TOP[0] },// #2
	{ left: '8.63125rem', top: INV_ROW_TOP[1] },// #3
	{ left: '34.5625rem', top: INV_ROW_TOP[0] },// #4
	{ left: '26.00625rem', top: INV_ROW_TOP[1] },// #5
	{ left: '51.725rem', top: INV_ROW_TOP[0] },// #6
]

export const useUiStore = defineStore('ui', () => {
	const mode           = ref('3d')      // '3d' | '2d'
	const showAvatarList = ref(true)
	const showMinimap    = ref(true)
	const showChat       = ref(true)
	// WHY: Comm ▸ Friends opens Conversations straight to a named vertical tab (e.g. 'contacts').
	// ConversationsFloater watches this, selects the tab, then clears it so a re-click re-fires.
	const chatActiveTab  = ref(null)   // null | 'contacts' | 'nearby' | <imAgentId>
	// WHY: Inventory is multi-instance — array of indices currently open (0..MAX_INVENTORY-1).
	// showInventory kept as a computed for legacy callers (toolbar/menu active state); they
	// reflect whether instance #0 is open. Suitcase button inside floater #N opens floater #N+1.
	const inventoryInstances = ref([])
	const showInventory      = computed(() => inventoryInstances.value.includes(0))
	const showMap        = ref(false)
	const teleportStatus = ref('')   // '' = idle, 'requesting'|'contacting'|'arriving' = in flight
	const showNotifications = ref(false)
	const showSettings       = ref(false)
	const showDebug          = ref(false)    // debug/connection panel
	const showPreferences    = ref(false)    // full Preferences floater (Ctrl+P)
	const showQuickPrefs     = ref(false)    // Quick Prefs popover (bottom-bar btn)
	const showVoiceControls  = ref(false)    // voice controls floater (stub)
	const showMoveControls   = ref(false)    // movement controls floater (stub)
	const showCameraControls = ref(false)    // camera controls floater (stub)
	const showAppearance     = ref(false)    // avatar appearance floater (stub)
	const appearanceActiveTab = ref('wearing') // 'gallery' | 'outfits' | 'wearing'
	const showSearch         = ref(false)    // search floater (stub)
	const showSnapshot       = ref(false)    // snapshot/screenshot floater (stub)
	const showAO             = ref(false)    // animation override floater (stub)
	const showMovementHelp   = ref(false)    // movement help floater
	const showPlaces         = ref(false)    // Places floater (landmarks + favorites)
	const placesActiveTab    = ref('favorites') // 'favorites' | 'landmarks' | 'history'
	const preferenceActiveTab = ref('appearance') // active tab id in Preferences floater
	// WHY: Profile is multi-instance — open several at once for different users (mirrors inventory).
	// Each entry is a target id: null = self, UUID string = other user. Order = open order.
	const profileInstances   = ref([])
	const showProfile        = computed(() => profileInstances.value.includes(null)) // self-open (toolbar active state)
	const profileTargetId    = ref(null)     // map-centering target (set by Conversations actMap/imMap) — NOT the profile floater source
	const showCreateLandmark = ref(false)    // "Create Landmark" dialog (World→Landmark This Place / star)
	const createLandmarkPrefill = ref(null)  // { name } default for the dialog (region name)
	const floaterStack       = ref([])       // ordered by focus; last = topmost/active floater
	const alwaysRun          = ref(false)    // SL AGENT_CONTROL_ALWAYS_RUN flag — Ctrl+R toggle
	const flying             = ref(false)    // mirrors engine isFlying for UI button state
	// Scene-rebuild request channel (MenuBar → worldEngine): bump the tick to ask the engine to
	// clear cull-evictions, re-queue every known object, and resync from the server. Heavier than
	// Resync World — that one only replays server state, which the engine IGNORES for objects it
	// has memory-evicted, so it cannot recover a culled-empty scene. This can.
	const sceneRebuildTick   = ref(0)
	function requestSceneRebuild() { sceneRebuildTick.value++ }
	// ObjectContextMenu "Texture refresh" → engine clears the object's texture failure/cache state and
	// re-applies (manual escape hatch for an object stuck bare). Carries the target localId; `seq` bumps
	// so the engine's watch fires even when the same object is refreshed twice in a row.
	const textureRefreshReq  = ref(null)
	function requestTextureRefresh(localId) {
		textureRefreshReq.value = { localId, seq: (textureRefreshReq.value?.seq ?? 0) + 1 }
	}
	// WHY: FS-parity lit shading (MeshLambert + scene lights) so untextured/blank-white surfaces show
	// form through shading instead of rendering as flat cutouts. Default ON; worldEngine watches and
	// swaps materials live, and auto-disables it (once per session, with a notification) if FPS stays
	// below its floor — the weak-GPU mitigation. Persisted so the choice survives reload.
	const litShading         = ref(localStorage.getItem('qs-lit-shading') !== '0')
	// FEATURE-GAPS #6 draw-call instancing — default OFF until live-verified.
	const instancing         = ref(localStorage.getItem('qs-instancing') === '1')
	// FPS readout in the top-right tray (FS lag-meter stand-in). Persisted, default ON.
	const showFps            = ref(localStorage.getItem('qs-show-fps') !== '0')
	// Kill-switch for the off-main-thread cache I/O worker (qs-geom + qs-mesh). Default ON; turning
	// it off forces the main-thread cache path (sync fallback). See useCacheIO / geomCache client.
	const cacheWorker        = ref(localStorage.getItem('qs-cache-worker') !== '0')
	// Day/night cycle: follow region sun time (default ON). When off, a fixed time-of-day override
	// (0..1) drives the sky directly. See useEnvironment.js + skyDome.js.
	const dayNightCycle      = ref(localStorage.getItem('qs-daynight-cycle') !== '0')
	const _todSaved          = Number(localStorage.getItem('qs-time-of-day'))
	const timeOfDay          = ref(Number.isFinite(_todSaved) && _todSaved >= 0 && _todSaved <= 1 ? _todSaved : 0.5)
	watch(dayNightCycle, (v) => localStorage.setItem('qs-daynight-cycle', v ? '1' : '0'))
	watch(timeOfDay, (v) => localStorage.setItem('qs-time-of-day', String(v)))
	watch(litShading, (v) => localStorage.setItem('qs-lit-shading', v ? '1' : '0'))
	watch(instancing, (v) => localStorage.setItem('qs-instancing',  v ? '1' : '0'))
	watch(showFps,    (v) => localStorage.setItem('qs-show-fps',    v ? '1' : '0'))
	watch(cacheWorker, (v) => localStorage.setItem('qs-cache-worker', v ? '1' : '0'))
	// Live FPS + inbound WS bandwidth (kbps) — written by useWorldEngine's animate loop at ~1 Hz
	// (not every frame). Displayed in the AudioControlsWidget top-bar stats cluster.
	const fps                = ref(0)
	const netKbps            = ref(0)
	function setFps(v) { fps.value = v }
	function setNetKbps(v) { netKbps.value = v }

	// FS-parity draw distance (metres): the TARGET object residency / stream radius. The memory
	// governor (useWorldEngine cullTick) auto-steps the EFFECTIVE radius DOWN under budget pressure
	// and back UP toward this target with headroom — the browser equivalent of FS progressive draw-
	// distance stepping + auto-lower-on-low-VRAM. WHY budget-driven not VRAM: a browser cannot query
	// VRAM; the self-accounted asset-byte budget (memGovernor) is the only truthful pressure signal,
	// and FS itself only reads VRAM once at startup. A QuickPrefs/Prefs slider binds to `drawDistance`.
	// Persisted (mirrors litShading). `effectiveDrawDistance` is the governor's current value for UI.
	const _ddSaved = Number(localStorage.getItem('qs-draw-distance'))
	const drawDistance = ref(Number.isFinite(_ddSaved) && _ddSaved >= 32 && _ddSaved <= 512 ? _ddSaved : 96)
	watch(drawDistance, (v) => localStorage.setItem('qs-draw-distance', String(v)))
	function setDrawDistance(v) { drawDistance.value = Math.max(32, Math.min(512, Math.round(Number(v) || 96))) }
	const effectiveDrawDistance = ref(96)   // governor-managed current radius; not persisted (runtime)
	function setEffectiveDrawDistance(v) { effectiveDrawDistance.value = Math.round(v) }

	// Geometry-cache CPU-RAM budget (MB). This pool (mem tier + write buffer) lives only in tab RAM
	// and never uploads to the GPU, so it is sized separately from the 1536MB VRAM governor. RAM has
	// no precise web API: navigator.deviceMemory is coarse (capped at 8), so the default is a tier
	// off it and a persisted user override wins (high-end boxes report only "8"). A Prefs slider binds
	// to `geomCacheRamMb`; useWorldEngine applies it via geomCache.setGeomMemBudget on init + on change.
	function _autoGeomCacheMb() {
		// Heap-headroom-based auto default (see geomCache.computeAutoGeomCacheMb). The mem tier is
		// tab-heap ArrayBuffers; sizing it off the per-tab heap (not device RAM) keeps dense regions
		// OOM-safe (FEATURE-GAPS #13), and a runtime heap-pressure cap backstops it. Raised to ~768MB on
		// a 4GB tab heap so a heavy region's working set fits in RAM and warm re-entry serves from the
		// synchronous mem tier instead of the saturation-starved IDB read path (FEATURE-GAPS #10/#11).
		const hl = typeof performance !== 'undefined' && performance.memory && performance.memory.jsHeapSizeLimit
		const dm = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined
		return computeAutoGeomCacheMb({ heapLimitBytes: hl || undefined, deviceMemory: dm })
	}
	const _gcSaved = Number(localStorage.getItem('qs-geom-cache-mb'))
	const geomCacheRamMb = ref(Number.isFinite(_gcSaved) && _gcSaved >= 128 && _gcSaved <= 8192 ? _gcSaved : _autoGeomCacheMb())
	watch(geomCacheRamMb, (v) => localStorage.setItem('qs-geom-cache-mb', String(v)))
	function setGeomCacheRamMb(v) { geomCacheRamMb.value = Math.max(128, Math.min(8192, Math.round(Number(v) || _autoGeomCacheMb()))) }

	// Resident-asset / VRAM budget (MB) — gates the draw-distance governor (FEATURE-GAPS #13). 0 = auto
	// (heap-scaled default in memGovernor). A higher value keeps more resident → larger visible radius;
	// VRAM is unqueryable so this is a user opt-in (the heap-aware governor still backstops CPU heap).
	// useWorldEngine applies it via memGovernor.setAppBudgetOverride on init + on change.
	const _vbSaved = Number(localStorage.getItem('qs-vram-budget-mb'))
	const vramBudgetMb = ref(Number.isFinite(_vbSaved) && _vbSaved > 0 ? Math.max(512, Math.min(6144, _vbSaved)) : 0)
	watch(vramBudgetMb, (v) => localStorage.setItem('qs-vram-budget-mb', String(v)))
	function setVramBudgetMb(v) { const n = Math.round(Number(v) || 0); vramBudgetMb.value = n <= 0 ? 0 : Math.max(512, Math.min(6144, n)) }

	function toggleMode()        { mode.value = mode.value === '3d' ? '2d' : '3d' }
	function toggleAvatarList()  { showAvatarList.value  = !showAvatarList.value }
	function toggleMinimap()     { showMinimap.value     = !showMinimap.value }
	function toggleChat()        { showChat.value        = !showChat.value }
	// WHY: open Conversations and land on a specific vertical tab (Comm ▸ Friends → 'contacts').
	function openChatOnTab(tabId) { showChat.value = true; chatActiveTab.value = tabId }
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
	// WHY: mirror how Conversations/Nearby greet the user with a floater already open, but only
	// on the FIRST world load of the page session. Guarded so an SPA re-login (re-mount) does not
	// re-force it open after the user manually closed it. A real page reload resets the guard.
	function autoOpenInventoryOnce() {
		if (_inventoryAutoOpened) return
		_inventoryAutoOpened = true
		openInventoryAt(0)
	}
	function toggleMap()         { showMap.value         = !showMap.value }
	function toggleNotifications() { showNotifications.value = !showNotifications.value }
	function toggleSettings()    { showSettings.value    = !showSettings.value }
	function toggleDebug()       { showDebug.value       = !showDebug.value }
	function togglePreferences()    { showPreferences.value    = !showPreferences.value; showQuickPrefs.value = false }
	function openPreferences()      { showPreferences.value    = true;  showQuickPrefs.value = false }
	function toggleQuickPrefs()     { showQuickPrefs.value     = !showQuickPrefs.value; }
	function toggleVoiceControls()  { showVoiceControls.value  = !showVoiceControls.value }
	function toggleMoveControls()   { showMoveControls.value   = !showMoveControls.value }
	function toggleCameraControls() { showCameraControls.value = !showCameraControls.value }
	function toggleAppearance()     { showAppearance.value     = !showAppearance.value }
	// WHY: Avatar ▸ "Now wearing…" opens straight to a tab; Ctrl+O / "Outfits" toggles the
	// floater on the Outfits tab (close if already showing it, else open + switch).
	function openAppearanceOnTab(tabId)  { appearanceActiveTab.value = tabId; showAppearance.value = true }
	function toggleAppearanceOnTab(tabId) {
		if (showAppearance.value && appearanceActiveTab.value === tabId) {
			showAppearance.value = false
		} else {
			appearanceActiveTab.value = tabId
			showAppearance.value = true
		}
	}
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
	// WHY: per-target floater id so each profile has its own focus/z-index + close mapping.
	function profileFloaterId(id) { return `profile-${id ?? 'self'}` }
	function openProfile(id = null) {
		if (!profileInstances.value.includes(id)) profileInstances.value = [...profileInstances.value, id]
		focusFloater(profileFloaterId(id))
	}
	function closeProfile(id = null) {
		profileInstances.value = profileInstances.value.filter(t => t !== id)
		floaterStack.value = floaterStack.value.filter(f => f !== profileFloaterId(id))
	}
	function toggleProfile() {
		if (profileInstances.value.includes(null)) closeProfile(null)
		else openProfile(null)
	}
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
		// WHY: profile ids are 'profile-self' | 'profile-<uuid>' (multi-instance).
		if (typeof topId === 'string' && topId.startsWith('profile-')) {
			const key = topId.slice('profile-'.length)
			closeProfile(key === 'self' ? null : key)
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
	const objectMenu = ref(null)  // null | { localId, fullId, name, pos, clickAction, x, y }
	function openObjectMenu(target) { objectMenu.value = target }
	function closeObjectMenu()      { objectMenu.value = null }

	// WHY: land/terrain context menu — pos = SL coords of the hit point; Walk To and Landmark use them.
	const landMenu = ref(null)  // null | { pos: [slX, slY, slZ], x, y }
	function openLandMenu(target)  { landMenu.value = target }
	function closeLandMenu()       { landMenu.value = null }

	// WHY: Warp request from LandContextMenu “Walk To”. worldEngine watches this; when non-null it
	// snaps avatarSLPos + mesh then clears it. Same pattern as waterHeight → rebuildTerrainFromStore.
	const pendingWarpPos = ref(null)  // null | [slX, slY, slZ]
	function requestWarp(x, y, z) { pendingWarpPos.value = [x, y, z] }
	function clearWarp()          { pendingWarpPos.value = null }

	// WHY: ObjectEditFloater target — single localId driving the inspector. Right-click menu
	// "Edit" sets this and toggles showObjectEdit. null = floater shows empty-state.
	const showObjectEdit = ref(false)
	const editObjectId   = ref(null)
	// WHY: FS "Edit linked" parity. OFF (default) → clicking any prim selects the whole linkset
	// (its root); the gizmo centers on the full-object bbox. ON → clicking selects the individual
	// prim under the cursor. Read by useWorldEngine's pick handler at click time.
	const editLinked     = ref(false)
	function setEditLinked(v) { editLinked.value = v }
	// WHY: Phase 2 prim-handle preview — gizmo type rendered around the selected prim while
	// Build Tools is open. Ctrl → 'rotate' rings, Ctrl+Shift → 'scale' cubes, default 'move' arrows.
	// Edit actions are Phase 3 (HTTP-cap perms); this is purely the visual scaffold.
	const gizmoMode      = ref('move')
	function setGizmoMode(m) { gizmoMode.value = m }
	function openObjectEdit(localId) { editObjectId.value = localId; showObjectEdit.value = true; editLinked.value = false; closeObjectMenu() }
	function toggleObjectEdit()      { showObjectEdit.value = !showObjectEdit.value }

	return {
		mode, showAvatarList, showMinimap, showChat, chatActiveTab, openChatOnTab,
		showInventory, showMap, showNotifications, showSettings, showDebug,
		showPreferences, showQuickPrefs,
		showVoiceControls, showMoveControls, showCameraControls,
		showAppearance, appearanceActiveTab, showSearch, showSnapshot, showAO,
		showMovementHelp, showPlaces, preferenceActiveTab,
		showProfile, profileTargetId, profileInstances,
		toggleMode, toggleAvatarList, toggleMinimap, toggleChat,
		toggleInventory, toggleMap, toggleNotifications, toggleSettings, toggleDebug,
		inventoryInstances, openInventoryAt, closeInventoryAt, toggleInventoryAt, openNextInventory, autoOpenInventoryOnce,
		togglePreferences, openPreferences, toggleQuickPrefs,
		toggleVoiceControls, toggleMoveControls, toggleCameraControls,
		toggleAppearance, openAppearanceOnTab, toggleAppearanceOnTab, toggleSearch, toggleSnapshot, toggleAO,
		toggleMovementHelp, togglePlaces, openPlacesOnTab, placesActiveTab, openPreferencesOnTab,
		alwaysRun, toggleAlwaysRun, setAlwaysRun,
		flying, setFlying,
		sceneRebuildTick, requestSceneRebuild,
		textureRefreshReq, requestTextureRefresh,
		litShading, instancing, showFps, cacheWorker, dayNightCycle, timeOfDay, fps, setFps, netKbps, setNetKbps,
		drawDistance, setDrawDistance, effectiveDrawDistance, setEffectiveDrawDistance,
		geomCacheRamMb, setGeomCacheRamMb,
		vramBudgetMb, setVramBudgetMb,
		openProfile, closeProfile, toggleProfile,
		showCreateLandmark, createLandmarkPrefill, openCreateLandmark,
		floaterStack, focusFloater,
		uiVisible, toggleUiVisible, closeActiveFloater,
		cameraPos, setCameraPos,
		cameraYaw, setCameraYaw,
		avatarMenu, openAvatarMenu, closeAvatarMenu,
		objectMenu, openObjectMenu, closeObjectMenu,
		landMenu, openLandMenu, closeLandMenu,
		pendingWarpPos, requestWarp, clearWarp,
		showObjectEdit, editObjectId, openObjectEdit, toggleObjectEdit,
		editLinked, setEditLinked,
		gizmoMode, setGizmoMode,
		teleportStatus,
	}
})
