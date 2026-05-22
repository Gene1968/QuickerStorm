<script setup>
/**
 * SidebarPolls — Inline polls section for the sidebar bottom.
 *
 * Each poll row is clickable and opens a centered PollModal (teleported
 * to body) where votes, end-time changes, manual close, and deletion happen.
 *
 * Inline create form supports a closing-time preset.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { BarChart as ChartBarIcon } from '@lucide/vue'
import { usePolls } from '@/composables/usePolls.js'
import { useOfficeStore } from '@/stores/officeStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useAudio } from '@/composables/useAudio.js'
import PollModal from '@/components/collab/PollModal.vue'
import PollCreateModal from '@/components/collab/PollCreateModal.vue'

defineProps({
	collapsed: { type: Boolean, default: false },
})

const officeStore = useOfficeStore()
const avatarStore = useAvatarStore()
const { playSound } = useAudio()
const { pollsForRoom, loadForRoom, myVote } = usePolls()

const currentRoomId = computed(() => officeStore.currentRoomId)
const polls = computed(() => pollsForRoom(currentRoomId.value).value)

const expanded = ref(true)
const showCreateModal = ref(false)
const openPollId = ref(null)

// Live "now" so countdown labels refresh once a minute.
const now = ref(Date.now())
let nowTimer = null
onMounted(() => {
	loadForRoom(currentRoomId.value)
	nowTimer = setInterval(() => { now.value = Date.now() }, 30_000)
})
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer) })

watch(currentRoomId, (id) => loadForRoom(id))

const activeCount = computed(() => polls.value.filter(p => !p.closed).length)

function isCreator(poll) { return poll.createdBy === avatarStore.authUserId }

function shortRemaining(poll) {
	if (!poll.endsAt) return null
	const ms = new Date(poll.endsAt).getTime() - now.value
	if (ms <= 0) return 'ended'
	const m = Math.floor(ms / 60000)
	if (m < 60) return `${m}m`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h}h`
	const d = Math.floor(h / 24)
	return `${d}d`
}

function pollIcon(poll) {
	if (poll.closed) return '🔒'
	if (myVote(poll) !== null) return '✓'
	return '🗳'
}

function toggleSection() {
	expanded.value = !expanded.value
	playSound('pop.mp3')
}

function startCreate() { showCreateModal.value = true }
function closeCreate() { showCreateModal.value = false }

function openPoll(pollId) { openPollId.value = pollId }
function closePollModal() { openPollId.value = null }
</script>

<template>
	<!-- Collapsed sidebar: section label only -->
	<template v-if="collapsed">
		<div class="section-label" :title="`${activeCount} active poll${activeCount === 1 ? '' : 's'}`">
			<ChartBarIcon class="icon-sm" aria-hidden="true" />
			<span v-if="activeCount > 0" class="sp-collapsed-badge">{{ activeCount }}</span>
		</div>
	</template>

	<!-- Expanded -->
	<template v-else>
		<button type="button" class="sidebar-section-toggle" @click="toggleSection">
			<ChartBarIcon class="sidebar-section-icon" aria-hidden="true" />
			<span class="sidebar-section-label truncate">Polls</span>
			<span v-if="activeCount > 0" class="sidebar-section-badge">{{ activeCount }}</span>
			<span class="sidebar-section-chevron">{{ expanded ? '▾' : '▸' }}</span>
		</button>

		<template v-if="expanded">
			<!-- Poll list — click to open modal -->
			<button
				v-for="poll in polls"
				:key="poll.id"
				class="nav-item sp-poll-row"
				:class="{ 'sp-poll-row--closed': poll.closed, 'sp-poll-row--mine': isCreator(poll) }"
				@click="openPoll(poll.id)"
			>
				<span class="sp-poll-icon">{{ pollIcon(poll) }}</span>
				<span class="sp-poll-question truncate">{{ poll.question }}</span>
				<span v-if="!poll.closed && shortRemaining(poll)" class="sp-poll-time" :title="`Closes ${new Date(poll.endsAt).toLocaleString()}`">
					⏱ {{ shortRemaining(poll) }}
				</span>
				<span class="room-count" :title="`${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`">
					{{ poll.totalVotes }}
				</span>
			</button>

			<!-- New poll trigger (opens modal) -->
			<button class="nav-item sp-new-poll" @click="startCreate">
				<span class="sp-new-icon">＋</span>
				<span>New poll</span>
			</button>
		</template>

		<!-- Modals: teleport to body so they escape the sidebar's stacking context -->
		<Teleport to="body">
			<PollModal
				v-if="openPollId"
				:poll-id="openPollId"
				@close="closePollModal"
			/>
			<PollCreateModal
				v-if="showCreateModal"
				@close="closeCreate"
			/>
		</Teleport>
	</template>
</template>

<style scoped>
/* ── Section toggle (matches TheSidebar's .sidebar-section-toggle) ── */
.sidebar-section-toggle {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	box-sizing: border-box;
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	margin: 0.25rem 0.125rem 0.125rem;
	padding: 0.5rem 0.35rem;
	width: calc(100% - 0.25rem);
	color: var(--color-tm);
	font-size: 0.625rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	line-height: 1;
	text-transform: uppercase;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.sidebar-section-toggle:hover {
	background: #ffffff55;
	color: var(--color-t2);
	border-color: var(--color-brd2);
}
.sidebar-section-icon {
	width: 0.875rem; height: 0.875rem; flex-shrink: 0;
	color: var(--color-accent); opacity: 0.92;
}
.sidebar-section-toggle:hover .sidebar-section-icon { opacity: 1; }
.sidebar-section-label { flex: 1; min-width: 0; text-align: left; }
.sidebar-section-badge {
	flex-shrink: 0;
	background: var(--color-accent-orng);
	color: #000;
	font-size: 0.625rem;
	font-weight: 600;
	border-radius: 0.625rem;
	padding: 0.125rem 0.375rem;
	white-space: nowrap;
}
.sidebar-section-chevron { flex-shrink: 0; font-size: 1.125rem; line-height: 1; opacity: 0.9; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.section-label {
	position: relative;
	padding: 0.375rem 0;
	display: flex; align-items: center; justify-content: center;
	color: var(--color-tm);
}
.icon-sm { width: 1rem; height: 1rem; flex-shrink: 0; }
.sp-collapsed-badge {
	position: absolute;
	top: -2px; right: 0.25rem;
	min-width: 0.875rem; height: 0.875rem;
	padding: 0 0.25rem;
	border-radius: 0.5rem;
	background: var(--color-accent-orng); color: #000;
	font-size: 0.5625rem; font-weight: 700;
	display: flex; align-items: center; justify-content: center;
	line-height: 1;
}

/* ── Nav items (poll rows + new-poll trigger) — matches .nav-item ── */
.nav-item {
	width: 100%;
	display: flex; align-items: center;
	gap: 0.625rem;
	background: none;
	border: 1px solid transparent;
	border-radius: 0.4375rem;
	padding: 0.35rem 0.65rem;
	font-size: clamp(0.75rem, 0.75vw, 0.9375rem);
	color: var(--color-t2);
	cursor: pointer;
	text-align: left;
	transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.nav-item:hover { background: rgba(255, 255, 255, 0.05); color: var(--color-t1); }

.sp-poll-row { font-size: 0.75rem; }
.sp-poll-row--mine { border-color: rgba(245, 158, 11, 0.25); }
.sp-poll-row--closed { opacity: 0.65; }

.sp-poll-icon {
	flex-shrink: 0;
	width: 1.125rem;
	font-size: 0.875rem;
	text-align: center;
}
.sp-poll-question { flex: 1; min-width: 0; }

.sp-poll-time {
	flex-shrink: 0;
	font-size: 0.625rem;
	font-weight: 600;
	color: var(--color-accent3);
	font-variant-numeric: tabular-nums;
}

.room-count {
	margin-left: auto;
	background: var(--color-green);
	color: #fff;
	font-size: 0.625rem;
	font-weight: 600;
	border-radius: 0.625rem;
	padding: 0.0625rem 0.375rem;
}
.sp-poll-time + .room-count { margin-left: 0; }
.sp-poll-row--closed .room-count {
	background: transparent;
	color: var(--color-tm);
	border: 1px solid var(--color-brd2);
}

.sp-new-poll { color: var(--color-accent); font-weight: 500; }
.sp-new-poll:hover { color: var(--color-accent3); }
.sp-new-icon {
	flex-shrink: 0;
	width: 1.125rem;
	font-size: 1rem;
	text-align: center;
}

</style>
