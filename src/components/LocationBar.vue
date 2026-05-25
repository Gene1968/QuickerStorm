<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'
import { useWorldStore } from '@/stores/worldStore'
import { useGridStore } from '@/stores/gridStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useTeleport } from '@/composables/useTeleport.js'
import { MicVocalIcon, BirdIcon, SwordIcon, CuboidIcon, ScrollTextIcon, StarIcon } from '@lucide/vue'

const session = useSessionStore()
const world	 = useWorldStore()
const grid		= useGridStore()
const { connected } = useRealtimeSocket()
const { requestTeleport } = useTeleport()

// ── Maturity rating ───────────────────────────────────────────────────────
const MATURITY = {
	'PG': { label: 'General',	color: 'text-green-400' },
	'G':	{ label: 'General',	color: 'text-green-400' },
	'M':	{ label: 'Moderate', color: 'text-yellow-400' },
	'A':	{ label: 'Adult',		color: 'text-red-400' },
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
	<div class="flex items-center gap-2 bg-white/10 rounded-1 px-3 text-xs text-white select-none min-w-0">

		<span @click="showLocationInfo" title="See more info about the current location" class="me-2 text-base">ℹ️</span>

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
		<MicVocalIcon v-if="false" title="Voice" class="w-5 h-5 mx-1 text-gray-400" />
		<BirdIcon v-if="false" title="Flying" class="w-5 h-5 mx-1 text-gray-400" />
		<SwordIcon v-if="false" title="Pushing" class="w-5 h-5 mx-1 text-gray-400" />
		<CuboidIcon title="Building" class="w-5 h-5 mx-1 text-gray-400" />
		<ScrollTextIcon title="Scripts" class="w-5 h-5 mx-1 text-gray-400" />
		<StarIcon class="w-5 h-5 mx-3 text-gray-400" />

	</div>
</template>

<style scoped>

</style>
