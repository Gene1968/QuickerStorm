<script setup>
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
defineProps({
	ticketNumber: { type: Number, required: true },
	nowServing:   { type: Number, required: true },
})
defineEmits(['close'])
</script>

<template>
	<Teleport to="body">
		<div class="tk-overlay" @click.self="$emit('close')">
			<div class="tk-panel">
				<div class="tk-header">
					<span class="tk-icon">🎟️</span>
					<span class="tk-title">Your Ticket</span>
					<button class="tk-close" @click="$emit('close')" aria-label="Close">✕</button>
				</div>

				<div class="tk-body">
					<div class="tk-sub">You are number</div>
					<div class="tk-number">{{ String(ticketNumber).padStart(3, '0') }}</div>

					<div class="tk-status">
						<div><b>Now serving:</b> {{ String(nowServing).padStart(3, '0') }}</div>
						<div class="tk-wait">Only {{ ticketNumber - nowServing }} people ahead of you 😬</div>
					</div>

					<div class="tk-hint">Tear along the perforation. Keep this stub.</div>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.tk-overlay {
	position: fixed; inset: 0;
	background: rgba(0, 0, 0, 0.75);
	display: flex; align-items: center; justify-content: center;
	z-index: 700;
	backdrop-filter: blur(4px);
}
.tk-panel {
	width: min(22rem, 94vw);
	background: #fff8d0;
	color: #202028;
	border-radius: 0.6rem;
	box-shadow: 0 20px 70px rgba(0, 0, 0, 0.6);
	overflow: hidden;
	border: 2px dashed #c8202a;
	position: relative;
}
.tk-panel::before {
	content: '';
	position: absolute; left: 0; right: 0; top: 3.1rem;
	border-top: 1.5px dashed #c8202a;
	opacity: 0.6;
}
.tk-header {
	display: flex; align-items: center; gap: 0.5rem;
	padding: 0.7rem 0.9rem;
	background: #c8202a;
	color: #fff8d0;
}
.tk-icon { font-size: 1.1rem; }
.tk-title { font-weight: 800; letter-spacing: 0.5px; flex: 1; font-size: 0.95rem; }
.tk-close {
	background: none; border: none; color: #fff8d0;
	cursor: pointer; font-size: 1rem; padding: 0.2rem 0.4rem;
	border-radius: 0.25rem;
}
.tk-close:hover { background: rgba(255,255,255,0.15); }

.tk-body {
	padding: 1.3rem 1rem 1.1rem;
	text-align: center;
}
.tk-sub {
	font-size: 0.8rem;
	color: #7a2020;
	font-weight: 600;
	letter-spacing: 3px;
	text-transform: uppercase;
	margin-top: 0.3rem;
}
.tk-number {
	font-family: 'Courier New', monospace;
	font-size: 5rem;
	font-weight: 900;
	color: #c8202a;
	line-height: 1;
	margin: 0.4rem 0 0.8rem;
	text-shadow: 2px 2px 0 rgba(0,0,0,0.08);
}
.tk-status {
	background: rgba(200, 32, 42, 0.08);
	border-radius: 0.4rem;
	padding: 0.6rem;
	font-size: 0.85rem;
	line-height: 1.5;
}
.tk-wait {
	margin-top: 0.25rem;
	font-style: italic;
	color: #7a2020;
}
.tk-hint {
	margin-top: 0.8rem;
	font-size: 0.72rem;
	color: #7a6030;
	font-style: italic;
}
</style>
