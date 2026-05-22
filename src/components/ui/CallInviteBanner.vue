<script setup>
import { watch } from 'vue'
import { useCallHere } from '@/composables/useCallHere.js'
import { useAudio } from '@/composables/useAudio.js'

const { activeInvite, acceptInvite, snoozeInvite, dismissInvite } = useCallHere()
const { playChime } = useAudio()

watch(activeInvite, (inv) => {
	if (inv) playChime()
})
</script>

<template>
	<Teleport to="body">
		<Transition name="ci-slide">
			<div v-if="activeInvite" class="call-invite-banner">
				<div class="d-flex align-items-center gap-1 mb-2">
					<span class="ci-icon">📞</span>
					<div class="ci-body">
						<span class="ci-name">{{ activeInvite.fromName }}</span>
						<span class="ci-msg"> is inviting you to </span>
						<span class="ci-room">{{ activeInvite.fromRoomName }}</span>
					</div>
				</div>
				<div class="d-flex justify-content-evenly">
					<button class="ci-btn ci-btn--accept" @click="acceptInvite">Join them</button>
					<button class="ci-btn ci-btn--snooze" @click="snoozeInvite">Snooze 5 min</button>
					<button class="ci-btn ci-btn--dismiss" @click="dismissInvite" title="Close / ignore">✕</button>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.call-invite-banner {
	position: fixed;
	top: 4rem;
	left: calc(50% + var(--canvas-left) / 2);
	transform: translateX(-50%);
	z-index: 860;
	padding: 0.625rem 0.875rem;
	background: linear-gradient(135deg, rgba(0,180,216,0.18), rgba(0,120,180,0.14));
	border: 1px solid rgba(0,180,216,0.45);
	border-radius: 0.75rem;
	box-shadow: 0 8px 32px rgba(0,0,0,0.5);
	backdrop-filter: blur(10px);
	min-width: 20rem;
	max-width: 32.5rem;
	white-space: nowrap;
}

.ci-icon {
	font-size: 1.25rem;
	flex-shrink: 0;
}

.ci-body {
	flex: 1;
	font-size: 0.8125rem;
	color: var(--color-t1);
	overflow: hidden;
	text-overflow: ellipsis;
}

.ci-name  { font-weight: 700; color: var(--color-accent); }
.ci-msg   { color: var(--color-t2); }
.ci-room  { font-weight: 600; color: var(--color-t1); }


.ci-btn {
	border: none;
	border-radius: 0.375rem;
	font-size: 0.75rem;
	font-weight: 600;
	cursor: pointer;
	padding: 0.3125rem 0.625rem;
	transition: opacity 0.15s, transform 0.1s;
	white-space: nowrap;
}
.ci-btn:active { transform: scale(0.95); }

.ci-btn--accept {
	background: var(--color-accent);
	color: #fff;
}
.ci-btn--accept:hover { opacity: 0.88; }

.ci-btn--snooze {
	background: rgba(255,255,255,0.08);
	color: var(--color-t2);
	border: 1px solid var(--color-brd);
}
.ci-btn--snooze:hover { background: rgba(255,255,255,0.14); color: var(--color-t1); }

.ci-btn--dismiss {
	background: none;
	color: var(--color-tm);
	padding: 0.3125rem 0.5rem;
}
.ci-btn--dismiss:hover { color: var(--color-t1); }

/* Slide in from top */
.ci-slide-enter-active { transition: opacity 0.18s, transform 0.18s; }
.ci-slide-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ci-slide-enter-from,
.ci-slide-leave-to    { opacity: 0; transform: translateX(-50%) translateY(-0.75rem); }

/* Light mode */
:global(html.light) .call-invite-banner {
	background: linear-gradient(135deg, rgba(0,120,200,0.1), rgba(0,80,160,0.07));
	border-color: rgba(0,100,200,0.35);
}
:global(html.light) .ci-btn--snooze {
	background: rgba(0,0,0,0.05);
}
</style>
