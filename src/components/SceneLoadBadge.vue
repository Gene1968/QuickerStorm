<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { loadBadgeView } from '@/lib/loadBadge.js'
const world = useWorldStore()
// Region-entry phase: no objects have arrived yet (live worldStore count, not the throttled cullStats).
// During the caps-handshake + first-data gap the % badge has nothing real to show, so a blank scene
// reads as a stall — loadBadgeView surfaces "Entering region…"/"Loading terrain…" instead.
const entering = computed(() => world.objects.size === 0)
// All show/label/title logic lives in the pure loadBadgeView helper (priority: entry → geometry % →
// object/mesh/sculpt downloads → textures → hidden), so the multi-pipeline priority is unit-tested and
// the badge never reads "done" while any pipeline still has pending work.
const view = computed(() => loadBadgeView(world.cullStats, entering.value, world.terrainPatchCount))
const show = computed(() => view.value.show)
const label = computed(() => view.value.label)
const title = computed(() => view.value.title)
</script>

<template>
	<div
		v-if="show"
		class="absolute top-14 right-2 z-20 -mt-1.5 py-1 px-3 max-w-[12.5rem] rounded-sm bg-black/60 text-2xs font-mono text-orange-300 pointer-events-none select-none"
		:title="title"
	>
		{{ label }}
	</div>
</template>
