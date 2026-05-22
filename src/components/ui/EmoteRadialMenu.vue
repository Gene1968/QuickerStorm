<script setup>
/**
 * EmoteRadialMenu — radial pie menu for emote selection.
 *
 * Listens for `ava-emote-menu-open` (engine fires after E held >= 250ms)
 * and `ava-emote-menu-close` (E released). While open, the wedge under the
 * mouse is highlighted; on close that wedge's emote fires via the engine.
 * Also clickable for touch / mouse-only users.
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useOfficeStore } from '@/stores/officeStore.js'

const officeStore = useOfficeStore()

const visible = ref(false)
const center  = ref({ x: 0, y: 0 })
const cursor  = ref({ x: 0, y: 0 })

const EMOTES = [
	{ key: 'wave',   label: 'Wave',   icon: '👋', hotkey: '1' },
	{ key: 'clap',   label: 'Clap',   icon: '👏', hotkey: '2' },
	{ key: 'dance',  label: 'Dance',  icon: '💃', hotkey: '3' },
	{ key: 'point',  label: 'Point',  icon: '👉', hotkey: '4' },
]

const RADIUS_OUTER = 110
const RADIUS_INNER = 38
const DEAD_ZONE    = 28 // px from center: no selection (release with no emote)

const slotAngles = computed(() => {
	const n = EMOTES.length
	const start = -Math.PI / 2 // top
	return EMOTES.map((_, i) => start + (i / n) * Math.PI * 2)
})

const highlightedIdx = computed(() => {
	if (!visible.value) return -1
	const dx = cursor.value.x - center.value.x
	const dy = cursor.value.y - center.value.y
	const dist = Math.hypot(dx, dy)
	if (dist < DEAD_ZONE) return -1
	const ang = Math.atan2(dy, dx)
	const n = EMOTES.length
	let best = 0, bestDelta = Infinity
	for (let i = 0; i < n; i++) {
		// Shortest unsigned angular distance between ang and the slot angle.
		let d = Math.abs(ang - slotAngles.value[i]) % (Math.PI * 2)
		if (d > Math.PI) d = Math.PI * 2 - d
		if (d < bestDelta) { bestDelta = d; best = i }
	}
	return best
})

function onOpen() {
	center.value = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
	cursor.value = { ...center.value }
	visible.value = true
}

function onClose() {
	if (!visible.value) return
	visible.value = false
	const idx = highlightedIdx.value
	if (idx >= 0) {
		const engine = officeStore.engineRef
		engine?.triggerEmote?.(EMOTES[idx].key)
	}
}

function onMouseMove(e) {
	if (!visible.value) return
	cursor.value = { x: e.clientX, y: e.clientY }
}

function onWedgeClick(idx) {
	const engine = officeStore.engineRef
	engine?.triggerEmote?.(EMOTES[idx].key)
	visible.value = false
	window.dispatchEvent(new CustomEvent('ava-emote-menu-close'))
}

function wedgeStyle(idx) {
	const ang = slotAngles.value[idx]
	const r = (RADIUS_OUTER + RADIUS_INNER) / 2
	const x = Math.cos(ang) * r
	const y = Math.sin(ang) * r
	return { transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }
}

onMounted(() => {
	window.addEventListener('ava-emote-menu-open',  onOpen)
	window.addEventListener('ava-emote-menu-close', onClose)
	window.addEventListener('mousemove', onMouseMove)
})
onUnmounted(() => {
	window.removeEventListener('ava-emote-menu-open',  onOpen)
	window.removeEventListener('ava-emote-menu-close', onClose)
	window.removeEventListener('mousemove', onMouseMove)
})
</script>

<template>
	<Teleport to="body">
		<Transition name="emote-menu">
			<div
				v-if="visible"
				class="emote-menu fixed inset-0 z-[400] pointer-events-none"
			>
				<div
					class="emote-menu-anchor absolute"
					:style="{ left: center.x + 'px', top: center.y + 'px' }"
				>
					<!-- Center hint -->
					<div class="emote-menu-center">
						<span class="text-[0.6875rem] text-tm">Release to fire</span>
					</div>

					<!-- Wedges -->
					<button
						v-for="(em, idx) in EMOTES"
						:key="em.key"
						class="emote-wedge"
						:class="{ 'emote-wedge--hot': highlightedIdx === idx }"
						:style="wedgeStyle(idx)"
						@click="onWedgeClick(idx)"
					>
						<span class="text-2xl leading-none">{{ em.icon }}</span>
						<span class="text-[0.6875rem] text-t1 mt-0.5">{{ em.label }}</span>
						<span class="text-[0.5625rem] text-tm">{{ em.hotkey }}</span>
					</button>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.emote-menu-anchor {
	transform: translate(-50%, -50%);
	width: 0;
	height: 0;
}

.emote-menu-center {
	position: absolute;
	left: 0; top: 0;
	transform: translate(-50%, -50%);
	width: 4.75rem;
	height: 4.75rem;
	border-radius: 50%;
	background: rgba(20, 24, 32, 0.78);
	border: 1px solid rgba(255, 255, 255, 0.12);
	display: flex;
	align-items: center;
	justify-content: center;
	text-align: center;
	padding: 0 0.5rem;
	backdrop-filter: blur(6px);
}

.emote-wedge {
	position: absolute;
	left: 0; top: 0;
	width: 4.5rem;
	height: 4.5rem;
	border-radius: 50%;
	background: rgba(20, 24, 32, 0.82);
	border: 1px solid rgba(255, 255, 255, 0.14);
	color: var(--color-t1);
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	pointer-events: auto;
	transition: transform 0.12s ease, background 0.12s, border-color 0.12s, box-shadow 0.12s;
	backdrop-filter: blur(6px);
}

.emote-wedge--hot {
	background: rgba(0, 200, 140, 0.22);
	border-color: rgba(0, 200, 140, 0.7);
	box-shadow: 0 0 0 4px rgba(0, 200, 140, 0.18), 0 8px 24px rgba(0, 0, 0, 0.55);
}

.emote-menu-enter-active, .emote-menu-leave-active {
	transition: opacity 0.12s ease;
}
.emote-menu-enter-from, .emote-menu-leave-to { opacity: 0; }

:global(html.light) .emote-menu-center,
:global(html.light) .emote-wedge {
	background: rgba(255, 255, 255, 0.92);
	border-color: rgba(0, 0, 0, 0.08);
}
:global(html.light) .emote-wedge--hot {
	background: rgba(0, 180, 130, 0.18);
	border-color: rgba(0, 180, 130, 0.7);
}
</style>
