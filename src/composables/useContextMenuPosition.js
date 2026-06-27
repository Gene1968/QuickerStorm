// Shared positioning for right-click context menus (Object / Avatar / Inventory).
//
// WHY: the old per-menu `style` computed clamped x/y against a *guessed* fixed
// MENU_W/MENU_H, so a tall menu still ran off the bottom. This measures the menu's
// real rendered size after it opens and slides it back on-screen on BOTH axes — so it
// swaps upward near the screen bottom just like it already slid left near the right
// edge (FS does the same). Re-measures whenever `anchor` changes or `reflow()` is
// called (e.g. after an inline panel like Inspect toggles the height).
import { ref, watch, nextTick } from 'vue'

const MARGIN = 8

export function useContextMenuPosition(anchor) {
	const el = ref(null)          // bind to the menu root element
	const style = ref({})

	async function place() {
		const a = anchor.value
		if (!a) { style.value = {}; return }
		// First paint at the raw point but hidden, so we can measure before it flashes.
		style.value = { left: `${a.x}px`, top: `${a.y}px`, visibility: 'hidden' }
		await nextTick()
		const node = el.value
		if (!node) return
		const r = node.getBoundingClientRect()
		const vw = window.innerWidth
		const vh = window.innerHeight
		const left = Math.max(MARGIN, Math.min(a.x, vw - r.width - MARGIN))
		const top  = Math.max(MARGIN, Math.min(a.y, vh - r.height - MARGIN))
		style.value = { left: `${left}px`, top: `${top}px` }
	}

	// Re-place when the menu opens / moves to a new point.
	watch(anchor, place, { immediate: true })

	// Callers invoke this after a content change that alters height (e.g. Inspect panel).
	function reflow() { place() }

	return { el, style, reflow }
}
