<script setup>
import { useUiStore } from '@/stores/uiStore'
const ui = useUiStore()
</script>

<template>
	<div class="absolute bg-card border border-brd rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden"
		style="left: 0.125%; bottom: 0.25%; width: 15vw; height: 40vh; resize: both;">
		<!-- Header -->
		<div class="flex items-center px-3 py-2 bg-card2 border-b border-brd">
			<span class="text-t1 text-sm font-medium flex-1">📦 Inventory</span>
			<button class="text-tm hover:text-t1 text-lg leading-none" title="Close" @click="ui.toggleInventory()">×</button>
		</div>

		<!-- Body -->
		<div class="p-4 text-center text-tm text-sm italic">
			<p class="mb-1">📦</p>
			<p>Inventory viewer coming in Phase 2.</p>
			<p class="text-xs mt-2 text-tm opacity-60">Full in-world inventory browsing, attachment, and wearables.</p>
		</div>
	</div>
</template>
