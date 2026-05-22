<script setup>
/**
 * BreakRoomTV — floating YouTube overlay shown only while in the break room.
 * The iframe autoplay requires mute=1 (browser autoplay policy).
 * Play/pause is driven via YouTube IFrame postMessage API (enablejsapi=1).
 * <iframe width="560" height="315" src="https://www.youtube.com/embed/DYY4nnfxKbU?si=Cyw4rNGBPx_EqDQL" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
 */
import { ref, watch } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'

const officeStore = useOfficeStore()
const iframeRef   = ref(null)
const playing     = ref(true)

const BASE_SRC =
	'https://www.youtube.com/embed/DYY4nnfxKbU' +
	'?si=Cyw4rNGBPx_EqDQL&autoplay=1&mute=1&enablejsapi=1&loop=1&playlist=DYY4nnfxKbU'

const muted = ref(true)   // starts muted per autoplay policy

function ytCmd(func) {
	iframeRef.value?.contentWindow?.postMessage(
		JSON.stringify({ event: 'command', func, args: '' }),
		'*',
	)
}

function togglePlay() {
	playing.value = !playing.value
	ytCmd(playing.value ? 'playVideo' : 'pauseVideo')
}

function toggleMute() {
	muted.value = !muted.value
	ytCmd(muted.value ? 'mute' : 'unMute')
}

// Reset to playing state when re-entering the room (iframe re-mounts with autoplay)
watch(
	() => officeStore.currentRoomId,
	(id) => { if (id === 'break-room') playing.value = true },
)
</script>

<template>
	<Transition name="tv-fade">
		<div v-if="officeStore.currentRoomId === 'break-room'" class="br-tv">
			<iframe
				ref="iframeRef"
				:src="BASE_SRC"
				class="br-tv-frame"
				allow="autoplay; encrypted-media"
				allowfullscreen
				frameborder="0"
				title="Break Room TV"
			/>
			<div class="br-tv-bar">
				<span class="br-tv-label">📺 Break Room TV</span>
				<div class="br-tv-controls">
					<button class="br-tv-btn" :title="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
						{{ muted ? '🔇' : '🔊' }}
					</button>
					<button class="br-tv-btn" :title="playing ? 'Pause' : 'Play'" @click="togglePlay">
						{{ playing ? '⏸' : '▶' }}
					</button>
				</div>
			</div>
		</div>
	</Transition>
</template>

<style scoped>
.br-tv {
	position: absolute;
	bottom: 4.5rem;
	right: 1rem;
	width: 26rem;
	border-radius: 0.5rem;
	overflow: hidden;
	box-shadow: 0 0 0 2px #111, 0 0 18px rgba(0, 140, 200, 0.35);
	background: #000;
	z-index: 20;
	display: flex;
	flex-direction: column;
	user-select: none;
}

.br-tv-frame {
	width: 100%;
	aspect-ratio: 16 / 9;
	display: block;
	border: none;
	pointer-events: all;
}

.br-tv-bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: #0a0f18;
	padding: 0.3rem 0.625rem;
	gap: 0.5rem;
}

.br-tv-label {
	font-size: 0.6875rem;
	color: #7a9ab8;
	user-select: none;
}

.br-tv-controls {
	display: flex;
	align-items: center;
	gap: 0.25rem;
}

.br-tv-btn {
	background: none;
	border: none;
	cursor: pointer;
	font-size: 1rem;
	color: #c8dff0;
	padding: 0 0.125rem;
	line-height: 1;
	transition: color 0.12s;
}
.br-tv-btn:hover { color: #fff; }

/* Transition */
.tv-fade-enter-active,
.tv-fade-leave-active { transition: opacity 0.3s, transform 0.3s; }
.tv-fade-enter-from,
.tv-fade-leave-to   { opacity: 0; transform: translateY(0.5rem); }
</style>
