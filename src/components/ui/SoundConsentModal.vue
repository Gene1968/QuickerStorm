<script setup>
import { applyAudioConsent } from '@/composables/useAudio.js'

const emit = defineEmits(['done'])

function choose(wantSound) {
	applyAudioConsent(wantSound)
	emit('done')
}
</script>

<template>
	<div class="consent-backdrop">
		<div class="consent-modal" role="dialog" aria-modal="true" aria-label="Sound settings">
			<div class="consent-icon">🔊</div>
			<h2 class="consent-title">This could get slightly noisy</h2>
			<p class="consent-body">QuickerStorm plays sounds and supports proximity voice chat with your coworkers. You can mute or unmute at any time from the bottom voice/sound bar.</p>
			<div class="consent-actions">
				<button class="consent-btn consent-btn--primary" @click="choose(true)">
					📢 Bring on the noise
				</button>
				<button class="consent-btn consent-btn--ghost" @click="choose(false)">
					🔇 Mute this for now
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.consent-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(4, 8, 14, 0.75);
	backdrop-filter: blur(6px);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 600;
}

.consent-modal {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 1.25rem;
	box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.7);
	padding: 2rem 1.5rem 1.5rem;
	max-width: 22rem;
	width: 90%;
	text-align: center;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.75rem;
}

.consent-icon {
	font-size: 2.5rem;
	line-height: 1;
}

.consent-title {
	margin: 0;
	font-size: 1.125rem;
	font-weight: 700;
	color: var(--color-t1);
}

.consent-body {
	margin: 0;
	font-size: 0.8125rem;
	color: var(--color-t2);
	line-height: 1.5;
}

.consent-actions {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	width: 100%;
	margin-top: 0.5rem;
}

.consent-btn {
	width: 100%;
	padding: 0.625rem 1rem;
	border-radius: 0.625rem;
	font-size: 0.875rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.consent-btn--primary {
	background: var(--color-accent);
	color: #fff;
	border: 1px solid var(--color-accent);
}
.consent-btn--primary:hover {
	background: var(--color-accent2, var(--color-accent));
	filter: brightness(1.1);
}

.consent-btn--ghost {
	background: transparent;
	color: var(--color-tm);
	border: 1px solid var(--color-brd);
}
.consent-btn--ghost:hover {
	color: var(--color-t2);
	border-color: var(--color-brd2);
}
</style>
