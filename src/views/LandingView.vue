<script setup>
import { computed, onMounted, ref }	from 'vue'
import GridSelector					from '@/components/GridSelector.vue'
import LoginForm					from '@/components/LoginForm.vue'
import { useTheme }				from '@/composables/useTheme'
import { useGridStore }			from '@/stores/gridStore'
import { useGridLogin }			from '@/composables/useGridLogin'

const { isDark, toggle } = useTheme()
const gridStore = useGridStore()
const { login } = useGridLogin()

const splashUrl = computed(() => gridStore.selectedGrid?.loginPage ?? null)

// ── Auto-reconnect on reload ──────────────────────────────────────────────
// WHY: Session state (Pinia) is in-memory only — clears on page reload.
// If "Remember me" was used, credentials are in localStorage. Check synchronously
// before first render so the spinner shows immediately (not 1 frame later).
// On success, useGridLogin sets session + navigates to /world automatically.
// On failure, clear stored creds and show normal login form.
const AUTOLOGIN_KEY = 'qs_autologin'

let _stored = null
try { _stored = JSON.parse(localStorage.getItem(AUTOLOGIN_KEY)) } catch {}
const hasStoredCreds = !!(_stored?.username && _stored?.password)

const reconnecting   = ref(hasStoredCreds)   // true → shows spinner on first render
const reconnectError = ref('')               // '' = none; string = error message to show

onMounted(async () => {
	if (!hasStoredCreds) return
	try {
		await login(_stored.username, _stored.password, 'last')
	} catch (e) {
		// WHY: Don't clear creds — grid may need time to release old circuit.
		// Pre-filled form lets user retry with one click without re-typing.
		reconnecting.value   = false
		reconnectError.value = e?.message || 'Auto-reconnect failed — please log in again.'
	}
})
</script>

<template>
	<div class="fixed inset-0 overflow-hidden">

		<!-- ── Full-screen splash ─────────────────────────────────────────── -->
		<iframe
			v-if="splashUrl"
			:key="splashUrl"
			:src="splashUrl"
			class="absolute top-0 right-0 border-0 w-[80vw] h-full"
			tabindex="-1"
			aria-hidden="true"
			referrerpolicy="no-referrer"
		/>
		<div
			v-else
			class="absolute inset-0 bg-gradient-to-br from-slate-900 via-bg to-black"
		/>

		<!-- ── Login strip — 1rem from all edges, rounded, dark bg ───────── -->
		<div
			class="absolute inset-x-3 bottom-3 bg-forest/80 w-[18.75vw] rounded-2xl overflow-y-auto"
			style="backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,0.08);"
		>
			<div class="flex flex-col items-start gap-5 px-5 py-4">

				<!-- Brand + disclaimer -->
				<div class="shrink-0 flex flex-col gap-1 w-full pt-0.5">
					<div class="flex items-center justify-between gap-2">
						<h1 class="text-3xl font-bold text-white tracking-tight ">
							quicker<span class="font-black">STORM</span>
						</h1>
						<!-- Theme toggle -->
						<button
							class="rounded-full hover:bg-accent3 p-1 text-white/50 hover:text-white text-xl leading-none shrink-0 transition-colors aspect-square"
							@click="toggle"
							:title="isDark ? 'Light mode' : 'Dark mode'"
						>{{ isDark ? '☀' : '🌙' }}</button>
					</div>

					<p class="text-white/45 text-md leading-snug my-1">
						Web-based metaverse viewer for OpenSimulator &amp; Second Life
					</p>
				</div>

				<!-- Divider -->
				<div class="self-stretch w-px bg-white/10 shrink-0" />

				<!-- Auto-reconnect spinner -->
				<template v-if="reconnecting">
					<div class="flex flex-col items-center gap-3 w-full py-4 text-center">
						<div class="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
						<p class="text-t1 text-sm">Reconnecting to {{ gridStore.selectedGrid?.name ?? gridStore.selectedNick }}…</p>
					</div>
				</template>

				<!-- Normal login form -->
				<template v-else>
					<!-- Grid + form — constrained width -->
					<div class="flex flex-col gap-3 w-full">
						<p
							v-if="reconnectError"
							class="text-yellow-400 text-xs"
						>{{ reconnectError }}</p>
						<div>
							<label class="block text-t1 text-xs uppercase tracking-widest mb-1">Grid</label>
							<GridSelector />
						</div>
						<LoginForm />
					</div>

					<!-- Disclaimer -->
					<div class="w-full mt-5 text-t1 text-xs leading-relaxed">
						<p>
							quickerSTORM is an independent project, not affiliated with or sponsored by FireStorm or by Linden Research, Inc.  <em>Second Life®</em> is a registered trademark of Linden Research, Inc.
						</p>
						<p class="mt-2">
							Credentials are used for grid login only. With <em>Remember me</em>, your username and password are stored in your browser's local storage for auto-reconnect.
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
