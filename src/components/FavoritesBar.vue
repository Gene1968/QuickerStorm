<script setup>
// FavoritesBar — quick-teleport chips for inventory Favorites folder landmarks. Sits just under
// the menu/location row, left-aligned. Click a chip → teleport to that landmark. Hidden when none.
import { usePlaces } from '@/composables/usePlaces'

const { invFavorites, teleportToLandmark } = usePlaces()
</script>

<template>
	<div
		v-if="invFavorites.length"
		class="absolute top-8 left-0 z-[1] flex shrink-0 items-center gap-1 p-1 overflow-x-auto"
	>
		<button
			v-for="lm in invFavorites"
			:key="`favbar-${lm.itemId}`"
			class="shrink-0 max-w-[7rem] truncate rounded bg-black/30 hover:bg-black/80 text-white text-2xs leading-none px-1.5 py-1 transition-colors"
			:title="`Teleport to ${lm.name}`"
			@click="teleportToLandmark(lm)"
		>{{ lm.name }}</button>
	</div>
</template>
