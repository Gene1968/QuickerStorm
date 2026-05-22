<script setup>
/**
 * TaskCard — Single kanban card. Editable title + body + assignee.
 * Drag-and-drop via native HTML5 (drag handle is the whole card).
 */
import { ref, computed } from 'vue'
import { usePresenceStore } from '@/stores/presenceStore.js'

const props = defineProps({
	card:       { type: Object,  required: true },
	readOnly:   { type: Boolean, default: false },
	focusedBy:  { type: Array,   default: () => [] }, // [{ userName, color }]
})

const emit = defineEmits(['update', 'delete', 'drag-start', 'drag-end', 'focus', 'blur'])

const presenceStore = usePresenceStore()

const editing = ref(false)
const editTitle = ref(props.card.title)
const editBody = ref(props.card.body)
const editAssignee = ref(props.card.assignee || '')

const assigneeName = computed(() => {
	if (!props.card.assignee) return ''
	const u = presenceStore.users.find(x => (x.authUserId || x.id) === props.card.assignee)
	return u?.name || u?.email?.split('@')[0] || 'User'
})

const assigneeColor = computed(() => {
	const id = props.card.assignee || ''
	let h = 0
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
	return `hsl(${h % 360}, 60%, 45%)`
})

const memberOptions = computed(() => {
	return presenceStore.users
		.filter(u => u.authUserId || u.id)
		.map(u => ({ id: u.authUserId || u.id, name: u.name || u.email || 'User' }))
})

function openEdit() {
	if (props.readOnly) return
	editTitle.value = props.card.title
	editBody.value = props.card.body
	editAssignee.value = props.card.assignee || ''
	editing.value = true
	emit('focus', props.card.id)
}

function saveEdit() {
	emit('update', {
		title: editTitle.value.trim() || 'Untitled',
		body: editBody.value,
		assignee: editAssignee.value || null,
	})
	editing.value = false
	emit('blur')
}

function cancelEdit() {
	editing.value = false
	emit('blur')
}

function handleDelete() {
	emit('delete')
	editing.value = false
	emit('blur')
}

function onDragStart(e) {
	if (props.readOnly) { e.preventDefault(); return }
	e.dataTransfer.effectAllowed = 'move'
	e.dataTransfer.setData('text/plain', props.card.id)
	emit('drag-start', props.card.id)
}

function onDragEnd() { emit('drag-end') }
</script>

<template>
	<div
		class="task-card"
		:class="{ readonly: readOnly, 'has-focus': focusedBy.length > 0 }"
		:draggable="!readOnly"
		@click="openEdit"
		@dragstart="onDragStart"
		@dragend="onDragEnd"
	>
		<!-- Remote focus indicator: small chip showing who's editing this card -->
		<div v-if="focusedBy.length > 0" class="tc-focus-strip">
			<span
				v-for="(f, i) in focusedBy"
				:key="i"
				class="tc-focus-chip"
				:style="{ background: f.color }"
				:title="`${f.userName} is editing`"
			>{{ f.userName }}</span>
		</div>

		<div class="tc-title">{{ card.title }}</div>
		<div v-if="card.body" class="tc-body">{{ card.body }}</div>
		<div v-if="assigneeName" class="tc-assignee">
			<span class="tc-assignee-dot" :style="{ background: assigneeColor }"></span>
			<span>{{ assigneeName }}</span>
		</div>

		<!-- Inline editor modal (renders over card area) -->
		<div v-if="editing" class="tc-editor-backdrop" @click.self="cancelEdit">
			<div class="tc-editor" @click.stop>
				<input
					v-model="editTitle"
					class="tc-input"
					placeholder="Task title"
					@keydown.enter.prevent="saveEdit"
					@keydown.esc="cancelEdit"
					autofocus
				/>
				<textarea
					v-model="editBody"
					class="tc-textarea"
					placeholder="Notes (optional)..."
					rows="4"
				></textarea>
				<select v-model="editAssignee" class="tc-input">
					<option value="">Unassigned</option>
					<option v-for="m in memberOptions" :key="m.id" :value="m.id">{{ m.name }}</option>
				</select>
				<div class="tc-editor-actions">
					<button class="tc-btn tc-btn-danger" @click="handleDelete">Delete</button>
					<div style="flex: 1"></div>
					<button class="tc-btn tc-btn-secondary" @click="cancelEdit">Cancel</button>
					<button class="tc-btn tc-btn-primary" @click="saveEdit">Save</button>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.task-card {
	position: relative;
	background: #fff;
	border: 1px solid #e2e8f0;
	border-radius: 6px;
	padding: 8px 10px;
	cursor: pointer;
	font-size: 13px;
	box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
	transition: box-shadow 0.15s, border-color 0.15s;
	user-select: none;
}
.task-card:hover { border-color: #93c5fd; box-shadow: 0 2px 6px rgba(15, 23, 42, 0.08); }
.task-card.readonly { cursor: default; }
.task-card.readonly:hover { border-color: #e2e8f0; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05); }
.task-card.has-focus {
	border-color: #f59e0b;
	box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
}

.tc-focus-strip {
	position: absolute;
	top: -10px;
	right: 6px;
	display: flex;
	gap: 3px;
	z-index: 2;
}
.tc-focus-chip {
	font-size: 10px;
	font-weight: 600;
	padding: 1px 6px;
	border-radius: 8px;
	color: #fff;
	white-space: nowrap;
	box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
	max-width: 90px;
	overflow: hidden;
	text-overflow: ellipsis;
}

.tc-title { font-weight: 500; color: #1e293b; word-break: break-word; }
.tc-body {
	margin-top: 4px;
	color: #64748b;
	font-size: 12px;
	max-height: 60px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: pre-wrap;
}
.tc-assignee {
	margin-top: 6px;
	display: flex; align-items: center; gap: 5px;
	font-size: 11px;
	color: #475569;
}
.tc-assignee-dot {
	width: 12px; height: 12px;
	border-radius: 50%;
	flex-shrink: 0;
}

.tc-editor-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(15, 23, 42, 0.45);
	display: flex; align-items: center; justify-content: center;
	z-index: 600;
}

.tc-editor {
	background: #fff;
	border-radius: 10px;
	padding: 16px;
	width: 380px;
	max-width: 90vw;
	box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
	display: flex; flex-direction: column; gap: 8px;
}

.tc-input, .tc-textarea {
	width: 100%;
	padding: 8px 10px;
	border: 1px solid #e2e8f0;
	border-radius: 6px;
	font-size: 13px;
	outline: none;
	font-family: inherit;
}
.tc-input:focus, .tc-textarea:focus { border-color: #3b82f6; }
.tc-textarea { resize: vertical; }

.tc-editor-actions {
	display: flex;
	gap: 8px;
	margin-top: 4px;
}

.tc-btn {
	padding: 6px 14px;
	border: none;
	border-radius: 6px;
	font-size: 12px;
	cursor: pointer;
}
.tc-btn-primary { background: #3b82f6; color: #fff; }
.tc-btn-primary:hover { background: #2563eb; }
.tc-btn-secondary { background: #f1f5f9; color: #475569; }
.tc-btn-secondary:hover { background: #e2e8f0; }
.tc-btn-danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
.tc-btn-danger:hover { background: #fef2f2; }
</style>
