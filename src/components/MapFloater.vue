<script setup>
import { ref } from 'vue'
import { useUiStore }  from '@/stores/uiStore'
import FloaterWindow   from '@/components/FloaterWindow.vue'

const ui = useUiStore()

const regionInput = ref('')
const status      = ref('')

function teleport() {
	const name = regionInput.value.trim()
	if (!name) { status.value = 'Enter a region name.'; return }
	// TODO Phase 2: send TELEPORT_REQUEST via WS → server parses + sends TP packet
	status.value = `Teleport to "${name}" — coming in Phase 2.`
}

function onKeydown(e) {
	if (e.key === 'Enter') teleport()
}
</script>

<template>
	<FloaterWindow
		id="map"
		title="🗺 Map / Teleport"
		:wrap-style="{ width: '58vw', height: '65vh', resize: 'both' }"
		:default-pos="{ left: '50%', top: '53%', transform: 'translate(-50%, -50%)' }"
		@close="ui.toggleMap()"
	>
		<div class="p-3 flex flex-col gap-2 flex-1 overflow-hidden">
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
				>Go</button>
			</div>
			<p v-if="status" class="text-yellow-400 text-xs">{{ status }}</p>
			<div class="border-t border-brd mt-1 pt-2">
				<p class="text-tm text-xs italic">Full world map coming in Phase 2. For now, type any region name to teleport.</p>
			</div>
		</div>
	</FloaterWindow>
</template>
