<script setup>
/**
 * TaskBoardButton — Floating button for opening the task board in a room.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'

const props = defineProps({
	roomId: { type: String, required: true },
})

const emit = defineEmits(['open', 'open-history'])

const activeUsers = ref(0)
const isPrivate = ref(false)
const { on, off } = useRealtimeSocket()

const docId = computed(() => `tb-${props.roomId}`)

function handleDocPresence(data) {
	if (data.docId !== docId.value) return
	activeUsers.value = data.count || 0
	if (data.access) isPrivate.value = data.access === 'private'
}

onMounted(() => on('dp', handleDocPresence))
onUnmounted(() => off('dp', handleDocPresence))
</script>

<template>
	<div class="tb-btn-group">
		<button class="tb-btn" @click="emit('open')" :title="isPrivate ? 'Private Task Board' : 'Open Task Board'">
			<svg v-if="!isPrivate" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="3" width="18" height="18" rx="2"/>
				<line x1="9" y1="3" x2="9" y2="21"/>
				<line x1="15" y1="3" x2="15" y2="21"/>
			</svg>
			<svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0110 0v4"/>
			</svg>
			<span class="tb-btn-label">Tasks</span>
			<span v-if="isPrivate" class="tb-btn-lock">Private</span>
			<span v-if="activeUsers > 0" class="tb-btn-badge">{{ activeUsers }}</span>
		</button>
		<button class="history-btn" @click="emit('open-history')" title="Board History">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
			</svg>
		</button>
	</div>
</template>

<style scoped>
.tb-btn-group { display: flex; gap: 0.125rem; }

.tb-btn {
	display: flex; align-items: center; gap: 0.375rem;
	padding: 0.5rem 0.875rem;
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem 0 0 0.5rem;
	background: var(--color-card2);
	color: var(--color-t1);
	font-size: 0.8125rem; font-weight: 500; cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
	user-select: none;
}
.tb-btn:hover { background: var(--color-bg2); border-color: var(--color-brd2); }

.history-btn {
	display: flex; align-items: center; justify-content: center;
	padding: 0.5rem 0.625rem;
	border: 1px solid var(--color-brd);
	border-left: none;
	border-radius: 0 0.5rem 0.5rem 0;
	background: var(--color-card2);
	color: var(--color-tm);
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.history-btn:hover { background: var(--color-bg2); color: var(--color-t1); border-color: var(--color-brd2); }

.tb-btn-label { white-space: nowrap; }
.tb-btn-lock { font-size: 0.625rem; padding: 0.0625rem 0.375rem; border-radius: 0.1875rem; background: var(--color-bg2); color: var(--color-tm); font-weight: 500; }
.tb-btn-badge { display: flex; align-items: center; justify-content: center; min-width: 1.125rem; height: 1.125rem; padding: 0 0.3125rem; border-radius: 0.5625rem; background: var(--color-accent); color: #fff; font-size: 0.6875rem; font-weight: 600; }
</style>
