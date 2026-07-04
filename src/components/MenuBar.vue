<script setup>
/**
 * MenuBar — Firestorm-style top menu bar with dropdown menus.
 * Sits to the left of LocationBar in WorldView's top row.
 *
 * Structure + ordering mirror FS menu_viewer.xml (Avatar / quickerSTORM / Comm /
 * World / Build / Help / Advanced — FS's top-level order, minus the Search/RLVa/
 * Develop menus that don't apply to a web viewer) so the menu is "ahead" of the
 * feature work: items with working backing today are wired; the rest ship DISABLED
 * (greyed) as roadmap placeholders — many unlock with the HTTP-caps layer (inventory
 * mgmt, object take/copy/edit, upload, scripts) currently in progress. See
 * docs/FEATURE-GAPS.md → "MenuBar roadmap stubs". Rows render via the recursive
 * <MenuDropdownItem> so FS's 3-level nesting works.
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore }			from '@/stores/uiStore'
import { useSessionStore }	from '@/stores/sessionStore'
import { useGridStore }		from '@/stores/gridStore'
import { useInventoryStore }	from '@/stores/inventoryStore'
import { useWorldStore }		from '@/stores/worldStore'
import { takeGate, takeCopyGate } from '@/utils/takeGating'
import { useRealtimeSocket }	from '@/composables/useRealtimeSocket'
import { useAudio }			from '@/composables/useAudio.js'
import { useTeleport }		from '@/composables/useTeleport.js'
import { useLLUDP }			from '@/composables/useLLUDP'
import { C }					from '@shared/protocol.js'
import MenuDropdownItem		from '@/components/MenuDropdownItem.vue'

const ui			= useUiStore()
const session	= useSessionStore()
const grid		= useGridStore()
const inv		= useInventoryStore()
const world		= useWorldStore()
const router	= useRouter()
const { playSound } = useAudio()
const { emit }	= useRealtimeSocket()
const { requestHomeTeleport, setHomeHere } = useTeleport()
const { takeObject, takeObjectCopy, sendDelete } = useLLUDP()

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

// ── Active menu ───────────────────────────────────────────────────────────
const openMenu = ref(null)	 // id of open top-level menu, or null

function toggle(id) {
	openMenu.value = openMenu.value === id ? null : id
}
function openOnHover(id) {
	if (openMenu.value !== null) openMenu.value = id
}
function close() {
	openMenu.value = null
}

// Close on outside click
function onMouseDown(e) {
	if (!e.target.closest('.menubar')) close()
}
// Close on Escape; global shortcuts
function onKey(e) {
	if (e.key === 'Escape') { close(); return }
	// Ctrl+Alt+R — Force Appearance Update (rebake)
	if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
		e.preventDefault()
		rebake()
		return
	}
	// Two FS-mirrored UI-hide levels (distinct states):
	//  • Alt+Shift+U "Show User Interface" → app chrome off, but KEEPS the edit gizmo +
	//    ObjectEditFloater for focused building.
	//  • Ctrl+Alt+F1 "Rendering Features → UI" → master, hides EVERYTHING incl. gizmo + edit floater.
	if (e.altKey && e.shiftKey && !e.ctrlKey && (e.key === 'u' || e.key === 'U' || e.code === 'KeyU')) {
		e.preventDefault()
		ui.toggleUiVisible()
		return
	}
	if (e.ctrlKey && e.altKey && e.key === 'F1') {
		e.preventDefault()
		ui.toggleRenderUiVisible()
		return
	}
	// Ctrl+W — Close topmost active floater (overrides browser close-tab)
	if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
		e.preventDefault()
		ui.closeActiveFloater()
	}
	// Ctrl+R — Toggle Always Run (SL AGENT_CONTROL_ALWAYS_RUN). Overrides browser refresh.
	if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'r' || e.key === 'R')) {
		e.preventDefault()
		ui.toggleAlwaysRun()
	}
	// Ctrl+O — Toggle Appearance floater on the Outfits tab. Overrides browser "open file".
	if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
		e.preventDefault()
		ui.toggleAppearanceOnTab('outfits')
		return
	}
	// Ctrl+Shift+M — Toggle Mini-Map
	if (e.ctrlKey && !e.altKey && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
		e.preventDefault()
		ui.toggleMinimap()
		return
	}
	// Alt+H — Toggle Places on Teleport History tab; close if already open
	if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'h' || e.key === 'H')) {
		e.preventDefault()
		if (ui.showPlaces) ui.togglePlaces()
		else ui.openPlacesOnTab('history')
		return
	}
	// Ctrl+Shift+H — Teleport Home
	if (e.ctrlKey && !e.altKey && e.shiftKey && (e.key === 'h' || e.key === 'H')) {
		e.preventDefault()
		act(requestHomeTeleport)
		return
	}
	// Ctrl+Shift+I — Open next inventory floater (up to MAX_INVENTORY). Each press opens a new one.
	// WHY: browser DevTools also uses Ctrl+Shift+I but we override here to match FS parity; user
	// can still use F12 for DevTools.
	if (e.ctrlKey && !e.altKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.code === 'KeyI')) {
		e.preventDefault()
		ui.openNextInventory()
	}
}

onMounted(() => {
	window.addEventListener('mousedown', onMouseDown)
	window.addEventListener('keydown',	 onKey)
})
onUnmounted(() => {
	window.removeEventListener('mousedown', onMouseDown)
	window.removeEventListener('keydown',	 onKey)
})

// ── Actions ───────────────────────────────────────────────────────────────
function act(fn) {
	close()
	fn()
}

function logout() {
	close()
	// WHY: Send C.LOGOUT before navigating — tells Bun to send LogoutRequest UDP to sim
	// and deleteSession immediately (cancels the 15s reconnect hold so a fresh login works).
	emit(C.LOGOUT, {})
	session.clearSession()
	grid.setLoginState('idle')
	router.push('/landing')
}

function rebake() {
	close()
	emit(C.REBAKE, {})
}

// "Selected object" = the object open in the Edit floater (our in-world selection concept).
function hasSelectedObject() { return ui.showObjectEdit && ui.editObjectId != null }
// Take / Take-copy perm gating on the selected object — client prediction of OpenSim
// CanTakeObject/CanTakeCopyObject (PermissionsModule.cs:1963/2004) via takeGating.js (FS
// enable_take llviewermenu.cpp:6900 / enable_object_take_copy llviewermenu.cpp:10871).
// Unknown perms (props not yet arrived) → enabled; the sim stays authoritative and
// useTakeWatch toasts silent refusals. Delete keeps its selection-only gate. Reads the
// reactive world.objects map, so MenuDropdownItem's function-`disabled` re-evaluates live.
function canTakeSelected()     { return !takeGate(world.objects, ui.editObjectId, session.agentId).disabled }
function canTakeCopySelected() { return !takeCopyGate(world.objects, ui.editObjectId, session.agentId).disabled }
// Delete it: server maps C.OBJECT_DELETE → DeRezObject(Delete→Trash); the sim's KillObject removes
// the mesh. Close the Edit floater since its target is gone. Mirrors the object context-menu Delete.
function deleteSelectedObject() {
	if (!hasSelectedObject()) return
	// sendDelete (not a raw emit): the wrapper resolves child prim → linkset ROOT — OpenSim
	// silently skips DeRezObject on non-root prims (Scene.Inventory.cs:2258-2260).
	sendDelete(ui.editObjectId)
	ui.showObjectEdit = false
}

// Take the selected object into inventory: DeRezObject Destination=Take(4) → Objects system
// folder (type 6). Mirrors FS Build > Object > Take (menu_viewer.xml:2267-2276 → Tools.BuyOrTake
// → handle_take, llviewermenu.cpp:6710-6803; we always use the FT_OBJECT default folder,
// llviewermenu.cpp:6799-6802). Zero UUID when inventory isn't loaded — OpenSim then routes to
// FromFolderID, else Lost & Found (InventoryAccessModule.cs:830-834); the item still reaches
// inventory. Perm gating (FS enable_take) is the sim's job.
// The sim's KillObject removes the mesh, so close the Edit floater like Delete does; the
// inventory row arrives via BulkUpdateInventory on the existing EQ path.
function takeSelectedObject() {
	if (!hasSelectedObject()) return
	takeObject(ui.editObjectId, inv.findSystemFolder(6) || ZERO_UUID)
	ui.showObjectEdit = false
}

// Take Copy: DeRezObject Destination=TakeCopy(1) — FS Build > Object > Take Copy
// (menu_viewer.xml:2277-2284 → Tools.TakeCopy). The copy lands in the Objects folder (OpenSim
// forces it, InventoryAccessModule.cs:838-839); the original STAYS in world, so keep the Edit
// floater open.
function takeCopySelectedObject() {
	if (!hasSelectedObject()) return
	takeObjectCopy(ui.editObjectId)
}

function resyncWorld() {
	close()
	emit(C.RESYNC_WORLD, {})
}

// Heavier than Resync World: also clears the engine's cull-evicted set and re-queues every known
// object (resync alone is ignored for memory-evicted roots, so it can't refill a culled scene).
function rebuildScene() {
	close()
	ui.requestSceneRebuild()
}

// ── Menu definitions ──────────────────────────────────────────────────────
// item: { label, kbd?, action?, disabled?, sep?, submenu?, title?, checked? }
//   sep: true       → divider
//   submenu: Item[] → nested flyout (hover to open; renders recursively)
//   checked: ()=>bool → ✓ in a reserved column when true (toggle/open state)
//   disabled: true  → greyed roadmap placeholder (no backing yet / needs caps)
//   title           → native tooltip; use when the effect isn't obvious from the label
//
// CONVENTION: an item is enabled ONLY when a real backing exists today (a store
// toggle, composable, or rendered floater). Everything cap-dependent or unbuilt
// stays disabled so we never wire a control to nothing.
//
// ORDER: top-level menus and their items follow FS menu_viewer.xml ordering, so the
// muscle memory of FS users carries over. Our own (non-FS) tools lead each menu's
// enabled cluster where FS has no equivalent (e.g. Advanced ▸ Resync/Rebuild).

const MENUS = [
	{
		id: 'avatar', label: 'Avatar',
		items: [
			{ label: 'Inventory',							action: () => act(() => ui.toggleInventory()) },
			{ label: 'New inventory window',	kbd: 'Ctrl+⇧+I',	action: () => act(() => ui.openNextInventory()) },
			{ label: 'Picks',				disabled: true },
			{ label: 'Experiences',			disabled: true },
			{ sep: true },
			{ label: 'My profile…',							action: () => act(() => ui.openProfile()) },
			{ sep: true },
			{ label: 'Now wearing…',						action: () => act(() => ui.openAppearanceOnTab('wearing')) },
			{ label: 'Outfits',				kbd: 'Ctrl+O',	checked: () => ui.showAppearance && ui.appearanceActiveTab === 'outfits', action: () => act(() => ui.toggleAppearanceOnTab('outfits')) },
			{
				label: 'Take Off',
				submenu: [
					{
						label: 'Clothes',
						submenu: [
							{ label: 'Shirt',		disabled: true },
							{ label: 'Pants',		disabled: true },
							{ label: 'Skirt',		disabled: true },
							{ label: 'Shoes',		disabled: true },
							{ label: 'Socks',		disabled: true },
							{ label: 'Jacket',		disabled: true },
							{ label: 'Gloves',		disabled: true },
							{ label: 'Undershirt',	disabled: true },
							{ label: 'Underpants',	disabled: true },
							{ label: 'Tattoo',		disabled: true },
							{ label: 'Physics',		disabled: true },
							{ label: 'Alpha',		disabled: true },
							{ sep: true },
							{ label: 'All clothes',	disabled: true },
						],
					},
					{ label: 'HUD',							disabled: true },
					{ label: 'Detach all',					disabled: true },
					{ label: 'Remove selected attachments',	disabled: true },
				],
			},
			{ label: 'Hover height',		disabled: true },
			{ sep: true },
			{
				label: 'Movement',
				submenu: [
					{ label: 'Sit down',				disabled: true },
					{ label: 'Stand up',				disabled: true },
					{ sep: true },
					{ label: 'Fly',						disabled: true },
					{ label: 'Stop flying',				disabled: true },
					{ label: 'Always run',	kbd: 'Ctrl+R',	checked: () => ui.alwaysRun, action: () => ui.toggleAlwaysRun() },
					{ label: 'Force ground Sit',		disabled: true },
					{ sep: true },
					{ label: 'Movelock',				disabled: true },
					{ label: 'Quickjump',				disabled: true },
					{ label: 'Face nearest avatar',		disabled: true },
				],
			},
			{ label: 'Move controls',		checked: () => ui.showMoveControls,		action: () => ui.toggleMoveControls() },
			{ label: 'Camera controls',		checked: () => ui.showCameraControls,	action: () => ui.toggleCameraControls() },
			{ sep: true },
			{
				label: 'Avatar health',
				submenu: [
					{ label: 'Force appearance update (Rebake)', kbd: 'Ctrl+Alt+R', action: () => act(rebake) },
					{ label: 'Stop avatar animations',				disabled: true },
					{ label: 'Undeform avatar',						disabled: true },
					{ label: 'Reset skeleton',						disabled: true },
					{ label: 'Reset skeleton and animations',		disabled: true },
					{ label: 'Refresh Attachments',					disabled: true },
					{ sep: true },
					{ label: 'Show Avatar Complexity Information',	disabled: true },
					{ label: 'Scripts',								disabled: true },
					{ label: 'Lag meter',							disabled: true },
					{ label: 'Recreate LSL bridge',					disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Snapshot…',			disabled: true },
			{ label: '360° Snapshot',		disabled: true },
			{ label: 'Money tracker',		disabled: true },
			{ sep: true },
			{ label: 'Preferences…',		kbd: 'Ctrl+P',	action: () => act(() => ui.openPreferences()) },
			{ label: 'Toolbar buttons',		disabled: true },
			{ label: 'Show HUD attachments',disabled: true },
			{ label: 'Show user interface',	kbd: 'Alt+⇧+U',	checked: () => ui.uiVisible, action: () => act(() => ui.toggleUiVisible()), title: 'Hide UI except build tools' },
			{ sep: true },
			{ label: 'Logout avatar 👋🏽',						action: logout },
		],
	},
	{
		// quickerSTORM — our take on FS's power-tools menu: object
		// export/import, upload, selected-object ops, and movement extras. Almost all are
		// cap-/asset-pipeline-dependent so they ship disabled; FS-internal/dangerous items
		// (godmode, explode, mass-delete region objects, message builder) are intentionally
		// dropped rather than mirrored.
		id: 'quickerstorm', label: 'quickerSTORM',
		items: [
			{
				label: 'Save / Export object',
				submenu: [
					{ label: 'Export as Collada (DAE)',	disabled: true },
					{ label: 'Export as GLTF (GLB)…',		disabled: true },
					{ label: 'Backup object as OXP',		disabled: true },
					{ sep: true },
					{ label: 'Export as OBJ',				disabled: true },
					{ label: 'Export as XML',				disabled: true },
					{ label: 'Save texture as…',			disabled: true },
				],
			},
			{
				label: 'Import / Upload',
				submenu: [
					{ label: 'Mesh model…',					disabled: true },
					{ label: 'OXP linkset…',				disabled: true },
					{ label: 'Import XML',					disabled: true },
					{ label: 'Import OBJ',					disabled: true },
					{ sep: true },
					{ label: 'Image…',						disabled: true },
					{ label: 'Sound…',						disabled: true },
					{ label: 'Animation…',					disabled: true },
					{ label: 'Material (glTF)…',			disabled: true },
					{ label: 'Wearable…',					disabled: true },
					{ label: 'Bulk…',						disabled: true },
					{ sep: true },
					{ label: 'Import wearables…',			disabled: true },
				],
			},
			{
				label: 'Import environment',
				submenu: [
					{ label: 'Water settings',				disabled: true },
					{ label: 'Sky settings',				disabled: true },
					{ label: 'Day cycle settings',			disabled: true },
				],
			},
			{ label: 'Set default permissions…',	disabled: true },
			{ sep: true },
			{
				label: 'Selected objects',
				submenu: [
					{ label: 'Buy',							disabled: true },
					// Take / Take copy on the SELECTED object (same selection concept as Delete below);
					// FS Selected Objects menu order Buy/Take/Take Copy/Delete (menu_viewer.xml:836-854).
					// Perm-gated via canTake(Copy)Selected — see the helpers above hasSelectedObject.
					{ label: 'Take',	disabled: () => !hasSelectedObject() || !canTakeSelected(),	action: () => act(takeSelectedObject) },
					{ label: 'Take copy',	disabled: () => !hasSelectedObject() || !canTakeCopySelected(),	action: () => act(takeCopySelectedObject) },
					// Delete the SELECTED object (the one open in the Edit floater = our selection concept).
					// Enabled only while an object is selected; sends DeRezObject→Trash (server maps it).
					{ label: 'Delete',	disabled: () => !hasSelectedObject(),	action: () => act(deleteSelectedObject) },
					{ label: 'Duplicate',					disabled: true },
					{ sep: true },
					{ label: 'Add particles',				disabled: true },
					{ label: 'Edit particles',				disabled: true },
					{ sep: true },
					{ label: 'Save back to object contents',	disabled: true },
					{ label: 'Save back to inventory',		disabled: true },
					{ label: 'Return object',				disabled: true },
				],
			},
			{
				label: 'Movement extras',
				submenu: [
					{ label: 'Movelock (Phantom mode)',		disabled: true },
					{ label: 'Force ground sit',			disabled: true },
					{ label: 'Phantom',						disabled: true },
					{ label: 'Teleport to safety (up)',		disabled: true },
					{ label: 'Teleport to ground level',	disabled: true },
					{ label: 'DoubleClick to Teleport',		disabled: true },
					{ label: 'Fly Override',				disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Sound explorer',			disabled: true },
			{ label: 'Animation explorer',		disabled: true },
			{ label: 'Gestures',				disabled: true },
			{ label: 'Region texture explorer',	disabled: true },
			{ sep: true },
			{ label: 'Close window',		kbd: 'Ctrl+W',	action: () => act(() => ui.closeActiveFloater()) },
			{ label: 'Close all windows',	disabled: true },
		],
	},
	{
		id: 'comm', label: 'Comm',
		items: [
			{
				label: 'Online status',
				submenu: [
					{ label: 'Away',							disabled: true },
					{ label: 'Unavailable',						disabled: true },
					{ label: 'Autorespond',						disabled: true },
					{ label: 'Autorespond to non-friends',		disabled: true },
					{ sep: true },
					{ label: 'Reject teleport offers and requests',	disabled: true },
					{ label: 'Reject all group invites',			disabled: true },
					{ label: 'Reject all friendship requests',		disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Friends',								action: () => act(() => ui.openChatOnTab('contacts')) },
			{ label: 'Groups',				disabled: true },
			{ label: 'Contact sets',		disabled: true },
			{ label: 'Conversations',		checked: () => ui.showChat,	action: () => act(() => ui.toggleChat()) },
			{ label: 'Nearby people',		checked: () => ui.showAvatarList,	action: () => act(() => ui.toggleAvatarList()) },
			{ sep: true },
			{ label: 'Gestures',			disabled: true },
			{ sep: true },
			{ label: 'Flickr…',				disabled: true },
			{ label: 'Discord…',			disabled: true },
			{ sep: true },
			{ label: 'Conversation log…',	disabled: true },
			{ sep: true },
			{ label: 'Nearby voice',		disabled: true },
			{ label: 'Block list',			disabled: true },
			{ label: 'Notifications',		checked: () => ui.showNotifications,	action: () => act(() => ui.toggleNotifications()) },
			{ label: 'Show on-screen chat console',	disabled: true },
		],
	},
	{
		id: 'world', label: 'World',
		items: [
			{ label: 'Nearby avatars',							checked: () => ui.showAvatarList,	action: () => act(() => ui.toggleAvatarList()) },
			{ label: 'Teleport History',	kbd: 'Alt+H',	action: () => act(() => { if (ui.showPlaces) ui.togglePlaces(); else ui.openPlacesOnTab('history') }) },
			{ label: 'Places…',				checked: () => ui.showPlaces,	action: () => act(() => ui.togglePlaces()) },
			{ label: 'Destinations',		disabled: true },
			{ label: 'Events',				disabled: true },
			{ label: 'Mini-Map',			kbd: 'Ctrl+⇧+M',	checked: () => ui.showMinimap,	action: () => act(() => ui.toggleMinimap()) },
			{ label: 'World Map',			kbd: 'Ctrl+M',		checked: () => ui.showMap,		action: () => act(() => ui.toggleMap()) },
			{ label: 'Region tracker',		disabled: true },
			{ sep: true },
			{ label: 'Landmark this place',				action: () => act(() => ui.openCreateLandmark({ name: session.regionName })) },
			{ label: 'Location profile',	disabled: true },
			{ label: 'Parcel details',		disabled: true },
			{ label: 'Region details',		disabled: true },
			{ label: 'Set Home to here',					action: () => act(setHomeHere) },
			{ sep: true },
			{ label: 'Buy this land',		disabled: true },
			{ label: 'Show owned land',		disabled: true },
			{ sep: true },
			{
				label: 'Show more',
				submenu: [
					{ label: 'Hide ban lines',			disabled: true },
					{ label: 'Beacons',					disabled: true },
					{ label: 'Property lines',			disabled: true },
					{ label: 'Land owners',				disabled: true },
					{ label: 'Coordinates',				disabled: true },
					{ label: 'Parcel permissions',		disabled: true },
					{ sep: true },
					{ label: 'Show navigation bar',		disabled: true },
					{ label: 'Show Favorites bar',		disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Teleport Home',		kbd: 'Ctrl+⇧+H',	action: () => act(requestHomeTeleport) },
			{ sep: true },
			{
				label: 'Environment',
				submenu: [
					{ label: 'Sunrise',					disabled: true },
					{ label: 'Midday',					disabled: true },
					{ label: 'Sunset',					disabled: true },
					{ label: 'Midnight',				disabled: true },
					{ label: 'Use shared environment',	disabled: true },
					{ sep: true },
					{ label: 'My environments…',		disabled: true },
					{ label: 'Personal lighting…',		disabled: true },
					{ label: 'Environment editor',		disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Area search',			disabled: true },
			{ label: 'Sound explorer',		disabled: true },
			{ label: 'Animation explorer',	disabled: true },
			{ sep: true },
			{ label: 'Avatar render settings',	disabled: true },
		],
	},
	{
		id: 'build', label: 'Build',
		items: [
			{ label: 'Build',				checked: () => ui.showObjectEdit,	action: () => act(() => ui.toggleObjectEdit()),
				title: 'Open the Build Tools / object inspector for the selected object' },
			{
				label: 'Select build tool',
				submenu: [
					{ label: 'Focus tool',		disabled: true },
					{ label: 'Move tool',		disabled: true },
					{ label: 'Edit tool',		disabled: true },
					{ label: 'Create tool',		disabled: true },
					{ label: 'Land tool',		disabled: true },
				],
			},
			{ label: 'Link',				disabled: true },
			{ label: 'Unlink',				disabled: true },
			{ label: 'Edit linked',			checked: () => ui.editLinked,		action: () => ui.setEditLinked(!ui.editLinked),
				title: 'When on, clicking a prim selects that individual part instead of the whole linkset' },
			{
				label: 'Select Linked Parts',
				submenu: [
					{ label: 'Select next part or face',		disabled: true },
					{ label: 'Select previous part or face',	disabled: true },
					{ label: 'Include next part or face',		disabled: true },
					{ label: 'Include previous part or face',	disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Focus on selection',	disabled: true },
			{ label: 'Zoom to selection',	disabled: true },
			{ sep: true },
			{
				label: 'Object',
				submenu: [
					{ label: 'Buy',							disabled: true },
					// FS Build > Object > Take / Take Copy (menu_viewer.xml:2267-2284); acts on the
					// selected object (Edit floater target), perm-gated like Selected objects > Take.
					{ label: 'Take',	disabled: () => !hasSelectedObject() || !canTakeSelected(),	action: () => act(takeSelectedObject) },
					{ label: 'Take copy',	disabled: () => !hasSelectedObject() || !canTakeCopySelected(),	action: () => act(takeCopySelectedObject) },
					{ label: 'Duplicate',					disabled: true },
					{ sep: true },
					{ label: 'Edit particles',				disabled: true },
					{ label: 'Return object',				disabled: true },
					{ sep: true },
					{
						label: 'Save as',
						submenu: [
							{ label: 'Backup OXP',		disabled: true },
							{ label: 'Collada DAE',		disabled: true },
						],
					},
				],
			},
			{
				label: 'Scripts',
				submenu: [
					{ label: 'Recompile scripts (Mono)',		disabled: true },
					{ label: 'Recompile scripts (LSL)',			disabled: true },
					{ label: 'Reset scripts',					disabled: true },
					{ label: 'Set scripts to running',			disabled: true },
					{ label: 'Set scripts to not running',		disabled: true },
					{ label: 'Remove scripts from selection',	disabled: true },
				],
			},
			{ sep: true },
			{
				label: 'Upload',
				submenu: [
					{ label: 'Image…',			disabled: true },
					{ label: 'Sound…',			disabled: true },
					{ label: 'Animation…',		disabled: true },
					{ label: 'Mesh Model…',		disabled: true },
					{ label: 'Bulk…',			disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Undo',				kbd: 'Ctrl+Z',	disabled: true },
			{ label: 'Redo',				kbd: 'Ctrl+Y',	disabled: true },
		],
	},
	{
		id: 'help', label: 'Help',
		items: [
			{ label: 'Movement & shortcuts', action: () => act(() => { ui.showMovementHelp = true }) },
			{ sep: true },
			{ label: 'quickerSTORM wiki',	disabled: true },
			{ label: 'Guidebook',			disabled: true },
			{ label: 'Knowledge base',		disabled: true },
			{ label: 'Community forums',	disabled: true },
			{ sep: true },
			{ label: 'Report issue',		disabled: true },
			{ label: 'Report abuse',		disabled: true },
			{ sep: true },
			{ label: 'Grid help',			disabled: true },
			{ label: 'About current grid',	disabled: true },
			{ sep: true },
			{ label: 'About quickerSTORM',	disabled: true },
		],
	},
	{
		id: 'advanced', label: 'Advanced / Dev',
		items: [
			{ label: 'Resync world',										action: resyncWorld,
				title: 'Quick: replay the relay server\'s cached world (terrain, objects, position) — fixes missed packets after a reconnect' },
			{ label: 'Rebuild scene',										action: rebuildScene,
				title: 'Thorough: restore memory-evicted objects, rebuild every known mesh, then resync — use when objects are missing (slower)' },
			{ label: 'Rebake textures',	kbd: 'Ctrl+Alt+R',	action: () => act(rebake),
				title: 'Force the sim to rebuild and re-send your avatar bake textures' },
			{ sep: true },
			{ label: 'Performance…',						action: () => act(() => ui.openPreferencesOnTab('graphics')) },
			{ label: 'Quick Preferences',	checked: () => ui.showQuickPrefs,	action: () => ui.toggleQuickPrefs() },
			{
				label: 'Rendering Types',
				submenu: [
					{ label: 'Simple',		disabled: true },
					{ label: 'Alpha',		disabled: true },
					{ label: 'Tree',		disabled: true },
					{ label: 'Avatars',		disabled: true },
					{ label: 'Surface patch',	disabled: true },
					{ label: 'Sky',			disabled: true },
					{ label: 'Water',		disabled: true },
					{ label: 'Volume',		disabled: true },
					{ label: 'Grass',		disabled: true },
					{ label: 'Clouds',		disabled: true },
					{ label: 'Particles',	disabled: true },
					{ label: 'Bump',		disabled: true },
					{ label: 'PBR',			disabled: true },
				],
			},
			{
				label: 'Rendering features',
				submenu: [
					{ label: 'UI',	kbd: 'Ctrl+Alt+F1',	checked: () => ui.renderUiVisible, action: () => act(() => ui.toggleRenderUiVisible()) },
					{ label: 'Selected',		disabled: true },
					{ label: 'Highlighted',		disabled: true },
					{ label: 'Foot shadows',	disabled: true },
					{ label: 'Fog',				disabled: true },
					{ label: 'Flexible objects',	disabled: true },
				],
			},
			{ label: 'Set UI size to default',	disabled: true },
			{ sep: true },
			{ label: 'Debug panel',						kbd: 'Ctrl+⇧+4',	checked: () => ui.showDebug, action: () => act(() => ui.toggleDebug()) },
			{ label: 'Debug settings',		disabled: true },
			{ label: 'Statistics bar',		disabled: true },
			{ label: 'Scene load statistics',	disabled: true },
			{ label: 'Texture console',		disabled: true },
			{ label: 'Capabilities info to debug console',	disabled: true },
		],
	},
]
</script>

<template>
	<div class="menubar flex items-stretch shrink-0 h-full">
		<img src="/favicon.svg" alt="quickerSTORM" class="h-full aspect-square me-2 text-black/70" />
		<!--
			Each menu is wrapped in a relative container so its dropdown
			anchors directly below its own label, not the root's left edge.
		-->
		<div
			v-for="menu in MENUS"
			:key="menu.id"
			class="mb-menu-wrap"
		>
			<!-- Top-level label -->
			<button
				class="mb-label"
				:class="{ 'mb-label--open': openMenu === menu.id }"
				@click="playSound('tick.mp3', 0.6); toggle(menu.id)"
				@mouseenter="openOnHover(menu.id)"
			>{{ menu.label }}</button>

			<!-- Dropdown — anchors below this wrapper; items render recursively -->
			<Transition name="mb-drop">
				<div v-if="openMenu === menu.id" class="mb-dropdown">
					<MenuDropdownItem
						v-for="(item, i) in menu.items"
						:key="i"
						:item="item"
					/>
				</div>
			</Transition>
		</div>
		<input class="flex-1 bg-fg/10 rounded-xl my-1 ms-2 px-2 py-1 text-xs text-fg placeholder-fg/70 focus:outline-hidden focus:ring-1 focus:ring-inset focus:ring-accent" placeholder="Filter menus&#8230; (to-do)" type="search" />
	</div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────────────── */
.menubar { }

/* Each menu item + its dropdown anchored together */
.mb-menu-wrap {
	position: relative;
	display: flex;
	align-items: stretch;
}

/* ── Top-level labels ────────────────────────────────────────────────────── */
.mb-label {
	display: flex;
	align-items: center;
	padding: 0 0.75rem;
	height: 100%;
	font-size: 0.6875rem;
	font-weight: 500;
	color: rgba(255, 255, 255, 0.75);
	background: none;
	border: none;
	cursor: pointer;
	white-space: nowrap;
	transition: background 0.1s, color 0.1s;
	letter-spacing: 0.01em;
}

.mb-label:hover,
.mb-label--open {
	background: rgba(255, 255, 255, 0.12);
	color: #fff;
}

/* ── Dropdown ────────────────────────────────────────────────────────────── */
.mb-dropdown {
	position: absolute;
	top: 100%;
	left: 0;/* anchors to .mb-menu-wrap left edge = label left edge */
	min-width: 11rem;
	background: rgba(14, 18, 28, 0.97);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-top: none;
	border-radius: 0 0 0.375rem 0.375rem;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
	padding: 0;
	z-index: 800;
	display: flex;
	flex-direction: column;
}

/* ── Transition ──────────────────────────────────────────────────────────── */
.mb-drop-enter-active	{ transition: opacity 0.1s, transform 0.1s; }
.mb-drop-leave-active	{ transition: opacity 0.08s; }
.mb-drop-enter-from		{ opacity: 0; transform: translateY(-4px); }
.mb-drop-leave-to		{ opacity: 0; }
</style>
