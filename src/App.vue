<script setup>
/**
 * App.vue — root shell for QuickerStorm.
 *
 * Bootstraps Supabase auth, then resolves the current user and loads their
 * saved avatar config before rendering OfficeView via <RouterView>.
 *
 * Handles three cases:
 *   1. Regular page load with an existing Supabase session → bootstrap right away.
 *   2. OAuth popup returning with ?code=… → forward code to the opener and close.
 *   3. No session → show a Google sign-in button; a late-arriving SIGNED_IN
 *      event (e.g. from popup-forwarded code) bootstraps the app reactively.
 */
import { onMounted, provide, ref, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useUserStore } from '@/stores/userStore'
import { useAvatarStore } from '@/stores/avatarStore.js'
// import { loadGoogleTokenFromSession } from '@/api/GoogleApi.js'
import { AuthRepo } from '@/api/backend.js'
// import { session as supabaseSession } from '@/api/supabase/AuthRepo.js'
import ConsolePanel from '@/components/ConsolePanel.vue'

const userStore   = useUserStore()
const avatarStore = useAvatarStore()

const loading = ref(true)
const needsSupabaseSignIn = ref(false)
const consolePanelRef = ref(null)

async function signInSupabase() {
	try {
		// Popup flow — resolves when Supabase has a fresh session. The session
		// ref updates either via exchangeCodeForSession inside signInWithGoogle
		// or via onAuthStateChange; the watcher below picks it up and kicks off
		// bootstrapIdentity.
		await AuthRepo.signInWithGoogle()
	} catch (err) {
		if (err?.message !== 'Sign-in cancelled') console.error('[Supabase] sign-in failed:', err)
	}
}

provide('openConsole', () => {
	consolePanelRef.value?.openConsole?.()
})

onMounted(async () => {
	// If we're the OAuth popup returning with ?code=..., forward the code and close.
	// COOP headers from Google/Supabase may null window.opener or clear window.name,
	// so we check both signals and use three delivery channels below.
	const isOAuthPopup = window.name === 'supabase-oauth' ||
		(window.opener && window.opener !== window && !window.opener.closed)
	if (isOAuthPopup) {
		const params = new URLSearchParams(window.location.search)
		const code   = params.get('code')
		if (code) {
			// Channel 1: localStorage — triggers storage event in main window; unaffected by COOP.
			try { localStorage.setItem('ava-oauth-pending', JSON.stringify({ code, ts: Date.now() })) } catch { /* ignore */ }
			// Channel 2: BroadcastChannel (works across browsing context groups)
			try { new BroadcastChannel('ava-oauth').postMessage({ type: 'supabase-oauth-code', code }) } catch { /* ignore */ }
			// Channel 3: postMessage (works when COOP is not enforced)
			try {
				if (window.opener && !window.opener.closed)
					window.opener.postMessage({ type: 'supabase-oauth-code', code }, window.location.origin)
			} catch { /* ignore */ }
			window.close()
			return
		}
	}

	// Restore cached Google provider token (sessionStorage → silent refresh)
	// so calendar/gmail work without waiting for a fresh OAuth round-trip.
	// await loadGoogleTokenFromSession()

	// Load saved avatar config from IDB FIRST so isSetupDone is correct
	// before we do anything else with the store.
	await avatarStore.load()

	// Bootstrap Supabase auth (restores existing session if present, or
	// completes the OAuth code exchange if we just landed on the callback).
	// If still no session, show the sign-in prompt — but stay reactive so a
	// late-arriving SIGNED_IN event (e.g. popup-forwarded code) bootstraps
	// the app without requiring a manual sign-in click.
	await AuthRepo.ready()
	if (!AuthRepo.getSession()) {
		needsSupabaseSignIn.value = true
		loading.value = false
		watch(supabaseSession, (s) => { if (s) bootstrapIdentity() }, { once: true })
		return
	}

	await bootstrapIdentity()
})

async function bootstrapIdentity() {
	needsSupabaseSignIn.value = false
	loading.value = true
	try {
		await userStore.fetchUser()
		if (userStore.user) {
			avatarStore.fromAuthUser(userStore.user)
		}
	} catch (err) {
		console.warn('[App] bootstrap failed:', err)
	}
	loading.value = false
}
</script>

<template>
	<!-- Global loading screen -->
	<div v-if="loading" class="global-loader">
		<div class="gl-logo lh-sm">Quicker<span>storm</span></div>
		<div class="mb-2 h3 fw-normal lh-sm text-accent2"><span>your virtual Worlds on Web</span></div>
		<div class="gl-spinner"></div>
	</div>

	<!-- Supabase mode: show Google sign-in if no session -->
	<div v-else-if="needsSupabaseSignIn" class="global-loader">
		<div class="gl-logo lh-sm">Quicker<span>storm</span></div>
		<div class="mb-3 h3 fw-normal lh-sm text-accent2"><span>your virtual Worlds on Web</span></div>
		<button class="ava-btn flex items-center justify-center gap-1 rounded-lg text-xs font-semibold p-3" @click="signInSupabase">Sign in with Google</button>
	</div>

	<!-- App shell — fills 100vh, no nav bar -->
	<RouterView v-else />

	<!-- Console Panel — keyboard shortcut or Corner menu -->
	<ConsolePanel ref="consolePanelRef" />
</template>

<style scoped>
.global-loader {
	position: fixed; inset: 0;
	background: var(--color-bg);
	display: flex; flex-direction: column;
	align-items: center; justify-content: center;
	gap: 1rem; z-index: 997;
}

.gl-logo {
	font-size: clamp(2rem, 3.5vw, 3rem); font-weight: 900;
	color: var(--color-accent3);
	letter-spacing: -0.04em;
	font-family: 'EurostileExtended', 'RobotoFlex', sans-serif;
}
.gl-logo span {
	margin-left: 0.1rem;
	color: var(--color-tm);
	font-size: clamp(1.4rem, 2.2vw, 2rem);
	font-weight: 400;
	letter-spacing: 0.12em;
}

.gl-spinner {
	width: 2.75rem; height: 2.75rem;
	border: 3px solid var(--color-brd2);
	border-top-color: var(--color-accent);
	border-radius: 50%;
	animation: spin 0.75s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
