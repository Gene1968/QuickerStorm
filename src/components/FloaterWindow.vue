<script setup>
/**
 * FloaterWindow — shared wrapper for all draggable floater panels.
 *
 * Features:
 *  - Click anywhere → focus (full opacity, raised z-index)
 *  - Unfocused → 85% opacity
 *  - Titlebar drag → repositions floater; starts from CSS-centered / defaultPos position
 *  - Dock button (appears once moved/resized) → returns to default position + size
 *  - Optional caret (caret-dir="up"|"down") links the floater to its opener button while docked;
 *    hidden once moved (then the Dock button is how you snap back)
 *  - × button → emits 'close'
 *
 * Layout: positioning lives on the ROOT (overflow visible, so the caret tail can poke out); the
 * border/background/rounding/overflow AND the resizable width/height live on the inner panel.
 * (CSS `resize` only works when overflow ≠ visible, so the resizable box must be the inner panel.)
 *
 * Usage:
 *   <FloaterWindow id="profile" title="Profile" :wrap-style="{ width:'30rem', height:'34rem' }" @close="...">
 *     <slot content />
 *   </FloaterWindow>
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore.js'
import { X as XIcon, ArrowDownToLine as DockIcon } from '@lucide/vue'
import { useAudio } from '@/composables/useAudio.js'

const { playSound } = useAudio()

const props = defineProps({
	id:         { type: String,  required: true },
	title:      { type: String,  required: true },
	wrapStyle:  { type: Object,  default: () => ({}) },
	// defaultPos: CSS position object applied before first drag (and restored by Dock).
	// If null, floater opens centered. Example: { left: '0.125%', top: '7%' }
	defaultPos: { type: Object,  default: null },
	// caretDir: 'up' | 'down' — draws a tail linking the floater to its opener button while it
	// sits at its default position. null = no caret (most floaters have no opener button).
	caretDir:   { type: String,  default: null },
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
	if (panel.value && 'ResizeObserver' in window) {
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
			if (w && h) {
				size.value = { w: Math.round(w), h: Math.round(h) }
				// First measure after mount / after Dock = the default size baseline used to detect
				// a later user-resize (so the Dock button can appear for resize, not just drag).
				if (!baselineSize.value) baselineSize.value = size.value
			}
		})
		ro.observe(panel.value)
	}
})

// ── Drag ─────────────────────────────────────────────────────────────────────
const el         = ref(null)           // root (positioning + caret host)
const panel      = ref(null)           // inner panel (chrome + resizable size)
const pos        = ref(null)           // null = default position; { x, y } = pixel pos after first drag
const dragging   = ref(false)
const dragOffset = ref({ x: 0, y: 0 })

// ── Resize persistence ─────────────────────────────────────────────────────────
// WHY: CSS `resize:both` writes width/height to the panel, but panelStyle re-applies wrapStyle's
// base width/height on every recompute (e.g. z-index change when the floater is focused on a tab
// click), wiping the user's manual resize. A ResizeObserver captures the live border-box size and
// feeds it back through panelStyle, so re-patches are idempotent and the resize sticks.
const size         = ref(null)         // { w, h } px — null until first measure
const baselineSize = ref(null)         // default size, for detecting a user resize
let ro = null

// Moved = dragged OR resized away from the default. Drives the Dock button + hides the caret.
const moved = computed(() => {
	if (pos.value) return true
	const b = baselineSize.value, s = size.value
	return !!(b && s && (Math.abs(s.w - b.w) > 2 || Math.abs(s.h - b.h) > 2))
})

const showCaret = computed(() => !!props.caretDir && !moved.value)

// Return the floater to its default position + size. Clearing size → panelStyle falls back to
// wrapStyle's base dimensions; clearing baselineSize lets the next ResizeObserver tick re-baseline.
function dock() {
	pos.value = null
	size.value = null
	baselineSize.value = null
	focus()
}

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
	ui.floaterStack = ui.floaterStack.filter(f => f !== props.id)
})

// ── Computed style / class ────────────────────────────────────────────────────
const rootClass = computed(() => [
	'fixed transition-opacity duration-150',
	// CSS centering only when no defaultPos and not yet dragged
	(!pos.value && !props.defaultPos) ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2' : '',
	isFocused.value ? 'opacity-100' : 'opacity-[.85]',
	// WHY: position:fixed escapes any parent display:none, so v-show on a wrapper won't hide
	// these. Toggle UI visibility (Ctrl+Alt+F1) requires hiding directly on each floater.
	!ui.uiVisible ? 'invisible pointer-events-none' : '',
])

const rootStyle = computed(() => ({
	zIndex: zIndex.value,
	// Drag mode: pixel coords + clear any transform from defaultPos
	...(pos.value
		? { left: `${pos.value.x}px`, top: `${pos.value.y}px`, transform: 'none' }
		: (props.defaultPos ?? {})),
}))

const panelStyle = computed(() => ({
	...props.wrapStyle,
	// WHY: once measured, drive width/height from the live size so a re-patch (focus/z-index change)
	// reuses the user's resized dimensions instead of resetting to wrapStyle's base values.
	...(size.value ? { width: `${size.value.w}px`, height: `${size.value.h}px` } : {}),
}))
</script>

<template>
	<div
		ref="el"
		:class="rootClass"
		:style="rootStyle"
		@mousedown="focus"
	>
		<!-- Caret tail linking floater to its opener button (only while docked at default) -->
		<div v-if="showCaret" class="fw-caret" :class="caretDir" />

		<!-- Panel: border/bg/rounding/overflow + the resizable size live here -->
		<div
			ref="panel"
			class="flex flex-col border border-edge rounded-lg bg-panel shadow-2xl overflow-hidden"
			:style="panelStyle"
		>
			<!-- Titlebar / drag handle -->
			<div
				class="flex items-center justify-between ps-3 bg-panel-alt border-b border-edge shrink-0 select-none cursor-grab active:cursor-grabbing"
				@mousedown.stop="onTitlebarMousedown"
			>
				<span class="text-xs font-semibold tracking-wider text-fg">{{ title }}</span>
				<div class="flex items-center gap-0.5">
					<!-- Dock: return to default position + size; only shown once moved/resized -->
					<button
						v-if="moved"
						@click.stop="dock"
						class="p-1 px-2 rounded-sm text-fg-muted hover:text-fg hover:bg-white/10 transition-colors"
						title="Dock — return to default position"
						aria-label="Dock"
					>
						<DockIcon :size="14" />
					</button>
					<button
						@click.stop="$emit('close')"
						class="p-1 px-2 rounded-sm text-fg-muted hover:text-fg hover:bg-white/10 transition-colors"
						aria-label="Close"
					>
						<XIcon :size="14" />
					</button>
				</div>
			</div>

			<!-- Content slot -->
			<!-- WHY: min-h-0 lets the flex-1 content area respect the floater's fixed height so inner
				`flex-1 min-h-0 overflow-y-auto` regions actually scroll instead of overflowing past
				the bottom edge (which hid the footer). -->
			<div class="floater flex flex-col flex-1 min-h-0">
				<slot />
			</div>
		</div>
	</div>
</template>

<style scoped>
/* Caret tail — bordered + filled triangle, matches the panel border/bg, points at the opener. */
.fw-caret {
	position: absolute;
	right: 1.25rem;
	width: 1rem;
	height: 0.5625rem;
	z-index: 1;
}
.fw-caret.up   { top: -0.4rem; }
.fw-caret.down { bottom: -0.4rem; }
.fw-caret::before,
.fw-caret::after {
	content: '';
	position: absolute;
	left: 0;
	width: 0;
	height: 0;
	border-left: 0.5625rem solid transparent;
	border-right: 0.5625rem solid transparent;
}
/* up → points up: colored bottom border */
.fw-caret.up::before { top: -1px; border-bottom: 8px solid var(--edge); }
.fw-caret.up::after  { top: 0;    border-bottom: 7px solid var(--panel); }
/* down → points down: colored top border */
.fw-caret.down::before { bottom: -1px; border-top: 8px solid var(--edge); }
.fw-caret.down::after  { bottom: 0;    border-top: 7px solid var(--panel); }
</style>
