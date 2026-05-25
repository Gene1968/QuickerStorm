<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { useAudio } from '@/composables/useAudio.js'

const world = useWorldStore()
const { playSound } = useAudio()

onMounted(()   => playSound('pop.mp3'))
onUnmounted(() => playSound('pop.mp3'))
</script>

<template>
	<!-- Positioned as absolute overlay on the right side of the canvas area -->
	<div class="absolute right-0 top-0 h-full w-64 bg-black/60 backdrop-blur-sm border-l border-white/10 overflow-y-auto flex flex-col">
		<p class="text-white/50 text-xs px-3 py-1.5 uppercase tracking-widest border-b border-white/10 shrink-0">
			Nearby · {{ world.avatars.length }}
		</p>
		<ul class="flex-1 overflow-y-auto">
			<li
				v-for="av in world.avatars"
				:key="av.localId"
				class="px-3 py-1.5 text-sm text-white/80 truncate hover:bg-white/10 cursor-default"
				:title="av.name || av.fullId"
			>
				<span class="inline-block w-1.5 h-1.5 rounded-full bg-accent mr-1.5 align-middle" />
				{{ av.name || av.fullId?.slice(0, 8) || 'Avatar' }}
			</li>
		</ul>
		<div v-if="!world.avatars.length" class="px-3 py-2 text-white/30 text-xs italic">
			No avatars nearby.
		</div>
	</div>
</template>
