<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
// Show only while the scene is still streaming in (and there is something to load).
const show = computed(() => world.cullStats.known > 0 && world.cullStats.pct < 100)
// "nearby scene …" while the draw distance is below the target (a subset — more comes as it grows
// or as memory frees); "complete scene …" once we're loading out to the full target radius. A
// "Major new scenery to cache" preface on very large scenes so a slow first load reads as expected.
const label = computed(() => {
	const cs = world.cullStats
	const phase = cs.atTarget ? 'Complete scene' : 'Nearby scene'
	const preface = cs.massive ? 'Major new scenery to cache: ' : ''
	return `${preface}${phase} ${cs.pct}% loaded`
})
const title = computed(() => {
	const cs = world.cullStats
	return `Resident ${cs.resident} / known ${cs.known} within ${cs.effNear}m draw distance · evicted ${cs.evicted} for memory`
})
</script>

<template>
	<div
		v-if="show"
		class="absolute top-14 right-2 z-20 -mt-1 py-1 px-3 max-w-[11.1rem] rounded-sm bg-black/60 text-2xs font-mono text-orange-300 pointer-events-none select-none"
		:title="title"
	>
		{{ label }}
	</div>
</template>
