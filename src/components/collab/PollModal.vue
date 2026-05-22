<script setup>
/**
 * PollModal — Centered dialog for a single poll. Opened by clicking a poll row
 * in the sidebar. Shows full voting UI + creator-only actions: set/clear end
 * time, close now, delete.
 *
 * Live updates: subscribes to the singleton `usePolls` cache via getPollById,
 * so any incoming WS update (vote, close, deletion) reflects without polling.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { usePolls } from '@/composables/usePolls.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { avaConfirm } from '@/composables/useConfirm.js'

const props = defineProps({
	pollId: { type: String, required: true },
})

const emit = defineEmits(['close'])

const avatarStore = useAvatarStore()
const { getPollById, vote, closePoll, deletePoll, updatePollEndsAt, myVote } = usePolls()

const pollRef = getPollById(props.pollId)
const poll = computed(() => pollRef.value)

// Auto-close when the underlying poll vanishes (e.g. another user deleted it).
watch(poll, (p) => { if (!p) emit('close') })

const isCreator = computed(() => poll.value?.createdBy === avatarStore.authUserId)

// ── End time: countdown + picker ────────────────────────────────────────
const now = ref(Date.now())
let nowTimer = null
onMounted(() => {
	nowTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer) })

const remainingLabel = computed(() => {
	if (!poll.value?.endsAt) return null
	const ms = new Date(poll.value.endsAt).getTime() - now.value
	if (ms <= 0) return 'Ended'
	return formatDuration(ms)
})

function formatDuration(ms) {
	const s = Math.floor(ms / 1000)
	if (s < 60) return `Closes in ${s}s`
	const m = Math.floor(s / 60)
	if (m < 60) return `Closes in ${m}m`
	const h = Math.floor(m / 60)
	if (h < 24) {
		const mr = m - h * 60
		return mr > 0 ? `Closes in ${h}h ${mr}m` : `Closes in ${h}h`
	}
	const d = Math.floor(h / 24)
	const hr = h - d * 24
	return hr > 0 ? `Closes in ${d}d ${hr}h` : `Closes in ${d}d`
}

// Picker state: presets + custom datetime
const showPicker = ref(false)
const customEndsAt = ref('')
const PRESETS = [
	{ label: '1 hour',  ms: 1 * 60 * 60 * 1000 },
	{ label: '4 hours', ms: 4 * 60 * 60 * 1000 },
	{ label: '1 day',   ms: 24 * 60 * 60 * 1000 },
	{ label: '3 days',  ms: 3 * 24 * 60 * 60 * 1000 },
	{ label: '7 days',  ms: 7 * 24 * 60 * 60 * 1000 },
]

function applyPreset(ms) {
	const iso = new Date(Date.now() + ms).toISOString()
	updatePollEndsAt(poll.value.id, iso)
	showPicker.value = false
}
function applyCustom() {
	if (!customEndsAt.value) return
	const d = new Date(customEndsAt.value)
	if (isNaN(d.getTime()) || d.getTime() < Date.now()) return
	updatePollEndsAt(poll.value.id, d.toISOString())
	showPicker.value = false
	customEndsAt.value = ''
}
function clearEndsAt() {
	updatePollEndsAt(poll.value.id, null)
	showPicker.value = false
}

// ── Vote bars ───────────────────────────────────────────────────────────
function tallyPercent(idx) {
	if (!poll.value || !poll.value.totalVotes) return 0
	return Math.round((poll.value.tallies[idx] / poll.value.totalVotes) * 100)
}

function handleVote(idx) {
	if (!poll.value || poll.value.closed) return
	vote(poll.value.id, idx)
}

// ── Close + Delete ──────────────────────────────────────────────────────
async function handleClose() {
	const ok = await avaConfirm({
		title: 'Close Poll',
		message: 'Close this poll now? Voting will end and the result will be locked.',
		confirmLabel: 'Close Poll',
	})
	if (ok) closePoll(poll.value.id)
}

async function handleDelete() {
	const ok = await avaConfirm({
		title: 'Delete Poll',
		message: 'Delete this poll? All votes will be permanently removed. This cannot be undone.',
		confirmLabel: 'Delete',
	})
	if (ok) {
		deletePoll(poll.value.id)
		emit('close')
	}
}

function handleBackdrop(e) {
	if (e.target === e.currentTarget) emit('close')
}

function onEsc(e) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onEsc))
onUnmounted(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
	<div v-if="poll" class="pm-backdrop ava-modal-overlay" @mousedown="handleBackdrop">
		<div class="pm-modal ava-modal" @mousedown.stop>
			<!-- Header -->
			<div class="pm-header ava-modal-header">
				<div class="pm-header-text">
					<h3 class="pm-question">{{ poll.question }}</h3>
					<div class="pm-meta">
						<span v-if="poll.closed" class="pm-pill pm-pill--closed">Closed</span>
						<span v-else-if="remainingLabel" class="pm-pill pm-pill--time">{{ remainingLabel }}</span>
						<span v-else class="pm-pill pm-pill--open">Open</span>
						<span class="pm-meta-text">{{ poll.totalVotes }} {{ poll.totalVotes === 1 ? 'vote' : 'votes' }}</span>
					</div>
				</div>
				<button class="ava-close pm-close" @click="emit('close')" title="Close">✕</button>
			</div>

			<!-- Vote bars -->
			<div class="pm-body">
				<button
					v-for="(opt, idx) in poll.options"
					:key="idx"
					class="pm-option"
					:class="{ 'pm-option--mine': myVote(poll) === idx, 'pm-option--disabled': poll.closed }"
					:disabled="poll.closed"
					@click="handleVote(idx)"
				>
					<div class="pm-option-bar" :style="{ width: `${tallyPercent(idx)}%` }"></div>
					<span class="pm-option-label">{{ opt }}</span>
					<span class="pm-option-stats">
						<span class="pm-option-pct">{{ tallyPercent(idx) }}%</span>
						<span class="pm-option-count">({{ poll.tallies[idx] || 0 }})</span>
					</span>
				</button>
			</div>

			<!-- Creator-only actions -->
			<div v-if="isCreator" class="pm-actions">
				<div class="pm-actions-row">
					<button
						v-if="!poll.closed"
						class="pm-btn pm-btn--ghost"
						@click="showPicker = !showPicker"
					>
						{{ poll.endsAt ? 'Change end time' : 'Set end time' }}
					</button>
					<button v-if="!poll.closed" class="pm-btn pm-btn--ghost" @click="handleClose">Close now</button>
					<button class="pm-btn pm-btn--danger" @click="handleDelete">Delete</button>
				</div>

				<!-- End time picker -->
				<div v-if="showPicker && !poll.closed" class="pm-picker">
					<div class="pm-picker-label">Auto-close after</div>
					<div class="pm-presets">
						<button
							v-for="p in PRESETS"
							:key="p.label"
							class="pm-preset"
							@click="applyPreset(p.ms)"
						>{{ p.label }}</button>
					</div>
					<div class="pm-picker-row">
						<input
							v-model="customEndsAt"
							type="datetime-local"
							class="pm-datetime"
						/>
						<button class="pm-btn pm-btn--primary pm-btn--small" :disabled="!customEndsAt" @click="applyCustom">Apply</button>
					</div>
					<button v-if="poll.endsAt" class="pm-link-danger" @click="clearEndsAt">Remove end time</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.pm-backdrop {
	position: fixed;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 650;
}

.pm-modal {
	width: 28rem;
	max-width: 92vw;
	max-height: 85vh;
	overflow: hidden;
	border-radius: 0.75rem;
	box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.4);
	display: flex;
	flex-direction: column;
}

.pm-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 0.75rem;
	padding: 0.875rem 1rem;
}
.pm-header-text { flex: 1; min-width: 0; }
.pm-question {
	font-size: 1rem;
	font-weight: 600;
	color: var(--color-t1);
	margin: 0 0 0.375rem;
	line-height: 1.35;
	word-wrap: break-word;
}

.pm-meta { display: flex; align-items: center; gap: 0.5rem; font-size: 0.6875rem; }
.pm-meta-text { color: var(--color-tm); }

.pm-pill {
	font-size: 0.625rem;
	font-weight: 600;
	padding: 0.125rem 0.5rem;
	border-radius: 0.625rem;
	letter-spacing: 0.04em;
}
.pm-pill--open   { background: rgba(34, 197, 94, 0.18);  color: #22c55e; }
.pm-pill--time   { background: rgba(0, 180, 216, 0.18);  color: var(--color-accent3); }
.pm-pill--closed { background: var(--color-bg2);         color: var(--color-tm); }

.pm-close {
	font-size: 0.875rem;
	line-height: 1;
	padding: 0.25rem 0.5rem;
	border-radius: 0.25rem;
}

.pm-body {
	padding: 0.875rem 1rem;
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	overflow-y: auto;
}

.pm-option {
	position: relative;
	display: flex;
	align-items: center;
	padding: 0.5rem 0.75rem;
	border-radius: 0.4375rem;
	border: 1px solid var(--color-brd);
	background: var(--color-card2);
	color: var(--color-t1);
	cursor: pointer;
	overflow: hidden;
	text-align: left;
	font-size: 0.8125rem;
	transition: border-color 0.15s;
}
.pm-option:hover:not(.pm-option--disabled) { border-color: var(--color-accent3); }
.pm-option--mine { border-color: var(--color-accent); background: rgba(0, 180, 216, 0.18); }
.pm-option--disabled { cursor: default; }

.pm-option-bar {
	position: absolute; left: 0; top: 0; bottom: 0;
	background: rgba(0, 180, 216, 0.18);
	transition: width 0.25s ease;
	z-index: 0;
}
.pm-option--mine .pm-option-bar { background: rgba(0, 180, 216, 0.32); }

.pm-option-label { position: relative; z-index: 1; flex: 1; }
.pm-option-stats {
	position: relative; z-index: 1;
	display: flex; gap: 0.25rem;
	font-size: 0.6875rem;
	color: var(--color-tm);
	font-variant-numeric: tabular-nums;
}
.pm-option-pct { font-weight: 600; color: var(--color-t2); }

.pm-actions {
	border-top: 1px solid var(--color-brd);
	padding: 0.75rem 1rem;
	background: var(--color-card2);
	display: flex; flex-direction: column;
	gap: 0.625rem;
}
.pm-actions-row {
	display: flex; flex-wrap: wrap;
	gap: 0.375rem;
}
.pm-btn {
	padding: 0.375rem 0.75rem;
	border-radius: 0.375rem;
	border: 1px solid var(--color-brd);
	background: var(--color-card);
	color: var(--color-t2);
	font-size: 0.75rem;
	cursor: pointer;
	transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.pm-btn:hover { background: var(--color-bg2); color: var(--color-t1); border-color: var(--color-brd2); }
.pm-btn--ghost { /* default look above */ }
.pm-btn--primary {
	background: var(--color-accent);
	border-color: var(--color-accent);
	color: #fff;
}
.pm-btn--primary:hover { background: var(--color-accent2); border-color: var(--color-accent2); color: #fff; }
.pm-btn--primary:disabled { opacity: 0.4; cursor: not-allowed; }
.pm-btn--danger {
	margin-left: auto;
	border-color: rgba(239, 68, 68, 0.4);
	color: #ef4444;
}
.pm-btn--danger:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: #ef4444; }
.pm-btn--small { padding: 0.25rem 0.625rem; font-size: 0.6875rem; }

.pm-picker {
	border: 1px solid var(--color-brd);
	border-radius: 0.4375rem;
	padding: 0.625rem 0.75rem;
	background: var(--color-card);
	display: flex; flex-direction: column;
	gap: 0.5rem;
}
.pm-picker-label {
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--color-tm);
}
.pm-presets { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.pm-preset {
	padding: 0.25rem 0.625rem;
	border-radius: 0.875rem;
	border: 1px solid var(--color-brd);
	background: var(--color-card2);
	color: var(--color-t2);
	font-size: 0.6875rem;
	cursor: pointer;
}
.pm-preset:hover { border-color: var(--color-accent); color: var(--color-t1); }

.pm-picker-row {
	display: flex; gap: 0.375rem; align-items: center;
}
.pm-datetime {
	flex: 1;
	padding: 0.3125rem 0.5rem;
	border: 1px solid var(--color-brd);
	border-radius: 0.25rem;
	background: var(--color-card2);
	color: var(--color-t1);
	font-size: 0.75rem;
	font-family: inherit;
}
.pm-datetime:focus { outline: none; border-color: var(--color-accent); }

.pm-link-danger {
	background: none;
	border: none;
	color: #ef4444;
	font-size: 0.6875rem;
	cursor: pointer;
	padding: 0.125rem;
	align-self: flex-start;
}
.pm-link-danger:hover { text-decoration: underline; }
</style>
