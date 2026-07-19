<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useGridSocialStore } from '@/stores/gridSocialStore'
import { useSocial } from '@/composables/useSocial'
import { getTextureUrl } from '@/composables/useTextureFetch.js'
import { setObjectAlphaMode } from '@/composables/useWorldEngine.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useLLUDP } from '@/composables/useLLUDP'
import { aggregateBit, PERM_TRANSFER, PERM_MODIFY, PERM_COPY, PERM_EXPORT, PERM_MOVE, PF_EVERYONE, PF_NEXT_OWNER } from '@/utils/objectPermissions.js'
import { nextOwnerCopyTentative, nextOwnerTransferTentative, everyoneCopyTentative, everyoneMoveEditable, everyoneCopyEditable, everyoneExportEditable, lockedFromOwnerMask } from '@/components/permCheckboxState.js'
import { C } from '@shared/protocol.js'
import { quatToEulerDeg, eulerDegToQuat } from '@/utils/eulerQuat.js'
import { canLinkGate, canUnlinkGate } from '@/utils/linkGating'
import { useNotificationStore } from '@/stores/notificationStore'
import { itemIcon } from '@/utils/inventoryIcons.js'
import { useTaskInventory } from '@/composables/useTaskInventory'
import { PRIM_SHAPE_KEYS } from '@/lib/primShapes.js'
import { displayParams, uiToWireParams } from '@/lib/primParams.js'
import FloaterWindow from '@/components/FloaterWindow.vue'
import PermCheckbox from '@/components/PermCheckbox.vue'
import { ZoomInIcon, HandIcon, SquareMousePointerIcon, WandIcon, PickaxeIcon, ChevronLeftIcon, ChevronRightIcon, XIcon, CopyIcon, ClipboardCopyIcon, ClipboardPasteIcon } from '@lucide/vue'
// import { ChevronDownIcon } from '@lucide/vue'

const ui    = useUiStore()
const world = useWorldStore()
const session = useSessionStore()
const social  = useGridSocialStore()
const { requestNames } = useSocial()
const { emit } = useRealtimeSocket()

const activeTab = ref('general')
// Texture-tab sub-tab: 'bp' = Blinn-Phong (legacy diffuse/normal/specular), 'pbr' = GLTF PBR.
const texSubTab = ref('bp')

// WHY: FS-parity Build Tools. Top row = the five major tools (Focus/Move/Edit/Create/Land) as a
// radio group; Edit is the default while editing. Focus/Create/Land are to-do stubs (disabled).
// The Move/Rotate/Stretch sub-row below selects the gizmo operation (uiStore.gizmoMode), which is
// also driven by Ctrl / Ctrl+Shift modifier keys in useWorldEngine.
const buildTool = ref('edit')
const tools = [
	{ id: 'focus',  label: 'Focus',  icon: ZoomInIcon },
	{ id: 'move',   label: 'Move',   icon: HandIcon },
	{ id: 'edit',   label: 'Edit',   icon: SquareMousePointerIcon },
	{ id: 'create', label: 'Create', icon: WandIcon },
	{ id: 'land',   label: 'Land',   icon: PickaxeIcon  },
]
function pickTool(t) {
	if (t.disabled) return
	buildTool.value = t.id
}
// WHY: FS arms the Create tool the moment the tab is picked (the highlighted default shape IS the
// armed shape — no extra click needed, Gene 2026-07-13); leaving the tab (or closing the floater,
// see close()) disarms so a later canvas click can't surprise-rez.
watch(buildTool, (t) => {
	if (t === 'create') ui.armBuildPlacement(ui.buildShape)
	else ui.disarmBuildPlacement()
})
// FS flips Create → Edit after a successful place when "Keep tool selected" is off (the rez
// handler in WorldCanvas disarms; we mirror that back onto the tool tabs so the floater shows
// the Edit tool for the incoming CreateSelected prim). Esc-disarm routes through here too.
watch(() => ui.buildPlacementArmed, (armed) => {
	if (!armed && buildTool.value === 'create' && !ui.buildKeepTool) buildTool.value = 'edit'
})

// Gizmo operation radios — tied to uiStore.gizmoMode (and the Ctrl / Ctrl+Shift modifiers).
const gizmoOps = [
	{ id: 'move',   label: 'Move',    hint: 'Position handles' },
	{ id: 'rotate', label: 'Rotate (Ctrl)',  hint: 'Rotation rings' },
	{ id: 'scale',  label: 'Stretch (Ctrl+Shift)', hint: 'Scale handles' },
	{ id: 'scale',  label: 'Select Face (to-do)', hint: 'to-do' },
	{ id: 'scale',  label: 'Align (to-do)', hint: 'to-do' },
]
const obj       = computed(() => ui.editObjectId ? world.objects.get(ui.editObjectId) : null)

// ── Editable Name / Description (General tab) → ObjectName (107) / ObjectDescription (108) ──
const { sendRename, sendDescription, sendObjectPerms, sendSelect, sendPosition, sendScale, sendRotation, sendShape, sendLink, sendDelink } = useLLUDP()
const notif = useNotificationStore()
const editName = ref('')
const editDesc = ref('')
// Reseed editable fields whenever the selected object — or its sim-provided name/desc — changes,
// so a fresh ObjectProperties reply (or selecting another prim) isn't clobbered by a stale value.
watch(() => [ui.editObjectId, obj.value?.name, obj.value?.description], () => {
	editName.value = obj.value?.name ?? ''
	editDesc.value = obj.value?.description ?? ''
}, { immediate: true })
// Owner Modify bit — PERM_MODIFY = 1<<14 (FS llpermissionsflags.h:44; the old inline 1<<13 here
// was actually PERM_TRANSFER). If perms aren't known yet, allow — the sim is the authority and
// rejects edits we're not permitted to make.
const canModify = computed(() => obj.value?.ownerMask == null || !!(obj.value.ownerMask & PERM_MODIFY))
// FS Cat0 modify-info line (llpanelpermissions.cpp:404-426; strings floater_tools.xml:1004-1014).
// Single-object selection today → "text modify info 1"/"text modify info 3".
const modifyInfo = computed(() => canModify.value ? 'You can modify this object' : "You can't modify this object")

// ── Creator / Owner / Last Owner display names (UUIDNameRequest → gridSocialStore.names) ──
// requestNames dedupes already-resolved ids; nameFor is reactive ('' until the reply lands).
// Zero-UUID ("no last owner yet") must never be requested.
function isRealAgentId(id) { return !!id && id !== '00000000-0000-0000-0000-000000000000' }
watch(
	() => [obj.value?.creatorId, obj.value?.ownerId, obj.value?.lastOwnerId],
	(ids) => requestNames(ids.filter(isRealAgentId)),
	{ immediate: true },
)
// Name-in-input, raw UUID in the title tooltip — keeps the single-row layout.
function agentDisplay(id) {
	if (!isRealAgentId(id)) return '—'
	return social.nameFor(id) || id
}
function commitName() {
	const o = obj.value
	if (!o) return
	const v = editName.value.trim()
	if (v && v !== o.name) sendRename(o.localId, v)
}
function commitDesc() {
	const o = obj.value
	if (!o) return
	if (editDesc.value !== (o.description ?? '')) sendDescription(o.localId, editDesc.value)
}
// FS-feel: select the whole field on focus and after Enter so it's ready to retype.
function selectAll(e) { e?.target?.select?.() }
function onEnter(commit, e) { commit(); e?.target?.select?.() }
// Commit on blur ONLY for in-app focus moves (Tab, clicking another field/the scene). Skip when the
// whole window lost focus (e.g. alt-tabbing to Firestorm) — FS doesn't re-send on deactivation.
function onBlur(commit) { if (document.hasFocus()) commit() }

// Alpha-mode override (#17b): live render lever, local-only (NOT sent to the sim — the legacy TE
// has no alpha-mode field; the real one lives in RenderMaterials, #16). '' = auto: blend when the
// texture carries alpha. Setting it re-stamps the object's materials immediately via the engine.
const alphaMode = computed({
	get: () => obj.value?.alphaModeOverride || '',
	set: (v) => { if (obj.value) setObjectAlphaMode(obj.value.localId, v || null) },
})

const tabs = [
	{ id: 'general',  label: 'General' },
	{ id: 'object',   label: 'Object' },
	{ id: 'features', label: 'Features' },
	{ id: 'texture',  label: 'Texture' },
	{ id: 'content',  label: 'Content' },
]

// ── Texture thumbnail loading ─────────────────────────────────────────────
// WHY: getTextureUrl resolves async (ViewerAsset→J2C→WebP, IDB-cached) to an object URL. Keep a
// reactive uuid→url map so face chips + the preview panel reuse one fetch per UUID. null = still
// loading / no image. (The fetcher owns + revokes the object URLs — don't revoke here.)
const texUrls = reactive({})
function loadTex(uuid) {
	if (!uuid || uuid in texUrls) return
	texUrls[uuid] = null
	getTextureUrl(uuid).then((url) => { texUrls[uuid] = url || null }).catch(() => { texUrls[uuid] = null })
}
// An <img> load error means our cached object URL was revoked by the texture layer (refreshTextures /
// clearTextureCache call URL.revokeObjectURL; the memory-pressure prune no longer does) — the blob is
// still in qs-tex IDB. Drop the dead
// URL and re-resolve once (getTextureUrl re-reads IDB → fresh URL). Retry-once guards an error loop on a
// genuinely bad URL; a null re-resolve just hides the <img> (no loop).
const _texRetried = new Set()
function reloadTex(uuid) {
	if (!uuid || _texRetried.has(uuid)) return
	_texRetried.add(uuid)
	delete texUrls[uuid]
	loadTex(uuid)
}

// Larger preview ("texture picker"): clicking any chip opens it over the floater body.
const previewUuid = ref(null)
function openPreview(uuid) {
	if (!uuid) return
	loadTex(uuid)
	previewUuid.value = uuid
}
function closePreview() { previewUuid.value = null }
function copyText(text) {
	if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {})
}

// ── Type / mesh-vs-prim identification ────────────────────────────────────
// WHY: this is how the user tells a mesh from a sculpt from a plain prim. meshId is set when the
// Sculpt ExtraParam 0x30 carries sculptType&7==5 (mesh); sculptId for legacy sculpts (1..4); else
// it's a parametric prim whose building-block name we derive FS-style from path+profile curve.
function sculptStitch(type) {
	switch ((type ?? 0) & 0x07) {
		case 1: return 'Sphere'
		case 2: return 'Torus'
		case 3: return 'Plane'
		case 4: return 'Cylinder'
		default: return 'Unknown'
	}
}
// FS LLPanelObject comboBaseType mapping: (pathCurve, profileCurve low nibble) → prim shape name.
function deriveBuildingBlock(shape) {
	if (!shape) return null
	const path = shape.pathCurve
	const prof = (shape.profileCurve ?? 0) & 0x0F
	if (path === 16) { // PATH_LINE
		if (prof === 1) return 'Box'
		if (prof === 0) return 'Cylinder'
		if (prof === 2 || prof === 3 || prof === 4) return 'Prism'
		if (prof === 5) return 'Half-Box'
	}
	if (path === 32 || path === 33) { // PATH_CIRCLE / PATH_CIRCLE2
		if (prof === 5) return 'Sphere'
		if (prof === 0) return 'Torus'
		if (prof === 1) return 'Tube'
		if (prof === 2 || prof === 3 || prof === 4) return 'Ring'
	}
	return null
}
const typeInfo = computed(() => {
	const o = obj.value
	if (!o) return { kind: 'none', label: '—', detail: null }
	if (o.pcode === 47) return { kind: 'avatar', label: 'Avatar', detail: null }
	if (o.pcode === 25) return { kind: 'tree',   label: 'Tree',   detail: null }
	if (o.pcode === 29) return { kind: 'grass',  label: 'Grass',  detail: null }
	if (o.meshId)   return { kind: 'mesh',   label: 'Mesh',   detail: o.meshId }
	if (o.sculptId) return { kind: 'sculpt', label: `Sculpted (${sculptStitch(o.sculptType)})`, detail: o.sculptId }
	if (o._placeholder) return { kind: 'placeholder', label: `Placeholder (${o._placeholder})`, detail: null }
	const bb = deriveBuildingBlock(o.shape)
	return { kind: 'prim', label: bb ? `Prim — ${bb}` : 'Primitive', detail: null }
})
// Show the parametric prim-shape params only for prims/sculpts that carry a shape block; meshes
// get their geometry from the asset, so the path/profile knobs aren't meaningful for them.
const showPrimShape = computed(() => !!obj.value?.shape && typeInfo.value.kind !== 'mesh')

// quatToEulerDeg / eulerDegToQuat now live in @/utils/eulerQuat.js (round-trip unit-tested).

// ── Editable Position / Size / Rotation (Object tab) → MultipleObjectUpdate ──
// FS llpanelobject.cpp commit semantics: send on Enter/blur only (:2598-2621 onCommit* →
// sendPosition/sendScale/sendRotation), rotation and scale always packed WITH position
// (:2187/:2236). ROOT prims only for now: a child's stored pos/rot are PARENT-relative, so
// sending them through a linked-set edit would fling the object — "Edit linked parts" is the
// follow-up that unlocks children.
const xf = reactive({ pos: ['', '', ''], size: ['', '', ''], rot: ['', '', ''] })
// While an axis input has focus, live ObjectUpdate echoes must not clobber the user's typing —
// every OTHER axis keeps live-updating (a moving object visibly ticks its numbers, FS-style).
const xfFocus = ref(null)
const isRootPrim = computed(() => (obj.value?.parentId ?? 0) === 0)
const canXform = computed(() => canModify.value && isRootPrim.value && obj.value?.pcode === 9)
const xformTitle = computed(() =>
	!canModify.value ? "You can't modify this object"
	: !isRootPrim.value ? 'Select the linkset root to move/resize (child editing needs Edit-linked-parts)'
	: 'Enter or Tab to apply · ↑/↓ or arrows to nudge')
watch(() => [ui.editObjectId, obj.value?.pos, obj.value?.scale, obj.value?.rot], () => {
	const o = obj.value
	const rotDeg = o?.rot ? quatToEulerDeg(o.rot) : ['', '', '']
	for (let i = 0; i < 3; i++) {
		if (xfFocus.value !== `pos-${i}`)  xf.pos[i]  = o?.pos?.[i]   != null ? o.pos[i].toFixed(5)   : ''
		if (xfFocus.value !== `size-${i}`) xf.size[i] = o?.scale?.[i] != null ? o.scale[i].toFixed(5) : ''
		if (xfFocus.value !== `rot-${i}`)  xf.rot[i]  = Number(rotDeg[i]).toFixed(5)
	}
}, { immediate: true })
const _clampN = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
// Scale clamps: FS clamps to [min, regionMaxPrimScale] (llpanelobject.cpp:2204); OpenSim's
// NonPhysicalPrimMax default is 256. Position: sim re-clamps to its own bounds — 8192 covers
// var-regions. The sim's echo corrects anything we let through.
const SCALE_MIN = 0.01, SCALE_MAX = 256
function _parseTriad(model, fallback) {
	return model.map((s, i) => {
		const n = parseFloat(s)
		return Number.isFinite(n) ? n : (fallback?.[i] ?? 0)
	})
}
function commitPos() {
	const o = obj.value
	if (!o || !canXform.value) return
	const v = _parseTriad(xf.pos, o.pos)
	v[0] = _clampN(v[0], 0, 8192); v[1] = _clampN(v[1], 0, 8192); v[2] = _clampN(v[2], 0, 4096)
	for (let i = 0; i < 3; i++) xf.pos[i] = v[i].toFixed(3)
	if (o.pos && v.every((n, i) => Math.abs(n - o.pos[i]) < 0.0005)) return
	sendPosition(o.localId, v, { linked: true })
}
function commitSize() {
	const o = obj.value
	if (!o || !canXform.value) return
	const v = _parseTriad(xf.size, o.scale).map((n) => _clampN(n, SCALE_MIN, SCALE_MAX))
	for (let i = 0; i < 3; i++) xf.size[i] = v[i].toFixed(3)
	if (o.scale && v.every((n, i) => Math.abs(n - o.scale[i]) < 0.0005)) return
	sendScale(o.localId, v, { linked: true })
}
function commitRot() {
	const o = obj.value
	if (!o || !canXform.value) return
	const v = _parseTriad(xf.rot, o.rot ? quatToEulerDeg(o.rot).map(parseFloat) : [0, 0, 0])
		.map((n) => ((n % 360) + 360) % 360)   // FS normalizes spinners to 0-360
	for (let i = 0; i < 3; i++) xf.rot[i] = v[i].toFixed(5)
	if (o.rot && quatToEulerDeg(o.rot).every((d, i) => Math.abs(parseFloat(d) - v[i]) < 0.05)) return
	sendRotation(o.localId, eulerDegToQuat(v[0], v[1], v[2]), { linked: true })
}
const XF_COMMIT = { pos: commitPos, size: commitSize, rot: commitRot }
// M-3 nudge = the native number-input spinners (step 0.05 m / 0.5°): hold-to-repeat and ↑/↓ both
// fire @change per step, which routes through XF_COMMIT — no custom stepper code needed.

// ── Editable prim-shape params (Object tab) → ObjectShape (Low 98), @/lib/primParams.js ────────
// Per-PRIM, unlike pos/size/rot above — no linkset-root resolution (a child prim edits its own
// shape; FS acts on whatever LLSelectMgr has selected, llpanelobject.cpp getVolumeParams/sendShape).
// Same commit convention as xf: reactive display strings, focus guard so a live ObjectUpdate echo
// doesn't clobber in-progress typing, commit on Enter/blur/change (llpanelobject.cpp:2598-2621 parity).
const canShapeEdit = computed(() => canModify.value && obj.value?.pcode === 9)
const shapeEditTitle = computed(() => !canModify.value ? "You can't modify this object" : 'Enter or Tab to apply')
// displayParams() derives labels/visibility/ranges fresh from the CURRENT shape every render —
// these are read-only metadata, not part of the editable reactive state below.
const shapeMeta = computed(() => obj.value?.shape ? displayParams(obj.value.shape) : null)
const SHAPE_FIELDS = ['pathCutBegin', 'pathCutEnd', 'advBegin', 'advEnd', 'hollowPct',
	'twistBegin', 'twistEnd', 'taperX', 'taperY', 'shearX', 'shearY',
	'radiusOffset', 'revolutions', 'skew']
// Gene's spec: every row keeps 5 decimals EXCEPT Twist (integer degrees).
const shapeDecimals = (key) => (key === 'twistBegin' || key === 'twistEnd') ? 0 : 5
const shapeUi = reactive(Object.fromEntries(SHAPE_FIELDS.map((k) => [k, ''])))
const shapeFocus = ref(null)
watch(() => [ui.editObjectId, obj.value?.shape], () => {
	const m = shapeMeta.value
	if (!m) return
	for (const key of SHAPE_FIELDS) {
		if (shapeFocus.value === key) continue
		const v = m[key]
		shapeUi[key] = typeof v === 'number' ? v.toFixed(shapeDecimals(key)) : ''
	}
}, { immediate: true, deep: true })
function _parseShapeField(str, fallback) {
	const n = parseFloat(str)
	return Number.isFinite(n) ? n : fallback
}
function commitShape() {
	const o = obj.value
	if (!o || !canShapeEdit.value || !o.shape) return
	const m = shapeMeta.value
	if (!m) return
	const rows = {}
	for (const key of SHAPE_FIELDS) rows[key] = _parseShapeField(shapeUi[key], m[key])
	const wire = uiToWireParams(o.shape, rows)
	sendShape(o.localId, wire)
}

// ── Content tab: prim (task) inventory ────────────────────────────────────
// useTaskInventory owns the wire + state (REQUEST_TASK_INV → TASK_INV/EMPTY); this tab is a thin
// view over its per-localId entries (FS llpanelobjectinventory.cpp model). Contents belong to the
// PRIM, not the linkset — we show the edited prim's own inventory, matching FS.
const { taskInvFor, requestContents, openContents } = useTaskInventory()
const contentState = computed(() => obj.value ? taskInvFor(obj.value.localId) : null)
const contentItems = computed(() => contentState.value?.items ?? [])
// Request on tab activation and when the edited object changes while the tab is showing. The
// 3s guard in requestContents keeps rapid tab flips from spamming the sim.
watch(() => [activeTab.value, ui.editObjectId], () => {
	if (activeTab.value === 'content' && obj.value) requestContents(obj.value.localId)
}, { immediate: true })
function refreshContents() { if (obj.value) requestContents(obj.value.localId, { force: true }) }
function openContentsClick() { if (obj.value) openContents(obj.value.localId, obj.value.name) }

const profileCurveLabel = computed(() => {
	const c = obj.value?.shape?.profileCurve
	if (c == null) return '—'
	const low = c & 0x0F
	const map = ['Circle', 'Square', 'IsoTri', 'EqTri', 'RightTri', 'HalfCircle']
	return `${map[low] ?? 'Unknown'} (${c})`
})

// SL/FS ClickAction enum (indra_constants.h): values are NOT the combo display order — map by value.
const CLICK_ACTION_OPTIONS = [
	{ value: 0, label: 'Touch (default)' },
	{ value: 1, label: 'Sit on object' },
	{ value: 2, label: 'Buy object' },
	{ value: 3, label: 'Pay object' },
	{ value: 4, label: 'Open' },
	{ value: 5, label: 'Play animation' },
	{ value: 6, label: 'Open media' },
	{ value: 7, label: 'Zoom' },
	{ value: 8, label: 'None' },
	{ value: 9, label: 'Ignore object' },
]
// SL sale types (LLSaleInfo): 1=Original, 2=Copy, 3=Contents. (0=not-for-sale is the checkbox.)
const SALE_TYPE_OPTIONS = [
	{ value: 2, label: 'Copy' },
	{ value: 3, label: 'Contents' },
	{ value: 1, label: 'Original' },
]

// WHY: SL permission bits (FS llpermissionsflags.h:40-64) — V=Move 1<<19, M=Modify 1<<14,
// C=Copy 1<<15, T=Transfer 1<<13, X=Export 1<<16. Letter order VMCT(X) matches FS mask_to_string
// (llpermissions.cpp:1023-1060). The old inline shifts had M/C/T each off by one bit.
function permLetters(mask) {
	if (mask == null) return '—'
	let s = ''
	if (mask & PERM_MOVE)     s += 'V'
	if (mask & PERM_MODIFY)   s += 'M'
	if (mask & PERM_COPY)     s += 'C'
	if (mask & PERM_TRANSFER) s += 'T'
	if (mask & PERM_EXPORT)   s += 'X'
	return s || '–'
}

// ── FS tri-state perm checkboxes (llpanelpermissions.cpp:986-1122) ────────────────────────
// State per checkbox aggregates over the selection records ([obj] today — aggregateBit is
// array-ready for future multi-select). Editing is gated to self-owned (FS self_owned) plus the
// FS per-checkbox mask gates: Anyone row (llpanelpermissions.cpp:919-920: Move needs owner MOVE,
// Copy needs owner COPY && TRANSFER; Export :931-947: creator==owner + can_set_export) and the
// Next-owner row (:969-972: Modify needs base MODIFY, Copy needs base COPY, Transfer needs
// next-owner COPY).
// Full selection = primary + shift/ctrl multi-selected roots (uiStore.selectedObjectIds, added
// 2026-07-13 build-tools sweep). Perm checkboxes aggregate over ALL of it (aggregateBit was
// already array-ready); the "N objects selected" line and Link gating read the same list.
const selectedIds = computed(() => {
	void world.objects.size
	const ids = [ui.editObjectId, ...ui.selectedObjectIds].filter((id) => id != null)
	return [...new Set(ids)]
})
const selectionRecords = computed(() =>
	selectedIds.value.map((id) => world.objects.get(id)).filter(Boolean))
const selfOwned = computed(() => {
	const o = obj.value
	return !!o?.ownerId && !!session.agentId && o.ownerId.toLowerCase() === session.agentId.toLowerCase()
})
const permRows = computed(() => {
	const recs = selectionRecords.value
	const ownerMask = obj.value?.ownerMask
	const base = obj.value?.baseMask ?? 0
	const next = obj.value?.nextOwnerMask ?? 0
	const own = selfOwned.value
	return {
		everyoneMove:   { state: aggregateBit(recs, 'everyoneMask', PERM_MOVE),      tentative: false,                              canEdit: own && everyoneMoveEditable(ownerMask), field: PF_EVERYONE, mask: PERM_MOVE },
		everyoneCopy:   { state: aggregateBit(recs, 'everyoneMask', PERM_COPY),      tentative: everyoneCopyTentative(ownerMask),   canEdit: own && everyoneCopyEditable(ownerMask), field: PF_EVERYONE, mask: PERM_COPY },
		everyoneExport: { state: aggregateBit(recs, 'everyoneMask', PERM_EXPORT),    tentative: false,                              canEdit: own && everyoneExportEditable(obj.value), field: PF_EVERYONE, mask: PERM_EXPORT },
		nextModify:     { state: aggregateBit(recs, 'nextOwnerMask', PERM_MODIFY),   tentative: false,                              canEdit: own && !!(base & PERM_MODIFY), field: PF_NEXT_OWNER, mask: PERM_MODIFY },
		// FS quirk (llpanelpermissions.cpp:1093-1096): Next-owner Copy renders tentative when the
		// agent lacks copy rights even if the bit is uniformly on; Transfer likewise (:1110-1113).
		nextCopy:       { state: aggregateBit(recs, 'nextOwnerMask', PERM_COPY),     tentative: nextOwnerCopyTentative(ownerMask),  canEdit: own && !!(base & PERM_COPY), field: PF_NEXT_OWNER, mask: PERM_COPY },
		nextTransfer:   { state: aggregateBit(recs, 'nextOwnerMask', PERM_TRANSFER), tentative: nextOwnerTransferTentative(ownerMask), canEdit: own && !!(next & PERM_COPY), field: PF_NEXT_OWNER, mask: PERM_TRANSFER },
	}
})
// FS path: onCommitPerm (llpanelpermissions.cpp:1319) → selectionSetObjectPermissions →
// ObjectPermissions (Low 105). OpenSim doesn't push fresh ObjectProperties unprompted, so
// re-issue the select to refetch the authoritative masks after the edit.
function onPermToggle(row, set) {
	const o = obj.value
	if (!o) return
	sendObjectPerms(o.localId, row.field, set, row.mask)
	sendSelect([ui.editObjectId])
}

function fmtCreationDate(unixSecStr) {
	if (!unixSecStr) return '—'
	const n = Number(unixSecStr)
	if (!Number.isFinite(n) || n <= 0) return '—'
	const d = new Date(n * 1000)
	if (Number.isNaN(d.getTime())) return '—'
	return d.toISOString().slice(0, 16).replace('T', ' ')
}

// Linkset members in ObjectUpdate ARRIVAL order (FS mChildList semantics) — worldStore owns the
// tracking now. (The old inline rootOf/sort-by-localId walk lacked the PCODE_AVATAR guard and
// sorted children by localId, which is wrong vs FS link order — llfloatertools.cpp:623-647.)
const linksetIds = computed(() => {
	if (!obj.value) return []
	void world.objects.size   // link tracking is non-reactive; re-derive when the object map changes
	return world.linksetMembers(obj.value.localId)
})
const linkCount = computed(() => linksetIds.value.length || (obj.value ? 1 : 0))
const canCycle  = computed(() => linksetIds.value.length > 1)
// FS link-number convention (llfloatertools.cpp:623-647): unlinked = 0, root = 1, children 2+.
const linkNumber = computed(() => {
	if (!obj.value) return '—'
	void world.objects.size   // link tracking is non-reactive; re-derive when linkset members arrive/leave
	return world.linkNumberOf(ui.editObjectId)
})
// WHY: no real resource-cost (land impact) or parcel-capacity feed yet (to-do caps). Use the
// prim count as the legacy land-impact proxy; capacity stays a placeholder until parcel data lands.
// Counts follow the FULL multi-selection: N = distinct linkset roots, land impact = total prims
// across every selected linkset (FS floater counts the whole selection, llfloatertools.cpp).
const selectedRoots = computed(() => {
	void world.objects.size
	const roots = new Set()
	for (const id of selectedIds.value) roots.add(world.linksetMembers(id)[0] ?? id)
	return [...roots]
})
const objectsSelected   = computed(() => selectedRoots.value.length)
const landImpact        = computed(() => {
	const n = selectedRoots.value.reduce((sum, id) => sum + (world.linksetMembers(id).length || 1), 0)
	return n || '—'
})
const remainingCapacity = computed(() => '—')

// ── Link / Unlink buttons — same gate + invoke as MenuBar Build ▸ Link/Unlink and the object
// context menu (linkGating.js = FS enableLinkObjects/enableUnlinkObjects port). Kept as computeds
// (not call-per-render fns like MenuBar's menu callbacks) so :disabled/:title stay reactive.
const linkGate   = computed(() => { void world.objects.size; return canLinkGate(world.objects, selectedIds.value) })
const unlinkGate = computed(() => { void world.objects.size; return canUnlinkGate(world.objects, world.linksetMembers, selectedIds.value) })
function linkSelected() {
	const g = linkGate.value
	if (g.disabled) return
	// FS parity: cross-owner refusal fires at INVOKE, not as a disabled button (llselectmgr.cpp
	// linkObjects :804-813 — enableLinkObjects never checks owners).
	if (g.reason === 'differentOwners') {
		notif.pushToast({ kind: 'info', title: 'Unable to link', body: 'Not all of the objects have the same owner.' })
		return
	}
	sendLink(g.roots)
	ui.clearMultiSelect()
}
function unlinkSelected() {
	if (unlinkGate.value.disabled) return
	// SEND_INDIVIDUALS semantics (FS llselectmgr.cpp:5493): a plain root selection delinks its
	// WHOLE linkset, matching FS's default (non-Edit-Linked) Unlink behavior.
	sendDelink(selectedIds.value.flatMap((id) => world.linksetMembers(id)))
	ui.clearMultiSelect()
}

// Select previous/next linked part in store (arrival) order. Implies part-level editing, so
// force "Edit linked" on.
function selectLink(delta) {
	const m = linksetIds.value
	if (m.length < 2) return
	ui.setEditLinked(true)
	const i = m.indexOf(ui.editObjectId)
	const ni = ((i < 0 ? 0 : i) + delta + m.length) % m.length
	ui.editObjectId = m[ni]
}

// ── Create tab: shape picker → uiStore.armBuildPlacement (WorldCanvas.vue does the actual
// rez-on-click; see src/lib/primShapes.js for the FS-ported per-shape param table). Tree/Grass
// stay unwired — no rendering pipeline for either yet (Trees cluster, docs/FEATURE-GAPS.md).
function selectBuildShape(key) {
	if (!PRIM_SHAPE_KEYS.includes(key)) return
	ui.armBuildPlacement(key)
}

// SL "Blank" (5748decc) and the zero UUID are not real textures — the renderer ignores them, so the
// floater must too (else blank-default faces show as phantom per-face overrides).
const SL_BLANK = '5748decc-f629-461c-9a36-a35a221fe21f'
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
function isRealTexUuid(u) { return !!u && u !== SL_BLANK && u !== ZERO_UUID }

// TexGen (texture mapping mode). 0=Default (per-face UV), 1=Planar (projected). FS shows planar
// repeats per-meter = packed ×2 (planar packs per-half-meter); Default shows packed as-is.
const TEXGEN_LABELS = ['Default', 'Planar', 'Spherical', 'Cylindrical']
function texGenLabel(v) { return TEXGEN_LABELS[v ?? 0] ?? 'Default' }
function dispRepeats(rep, texGen) {
	const f = texGen === 1 ? 2 : 1
	return [(rep?.[0] ?? 1) * f, (rep?.[1] ?? 1) * f]
}
// FS "rptctrl" Repeats Per Meter (llpanelface.cpp getMaxDiffuseRepeats): RAW TE scale (no planar ×2)
// divided by the object's span on the face's S/T axes, max of the two. FS resolves the axes per face
// via getTESTAxes; we use its defaults (S→object X, T→object Y) — exact for the common flat faces,
// approximate for side faces of tall prims.
function rpmFor(rep) {
	const s = obj.value?.scale
	if (!s?.[0] || !s?.[1]) return null
	return Math.max(((rep?.[0] ?? 1) / s[0]), ((rep?.[1] ?? 1) / s[1]))
}

// Distinct REAL diffuse textures across all faces (per-face override OR default). >1 → "Multiple".
const distinctTextures = computed(() => {
	const o = obj.value
	if (!o) return []
	const set = new Set()
	if (isRealTexUuid(o.defaultTexture)) set.add(o.defaultTexture)
	for (const t of o.faceTextures ?? []) if (isRealTexUuid(t)) set.add(t)
	return [...set]
})
const isMultiTexture = computed(() => distinctTextures.value.length > 1)
// FS swatch semantics (llselectmgr.h getSelectedTEValue + llpanelface.cpp:1160-1163): the color
// swatch shows the FIRST TE's *effective* color even when faces disagree — "Multiple" flags the
// disagreement, but the chip is never blanked to white. Effective face color = face override ??
// prim default; a null faceColors slot means "uses the default", so it must be RESOLVED, not
// dropped (and the unused default must NOT count when every face overrides it — the old logic
// read an all-faces-tinted-gold prim as gold+white = false "Multiple").
const chipTint = computed(() => {
	const o = obj.value
	if (!o) return null
	const f = o.faceColors
	return (f && f.length ? (f[0] ?? o.defaultColor) : o.defaultColor) ?? null
})
const isMultiColor = computed(() => {
	const o = obj.value
	if (!o) return false
	const faces = o.faceColors ?? []
	const key = (c) => (c ? c.map((v) => Math.round(v * 255)).join(',') : 'def')
	const set = new Set(faces.map((c) => key(c ?? o.defaultColor)))
	return set.size > 1
})
// Per-face diffuse chips: only faces that explicitly override the default get a chip (FS shows
// the resolved texture per selected face; we surface the overrides so multi-texture builds read clearly).
const faceTexChips = computed(() => {
	const f = obj.value?.faceTextures
	if (!f) return []
	return f.map((t, i) => ({ face: i, uuid: t })).filter((x) => isRealTexUuid(x.uuid))
})
// Per-face UV/mapping overrides: a face appears if it overrides repeats, offset, rotation, OR TexGen.
// Resolved values fall back to the prim default for anything the face does not override. Planar
// repeats are shown ×2 (per-meter) to match FS.
const faceUvRows = computed(() => {
	const o = obj.value
	if (!o) return []
	const rep = o.faceRepeats ?? [], off = o.faceOffset ?? [], rot = o.faceRotation ?? [], tg = o.faceTexGen ?? []
	const n = Math.max(rep.length, off.length, rot.length, tg.length)
	const rows = []
	for (let i = 0; i < n; i++) {
		const hasOverride = rep[i] != null || off[i] != null || rot[i] != null || tg[i] != null
		if (!hasOverride) continue
		const texGen = tg[i] ?? o.defaultTexGen ?? 0
		rows.push({
			face: i,
			repeats: dispRepeats(rep[i] ?? o.defaultRepeats ?? [1, 1], texGen),
			rpm:     rpmFor(rep[i] ?? o.defaultRepeats),
			offset:  off[i] ?? o.defaultOffset ?? [0, 0],
			rotation: rot[i] ?? o.defaultRotation ?? 0,
			mapping: texGenLabel(texGen),
		})
	}
	return rows
})
// Default-face mapping (FS "Mapping" + Scale/Offset/Rotation), planar-aware.
const defaultMapping = computed(() => {
	const o = obj.value
	const tg = o?.defaultTexGen ?? 0
	return {
		mapping: texGenLabel(tg),
		repeats: dispRepeats(o?.defaultRepeats ?? [1, 1], tg),
		rpm:     rpmFor(o?.defaultRepeats),
		offset:  o?.defaultOffset ?? [0, 0],
		rotation: o?.defaultRotation ?? 0,
	}
})
const shinyLabel = computed(() => ['None', 'Low', 'Medium', 'High'][obj.value?.defaultShiny ?? 0] ?? 'None')
// Legacy bumpmap type (TE bump byte bits 4:0) — labels mirror LLStandardBumpmap / FS Bumpiness combo.
const BUMP_LABELS = ['None', 'Brightness', 'Darkness', 'Woodgrain', 'Bark', 'Bricks', 'Checker', 'Concrete', 'Crustytile', 'Cutstone', 'Discs', 'Gravel', 'Petridish', 'Siding', 'Stonetile', 'Stucco', 'Suction', 'Weave']
const bumpLabel = computed(() => BUMP_LABELS[obj.value?.defaultBump ?? 0] ?? 'None')
// Prim material code (mcode) — drives physics friction/restitution + collision sound.
const MATERIAL_LABELS = ['Stone', 'Metal', 'Glass', 'Wood', 'Flesh', 'Plastic', 'Rubber', 'Light']
const materialLabel = computed(() => MATERIAL_LABELS[obj.value?.material ?? 0] ?? '—')
// Flexible-path params (ExtraParam 0x10) — null when the prim isn't flexi.
const flexiLabel = computed(() => {
	const f = obj.value?.flexi
	if (!f) return null
	return `softness ${f.softness} · tension ${f.tension.toFixed(1)} · gravity ${f.gravity.toFixed(1)} · drag ${f.drag.toFixed(1)} · wind ${f.wind.toFixed(1)}`
})
// Light params (ExtraParam 0x20) — null when the prim isn't a light source.
const lightRgb = computed(() => (obj.value?.light?.color ?? [1, 1, 1]).map(v => Math.round(v * 255)).join(', '))
// Reflection-probe params (ExtraParam 0x90) — null when the prim isn't a probe.
const reflectionProbeLabel = computed(() => {
	const r = obj.value?.reflectionProbe
	if (!r) return null
	const kind = [r.isBox ? 'box' : 'sphere', r.isDynamic ? 'dynamic' : null, r.isMirror ? 'mirror' : null].filter(Boolean).join(', ')
	return `${kind} · ambiance ${r.ambiance.toFixed(1)} · clip ${r.clipDistance.toFixed(1)}m`
})

// PBR
const distinctPbr = computed(() => {
	const o = obj.value
	if (!o) return []
	const set = new Set()
	if (o.defaultPbrMaterial) set.add(o.defaultPbrMaterial)
	for (const m of o.pbrMaterials ?? []) if (m) set.add(m)
	return [...set]
})
const hasPbr = computed(() => distinctPbr.value.length > 0)
const isMultiPbr = computed(() => distinctPbr.value.length > 1)
const pbrFaceChips = computed(() => {
	const m = obj.value?.pbrMaterials
	if (!m) return []
	return m.map((u, i) => ({ face: i, uuid: u })).filter((x) => x.uuid)
})

// Preload thumbnails for everything visible on the Texture tab + the open preview.
watch(
	() => [obj.value?.defaultTexture, distinctTextures.value, previewUuid.value],
	() => {
		loadTex(obj.value?.defaultTexture)
		distinctTextures.value.forEach(loadTex)
		loadTex(previewUuid.value)
	},
	{ immediate: true, deep: true },
)
// Reset transient UI when the selected object changes.
watch(() => ui.editObjectId, () => { previewUuid.value = null; texSubTab.value = 'bp' })

// DIAGNOSTIC (per-face / planar decode audit) — dump the decoded TextureEntry for the selected object.
// Re-fires when the TE content changes too (opening Edit emits ObjectSelect → the sim re-sends a
// fresh ObjectUpdate ~RTT later; this catches that post-refetch state). Read console ([TEDUMP]).
// KEEP: still needed for the original per-face/planar object-fix goal.
watch(
	() => [ui.editObjectId, obj.value?.defaultTexGen, JSON.stringify(obj.value?.faceTexGen),
		JSON.stringify(obj.value?.faceRepeats), JSON.stringify(obj.value?.faceTextures)],
	() => {
	const o = obj.value
	if (!o) return
	const sparse = (arr) => Array.isArray(arr)
		? arr.map((v, i) => (v == null ? null : { i, v })).filter(Boolean)
		: arr
	const dump = '[TEDUMP] ' + JSON.stringify({
		localId: o.localId, name: o.name, type: typeInfo.value.label, placeholder: o._placeholder ?? false, meshId: o.meshId,
		sculptId: o.sculptId, sculptType: o.sculptType,
		shape: o.shape && { pathCurve: o.shape.pathCurve, profileCurve: o.shape.profileCurve,
			profileHollow: o.shape.profileHollow, pathBegin: o.shape.pathBegin, pathEnd: o.shape.pathEnd,
			profileBegin: o.shape.profileBegin, profileEnd: o.shape.profileEnd },
		defaultTexture: o.defaultTexture,
		faceTextures: sparse(o.faceTextures),
		defaultColor: o.defaultColor, faceColors: sparse(o.faceColors),
		defaultRepeats: o.defaultRepeats, faceRepeats: sparse(o.faceRepeats),
		defaultOffset: o.defaultOffset, faceOffset: sparse(o.faceOffset),
		defaultRotation: o.defaultRotation, faceRotation: sparse(o.faceRotation),
		defaultTexGen: o.defaultTexGen, faceTexGen: sparse(o.faceTexGen),
		textureAnim: o.textureAnim,
		defaultShiny: o.defaultShiny, defaultFullbright: o.defaultFullbright,
		defaultPbrMaterial: o.defaultPbrMaterial, pbrMaterials: sparse(o.pbrMaterials),
	})
	// eslint-disable-next-line no-console
	console.log(dump)
	// Forward to the server log too ([ClientLog]) so the dump is readable without the browser console.
	try { emit(C.CLIENT_LOG, { level: 'info', msg: dump.slice(0, 4000), stack: '' }) } catch { /* ignore */ }
})

function close() {
	ui.editObjectId = null
	ui.showObjectEdit = false
	ui.disarmBuildPlacement()   // closing the floater must never leave a surprise rez-click armed
}
</script>

<template>
	<FloaterWindow
		v-show="!ui.gizmoDragging"
		id="object-edit"
		title="Build Tools"
		build-tool
		:wrap-style="{ width: '18.5rem', height: '40.75rem', minWidth: '18.3rem', minHeight: '25rem', resize: 'both' }"
		:default-pos="{ right: '0.0625rem', top: 'calc(100vh - 2.3125rem - 40.75rem' }"
		@close="close"
	>
		<div class="relative flex flex-col h-full text-xs overflow-auto">
			<!-- Build-tools toolbar (FS-parity) ──────────────────────────────────── -->
			<div class="shrink-0 border-b border-edge p-1.5 pb-0.5 min-h-44">
				<!-- Top row: five major tools (icon radio) -->
				<div class="flex items-center gap-1.5">
					<button
						v-for="t in tools"
						:key="t.id"
						:title="t.label"
						class="ui-btn flex-1 flex items-center justify-center p-1 rounded-sm border transition-colors"
						:class="t.disabled
							? 'border-edge text-fg/30 cursor-not-allowed bg-white/10'
							: buildTool === t.id
								? 'border-accent text-accent bg-accent/10'
								: 'border-edge text-fg/70 hover:text-fg hover:bg-fg/20'"
						@click="pickTool(t)"
					>
						<component :is="t.icon" class="w-4 h-4" />
					</button>
				</div>
				<div v-if="buildTool === tools[0].id">
					<p class="py-0.5 text-2xs text-fg/40 italic ml-auto truncate">Click and drag to move camera</p>
					<div class="flex items-center gap-3">
						<div role="radiogroup" aria-label="Focus operation" class="flex flex-col whitespace-nowrap">
							<label for="" class="flex items-center gap-1 min-w-0 text-2xs text-fg leading-4.5 cursor-pointer select-none"><input type="radio" title="to-do" class="accent-accent shrink-0" selected /> Zoom</label>
							<label for="" class="flex items-center gap-1 min-w-0 text-2xs text-fg leading-4.5 cursor-pointer select-none"><input type="radio" title="to-do" class="accent-accent shrink-0" /> Orbit (Ctrl)</label>
							<label for="" class="flex items-center gap-1 min-w-0 text-2xs text-fg leading-4.5 cursor-pointer select-none"><input type="radio" title="to-do" class="accent-accent shrink-0" /> Pan (Ctrl+Shift)</label>
						</div>
						<div class="w-full">
							<input type="range" min="0" max="100" value="75" disabled class="w-full accent-accent" />
						</div>
					</div>
				</div>
				<div v-else-if="buildTool === tools[1].id">
					<p class="py-0.5 text-2xs text-fg/40 italic ml-auto truncate">Drag to move, Ctrl to lift, Ctrl+Shift to rotate</p>
					<div class="flex flex-col whitespace-nowrap">
						<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Move</label>
						<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Lift (Ctrl)</label>
						<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Spin (Ctrl+Shift)</label>
					</div>
				</div>
				<div v-else-if="buildTool === tools[2].id">
					<p class="py-0.5 text-2xs text-fg/40 italic ml-auto truncate">Drag to move, shift-drag to copy</p>
					<!-- Sub row: gizmo operation (Move / Rotate / Stretch), tied to modifier keys -->
					<div class="flex items-center gap-3">
						<div role="radiogroup" aria-label="Gizmo operation" class="flex flex-col items-start gap-0 mb-0.5">
							<label
								v-for="g in gizmoOps"
								:key="g.id"
								:title="g.hint"
								class="flex flex-1 items-center justify-center gap-1 min-w-0 text-2xs text-fg cursor-pointer select-none"
							>
								<input
									type="radio"
									name="gizmo-op"
									class="accent-accent shrink-0"
									:value="g.id"
									v-model="ui.gizmoMode"
								/>
								<span class="truncate">{{ g.label }}</span>
							</label>
							<label
								class="flex items-center gap-1.5 text-2xs text-fg cursor-pointer select-none"
								title="Off: clicking selects the whole linked object. On: selects the individual prim under the cursor."
							>
								<input type="checkbox" class="accent-accent" v-model="ui.editLinked" />
								Edit linked
							</label>
						</div>
						<div class="flex flex-col text-2xs text-fg whitespace-nowrap">
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" /> Stretch both sides</label>
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" checked="checked" /> Stretch textures</label>
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" /> Snap</label>
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" /> Edit axis at root</label>
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" checked="checked" /> Show highlight</label>
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" /> Select reflection probes</label>
						</div>
						<div class="text-lg" title="See more grid options (to-do)">➡️</div>
					</div>

					<!-- Link controls (FS-parity) ─────────────────────────────────────── -->
					<div class="flex items-center gap-1 pb-0.5">
						<button
							title="Select previous linked part or face"
							:disabled="!canCycle"
							class="ui-btn p-1 text-2xs rounded-sm border transition-colors"
							:class="canCycle ? 'border-edge text-fg/70 hover:text-fg hover:bg-fg/20' : 'border-edge text-fg/30 cursor-not-allowed bg-white/10'"
							@click="selectLink(-1)"
						><ChevronLeftIcon class="w-3 h-3" /></button>
						<button
							title="Select next linked part or face"
							:disabled="!canCycle"
							class="ui-btn p-1 text-2xs rounded-sm border transition-colors"
							:class="canCycle ? 'border-edge text-fg/70 hover:text-fg hover:bg-fg/20' : 'border-edge text-fg/30 cursor-not-allowed bg-white/10'"
							@click="selectLink(1)"
						><ChevronRightIcon class="w-3 h-3" /></button>
						<button
							:title="linkGate.title || 'Link selected objects (Ctrl+L)'"
							:disabled="linkGate.disabled"
							class="ui-btn flex-1 p-0.5 px-4 text-2xs rounded-sm border border-edge transition-colors"
							:class="linkGate.disabled ? 'text-fg/30 cursor-not-allowed bg-white/10' : 'text-fg/70 hover:text-fg hover:bg-fg/20'"
							@click="linkSelected"
						>Link</button>
						<button
							:title="unlinkGate.title || 'Unlink selected objects (Ctrl+Shift+L)'"
							:disabled="unlinkGate.disabled"
							class="ui-btn flex-1 p-0.5 px-4 text-2xs rounded-sm border border-edge transition-colors"
							:class="unlinkGate.disabled ? 'text-fg/30 cursor-not-allowed bg-white/10' : 'text-fg/70 hover:text-fg hover:bg-fg/20'"
							@click="unlinkSelected"
						>Unlink</button>
						<select
							title="World (to-do)"
							disabled
							class="ui-btn ml-auto p-0.5 px-4 text-2xs rounded-sm border border-edge text-fg/30 cursor-not-allowed bg-white/10"
						>
							<option value="">World</option>
							<option value="">Local</option>
							<option value="">Reference</option>
						</select>
					</div>
				</div>
				<div v-else-if="buildTool === tools[3].id">
					<p class="py-0.5 text-2xs text-fg/40 italic ml-auto truncate">Click inworld to build</p>
					<div class="flex items-center gap-2.5 pe-2">
						<div class="primcreate flex flex-wrap gap-0.5">
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'cube' }" title="Cube" @click="selectBuildShape('cube')"><img src="@/assets/img/build/cube.svg" alt="cube" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'prism' }" title="Prism" @click="selectBuildShape('prism')"><img src="@/assets/img/build/prism.svg" alt="prism" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'pyramid' }" title="Pyramid" @click="selectBuildShape('pyramid')"><img src="@/assets/img/build/pyramid.svg" alt="pyramid" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'tetrahedron' }" title="Tetrahedron" @click="selectBuildShape('tetrahedron')"><img src="@/assets/img/build/tetrahedron.svg" alt="tetrahedron" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'cylinder' }" title="Cylinder" @click="selectBuildShape('cylinder')"><img src="@/assets/img/build/cylinder.svg" alt="cylinder" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'hemicylinder' }" title="Hemicylinder" @click="selectBuildShape('hemicylinder')"><img src="@/assets/img/build/hemicylinder.svg" alt="hemicylinder" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'cone' }" title="Cone" @click="selectBuildShape('cone')"><img src="@/assets/img/build/cone.svg" alt="cone" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'hemicone' }" title="Hemicone" @click="selectBuildShape('hemicone')"><img src="@/assets/img/build/hemicone.svg" alt="hemicone" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'sphere' }" title="Sphere" @click="selectBuildShape('sphere')"><img src="@/assets/img/build/sphere.svg" alt="sphere" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'hemisphere' }" title="Hemisphere" @click="selectBuildShape('hemisphere')"><img src="@/assets/img/build/hemisphere.svg" alt="hemisphere" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'torus' }" title="Torus" @click="selectBuildShape('torus')"><img src="@/assets/img/build/torus.svg" alt="torus" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'tube' }" title="Tube" @click="selectBuildShape('tube')"><img src="@/assets/img/build/tube.svg" alt="tube" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" :class="{ active: ui.buildShape === 'ring' }" title="Ring" @click="selectBuildShape('ring')"><img src="@/assets/img/build/ring.svg" alt="ring" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" title="Tree"><img src="@/assets/img/build/tree.svg" alt="tree" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
							<label for="" class="grow border border-panel w-6.5" title="Grass"><img src="@/assets/img/build/grass.svg" alt="grass" class="bg-panel hover:bg-accent-dark p-0.5 aspect-square" /></label>
						</div>
						<div class="flex flex-col whitespace-nowrap">
							<label for=""><input type="checkbox" v-model="ui.buildKeepTool" class="accent-accent" /> Keep tool selected</label>
							<label for=""><input type="checkbox" title="to-do" class="accent-accent" /> Copy selection</label>
							<label for="" class="ms-4"><input type="checkbox" class="accent-accent" checked="checked" /> Center copy</label>
							<label for="" class="ms-4"><input type="checkbox" title="to-do" class="accent-accent" /> Rotate copy</label>
							<select class="ui-select bg-fg/20 border border-edge rounded-sm mb-1 ms-2 mt-1 py-0 px-1.5 w-full text-fg">
								<option value="">Random</option>
								<option value="">Grass 0</option>
								<option value="">Grass 1</option>
								<option value="">Grass 2</option>
								<option value="">Grass 3</option>
								<option value="">Grass 4</option>
								<option value="">undergrowth_1</option>
							</select>
						</div>
					</div>
				</div>
				<div v-else-if="buildTool === tools[4].id">
					<p class="py-0.5 text-2xs text-fg/40 italic ml-auto truncate">Click and drag to select land</p>
					<div class="flex gap-5">
						<div class="flex flex-col whitespace-nowrap">
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Select land</label>
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Flatten</label>
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Raise</label>
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Lower</label>
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Smooth</label>
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Roughen</label>
							<label for=""><input type="radio" title="to-do" class="accent-accent shrink-0"/> Revert</label>
						</div>
						<div class="w-full">
							<p>Bulldozer:</p>
							<div class="grid grid-cols-[3.5rem_1fr] gap-x-1 mb-1">
								<p>Size</p>
								<input type="range" min="0" max="100" value="75" disabled class="w-full accent-accent" />
							</div>
							<div class="grid grid-cols-[3.5rem_1fr] gap-x-1 mb-1">
								<p>Strength</p>
								<input type="range" min="0" max="100" value="75" disabled class="w-full accent-accent" />
							</div>
							<button title="Modify selected land" class="ui-btn py-0.5 px-5 text-xs rounded-sm border transition-colors">Apply</button>
						</div>
					</div>
					<div class="w-36 my-8 ps-2">
						<h4 class="mb-1 text-sm">Parcel Information</h4>
						<div class="ps-4">
							<p class="mb-2">Area: ##### m<sup>2</sup></p>
							<button class="ui-btn mb-2 py-0.5 px-5 w-full text-xs rounded-sm border transition-colors">About land</button>
							<label for="" class="flex items-center gap-1" title="Colorize the parcels according to the type of owners:\n\nGreen = Your land\nAqua = Your group's land\nRed = Owned by others\nYellow = For sale\nPurple = For auction\nGrey = Public"><input type="checkbox" title="to-do" class="accent-accent" /> Show owners</label>
						</div>
					</div>
					<div class="w-36 my-8 ps-2">
						<h4 class="mb-1 text-sm">Modify Parcel</h4>
						<div class="ps-4">
							<button class="ui-btn mb-2 py-0.5 px-5 w-full text-xs rounded-sm border transition-colors" disabled>Subdivide</button>
							<button class="ui-btn mb-2 py-0.5 px-5 w-full text-xs rounded-sm border transition-colors" disabled>Join</button>
						</div>
					</div>
					<div class="w-36 my-8 ps-2">
						<h4 class="mb-1 text-sm">Land transactions</h4>
						<div class="ps-4">
							<button class="ui-btn mb-2 py-0.5 px-5 w-full text-xs rounded-sm border transition-colors" disabled>Buy land</button>
							<button class="ui-btn mb-2 py-0.5 px-5 w-full text-xs rounded-sm border transition-colors" disabled>Abandon land</button>
						</div>
					</div>
				</div>
			</div>

			<div v-if="buildTool !== tools[4].id">
				<div class="text-2xs text-fg/60 font-mono pt-1 px-2">
					<div v-show="ui.editLinked">Link number: <span class="text-fg">{{ linkNumber }}</span></div>
					<p class="leading-3">{{ objectsSelected }} object{{ objectsSelected === 1 ? '' : 's' }} selected, land impact <span class="text-fg">{{ landImpact }}</span></p>
					<p class="leading-3">
						Remaining capacity <span class="me-2 text-fg">{{ remainingCapacity || '??' }}.</span>
						<a href="https://docs.opensimulator.org/en/latest/features/build-tools/" target="_blank" rel="noopener noreferrer"
							title="More info (to-do)"
							disabled
							class="text-fg/30 cursor-not-allowed"
						>More info</a>
					</p>
				</div>
				<!-- Tab strip -->
				<nav class="tabs w-full">
					<button
						v-for="tab in tabs"
						:key="tab.id"
						:class="activeTab === tab.id
							? 'active'
							: ''"
						@click="activeTab = tab.id"
					>{{ tab.label }}</button>
				</nav>
				<div v-if="!obj" class="flex-1 flex items-center justify-center text-fg/30 italic px-4 text-center">
					Right-click a prim → Edit to inspect properties.
				</div>
				<div v-else class="flex-1 pt-1 px-1 pb-0">
					<!-- General ─────────────────────────────────────────────── -->
					<template v-if="activeTab === 'general'">
						<div class="grid grid-cols-[3.5rem_1fr] gap-x-1.5 items-center mb-1 text-xs">
							<div class="text-fg/50 text-2xs text-end" title="63 chars, ASCII-7 + pipe.">Name:</div>
							<input v-model="editName" :readonly="!canModify" maxlength="63" :title="canModify ? 'Enter or Tab to apply (ObjectName)' : 'No modify permission'" @focus="selectAll" @keyup.enter="onEnter(commitName, $event)" @blur="onBlur(commitName)" class="bg-fg/20 border border-edge rounded-sm mb-1 px-1.5 py-0.5 text-fg read-only:opacity-60 read-only:cursor-not-allowed" />
							<div class="text-fg/50 text-2xs text-end" title="127 chars. May get used in hover tips or scripting">Description:</div>
							<input v-model="editDesc" :readonly="!canModify" maxlength="127" placeholder="—" :title="canModify ? 'Enter or Tab to apply (ObjectDescription)' : 'No modify permission'" @focus="selectAll" @keyup.enter="onEnter(commitDesc, $event)" @blur="onBlur(commitDesc)" class="bg-fg/20 border border-edge rounded-sm px-1.5 py-0.5 text-fg read-only:opacity-60 read-only:cursor-not-allowed" />
							<div class="text-fg/50 text-2xs text-end">UUID:</div>
							<input :value="obj.fullId" readonly class="text-fg font-mono text-2xs" />
							<div class="text-fg/50 text-2xs text-end">Type:</div>
							<input :value="typeInfo.label" readonly class="text-fg" />
							<div class="text-fg/50 text-2xs text-end">Hover Text:</div>
							<div class="text-fg whitespace-pre-wrap">{{ obj.text || '—' }}</div>
						</div>
						<div v-if="obj.creatorId" class="border-t border-edge mb-1 pt-1">
							<div class="grid grid-cols-[3.5rem_1fr] text-xs">
								<div class="text-fg/50 text-2xs text-end">Creator:</div>
								<input :value="agentDisplay(obj.creatorId)" :title="obj.creatorId" readonly class="ms-1 px-1.5 py-0 text-fg font-mono text-2xs" />
								<div class="text-fg/50 text-2xs text-end">Owner:</div>
								<input :value="agentDisplay(obj.ownerId)" :title="obj.ownerId" readonly class="ms-1 px-1.5 py-0 text-fg font-mono text-2xs" />
								<div class="text-fg/50 text-2xs text-end whitespace-nowrap">Last Owner:</div>
								<input :value="agentDisplay(obj.lastOwnerId)" :title="obj.lastOwnerId || ''" readonly class="ms-1 px-1.5 py-0 text-fg font-mono text-2xs" />
								<div class="text-fg/50 text-2xs text-end">Group:</div>
								<input :value="obj.groupId" readonly class="ms-1 px-1.5 py-0 text-fg font-mono text-2xs" />
								<div class="text-fg/50 text-2xs text-end">Created:</div>
								<div class="ms-1 px-1.5 py-0 text-fg font-mono">{{ fmtCreationDate(obj.creationDate) }}</div>
								<div class="flex items-center justify-end text-fg/50 text-2xs text-end">Click to:</div>
								<select title="A click action enables you to interact with an object with a single left click." disabled class="ui-select bg-fg/20 border border-edge rounded-sm mb-1 ms-2 px-1.5 py-0 text-fg">
									<option v-for="o in CLICK_ACTION_OPTIONS" :key="o.value" :value="o.value" :selected="o.value === (obj.clickAction ?? 0)">{{ o.label }}</option>
								</select>
								<template v-if="obj.touchName">
									<div class="pe-2 text-fg/50 text-2xs text-end">Touch label:</div>
									<div class="mb-1 px-1.5 py-0.5 text-fg">{{ obj.touchName }}</div>
								</template>
								<template v-if="obj.sitName">
									<div class="pe-2 text-fg/50 text-2xs text-end">Sit label:</div>
									<div class="mb-1 px-1.5 py-0.5 text-fg">{{ obj.sitName }}</div>
								</template>
								<div class="grid grid-cols-[4rem_1fr] gap-x-0 text-xs">
									<label class="flex items-center justify-end gap-1 bg-fg/10 h-full px-1 text-fg/50 text-2xs text-end whitespace-nowrap"><input type="checkbox" class="accent-accent" :checked="(obj.saleType ?? 0) > 0" disabled /> For Sale</label>
									<div class="flex items-center gap-1 bg-fg/10 p-1">
										<select title="Whether purchaser receives original, copy, or contents." class="ui-select w-full bg-fg/20 border border-edge rounded-sm px-1.5 py-0 text-fg" :disabled="!(obj.saleType ?? 0)">
											<option v-for="o in SALE_TYPE_OPTIONS" :key="o.value" :value="o.value" :selected="o.value === (obj.saleType ?? 0)">{{ o.label }}</option>
										</select>
									</div>
									<div class="flex items-center justify-end gap-1 bg-fg/10 h-full pe-1 text-fg/50 text-2xs text-end self-center">Price ??$</div>
									<div class="flex items-center gap-1 bg-fg/10 p-1 pt-0">
										<input type="number" min="0" max="999999" step="1" :value="obj.salePrice" readonly
										class="bg-fg/20 border border-edge rounded-sm py-0.5 ps-1.5 w-15 text-fg font-mono" />
										<button title="Mark/Update object(s) for sale." class="ui-btn py-0.5 px-5 text-xs rounded-sm border transition-colors">Apply</button>
									</div>
								</div>
							</div>
						</div>
						<div v-if="obj.baseMask != null" class="border-t border-edge pt-1">
							<div class="text-fg/50 text-2xs uppercase tracking-wide">Permissions</div>
							<div class="flex gap-2">
								<div>
									<h6 v-if="false" class="mb-1 text-2xs text-accent">You must select entire object to set permissions</h6>
									<h6 v-else class="mb-1 text-2xs text-accent">{{ modifyInfo }}</h6>
									<h6 class="mb-0 text-3xs text-fg-muted leading-1.5">Anyone:</h6>
									<div class="flex align-center gap-3 mb-2">
										<PermCheckbox class="w-15 whitespace-nowrap" label="Move" title="Anyone can move the object." :row="permRows.everyoneMove" @toggle="set => onPermToggle(permRows.everyoneMove, set)" />
										<PermCheckbox class="w-13 whitespace-nowrap" label="Copy" title="Anyone can take a copy of the object. Object and all of its contents must be copy and transfer permissive." :row="permRows.everyoneCopy" @toggle="set => onPermToggle(permRows.everyoneCopy, set)" />
										<PermCheckbox class="w-15 whitespace-nowrap" label="Export" title="Anyone can export this Object." :row="permRows.everyoneExport" @toggle="set => onPermToggle(permRows.everyoneExport, set)" />
									</div>
									<h6 class="mb-0 text-3xs text-fg-muted leading-1.5">Next owner:</h6>
									<div class="flex gap-3 mb-0.5">
										<PermCheckbox class="w-15 whitespace-nowrap" label="Modify" title="Next owner can edit properties like item name or scale of this object." :row="permRows.nextModify" @toggle="set => onPermToggle(permRows.nextModify, set)" />
										<PermCheckbox class="w-13 whitespace-nowrap" label="Copy" title="Next owner can make unlimited copies of this object. Copies maintain creator information, and can never be more permissive than the item being copied." :row="permRows.nextCopy" @toggle="set => onPermToggle(permRows.nextCopy, set)" />
										<PermCheckbox class="w-15 whitespace-nowrap" label="Transfer" title="Next owner can give away or resell this object." :row="permRows.nextTransfer" @toggle="set => onPermToggle(permRows.nextTransfer, set)" />
									</div>
									<h6 class="mb-0 text-3xs text-fg-muted">Pathfinding attributes: <span class="text-xs text-fg">none</span></h6>
								</div>
								<!-- B/O/G/E/N/F debugging perms -->
								<div class="flex flex-col gap-1 mb-2 text-3xs font-mono leading-2">
									<div class="flex justify-between gap-1 w-full text-fg/50">
										<span class="w-12 text-end">Base:</span>
										<span class="w-7 text-fg">{{ permLetters(obj.baseMask) }}</span>
									</div>
									<div class="flex justify-between gap-1 w-full text-fg/50">
										<span class="w-12 text-end">Owner:</span>
										<span class="w-7 text-fg">{{ permLetters(obj.ownerMask) }}</span>
									</div>
									<div class="flex justify-between gap-1 w-full text-fg/50">
										<span class="w-12 text-end">Group:</span>
										<span class="w-7 text-fg">{{ permLetters(obj.groupMask) }}</span>
									</div>
									<div class="flex justify-between gap-1 w-full text-fg/50">
										<span class="w-12 text-end">Everyone:</span>
										<span class="w-7 text-fg">{{ permLetters(obj.everyoneMask) }}</span>
									</div>
									<div class="flex justify-between gap-1 w-full text-fg/50">
										<span class="w-12 text-end">Nextowner:</span>
										<span class="w-7 text-fg">{{ permLetters(obj.nextOwnerMask) }}</span>
									</div>
									<div class="flex justify-between gap-1 w-full text-fg/50">
										<span class="w-12 text-end">F:</span>
										<span class="w-7 text-fg">fmask</span>
									</div>
								</div>
							</div>
						</div>
						<div v-if="!obj.creatorId" class="border-t border-edge pt-2 text-2xs text-fg/40 italic">
							Loading properties from sim…
						</div>
					</template>
					<!-- Object ──────────────────────────────────────────────── -->
					<!-- WHY: FS-parity — the Object tab carries identity, transform AND the parametric
						prim-shape params + the building-block / mesh / sculpt type. The type row is how
						you tell a mesh from a sculpt from a plain prim. -->
					<template v-else-if="activeTab === 'object'">
						<div class="flex gap-2 px-0.5">
							<div class="w-2/5">
								<label class="inline-flex items-center gap-1 me-4 text-fg/70" title="Owner has removed Move permission — object is locked in place"><input type="checkbox" class="accent-accent" :checked="lockedFromOwnerMask(obj.ownerMask) === true" disabled /> Locked</label><!-- FS keys Locked off PERM_MOVE on the owner mask (llpanelobject.cpp:646-663), NOT Modify -->
								<label class="inline-flex items-center gap-1 me-4 text-fg/70" title="Physics simulation enabled"><input type="checkbox" class="accent-accent" :checked="!!obj.physical" disabled /> Physical</label>
								<label class="inline-flex items-center gap-1 me-4 text-fg/70" title="Auto-deletes after a short time"><input type="checkbox" class="accent-accent" :checked="!!obj.temporary" disabled /> Temporary</label>
								<label class="inline-flex items-center gap-1 me-4 text-fg/70" title="Avatar passes through — no collision"><input type="checkbox" class="accent-accent" :checked="!!obj.phantom" disabled /> Phantom</label>
								<!-- Transform — editable (M-2) + nudge steppers (M-3); commit on Enter/Tab/blur -->
								<div v-for="grp in [
										{ kind: 'pos',  label: 'Position (meters)',  colors: ['text-red-500 font-bold', 'text-green-500 font-bold', 'text-blue-500 font-bold'] },
										{ kind: 'size', label: 'Size (meters)',      colors: ['text-fg/40', 'text-fg/40', 'text-fg/40'] },
										{ kind: 'rot',  label: 'Rotation (degrees)', colors: ['text-fg/40', 'text-fg/40', 'text-fg/40'] },
									]" :key="grp.kind" class="my-2">
									<div class="font-medium text-fg/50 text-2xs whitespace-nowrap">{{ grp.label }}</div>
									<div class="grid gap-1 text-xs">
										<!-- Native number spinners (Gene 2026-07-05): press-and-hold + ↑/↓ step by `step`
											and fire @change per step (FS-spinner feel) — no custom arrow buttons. -->
										<div v-for="(axis, i) in ['X', 'Y', 'Z']" :key="axis" class="flex items-center gap-0.5">
											<span :class="grp.colors[i]">{{ axis }}</span>
											<input
												v-model="xf[grp.kind][i]"
												type="number"
												:step="grp.kind === 'rot' ? 1.00000 : 0.01000"
												:min="grp.kind === 'size' ? 0.00100 : (grp.kind === 'pos' ? 0 : undefined)"
												:readonly="!canXform"
												:title="xformTitle"
												class="w-20 bg-fg/20 border border-edge rounded-sm p-0 w-full text-xs text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="xfFocus = `${grp.kind}-${i}`; selectAll($event)"
												@blur="xfFocus = null; onBlur(XF_COMMIT[grp.kind])"
												@keyup.enter="onEnter(XF_COMMIT[grp.kind], $event)"
												@change="canXform && XF_COMMIT[grp.kind]()"
											/>
											<button v-if="i === 0" class="ui-btn text-2xs" :title="`Copy ${grp.kind} (to-do)`">C</button>
											<button v-else-if="i === 1" class="ui-btn text-2xs" :title="`Paste ${grp.kind} (to-do)`">P</button>
											<button v-else class="ui-btn text-2xs" :title="`Try pasting ${grp.kind} from clipboard (to-do)`">P</button>
										</div>
									</div>
								</div>
							</div>
							<div class="w-3/5 relative">
								<div class="absolute top-0 right-0 flex justify-end">
									<button title="Copy object parameters to clipboard (to-do)" class="inline mx-1" disabled><ClipboardCopyIcon class="w-4 h-4" /></button>
									<button title="Paste object parameters from clipboard (to-do)" class="inline" disabled><ClipboardPasteIcon class="w-4 h-4" /></button>
								</div>
								<!-- Identity / linkset -->
								<div class="grid grid-cols-[3rem_1fr] gap-y-0 gap-x-1 text-2xs">
									<div class="text-fg/50 text-3xs">LocalID</div>
									<div class="text-fg font-mono">{{ obj.localId }}</div>
									<div class="text-fg/50 text-3xs">Parent ID</div>
									<div class="text-fg font-mono">{{ obj.parentId ?? 0 }}{{ obj.parentId ? '' : ' (root)' }}</div>
									<div class="text-fg/50 text-3xs">Link Count</div>
									<div class="text-fg">{{ linkCount }}</div>
									<div class="text-fg/50 text-3xs">Bldg Block</div>
									<div class="text-fg">{{ typeInfo.label }}</div>
									<template v-if="typeInfo.detail">
										<div class="text-fg/50">{{ typeInfo.kind === 'mesh' ? 'Mesh asset' : 'Sculpt map' }}</div>
										<div class="flex items-center gap-1.5 min-w-0">
											<button
												class="w-10 h-10 shrink-0 bg-fg/20 border border-edge rounded-sm flex items-center justify-center text-fg/30 text-2xl overflow-hidden hover:border-accent"
												:title="typeInfo.kind === 'mesh' ? 'Mesh asset (no image preview)' : 'Preview sculpt map'"
												@click="typeInfo.kind === 'sculpt' ? openPreview(typeInfo.detail) : copyText(typeInfo.detail)"
											>
												<span>{{ typeInfo.kind === 'mesh' ? '◰' : '⛰' }}</span>
											</button>
											<input :value="typeInfo.detail" readonly class="flex-1 min-w-0 bg-fg/20 border border-edge rounded-sm px-1.5 py-0.5 text-fg font-mono text-2xs" />
										</div>
										<div class="text-fg/50">LOD:</div>
										<div class="text-fg font-mono">Num Triangles</div>
										<div class="text-fg/50">High:</div>
										<div class="text-fg font-mono">####</div>
										<div class="text-fg/50">Medium:</div>
										<div class="text-fg font-mono">###</div>
										<div class="text-fg/50">Low:</div>
										<div class="text-fg font-mono">##</div>
										<div class="text-fg/50">Lowest:</div>
										<div class="text-fg font-mono">##</div>
									</template>
								</div>
								<!-- Parametric prim shape (FS: lives on the Object tab) — editable spinners, FS-parity
									display math via @/lib/primParams.js (displayParams/uiToWireParams). Per-PRIM commit
									(commitShape, no linkset-root resolution — see script section above). 5 decimals
									everywhere EXCEPT Twist (integer degrees, Gene's spec). -->
								<div v-if="showPrimShape && shapeMeta" class="border-t border-edge pt-2 space-y-1">
									<div class="text-fg/50 text-2xs uppercase tracking-wide">Prim Shape</div>
									<div class="text-2xs">
										<div class="flex gap-1">
											<div class="text-fg/50">Profile</div>
											<div class="text-fg">{{ profileCurveLabel }}</div>
										</div>
										<select title="to-do" class="ui-select bg-fg/20 border border-edge rounded-sm my-1 w-full">
											<option>Box</option>
											<option>Cylinder</option>
											<option>Prism</option>
											<option>Sphere</option>
											<option>Torus</option>
											<option>Tube</option>
											<option>Ring</option>
											<option>Sculpted</option>
											<option>Line->Half-Circle</option>
											<option>Circle->Half-Circle</option>
											<option>Circle2->Square</option>
											<option>Circle2->Triangle</option>
											<option>Circle2->Circle</option>
											<option>Circle2->Half-Circle</option>
											<option>Test->Square</option>
											<option>Test->Triangle</option>
											<option>Test->Circle</option>
											<option>Test->Half-Circle</option>
											<option>33->Square</option>
											<option>33->Triangle</option>
											<option>33->Circle</option>
											<option>33->Half-Circle</option>
										</select>
										<div class="text-fg/50 self-center">Path Cut (begin/end)</div>
										<div class="flex items-center gap-1 mb-1">
											<span class="text-fg/40">B</span>
											<input v-model="shapeUi.pathCutBegin" type="number" step="0.05" min="0" max="1" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'pathCutBegin'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
											<span class="text-fg/40">E</span>
											<input v-model="shapeUi.pathCutEnd" type="number" step="0.05" min="0" max="1" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'pathCutEnd'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
										</div>

										<div class="text-fg/50 self-center">Hollow (%) and Shape</div>
										<div class="flex items-center gap-1 mb-1">
											<input v-model="shapeUi.hollowPct" type="number" step="5.00000" min="0.00000" max="95" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'hollowPct'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
												<select title="to-do" class="ui-select bg-fg/20 border border-edge rounded-sm w-full" :class="{ 'opacity-60 cursor-not-allowed': shapeUi.hollowPct == 0 }" :disabled="shapeUi.hollowPct == 0">
													<option>Default</option>
													<option>Circle</option>
													<option>Square</option>
													<option>Triangle</option>
												</select>
										</div>

										<div class="text-fg/50 self-center">Twist (begin/end)</div>
										<div class="flex items-center gap-1 mb-1">
											<span class="text-fg/40">B</span>
											<input v-model="shapeUi.twistBegin" type="number" :step="shapeMeta.linear ? 9 : 18" :min="shapeMeta.linear ? -180 : -360" :max="shapeMeta.linear ? 180 : 360" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'twistBegin'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
											<span class="text-fg/40">E</span>
											<input v-model="shapeUi.twistEnd" type="number" :step="shapeMeta.linear ? 9 : 18" :min="shapeMeta.linear ? -180 : -360" :max="shapeMeta.linear ? 180 : 360" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'twistEnd'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
										</div>

										<div class="text-fg/50 self-center">{{ shapeMeta.taperLabel }}</div>
										<div class="flex items-center gap-1 mb-1">
											<span class="text-fg/40">X</span>
											<input v-model="shapeUi.taperX" type="number" step="0.05" :min="shapeMeta.taperXRange[0]" :max="shapeMeta.taperXRange[1]" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'taperX'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
											<span class="text-fg/40">Y</span>
											<input v-model="shapeUi.taperY" type="number" step="0.05" :min="shapeMeta.taperYRange[0]" :max="shapeMeta.taperYRange[1]" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'taperY'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
										</div>

										<div class="text-fg/50 self-center">Top Shear</div>
										<div class="flex items-center gap-1 mb-1">
											<span class="text-fg/40">X</span>
											<input v-model="shapeUi.shearX" type="number" step="0.05" min="-0.5" max="0.5" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'shearX'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
											<span class="text-fg/40">Y</span>
											<input v-model="shapeUi.shearY" type="number" step="0.05" min="-0.5" max="0.5" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'shearY'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
										</div>

										<div class="text-fg/50 self-center">{{ shapeMeta.advLabel }} (begin/end)</div>
										<div class="flex items-center gap-1 mb-1">
											<span class="text-fg/40">B</span>
											<input v-model="shapeUi.advBegin" type="number" step="0.05" min="0" max="1" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'advBegin'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
											<span class="text-fg/40">E</span>
											<input v-model="shapeUi.advEnd" type="number" step="0.05" min="0" max="1" :readonly="!canShapeEdit" :title="shapeEditTitle"
												class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
												@focus="shapeFocus = 'advEnd'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
												@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
										</div>

										<!-- Radius Offset / Revolutions / Skew — circular family only (torus/tube/ring/sphere) -->
										<template v-if="shapeMeta.showRadiusRevSkew">
											<div class="flex items-center justify-between gap-1 mb-1">
												<div>
													<div class="text-fg/50 self-center">Radius [Offset?]</div>
													<input v-model="shapeUi.radiusOffset" type="number" step="0.05" min="-1" max="1" :readonly="!canShapeEdit" :title="shapeEditTitle"
														class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 w-full text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
														@focus="shapeFocus = 'radiusOffset'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
														@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
												</div>
												<div>
													<div class="text-fg/50 self-center">Revolutions</div>
													<div class="flex items-center gap-1">
														<input v-model="shapeUi.revolutions" type="number" step="0.05" min="1" max="4" :readonly="!canShapeEdit" :title="shapeEditTitle"
															class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 w-full text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
															@focus="shapeFocus = 'revolutions'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
															@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
													</div>
												</div>
											</div>
											<div class="text-fg/50 self-center">Skew</div>
											<div class="flex items-center gap-1">
												<input v-model="shapeUi.skew" type="number" step="0.05" min="-0.95" max="0.95" :readonly="!canShapeEdit" :title="shapeEditTitle"
													class="w-full min-w-0 bg-fg/20 border border-edge rounded-sm p-0 text-fg font-mono read-only:opacity-60 read-only:cursor-not-allowed"
													@focus="shapeFocus = 'skew'; selectAll($event)" @blur="shapeFocus = null; onBlur(commitShape)"
													@keyup.enter="onEnter(commitShape, $event)" @change="canShapeEdit && commitShape()" />
											</div>
										</template>
									</div>
								</div>
								<div v-else-if="typeInfo.kind === 'mesh'" class="border-t border-edge pt-2 text-2xs text-fg/40 italic">Geometry comes from the mesh asset above. LOD triangle counts arrive with the mesh-info decode (to-do).</div>
							</div>
						</div>
					</template>
					<!-- Features ────────────────────────────────────────────── -->
					<!-- WHY: FS-parity LLPanelVolume layout — Flexible Path, Light, Reflection Probe and
						Physics. Material (mcode), Flexi (0x10), Light (0x20) and Reflection Probe (0x90)
						are decoded from the ObjectUpdate ExtraParams; only Physics Shape rides the to-do
						ObjectPhysicsProperties work, so it still shows "not decoded". -->
					<template v-else-if="activeTab === 'features'">
						<div class="grid grid-cols-[1fr_1fr] gap-x-2 gap-y-1.5 text-xs px-0.5">
							<div class="flex flex-col gap-1">
								<div>Edit object features:</div>
								<div><input type="checkbox" title="to-do" class="accent-accent" /> Animated mesh</div>
								<div class="text-fg/50"><input type="checkbox" title="to-do" class="accent-accent" /> Flexible Path</div>
								<div v-if="flexiLabel" class="text-fg text-2xs">{{ flexiLabel }}</div>
								<div v-else class="text-fg/40 italic">Off</div>
								<div>Softness</div>
								<div>Gravity</div>
								<div>Drag</div>
								<div>Wind</div>
								<div>Tension</div>
								<div>Force X</div>
								<div>Force Y</div>
								<div>Force Z</div>
								<div class="text-fg/50"><input type="checkbox" title="to-do" class="accent-accent" /> Light</div>
								<div v-if="obj.light" class="flex items-center gap-2 text-fg text-2xs">
									<span class="w-4 h-4 shrink-0 rounded-sm border border-edge" :style="{ background: `rgb(${lightRgb})` }"></span>
									<span>intensity {{ obj.light.intensity.toFixed(2) }} · radius {{ obj.light.radius.toFixed(1) }}m · falloff {{ obj.light.falloff.toFixed(1) }}</span>
								</div>
								<div v-else class="text-fg/40 italic">Off</div>
								<div>Intensity</div>
								<div>Radius</div>
								<div>Falloff</div>
								<div class="text-fg/50"><input type="checkbox" title="to-do" class="accent-accent" /> Reflection Probe</div>
								<div v-if="reflectionProbeLabel" class="text-fg text-2xs">{{ reflectionProbeLabel }}</div>
								<div v-else class="text-fg/40 italic">Off</div>
								<div><input type="checkbox" title="to-do" class="accent-accent" /> Dynamic</div>
								<div>Ambiance</div>
							</div>
							<div class="flex flex-col gap-1">
								<div class="text-fg/50">Physics shape type</div>
								<div class="text-fg/40 italic">not decoded</div>
								<div class="text-fg/50">Material (physics)</div>
								<div class="text-fg">{{ materialLabel }}</div>
								<div>Gravity</div>
								<div>Friction</div>
								<div>Density in kg/m³</div>
								<div>Bounciness</div>
								<div>FOV</div>
								<div>Focus</div>
								<div>Ambiance</div>
								<div>[       ]</div>
								<div>Next clip</div>
							</div>
						</div>
						<div class="text-2xs text-fg/30 italic pt-1">
							Physics-shape type isn't carried in the object update — it arrives in a separate
							ObjectPhysicsProperties packet (to-do physics-flags work).
						</div>
					</template>
					<!-- Texture ─────────────────────────────────────────────── -->
					<!-- WHY: FS matmedia split — Blinn-Phong (legacy diffuse/normal/specular) vs PBR
						(GLTF metallic-roughness) sub-tabs. "Multiple" surfaces when faces differ; every
						texture chip opens a larger preview ("texture picker"). Read-only (to-do edit). -->
					<template v-else-if="activeTab === 'texture'">
						<!-- Sub-tab strip -->
						<nav class="tabs -mt-1 mb-1 whitespace-nowrap">
							<button :class="texSubTab === 'pbr' ? 'active' : ''" @click="texSubTab = 'pbr'">PBR</button>
							<button :class="texSubTab === 'bp' ? 'active' : ''" @click="texSubTab = 'bp'">Blinn-Phong</button>
							<button :class="texSubTab === 'mdia' ? 'active' : ''" @click="texSubTab = 'mdia'">Media</button>
						</nav>
						<!-- PBR (GLTF metallic-roughness) ────────────────────── -->
						<template v-if="texSubTab === 'pbr'">
							<div v-if="!hasPbr" class="text-fg/40 italic px-1 py-3 text-center">
								No PBR material on this object — it uses Blinn-Phong (legacy) textures.
							</div>
							<template v-else>
								<div class="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-2 text-xs">
									<div class="text-fg/50 self-center">Material</div>
									<div class="flex-1 min-w-0">
										<div v-if="isMultiPbr" class="text-accent font-semibold mb-0.5">Multiple ({{ distinctPbr.length }})</div>
										<div class="flex items-center gap-1.5">
											<input
												:value="obj.defaultPbrMaterial || distinctPbr[0] || '(none)'"
												readonly
												class="flex-1 min-w-0 bg-fg/20 border border-edge rounded-sm px-1.5 py-0.5 text-fg font-mono text-2xs"
											/>
											<button class="ui-btn p-1 rounded-sm border border-edge text-fg/60 hover:text-fg hover:bg-fg/20" title="Copy material UUID" @click="copyText(obj.defaultPbrMaterial || distinctPbr[0])"><CopyIcon class="w-3 h-3" /></button>
										</div>
									</div>
								</div>
								<div v-if="pbrFaceChips.length" class="border-t border-edge pt-2">
									<div class="text-fg/50 text-2xs uppercase tracking-wide mb-1">Per-face PBR materials</div>
									<div class="space-y-1">
										<div v-for="c in pbrFaceChips" :key="c.face" class="flex items-center gap-1.5 text-2xs">
											<span class="w-6 shrink-0 text-fg/50">F{{ c.face }}</span>
											<input :value="c.uuid" readonly class="flex-1 min-w-0 bg-fg/20 border border-edge rounded-sm px-1 py-0.5 text-fg font-mono" />
										</div>
									</div>
								</div>
								<div class="text-2xs text-fg/30 italic pt-1">
									GLTF material assets (base color / metallic-roughness / emissive / normal maps) render via the materials cap. Per-channel editing arrives in to-do.
								</div>
							</template>
						</template>
						<!-- Blinn-Phong (legacy) ─────────────────────────────── -->
						<template v-else-if="texSubTab === 'bp'">
							<div class="grid grid-cols-[4.25rem,1fr] gap-y-2 gap-x-2 mb-0.5 text-xs">
								<!-- <div class="text-fg/50 self-center">Texture</div> -->
								<div class="flex items-start justify-between gap-2 w-full min-w-0">
									<div class="flex flex-col items-center gap-0.5">
										<div class="flex items-center gap-1">
											<div class="flex flex-col items-center gap-0.5">
												<button
													class="flex items-center justify-center shrink-0 bg-fg/20 border border-edge rounded-sm p-0 w-12 h-12 text-fg/30 text-2xs overflow-hidden hover:border-accent"
													:title="obj.defaultTexture ? 'Click for larger preview' : 'No texture'"
													@click="openPreview(obj.defaultTexture)"
												>
													<img v-if="texUrls[obj.defaultTexture]" :src="texUrls[obj.defaultTexture]" class="w-full h-full object-cover" alt="texture" @error="reloadTex(obj.defaultTexture)" />
													<span v-else>{{ obj.defaultTexture ? '…' : 'No tex' }}</span>
												</button>
												<div class="text-2xs">Diffuse</div>
											</div>
											<div class="flex flex-col items-center gap-0.5">
												<button
													title="Click to open color picker"
													class="w-6 min-h-12 rounded-sm border border-edge"
													:style="chipTint
														? { background: `rgba(${Math.round(chipTint[0]*255)},${Math.round(chipTint[1]*255)},${Math.round(chipTint[2]*255)},${chipTint[3].toFixed(2)})` }
														: { background: 'rgba(255,255,255,0.05)' }"
												></button>
												<div class="text-2xs">Tint</div>
											</div>
										</div>
										<div class="flex items-center gap-1">
											<div class="flex flex-col items-center gap-0.5">
												<button
													class="flex items-center justify-center shrink-0 bg-fg/20 border border-edge rounded-sm p-0 w-12 h-12 text-fg/30 text-2xs overflow-hidden hover:border-accent"
													>
													<!-- :title="obj.defaultTexture ? 'Click for larger preview' : 'No texture'"
													@click="openPreview(obj.defaultTexture)"
													<img v-if="texUrls[obj.defaultTexture]" :src="texUrls[obj.defaultTexture]" class="w-full h-full object-cover" alt="texture" @error="reloadTex(obj.defaultTexture)" />
													<span v-else>{{ obj.defaultTexture ? '…' : 'No tex' }}</span> -->
													X
												</button>
												<div class="text-2xs">Normal</div>
											</div>
											<div class="flex flex-col items-center gap-0.5">
												<div class="w-6">&nbsp;</div>
											</div>
										</div>
										<div class="flex items-center gap-1">
											<div class="flex flex-col items-center gap-0.5">
												<button
													class="flex items-center justify-center shrink-0 bg-fg/20 border border-edge rounded-sm p-0 w-12 h-12 text-fg/30 text-2xs overflow-hidden hover:border-accent"
													>
													<!-- :title="obj.defaultTexture ? 'Click for larger preview' : 'No texture'"
													@click="openPreview(obj.defaultTexture)" -->
													<!-- <img v-if="texUrls[obj.defaultTexture]" :src="texUrls[obj.defaultTexture]" class="w-full h-full object-cover" alt="texture" @error="reloadTex(obj.defaultTexture)" />
													<span v-else>{{ obj.defaultTexture ? '…' : 'No tex' }}</span> -->
													X
												</button>
												<div class="text-2xs">Specular</div>
											</div>
											<div class="flex flex-col items-center gap-0.5">
												<button
													title="Click to open color picker"
													class="w-6 min-h-12 rounded-sm border border-edge"
													>
													<!-- :style="obj.defaultColor
														? { background: `rgba(${Math.round(obj.defaultColor[0]*255)},${Math.round(obj.defaultColor[1]*255)},${Math.round(obj.defaultColor[2]*255)},${obj.defaultColor[3].toFixed(2)})` }
														: { background: 'rgba(255,255,255,0.05)' }" -->
														🔒
												</button>
												<div class="text-2xs">Color</div>
											</div>
										</div>
									</div>
									<div class="flex flex-col items-end gap-0.5">
										<div class="flex-1 justify-start w-full min-w-0 text-2xs">
											<div v-if="isMultiTexture" class="text-accent font-semibold mb-0.5">Multiple ({{ distinctTextures.length }})</div>
											<input
												:value="obj.defaultTexture || '(none)'"
												readonly
												class="bg-fg/20 py-0 px-1.5 w-full text-fg font-mono text-2xs"
											/>
										</div>
										<div class="flex justify-start w-full min-w-0 gap-2 text-2xs">
											<span v-if="isMultiColor" class="text-accent font-semibold">Multiple</span>
											<input
												v-else
												:value="chipTint ? chipTint.slice(0,3).map(v => Math.round(v*255)).join(', ') : '255, 255, 255'"
												readonly
												class="bg-fg/20 py-0 px-1.5 w-full text-fg font-mono text-2xs"
											/>
										</div>
										<div class="flex items-center gap-4">
											<label for="fullbright" class="flex gap-1">
												<input name="fullbright" type="checkbox" class="accent-accent" :checked="obj.defaultFullbright" />
												<span class="text-fg/50 self-center whitespace-nowrap">Full bright</span>
											</label>
											<div class="flex gap-2">
												<div class="text-fg/50 self-center">Glow</div>
												<input :value="(obj.defaultGlow ?? 0).toFixed(3)" type="number" min="0.000" max="1.000" step="0.100" class="bg-fg/20 border border-edge rounded-sm py-0.5 ps-1.5 w-15 text-fg font-mono" readonly />
											</div>
										</div>
										<div class="flex gap-2">
											<div class="text-fg/50 self-center">Transparency %</div>
											<input
												:value="obj.defaultColor ? Math.round((1 - obj.defaultColor[3]) * 100) : 0"
												type="number"
												min="0" max="100" step="2"
												class="bg-fg/20 border border-edge rounded-sm py-0.5 ps-1.5 w-13 text-fg font-mono"
												readonly
											/>
										</div>
										<div class="flex gap-1">
											<div class="text-fg/50 self-center whitespace-nowrap">Alpha mode</div>
											<div class="text-fg">
												<!-- Local render override (#17b) — not sent to the sim. Auto = blend when the
													texture has alpha. Emissive mask renders as None (unlit materials). -->
												<select
													v-model="alphaMode"
													class="ui-select w-full bg-fg/20 border border-edge rounded-sm py-0 px-1.5 text-fg"
												>
													<option value="">Auto (blend if alpha)</option>
													<option value="none">None</option>
													<option value="blend">Alpha blending</option>
													<option value="mask">Alpha masking</option>
													<option value="emissive">Emissive mask</option>
												</select>
											</div>
										</div>
										<div class="flex gap-2">
											<div class="text-fg/50 self-center">Mask cutoff</div>
											<div class="text-fg">to-do</div>
										</div>
										<div class="flex gap-2">
											<div class="text-fg/50 self-center">Bumpiness</div>
											<div class="text-fg">{{ bumpLabel }}</div>
										</div>
										<div class="flex gap-2">
											<div class="text-fg/50 self-center">Shininess</div>
											<div class="text-fg">{{ shinyLabel }}</div>
										</div>
										<div class="flex gap-2">
											<div class="text-fg/50 self-center">Glossiness</div>
											<div class="text-fg">to-do</div>
										</div>
										<div class="flex gap-2">
											<div class="text-fg/50 self-center">Environment</div>
											<div class="text-fg">to-do</div>
										</div>
									</div>
								</div>
							</div>
							<!-- Per-face diffuse chips (only faces overriding the default) -->
							<div v-if="faceTexChips.length" class="border-t border-edge mb-1 pt-0.5">
								<div class="text-fg/50 text-2xs uppercase tracking-wide mb-0">Per-face textures</div>
								<div class="flex flex-wrap gap-1.5">
									<button
										v-for="c in faceTexChips"
										:key="c.face"
										class="relative w-10 h-10 bg-fg/20 border border-edge rounded-sm overflow-hidden hover:border-accent"
										:title="`Face ${c.face} — click for preview`"
										@click="openPreview(c.uuid)"
									>
										<img v-if="texUrls[c.uuid]" :src="texUrls[c.uuid]" class="w-full h-full object-cover" alt="" @error="reloadTex(c.uuid)" />
										<span v-else class="absolute inset-0 flex items-center justify-center text-fg/30 text-2xs">…</span>
										<span class="absolute bottom-0 right-0 px-0.5 bg-black/60 text-[0.5rem] text-fg/80 rounded-tl">{{ c.face }}</span>
									</button>
								</div>
							</div>
							<!-- Per-face mapping overrides (Scale / Offset / Rotation / Mapping, planar-aware) -->
							<div v-if="faceUvRows.length" class="border-t border-edge pt-2">
								<div class="text-fg/50 text-2xs uppercase tracking-wide mb-1">Per-face mapping</div>
								<div class="space-y-1">
									<div v-for="r in faceUvRows" :key="r.face" class="grid grid-cols-[2rem,1fr] gap-x-2 items-baseline text-2xs">
										<span class="text-fg/50">F{{ r.face }}</span>
										<div class="font-mono text-fg">
											<span v-if="r.mapping !== 'Default'" class="text-accent">{{ r.mapping }}</span>
											Scale {{ r.repeats[0].toFixed(5) }}×{{ r.repeats[1].toFixed(5) }}
											<template v-if="r.rpm != null">· RPM {{ r.rpm.toFixed(5) }}</template>
											· Off {{ r.offset[0].toFixed(5) }},{{ r.offset[1].toFixed(5) }}
											· Rot {{ (r.rotation * 180 / Math.PI).toFixed(5) }}°
										</div>
									</div>
								</div>
							</div>
							<!-- Mapping (default face) — FS-style: Mapping mode + Scale H/V + Offset H/V + Rotation -->
							<div class="border-t border-edge pt-2">
								<nav class="tabs -mt-1 mb-1 whitespace-nowrap">
									<button class="active">Diffuse</button>
									<button>Normal</button>
									<button>Specular</button>
								</nav>
								<!-- to-do: 3 sets of # spinners in tabs (5 of them only?): -->
								<div class="grid grid-cols-3 gap-x-2 px-1 justify-items-center text-2xs">
									<div class="text-center">
										Scale
										<div class="flex items-center gap-1">H<input :value="defaultMapping.repeats[0].toFixed(5)" type="number" step="0.10000" min="-1.00000" max="1.00000" readonly class="bg-fg/20 border border-edge rounded-sm mb-0.5 py-0.5 ps-1.5 w-full text-xs text-fg font-mono" /></div>
										<div class="flex items-center gap-1">V<input :value="defaultMapping.repeats[1].toFixed(5)" type="number" step="0.10000" min="-1.00000" max="1.00000" readonly class="bg-fg/20 border border-edge rounded-sm mb-0.5 py-0.5 ps-1.5 w-full text-xs text-fg font-mono" /></div>
									</div>
									<div class="text-center">
										Offset
										<div class="flex items-center gap-1">H<input :value="defaultMapping.offset[0].toFixed(5)" type="number" step="0.10000" min="-1.00000" max="1.00000" readonly class="bg-fg/20 border border-edge rounded-sm mb-0.5 py-0.5 ps-1.5 w-full text-xs text-fg font-mono" /></div>
										<div class="flex items-center gap-1">V<input :value="defaultMapping.offset[1].toFixed(5)" type="number" step="0.10000" min="-1.00000" max="1.00000" readonly class="bg-fg/20 border border-edge rounded-sm mb-0.5 py-0.5 ps-1.5 w-full text-xs text-fg font-mono" /></div>
									</div>
									<div class="text-center">
										Rotation
										<div class="flex items-center gap-1">°<input :value="(defaultMapping.rotation * 180 / Math.PI).toFixed(5)" type="number" step="1.00000" min="-360" max="360" readonly class="bg-fg/20 border border-edge rounded-sm mb-0.5 py-0.5 ps-1.5 w-full text-xs text-fg font-mono" /></div>
									</div>
								</div>
								<div class="grid grid-cols-[2fr_1fr] gap-y-1.5 gap-x-2 border-t border-edge pt-0.5 pe-2 ps-1 text-xs">
									<div>
										<template v-if="defaultMapping.rpm != null">
											<div class="flex gap-2 mb-1">
												<div class="text-fg/50 self-center whitespace-nowrap" title="Repeats per meter — raw scale ÷ object span (FS rptctrl)">Repeats / m</div>
												<input :value="defaultMapping.rpm.toFixed(5)" type="number" step="0.10000" readonly class="bg-fg/20 border border-edge rounded-sm py-0.5 ps-1.5 w-full text-fg font-mono" />
											</div>
										</template>
										<label class="inline-flex items-center gap-1 mb-1 text-fg/50"><input type="checkbox" class="accent-accent" title="Synchronize texture map parameters" disabled /> Synchronize materials</label>
										<label class="inline-flex items-center gap-1 text-fg/50"><input type="checkbox" class="accent-accent" title="Align textures on all selected faces with the last selected face. Requires Planar texture mapping." disabled /> Align planar faces</label>
									</div>
									<div>
										<label class="inline-flex items-center gap-1 text-fg/50 whitespace-nowrap"><input type="checkbox" title="to-do" class="accent-accent" /> Hide water</label>
										<select class="ui-select bg-fg/20 border border-edge rounded-sm my-1 py-0 px-1.5 w-full text-2xs text-fg" title="Mapping">
											<option value="default" :selected="defaultMapping.mapping === 'Default'">Default</option>
											<option value="planar" :selected="defaultMapping.mapping === 'Planar'">Planar</option>
										</select>
										<button class="bg-white/10 border border-edge rounded-sm py-[0.0625rem] px-2 w-full text-2xs text-fg/40 cursor-not-allowed" disabled>Align</button>
									</div>
								</div>
							</div>
							<div v-if="obj.defaultMaterialId" class="border-t border-edge pt-2">
								<div class="text-fg/50 text-2xs uppercase tracking-wide mb-1">Legacy material (normal/specular)</div>
								<input :value="obj.defaultMaterialId" readonly class="w-full bg-fg/20 border border-edge rounded-sm px-1.5 py-0.5 text-fg font-mono text-2xs" />
							</div>
						</template>
						<template v-else>
							<div class="text-fg/40 italic px-1 py-3 text-center">
								Media to-do
							</div>
						</template>
					</template>
					<!-- Content ─────────────────────────────────────────────── -->
					<!-- Prim (task) inventory via RequestTaskInventory + Xfer (useTaskInventory).
						FS llpanelobjectinventory.cpp model; Open = llfloateropenobject.cpp copy-to-agent-folder.
						New Script / Edit stay disabled: no script editor yet (docs/FEATURE-GAPS.md scripts). -->
					<template v-else-if="activeTab === 'content'">
						<div class="p-0.5">
							<div class="flex items-stretch gap-1 pb-1.5">
								<button class="bg-white/10 border border-edge rounded-sm py-0.5 px-1 text-2xs leading-2.5 text-fg/40 cursor-not-allowed" disabled title="Content editing isn't supported yet">New script</button>
								<button class="bg-white/10 border border-edge rounded-sm py-0.5 px-1 text-2xs leading-2.5 text-fg/40 cursor-not-allowed" disabled title="Content editing isn't supported yet">Perms</button>
								<button class="bg-white/10 border border-edge rounded-sm py-0.5 px-1 text-2xs leading-2.5 text-fg/40 cursor-not-allowed enabled:text-fg enabled:hover:bg-fg/10 disabled:text-fg/40 disabled:cursor-not-allowed" :disabled="!contentItems.length" title="Copy contents to a new folder in your inventory" @click="openContentsClick">Copy to inv</button>
								<button class="bg-white/10 border border-edge rounded-sm py-0.5 px-1 text-2xs leading-2.5 text-fg/40 cursor-not-allowed" disabled title="Item editing isn't supported yet">Edit / Open</button>
								<div class="flex flex-col gap-1">
									<button class="bg-white/10 hover:bg-fg/10 border border-edge rounded-sm py-0.5 px-1 text-2xs leading-2.5 text-fg" title="Reload obj contents from the region" @click="refreshContents">Refresh</button>
									<button class="bg-white/10 hover:bg-fg/10 border border-edge rounded-sm py-0.5 px-1 text-2xs leading-2.5 text-fg/40 bg-white/10 cursor-not-allowed" disabled title="Item editing isn't supported yet" @click="confirm('Are you sure you want to modify scripts in selected objects?\n\n[ ] Don\'t show again\n\n\t\tOK\tCancel')">Reset scripts</button>
								</div>
							</div>
							<div class="border border-edge rounded-sm bg-white/10 p-1 min-h-[10rem] max-h-72 overflow-y-auto text-xs">
								<div v-if="contentState?.loading" class="p-8 font-medium text-center text-fg/40 italic">Loading contents…</div>
								<div v-else-if="contentState?.error" class="p-8 font-medium text-center text-red-400/80">{{ contentState.error }}</div>
								<div v-else-if="!contentItems.length" class="font-medium text-fg">📁 Contents (no elements)</div>
								<template v-else>
									<div class="font-medium text-fg">📁 Contents ({{ contentItems.length }} element{{ contentItems.length === 1 ? '' : 's' }})</div>
									<div v-for="it in contentItems" :key="it.itemId" class="flex items-center gap-1 pe-1 ps-2.5 hover:bg-fg/5" :title="it.desc || it.name">
										<span class="shrink-0">{{ itemIcon(it.assetType, it.invType) }}</span>
										<span class="truncate text-fg">{{ it.name }}</span>
										<div class="ml-auto shrink-0 w-7 text-start text-2xs text-fg/50 font-mono" title="Owner permissions (V/M/C/T/X)">{{ permLetters(it.ownerMask) }}</div>
									</div>
								</template>
							</div>
						</div>
					</template>
				</div>
			</div>

			<!-- Texture preview ("texture picker") overlay ─────────────────────── -->
			<div
				v-if="previewUuid"
				class="absolute inset-0 z-10 flex flex-col bg-panel/95 backdrop-blur-xs"
				@click.self="closePreview"
			>
				<div class="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
					<span class="text-xs text-fg font-semibold">Texture Preview</span>
					<button class="ml-auto ui-btn p-1 rounded-sm border border-edge text-fg/60 hover:text-fg hover:bg-fg/20" title="Close" @click="closePreview"><XIcon class="w-3.5 h-3.5" /></button>
				</div>
				<div class="flex-1 min-h-0 flex items-center justify-center p-3">
					<img
						v-if="texUrls[previewUuid]"
						:src="texUrls[previewUuid]"
						class="max-w-full max-h-full object-contain border border-edge rounded-sm"
						:style="{ background: 'repeating-conic-gradient(#0003 0 25%, transparent 0 50%) 0 0 / 1rem 1rem' }"
						alt="texture preview"
						@error="reloadTex(previewUuid)"
					/>
					<div v-else class="text-fg/40 italic text-xs">Loading texture…</div>
				</div>
				<div class="flex items-center gap-1.5 px-3 py-2 border-t border-edge shrink-0">
					<input :value="previewUuid" readonly class="flex-1 min-w-0 bg-fg/20 border border-edge rounded-sm px-1.5 py-0.5 text-fg font-mono text-2xs" />
					<button class="ui-btn p-1.5 rounded-sm border border-edge text-fg/60 hover:text-fg hover:bg-fg/20" title="Copy UUID" @click="copyText(previewUuid)"><CopyIcon class="w-3.5 h-3.5" /></button>
				</div>
			</div>
		</div>
	</FloaterWindow>
</template>

<style scoped lang="scss">
.primcreate label.active {
	border-color: var(--accent);
}
.primcreate label.active img {
	background-color: var(--accent-dark);
}
</style>
