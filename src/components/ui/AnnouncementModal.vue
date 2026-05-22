<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { openModal, closeModal } from '@/composables/useModalStack.js'
import { sendAnnouncement } from '@/composables/useAnnouncements.js'

const emit = defineEmits(['close'])

const avatarStore = useAvatarStore()
onMounted(openModal)
onUnmounted(closeModal)

const ROOM_ID   = 'conference'
const ROOM_NAME = 'Conference Room'

const message = ref(`There's a meeting starting now in ${ROOM_NAME}`)
const sending = ref(false)
const error = ref('')

async function send() {
	if (sending.value) return
	sending.value = true
	error.value = ''
	try {
		await sendAnnouncement({
			roomId:   ROOM_ID,
			roomName: ROOM_NAME,
			sentBy:   avatarStore.displayName || 'Someone',
			message:  message.value.trim(),
		})
		emit('close')
	} catch (err) {
		error.value = err?.message || 'Failed to send announcement. Please try again.'
	} finally {
		sending.value = false
	}
}
</script>

<template>
	<div class="ann-modal-backdrop" @click.self="$emit('close')">
		<div class="ann-modal-card">
			<div class="ann-modal-header">
				<span class="ann-modal-title">📣 Meeting Announcement</span>
				<button class="ann-modal-x" @click="$emit('close')" title="Close">✕</button>
			</div>

			<div class="ann-modal-body">
				<p class="ann-modal-hint mb-n2 text-xs">Sends to all users currently online in QuickerStorm.</p>
				<p class="ann-modal-hint m-0 text-xs text-muted">To do: add option to Slack #general or offline invitees.</p>
				<textarea
					v-model="message"
					class="ann-modal-textarea"
					rows="3"
					placeholder="Type your announcement…"
					:disabled="sending"
				/>
				<p v-if="error" class="ann-modal-error">{{ error }}</p>
			</div>

			<div class="ann-modal-footer">
				<button class="ann-modal-cancel" @click="$emit('close')" :disabled="sending">Cancel</button>
				<button class="ann-modal-send" @click="send" :disabled="sending || !message.trim()">
					{{ sending ? 'Sending…' : 'Send' }}
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.ann-modal-backdrop {
	position: fixed;
	inset: 0;
	z-index: 900;
	background: rgba(0, 0, 0, 0.55);
	display: flex;
	align-items: center;
	justify-content: center;
	backdrop-filter: blur(3px);
}

.ann-modal-card {
	width: clamp(18rem, 90vw, 24rem);
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.875rem;
	box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.ann-modal-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.875rem 1rem;
	background: var(--color-card2);
	border-bottom: 1px solid var(--color-brd);
}

.ann-modal-title {
	font-size: clamp(0.875rem, 0.9vw, 1rem);
	font-weight: 700;
	color: var(--color-t1);
}

.ann-modal-x {
	background: none;
	border: none;
	color: var(--color-tm);
	font-size: 0.9375rem;
	cursor: pointer;
	padding: 0.25rem;
	line-height: 1;
	border-radius: 0.25rem;
	transition: color 0.12s;
}
.ann-modal-x:hover { color: var(--color-t1); }

.ann-modal-body {
	padding: 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.625rem;
}

.ann-modal-hint {
	color: var(--color-tm);
}


.ann-modal-textarea {
	width: 100%;
	box-sizing: border-box;
	background: var(--color-input, rgba(255, 255, 255, 0.05));
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem;
	color: var(--color-t1);
	font-size: clamp(0.8125rem, 0.85vw, 0.9375rem);
	line-height: 1.5;
	padding: 0.5rem 0.75rem;
	resize: vertical;
	font-family: inherit;
	transition: border-color 0.15s;
}
.ann-modal-textarea:focus {
	outline: none;
	border-color: var(--color-accent);
}
.ann-modal-textarea:disabled { opacity: 0.6; }

.ann-modal-error {
	font-size: 0.75rem;
	color: var(--color-red);
	margin: 0;
}

.ann-modal-footer {
	display: flex;
	justify-content: flex-end;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	border-top: 1px solid var(--color-brd);
}

.ann-modal-cancel,
.ann-modal-send {
	border-radius: 0.4rem;
	padding: 0.4375rem 1rem;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
	transition: opacity 0.15s, background 0.15s;
	border: none;
}
.ann-modal-cancel:disabled,
.ann-modal-send:disabled { opacity: 0.5; cursor: not-allowed; }

.ann-modal-cancel {
	background: rgba(255, 255, 255, 0.07);
	color: var(--color-t2);
	border: 1px solid var(--color-brd);
}
.ann-modal-cancel:not(:disabled):hover { background: rgba(255, 255, 255, 0.13); color: var(--color-t1); }

.ann-modal-send {
	background: var(--color-accent);
	color: #fff;
}
.ann-modal-send:not(:disabled):hover { opacity: 0.88; }

/* Light mode */
:global(html.light) .ann-modal-textarea {
	background: rgba(0, 0, 0, 0.04);
}
:global(html.light) .ann-modal-cancel {
	background: rgba(0, 0, 0, 0.05);
}
:global(html.light) .ann-modal-cancel:not(:disabled):hover {
	background: rgba(0, 0, 0, 0.1);
}
</style>
