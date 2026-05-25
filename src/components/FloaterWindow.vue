<script setup>
/**
 * FloaterWindow — shared wrapper for all draggable floater panels.
 *
 * Features:
 *  - Click anywhere → focus (full opacity, raised z-index)
 *  - Unfocused → 85% opacity
 *  - Titlebar drag → repositions floater; starts from CSS-centered position
 *  - × button → emits 'close'
 *
 * Usage:
 *   <FloaterWindow id="profile" title="Profile" :wrap-style="{ width:'30rem', height:'34rem' }" @close="...">
 *     <slot content />
 *   </FloaterWindow>
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { X as XIcon } from '@lucide/vue'

const props = defineProps({
	id:         { type: String,  required: true },
	title:      { type: String,  required: true },
	wrapStyle:  { type: Object,  default: () => ({}) },
	// defaultPos: CSS position object applied before first drag.
	// If null, floater opens centered. Example: { left: '0.125%', top: '7%' }
	defaultPos: { type: Object,  default: null },
})

defineEmits(['close'])

const ui = useUiStore()

// ── Focus / z-index ───────────────────────────────────────────────────────────
const isFocused = computed(() => ui.floaterStack.at(-1) === props.id)

const zIndex = computed(() => {
	const idx = ui.floaterStack.indexOf(props.id)
	// Base z-index 50; each layer above adds 1. Focused floater is always topmost.
	return idx === -1 ? 50 : 50 + idx
})

function focus() { ui.focusFloater(props.id) }

// Auto-focus on open
onMounted(() => focus())

// ── Drag ─────────────────────────────────────────────────────────────────────
const el         = ref(null)
const pos        = ref(null)           // null = CSS-centered; { x, y } = pixel pos after first drag
const dragging   = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

function onTitlebarMousedown(e) {
	if (e.button !== 0) return
	e.preventDefault()
	focus()

	// On first drag, snapshot rendered position so we can switch from CSS centering to px coords
	if (!pos.value) {
		const rect = el.value.getBoundingClientRect()
		pos.value = { x: rect.left, y: rect.top }
	}

	dragging.value = true
	dragOffset.value = { x: e.clientX - pos.value.x, y: e.clientY - pos.value.y }
	window.addEventListener('mousemove', onMousemove)
	window.addEventListener('mouseup',   onMouseup)
}

function onMousemove(e) {
	if (!dragging.value) return
	pos.value = { x: e.clientX - dragOffset.value.x, y: e.clientY - dragOffset.value.y }
}

function onMouseup() {
	dragging.value = false
	window.removeEventListener('mousemove', onMousemove)
	window.removeEventListener('mouseup',   onMouseup)
}

onUnmounted(() => {
	window.removeEventListener('mousemove', onMousemove)
	window.removeEventListener('mouseup',   onMouseup)
})

// ── Computed style / class ────────────────────────────────────────────────────
const outerClass = computed(() => [
	'fixed flex flex-col bg-card border border-brd rounded-lg shadow-2xl overflow-hidden',
	'transition-opacity duration-150',
	// CSS centering only when no defaultPos and not yet dragged
	(!pos.value && !props.defaultPos) ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : '',
	isFocused.value ? 'opacity-100' : 'opacity-[.85]',
])

const outerStyle = computed(() => ({
	zIndex: zIndex.value,
	// Drag mode: pixel coords + clear any transform from defaultPos
	...(pos.value
		? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, transform: 'none' }
		: (props.defaultPos ?? {})),
	...props.wrapStyle,
}))
</script>

<template>
	<div
		ref="el"
		:class="outerClass"
		:style="outerStyle"
		@mousedown="focus"
	>
		<!-- Titlebar / drag handle -->
		<div
			class="flex items-center justify-between px-3 py-2 bg-card2 border-b border-brd shrink-0 select-none cursor-grab active:cursor-grabbing"
			@mousedown.stop="onTitlebarMousedown"
		>
			<span class="text-sm font-semibold text-t1">{{ title }}</span>
			<button
				@click.stop="$emit('close')"
				class="p-1 rounded text-tm hover:text-t1 hover:bg-white/10 transition-colors"
				aria-label="Close"
			>
				<XIcon :size="14" />
			</button>
		</div>

		<!-- Content slot -->
		<slot />
	</div>
</template>
