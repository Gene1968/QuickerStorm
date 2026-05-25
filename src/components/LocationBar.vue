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
const { requestTeleport } = useTeleport()

const { playSound } = useAudio()
const showLocationHistory = ref(false)


// ── Maturity rating ───────────────────────────────────────────────────────
const MATURITY = {
	'PG': { label: 'P.Guidance 👪', color: 'text-green-400'  },
	'G':  { label: 'General ✅',    color: 'text-green-400'  },
	'M':  { label: 'Moderate Ⓜ️',   color: 'text-yellow-400' },
	'A':  { label: 'Adult 🔞',      color: 'text-red-400'    },
}
const maturity = computed(() => MATURITY[session.agentAccess] ?? null)

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
	console.log(`To do: [LocationBar] open location About info for ${region.value}`)
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
	// WHY: Use connected.value (WS state) not session.connected (login state).
	// WS must be open to emit; session.connected may lag or differ.
	if (!connected.value || !raw) return

	// WHY: Accept three formats:
	//	 "X, Y, Z"				 — bare SL coords (same region)
	//	 "X Y Z"					 — same but space-separated
	//	 "hop://gw/Reg/X/Y/Z" or "sl://Reg/X/Y/Z" — URL (extract trailing X/Y/Z)
	// Extract the last three numeric tokens as X, Y, Z.
	const nums = raw.match(/\d+\.?\d*/g)?.map(Number) ?? []
	if (nums.length < 3) return
	const [x, y, z] = nums.slice(-3)
	if (isNaN(x) || isNaN(y) || isNaN(z)) return

	console.log(`[LocationBar] teleport → ${x},${y},${z} raw="${raw}"`)
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
		<span :class="connected ? 'text-green-400' : 'text-red-400'" class="fs-5 pb-1 shrink-0">
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
	<div v-if="showLocationHistory" class="absolute top-8 right-0 bg-black/50 w-[33.33rem] h-7 translate-x-[-126%] py-1 px-2 text-sm text-white z-10">Location history (TO-DO)</div>
</template>

<style scoped>

</style>
