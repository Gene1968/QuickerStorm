<script setup>
import { ref, computed, watch } from 'vue'
import { useGridLogin } from '@/composables/useGridLogin'
import { useGridStore } from '@/stores/gridStore'

const { login }		= useGridLogin()
const gridStore		= useGridStore()

const username		= ref('')
const password		= ref('')
const destType		= ref('last')// 'last' | 'home' | 'region'
const destRegion	= ref('')	// region name when destType === 'region'
const error			= ref('')

// Recent region destinations stored per-grid in localStorage
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
	try {
		if (destType.value === 'region' && destRegion.value.trim()) {
			saveRecent(gridStore.selectedNick, destRegion.value.trim())
		}
		await login(username.value, password.value, destination.value)
	} catch (e) {
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

		<button
			type="submit"
			class="px-4 py-2 rounded bg-accent2 text-white font-semibold hover:opacity-80 disabled:opacity-50 transition-opacity"
			:disabled="gridStore.loginState === 'loading'"
		>
			{{ gridStore.loginState === 'loading' ? 'Connecting…' : 'Log In' }}
		</button>

		<p v-if="error" class="text-red-400 text-sm break-words">{{ error }}</p>
	</form>
</template>
