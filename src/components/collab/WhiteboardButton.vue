<script setup>
/**
 * WhiteboardButton — Floating button shown in rooms with whiteboards.
 * Displays active user count, opens the whiteboard, and provides
 * access to board history without needing to open the current board.
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

const docId = computed(() => `wb-${props.roomId}`)

function handleDocPresence(data) {
	if (data.docId !== docId.value) return
	activeUsers.value = data.count || 0
	if (data.access) isPrivate.value = data.access === 'private'
}

onMounted(() => {
	on('dp', handleDocPresence)
})

onUnmounted(() => {
	off('dp', handleDocPresence)
})
</script>

<template>
	<div class="whiteboard-btn-group">
		<button class="whiteboard-btn" @click="emit('open')" :title="isPrivate ? 'Private Whiteboard' : 'Open Whiteboard'">
			<svg v-if="!isPrivate" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="2" y="3" width="20" height="14" rx="2"/>
				<path d="M8 21h8"/>
				<path d="M12 17v4"/>
			</svg>
			<svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0110 0v4"/>
			</svg>
			<span class="wb-btn-label">Whiteboard</span>
			<span v-if="isPrivate" class="wb-btn-lock">Private</span>
			<span v-if="activeUsers > 0" class="wb-btn-badge">{{ activeUsers }}</span>
		</button>
		<button class="history-btn" @click="emit('open-history')" title="Board History">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
			</svg>
		</button>
	</div>
</template>

<style scoped>
.whiteboard-btn-group {
	display: flex;
	gap: 0.125rem;
}

.whiteboard-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.5rem 0.875rem;
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem 0 0 0.5rem;
	background: var(--color-card2);
	color: var(--color-t1);
	font-size: 0.8125rem;
	font-weight: 500;
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
	user-select: none;
}
.whiteboard-btn:hover {
	background: var(--color-bg2);
	border-color: var(--color-brd2);
}

.history-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 0.5rem 0.625rem;
	border: 1px solid var(--color-brd);
	border-left: none;
	border-radius: 0 0.5rem 0.5rem 0;
	background: var(--color-card2);
	color: var(--color-tm);
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.history-btn:hover {
	background: var(--color-bg2);
	color: var(--color-t1);
	border-color: var(--color-brd2);
}

.wb-btn-label { white-space: nowrap; }

.wb-btn-lock {
	font-size: 0.625rem;
	padding: 0.0625rem 0.375rem;
	border-radius: 0.1875rem;
	background: var(--color-bg2);
	color: var(--color-tm);
	font-weight: 500;
}

.wb-btn-badge {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 1.125rem;
	height: 1.125rem;
	padding: 0 0.3125rem;
	border-radius: 0.5625rem;
	background: var(--color-accent);
	color: #fff;
	font-size: 0.6875rem;
	font-weight: 600;
}
</style>
