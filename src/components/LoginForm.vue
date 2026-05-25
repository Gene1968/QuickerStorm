<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useGridLogin } from '@/composables/useGridLogin'
import { useGridStore } from '@/stores/gridStore'

const { login }		= useGridLogin()
const gridStore		= useGridStore()

const username		= ref('')
const password		= ref('')
const destType		= ref('last')// 'last' | 'home' | 'region'
const destRegion	= ref('')	// region name when destType === 'region'
const error			= ref('')

// ── Remember Me — per-grid credential storage ─────────────────────────────
// WHY: Each grid is a separate service with separate accounts. Storing under
// one flat key would clobber credentials when the user switches grids.
const AUTOLOGIN_PREFIX = 'qs_autologin_'
function autologinKey() { return `${AUTOLOGIN_PREFIX}${gridStore.selectedNick}` }

// WHY: Pre-fill from stored creds for the active grid. Called on mount and
// whenever the user switches grids so the form always shows the right creds.
function loadCredsForGrid() {
	try {
		const stored = JSON.parse(localStorage.getItem(autologinKey()))
		username.value   = stored?.username ?? ''
		password.value   = stored?.password ?? ''
		// WHY: If this grid has stored creds, keep rememberMe on so a one-click
		// retry works after auto-reconnect failure.
		rememberMe.value = !!(stored?.username && stored?.password)
	} catch {
		username.value = ''
		password.value = ''
	}
}

onMounted(loadCredsForGrid)
// WHY: Reload credentials immediately when user picks a different grid from
// the dropdown — not just on next submit — so the form is always in sync.
watch(() => gridStore.selectedNick, loadCredsForGrid)

// WHY: Default true — auto-reconnect on reload is expected behaviour for a viewer.
// User can uncheck to opt out. loadCredsForGrid overrides this based on stored state.
const rememberMe = ref(true)

// ── Recent region destinations ────────────────────────────────────────────
const RECENT_KEY = 'qs_recent_regions'
function loadRecent() {
	try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '{}') } catch { return {} }
}
function saveRecent(grid, region) {
	const all = loadRecent()
	const list = [region, ...(all[grid] ?? []).filter(r => r !== region)].slice(0, 5)
	all[grid] = list
	try { localStorage.setItem(RECENT_KEY, JSON.stringify(all)) } catch {}
}
const recentRegions = computed(() => loadRecent()[gridStore.selectedNick] ?? [])

// Build the start string the server/grid expects
const destination = computed(() => {
	if (destType.value === 'last')	return 'last'
	if (destType.value === 'home')	return 'home'
	const name = destRegion.value.trim()
	return name ? `uri:${name}&128&128&0` : 'last'
})

// Clear region field when switching away from 'region' mode
watch(destType, v => { if (v !== 'region') destRegion.value = '' })

async function submit() {
	error.value = ''
	if (destType.value === 'region' && destRegion.value.trim()) {
		saveRecent(gridStore.selectedNick, destRegion.value.trim())
	}
	// WHY: Save creds BEFORE login() resolves — login() calls router.push() then resolves,
	// and the router navigation can unmount this component before the post-await line runs.
	// Saving first is safe: on failure we clear them so no stale creds persist.
	const key = autologinKey()
	if (rememberMe.value) {
		localStorage.setItem(key, JSON.stringify({ username: username.value, password: password.value }))
	} else {
		localStorage.removeItem(key)
	}
	try {
		await login(username.value, password.value, destination.value)
	} catch (e) {
		localStorage.removeItem(key)  // don't persist bad creds
		error.value = e.message
	}
}
</script>

<template>
	<form class="flex flex-col gap-3" @submit.prevent="submit">

		<input
			v-model="username"
			type="text"
			placeholder="First Last"
			autocomplete="username"
			class="reset-input px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-accent"
			required
		/>

		<input
			v-model="password"
			type="password"
			placeholder="Password"
			autocomplete="current-password"
			class="reset-input px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-accent"
			required
		/>

		<!-- Destination row -->
		<div class="flex flex-col gap-1.5">
			<label class="text-t1 text-xs uppercase tracking-wide">Start Location</label>
			<div class="flex gap-2">
				<select
					v-model="destType"
					class="flex-1 px-2 py-1.5 border border-brd rounded bg-card2 text-t1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				>
					<option value="last">Last Location</option>
					<option value="home">Home</option>
					<option value="region">Region…</option>
				</select>
			</div>

			<!-- Region name input -->
			<div v-if="destType === 'region'" class="flex flex-col gap-1">
				<input
					v-model="destRegion"
					type="text"
					placeholder="Region name"
					list="qs-recent-regions"
					class="px-3 py-1.5 rounded bg-card border border-brd text-t1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				/>
				<datalist id="qs-recent-regions">
					<option v-for="r in recentRegions" :key="r" :value="r" />
				</datalist>
				<p class="text-t2 text-xs">Region name as it appears on the grid's map.</p>
			</div>
		</div>

		<!-- Remember me -->
		<label class="flex items-center gap-2 text-t1 text-sm cursor-pointer select-none">
			<input type="checkbox" v-model="rememberMe" class="rounded accent-accent" />
			Remember me
		</label>

		<p v-if="error" class="text-red-300 text-sm break-words">{{ error }}</p>

		<button
			type="submit"
			class="px-4 py-2 rounded bg-accent2 text-white font-semibold hover:opacity-80 disabled:opacity-50 transition-opacity"
			:disabled="gridStore.loginState === 'loading'"
		>
			{{ gridStore.loginState === 'loading' ? 'Connecting…' : 'Log In' }}
		</button>

	</form>
</template>
