<script setup>
/**
 * DrawingCanvas — HTML5 Canvas for freehand drawing on the whiteboard.
 *
 * Renders existing strokes and captures new freehand input.
 * Emits stroke-complete with the array of points when the user lifts the pen.
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({
	strokes: { type: Array, default: () => [] },
	activeTool: { type: String, default: 'select' },
	penColor: { type: String, default: '#1e293b' },
	penWidth: { type: Number, default: 3 },
})

const emit = defineEmits(['stroke-complete', 'stroke-erase'])

const canvasRef = ref(null)
let ctx = null
let isDrawing = false
let currentPoints = []
let animFrame = null

// ── Canvas setup ────────────────────────────────────────────────────────
onMounted(() => {
	resizeCanvas()
	window.addEventListener('resize', resizeCanvas)
})

onUnmounted(() => {
	window.removeEventListener('resize', resizeCanvas)
	if (animFrame) cancelAnimationFrame(animFrame)
})

function resizeCanvas() {
	const canvas = canvasRef.value
	if (!canvas) return
	const parent = canvas.parentElement
	canvas.width = parent.clientWidth
	canvas.height = parent.clientHeight
	ctx = canvas.getContext('2d')
	redraw()
}

// ── Redraw all strokes ──────────────────────────────────────────────────
function redraw() {
	if (!ctx || !canvasRef.value) return
	const { width, height } = canvasRef.value
	ctx.clearRect(0, 0, width, height)

	for (const stroke of props.strokes) {
		drawStroke(stroke)
	}
}

function drawStroke(stroke) {
	if (!ctx || !stroke.points || stroke.points.length < 2) return
	ctx.beginPath()
	ctx.strokeStyle = stroke.color || '#1e293b'
	ctx.lineWidth = stroke.width || 2
	ctx.lineCap = 'round'
	ctx.lineJoin = 'round'

	ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
	for (let i = 1; i < stroke.points.length; i++) {
		// Smooth with quadratic bezier for nicer curves
		const prev = stroke.points[i - 1]
		const curr = stroke.points[i]
		const mx = (prev.x + curr.x) / 2
		const my = (prev.y + curr.y) / 2
		ctx.quadraticCurveTo(prev.x, prev.y, mx, my)
	}
	ctx.stroke()
}

// Re-render when strokes change
watch(() => props.strokes, redraw, { deep: true })

// ── Drawing input ───────────────────────────────────────────────────────
function onPointerDown(e) {
	if (props.activeTool !== 'pen' && props.activeTool !== 'eraser') return
	isDrawing = true
	currentPoints = [getPoint(e)]
	canvasRef.value?.setPointerCapture(e.pointerId)

	// Eraser: check for hit immediately on click
	if (props.activeTool === 'eraser') {
		eraseAt(currentPoints[0])
	}
}

function onPointerMove(e) {
	if (!isDrawing) return
	const point = getPoint(e)
	currentPoints.push(point)

	if (props.activeTool === 'eraser') {
		eraseAt(point)
		return
	}

	// Draw the in-progress stroke live
	if (currentPoints.length >= 2) {
		const prev = currentPoints[currentPoints.length - 2]
		ctx.beginPath()
		ctx.strokeStyle = props.penColor
		ctx.lineWidth = props.penWidth
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		ctx.moveTo(prev.x, prev.y)
		ctx.lineTo(point.x, point.y)
		ctx.stroke()
	}
}

function onPointerUp(e) {
	if (!isDrawing) return
	isDrawing = false
	canvasRef.value?.releasePointerCapture(e.pointerId)

	if (props.activeTool === 'pen' && currentPoints.length >= 2) {
		emit('stroke-complete', [...currentPoints])
	}
	currentPoints = []
	// Redraw to show the finalized stroke from Yjs
	nextTick(redraw)
}

/**
 * Eraser: find strokes near a given point and emit erase events.
 * Uses a proximity threshold against each stroke's points.
 */
function eraseAt(point) {
	const threshold = 12
	for (const stroke of props.strokes) {
		if (!stroke.points) continue
		for (const p of stroke.points) {
			const dx = p.x - point.x
			const dy = p.y - point.y
			if (dx * dx + dy * dy < threshold * threshold) {
				emit('stroke-erase', stroke.id)
				break
			}
		}
	}
}

function getPoint(e) {
	const rect = canvasRef.value.getBoundingClientRect()
	return {
		x: e.clientX - rect.left,
		y: e.clientY - rect.top,
	}
}
</script>

<template>
	<canvas
		ref="canvasRef"
		class="drawing-canvas"
		:class="{ drawing: activeTool === 'pen' || activeTool === 'eraser' }"
		@pointerdown="onPointerDown"
		@pointermove="onPointerMove"
		@pointerup="onPointerUp"
		@pointercancel="onPointerUp"
	/>
</template>

<style scoped>
.drawing-canvas {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
	z-index: 1;
}

.drawing-canvas.drawing {
	pointer-events: auto;
	cursor: crosshair;
}
</style>
