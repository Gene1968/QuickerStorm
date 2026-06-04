<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useGridLogin } from '@/composables/useGridLogin'
import { useGridStore } from '@/stores/gridStore'
import { useAccountsStore } from '@/stores/accountsStore'
import { ChevronDownIcon } from '@lucide/vue'
import GridSelector from '@/components/GridSelector.vue'

const { login }		= useGridLogin()
const gridStore		= useGridStore()
const accountsStore	= useAccountsStore()

const username		= ref('')
const password		= ref('')
const destType		= ref('last')// 'last' | 'home' | 'region'
const destRegion	= ref('')	// region name when destType === 'region'
const error			= ref('')

// WHY: Default true — auto-reconnect on reload is expected behaviour for a viewer.
// User can uncheck to opt out.
const rememberMe = ref(true)

// Clear form when user switches grid via GridSelector (not via account combobox)
watch(() => gridStore.selectedNick, () => {
	username.value = ''
	password.value = ''
})

// Pre-fill last used account on load
onMounted(async () => {
	const last = accountsStore.accounts[0]
	if (!last) return
	gridStore.selectGrid(last.gridNick)
	await nextTick() // let the clear-watcher fire first (fields are blank anyway)
	username.value = last.username
	password.value = last.password
})


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

// WHY: Native <datalist> mispositions inside scrollable/overflow panels
// (LandingView login strip has overflow-y-auto). Custom lists anchor to the
// input instead. Same pattern used for both username and region fields.
const usernameInputRef = ref(null)
const showAccountSuggestions = ref(false)

function openAccountSuggestions() {
	if (accountsStore.accounts.length) showAccountSuggestions.value = true
}
function toggleAccountSuggestions() {
	showAccountSuggestions.value = !showAccountSuggestions.value
}
function closeAccountSuggestions() {
	showAccountSuggestions.value = false
}
async function pickAccount(acct) {
	closeAccountSuggestions()
	gridStore.selectGrid(acct.gridNick)
	await nextTick() // let clear-watcher fire before setting fields
	username.value = acct.username
	password.value = acct.password
}

const regionInputRef = ref(null)
const showRegionSuggestions = ref(false)
const filteredRegions = computed(() => {
	const q = destRegion.value.trim().toLowerCase()
	const list = recentRegions.value
	return q ? list.filter(r => r.toLowerCase().includes(q)) : list
})

function openRegionSuggestions() {
	if (recentRegions.value.length) showRegionSuggestions.value = true
}
function closeRegionSuggestions() {
	showRegionSuggestions.value = false
}
function pickRegion(name) {
	destRegion.value = name
	closeRegionSuggestions()
	nextTick(() => regionInputRef.value?.focus())
}

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
	// WHY: Capture before await — component may unmount after login() triggers
	// router.push(). Store references survive unmount, primitive captures do too.
	const user     = username.value
	const grid     = gridStore.selectedNick
	const pass     = password.value
	const remember = rememberMe.value
	try {
		await login(user, pass, destination.value)
		if (remember) accountsStore.addOrUpdate(user, grid, pass)
	} catch (e) {
		error.value = e.message
	}
}
</script>

<template>
	<form class="flex flex-col gap-3" autocomplete="off" @submit.prevent>

		<div class="relative">
			<input
				ref="usernameInputRef"
				v-model="username"
				type="text"
				placeholder="Username: First Last"
				autocomplete="new-password"
				class="reset-input w-full px-3 py-2 pr-8 rounded focus:outline-none focus:ring-2 focus:ring-accent"
				required
				@focus="openAccountSuggestions"
				@input="openAccountSuggestions"
				@blur="closeAccountSuggestions"
				@keydown.escape="closeAccountSuggestions"
			@keydown.enter="submit"
			/>
			<button
				type="button"
				tabindex="-1"
				class="absolute right-2 top-1/2 -translate-y-1/2 text-t2 hover:text-t1 transition-colors"
				@mousedown.prevent
				@click="toggleAccountSuggestions"
			><ChevronDownIcon class="w-4 h-4 transition-transform" :class="showAccountSuggestions ? 'rotate-180' : ''" /></button>
			<ul
				v-if="showAccountSuggestions"
				class="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-40 overflow-y-auto rounded border border-brd bg-card shadow-lg"
				@mousedown.prevent
			>
				<template v-if="accountsStore.accounts.length">
					<li
						v-for="acct in accountsStore.accounts"
						:key="acct.username + '@' + acct.gridNick"
						class="cursor-pointer px-3 py-1.5 text-sm text-t1 hover:bg-accent/15"
						@click="pickAccount(acct)"
					>{{ acct.username }} <span class="text-t2">@ {{ gridStore.grids.find(g => g.nick === acct.gridNick)?.name ?? acct.gridNick }}</span></li>
				</template>
				<li v-else class="px-3 py-1.5 text-sm text-t2 italic select-none">None stored</li>
			</ul>
		</div>

		<input
			v-model="password"
			type="password"
			placeholder="Password"
			autocomplete="new-password"
			class="reset-input px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-accent"
			required
			@keydown.enter="submit"
		/>

		<!-- Grid -->
		<div>
			<label class="block text-t1 text-xs uppercase tracking-widest mb-1">Grid</label>
			<GridSelector />
		</div>

		<!-- Destination row -->
		<div class="flex flex-col gap-1.5">
			<label class="text-t1 text-xs uppercase tracking-wide">Start Location</label>
			<div class="flex gap-2">
				<select
					v-model="destType"
					class="flex-1 py-1.5 px-2 border border-brd rounded bg-card2 text-t1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				>
					<option value="last">Last Location</option>
					<option value="home">Home</option>
					<option value="region">Region…</option>
				</select>
			</div>

			<!-- Region name input -->
			<div v-if="destType === 'region'" class="flex flex-col gap-1">
				<div class="relative">
					<input
						ref="regionInputRef"
						v-model="destRegion"
						type="text"
						placeholder="Region name"
						autocomplete="off"
						class="w-full px-3 py-1.5 rounded bg-card border border-brd text-t1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
						@focus="openRegionSuggestions"
						@input="openRegionSuggestions"
						@blur="closeRegionSuggestions"
						@keydown.escape="closeRegionSuggestions"
					/>
					<ul
						v-if="showRegionSuggestions && filteredRegions.length"
						class="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-40 overflow-y-auto rounded border border-brd bg-card shadow-lg"
						@mousedown.prevent
					>
						<li
							v-for="r in filteredRegions"
							:key="r"
							class="cursor-pointer px-3 py-1.5 text-sm text-t1 hover:bg-accent/15"
							@click="pickRegion(r)"
						>{{ r }}</li>
					</ul>
				</div>
				<p class="text-orange-500 text-xs">Region name as it appears on the grid's map.</p>
			</div>
		</div>

		<!-- Remember me -->
		<label class="flex items-center gap-2 text-t1 text-sm cursor-pointer select-none">
			<input type="checkbox" v-model="rememberMe" class="rounded accent-accent" />
			Remember me
		</label>

		<p v-if="error" class="text-red-300 text-sm break-words">{{ error }}</p>

		<button
			type="button"
			class="px-4 py-2 rounded bg-accent2 text-white font-semibold hover:opacity-80 disabled:opacity-50 transition-opacity"
			:disabled="gridStore.loginState === 'loading'"
			@click="submit"
		>
			{{ gridStore.loginState === 'loading' ? 'Connecting…' : 'Log In' }}
		</button>

	</form>
</template>
