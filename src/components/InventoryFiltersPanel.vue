<script setup>
// InventoryFiltersPanel — a functional subset of Firestorm's LLInventoryFilter side panel.
// WHY: FS's full filter floater covers type checkboxes, permission filters, date ranges, links, etc.
// We ship the two most-used, feasible controls (multi-select TYPE checkboxes + "Show empty folders")
// wired to the floater's existing filter logic; the rest is tracked in docs/FEATURE-GAPS.md.
import { computed } from 'vue'
import { TYPE_FILTER_CHECKS, itemIcon } from '@/utils/inventoryIcons'
import { XIcon } from '@lucide/vue'

const props = defineProps({
	// Set<string> of active TYPE_FILTERS ids (empty = All Types).
	typeIds:          { type: Object, required: true },
	showEmptyFolders: { type: Boolean, default: true },
})
const emit = defineEmits(['toggle-type', 'update:showEmptyFolders', 'reset', 'close'])

const allTypes = computed(() => props.typeIds.size === 0)

function toggleType(id) { emit('toggle-type', id) }
</script>

<template>
	<div class="absolute bottom-0 left-full mb-1 z-[60] h-full overflow-y-auto bg-panel border border-edge rounded-sm shadow-lg text-2xs text-fg" @click.stop>
		<div class="flex items-center justify-between px-2 py-1 border-b border-edge">
			<span class="font-semibold">All items</span>
			<button class="ui-btn px-1 py-0" title="Close filters" @click="emit('close')"><XIcon class="w-3 h-3" /></button>
		</div>

		<!-- <div class="px-2 py-1 text-fg-muted">Show item types</div> -->
		<button
			v-for="t in TYPE_FILTER_CHECKS"
			:key="t.id"
			class="flex w-full items-center justify-start gap-2 px-2 py-1 hover:bg-white/10 whitespace-nowrap"
			:class="typeIds.has(t.id) ? 'text-accent' : 'text-fg'"
			@click="toggleType(t.id)"
		><span class="w-3">{{ itemIcon(t.types) }}</span><span class="w-2">{{ typeIds.has(t.id) ? '✓' : '' }}</span>{{ t.label }}</button>
		<button
			class="flex w-full items-center justify-start gap-2 px-2 py-1 text-left hover:bg-white/10"
			:class="allTypes ? 'text-accent' : 'text-fg'"
			@click="emit('reset')"
		><span class="w-7 text-end">{{ allTypes ? '✓' : '' }}</span>All Types</button>
		<button
			class="flex w-full items-center justify-start gap-2 px-2 py-1 text-left hover:bg-white/10"
			:class="typeIds.length === 0 ? 'text-accent' : 'text-fg'"
		><span class="w-7 text-end">⬜</span>None (to-do)</button>

		<div class="border-t border-edge mt-1"></div>
		<button
			class="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/10 whitespace-nowrap"
			:class="showEmptyFolders ? 'text-fg' : 'text-accent'"
			@click="emit('update:showEmptyFolders', !showEmptyFolders)"
		><span class="w-3">{{ showEmptyFolders ? '✓' : '' }}</span>Show empty folders</button>

		<div class="border-t border-edge"></div>
		<button class="block w-full text-left px-2 py-1.5 hover:bg-white/10 text-fg" @click="emit('reset')">Reset Filters</button>
	</div>
</template>

<style scoped>
</style>
