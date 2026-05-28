<script setup>
import { useUiStore }  from '@/stores/uiStore'
import FloaterWindow   from '@/components/FloaterWindow.vue'
import { ChevronDownIcon, EyeIcon, ChevronRightIcon, ChevronLastIcon, CogIcon, PlusIcon, LuggageIcon, FilterIcon, ListIcon, TableOfContentsIcon, Trash2Icon } from '@lucide/vue'

const ui = useUiStore()
</script>

<template>
	<FloaterWindow
		id="inventory"
		title="📦 Inventory"
		:wrap-style="{ width: '15vw', height: '45vh', resize: 'both' }"
		:default-pos="{ left: '0.125vw', bottom: '2.65rem' }"
		@close="ui.toggleInventory()"
	>
		<div class="flex p-1"><input class="inv-search rounded-5 bg-brd2 w-full px-3 text-t1" placeholder="Filter Inventory (TO-DO)" type="search" /></div>
		<div class="flex flex-row align-items-center justify-content-evenly w-full mb-1 text-white">
			<div class="flex flex-row align-items-center justify-content-start w-full overflow-hidden text-2xs">
				<button class="me-2 py-0">Collapse</button>
				<button class="me-2 py-0">Expand</button>
				<span class="me-1">Filter:</span>
				<button class="flex grow align-items-center justify-content-between me-1 py-0 text-nowrap">All Types<ChevronDownIcon class="w-3" /></button>
			</div>
			<button title="Show search visibility options" class="py-0"><EyeIcon /><ChevronDownIcon class="w-3" /></button>
		</div>
		<div class="flex flex-row align-items-start justify-content-evenly text-2xs text-white">
			<button class="p-1"><ChevronLastIcon class="rotate-180" /></button>
			<button class="p-1"><ChevronRightIcon class="rotate-180" /></button>
			<div class="flex flex-row align-items-center justify-content-start w-full overflow-x-auto">
				<button class="p-1">Inventory</button>
				<button class="p-1">Recent</button>
				<button class="p-1">Work</button>
				<button class="p-1">Favorites</button>
				<button class="p-1"><PlusIcon /></button>
			</div>
			<button class="p-1"><ChevronRightIcon /></button>
			<button class="p-1"><ChevronLastIcon /></button>
		</div>
		<div class="p-4 text-center text-tm text-sm italic flex flex-col items-center gap-1 pt-12">
			<p class="mt-8 text-2xl">📦</p>
			<p>Inventory viewer coming in Phase 2.</p>
			<p class="text-xs mt-2 opacity-60">Full in-world inventory browsing, attachment, and wearables.</p>
		</div>
		<div class="flex-1"/>
		<div class="flex flex-row align-items-center justify-content-between text-xs text-white">
			<button title="Show additional options (TO-DO)" class="px-1"><CogIcon /><ChevronDownIcon class="w-3" /></button>
			<button title="Add new item (TO-DO)"><PlusIcon /></button>
			<button title="Additional inventory floater (TO-DO)"><LuggageIcon /></button>
			<button title="Show filters - Shows the filter side menu when selected. Becomes highlighted when any filter is enabled. (TO-DO)"><FilterIcon /></button>
			<button v-if="true" title="Switch between views (TO-DO)"><ListIcon /></button>
			<button v-else title="Switch between views (TO-DO)"><TableOfContentsIcon /></button>
			<div v-if="true" title="999,999 Items, 333 Folders (TO-DO)" class="grow border-2 border-brd2 p-1 text-2xs text-t1 truncate user-select-none">999,999 Elements</div>
			<div v-else title="0 Items, 27 Folders (TO-DO)" class="grow border-2 border-brd2 p-1 text-2xs text-t1 truncate user-select-none">27 Elements</div>
			<button title="Remove selected item (TO-DO)"><Trash2Icon /></button>
		</div>
	</FloaterWindow>
</template>

<style scoped>
	button {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-brd);
		border-radius: 0;
		padding: 0.35rem;
		color: var(--color-t2);
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	button:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: var(--color-accent);
		color: var(--color-t1);
	}
	button svg {
		width: 1rem;
		height: 1rem;
	}
</style>
