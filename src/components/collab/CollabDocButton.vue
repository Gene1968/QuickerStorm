<script setup>
/**
 * CollabDocButton — Floating button shown in rooms with collaborative docs.
 * Displays active user count and lets users open the doc or its history.
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

const docId = computed(() => `dc-${props.roomId}`)

function handleDocPresence(data) {
	if (data.docId !== docId.value) return
	activeUsers.value = data.count || 0
	if (data.access) isPrivate.value = data.access === 'private'
}

onMounted(() => on('dp', handleDocPresence))
onUnmounted(() => off('dp', handleDocPresence))
</script>

<template>
	<div class="doc-btn-group">
		<button class="doc-btn" @click="emit('open')" :title="isPrivate ? 'Private Doc' : 'Open Doc'">
			<svg v-if="!isPrivate" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
				<polyline points="14 2 14 8 20 8"/>
				<line x1="16" y1="13" x2="8" y2="13"/>
				<line x1="16" y1="17" x2="8" y2="17"/>
				<polyline points="10 9 9 9 8 9"/>
			</svg>
			<svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0110 0v4"/>
			</svg>
			<span class="doc-btn-label">Doc</span>
			<span v-if="isPrivate" class="doc-btn-lock">Private</span>
			<span v-if="activeUsers > 0" class="doc-btn-badge">{{ activeUsers }}</span>
		</button>
		<button class="history-btn" @click="emit('open-history')" title="Doc History">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
			</svg>
		</button>
	</div>
</template>

<style scoped>
.doc-btn-group { display: flex; gap: 0.125rem; }

.doc-btn {
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
.doc-btn:hover { background: var(--color-bg2); border-color: var(--color-brd2); }

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

.doc-btn-label { white-space: nowrap; }

.doc-btn-lock {
	font-size: 0.625rem; padding: 0.0625rem 0.375rem; border-radius: 0.1875rem;
	background: var(--color-bg2); color: var(--color-tm); font-weight: 500;
}

.doc-btn-badge {
	display: flex; align-items: center; justify-content: center;
	min-width: 1.125rem; height: 1.125rem; padding: 0 0.3125rem;
	border-radius: 0.5625rem;
	background: var(--color-accent); color: #fff;
	font-size: 0.6875rem; font-weight: 600;
}
</style>
