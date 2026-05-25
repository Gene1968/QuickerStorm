<script setup>
import { ref } from 'vue'
import { useUiStore }      from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useTeleport }     from '@/composables/useTeleport'
import FloaterWindow       from '@/components/FloaterWindow.vue'

const ui      = useUiStore()
const session = useSessionStore()
const { requestTeleport } = useTeleport()

// Legend toggles — UI only (TO-DO: wire to map overlay layers)
const showPeople   = ref(true)
const showInfohubs = ref(false)
const showLandSale = ref(false)
const showEventsG  = ref(false)
const showEventsM  = ref(false)
const showEventsA  = ref(false)

// Coordinate teleport — connected via useTeleport
const coordX = ref(128)
const coordY = ref(128)
const coordZ = ref(50)

// Search — TO-DO Phase 2
const searchQuery    = ref('')
const searchResults  = ref([])
const selectedResult = ref(null)
const status         = ref('')

function doTeleport() {
	requestTeleport({ x: Number(coordX.value), y: Number(coordY.value), z: Number(coordZ.value) })
}

function copySlurl() {
	const region = session.regionName || 'Unknown'
	const url    = `secondlife://${encodeURIComponent(region)}/${coordX.value}/${coordY.value}/${coordZ.value}`
	navigator.clipboard.writeText(url).catch(() => {})
	flashStatus('SLurl copied.')
}

function clearMap() {
	searchQuery.value    = ''
	searchResults.value  = []
	selectedResult.value = null
	status.value         = ''
}

function doSearch() {
	if (!searchQuery.value.trim()) return
	// TO-DO Phase 2: query grid map API for region by name
	flashStatus('Region search — Phase 2.')
}

function goHome() {
	// TO-DO Phase 2: teleport to home via capability
	flashStatus('Go Home — Phase 2.')
}

let _flashTimer = null
function flashStatus(msg) {
	status.value = msg
	clearTimeout(_flashTimer)
	_flashTimer = setTimeout(() => { status.value = '' }, 2500)
}
</script>

<template>
	<FloaterWindow
		id="map"
		title="🗺 World Map"
		:wrap-style="{ width: '62vw', height: '68vh', minWidth: '640px', minHeight: '400px', resize: 'both' }"
		:default-pos="{ left: '50%', top: '53%', transform: 'translate(-50%, -50%)' }"
		@close="ui.toggleMap()"
	>
		<!-- ── Horizontal split: map 75% left + sidebar 25% right ── -->
		<div class="flex flex-1 min-h-0 overflow-hidden">

			<!-- ══ MAP AREA ════════════════════════════════════════════ -->
			<div class="flex flex-col flex-1 min-w-0 relative bg-[#0b0c14] border-r border-brd">

				<!-- Map canvas placeholder -->
				<div class="flex-1 relative overflow-hidden select-none">

					<!-- Minor + major grid -->
					<svg class="absolute inset-0 w-full h-full opacity-25" xmlns="http://www.w3.org/2000/svg">
						<defs>
							<pattern id="mg-minor" width="24" height="24" patternUnits="userSpaceOnUse">
								<path d="M 24 0 L 0 0 0 24" fill="none" stroke="#3a5080" stroke-width="0.4"/>
							</pattern>
							<pattern id="mg-major" width="192" height="192" patternUnits="userSpaceOnUse">
								<rect width="192" height="192" fill="url(#mg-minor)"/>
								<path d="M 192 0 L 0 0 0 192" fill="none" stroke="#5577aa" stroke-width="1"/>
							</pattern>
						</defs>
						<rect width="100%" height="100%" fill="url(#mg-major)"/>
					</svg>

					<!-- Decorative region patches -->
					<div class="absolute inset-0 opacity-10 pointer-events-none">
						<div class="absolute rounded bg-green-700"  style="left:12%;top:18%;width:16%;height:13%"/>
						<div class="absolute rounded bg-teal-800"   style="left:28%;top:30%;width:11%;height: 9%"/>
						<div class="absolute rounded bg-green-600"  style="left:50%;top:16%;width:19%;height:16%"/>
						<div class="absolute rounded bg-blue-900"   style="left:38%;top:52%;width:13%;height:11%"/>
						<div class="absolute rounded bg-green-800"  style="left:63%;top:55%;width:21%;height:15%"/>
						<div class="absolute rounded bg-teal-900"   style="left:18%;top:62%;width:14%;height:12%"/>
					</div>

					<!-- Current-region dot + label -->
					<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
						<div class="flex flex-col items-center gap-1.5">
							<div class="w-3 h-3 rounded-full bg-accent border-2 border-white shadow-[0_0_8px_rgba(124,58,237,0.8)]"/>
							<span
								v-if="session.regionName"
								class="text-white/90 text-xs font-medium bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded"
							>{{ session.regionName }}</span>
						</div>
					</div>

					<!-- Watermark -->
					<div class="absolute bottom-2 left-3 pointer-events-none">
						<span class="text-white/12 text-[10px] tracking-widest uppercase">World Map — Phase 2</span>
					</div>
				</div>

				<!-- Zoom bar -->
				<div class="flex items-center gap-2 px-3 py-1.5 border-t border-brd bg-card shrink-0">
					<span class="text-tm text-xs select-none">−</span>
					<input
						type="range" min="1" max="10" value="5"
						class="flex-1 h-1 accent-accent opacity-40 cursor-not-allowed"
						disabled title="Zoom — Phase 2"
					/>
					<span class="text-tm text-xs select-none">+</span>
					<span class="text-tm/40 text-[10px] ml-2 italic">Zoom — Phase 2</span>
				</div>
			</div>

			<!-- ══ RIGHT SIDEBAR - TO-DO: make collapsible only after map is draggable zoomable and clickable to TP ═════════ -->
			<div class="flex flex-col w-64 shrink-0 overflow-y-auto text-xs">

				<!-- ─ Legend ─────────────────────────────────── -->
				<div class="px-3 py-1.5 bg-card2 border-b border-brd text-[10px] font-semibold text-white/60 uppercase tracking-widest shrink-0">
					Legend
				</div>
				<div class="px-3 py-2 border-b border-brd flex flex-col gap-1.5 shrink-0">

					<!-- Me + Go Home -->
					<div class="flex items-center justify-between mb-0.5">
						<button
							class="flex items-center gap-1 text-t1 hover:text-accent transition-colors"
							title="Center map on avatar — Phase 2"
						>
							<span>📍</span><span>Me</span>
						</button>
						<button
							class="flex items-center gap-1 text-t1 hover:text-accent transition-colors"
							title="Teleport home — Phase 2"
							@click="goHome"
						>
							<span>🏠</span><span>Go Home</span>
						</button>
					</div>

					<div class="flex align-start justify-between">
						<div>
							<!-- People (enabled, wired to legend layer TO-DO) -->
							<label class="flex items-center gap-1.5 cursor-pointer hover:text-accent text-t1">
								<input v-model="showPeople" type="checkbox" class="accent-accent"/>
								<span class="w-2 h-2 rounded-full bg-green-400 shrink-0"/>
								<span>People</span>
							</label>
							<!-- Infohub (TO-DO) -->
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showInfohubs" type="checkbox" class="accent-accent" disabled/>
								<span class="text-blue-400 shrink-0">ℹ</span>
								<span>Infohub</span>
							</label>
							<!-- Land Sale (TO-DO) -->
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showLandSale" type="checkbox" class="accent-accent" disabled/>
								<span class="text-yellow-400 shrink-0">🏷</span>
								<span>Land Sale</span>
							</label>
						</div>
						<div>
							<!-- Events sub-section -->
							<div class="mt-1 mb-0.5 text-[10px] text-white/40 uppercase tracking-wide">Events</div>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showEventsG" type="checkbox" class="accent-accent" disabled/>
								<span class="w-2 h-2 rounded-full bg-green-500 shrink-0"/>
								<span>General</span>
							</label>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showEventsM" type="checkbox" class="accent-accent" disabled/>
								<span class="w-2 h-2 rounded-full bg-yellow-500 shrink-0"/>
								<span>Moderate</span>
							</label>
							<label class="flex items-center gap-1.5 text-tm/50 cursor-not-allowed" title="TO-DO">
								<input v-model="showEventsA" type="checkbox" class="accent-accent" disabled/>
								<span class="w-2 h-2 rounded-full bg-red-500 shrink-0"/>
								<span>Adult</span>
							</label>
						</div>
					</div>
				</div>

				<!-- ─ Find on Map ─────────────────────────────── -->
				<div class="px-3 py-1.5 bg-card2 border-b border-brd text-[10px] font-semibold text-white/60 uppercase tracking-widest shrink-0">
					Find on Map
				</div>
				<div class="px-2 py-2 border-b border-brd flex flex-col gap-1.5 shrink-0">

					<!-- Friends online (TO-DO) -->
					<select
						class="w-full bg-card2 border border-brd text-tm rounded px-1.5 py-1 text-xs opacity-50 cursor-not-allowed"
						disabled title="Online Friends — TO-DO"
					>
						<option>👥 Online Friends</option>
					</select>

					<!-- Landmarks (TO-DO) -->
					<select
						class="w-full bg-card2 border border-brd text-tm rounded px-1.5 py-1 text-xs opacity-50 cursor-not-allowed"
						disabled title="My Landmarks — TO-DO"
					>
						<option>🏁 My Landmarks</option>
					</select>

					<!-- Region search -->
					<div class="flex gap-1">
						<input
							v-model="searchQuery"
							type="text"
							placeholder="Regions by name…"
							class="flex-1 min-w-0 bg-card2 border border-brd text-t1 placeholder-tm rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
							@keydown.enter="doSearch"
						/>
						<button
							class="px-2 py-1 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
							@click="doSearch"
						>Find</button>
					</div>

					<!-- Results list -->
					<div
						class="bg-card2 border border-brd rounded overflow-y-auto"
						style="min-height:9.5rem;max-height:15rem"
					>
						<div
							v-if="!searchResults.length"
							class="flex items-center justify-center h-16 text-tm/40 italic text-[11px]"
						>
							No results
						</div>
						<button
							v-for="r in searchResults"
							:key="r.name"
							class="w-full text-left px-2 py-1 text-xs truncate hover:bg-accent/20 transition-colors"
							:class="selectedResult?.name === r.name ? 'bg-accent/30 text-white' : 'text-t1'"
							@click="selectedResult = r"
						>{{ r.name }}</button>
					</div>
				</div>

				<!-- ─ Location / Teleport ─────────────────────── -->
				<div class="px-3 py-1.5 bg-card2 border-b border-brd text-[10px] font-semibold text-white/60 uppercase tracking-widest shrink-0">
					Location
				</div>
				<div class="px-2 py-2 flex flex-col gap-1.5">

					<!-- X Y Z spinners -->
					<div class="flex items-center justify-evenly gap-x-1.5 gap-y-1">
						<span class="text-tm font-mono text-[10px] text-right">X/Y/Z:</span>
						<input
							v-model.number="coordX"
							type="number" min="1" max="255" step="1"
							class="bg-card2 border border-brd text-t1 rounded px-1.5 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 focus:ring-accent"
						/>
						<input
							v-model.number="coordY"
							type="number" min="1" max="255" step="1"
							class="bg-card2 border border-brd text-t1 rounded px-1.5 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 focus:ring-accent"
						/>
						<input
							v-model.number="coordZ"
							type="number" min="0" max="4096" step="1"
							class="bg-card2 border border-brd text-t1 rounded px-1.5 py-1 text-xs text-center w-full focus:outline-none focus:ring-1 focus:ring-accent"
						/>
					</div>

					<!-- Teleport (connected) -->
					<button
						class="w-full py-1.5 bg-accent text-white rounded text-xs font-semibold hover:opacity-80 transition-opacity mt-0.5"
						@click="doTeleport"
					>
						Teleport
					</button>

					<!-- Copy SLurl + Clear -->
					<div class="flex gap-1">
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-t1 rounded text-xs hover:bg-white/5 transition-colors"
							title="Copy SLurl to clipboard"
							@click="copySlurl"
						>Copy SLurl</button>
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-t1 rounded text-xs hover:bg-white/5 transition-colors"
							@click="clearMap"
						>Clear</button>
					</div>

					<!-- Show Selection + Track Region (TO-DO) -->
					<div class="flex gap-1 opacity-40">
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-tm rounded text-xs cursor-not-allowed"
							disabled title="TO-DO"
						>Show Selection</button>
						<button
							class="flex-1 py-1 bg-card2 border border-brd text-tm rounded text-xs cursor-not-allowed"
							disabled title="TO-DO"
						>Track Region</button>
					</div>

					<!-- Status flash -->
					<p v-if="status" class="text-yellow-400 text-[10px] text-center">{{ status }}</p>
				</div>

			</div>
		</div>
	</FloaterWindow>
</template>
