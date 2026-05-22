<script setup>
/**
 * ConfirmModal — styled replacement for window.confirm().
 * Driven by the reactive confirmState from useConfirm.js.
 */
import { confirmState, resolveConfirm } from '@/composables/useConfirm.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

function onConfirm() { resolveConfirm(true) }
function onCancel()  { resolveConfirm(false) }
</script>

<template>
	<Teleport to="body">
		<Transition name="cm-fade">
			<div v-if="confirmState" class="cm-overlay" @click.self="onCancel">
				<div class="cm-dialog">
					<h3 class="cm-title">{{ confirmState.title }}</h3>
					<p class="cm-message">{{ confirmState.message }}</p>
					<div class="cm-actions">
						<button class="cm-btn cm-btn--primary" @click="onConfirm">
							{{ confirmState.confirmLabel }}
						</button>
						<button class="cm-btn cm-btn--secondary" @click="onCancel">
							{{ confirmState.cancelLabel }}
						</button>
					</div>
				</div>
			</div>
		</Transition>
	</Teleport>
</template>

<style scoped>
.cm-overlay {
	position: fixed;
	inset: 0;
	z-index: 850;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.5);
	backdrop-filter: blur(3px);
}

.cm-dialog {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.875rem;
	padding: 1.5rem 2rem;
	text-align: center;
	max-width: 24rem;
	min-width: 16rem;
	box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5);
}

.cm-title {
	font-size: 1rem;
	font-weight: 700;
	color: var(--color-t1);
	margin: 0 0 0.5rem;
}

.cm-message {
	font-size: 0.8125rem;
	color: var(--color-t2);
	margin: 0 0 1.25rem;
	line-height: 1.55;
	white-space: pre-line;
}

.cm-actions {
	display: flex;
	gap: 0.625rem;
	justify-content: center;
}

.cm-btn {
	border: none;
	border-radius: 0.5rem;
	font-size: 0.8125rem;
	font-weight: 600;
	padding: 0.4375rem 1.125rem;
	cursor: pointer;
	transition: opacity 0.15s, transform 0.1s;
}
.cm-btn:active { transform: scale(0.96); }

.cm-btn--primary {
	background: var(--color-accent);
	color: #fff;
}
.cm-btn--primary:hover { opacity: 0.85; }

.cm-btn--secondary {
	background: var(--color-card2);
	color: var(--color-t2);
	border: 1px solid var(--color-brd2);
}
.cm-btn--secondary:hover { background: rgba(255, 255, 255, 0.06); }

/* Transition */
.cm-fade-enter-active, .cm-fade-leave-active { transition: opacity 0.15s; }
.cm-fade-enter-from, .cm-fade-leave-to { opacity: 0; }
</style>
