<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { useAudio } from '@/composables/useAudio.js'

const world = useWorldStore()
const { playSound } = useAudio()

onMounted(()   => playSound('pop.mp3', 0.7))
onUnmounted(() => playSound('pop.mp3', 0.7))
</script>

<template>
	<!-- Positioned as absolute overlay on the right side of the canvas area -->
	<div class="absolute right-0 top-32 flex flex-col border-l border-white/10 bg-black/60 pt-3 w-56 h-84 backdrop-blur-xs overflow-y-auto">
		<p class="shrink-0 border-b border-white/10 py-1.5 px-3 text-fg/50 text-xs uppercase tracking-widest">
			Nearby · {{ world.avatars.length }}
		</p>
		<ul class="flex-1 overflow-y-auto">
			<li
				v-for="av in world.avatars"
				:key="av.localId"
				class="py-1 px-2 text-xs text-fg/80 truncate hover:bg-white/10 cursor-default"
				:title="av.name || av.fullId"
			>
				<span class="inline-block rounded-full bg-accent -mt-1 me-1 w-1.5 h-1.5 align-middle" />
				{{ av.name || av.fullId?.slice(0, 8) || 'Avatar' }}
			</li>
		</ul>
		<div v-if="!world.avatars.length" class="py-2 px-3 text-fg/30 text-xs italic">
			No avatars nearby.
		</div>
	</div>
</template>
