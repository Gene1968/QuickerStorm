<script setup>
import { ref, computed } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
import { useInventory } from '@/composables/useInventory'
import { useInventoryStore } from '@/stores/inventoryStore'
import HoverCursorBadge from '@/components/HoverCursorBadge.vue'
const canvasRef = ref(null)
const { hoverAction, hoverPos, altFocus, screenToGround } = useWorldEngine(canvasRef)
const { rezObject } = useInventory()
const inv = useInventoryStore()
// Alt held → force the Zoom (7) magnifier badge: Alt+click sets the camera focal point. Overrides
// any object-hover action so the focus affordance is unambiguous.
const cursorAction = computed(() => (altFocus.value ? 7 : hoverAction.value))

// Drag-to-rez: an inventory OBJECT item dragged onto the canvas rezzes at the drop point. The active
// drag lives in inventoryStore.dragPayload (set on dragstart) — dataTransfer.getData is unreadable
// during dragover, so we read the shared payload. Only single OBJECT items are droppable here.
function draggedRezItem() {
	const p = inv.dragPayload
	if (!p || p.kind !== 'item' || !p.id) return null
	const found = inv.findItem(p.id)
	// assetType 6 = OBJECT (matches useInventory ASSET_TYPE_OBJECT + context-menu isObject test).
	if (!found?.item || found.item.assetType !== 6) return null
	return p.id
}
function onDragOver(e) {
	if (!draggedRezItem()) return
	e.preventDefault()                       // allow the drop
	e.dataTransfer.dropEffect = 'copy'
}
function onDrop(e) {
	const itemId = draggedRezItem()
	if (!itemId) return
	e.preventDefault()
	const hit = screenToGround(e.clientX, e.clientY)
	if (!hit) return                         // dropped off-terrain (sky/water) — ignore
	rezObject(itemId, hit)
}
</script>

<template>
  <div class="relative w-full h-full" @dragover="onDragOver" @drop="onDrop">
    <canvas ref="canvasRef" class="w-full h-full block" />
    <HoverCursorBadge :action="cursorAction" :x="hoverPos.x" :y="hoverPos.y" />
  </div>
</template>
