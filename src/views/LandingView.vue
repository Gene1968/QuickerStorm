<script setup>
import { computed, onMounted, ref }	from 'vue'
import LoginForm					from '@/components/LoginForm.vue'
import { useTheme }				from '@/composables/useTheme'
import { useGridStore }			from '@/stores/gridStore'
import { useGridLogin }			from '@/composables/useGridLogin'
import { useAccountsStore }		from '@/stores/accountsStore'
import { useUiStore }			from '@/stores/uiStore'

const { isDark, toggle } = useTheme()
const gridStore      = useGridStore()
const ui             = useUiStore()
const accountsStore  = useAccountsStore()
const { login, checkCircuit } = useGridLogin()

const splashUrl = computed(() => gridStore.selectedGrid?.loginPage ?? null)

// ── Auto-reconnect on reload ──────────────────────────────────────────────
// WHY: Session state (Pinia) is in-memory only — clears on page reload.
// If "Remember me" was used, credentials are in localStorage (per-grid key).
// Two gates must pass before auto-reconnect fires:
//
//   Gate 1 — sessionStorage.qs_in_world: was this tab actively in-world when
//   the page reloaded? Set by WorldView on mount, cleared by returnToLogin().
//   sessionStorage is tab-scoped and clears when the tab is closed, so a fresh
//   open the next day never has this flag.
//
//   Gate 2 — server CHECK_CIRCUIT: does the server still hold a live circuit?
//   If the hold expired (>15s since WS drop) or another viewer took over, the
//   server returns alive=false → we show the login form instead of forcing a
//   fresh XML-RPC login the user didn't ask for.
const IN_WORLD_KEY = 'qs_in_world'

// Most recently used account for the currently selected grid (accounts sorted by lastUsed desc)
const _stored       = accountsStore.accounts.find(a => a.gridNick === gridStore.selectedNick) ?? null
const hasStoredCreds = !!(_stored?.username && _stored?.password)

// Gate 1 evaluated synchronously — drives initial spinner render
const wasInWorld     = sessionStorage.getItem(IN_WORLD_KEY) === '1'
const mayReconnect   = hasStoredCreds && wasInWorld

const reconnecting   = ref(mayReconnect)  // true → shows spinner; gate 2 may clear it
const reconnectError = ref('')

onMounted(async () => {
	if (!mayReconnect) return

	// Gate 2 — ask server if circuit is still alive
	const alive = await checkCircuit(gridStore.selectedNick, _stored.username)
	if (!alive) {
		// WHY: Circuit expired or taken by external viewer. Show form so user
		// can choose to log in again (or pick a different grid/account).
		reconnecting.value = false
		return
	}

	try {
		await login(_stored.username, _stored.password, 'last')
	} catch (e) {
		reconnecting.value   = false
		reconnectError.value = e?.message || 'Auto-reconnect failed — please log in again.'
	}
})
</script>

<template>
	<div class="fixed inset-0 bg-accent-dark/70 overflow-hidden">

		<!-- ── Full-screen splash ─────────────────────────────────────────── -->
		<iframe
			v-if="splashUrl"
			:key="splashUrl"
			:src="splashUrl"
			class="absolute top-0 right-0 border-0 h-full"
			tabindex="-1"
			aria-hidden="true"
			referrerpolicy="no-referrer"
		/>
		<div
			v-else
			class="absolute inset-0 bg-gradient-to-br from-slate-900 via-surface to-black"
		/>

		<!-- WHY: iframes steal wheel/click events even when a position:fixed element
		     sits on top. This transparent shield at z-49 (below floaters at z-50+)
		     absorbs those events while any floater is open. -->
		<div v-if="ui.floaterStack.length > 0" class="absolute inset-0" style="z-index: 49" />

		<!-- ── Login strip — 1rem from all edges, rounded-sm, dark bg ───────── -->
		<div
			class="absolute inset-x-3 bottom-3 bg-panel-alt/80 w-[22.5rem] rounded-2xl overflow-y-auto"
			style="backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,0.08);"
		>
			<div class="flex flex-col items-start gap-5 p-4 pb-2">

				<!-- Brand + disclaimer -->
				<div class="shrink-0 flex flex-col gap-1 w-full pt-0.5">
					<div class="flex items-center justify-between gap-2">
						<h1 class="flex items-center font-orbitron font-bold text-2xl text-fg whitespace-nowrap">
							<span title="quickerSTORM logo" class="inline-block me-2 w-9 h-9 text-transparent">
								<!-- <img src="/favicon.svg" alt="quickerSTORM logo" class="h-full aspect-square me-2 text-transparent" /> -->
								<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 256 256"><g clip-path="url(#a)"><path fill="currentColor" d="M216 0H40C17.909 0 0 17.909 0 40v176c0 22.091 17.909 40 40 40h176c22.091 0 40-17.909 40-40V40c0-22.091-17.909-40-40-40"/><path fill="#fff" stroke="#4aa3ff" stroke-width="4" d="M128 248c66.274 0 120-53.726 120-120S194.274 8 128 8 8 61.726 8 128s53.726 120 120 120Z"/><path fill="#3b6fc4" d="M70 184.5c30.376 0 55-24.624 55-55s-24.624-55-55-55-55 24.624-55 55 24.624 55 55 55"/><path fill="#3b6fc4" d="M125 177c38.66 0 70-31.34 70-70s-31.34-70-70-70-70 31.34-70 70 31.34 70 70 70"/><path fill="#3b6fc4" d="M187.5 184.5c28.995 0 52.5-23.505 52.5-52.5s-23.505-52.5-52.5-52.5S135 103.005 135 132s23.505 52.5 52.5 52.5"/><path fill="#3b6fc4" d="M198.75 132H56.25C38.991 132 25 145.991 25 163.25s13.991 31.25 31.25 31.25h142.5c17.259 0 31.25-13.991 31.25-31.25S216.009 132 198.75 132"/><g stroke="#4aa3ff" stroke-width="4" opacity=".6"><path d="m40 40 176 176M216 40 40 216M128 24v208M24 128h208"/></g><path fill="#ffd23f" stroke="#ffb000" stroke-linejoin="round" stroke-width="4" d="M117.811 67 83 157.754h34.811L95.432 240 175 135.066h-37.297L160.081 67z"/></g><defs><clipPath id="a"><path fill="#fff" d="M0 0h256v256H0z"/></clipPath></defs></svg>
							</span>
							quicker<span class="font-black">STORM</span>
						</h1>
						<!-- Theme toggle -->
						<button
							class="rounded-full hover:bg-accent/20 w-9 h-9 text-fg/50 hover:text-fg text-xl leading-none shrink-0 transition-colors aspect-square"
							@click="toggle"
							:title="isDark ? 'go Light' : 'go Dark'"
						>{{ isDark ? '🌙' : '☀️' }}</button>
					</div>

					<p class="text-fg/45 text-md leading-snug my-1">
						Web-based metaverse viewer for OpenSimulator &amp; Second Life
					</p>
				</div>

				<!-- Auto-reconnect spinner -->
				<template v-if="reconnecting">
					<div class="flex flex-col items-center gap-3 w-full py-4 text-center">
						<div class="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
						<p class="text-fg text-sm">Reconnecting to {{ gridStore.selectedGrid?.name ?? gridStore.selectedNick }}…</p>
					</div>
				</template>

				<!-- Normal login form -->
				<template v-else>
					<!-- Grid + form — constrained width -->
					<div class="flex flex-col gap-3 w-full">
						<LoginForm />
						<p
							v-if="reconnectError"
							class="text-yellow-400 text-sm"
						>{{ reconnectError }}</p>
					</div>

					<!-- Disclaimer -->
					<div class="w-full mt-2 text-fg text-xs leading-relaxed">
						<p>
							quickerSTORM is an independent project, not affiliated with or sponsored by FireStorm or by Linden Research, Inc.  <em>Second Life®</em> is a registered trademark of Linden Research, Inc.
						</p>
						<p class="mt-2">
							Credentials are used for grid login only and are never saved. Only with <em>Remember me</em> option are they stored in your own browser for next time.
						</p>
						<p class="mt-3 opacity-60">
							Inspired by Firestorm Viewer &amp; SpeedLight
							<br />Built with Vue 3 · Three.js · Bun · WebRTC
						</p>
					</div>
				</template>

			</div>
		</div>

	</div>
</template>

<style scoped>
	iframe {
		width: calc(100vw - 24.15rem);
	}
</style>
