<script setup>
import { useUiStore }  from '@/stores/uiStore'
import FloaterWindow   from '@/components/FloaterWindow.vue'

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
	</FloaterWindow>
</template>
