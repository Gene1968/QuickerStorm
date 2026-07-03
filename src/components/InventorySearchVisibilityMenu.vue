<script setup>
// Search-bar "viz" eye dropdown — mirrors Firestorm's options_visibility_btn beside the inventory
// filter input (llpanelmaininventory.cpp:426, wired at :2171-2172 to
// menu_inventory_search_visibility.xml). FS's menu toggles WHERE search looks — search SCOPES, not
// item types (the Filters side panel owns type filtering):
//   "Search outfit folders" / "Search Trash" / "Search Library"
//   (menu_inventory_search_visibility.xml search_outfits / search_trash / search_library →
//    llpanelmaininventory.cpp:2639-2657 toggleSearchVisibility*).
// NOTE: FS's fourth entry, "Include links" (include_links), is intentionally OMITTED — inventory
// LINK items are not implemented in this app yet (gated on the Appearance pipeline); add the row
// alongside link support.
// WHY controlled `open`: the floater owns the open flag so its document-click closeMenus() closes
// this menu alongside the type/cog/add menus (one dismissal path for every header dropdown).
import { computed } from 'vue'
import { EyeIcon, ChevronDownIcon } from '@lucide/vue'

const props = defineProps({
	open:   { type: Boolean, default: false },
	// { outfits, trash, library } booleans — true = scope INCLUDED in search results.
	// FS default is ALL scopes on (llinventoryfilter.h:173 search_visibility 0xFFFFFFFF).
	scopes: { type: Object, required: true },
})
const emit = defineEmits(['toggle-open', 'toggle-scope'])

// FS menu order (menu_inventory_search_visibility.xml top→bottom).
const SCOPES = [
	{ key: 'outfits', label: 'Search outfit folders' },
	{ key: 'trash',   label: 'Search Trash' },
	{ key: 'library', label: 'Search Library' },
]

// Highlight the eye when any scope is narrowing search results (off = excluded).
const anyOff = computed(() => SCOPES.some(s => props.scopes[s.key] === false))
</script>

<template>
	<div class="relative">
		<button
			class="ui-btn py-0"
			:class="anyOff ? 'text-accent border-accent' : ''"
			title="Search visibility — choose where the search looks"
			@click.stop="emit('toggle-open')"
		><EyeIcon /><ChevronDownIcon class="w-3" /></button>
		<div
			v-if="open"
			class="absolute z-[60] mt-0.5 right-0 min-w-[11rem] bg-panel border border-edge rounded-sm shadow-lg text-2xs"
			@click.stop
		>
			<button
				v-for="s in SCOPES"
				:key="s.key"
				class="flex w-full items-center justify-start gap-1 px-2 py-1.5 hover:bg-white/10 whitespace-nowrap"
				:class="scopes[s.key] === false ? 'text-accent' : 'text-fg'"
				@click="emit('toggle-scope', s.key)"
			><span class="w-3">{{ scopes[s.key] !== false ? '✓' : '' }}</span>{{ s.label }}</button>
		</div>
	</div>
</template>

<style scoped>
</style>
