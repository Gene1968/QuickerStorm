<script setup>
/**
 * MenuBar — Firestorm-style top menu bar with dropdown menus.
 * Sits to the left of LocationBar in WorldView's top row.
 *
 * Menus adapted from FS menu_viewer.xml — only items relevant to
 * a Phase 1 web viewer are enabled; everything else is disabled (greyed).
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore }			from '@/stores/uiStore'
import { useSessionStore }	from '@/stores/sessionStore'
import { useGridStore }		from '@/stores/gridStore'
import { useRealtimeSocket }	from '@/composables/useRealtimeSocket'
import { useAudio }			from '@/composables/useAudio.js'
import { useTeleport }		from '@/composables/useTeleport.js'
import { C }					from '@shared/protocol.js'

const ui			= useUiStore()
const session	= useSessionStore()
const grid		= useGridStore()
const router	= useRouter()
const { playSound } = useAudio()
const { emit }	= useRealtimeSocket()
const { requestHomeTeleport, setHomeHere } = useTeleport()

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
	// Ctrl+Alt+F1 — Toggle UI visibility (render all floaters/bars off for clean screenshot)
	if (e.ctrlKey && e.altKey && e.key === 'F1') {
		e.preventDefault()
		ui.toggleUiVisible()
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
// item: { label, kbd?, action?, disabled?, sep?, submenu?, title? }
// sep: true → divider. submenu: Item[] → nested dropdown (hover to open, CSS-only).
// title: native tooltip on hover — use for items whose effect isn't obvious from the label.

const MENUS = [
	{
		id: 'avatar', label: 'Avatar',
		items: [
			{ label: 'Preferences…',		kbd: 'Ctrl+P',	action: () => act(() => ui.openPreferences()) },
			{ sep: true },
			{ label: 'Inventory',							action: () => act(() => ui.toggleInventory()) },
			{ label: 'My profile…',							action: () => act(() => ui.openProfile()) },
			{ sep: true },
			{ label: 'Now wearing…',						action: () => act(() => ui.openAppearanceOnTab('wearing')) },
			{ label: 'Outfits',				kbd: 'Ctrl+O',	checked: () => ui.showAppearance && ui.appearanceActiveTab === 'outfits', action: () => act(() => ui.toggleAppearanceOnTab('outfits')) },
			{ label: 'Move Controls',						action: () => ui.toggleMoveControls(), active: () => ui.showMoveControls },
			{ sep: true },
			{
				label: 'Avatar Health',
				submenu: [
					{ label: 'Force Appearance Update (Rebake)', kbd: 'Ctrl+Alt+R', action: () => act(rebake) },
					{ label: 'Undeform Avatar',						disabled: true },
					{ label: 'Reset skeleton',						disabled: true },
					{ label: 'Show Avatar Complexity Information',	disabled: true },
					{ label: 'Scripts',								disabled: true },
					{ label: 'Lag meter',							disabled: true },
					{ label: 'Recreate LSL bridge',					disabled: true },
				],
			},
			{ sep: true },
			{ label: 'Snapshot…',			disabled: true },
			{ sep: true },
			{ label: 'Logout avatar',						action: logout },
		],
	},
	{
		id: 'comm', label: 'Comm',
		items: [
			{ label: 'Conversations',						action: () => act(() => ui.toggleChat()) },
			{ sep: true },
			{ label: 'Friends',				disabled: true },
			{ label: 'Groups',				disabled: true },
			{ label: 'Contact Sets',		disabled: true },
			{ sep: true },
			{ label: 'Nearby Voice',		disabled: true },
			{ label: 'Block List',			disabled: true },
		],
	},
	{
		id: 'world', label: 'World',
		items: [
			{ label: 'Mini-Map',			kbd: 'Ctrl+⇧+M',			action: () => act(() => ui.toggleMinimap()) },
			{ label: 'World Map',			kbd: 'Ctrl+M',				action: () => act(() => ui.toggleMap()) },
			{ label: 'Nearby Avatars',									action: () => act(() => ui.toggleAvatarList()) },
			{ label: 'Places…',											action: () => act(() => ui.togglePlaces()) },
			{ sep: true },
			{ label: 'Teleport Home',		kbd: 'Ctrl+⇧+H',	action: () => act(requestHomeTeleport) },
			{ label: 'Teleport History',	kbd: 'Alt+H',	action: () => act(() => { if (ui.showPlaces) ui.togglePlaces(); else ui.openPlacesOnTab('history') }) },
			{ label: 'Landmark This Place',				action: () => act(() => ui.openCreateLandmark({ name: session.regionName })) },
			{ label: 'Set Home to Here',					action: () => act(setHomeHere) },
			{ sep: true },
			{ label: 'Region Details',		disabled: true },
			{ label: 'Parcel Details',		disabled: true },
			{ label: 'Location Profile',	disabled: true },
			{ sep: true },
			{ label: 'Area Search',			disabled: true },
			{ label: 'Environment…',		disabled: true },
		],
	},
	{
		id: 'build', label: 'Build',
		items: [
			{ label: 'Build',				disabled: true },
			{ sep: true },
			{ label: 'Link',				disabled: true },
			{ label: 'Unlink',				disabled: true },
			{ label: 'Edit Linked',			disabled: true },
			{ sep: true },
			{ label: 'Upload…',				disabled: true },
			{ label: 'Undo',				kbd: 'Ctrl+Z',	disabled: true },
			{ label: 'Redo',				kbd: 'Ctrl+Y',	disabled: true },
		],
	},
	{
		id: 'advanced', label: 'Advanced',
		items: [
			{ label: 'Resync World',										action: resyncWorld,
				title: 'Quick: replay the relay server\'s cached world (terrain, objects, position) — fixes missed packets after a reconnect' },
			{ label: 'Rebuild Scene',										action: rebuildScene,
				title: 'Thorough: restore memory-evicted objects, rebuild every known mesh, then resync — use when objects are missing (slower)' },
			{ label: 'Rebake Textures',	disabled: true },
			{ sep: true },
			{ label: '✅ Render UI menus',				kbd: 'Ctrl+Alt+F1',	action: () => act(() => ui.toggleUiVisible()) },
			{ sep: true },
			{ label: 'Debug Panel',						kbd: 'Ctrl+⇧+4',	action: () => act(() => ui.toggleDebug()) },
			{ label: 'Debug Settings',	disabled: true },
			{ sep: true },
			{ label: 'Performance…',	disabled: true },
			{ label: 'Rendering Types', disabled: true },
		],
	},
	{
		id: 'help', label: 'Help',
		items: [
			{ label: 'Movement & Shortcuts', action: () => act(() => { ui.showMovementHelp = true }) },
			{ sep: true },
			{ label: 'quickerSTORM Wiki',	disabled: true },
			{ label: 'Report Issue',		disabled: true },
			{ sep: true },
			{ label: 'Grid Help',			disabled: true },
			{ label: 'About Current Grid',	disabled: true },
			{ sep: true },
			{ label: 'About quickerSTORM',	disabled: true },
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

			<!-- Dropdown — anchors below this wrapper -->
			<Transition name="mb-drop">
				<div v-if="openMenu === menu.id" class="mb-dropdown">
					<template v-for="(item, i) in menu.items" :key="i">
						<div v-if="item.sep" class="mb-sep" />

						<!-- Submenu item (hover to reveal nested dropdown) -->
						<div v-else-if="item.submenu" class="mb-sub-wrap">
							<button class="mb-item mb-item--has-sub" @click="playSound('tick.mp3', 0.6)">
								<span class="mb-item-label">{{ item.label }}</span>
								<span class="mb-item-arrow">›</span>
							</button>
							<div class="mb-submenu">
								<template v-for="(sub, j) in item.submenu" :key="j">
									<div v-if="sub.sep" class="mb-sep" />
									<button
										v-else
										class="mb-item"
										:class="{ 'mb-item--disabled': sub.disabled }"
										:disabled="sub.disabled"
										:title="sub.title"
										@click="playSound('tick.mp3', 0.6); sub.action && sub.action()"
									>
										<span class="mb-item-label">{{ sub.label }}</span>
										<span v-if="sub.kbd" class="mb-item-kbd">{{ sub.kbd }}</span>
									</button>
								</template>
							</div>
						</div>

						<!-- Regular item -->
						<button
							v-else
							class="mb-item"
							:class="{ 'mb-item--disabled': item.disabled }"
							:disabled="item.disabled"
							:title="item.title"
							@click="playSound('tick.mp3', 0.6); item.action && item.action()"
						>
							<span class="mb-item-label"><span v-if="item.checked" class="mb-item-check">{{ item.checked() ? '✓' : '' }}</span>{{ item.label }}</span>
							<span v-if="item.kbd" class="mb-item-kbd">{{ item.kbd }}</span>
						</button>
					</template>
				</div>
			</Transition>
		</div>
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
	padding: 0 1rem;
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
	padding: 0.25rem 0;
	z-index: 800;
	display: flex;
	flex-direction: column;
}

/* ── Item ────────────────────────────────────────────────────────────────── */
.mb-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1.5rem;
	padding: 0.3125rem 0.875rem;
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.85);
	background: none;
	border: none;
	cursor: pointer;
	text-align: left;
	transition: background 0.08s;
	width: 100%;
}

.mb-item:hover:not(.mb-item--disabled) {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.mb-item--disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.mb-item-label { flex: 1; white-space: nowrap; }

/* Reserve a fixed check column so toggling on/off doesn't shift the label. */
.mb-item-check {
	display: inline-block;
	width: 1.1em;
	margin-left: -0.25rem;
	color: var(--accent, #6cf);
	font-weight: 700;
}

.mb-item-kbd {
	font-size: 0.625rem;
	color: rgba(255, 255, 255, 0.4);
	font-family: monospace;
	white-space: nowrap;
	flex-shrink: 0;
}

/* ── Nested submenu ──────────────────────────────────────────────────────── */
/* WHY: Pure CSS hover — no extra Vue state. mb-sub-wrap is position:relative so
   mb-submenu anchors to its right edge. Sibling hover keeps submenu open while
   moving mouse rightward into it. */
.mb-sub-wrap {
	position: relative;
}

.mb-item--has-sub {
	cursor: default;
}

.mb-item-arrow {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.4);
	flex-shrink: 0;
	line-height: 1;
}

.mb-submenu {
	display: none;
	position: absolute;
	top: 0;
	left: 100%;
	min-width: 13rem;
	background: rgba(14, 18, 28, 0.97);
	border: 1px solid rgba(255, 255, 255, 0.12);
	border-radius: 0 0.375rem 0.375rem 0.375rem;
	box-shadow: 4px 8px 24px rgba(0, 0, 0, 0.6);
	padding: 0.25rem 0;
	z-index: 801;
	flex-direction: column;
}

.mb-sub-wrap:hover .mb-submenu {
	display: flex;
}

/* ── Separator ───────────────────────────────────────────────────────────── */
.mb-sep {
	height: 1px;
	background: rgba(255, 255, 255, 0.1);
	margin: 0.2rem 0;
}

/* ── Transition ──────────────────────────────────────────────────────────── */
.mb-drop-enter-active { transition: opacity 0.1s, transform 0.1s; }
.mb-drop-leave-active { transition: opacity 0.08s; }
.mb-drop-enter-from	{ opacity: 0; transform: translateY(-4px); }
.mb-drop-leave-to		{ opacity: 0; }
</style>
