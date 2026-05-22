<script setup>
/**
 * StickyNote — Draggable, editable sticky note on the whiteboard.
 *
 * Supports: drag to move, double-click to edit text, resize handle,
 * color indicator, vote dots, and delete button.
 */
import { ref, computed } from 'vue'

const props = defineProps({
	sticky: { type: Object, required: true },
	isSelectMode: { type: Boolean, default: true },
})

const emit = defineEmits(['update', 'delete', 'vote'])

const isEditing = ref(false)
const isDragging = ref(false)
const textareaRef = ref(null)

let dragStart = { x: 0, y: 0, origX: 0, origY: 0 }

// ── Drag handling ───────────────────────────────────────────────────────
function onDragStart(e) {
	if (!props.isSelectMode || isEditing.value) return
	e.preventDefault()
	isDragging.value = true
	dragStart = {
		x: e.clientX,
		y: e.clientY,
		origX: props.sticky.x,
		origY: props.sticky.y,
	}
	document.addEventListener('pointermove', onDragMove)
	document.addEventListener('pointerup', onDragEnd)
}

function onDragMove(e) {
	if (!isDragging.value) return
	const dx = e.clientX - dragStart.x
	const dy = e.clientY - dragStart.y
	emit('update', {
		x: dragStart.origX + dx,
		y: dragStart.origY + dy,
	})
}

function onDragEnd() {
	isDragging.value = false
	document.removeEventListener('pointermove', onDragMove)
	document.removeEventListener('pointerup', onDragEnd)
}

// ── Text editing ────────────────────────────────────────────────────────
function startEditing() {
	if (!props.isSelectMode) return
	isEditing.value = true
	setTimeout(() => textareaRef.value?.focus(), 0)
}

function finishEditing() {
	isEditing.value = false
	emit('update', { text: textareaRef.value?.value || '' })
}

// ── Votes ───────────────────────────────────────────────────────────────
const voteCount = computed(() => props.sticky.votes?.length || 0)
</script>

<template>
	<div
		class="sticky-note"
		:style="{
			left: sticky.x + 'px',
			top: sticky.y + 'px',
			width: sticky.width + 'px',
			minHeight: sticky.height + 'px',
			backgroundColor: sticky.color,
		}"
		:class="{ dragging: isDragging }"
		@pointerdown="onDragStart"
		@dblclick="startEditing"
	>
		<!-- Delete button -->
		<button class="sticky-delete" @click.stop="emit('delete')" title="Delete">✕</button>

		<!-- Text content -->
		<textarea
			v-if="isEditing"
			ref="textareaRef"
			class="sticky-text editing"
			:value="sticky.text"
			@blur="finishEditing"
			@keydown.escape="finishEditing"
			@pointerdown.stop
		/>
		<div v-else class="sticky-text">
			{{ sticky.text || 'Double-click to edit' }}
		</div>

		<!-- Vote dots -->
		<div class="sticky-footer">
			<button class="vote-btn" @click.stop="emit('vote', 'me')" title="Vote">
				<span class="vote-dot">●</span>
				<span v-if="voteCount > 0" class="vote-count">{{ voteCount }}</span>
			</button>
		</div>
	</div>
</template>

<style scoped>
.sticky-note {
	position: absolute;
	padding: 10px;
	border-radius: 4px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	display: flex;
	flex-direction: column;
	cursor: grab;
	user-select: none;
	transition: box-shadow 0.15s;
	z-index: 10;
}

.sticky-note:hover {
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
}

.sticky-note.dragging {
	cursor: grabbing;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
	z-index: 20;
}

.sticky-delete {
	position: absolute;
	top: 2px;
	right: 4px;
	background: none;
	border: none;
	font-size: 12px;
	cursor: pointer;
	opacity: 0;
	color: #64748b;
	padding: 2px 4px;
	border-radius: 2px;
}
.sticky-note:hover .sticky-delete { opacity: 1; }
.sticky-delete:hover { background: rgba(0,0,0,0.1); }

.sticky-text {
	flex: 1;
	font-size: 13px;
	line-height: 1.4;
	color: #1e293b;
	word-wrap: break-word;
	white-space: pre-wrap;
}

.sticky-text.editing {
	background: transparent;
	border: none;
	outline: none;
	resize: none;
	font-family: inherit;
	font-size: 13px;
	color: #1e293b;
	width: 100%;
	min-height: 60px;
}

.sticky-footer {
	display: flex;
	justify-content: flex-end;
	margin-top: 6px;
}

.vote-btn {
	background: none;
	border: none;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 3px;
	padding: 2px 6px;
	border-radius: 10px;
	font-size: 12px;
}
.vote-btn:hover { background: rgba(0, 0, 0, 0.08); }

.vote-dot { color: #3b82f6; font-size: 10px; }
.vote-count { color: #475569; font-weight: 600; }
</style>
