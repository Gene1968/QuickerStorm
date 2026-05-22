<script setup>
import { resumeSession } from '@/composables/usePresence.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
</script>

<template>
	<Teleport to="body">
		<div class="ap-overlay">
			<div class="ap-panel">
				<div class="ap-icon">⏸</div>
				<p class="ap-body">
					After 2 hours of inactivity, your avatar is showing as offline
					and activity has been paused. You can rejoin if you like.
				</p>
				<button class="ap-return" @click="resumeSession">
					Return to quickerSTORM
				</button>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.ap-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.88);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 998;
	backdrop-filter: blur(6px);
}

.ap-panel {
	width: min(24rem, 92vw);
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 1rem;
	box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
	padding: 2rem 1.75rem 1.75rem;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.875rem;
	text-align: center;
}

.ap-icon { font-size: 2.25rem; line-height: 1; }

.ap-body {
	font-size: 0.875rem;
	color: var(--color-t2);
	line-height: 1.6;
	margin: 0;
}

.ap-return {
	margin-top: 0.25rem;
	width: 100%;
	background: var(--color-accent);
	border: none;
	border-radius: 0.5rem;
	color: #fff;
	font-size: 0.9375rem;
	font-weight: 600;
	padding: 0.6875rem 1.5rem;
	cursor: pointer;
	transition: background 0.15s;
}

.ap-return:hover { background: var(--color-accent2); }
</style>
