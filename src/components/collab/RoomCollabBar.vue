<script setup>
/**
 * RoomCollabBar — Horizontal toolbar pinned to the top-center of the office canvas
 * that groups the per-room collaboration tool buttons (whiteboard / doc / task board).
 *
 * Replaces the previous bottom-right cluster of individually-positioned buttons
 * (each with hard-coded right offsets) so spacing is automatic and adding a 4th
 * tool just slots into the flexbox.
 *
 * Conditional mounts: each child button only renders if the current room has
 * that tool configured (mirrors the *_ROOMS Sets in OfficeView). The bar itself
 * hides when no tools are visible for the room.
 */
import { computed } from 'vue'
import WhiteboardButton from './WhiteboardButton.vue'
import CollabDocButton from './CollabDocButton.vue'
import TaskBoardButton from './TaskBoardButton.vue'

const props = defineProps({
	roomId:         { type: String,  required: true },
	hasWhiteboard:  { type: Boolean, default: false },
	hasCollabDoc:   { type: Boolean, default: false },
	hasTaskBoard:   { type: Boolean, default: false },
})

const emit = defineEmits([
	'open-whiteboard', 'open-whiteboard-history',
	'open-doc',        'open-doc-history',
	'open-taskboard',  'open-taskboard-history',
])

const visible = computed(() =>
	props.hasWhiteboard || props.hasCollabDoc || props.hasTaskBoard
)
</script>

<template>
	<div v-if="visible" class="room-collab-bar">
		<WhiteboardButton
			v-if="hasWhiteboard"
			:room-id="roomId"
			@open="emit('open-whiteboard')"
			@open-history="emit('open-whiteboard-history')"
		/>
		<CollabDocButton
			v-if="hasCollabDoc"
			:room-id="roomId"
			@open="emit('open-doc')"
			@open-history="emit('open-doc-history')"
		/>
		<TaskBoardButton
			v-if="hasTaskBoard"
			:room-id="roomId"
			@open="emit('open-taskboard')"
			@open-history="emit('open-taskboard-history')"
		/>
	</div>
</template>

<style scoped>
.room-collab-bar {
	display: flex;
	gap: 0.375rem;
	padding: 0.375rem;
	border-radius: 0.75rem;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	backdrop-filter: blur(10px);
	box-shadow: 0 0.375rem 1.25rem rgba(0, 0, 0, 0.18);
}
</style>
