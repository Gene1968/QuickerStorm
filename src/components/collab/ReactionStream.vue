<script setup>
/**
 * ReactionStream — Floating layer that renders incoming emoji reactions.
 * Each reaction bubble drifts upward and fades out over ~2s.
 *
 * Position: bubbles emerge from the bottom-center, with a horizontal
 * jitter to avoid stacking. Sender's name (if known) shown beneath emoji.
 */
import { computed } from 'vue'
import { useReactions } from '@/composables/useReactions.js'
import { usePresenceStore } from '@/stores/presenceStore.js'

const { reactions } = useReactions()
const presenceStore = usePresenceStore()

const bubbles = computed(() => reactions.value.map(r => ({
	...r,
	name: nameFor(r.fromUserId),
	jitter: jitterFor(r.id),
})))

function nameFor(userId) {
	if (!userId) return ''
	const u = presenceStore.users.find(x => x.id === userId || x.authUserId === userId)
	return u?.name || u?.email?.split('@')[0] || ''
}

// Stable horizontal jitter per bubble id (deterministic so SSR/HMR don't reshuffle)
function jitterFor(id) {
	const hash = (id * 9301 + 49297) % 233280
	return (hash / 233280 - 0.5) * 280  // -140px .. +140px
}
</script>

<template>
	<div class="reaction-stream" aria-hidden="true">
		<div
			v-for="b in bubbles"
			:key="b.id"
			class="rx-bubble"
			:style="{ '--jitter': `${b.jitter}px` }"
		>
			<span class="rx-emoji">{{ b.emoji }}</span>
			<span v-if="b.name" class="rx-name">{{ b.name }}</span>
		</div>
	</div>
</template>

<style scoped>
.reaction-stream {
	position: fixed;
	left: 50%;
	bottom: calc(3.25rem + 60px);
	width: 1px;  /* anchor only — children position via transform */
	height: 1px;
	pointer-events: none;
	z-index: 50;
}

.rx-bubble {
	position: absolute;
	left: 0;
	bottom: 0;
	transform: translate(calc(-50% + var(--jitter, 0px)), 0);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	animation: rx-float 2.4s ease-out forwards;
	will-change: transform, opacity;
}

.rx-emoji {
	font-size: 36px;
	line-height: 1;
	filter: drop-shadow(0 2px 6px rgba(15, 23, 42, 0.35));
	user-select: none;
}

.rx-name {
	font-size: 11px;
	font-weight: 500;
	color: #f8fafc;
	background: rgba(15, 23, 42, 0.7);
	padding: 2px 8px;
	border-radius: 10px;
	white-space: nowrap;
	user-select: none;
}

@keyframes rx-float {
	0%   { transform: translate(calc(-50% + var(--jitter, 0px)), 20px) scale(0.5); opacity: 0; }
	15%  { transform: translate(calc(-50% + var(--jitter, 0px)), 0px) scale(1.1); opacity: 1; }
	30%  { transform: translate(calc(-50% + var(--jitter, 0px)), -30px) scale(1); opacity: 1; }
	100% { transform: translate(calc(-50% + var(--jitter, 0px)), -180px) scale(0.85); opacity: 0; }
}
</style>
