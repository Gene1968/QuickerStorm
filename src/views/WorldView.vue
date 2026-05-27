<script setup>
import { computed, onMounted, watch }	from 'vue'
import { useRouter }		from 'vue-router'
import { use2DFallback }	from '@/composables/use2DFallback'
import { useProximityVoice }from '@/composables/useProximityVoice.js'
import { useUiStore }		from '@/stores/uiStore'
import { useGridStore }		from '@/stores/gridStore'
import { useSessionStore }	from '@/stores/sessionStore'
import { usePresenceStore }	from '@/stores/presenceStore.js'
import WorldCanvas			from '@/components/WorldCanvas.vue'
import SimpleWorldView		from '@/components/SimpleWorldView.vue'
import LocationBar			from '@/components/LocationBar.vue'
import MenuBar				from '@/components/MenuBar.vue'
import AvatarList			from '@/components/AvatarList.vue'
import MinimapOverlay		from '@/components/MinimapOverlay.vue'
import ConversationsFloater	from '@/components/ConversationsFloater.vue'
import AvatarContextMenu	from '@/components/AvatarContextMenu.vue'
import BottomToolbar		from '@/components/BottomToolbar.vue'
import MapFloater			from '@/components/MapFloater.vue'
import InventoryFloater		from '@/components/InventoryFloater.vue'
import AppearanceFloater	from '@/components/AppearanceFloater.vue'
import MoveControlsFloater	from '@/components/MoveControlsFloater.vue'
import CameraControlsFloater	from '@/components/CameraControlsFloater.vue'
import ProfileFloater		from '@/components/ProfileFloater.vue'
import SettingsFloater		from '@/components/SettingsFloater.vue'
import DebugPanel			from '@/components/DebugPanel.vue'
import AudioControlsWidget	from '@/components/AudioControlsWidget.vue'
import MovementHelpFloater	from '@/components/MovementHelpFloater.vue'
import ResyncBanner			from '@/components/ResyncBanner.vue'

// use2DFallback auto-detects on mount; uiStore.mode can also force 2D
const { is2D: autoDetect2D } = use2DFallback()
const ui           = useUiStore()
const grid         = useGridStore()
const session      = useSessionStore()
const presenceStore= usePresenceStore()
const router       = useRouter()
const voice        = useProximityVoice()

// WHY: Mark this tab as "in world" so LandingView gate 1 passes on page reload.
// sessionStorage persists across reloads within the same tab session but clears
// when the tab closes — a fresh open the next day finds no flag.
onMounted(() => {
	try { sessionStorage.setItem('qs_in_world', '1') } catch {}
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
	<div class="w-screen h-screen flex flex-col overflow-hidden bg-bg">

		<!-- 2D fallback -->
		<template v-if="show2D">
			<!-- Top row: menu bar + location bar -->
			<div class="relative flex shrink-0 h-8 bg-black/70 border-b border-brd">
				<MenuBar />
				<LocationBar />
			</div>
			<SimpleWorldView class="flex-1" />
			<BottomToolbar />
		</template>

		<!-- 3D world -->
		<template v-else>
			<!-- Top row: menu bar + location bar -->
			<div class="flex shrink-0 align-items-center justify-content-between h-8 bg-black/70 border-b border-brd">
				<MenuBar />
				<LocationBar />
				<AudioControlsWidget class="hidden md:flex" />
			</div>

			<!-- Middle: canvas area with overlays -->
			<div class="flex-1 relative overflow-hidden">
				<WorldCanvas class="absolute inset-0" />
				<ResyncBanner />
				<MinimapOverlay			v-if="ui.showMinimap" />
				<AvatarList				v-if="ui.showAvatarList" />

				<!-- Floater panels — positioned within the canvas area -->
				<ConversationsFloater	v-if="ui.showChat" />
				<InventoryFloater		v-if="ui.showInventory" />
				<AppearanceFloater		v-if="ui.showAppearance" />
				<MoveControlsFloater	v-if="ui.showMoveControls" />
				<CameraControlsFloater	v-if="ui.showCameraControls" />
				<MapFloater				v-if="ui.showMap" />
				<ProfileFloater			v-if="ui.showProfile" />
				<SettingsFloater		v-if="ui.showSettings" />
				<DebugPanel				v-if="ui.showDebug" />
				<MovementHelpFloater	v-if="ui.showMovementHelp" />
				<AvatarContextMenu />
			</div>

			<!-- Bottom toolbar -->
			<BottomToolbar />
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

				<h2 class="text-white font-bold text-lg leading-snug">Disconnected from Grid</h2>

				<p class="text-white/60 text-sm leading-relaxed">{{ grid.disconnectReason }}</p>

				<button
					class="mt-1 px-6 py-2 rounded-lg bg-accent2 text-white text-sm font-semibold hover:opacity-80 transition-opacity"
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
</style>
