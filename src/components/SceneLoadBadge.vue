<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
// Show only while the scene is still streaming in (and there is something to load).
const show = computed(() => world.cullStats.known > 0 && world.cullStats.pct < 100)
</script>

<template>
	<div
		v-if="show"
		class="absolute top-14 right-2 z-20 -mt-2 px-2 py-1 rounded bg-black/60 text-2xs font-mono text-orange-300 pointer-events-none select-none"
		:title="`Resident ${world.cullStats.resident} / known ${world.cullStats.known} · evicted ${world.cullStats.evicted} for memory`"
	>
		nearby scene {{ world.cullStats.pct }}% loaded
	</div>
</template>
