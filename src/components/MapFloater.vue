<script setup>
import { ref } from 'vue'
import { useUiStore } from '@/stores/uiStore'

const ui = useUiStore()

const regionInput = ref('')
const status			= ref('')	// feedback message

function close() { ui.toggleMap() }

function teleport() {
	const name = regionInput.value.trim()
	if (!name) { status.value = 'Enter a region name.'; return }
	// TODO Phase 2: send TELEPORT_REQUEST via WS → server parses + sends TP packet
	status.value = `Teleport to "${name}" — coming in Phase 2.`
}

function onKeydown(e) {
	if (e.key === 'Enter') teleport()
	if (e.key === 'Escape') close()
}
</script>

<template>
	<!-- Draggable-feel floater panel — centered, fixed width -->
	<div
		class="absolute -translate-x-1/2 -translate-y-1/2 bg-card border border-brd rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
		style="left: 50%; top: 50%; width: 48vw; height: 60vh; resize: both;">
		<!-- Header -->
		<div class="flex items-center px-3 py-2 bg-card2 border-b border-brd">
			<span class="text-t1 text-sm font-medium flex-1">🗺 Map / Teleport</span>
			<button class="text-tm hover:text-t1 text-lg leading-none" title="Close" @click="close">×</button>
		</div>

		<!-- Body -->
		<div class="p-3 flex flex-col gap-2">
			<p class="text-tm text-xs">Teleport to a region by name:</p>
			<div class="flex gap-2">
				<input
					v-model="regionInput"
					type="text"
					placeholder="Region name…"
					class="flex-1 bg-card2 border border-brd rounded px-2 py-1.5 text-sm text-t1 placeholder:text-tm focus:outline-none focus:ring-1 focus:ring-accent"
					@keydown="onKeydown"
				/>
				<button
					class="px-3 py-1.5 bg-accent text-white rounded text-sm hover:opacity-80 shrink-0"
					@click="teleport"
				>
					Go
				</button>
			</div>

			<!-- Status / feedback -->
			<p v-if="status" class="text-yellow-400 text-xs">{{ status }}</p>

			<div class="border-t border-brd mt-1 pt-2">
				<p class="text-tm text-xs italic">
					Full world map coming in Phase 2. For now, type any region name to teleport.
				</p>
			</div>
		</div>
	</div>
</template>
