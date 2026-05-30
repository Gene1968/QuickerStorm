<script setup>
// FavoritesBar — quick-teleport chips for saved Places favorites. Sits just under the menu/
// location row, left-aligned. Click a chip → teleport to that favorite. Hidden when none saved.
import { usePlaces } from '@/composables/usePlaces'

const { favorites, teleportTo } = usePlaces()
</script>

<template>
	<div
		v-if="favorites.length"
		class="absolute top-8 left-0 z-[1] flex shrink-0 items-center gap-1 p-1 overflow-x-auto"
	>
		<button
			v-for="(p, i) in favorites"
			:key="`favbar-${i}`"
			class="shrink-0 max-w-[7rem] truncate rounded bg-black/30 hover:bg-black/80 text-white text-2xs leading-none px-1.5 py-1 transition-colors"
			:title="`Teleport to ${p.name} — ${p.regionName || '—'} (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`"
			@click="teleportTo(p)"
		>{{ p.name }}</button>
	</div>
</template>
