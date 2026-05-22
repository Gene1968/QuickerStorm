<script setup>
import { onMounted, onUnmounted } from 'vue'
import { X as XMarkIcon } from '@lucide/vue'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const emit = defineEmits(['close'])

function onEscCapture (e) {
	if (e.key !== 'Escape') return
	e.preventDefault()
	e.stopPropagation()
	emit('close')
}
onMounted(() => document.addEventListener('keydown', onEscCapture, true))
onUnmounted(() => document.removeEventListener('keydown', onEscCapture, true))
</script>

<template>
	<div class="wn-backdrop" @click.self="$emit('close')">
		<div class="wn-panel" role="dialog" aria-modal="true" aria-labelledby="wn-title">
			<div class="wn-header">
				<span id="wn-title" class="wn-title">What's New</span>
				<button type="button" class="wn-close" @click="$emit('close')" aria-label="Close">
					<XMarkIcon style="width:1rem;height:1rem" />
				</button>
			</div>
			<div class="wn-body">
				<dl class="wn-changelog">
					<!-- Newest first -->
					<dt>2026-05-22</dt>
					<dd>Initial shell for QuickerStorm</dd>
				</dl>
			</div>
		</div>
	</div>
</template>

<style scoped>
.wn-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(4, 10, 20, 0.6);
	backdrop-filter: blur(4px);
	z-index: 600;
	display: flex;
	align-items: center;
	justify-content: center;
}

.wn-panel {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	width: clamp(18rem, 90vw, 26rem);
	max-height: min(32rem, 85vh);
	box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.wn-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.875rem 1rem 0.75rem;
	border-bottom: 1px solid var(--color-brd);
	flex-shrink: 0;
}

.wn-title {
	font-size: 0.9375rem;
	font-weight: 700;
	color: var(--color-t1);
	letter-spacing: 0.01em;
}

.wn-close {
	background: none;
	border: none;
	cursor: pointer;
	color: var(--color-tm);
	display: flex;
	align-items: center;
	padding: 0.25rem;
	border-radius: 0.25rem;
	transition: color 0.15s;
}

.wn-close:hover {
	color: var(--color-t1);
}

.wn-body {
	padding: 0.75rem 1rem 1rem;
	overflow-y: auto;
	flex: 1;
	min-height: 0;
}

.wn-changelog {
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 0;
}

.wn-changelog dt {
	font-size: 0.75rem;
	font-weight: 700;
	color: var(--color-accent, var(--color-t1));
	letter-spacing: 0.02em;
	margin: 0;
	padding-top: 0.75rem;
}

.wn-changelog dt:first-child {
	padding-top: 0;
}

.wn-changelog dd {
	margin: 0;
	padding: 0.25rem 0 0.5rem;
	font-size: 0.8125rem;
	color: var(--color-t2);
	line-height: 1.5;
	border-bottom: 1px solid var(--color-brd);
}

.wn-changelog dd:last-of-type {
	border-bottom: none;
	padding-bottom: 0;
}

.wn-list {
	margin: 0;
	padding-left: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.wn-list li {
	margin: 0;
	padding-left: 0.125rem;
}

.wn-list li strong {
	color: var(--color-t1);
	font-weight: 600;
}
</style>
