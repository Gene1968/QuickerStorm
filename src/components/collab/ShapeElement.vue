<script setup>
/**
 * ShapeElement — Draggable shape (rect, circle, line) on the whiteboard.
 */
import { ref } from 'vue'

const props = defineProps({
	shape: { type: Object, required: true },
	isSelectMode: { type: Boolean, default: true },
})

const emit = defineEmits(['update', 'delete'])

const isDragging = ref(false)
let dragStart = { x: 0, y: 0, origX: 0, origY: 0 }

function onDragStart(e) {
	if (!props.isSelectMode) return
	e.preventDefault()
	e.stopPropagation()
	isDragging.value = true
	dragStart = {
		x: e.clientX,
		y: e.clientY,
		origX: props.shape.x,
		origY: props.shape.y,
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
</script>

<template>
	<div
		class="shape-element"
		:class="{ dragging: isDragging }"
		:style="{
			left: shape.x + 'px',
			top: shape.y + 'px',
			width: shape.width + 'px',
			height: shape.height + 'px',
		}"
		@pointerdown="onDragStart"
	>
		<!-- Delete button -->
		<button class="shape-delete" @click.stop="emit('delete')" title="Delete">✕</button>

		<!-- Rectangle -->
		<svg v-if="shape.type === 'rect'" width="100%" height="100%" class="shape-svg">
			<rect
				x="2" y="2"
				:width="shape.width - 4"
				:height="shape.height - 4"
				:stroke="shape.color"
				stroke-width="2"
				fill="none"
				rx="4"
			/>
		</svg>

		<!-- Circle / Ellipse -->
		<svg v-else-if="shape.type === 'circle'" width="100%" height="100%" class="shape-svg">
			<ellipse
				:cx="shape.width / 2"
				:cy="shape.height / 2"
				:rx="shape.width / 2 - 2"
				:ry="shape.height / 2 - 2"
				:stroke="shape.color"
				stroke-width="2"
				fill="none"
			/>
		</svg>

		<!-- Line (diagonal) -->
		<svg v-else-if="shape.type === 'line'" width="100%" height="100%" class="shape-svg">
			<line
				x1="2" y1="2"
				:x2="shape.width - 2"
				:y2="shape.height - 2"
				:stroke="shape.color"
				stroke-width="2"
				stroke-linecap="round"
			/>
		</svg>
	</div>
</template>

<style scoped>
.shape-element {
	position: absolute;
	cursor: grab;
	user-select: none;
	z-index: 5;
}

.shape-element.dragging {
	cursor: grabbing;
	z-index: 15;
}

.shape-svg {
	pointer-events: none;
}

.shape-delete {
	position: absolute;
	top: -8px;
	right: -8px;
	width: 18px;
	height: 18px;
	border-radius: 50%;
	border: none;
	background: #ef4444;
	color: #fff;
	font-size: 10px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0;
	transition: opacity 0.15s;
}
.shape-element:hover .shape-delete { opacity: 1; }
</style>
