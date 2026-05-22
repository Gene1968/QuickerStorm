<script setup>
/**
 * TaskBoard — Kanban view: columns + drag-and-drop cards.
 *
 * Operates on the data exposed by useTaskBoard (columns + cardsByColumn).
 * Drag-and-drop uses native HTML5 events; drop targets are the column
 * body and per-card "drop slot" markers.
 */
import { ref } from 'vue'
import TaskCard from './TaskCard.vue'

const props = defineProps({
	columns:       { type: Array,   required: true },
	cardsByColumn: { type: Map,     required: true },
	readOnly:      { type: Boolean, default: false },
	focusByCard:   { type: Map,     default: () => new Map() }, // cardId → [{ userName, color }]
})

const emit = defineEmits([
	'add-column', 'rename-column', 'delete-column',
	'add-card', 'update-card', 'delete-card', 'move-card',
	'card-focus', 'card-blur',
])

const draggingCardId = ref(null)
const dropTarget = ref(null)  // { columnId, idx } | null
const renamingColumnId = ref(null)
const renameValue = ref('')

function startRename(col) {
	if (props.readOnly) return
	renamingColumnId.value = col.id
	renameValue.value = col.title
}
function commitRename() {
	if (!renamingColumnId.value) return
	emit('rename-column', renamingColumnId.value, renameValue.value.trim() || 'Untitled')
	renamingColumnId.value = null
}
function cancelRename() { renamingColumnId.value = null }

function onCardDragStart(cardId) { draggingCardId.value = cardId }
function onCardDragEnd() {
	draggingCardId.value = null
	dropTarget.value = null
}

function onColumnDragOver(e, columnId) {
	if (props.readOnly || !draggingCardId.value) return
	e.preventDefault()
	const cards = props.cardsByColumn.get(columnId) || []
	dropTarget.value = { columnId, idx: cards.length }
}

function onSlotDragOver(e, columnId, idx) {
	if (props.readOnly || !draggingCardId.value) return
	e.preventDefault()
	e.stopPropagation()
	dropTarget.value = { columnId, idx }
}

function onColumnDrop(e, columnId) {
	if (props.readOnly || !draggingCardId.value) return
	e.preventDefault()
	const idx = dropTarget.value?.idx ?? (props.cardsByColumn.get(columnId)?.length || 0)
	emit('move-card', draggingCardId.value, columnId, idx)
	draggingCardId.value = null
	dropTarget.value = null
}

function isDropTarget(columnId, idx) {
	return dropTarget.value && dropTarget.value.columnId === columnId && dropTarget.value.idx === idx
}

function quickAddCard(columnId) {
	if (props.readOnly) return
	emit('add-card', columnId)
}

function deleteCol(col) {
	if (props.readOnly) return
	if (!confirm(`Delete column "${col.title}" and all its tasks?`)) return
	emit('delete-column', col.id)
}
</script>

<template>
	<div class="task-board">
		<div class="tb-cols">
			<div
				v-for="col in columns"
				:key="col.id"
				class="tb-col"
				@dragover="onColumnDragOver($event, col.id)"
				@drop="onColumnDrop($event, col.id)"
			>
				<div class="tb-col-head">
					<input
						v-if="renamingColumnId === col.id"
						v-model="renameValue"
						class="tb-col-title-input"
						@blur="commitRename"
						@keydown.enter.prevent="commitRename"
						@keydown.esc="cancelRename"
						autofocus
					/>
					<span v-else class="tb-col-title" @click="startRename(col)">{{ col.title }}</span>
					<span class="tb-col-count">{{ (cardsByColumn.get(col.id) || []).length }}</span>
					<button v-if="!readOnly" class="tb-col-menu" @click="deleteCol(col)" title="Delete column">✕</button>
				</div>

				<div class="tb-col-body">
					<!-- Drop slot before each card + at end -->
					<div
						class="tb-drop-slot"
						:class="{ active: isDropTarget(col.id, 0) }"
						@dragover="onSlotDragOver($event, col.id, 0)"
					></div>

					<template v-for="(card, idx) in (cardsByColumn.get(col.id) || [])" :key="card.id">
						<TaskCard
							:card="card"
							:read-only="readOnly"
							:focused-by="focusByCard.get(card.id) || []"
							@update="emit('update-card', card.id, $event)"
							@delete="emit('delete-card', card.id)"
							@focus="emit('card-focus', $event)"
							@blur="emit('card-blur')"
							@drag-start="onCardDragStart"
							@drag-end="onCardDragEnd"
						/>
						<div
							class="tb-drop-slot"
							:class="{ active: isDropTarget(col.id, idx + 1) }"
							@dragover="onSlotDragOver($event, col.id, idx + 1)"
						></div>
					</template>

					<button v-if="!readOnly" class="tb-add-card" @click="quickAddCard(col.id)">+ Add task</button>
				</div>
			</div>

			<button v-if="!readOnly" class="tb-add-col" @click="emit('add-column')">+ Add column</button>
		</div>
	</div>
</template>

<style scoped>
.task-board {
	flex: 1;
	overflow: auto;
	padding: 16px;
	background: #f1f5f9;
}

.tb-cols {
	display: flex;
	gap: 12px;
	align-items: flex-start;
	min-height: 100%;
}

.tb-col {
	width: 260px;
	flex-shrink: 0;
	background: #e2e8f0;
	border-radius: 8px;
	padding: 8px;
	display: flex; flex-direction: column;
	max-height: calc(100vh - 200px);
}

.tb-col-head {
	display: flex; align-items: center; gap: 6px;
	padding: 4px 6px 8px;
	user-select: none;
}
.tb-col-title {
	font-weight: 600;
	font-size: 13px;
	color: #1e293b;
	flex: 1;
	cursor: text;
	overflow: hidden;
	text-overflow: ellipsis;
}
.tb-col-title-input {
	flex: 1;
	padding: 2px 4px;
	border: 1px solid #93c5fd;
	border-radius: 4px;
	font-size: 13px;
	font-weight: 600;
	outline: none;
	background: #fff;
}
.tb-col-count {
	font-size: 11px;
	padding: 1px 6px;
	border-radius: 8px;
	background: #cbd5e1;
	color: #475569;
	font-weight: 600;
}
.tb-col-menu {
	background: none; border: none;
	color: #94a3b8;
	font-size: 13px;
	cursor: pointer;
	padding: 2px 6px;
	border-radius: 4px;
}
.tb-col-menu:hover { background: #cbd5e1; color: #ef4444; }

.tb-col-body {
	flex: 1;
	overflow-y: auto;
	display: flex; flex-direction: column; gap: 6px;
	padding: 4px 0;
	min-height: 60px;
}

.tb-drop-slot {
	height: 6px;
	border-radius: 3px;
	background: transparent;
	transition: background 0.1s, height 0.1s;
}
.tb-drop-slot.active {
	background: #3b82f6;
	height: 36px;
}

.tb-add-card {
	background: none;
	border: 1px dashed #94a3b8;
	border-radius: 6px;
	padding: 6px;
	font-size: 12px;
	color: #64748b;
	cursor: pointer;
	margin-top: 4px;
}
.tb-add-card:hover { background: #f8fafc; color: #3b82f6; border-color: #3b82f6; }

.tb-add-col {
	width: 200px;
	flex-shrink: 0;
	background: rgba(255, 255, 255, 0.5);
	border: 1px dashed #94a3b8;
	border-radius: 8px;
	padding: 12px;
	font-size: 13px;
	color: #64748b;
	cursor: pointer;
	align-self: flex-start;
}
.tb-add-col:hover { background: #fff; color: #3b82f6; border-color: #3b82f6; }
</style>
