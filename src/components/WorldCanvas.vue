<script setup>
import { ref, computed } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
import { useInventory } from '@/composables/useInventory'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useNotifications } from '@/composables/useNotifications'
import { resolveRezzableAnchor } from '@/utils/rezzableAnchor'
import HoverCursorBadge from '@/components/HoverCursorBadge.vue'
const canvasRef = ref(null)
const { hoverAction, hoverPos, altFocus, screenToDropPoint } = useWorldEngine(canvasRef)
const { rezObject } = useInventory()
const inv = useInventoryStore()
const { notifyInfo } = useNotifications()
// Alt held → force the Zoom (7) magnifier badge: Alt+click sets the camera focal point. Overrides
// any object-hover action so the focus affordance is unambiguous.
const cursorAction = computed(() => (altFocus.value ? 7 : hoverAction.value))

// Drag-to-rez: an inventory OBJECT item dragged onto the canvas rezzes at the drop point. The active
// drag lives in inventoryStore.dragPayload (set on dragstart) — dataTransfer.getData is unreadable
// during dragover, so we read the shared payload. Anchor resolution (multi-drag rejected per FS
// single-drop rule, folder anchor rejected) lives in resolveRezzableAnchor — pure + unit-tested.
function onDragOver(e) {
	// Accept whenever ANY inventory drag is live: a non-rezzable payload must still be "accepted"
	// here, or the browser never fires `drop` and we can't explain the rejection with a toast.
	if (!inv.dragPayload) return
	e.preventDefault()                       // allow the drop
	e.dataTransfer.dropEffect = 'copy'
}
function onDrop(e) {
	const p = inv.dragPayload
	if (!p) return
	e.preventDefault()
	inv.clearDrag()                          // drag ends either way — same semantics as the give zones
	const res = resolveRezzableAnchor(p, inv.findItem)
	if (!res.itemId) {
		// 'multi' mirrors FS TooltipMustSingleDrop ("Only a single item can be dragged here",
		// strings.xml:297) — FS refuses multi-cargo world drops (lltooldraganddrop.cpp:674-681).
		if (res.reason === 'multi') notifyInfo('Cannot rez', 'Only one item can be dragged here at a time.')
		else if (res.reason === 'folder') notifyInfo('Cannot rez', "Folders can't be rezzed — drag a single object item.")
		else if (res.reason === 'not-object') notifyInfo('Cannot rez', 'Only object items can be rezzed in-world.')
		return                               // 'none' = no anchor at all — nothing to explain
	}
	// Prim-surface hit first, terrain fallback (dropping onto a table rezzes ON the table).
	const hit = screenToDropPoint(e.clientX, e.clientY)
	if (!hit) {
		notifyInfo('Cannot rez there', 'Drop point missed the world (sky or water) — drop onto ground or an object.')
		return
	}
	rezObject(res.itemId, hit)
}
</script>

<template>
  <div class="relative w-full h-full" @dragenter.prevent @dragover="onDragOver" @drop="onDrop">
    <canvas ref="canvasRef" class="w-full h-full block" />
    <HoverCursorBadge :action="cursorAction" :x="hoverPos.x" :y="hoverPos.y" />
  </div>
</template>
