<script setup>
/**
 * CursorOverlay — Shows remote users' cursor positions on the whiteboard.
 *
 * Renders named cursor indicators from the Yjs awareness state.
 */
import { ref, watch, onUnmounted } from 'vue'

const props = defineProps({
	awareness: { type: Object, required: true },
})

const cursors = ref([])

// Listen for awareness changes
let unsubscribe = null
if (props.awareness) {
	unsubscribe = props.awareness.onChange((states) => {
		const result = []
		for (const [clientId, state] of states) {
			if (!state || state.x == null || state.y == null) continue
			if (clientId === props.awareness.clientId) continue
			result.push({
				clientId,
				x: state.x,
				y: state.y,
				userName: state.userName || 'User',
				color: state.color || '#6366f1',
			})
		}
		cursors.value = result
	})
}

onUnmounted(() => {
	if (unsubscribe) unsubscribe()
})
</script>

<template>
	<div class="cursor-overlay">
		<div
			v-for="cursor in cursors"
			:key="cursor.clientId"
			class="remote-cursor"
			:style="{ left: cursor.x + 'px', top: cursor.y + 'px' }"
		>
			<svg
				width="16" height="16" viewBox="0 0 16 16"
				:style="{ color: cursor.color }"
			>
				<path d="M0 0l6 14 2-6 6-2L0 0z" fill="currentColor"/>
			</svg>
			<span class="cursor-label" :style="{ background: cursor.color }">
				{{ cursor.userName }}
			</span>
		</div>
	</div>
</template>

<style scoped>
.cursor-overlay {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 50;
	overflow: hidden;
}

.remote-cursor {
	position: absolute;
	pointer-events: none;
	transition: left 0.08s linear, top 0.08s linear;
}

.cursor-label {
	display: block;
	margin-left: 14px;
	margin-top: -2px;
	font-size: 10px;
	padding: 1px 5px;
	border-radius: 3px;
	color: #fff;
	white-space: nowrap;
	font-weight: 500;
}
</style>
