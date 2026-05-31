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
import { useAudio } from '@/composables/useAudio.js'

const { playSound } = useAudio()

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
onMounted(() => {
	focus()
	playSound('pop.mp3', 0.7)
	if (el.value && 'ResizeObserver' in window) {
		ro = new ResizeObserver((entries) => {
			const e = entries[0]
			// Prefer border-box (box-sizing:border-box globally) so feeding the value back doesn't
			// drift smaller each cycle the way content-box would.
			let w, h
			if (e.borderBoxSize && e.borderBoxSize.length) {
				w = e.borderBoxSize[0].inlineSize
				h = e.borderBoxSize[0].blockSize
			} else {
				w = e.contentRect.width
				h = e.contentRect.height
			}
			// WHY: skip when element is hidden (display:none or visibility:hidden collapses
			// position:fixed in some browsers); persisting 0×0 would freeze the floater
			// at zero dimensions after Ctrl+Alt+F1 restores the UI.
			if (w && h) size.value = { w: Math.round(w), h: Math.round(h) }
		})
		ro.observe(el.value)
	}
})

// ── Drag ─────────────────────────────────────────────────────────────────────
const el         = ref(null)
const pos        = ref(null)           // null = CSS-centered; { x, y } = pixel pos after first drag
const dragging   = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

// ── Resize persistence ─────────────────────────────────────────────────────────
// WHY: CSS `resize:both` writes width/height to the element, but outerStyle re-applies wrapStyle's
// base width/height on every recompute (e.g. z-index change when the floater is focused on a tab
// click), wiping the user's manual resize. A ResizeObserver captures the live border-box size and
// feeds it back through outerStyle, so re-patches are idempotent and the resize sticks.
const size = ref(null)                 // { w, h } px — null until first measure
let ro = null

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
	playSound('pop.mp3', 0.7)
	ro?.disconnect()
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
	// WHY: position:fixed escapes any parent display:none, so v-show on a wrapper won't hide
	// these. Toggle UI visibility (Ctrl+Alt+F1) requires hiding directly on each floater.
	!ui.uiVisible ? 'invisible pointer-events-none' : '',
])

const outerStyle = computed(() => ({
	zIndex: zIndex.value,
	// Drag mode: pixel coords + clear any transform from defaultPos
	...(pos.value
		? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, transform: 'none' }
		: (props.defaultPos ?? {})),
	...props.wrapStyle,
	// WHY: once measured, drive width/height from the live size so a re-patch (focus/z-index change)
	// reuses the user's resized dimensions instead of resetting to wrapStyle's base values.
	...(size.value ? { width: `${size.value.w}px`, height: `${size.value.h}px` } : {}),
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
			class="flex items-center justify-between p-1 ps-3 bg-card2 border-b border-brd shrink-0 select-none cursor-grab active:cursor-grabbing"
			@mousedown.stop="onTitlebarMousedown"
		>
			<span class="text-sm font-semibold text-t1">{{ title }}</span>
			<button
				@click.stop="$emit('close')"
				class="p-1 px-2 rounded text-tm hover:text-t1 hover:bg-white/10 transition-colors"
				aria-label="Close"
			>
				<XIcon :size="14" />
			</button>
		</div>

		<!-- Content slot -->
		<!-- WHY: min-h-0 lets the flex-1 content area respect the floater's fixed height so inner
		     `flex-1 min-h-0 overflow-y-auto` regions actually scroll instead of overflowing past
		     the bottom edge (which hid the footer). -->
		<div class="floater flex flex-col flex-1 min-h-0">
			<slot />
		</div>
	</div>
</template>

<style scoped>
</style>
