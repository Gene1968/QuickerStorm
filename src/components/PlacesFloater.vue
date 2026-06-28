<script setup>
import { computed } from 'vue'
import { ref } from 'vue'
import { PlusIcon, Trash2Icon, CogIcon, ChevronDownIcon, ArrowUpDownIcon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { usePlaces } from '@/composables/usePlaces'
import { useUiStore } from '@/stores/uiStore'
import { useInventoryStore } from '@/stores/inventoryStore'

const ui = useUiStore()
const inv = useInventoryStore()
const { builtIns, invFavorites, history, landmarks, teleportTo, teleportToLandmark, clearHistory } = usePlaces()

const filter = ref('')

const TABS = [
	{ id: 'favorites',  label: 'Favorites' },
	{ id: 'landmarks',  label: 'Landmarks' },
	{ id: 'history',    label: 'Teleport History' },
]

function openAddLandmark() {
	const folderId = ui.placesActiveTab === 'favorites' ? inv.findSystemFolder(23) : undefined
	ui.openCreateLandmark(folderId ? { folderId } : null)
}

const filteredFavorites = computed(() => {
	const q = filter.value.toLowerCase()
	return q ? invFavorites.value.filter(lm => lm.name.toLowerCase().includes(q)) : invFavorites.value
})

const filteredLandmarks = computed(() => {
	const q = filter.value.toLowerCase()
	return q ? builtIns.value.filter(p => p.name.toLowerCase().includes(q)) : builtIns.value
})

const filteredInvLandmarks = computed(() => {
	const q = filter.value.toLowerCase()
	return q ? landmarks.value.filter(l => l.name.toLowerCase().includes(q)) : landmarks.value
})

const filteredHistory = computed(() => {
	const q = filter.value.toLowerCase()
	return q ? history.value.filter(p => (p.name + ' ' + (p.regionName || '')).toLowerCase().includes(q)) : history.value
})
</script>

<template>
	<FloaterWindow
		id="places"
		title="Places"
		:wrap-style="{ width: '28rem', height: '36rem', resize: 'both' }"
		:default-pos="{ left: '35vw', top: '20vh' }"
		@close="ui.togglePlaces()"
	>
		<div class="flex flex-col h-full text-xs">

			<!-- Top toolbar: filter + icon buttons -->
			<div class="flex items-stretch gap-0 border-b border-edge shrink-0">
				<input
					v-model="filter"
					type="search"
					placeholder="Filter My Places"
					class="flex-1 bg-fg/10 rounded-xl w-full px-2 py-1 text-xs text-fg placeholder-fg/70 focus:outline-hidden focus:ring-1 focus:ring-inset focus:ring-accent"
				/>
				<button class="tb-btn" title="Show options (TO-DO)"><CogIcon /><ChevronDownIcon class="w-3" /></button>
				<button class="tb-btn" title="Show sorting options (TO-DO)"><ArrowUpDownIcon /><ChevronDownIcon class="w-3" /></button>
				<button v-if="ui.placesActiveTab !== 'history'" class="tb-btn" title="Add new landmark" @click="openAddLandmark"><PlusIcon /></button>
				<button v-if="ui.placesActiveTab !== 'history'" class="tb-btn" title="Remove selected landmark or folder (TO-DO)"><Trash2Icon /></button>
			</div>

			<!-- Tab row -->
			<div class="tabs">
				<button
					v-for="tab in TABS"
					:key="tab.id"
					:class="{ 'active': ui.placesActiveTab === tab.id }"
					@click="ui.placesActiveTab = tab.id"
				>{{ tab.label }}</button>
			</div>

			<!-- Tab content area -->
			<div class="flex-1 min-h-0">

				<!-- ── Favorites ── -->
				<template v-if="ui.placesActiveTab === 'favorites'">
					<ul v-if="filteredFavorites.length" class="px-2 py-1">
						<li
							v-for="lm in filteredFavorites"
							:key="`fav-${lm.itemId}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded-sm hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportToLandmark(lm)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="w-3.5 h-3.5 shrink-0">📌</span>
								<div class="truncate min-w-0">{{ lm.name }}</div>
							</div>
							<button class="inline-btn" @click.stop="teleportToLandmark(lm)">TP</button>
						</li>
					</ul>
					<div v-else class="py-8 text-fg/30 italic text-center">
						{{ filter ? 'No matches (clear filter above).' : 'No favorites yet — use the star ✦ or + to add one.' }}
					</div>
				</template>

				<!-- ── Landmarks ── -->
				<!-- WHY: two groups — built-in region anchors (Spawn / Region centre / Last position,
					computed live) and real saved-asset landmarks from inventory. The latter teleport
					via TeleportLandmarkRequest (sim resolves the LM asset's stored location). -->
				<template v-else-if="ui.placesActiveTab === 'landmarks'">
					<!-- Region anchors -->
					<p class="px-3 pt-2 pb-1 text-2xs uppercase tracking-widest text-fg/60">This region</p>
					<ul v-if="filteredLandmarks.length" class="px-2">
						<li
							v-for="(p, i) in filteredLandmarks"
							:key="`anchor-${i}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded-sm hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportTo(p)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="mb-1 w-3.5 h-3.5 shrink-0">📍</span>
								<div class="min-w-0">
									<div class="truncate">{{ p.name }}</div>
									<div class="text-2xs text-fg/60 truncate">{{ p.regionName || '—' }} ({{ Math.round(p.x) }}, {{ Math.round(p.y) }}, {{ Math.round(p.z) }})</div>
								</div>
							</div>
							<button class="inline-btn" @click.stop="teleportTo(p)">TP</button>
						</li>
					</ul>

					<!-- Saved inventory landmarks -->
					<p class="px-3 pt-3 pb-1 text-2xs uppercase tracking-widest text-fg/60">My landmarks</p>
					<ul v-if="filteredInvLandmarks.length" class="px-2 pb-2">
						<li
							v-for="lm in filteredInvLandmarks"
							:key="`lm-${lm.itemId}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded-sm hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportToLandmark(lm)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="mb-1 w-3.5 h-3.5 shrink-0">📌</span>
								<div class="truncate min-w-0">{{ lm.name }}</div>
							</div>
							<button class="inline-btn" @click.stop="teleportToLandmark(lm)">TP</button>
						</li>
					</ul>
					<div v-else class="px-3 pb-2 text-fg/40 italic text-xs">
						{{ filter ? 'No matches (clear filter above).' : 'No saved landmarks (still loading inventory, or none in this account).' }}
					</div>
				</template>

				<!-- ── Teleport History ── -->
				<template v-else-if="ui.placesActiveTab === 'history'">
					<ul v-if="filteredHistory.length" class="py-1 pe-8 ps-2 max-w-full">
						<li
							v-for="(p, i) in filteredHistory"
							:key="`hist-${i}`"
							class="py-1 px-1 rounded-sm hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportTo(p)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="mb-1 w-3.5 h-3.5 shrink-0">📌</span>
								<div class="grid grid-cols-4 gap-3 min-w-0">
									<div class="col-span-2 truncate">
										{{ p.name }},
										<span class="text-2xs text-fg/60">{{ p.regionName || '—' }}</span>
									</div>
									<div class="text-2xs text-fg/60 whitespace-nowrap">{{ Math.round(p.x) }}, {{ Math.round(p.y) }}, {{ Math.round(p.z) }}</div>
									<div class="text-2xs text-fg/60 whitespace-nowrap">mm/dd/yyyy, hh:mm</div>
								</div>
								<button class="absolute right-0 opacity-0 group-hover:opacity-100" @click.stop="teleportTo(p)">TP</button>
							</div>
						</li>
					</ul>
					<div v-else class="py-8 text-fg/30 italic text-center">
						{{ filter ? 'No matches (clear filter above).' : 'No teleport history yet.' }}
					</div>
				</template>
			</div>

			<!-- History: clear log -->
			<div
				v-if="ui.placesActiveTab === 'history' && history.length"
				class="flex justify-end px-3 py-2 border-t border-edge shrink-0"
			>
				<button class="save-btn" @click="clearHistory">
					<Trash2Icon class="w-3 h-3" /> Clear history
				</button>
			</div>

		</div>
	</FloaterWindow>
</template>

<style scoped>
/* ── Toolbar icon buttons (top strip) ── */
.tb-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0.35rem;
	border: none;
	border-left: 1px solid var(--edge);
	border-radius: 0;
	background: none;
	color: var(--fg-subtle);
	cursor: pointer;
	transition: color 0.15s, background 0.15s;
}
.tb-btn:hover {
	background: rgba(255, 255, 255, 0.07);
	color: var(--fg);
}
.tb-btn svg { width: 1rem; height: 1rem; }

/* ── Inline list row buttons ── */
.inline-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.2rem;
	padding: 0.125rem 0.5rem;
	font-size: 0.65rem;
	background: var(--accent);
	color: #fff;
	border: none;
	border-radius: 0.25rem;
	cursor: pointer;
	opacity: 0;
	transition: opacity 0.1s;
}
li:hover .inline-btn { opacity: 1; }
.inline-btn--trash {
	background: transparent;
	color: rgba(255, 255, 255, 0.4);
	padding: 0.125rem;
}
.inline-btn--trash:hover { color: #f87171; }

/* ── Save button ── */
.save-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.125rem 0.5rem;
	font-size: 0.75rem;
	background: var(--accent);
	color: #fff;
	border: none;
	border-radius: 0.25rem;
	cursor: pointer;
	white-space: nowrap;
	flex-shrink: 0;
	transition: opacity 0.1s;
}
.save-btn:hover { opacity: 0.8; }
.save-btn svg { width: 0.75rem; height: 0.75rem; }
</style>
