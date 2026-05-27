<script setup>
import { ref } from 'vue'
import { MapPinIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { usePlaces } from '@/composables/usePlaces'
import { useUiStore } from '@/stores/uiStore'

const ui = useUiStore()
const { builtIns, favorites, teleportTo, addFavorite, removeFavorite, renameFavorite } = usePlaces()

const newName = ref('')

function saveCurrent() {
	addFavorite(newName.value.trim() || undefined)
	newName.value = ''
}
</script>

<template>
	<FloaterWindow
		id="places"
		title="Places"
		:wrap-style="{ width: '22rem', height: '28rem', resize: 'both' }"
		:default-pos="{ right: '10%', top: '12%' }"
		@close="ui.togglePlaces()"
	>
		<div class="flex flex-col h-full text-xs">
			<!-- Built-in landmarks -->
			<div class="px-3 py-2 border-b border-brd">
				<div class="text-white/50 mb-1 text-[0.65rem] uppercase tracking-wide">Built-in</div>
				<ul>
					<li
						v-for="(p, i) in builtIns"
						:key="`bi-${i}`"
						class="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-white/10 cursor-pointer group"
						@dblclick="teleportTo(p)"
					>
						<div class="flex items-center gap-2 min-w-0">
							<MapPinIcon class="w-3.5 h-3.5 text-accent shrink-0" />
							<div class="min-w-0">
								<div class="truncate">{{ p.name }}</div>
								<div class="text-[0.6rem] text-white/40 truncate">{{ p.regionName || '—' }} ({{ Math.round(p.x) }}, {{ Math.round(p.y) }}, {{ Math.round(p.z) }})</div>
							</div>
						</div>
						<button class="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[0.65rem] bg-accent text-white rounded hover:opacity-80" @click.stop="teleportTo(p)">TP</button>
					</li>
				</ul>
			</div>

			<!-- Favorites -->
			<div class="flex-1 min-h-0 px-3 py-2 overflow-y-auto">
				<div class="text-white/50 mb-1 text-[0.65rem] uppercase tracking-wide">Favorites</div>
				<ul v-if="favorites.length">
					<li
						v-for="(p, i) in favorites"
						:key="`fav-${i}`"
						class="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-white/10 cursor-pointer group"
						@dblclick="teleportTo(p)"
					>
						<div class="flex items-center gap-2 min-w-0">
							<MapPinIcon class="w-3.5 h-3.5 text-yellow-400 shrink-0" />
							<input
								:value="p.name"
								class="bg-transparent border-0 px-0 text-xs text-t1 focus:bg-white/10 focus:rounded focus:px-1 focus:outline-none min-w-0 flex-1"
								@change="(e) => renameFavorite(i, e.target.value)"
								@dblclick.stop
								@click.stop
							/>
						</div>
						<div class="flex items-center gap-1 shrink-0">
							<div class="text-[0.6rem] text-white/40 mr-1">{{ Math.round(p.x) }},{{ Math.round(p.y) }},{{ Math.round(p.z) }}</div>
							<button class="opacity-0 group-hover:opacity-100 px-2 py-0.5 text-[0.65rem] bg-accent text-white rounded hover:opacity-80" @click.stop="teleportTo(p)">TP</button>
							<button class="opacity-0 group-hover:opacity-100 p-0.5 text-white/40 hover:text-red-400" title="Remove" @click.stop="removeFavorite(i)">
								<Trash2Icon class="w-3 h-3" />
							</button>
						</div>
					</li>
				</ul>
				<div v-else class="py-3 text-white/30 italic text-center">No favorites yet — save current position below.</div>
			</div>

			<!-- Add current -->
			<form
				class="flex gap-1.5 px-3 py-2 border-t border-brd shrink-0"
				@submit.prevent="saveCurrent"
			>
				<input
					v-model="newName"
					type="text"
					placeholder="Name (optional)"
					class="flex-1 bg-white/10 border border-t1 text-t1 placeholder-white/30 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
					maxlength="64"
				/>
				<button
					type="submit"
					class="flex items-center gap-1 px-2 py-0.5 bg-accent text-white rounded text-xs hover:opacity-80 shrink-0"
				>
					<PlusIcon class="w-3 h-3" /> Save here
				</button>
			</form>
		</div>
	</FloaterWindow>
</template>
