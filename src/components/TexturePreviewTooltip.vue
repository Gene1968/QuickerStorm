<script>
// TexturePreviewTooltip — a 256px-square floating preview for a texture inventory item.
// Presentational only: the caller owns the hover timer + on-demand fetch (via
// useInventoryThumbnail's thumbnailFor) and passes the resolved object-URL down as `src`.
// WHY position:fixed — the tree row lives in a scrollable floater; fixed coords from the
// cursor keep the preview pinned to the viewport regardless of the row's scroll position.

export const PREVIEW_SIZE = 256   // px, square — FS inventory texture preview size
const CURSOR_OFFSET = 18          // px gap so the preview never sits under the pointer
const EDGE_MARGIN   = 8           // px keep-clear from the viewport edge

// Pure: given the cursor position and viewport size, return the top-left {x,y} for a
// PREVIEW_SIZE square placed near the cursor but kept fully on-screen.
// WHY exported — this is the unit-testable core (no DOM needed).
export function clampPreviewPosition(cursorX, cursorY, viewW, viewH, size = PREVIEW_SIZE) {
	// Prefer down-right of the cursor; flip to the other side if it would overflow.
	let x = cursorX + CURSOR_OFFSET
	if (x + size + EDGE_MARGIN > viewW) x = cursorX - CURSOR_OFFSET - size
	let y = cursorY + CURSOR_OFFSET
	if (y + size + EDGE_MARGIN > viewH) y = cursorY - CURSOR_OFFSET - size
	// Final clamp so we never go off the top/left even on tiny viewports.
	x = Math.max(EDGE_MARGIN, Math.min(x, viewW - size - EDGE_MARGIN))
	y = Math.max(EDGE_MARGIN, Math.min(y, viewH - size - EDGE_MARGIN))
	return { x, y }
}
</script>

<script setup>
const props = defineProps({
	// Resolved object-URL (or null while the on-demand fetch is in flight).
	src: { type: String, default: null },
	// Viewport top-left, already clamped on-screen by the caller.
	x:   { type: Number, default: 0 },
	y:   { type: Number, default: 0 },
})
</script>

<template>
	<div
		class="fixed z-[2000] rounded-md overflow-hidden border border-brd shadow-lg pointer-events-none"
		:style="{ left: `${x}px`, top: `${y}px`, width: '16rem', height: '16rem' }"
	>
		<div class="bgtrans w-full h-full">
			<img
				v-if="src"
				:src="src"
				class="w-full h-full object-cover"
				alt=""
			/>
			<!-- Spinner-free placeholder while the fetch resolves; checkerboard hint of an image area. -->
			<div v-else class="w-full h-full flex items-center justify-center text-2xs italic text-fg/40">
				Loading preview…
			</div>
		</div>
	</div>
</template>

<style scoped>
.bgtrans {
	background-color: #444444ff;
	background-image: url('@/assets/img/bg-for-trans-imgs.webp');
	background-repeat: repeat;
	background-size: auto;
}
</style>
