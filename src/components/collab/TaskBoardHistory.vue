<script setup>
/**
 * TaskBoardHistory — Panel showing archived task boards for a room.
 */
defineProps({
	boards:  { type: Array,  default: () => [] },
	loading: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'close'])

function formatDate(dateStr) {
	if (!dateStr) return ''
	const d = new Date(dateStr)
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
	<div class="history-panel">
		<div class="history-header">
			<h3>Board History</h3>
			<button class="close-btn" @click="emit('close')">✕</button>
		</div>
		<div class="history-body">
			<div v-if="loading" class="history-loading">Loading...</div>
			<div v-else-if="!boards.length" class="history-empty">No archived boards yet.</div>
			<div v-else class="history-list">
				<button v-for="board in boards" :key="board.id" class="history-item" @click="emit('open', board.id)">
					<div class="item-title">{{ board.title || 'Untitled' }}</div>
					<div class="item-meta">
						<span>{{ formatDate(board.archived_at || board.created_at) }}</span>
						<span v-if="board.access === 'private'" class="item-private">Private</span>
					</div>
				</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.history-panel { position: absolute; top: 0; right: 0; width: 300px; height: 100%; background: #fff; border-left: 1px solid #e2e8f0; box-shadow: -4px 0 12px rgba(0, 0, 0, 0.08); z-index: 600; display: flex; flex-direction: column; }
.history-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
.history-header h3 { font-size: 15px; font-weight: 600; margin: 0; }
.close-btn { background: none; border: none; font-size: 16px; cursor: pointer; color: #64748b; }
.history-body { flex: 1; overflow-y: auto; padding: 8px; }
.history-loading, .history-empty { padding: 24px 16px; text-align: center; font-size: 13px; color: #94a3b8; }
.history-list { display: flex; flex-direction: column; gap: 4px; }
.history-item { display: block; width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; text-align: left; cursor: pointer; transition: background 0.1s; }
.history-item:hover { background: #f8fafc; }
.item-title { font-size: 13px; font-weight: 500; color: #1e293b; margin-bottom: 4px; }
.item-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #94a3b8; }
.item-private { padding: 1px 5px; border-radius: 3px; background: #475569; color: #e2e8f0; font-size: 10px; }
</style>
