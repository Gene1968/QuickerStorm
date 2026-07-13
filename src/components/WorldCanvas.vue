<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
import { initSoundEngine } from '@/composables/useSoundEngine'
import { useInventory, ASSET_TYPE_TEXTURE } from '@/composables/useInventory'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useWorldStore } from '@/stores/worldStore'
import { useUiStore } from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useLLUDP } from '@/composables/useLLUDP'
import { useNotifications } from '@/composables/useNotifications'
import { resolveRezzableAnchor } from '@/utils/rezzableAnchor'
import { faceCountFor, composeFaceTable, canModifyForTexture } from '@/utils/textureFaceDrop'
import { getPrimShape } from '@/lib/primShapes.js'
import HoverCursorBadge from '@/components/HoverCursorBadge.vue'
const canvasRef = ref(null)
const { hoverAction, hoverPos, altFocus, screenToDropPoint, pickObjectFace } = useWorldEngine(canvasRef)
initSoundEngine()   // in-world sound engine (S-4..S-6) — idempotent, wires WS handlers + tick
const { rezObject } = useInventory()
const inv = useInventoryStore()
const world = useWorldStore()
const ui = useUiStore()
const session = useSessionStore()
const { createPrim, setObjectTexture } = useLLUDP()
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
// Texture-onto-a-face drop (PACKAGE 5): a single TEXTURE item dropped over a hit prim face applies
// it there (or to every face with Shift held — FS MASK_SHIFT, lltooldraganddrop.cpp:2841), instead
// of rezzing. FS ref: dad3dTextureObject :2867 → dad3dApplyToObject :2729-2864.
function applyTextureDrop(item, hit, allFaces) {
	const obj = world.objects.get(hit.localId)
	if (!obj) return
	// Mirrors the texture-preview floater's guard (useInventory.js openInventoryItem) — a texture row
	// with no resolvable asset id has nothing to apply.
	if (!item.assetId) {
		notifyInfo('Cannot apply texture', 'This texture has no asset to apply yet.')
		return
	}
	// Perm gate (FS :2755-2758 !obj->permModify() → ACCEPT_NO_LOCKED); unknown perms → allow, the
	// sim stays authoritative (CanEditObject Modify — OpenSim PermissionsModule.cs:1354).
	if (!canModifyForTexture(obj, session.agentId)) {
		notifyInfo('Cannot apply texture', 'You do not have permission to modify this object.')
		return
	}
	// No-copy/no-transfer textures need task-inventory insertion first (FS handleDropMaterialProtections
	// :952-1099) — we have no UpdateTaskInventory wire yet. Deliberate cut, see docs/FEATURE-GAPS.md 2026-07-13.
	if (item.canCopy === false || item.canTransfer === false) {
		notifyInfo('Cannot apply texture', "Applying a no-copy/no-transfer texture isn't supported yet.")
		return
	}
	const numFaces = faceCountFor(obj)
	if (numFaces <= 0 || hit.teFace >= numFaces) {
		notifyInfo('Cannot apply texture', "This object's face layout isn't supported for texture drops yet.")
		return
	}
	// Whole-TE replace (OpenSim SceneObjectPart.cs:5118): build every currently-effective face value,
	// then swap only the texture on the target face(s) — never send a partial/guessed table.
	const faces = composeFaceTable(obj, numFaces)
	if (allFaces) faces.forEach(f => { f.textureId = item.assetId })
	else faces[hit.teFace].textureId = item.assetId
	// Optimistic repaint: merge the new per-face textures into the store, then trigger the SAME live
	// re-apply path ObjectContextMenu's "Texture refresh" already uses (uiStore.requestTextureRefresh →
	// useWorldEngine's refreshObjectTextures rebuilds per-face materials straight from store state) —
	// reused rather than duplicated so the drop is visible immediately without waiting on the sim echo.
	world.upsertObject({ localId: hit.localId, faceTextures: faces.map(f => f.textureId) })
	ui.requestTextureRefresh(hit.localId)
	setObjectTexture(hit.localId, faces)
	notifyInfo('Texture applied', `Applied ${item.name || 'the texture'} to ${allFaces ? 'all faces' : 'the face'}.`)
}

function onDrop(e) {
	const p = inv.dragPayload
	if (!p) return
	e.preventDefault()
	inv.clearDrag()                          // drag ends either way — same semantics as the give zones
	// A single TEXTURE item over a hit prim face is a texture-apply, not a rez (see applyTextureDrop).
	// Multi-cargo still refused below (same FS TooltipMustSingleDrop rule as the rez path). A texture
	// dropped where no face is hit (sky/water/terrain) falls through to the unchanged rez path, which
	// refuses it as 'not-object' — FS's DAD_TEXTURE on DT_LAND is dad3dNULL (lltooldraganddrop.cpp:279),
	// also a no-op, so the existing toast already matches FS behavior for that case.
	if ((p.count ?? p.ids?.length ?? 1) === 1 && p.kind !== 'folder') {
		const found = inv.findItem(p.id)
		if (found?.item?.assetType === ASSET_TYPE_TEXTURE) {
			const hit = pickObjectFace(e.clientX, e.clientY)
			if (hit) { applyTextureDrop(found.item, hit, e.shiftKey); return }
		}
	}
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
	// FS-parity placement (lltooldraganddrop.cpp:1963-2003 dropObject): let the SIM raycast from
	// the camera through the drop point (BypassRaycast=0) — it lands the object ON the first
	// surface, offset by the object's extents, instead of embedding its center AT the client hit.
	// RayTargetID = the prim the client ray hit (sim raycasts against that object specifically).
	rezObject(res.itemId, hit, {
		rayStart: hit.rayStart ?? undefined,
		rayTargetId: hit.hitLocalId != null ? world.objects.get(hit.hitLocalId)?.fullId : undefined,
		bypassRaycast: false,
	})
}

// ── Create tool placement (Package 3) ───────────────────────────────────────
// FS parity: LLToolPlacer::addObject (lltoolplacer.cpp:220-528) — the sim runs its OWN raycast
// RayStart→RayEnd and lands the prim on the surface (OpenSim Scene.cs:2376-2535), replying with a
// full ObjectUpdate or an AlertMessage "You cannot create objects here." on parcel-perm refusal
// (Scene.cs:2562) — AlertMessage→toast already exists elsewhere, no watchdog needed here.
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const buildCursorClass = computed(() => (ui.buildPlacementArmed ? 'cursor-crosshair' : ''))

function onCanvasClick(e) {
	if (!ui.buildPlacementArmed) return
	// Consume the click so it doesn't fall through to avatar-walk/selection (the engine-side arm
	// guard is Package 2's job on mousedown; this stops OUR click from doing anything else, same
	// as onDrop above stopping the browser's native drop behavior).
	e.preventDefault()
	e.stopPropagation()
	const hit = screenToDropPoint(e.clientX, e.clientY)
	if (!hit) return   // sky/water miss — stay armed, let the user re-aim (not an error worth a toast)
	const shape = getPrimShape(ui.buildShape) ?? getPrimShape('cube')
	const rayTargetId = hit.hitLocalId != null ? (world.objects.get(hit.hitLocalId)?.fullId ?? ZERO_UUID) : ZERO_UUID
	createPrim({
		...shape,
		material: 3,            // wood — FS default (material_codes.h:36; lltoolplacer.cpp:259-267)
		addFlags: 2,             // FLAGS_CREATE_SELECTED (object_flags.h:32)
		scale: [0.5, 0.5, 0.5],  // FS FSBuildPrefs default (lltoolplacer.cpp:79 DEFAULT_OBJECT_SCALE)
		bypassRaycast: hit.hitLocalId != null ? 0 : 1, // packs b_hit_land (lltoolplacer.cpp:503)
		rayStart: hit.rayStart,
		rayEnd: [hit.x, hit.y, hit.z],
		rayTargetId,
		rayEndIsIntersection: 0,
		state: 0,
	})
	// FS auto-selects the newborn prim when its CreateSelected update arrives (we sent addFlags
	// FLAGS_CREATE_SELECTED above) — arm the one-shot expectation the engine ingest consumes.
	ui.expectCreatedSelection()
	if (!ui.buildKeepTool) ui.disarmBuildPlacement()
}

function onKeydown(e) {
	if (e.key === 'Escape' && ui.buildPlacementArmed) ui.disarmBuildPlacement()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// Drag-select marquee overlay (2026-07-13 gizmo sweep, item 6) — pure render of useWorldEngine's
// uiStore.marqueeRect (client-px screen rect, same coordinate convention as hoverPos/avatarMenu).
// All the hit-testing/selection logic lives in the engine; this component only draws the box.
const marqueeStyle = computed(() => {
	const r = ui.marqueeRect
	if (!r) return null
	return {
		left:   `${r.x0}px`,
		top:    `${r.y0}px`,
		width:  `${r.x1 - r.x0}px`,
		height: `${r.y1 - r.y0}px`,
	}
})
</script>

<template>
  <div class="relative w-full h-full" @dragenter.prevent @dragover="onDragOver" @drop="onDrop" @click="onCanvasClick">
    <canvas ref="canvasRef" class="w-full h-full block" :class="buildCursorClass" />
    <HoverCursorBadge :action="cursorAction" :x="hoverPos.x" :y="hoverPos.y" />
    <div
      v-if="marqueeStyle"
      class="fixed z-[200] pointer-events-none border border-accent bg-accent/10"
      :style="marqueeStyle"
    />
  </div>
</template>

<style scoped>
.cursor-crosshair {
	cursor: crosshair;
}
</style>
