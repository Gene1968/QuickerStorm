<script setup>
import { useUiStore }  from '@/stores/uiStore'
import FloaterWindow   from '@/components/FloaterWindow.vue'
import { CogIcon, ChevronDownIcon, PlusIcon, LuggageIcon, FilterIcon, Trash2Icon } from '@lucide/vue'

const ui = useUiStore()
</script>

<template>
	<FloaterWindow
		id="inventory"
		title="📦 Inventory"
		:wrap-style="{ width: '15vw', height: '40vh', resize: 'both' }"
		:default-pos="{ left: '0.125%', bottom: '4%' }"
		@close="ui.toggleInventory()"
	>
		<div class="p-4 text-center text-tm text-sm italic flex flex-col items-center gap-1">
			<p class="text-2xl">📦</p>
			<p>Inventory viewer coming in Phase 2.</p>
			<p class="text-xs mt-2 opacity-60">Full in-world inventory browsing, attachment, and wearables.</p>
		</div>
		<div class="flex-1"/>
		<div class="flex flex-row align-items-center justify-content-between text-xs text-white">
			<button><CogIcon /><ChevronDownIcon class="w-3" /></button>
			<button><PlusIcon /></button>
			<button><CogIcon /></button>
			<button><LuggageIcon /></button>
			<button><FilterIcon /></button>
			<div class="flex-grow p-1 text-2xs truncate">999,999 elements</div>
			<button><Trash2Icon /></button>
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
		padding: 0;
		color: var(--color-t2);
		transition: color 0.15s, border-color 0.15s, background 0.15s;
		aspect-ratio: 1/1;
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
