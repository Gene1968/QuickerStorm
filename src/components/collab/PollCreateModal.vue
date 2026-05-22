<script setup>
/**
 * PollCreateModal — Centered dialog for creating a new poll.
 * Mirrors PollModal's visual style (ava-modal-overlay + ava-modal tokens).
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { usePolls } from '@/composables/usePolls.js'
import { useOfficeStore } from '@/stores/officeStore.js'

const emit = defineEmits(['close'])

const officeStore = useOfficeStore()
const { createPoll } = usePolls()

const question = ref('')
const options = ref(['', ''])
const duration = ref('')           // empty = no end time; otherwise seconds
const customEndsAt = ref('')       // datetime-local string

const DURATION_PRESETS = [
	{ value: '',       label: 'Closes manually' },
	{ value: '3600',   label: '1 hour' },
	{ value: '14400',  label: '4 hours' },
	{ value: '86400',  label: '1 day' },
	{ value: '259200', label: '3 days' },
	{ value: '604800', label: '7 days' },
	{ value: 'custom', label: 'Custom date/time…' },
]

function addOption() { if (options.value.length < 10) options.value.push('') }
function removeOption(idx) { if (options.value.length > 2) options.value.splice(idx, 1) }

function computeEndsAt() {
	if (!duration.value) return null
	if (duration.value === 'custom') {
		if (!customEndsAt.value) return null
		const d = new Date(customEndsAt.value)
		if (isNaN(d.getTime()) || d.getTime() < Date.now()) return null
		return d.toISOString()
	}
	const sec = parseInt(duration.value, 10)
	if (isNaN(sec) || sec <= 0) return null
	return new Date(Date.now() + sec * 1000).toISOString()
}

const submitDisabled = () => {
	const q = question.value.trim()
	const opts = options.value.map(o => o.trim()).filter(Boolean)
	if (!q || opts.length < 2) return true
	if (duration.value === 'custom' && !computeEndsAt()) return true
	return false
}

function submit() {
	const q = question.value.trim()
	const opts = options.value.map(o => o.trim()).filter(Boolean)
	if (!q || opts.length < 2) return
	const endsAt = computeEndsAt()
	createPoll(q, opts, officeStore.currentRoomId, endsAt)
	emit('close')
}

function handleBackdrop(e) {
	if (e.target === e.currentTarget) emit('close')
}
function onEsc(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onEsc))
onUnmounted(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
	<div class="pcm-backdrop ava-modal-overlay" @mousedown="handleBackdrop">
		<div class="pcm-modal ava-modal" @mousedown.stop>
			<div class="pcm-header ava-modal-header">
				<h3 class="pcm-title">New Poll</h3>
				<button class="ava-close pcm-close" @click="emit('close')" title="Close">✕</button>
			</div>

			<div class="pcm-body">
				<label class="pcm-label">Question</label>
				<input
					v-model="question"
					class="pcm-input"
					placeholder="Ask a question..."
					maxlength="280"
					autofocus
				/>

				<label class="pcm-label">Options</label>
				<div class="pcm-options">
					<div v-for="(opt, idx) in options" :key="idx" class="pcm-option-row">
						<input
							v-model="options[idx]"
							class="pcm-input pcm-option-input"
							:placeholder="`Option ${idx + 1}`"
							maxlength="80"
							@keydown.enter.prevent="idx === options.length - 1 ? addOption() : null"
						/>
						<button
							v-if="options.length > 2"
							class="pcm-mini-btn"
							@click="removeOption(idx)"
							title="Remove"
						>✕</button>
					</div>
					<button
						class="pcm-link-btn"
						@click="addOption"
						:disabled="options.length >= 10"
					>+ Add option</button>
				</div>

				<label class="pcm-label">Closing time</label>
				<select v-model="duration" class="pcm-input pcm-select">
					<option v-for="p in DURATION_PRESETS" :key="p.value" :value="p.value">
						{{ p.label }}
					</option>
				</select>
				<input
					v-if="duration === 'custom'"
					v-model="customEndsAt"
					type="datetime-local"
					class="pcm-input pcm-datetime"
				/>
			</div>

			<div class="pcm-footer">
				<button class="pcm-btn pcm-btn--ghost" @click="emit('close')">Cancel</button>
				<button class="pcm-btn pcm-btn--primary" :disabled="submitDisabled()" @click="submit">Create poll</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.pcm-backdrop {
	position: fixed; inset: 0;
	display: flex; align-items: center; justify-content: center;
	z-index: 650;
}

.pcm-modal {
	width: 26rem;
	max-width: 92vw;
	max-height: 85vh;
	overflow: hidden;
	border-radius: 0.75rem;
	box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.4);
	display: flex; flex-direction: column;
}

.pcm-header {
	display: flex; align-items: center; justify-content: space-between;
	gap: 0.75rem;
	padding: 0.875rem 1rem;
}
.pcm-title {
	font-size: 1rem;
	font-weight: 600;
	color: var(--color-t1);
	margin: 0;
}
.pcm-close {
	font-size: 0.875rem;
	line-height: 1;
	padding: 0.25rem 0.5rem;
	border-radius: 0.25rem;
}

.pcm-body {
	padding: 0.875rem 1rem;
	overflow-y: auto;
	display: flex; flex-direction: column;
	gap: 0.375rem;
}

.pcm-label {
	display: block;
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-tm);
	margin: 0.5rem 0 0.25rem;
}
.pcm-label:first-of-type { margin-top: 0; }

.pcm-input {
	width: 100%;
	padding: 0.4375rem 0.625rem;
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	background: var(--color-card2);
	color: var(--color-t1);
	font-size: 0.8125rem;
	font-family: inherit;
	outline: none;
}
.pcm-input:focus { border-color: var(--color-accent); }

.pcm-options {
	display: flex; flex-direction: column;
	gap: 0.25rem;
}
.pcm-option-row { display: flex; gap: 0.25rem; align-items: center; }
.pcm-option-input { flex: 1; }
.pcm-mini-btn {
	background: none; border: none;
	color: var(--color-tm);
	cursor: pointer;
	padding: 0.125rem 0.375rem;
	font-size: 0.875rem;
	border-radius: 0.25rem;
}
.pcm-mini-btn:hover { color: #ef4444; background: rgba(239, 68, 68, 0.08); }

.pcm-select { font-size: 0.8125rem; color: var(--color-t1); }
.pcm-datetime { margin-top: 0.25rem; }

.pcm-link-btn {
	align-self: flex-start;
	margin-top: 0.25rem;
	background: none; border: none;
	color: var(--color-accent);
	font-size: 0.75rem;
	cursor: pointer;
	padding: 0.25rem 0.375rem;
	border-radius: 0.25rem;
}
.pcm-link-btn:hover { background: rgba(0, 180, 216, 0.1); color: var(--color-accent3); }
.pcm-link-btn:disabled { color: var(--color-tm); cursor: default; }
.pcm-link-btn:disabled:hover { background: none; }

.pcm-footer {
	display: flex; justify-content: flex-end;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	border-top: 1px solid var(--color-brd);
	background: var(--color-card2);
}
.pcm-btn {
	padding: 0.4375rem 0.875rem;
	border-radius: 0.375rem;
	border: 1px solid var(--color-brd);
	background: var(--color-card);
	color: var(--color-t2);
	font-size: 0.8125rem;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.pcm-btn:hover { background: var(--color-bg2); color: var(--color-t1); border-color: var(--color-brd2); }
.pcm-btn--primary {
	background: var(--color-accent);
	border-color: var(--color-accent);
	color: #fff;
}
.pcm-btn--primary:hover { background: var(--color-accent2); border-color: var(--color-accent2); color: #fff; }
.pcm-btn--primary:disabled { opacity: 0.4; cursor: not-allowed; background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
</style>
