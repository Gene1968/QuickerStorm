<script setup>
import { reclaimSession } from '@/composables/usePresence.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
</script>

<template>
	<Teleport to="body">
		<div class="sd-overlay">
			<div class="sd-panel">
				<div class="sd-icon">📱</div>
				<h2 class="sd-title">Signed in on another device</h2>
				<p class="sd-body">
					Your account became active on a different device or tab,
					so this one has been paused. You can close this tab,
					or take back control here.
				</p>
				<button class="sd-reclaim" @click="reclaimSession">
					Make this the active device
				</button>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.sd-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.88);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 975;
	backdrop-filter: blur(6px);
}

.sd-panel {
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

.sd-icon  { font-size: 2.25rem; line-height: 1; }

.sd-title {
	font-size: 1.0625rem;
	font-weight: 700;
	color: var(--color-t1);
	margin: 0;
}

.sd-body {
	font-size: 0.875rem;
	color: var(--color-t2);
	line-height: 1.6;
	margin: 0;
}

.sd-reclaim {
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

.sd-reclaim:hover { background: var(--color-accent2); }
</style>
