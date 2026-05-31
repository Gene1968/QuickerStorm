<script setup>
import { ref, computed } from 'vue'
import { PlusIcon, Trash2Icon, CogIcon, ChevronDownIcon, ArrowUpDownIcon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { usePlaces } from '@/composables/usePlaces'
import { useUiStore } from '@/stores/uiStore'

const ui = useUiStore()
const { builtIns, favorites, history, landmarks, teleportTo, teleportToLandmark, addFavorite, removeFavorite, renameFavorite, clearHistory } = usePlaces()

const filter  = ref('')
const newName = ref('')

const TABS = [
	{ id: 'favorites',  label: 'Favorites' },
	{ id: 'landmarks',  label: 'Landmarks' },
	{ id: 'history',    label: 'Teleport History' },
]

function saveCurrent() {
	addFavorite(newName.value.trim() || undefined)
	newName.value = ''
}

const filteredFavorites = computed(() => {
	const q = filter.value.toLowerCase()
	return q ? favorites.value.filter(p => p.name.toLowerCase().includes(q)) : favorites.value
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
		:wrap-style="{ width: '22rem', height: '36rem', resize: 'both' }"
		:default-pos="{ right: '35vw', top: '20vh' }"
		@close="ui.togglePlaces()"
	>
		<div class="flex flex-col h-full text-xs">

			<!-- Top toolbar: filter + icon buttons -->
			<div class="flex items-stretch gap-0 border-b border-brd shrink-0">
				<input
					v-model="filter"
					type="search"
					placeholder="Filter My Places"
					class="flex-1 bg-brd2 rounded-xl m-1 px-2 py-1 text-xs text-t1 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-accent"
				/>
				<button class="tb-btn" title="Show options (TO-DO)"><CogIcon /><ChevronDownIcon class="w-3" /></button>
				<button class="tb-btn" title="Show sorting options (TO-DO)"><ArrowUpDownIcon /><ChevronDownIcon class="w-3" /></button>
				<button v-if="ui.placesActiveTab !== 'history'" class="tb-btn" title="Add new landmark or folder (TO-DO)"><PlusIcon /></button>
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
			<div class="flex-1 min-h-0 overflow-y-auto">

				<!-- ── Favorites ── -->
				<template v-if="ui.placesActiveTab === 'favorites'">
					<ul v-if="filteredFavorites.length" class="px-2 py-1">
						<li
							v-for="(p, i) in filteredFavorites"
							:key="`fav-${i}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportTo(p)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="w-3.5 h-3.5 shrink-0">📌</span>
								<input
									:value="p.name"
									class="bg-transparent border-0 px-0 text-xs text-t1 focus:bg-white/10 focus:rounded focus:px-1 focus:outline-none min-w-0 flex-1"
									@change="(e) => renameFavorite(i, e.target.value)"
									@click.stop
								/>
							</div>
							<div class="flex items-center gap-1 shrink-0">
								<span class="text-2xs text-white/60 mr-1">{{ Math.round(p.x) }},{{ Math.round(p.y) }},{{ Math.round(p.z) }}</span>
								<button class="inline-btn" @click.stop="teleportTo(p)">TP</button>
								<button class="inline-btn inline-btn--trash" title="Remove" @click.stop="removeFavorite(i)">
									<Trash2Icon class="w-3 h-3" />
								</button>
							</div>
						</li>
					</ul>
					<div v-else class="py-8 text-white/30 italic text-center">
						{{ filter ? 'No matches (clear filter above).' : 'No favorites yet.' }}
					</div>
				</template>

				<!-- ── Landmarks ── -->
				<!-- WHY: two groups — built-in region anchors (Spawn / Region centre / Last position,
					computed live) and real saved-asset landmarks from inventory. The latter teleport
					via TeleportLandmarkRequest (sim resolves the LM asset's stored location). -->
				<template v-else-if="ui.placesActiveTab === 'landmarks'">
					<!-- Region anchors -->
					<p class="px-3 pt-2 pb-1 text-2xs uppercase tracking-widest text-white/60">This region</p>
					<ul v-if="filteredLandmarks.length" class="px-2">
						<li
							v-for="(p, i) in filteredLandmarks"
							:key="`anchor-${i}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportTo(p)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="mb-1 w-3.5 h-3.5 shrink-0">📍</span>
								<div class="min-w-0">
									<div class="truncate">{{ p.name }}</div>
									<div class="text-2xs text-white/60 truncate">{{ p.regionName || '—' }} ({{ Math.round(p.x) }}, {{ Math.round(p.y) }}, {{ Math.round(p.z) }})</div>
								</div>
							</div>
							<button class="inline-btn" @click.stop="teleportTo(p)">TP</button>
						</li>
					</ul>

					<!-- Saved inventory landmarks -->
					<p class="px-3 pt-3 pb-1 text-2xs uppercase tracking-widest text-white/60">My landmarks</p>
					<ul v-if="filteredInvLandmarks.length" class="px-2 pb-2">
						<li
							v-for="lm in filteredInvLandmarks"
							:key="`lm-${lm.itemId}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportToLandmark(lm)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="mb-1 w-3.5 h-3.5 shrink-0">📌</span>
								<div class="truncate min-w-0">{{ lm.name }}</div>
							</div>
							<button class="inline-btn" @click.stop="teleportToLandmark(lm)">TP</button>
						</li>
					</ul>
					<div v-else class="px-3 pb-2 text-white/40 italic text-xs">
						{{ filter ? 'No matches (clear filter above).' : 'No saved landmarks (still loading inventory, or none in this account).' }}
					</div>
				</template>

				<!-- ── Teleport History ── -->
				<template v-else-if="ui.placesActiveTab === 'history'">
					<ul v-if="filteredHistory.length" class="px-2 py-1">
						<li
							v-for="(p, i) in filteredHistory"
							:key="`hist-${i}`"
							class="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-white/10 cursor-pointer group"
							@dblclick="teleportTo(p)"
						>
							<div class="flex items-center gap-2 min-w-0">
								<span class="mb-1 w-3.5 h-3.5 shrink-0">📌</span>
								<div class="min-w-0">
									<div class="truncate">{{ p.name }}</div>
									<div class="text-2xs text-white/60 truncate">{{ p.regionName || '—' }} ({{ Math.round(p.x) }}, {{ Math.round(p.y) }}, {{ Math.round(p.z) }})</div>
								</div>
							</div>
							<button class="inline-btn opacity-0 group-hover:opacity-100" @click.stop="teleportTo(p)">TP</button>
						</li>
					</ul>
					<div v-else class="py-8 text-white/30 italic text-center">
						{{ filter ? 'No matches (clear filter above).' : 'No teleport history yet.' }}
					</div>
				</template>
			</div>

			<!-- History: clear log -->
			<div
				v-if="ui.placesActiveTab === 'history' && history.length"
				class="flex justify-end px-3 py-2 border-t border-brd shrink-0"
			>
				<button class="save-btn" @click="clearHistory">
					<Trash2Icon class="w-3 h-3" /> Clear history
				</button>
			</div>

			<!-- Favorites: save current position -->
			<form
				v-if="ui.placesActiveTab === 'favorites'"
				class="flex gap-1.5 px-3 py-2 border-t border-brd shrink-0"
				@submit.prevent="saveCurrent"
			>
				<input
					v-model="newName"
					type="text"
					placeholder="Name (optional)"
					class="flex-1 bg-white/10 border border-brd text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
					maxlength="64"
				/>
				<button type="submit" class="save-btn">
					<PlusIcon class="w-3 h-3" /> Save here
				</button>
			</form>

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
	border-left: 1px solid var(--color-brd);
	border-radius: 0;
	background: none;
	color: var(--color-t2);
	cursor: pointer;
	transition: color 0.15s, background 0.15s;
}
.tb-btn:hover {
	background: rgba(255, 255, 255, 0.07);
	color: var(--color-t1);
}
.tb-btn svg { width: 1rem; height: 1rem; }

/* ── Inline list row buttons ── */
.inline-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.2rem;
	padding: 0.125rem 0.5rem;
	font-size: 0.65rem;
	background: var(--color-accent);
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
	background: var(--color-accent);
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
