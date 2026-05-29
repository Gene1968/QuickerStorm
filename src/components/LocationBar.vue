<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'
import { useWorldStore } from '@/stores/worldStore'
import { useGridStore } from '@/stores/gridStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useTeleport } from '@/composables/useTeleport.js'
import { useAudio }			from '@/composables/useAudio.js'
import { MicVocalIcon, BirdIcon, SwordIcon, CuboidIcon, ScrollTextIcon, StarIcon, ChevronDownIcon } from '@lucide/vue'

const session = useSessionStore()
const world	 = useWorldStore()
const grid		= useGridStore()
const { connected } = useRealtimeSocket()
const { requestTeleport, requestRegionTeleport } = useTeleport()

const { playSound } = useAudio()
const showLocationHistory = ref(false)


// ── Region maturity rating (SL access codes from RegionHandshake) ─────────
// 13=PG/General, 21=Mature/Moderate, 42=Adult, 254=down/offline.
// WHY: Earlier code keyed on session.agentAccess ("M", "A") — that's the agent's account
// access cap, not the current region's rating. FS shows region rating; mirror that.
const REGION_MATURITY = {
	13:  { label: 'General ✅',  color: 'text-green-400'  },
	21:  { label: 'Moderate Ⓜ️', color: 'text-yellow-400' },
	42:  { label: 'Adult 🔞',    color: 'text-red-400'    },
	254: { label: 'Offline 💤',  color: 'text-tm'         },
}
const maturity = computed(() => REGION_MATURITY[session.regionAccess] ?? null)

// ── Coordinate display (SL format: X, Y, Z where Z = height) ─────────────
// WHY: OSGrid omits region_name from login XML. Real name arrives via RegionHandshake
// UDP packet decoded server-side and forwarded as S.REGION_INFO. Show interim state.
const region	= computed(() => {
	if (session.regionName) return session.regionName
	if (session.connected)	return 'Entering region…'
	return 'Unknown Region'
})
const coords	= computed(() => {
	// WHY: Read sim-authoritative avatar position, not camera position.
	// Camera orbits behind avatar — camera coords diverge from avatar coords.
	const p = world.avatarPos	// { x: SL_X, y: SL_Y, z: SL_Z(height) }
	return `${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}`
})

// ── Click-to-edit: show hop:// or secondlife:// URL ───────────────────────
const editing	 = ref(false)
const editVal	 = ref('')
const editInput = ref(null)

// Auto-focus the input when editing starts
watch(editing, async (val) => {
	if (val) {
		await nextTick()
		editInput.value?.focus()
		editInput.value?.select()
	}
})

const hopUrl = computed(() => {
	const r = region.value
	const p = world.avatarPos
	const x = Math.round(p.x), y = Math.round(p.y), z = Math.round(p.z)	// SL coords
	const g = grid.selectedGrid

	if (!g) return `secondlife://${encodeURIComponent(r)}/${x}/${y}/${z}`

	if (g.platform === 'opensim' && g.gatekeeper) {
		// Strip protocol prefix and trailing slash from gatekeeper URL
		const gw = g.gatekeeper.replace(/^https?:\/\//, '').replace(/\/$/, '')
		return `hop://${gw}/${encodeURIComponent(r)}/${x}/${y}/${z}`
	}
	if (g.slurlBase) {
		const base = g.slurlBase.replace(/\/$/, '')
		return `${base}/${encodeURIComponent(r)}/${x}/${y}/${z}`
	}
	return `secondlife://${encodeURIComponent(r)}/${x}/${y}/${z}`
})

function showLocationInfo() {
	console.log(`To-do: [LocationBar] open location Place Profile for Parcel / ${region.value}`)
}

function startEdit() {
	editVal.value = hopUrl.value
	editing.value = true
}

function cancelEdit() {
	editing.value = false
}

function commitEdit() {
	const raw = editVal.value.trim()
	editing.value = false
	if (!connected.value || !raw) return

	// Accept formats:
	//   "X, Y, Z"                                — bare SL coords (same region)
	//   "X Y Z"
	//   "hop://gw/Region Name/X/Y/Z"             — cross-region via MapNameRequest
	//   "secondlife://Region Name/X/Y/Z"
	//   "Region Name X Y Z"                      — bare region name + coords
	const nums = raw.match(/\d+\.?\d*/g)?.map(Number) ?? []
	if (nums.length < 3) return
	const [x, y, z] = nums.slice(-3)
	if (isNaN(x) || isNaN(y) || isNaN(z)) return

	// Extract region name from URL or leading bare-name token.
	let regionName = null
	const urlMatch = raw.match(/^(?:hop|secondlife|sl):\/\/(?:[^/]+\/)?([^/]+?)\/\d/i)
	if (urlMatch) {
		try { regionName = decodeURIComponent(urlMatch[1]) } catch { regionName = urlMatch[1] }
	} else {
		// Strip trailing "X Y Z" or "X, Y, Z" or "X/Y/Z" — what's left is candidate name.
		const stripped = raw.replace(/[\s,/]+\d+\.?\d*[\s,/]+\d+\.?\d*[\s,/]+\d+\.?\d*\s*$/, '').trim()
		if (stripped && /[A-Za-z]/.test(stripped) && stripped.toLowerCase() !== session.regionName?.toLowerCase()) {
			regionName = stripped
		}
	}

	if (regionName && regionName.toLowerCase() !== (session.regionName ?? '').toLowerCase()) {
		console.log(`[LocationBar] cross-region TP → "${regionName}" ${x},${y},${z}`)
		requestRegionTeleport({ regionName, x, y, z }).then(r => {
			if (!r.ok) console.warn(`[LocationBar] cross-region TP failed: ${r.error}`)
		})
		return
	}

	console.log(`[LocationBar] same-region TP → ${x},${y},${z} raw="${raw}"`)
	requestTeleport({ x, y, z })
}

function onEditKeydown(e) {
	if (e.key === 'Enter')	commitEdit()
	if (e.key === 'Escape') cancelEdit()
}
</script>

<template>
	<div class="flex items-center gap-2 bg-white/10 rounded-1 ps-3 text-xs text-white select-none min-w-0">

		<span @click="showLocationInfo" title="See more info about the current location (TO-DO)" class="me-2 text-base">ℹ️</span>

		<!-- Connection status dot -->
		<span class="fs-5 pb-1 shrink-0" :class="connected ? 'text-green-400' : 'text-red-400'" :title="'You are ' + (connected ? 'online' : 'disconnected')">
			{{ connected ? '●' : '○' }}
		</span>

		<!-- Location display / edit toggle -->
		<template v-if="!editing">
			<button
				class="flex items-center gap-1 min-w-0 text-left hover:bg-white/10 rounded px-1 -mx-1 transition-colors"
				title="Click to edit / teleport"
				@click="startEdit"
			>
				<!-- Region + coords -->
				<span class="font-medium truncate max-w-[15rem]">{{ region }}</span>
				<span class="text-white/60 font-montserrat shrink-0">({{ coords }})</span>
				<!-- Maturity badge -->
				<span v-if="maturity" :class="['shrink-0 ml-0.5', maturity.color]">
					· {{ maturity.label }}
				</span>
			</button>
		</template>

		<!-- Edit mode: show hop:// URL in an input -->
		<template v-else>
			<input
				ref="editInput"
				v-model="editVal"
				class="flex-1 bg-white/10 border border-accent/50 rounded px-2 py-0.5 min-w-[35rem] text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-accent"
				@keydown="onEditKeydown"
				@blur="cancelEdit"
			/>
			<span class="text-white text-xs shrink-0">Esc or Enter</span>
		</template>

		<span class="mx-3"></span>
		<MicVocalIcon v-if="false" title="Voice (TO-DO)" class="w-5 h-5 me-2 text-gray-400" />
		<BirdIcon v-if="false" title="Flying (TO-DO)" class="w-5 h-5 me-2 text-gray-400" />
		<SwordIcon v-if="false" title="Pushing (TO-DO)" class="w-5 h-5 me-2 text-gray-400" />
		<CuboidIcon title="Building (TO-DO)" class="w-5 h-5 me-2 text-gray-400" />
		<ScrollTextIcon title="Scripts (TO-DO)" class="w-5 h-5 me-2 text-gray-400" />
		<button title="Add to landmarks (TO-DO)" class="me-3"><StarIcon class="w-5 h-5 text-gray-400 hover:text-yellow-500" /></button>
		<button @click="playSound('tick.mp3', 0.6); showLocationHistory = !showLocationHistory" title="Location history (TO-DO)" class="bg-gray-700/20 border border-white/30 rounded-r"><ChevronDownIcon class="w-5 h-5 text-white" /></button>

	</div>
	<div v-if="showLocationHistory" class="absolute top-8 right-0 bg-black/50 w-[33.333rem] translate-x-[-130%] p-1 text-sm text-white z-10">
		<button class="hover:bg-tm w-full text-start" title="hop://login.osgrid.org/Lazarus%20Taxon%206/137/44/24">Lazarus Taxon 6 (137, 44, 24)</button>
		<button class="hover:bg-tm w-full text-start" title="hop://login.osgrid.org/Lazarus%20Taxon%207/140/140/25">Lazarus Taxon 7 (140, 140, 25)</button>
		<button class="hover:bg-tm w-full text-start">Location history (TO-DO)</button>
	</div>
</template>

<style scoped>
/* TODO: click-out to close */
</style>
