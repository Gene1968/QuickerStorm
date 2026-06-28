<script setup>
import { computed, onMounted, watch }	from 'vue'
import { useRouter }		from 'vue-router'
import { use2DFallback }	from '@/composables/use2DFallback'
import { useProximityVoice }from '@/composables/useProximityVoice.js'
import { useInventory }		from '@/composables/useInventory'
import { useCaps }			from '@/composables/useCaps'
import { useSocial }			from '@/composables/useSocial'
import { useUiStore }		from '@/stores/uiStore'
import { useGridStore }		from '@/stores/gridStore'
import { useSessionStore }	from '@/stores/sessionStore'
import { usePresenceStore }	from '@/stores/presenceStore.js'
import WorldCanvas			from '@/components/WorldCanvas.vue'
import SceneLoadBadge		from '@/components/SceneLoadBadge.vue'
import SimpleWorldView		from '@/components/SimpleWorldView.vue'
import LocationBar			from '@/components/LocationBar.vue'
import MenuBar				from '@/components/MenuBar.vue'
import FavoritesBar			from '@/components/FavoritesBar.vue'
import AvatarList			from '@/components/AvatarList.vue'
import MinimapOverlay		from '@/components/MinimapOverlay.vue'
import ConversationsFloater	from '@/components/ConversationsFloater.vue'
import AvatarContextMenu	from '@/components/AvatarContextMenu.vue'
import ObjectContextMenu	from '@/components/ObjectContextMenu.vue'
import LandContextMenu		from '@/components/LandContextMenu.vue'
import PlacesFloater		from '@/components/PlacesFloater.vue'
import ObjectEditFloater	from '@/components/ObjectEditFloater.vue'
import BottomToolbar		from '@/components/BottomToolbar.vue'
import MapFloater			from '@/components/MapFloater.vue'
import InventoryFloater		from '@/components/InventoryFloater.vue'
import InventoryContextMenu	from '@/components/InventoryContextMenu.vue'
import InventoryItemProperties	from '@/components/InventoryItemProperties.vue'
import AppearanceFloater	from '@/components/AppearanceFloater.vue'
import MoveControlsFloater	from '@/components/MoveControlsFloater.vue'
import CameraControlsFloater	from '@/components/CameraControlsFloater.vue'
import ProfileFloater		from '@/components/ProfileFloater.vue'
import SettingsFloater		from '@/components/SettingsFloater.vue'
import DebugPanel			from '@/components/DebugPanel.vue'
import AudioControlsWidget	from '@/components/AudioControlsWidget.vue'
import MovementHelpFloater	from '@/components/MovementHelpFloater.vue'
import CreateLandmarkFloater	from '@/components/CreateLandmarkFloater.vue'
import NotificationsFloater	from '@/components/NotificationsFloater.vue'
import ResyncBanner			from '@/components/ResyncBanner.vue'
import ToastStack				from '@/components/ToastStack.vue'
import TopRightTray			from '@/components/TopRightTray.vue'

import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
// use2DFallback auto-detects on mount; uiStore.mode can also force 2D
const { is2D: autoDetect2D } = use2DFallback()
const { connected: wsConnected } = useRealtimeSocket()
const ui           = useUiStore()
const grid         = useGridStore()
const session      = useSessionStore()
const presenceStore= usePresenceStore()
const router       = useRouter()
const voice        = useProximityVoice()
// WHY: register inventory cap handlers (S.INV_FOLDER / S.CAPS_READY) for the whole session so
// folder items load when caps arrive even before the Inventory floater is opened.
useInventory()
// WHY: register the generic cap front door (S.CAP_RESULT handler) session-long so any
// cap('Name').post/get() call resolves. DEV: expose window.__cap for console live-verify.
const { cap: capCall } = useCaps()
if (import.meta.env.DEV) window.__cap = capCall
// WHY: register grid-social handlers (friend status, groups, profile, parcel, names) for the
// whole session so live updates (OnlineNotification, AgentGroupDataUpdate) land regardless of
// which floater is open.
useSocial()

// WHY: Mark this tab as "in world" so LandingView gate 1 passes on page reload.
// sessionStorage persists across reloads within the same tab session but clears
// when the tab closes — a fresh open the next day finds no flag.
onMounted(() => {
	try { sessionStorage.setItem('qs_in_world', '1') } catch {}
	// WHY: greet the user with one Inventory floater open on first world load, mirroring how
	// Conversations/Nearby start open. One-shot guard inside uiStore respects a manual close on
	// SPA re-login (re-mount); a real page reload resets it.
	ui.autoOpenInventoryOnce()
})

function returnToLogin() {
	// WHY: Clear the in-world flag so LandingView gate 1 fails and auto-reconnect
	// is suppressed. Explicit return-to-login means the user (or an external viewer
	// like Firestorm) ended the session on purpose.
	try { sessionStorage.removeItem('qs_in_world') } catch {}
	session.clearSession()
	grid.setLoginState('idle')
	router.push('/landing')
}

// Show 2D if auto-detected low-end OR user manually toggled to '2d' in toolbar
const show2D = computed(() => autoDetect2D.value || ui.mode === '2d')

// WHY: Auto-join voice when session connects. isMuted starts true (silent) until user unmutes.
// Runs immediately in case the session is already connected on mount (e.g. HMR).
watch(
	() => session.connected,
	async (connected) => {
		if (!connected || voice.isEnabled.value) return
		const myId     = String(presenceStore.myUserId || 'me')
		const regionId = session.regionName || 'world'
		try { await voice.enable(myId, regionId) } catch { /* mic denied — voice.micError has details */ }
	},
	{ immediate: true },
)
</script>

<template>
	<div class="w-screen h-screen flex flex-col overflow-hidden">

		<!-- 2D fallback -->
		<template v-if="show2D">
			<!-- Top row: menu bar + location bar -->
			<div v-show="ui.uiVisible" class="relative flex shrink-0 h-8 bg-black/70 border-b border-edge">
				<MenuBar />
				<LocationBar />
			</div>
			<FavoritesBar v-show="ui.uiVisible" />
			<SimpleWorldView class="flex-1" />
			<BottomToolbar v-show="ui.uiVisible" />
		</template>

		<!-- 3D world -->
		<template v-else>
			<!-- Top row: menu bar + location bar -->
			<div v-show="ui.uiVisible" class="toprow relative flex shrink-0 items-center justify-between h-8 bg-black/70 border-b border-edge">
				<MenuBar />
				<LocationBar />
				<AudioControlsWidget class="hidden md:flex" />
			</div>
			<FavoritesBar v-show="ui.uiVisible" />

			<!-- Middle: canvas area with overlays -->
			<div class="flex-1 relative overflow-hidden">
				<WorldCanvas class="absolute inset-0" />
				<SceneLoadBadge />

				<!-- Teleport progress overlay — FS-style, shows while TP is in flight -->
				<Transition name="fade">
					<div
						v-if="ui.teleportStatus"
						class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/75 backdrop-blur-xs"
					>
						<div class="flex flex-col items-center gap-3 px-6 py-5 bg-panel/80 border border-edge rounded-xl shadow-xl text-center max-w-xs">
							<div class="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
							<p class="text-fg text-sm font-semibold">
								{{ { requesting: 'Requesting Teleport…', contacting: 'Contacting new region…', arriving: 'Arriving…' }[ui.teleportStatus] ?? 'Teleporting…' }}
							</p>
						</div>
					</div>
				</Transition>

				<!-- Overlay/floater layer — hidden as a unit by Ctrl+Alt+F1.
				     Absolute children are hidden by display:none on this wrapper.
				     FloaterWindow children are position:fixed and escape display:none;
				     they handle visibility via FloaterWindow.vue's invisible class. -->
				<div v-show="ui.uiVisible">
					<ResyncBanner />
					<MinimapOverlay			v-if="ui.showMinimap" />
					<AvatarList				v-if="ui.showAvatarList" />
					<ConversationsFloater	v-if="ui.showChat" />
					<InventoryFloater
						v-for="i in ui.inventoryInstances"
						:key="i"
						:index="i"
					/>
					<AppearanceFloater		v-if="ui.showAppearance" />
					<MoveControlsFloater	v-if="ui.showMoveControls" />
					<CameraControlsFloater	v-if="ui.showCameraControls" />
					<MapFloater				v-if="ui.showMap" />
					<PlacesFloater			v-if="ui.showPlaces" />
					<ObjectEditFloater		v-if="ui.showObjectEdit" />
					<ProfileFloater
						v-for="(tid, i) in ui.profileInstances"
						:key="tid ?? 'self'"
						:target-id="tid"
						:index="i"
					/>
					<SettingsFloater		v-if="ui.showSettings" />
					<DebugPanel				v-if="ui.showDebug" />
					<MovementHelpFloater	v-if="ui.showMovementHelp" />
					<NotificationsFloater	v-if="ui.showNotifications" />
				<CreateLandmarkFloater	v-if="ui.showCreateLandmark" />
					<AvatarContextMenu />
					<ObjectContextMenu />
					<LandContextMenu />
					<InventoryContextMenu />
					<InventoryItemProperties />
					<ToastStack />
					<TopRightTray />
				</div>
			</div>

			<!-- Bottom toolbar -->
			<BottomToolbar v-show="ui.uiVisible" />
		</template>

	</div>

	<!-- ── Disconnection overlay ─────────────────────────────────────────────── -->
	<!-- WHY: Shown when sim drops circuit (DisableSimulator or 65s idle timeout).
	     Blurs/dims world canvas in-place so user sees context before returning to login. -->
	<Transition name="dc-fade">
		<div
			v-if="grid.loginState === 'disconnected'"
			class="fixed inset-0 z-[900] flex items-center justify-center"
			style="backdrop-filter: blur(8px) brightness(0.45);"
		>
			<div
				class="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl text-center"
				style="background: rgba(10,14,24,0.88); border: 1px solid rgba(255,255,255,0.10); min-width: 18rem; max-width: 26rem;"
			>
				<!-- Icon -->
				<div class="text-4xl leading-none">⚠️</div>

				<h2 class="text-fg font-bold text-lg leading-snug">Disconnected from Grid</h2>

				<p class="text-fg/60 text-sm leading-relaxed">{{ grid.disconnectReason }}</p>

				<!-- WHY: Only promise auto-resume when the WS itself is down (will reconnect + probe).
				     When WS is still up but the circuit died (S.DISCONNECTED path), the session is
				     gone server-side and cannot resume — showing this text would be a false promise. -->
				<p v-if="!wsConnected" class="text-fg/35 text-xs leading-relaxed">Will resume automatically if the connection restores.</p>

				<button
					class="mt-1 px-6 py-2 rounded-lg bg-accent-dark text-white text-sm font-semibold hover:opacity-80 transition-opacity"
					@click="returnToLogin"
				>Return to Login</button>
			</div>
		</div>
	</Transition>
</template>

<style scoped>
.dc-fade-enter-active { transition: opacity 0.3s; }
.dc-fade-leave-active { transition: opacity 0.2s; }
.dc-fade-enter-from,
.dc-fade-leave-to     { opacity: 0; }
.fade-enter-active { transition: opacity 0.2s; }
.fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }
</style>
