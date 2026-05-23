<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'

const world  = useWorldStore()
const SIZE   = 128   // viewBox coordinate space
const REGION = 256   // SL region = 256×256 m

const dots = computed(() =>
	world.avatars.map(av => ({
		id: av.localId,
		x:  av.pos ? (av.pos[0] / REGION) * SIZE : SIZE / 2,
		y:  av.pos ? SIZE - (av.pos[1] / REGION) * SIZE : SIZE / 2,
	}))
)

// TODO: draggable + persist position — use indexedDB (too many floaters for localStorage)
// See docs/tech-debt.md
</script>

<template>
	<!-- Default: ~20% from right edge, 0.75% from top. Eventually draggable + persisted. -->
	<div
		class="absolute bg-black/60 rounded overflow-hidden"
		style="width: clamp(8rem, 10vw, 20rem); aspect-ratio: 1/1; right: 20%; top: 0.75%;"
	>
		<svg
			class="w-full h-full"
			:viewBox="`0 0 ${SIZE} ${SIZE}`"
			preserveAspectRatio="xMidYMid meet"
		>
			<rect width="100%" height="100%" fill="transparent" />
			<!-- Cross-hairs -->
			<line :x1="SIZE/2" y1="0"      :x2="SIZE/2" :y2="SIZE"   stroke="#ffffff18" stroke-width="1"/>
			<line x1="0"       :y1="SIZE/2" :x2="SIZE"   :y2="SIZE/2" stroke="#ffffff18" stroke-width="1"/>
			<!-- Avatar dots -->
			<circle v-for="d in dots" :key="d.id" :cx="d.x" :cy="d.y" r="3" fill="#00b4d8" />
		</svg>
	</div>
</template>
