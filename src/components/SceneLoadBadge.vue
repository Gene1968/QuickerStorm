<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
// Show while geometry is still streaming in OR textures are still loading — geometry can hit 100%
// while textures stream (FEATURE-GAPS #4: the "100% but bare" blind spot), so the badge must stay up
// until the near set is actually textured, not just built.
const show = computed(() => {
	const cs = world.cullStats
	return cs.known > 0 && (cs.pct < 100 || (cs.texPending ?? 0) > 0)
})
// While geometry < 100%: "nearby scene …" until the draw distance reaches the target (a subset — more
// comes as it grows/frees), "complete scene …" at the full radius; a "Major new scenery to cache"
// preface on very large scenes. Once geometry is complete but textures are still arriving, switch to a
// texture-progress readout so a still-bare scene reads as "loading", not "done".
const label = computed(() => {
	const cs = world.cullStats
	if (cs.pct < 100) {
		const phase = cs.atTarget ? 'Overall scene' : 'Nearby scene'
		const preface = cs.massive ? 'Major new scenery to cache: ' : ''
		return `${preface}${phase} ${cs.pct}% loaded`
	}
	return `Textures loading… ${cs.texPending ?? 0} left`
})
const title = computed(() => {
	const cs = world.cullStats
	const base = `Resident ${cs.resident} / known ${cs.known} within ${cs.effNear}m draw distance · evicted ${cs.evicted} for memory`
	return (cs.texFailed ?? 0) > 0
		? `${base} · ${cs.texFailed} textures failed (right-click an object → Texture refresh)`
		: base
})
</script>

<template>
	<div
		v-if="show"
		class="absolute top-14 right-2 z-20 -mt-1.5 py-1 px-3 max-w-[9.2vw] rounded-sm bg-black/60 text-2xs font-mono text-orange-300 pointer-events-none select-none"
		:title="title"
	>
		{{ label }}
	</div>
</template>
