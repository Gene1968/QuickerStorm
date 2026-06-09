<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'
import { getTextureUrl } from '@/composables/useTextureFetch.js'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { ZoomInIcon, HandIcon, SquareMousePointerIcon, WandIcon, PickaxeIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, XIcon, CopyIcon } from '@lucide/vue'

const ui    = useUiStore()
const world = useWorldStore()

const activeTab = ref('general')
// Texture-tab sub-tab: 'bp' = Blinn-Phong (legacy diffuse/normal/specular), 'pbr' = GLTF PBR.
const texSubTab = ref('bp')

// WHY: FS-parity Build Tools. Top row = the five major tools (Focus/Move/Edit/Create/Land) as a
// radio group; Edit is the default while editing. Focus/Create/Land are Phase 3 stubs (disabled).
// The Move/Rotate/Stretch sub-row below selects the gizmo operation (uiStore.gizmoMode), which is
// also driven by Ctrl / Ctrl+Shift modifier keys in useWorldEngine.
const buildTool = ref('edit')
const tools = [
	{ id: 'focus',  label: 'Focus',  icon: ZoomInIcon,    disabled: true  },
	{ id: 'move',   label: 'Move',   icon: HandIcon,     disabled: false },
	{ id: 'edit',   label: 'Edit',   icon: SquareMousePointerIcon,   disabled: false },
	{ id: 'create', label: 'Create', icon: WandIcon,      disabled: true  },
	{ id: 'land',   label: 'Land',   icon: PickaxeIcon, disabled: true  },
]
function pickTool(t) {
	if (t.disabled) return
	buildTool.value = t.id
}

// Gizmo operation radios — tied to uiStore.gizmoMode (and the Ctrl / Ctrl+Shift modifiers).
const gizmoOps = [
	{ id: 'move',   label: 'Move',    hint: 'Position handles' },
	{ id: 'rotate', label: 'Rotate',  hint: 'Rotation rings (Ctrl)' },
	{ id: 'scale',  label: 'Stretch', hint: 'Scale handles (Ctrl+Shift)' },
]
const obj       = computed(() => ui.editObjectId ? world.objects.get(ui.editObjectId) : null)

const tabs = [
	{ id: 'general',  label: 'General' },
	{ id: 'object',   label: 'Object' },
	{ id: 'features', label: 'Features' },
	{ id: 'texture',  label: 'Texture' },
	{ id: 'content',  label: 'Content' },
]

// ── Texture thumbnail loading ─────────────────────────────────────────────
// WHY: getTextureUrl resolves async (ViewerAsset→J2C→PNG, IDB-cached). Keep a reactive uuid→url
// map so face chips + the preview panel reuse one fetch per UUID. null = still loading / no image.
const texUrls = reactive({})
function loadTex(uuid) {
	if (!uuid || uuid in texUrls) return
	texUrls[uuid] = null
	getTextureUrl(uuid).then((url) => { texUrls[uuid] = url || null }).catch(() => { texUrls[uuid] = null })
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
	const bb = deriveBuildingBlock(o.shape)
	return { kind: 'prim', label: bb ? `Prim — ${bb}` : 'Primitive', detail: null }
})
// Show the parametric prim-shape params only for prims/sculpts that carry a shape block; meshes
// get their geometry from the asset, so the path/profile knobs aren't meaningful for them.
const showPrimShape = computed(() => !!obj.value?.shape && typeInfo.value.kind !== 'mesh')

// WHY: quaternion (xyzw) → Euler degrees (XYZ) for human-readable display. Read-only (Phase 2/3
// edit would feed back through ObjectUpdate with perms).
function quatToEulerDeg(q) {
	if (!q) return [0, 0, 0]
	const [x, y, z, w] = q
	const sinr = 2 * (w * x + y * z)
	const cosr = 1 - 2 * (x * x + y * y)
	const roll  = Math.atan2(sinr, cosr)
	const sinp  = 2 * (w * y - z * x)
	const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp)
	const siny  = 2 * (w * z + x * y)
	const cosy  = 1 - 2 * (y * y + z * z)
	const yaw   = Math.atan2(siny, cosy)
	const deg   = (r) => (r * 180 / Math.PI).toFixed(1)
	return [deg(roll), deg(pitch), deg(yaw)]
}

const profileCurveLabel = computed(() => {
	const c = obj.value?.shape?.profileCurve
	if (c == null) return '—'
	const low = c & 0x0F
	const map = ['Circle', 'Square', 'IsoTri', 'EqTri', 'RightTri', 'HalfCircle']
	return `${map[low] ?? 'Unknown'} (${c})`
})

// WHY: SL permission bits — bit 13=Modify, bit 14=Copy, bit 15=Transfer, bit 19=Export.
// Display as concatenated letters like "CMT" (Copy/Modify/Transfer) per SL/Firestorm convention.
function permLetters(mask) {
	if (mask == null) return '—'
	let s = ''
	if (mask & (1 << 14)) s += 'C'
	if (mask & (1 << 13)) s += 'M'
	if (mask & (1 << 15)) s += 'T'
	if (mask & (1 << 19)) s += 'X'
	return s || '–'
}

function fmtCreationDate(unixSecStr) {
	if (!unixSecStr) return '—'
	const n = Number(unixSecStr)
	if (!Number.isFinite(n) || n <= 0) return '—'
	const d = new Date(n * 1000)
	if (Number.isNaN(d.getTime())) return '—'
	return d.toISOString().slice(0, 16).replace('T', ' ')
}

// linkCount = self + children with parentId == self.localId
const linkCount = computed(() => {
	if (!obj.value) return 0
	let count = 1
	for (const o of world.objects.values()) {
		if (o.parentId === obj.value.localId) count++
	}
	return count
})

// WHY: walk parentId → root so link controls operate on the whole linkset regardless of which
// part is currently selected. Cycle-guarded; stops at the highest known ancestor.
function rootOf(localId) {
	let id = localId
	const seen = new Set()
	while (id != null && !seen.has(id)) {
		seen.add(id)
		const pid = world.objects.get(id)?.parentId ?? 0
		if (!pid || !world.objects.has(pid)) break
		id = pid
	}
	return id
}

// Ordered linkset members: root first (link #1), then direct children by localId — best-effort
// since the sim's true link order isn't tracked. Drives prev/next cycling + link number.
const linksetMembers = computed(() => {
	if (!obj.value) return []
	const root = rootOf(obj.value.localId)
	const kids = []
	for (const o of world.objects.values()) {
		if (o.parentId === root && o.localId !== root) kids.push(o.localId)
	}
	kids.sort((a, b) => a - b)
	return [root, ...kids]
})

const canCycle      = computed(() => linksetMembers.value.length > 1)
const linkNumber    = computed(() => {
	const i = linksetMembers.value.indexOf(ui.editObjectId)
	return i >= 0 ? i + 1 : (obj.value ? 1 : '—')
})
// WHY: no real resource-cost (land impact) or parcel-capacity feed yet (Phase 3 caps). Use the
// prim count as the legacy land-impact proxy; capacity stays a placeholder until parcel data lands.
const objectsSelected   = computed(() => (obj.value ? 1 : 0))
const landImpact        = computed(() => linksetMembers.value.length || '—')
const remainingCapacity = computed(() => '—')

// Select previous/next linked part. Implies part-level editing, so force "Edit linked" on.
function selectLink(delta) {
	const m = linksetMembers.value
	if (m.length < 2) return
	ui.setEditLinked(true)
	const i = m.indexOf(ui.editObjectId)
	const ni = ((i < 0 ? 0 : i) + delta + m.length) % m.length
	ui.editObjectId = m[ni]
}

// ── Texture-tab derived data (Blinn-Phong + PBR) ──────────────────────────
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
const isMultiColor = computed(() => {
	const faces = obj.value?.faceColors ?? []
	const key = (c) => (c ? c.map((v) => Math.round(v * 255)).join(',') : 'def')
	const set = new Set(faces.filter(Boolean).map(key))
	if (obj.value?.defaultColor) set.add(key(obj.value.defaultColor))
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
		offset:  o?.defaultOffset ?? [0, 0],
		rotation: o?.defaultRotation ?? 0,
	}
})
const shinyLabel = computed(() => ['None', 'Low', 'Medium', 'High'][obj.value?.defaultShiny ?? 0] ?? 'None')

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
	// eslint-disable-next-line no-console
	console.log('[TEDUMP] ' + JSON.stringify({
		localId: o.localId, name: o.name, type: typeInfo.value.label, meshId: o.meshId,
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
		defaultShiny: o.defaultShiny, defaultFullbright: o.defaultFullbright,
		defaultPbrMaterial: o.defaultPbrMaterial, pbrMaterials: sparse(o.pbrMaterials),
	}))
})

function close() {
	ui.editObjectId = null
	ui.showObjectEdit = false
}
</script>

<template>
	<FloaterWindow
		id="object-edit"
		title="Build Tools"
		:wrap-style="{ width: '22rem', height: '38rem', resize: 'both' }"
		:default-pos="{ right: '13.375vw', bottom: '2.65rem' }"
		@close="close"
	>
		<div class="relative flex flex-col h-full text-xs">
			<!-- Build-tools toolbar (FS-parity) ──────────────────────────────────── -->
			<div class="shrink-0 px-2 py-1.5 border-b border-brd space-y-1.5">
				<!-- Top row: five major tools (icon radio) -->
				<div class="flex items-center gap-1">
					<button
						v-for="t in tools"
						:key="t.id"
						:title="t.label"
						:disabled="t.disabled"
						class="ui-btn flex-1 flex items-center justify-center px-1.5 py-1.5 rounded border transition-colors"
						:class="t.disabled
							? 'border-brd text-white/30 cursor-not-allowed bg-white/[0.02]'
							: buildTool === t.id
								? 'border-accent text-accent bg-accent/10'
								: 'border-brd text-white/70 hover:text-t1 hover:bg-white/5'"
						@click="pickTool(t)"
					>
						<component :is="t.icon" class="w-4 h-4" />
					</button>
				</div>
				<!-- Sub row: gizmo operation (Move / Rotate / Stretch), tied to modifier keys -->
				<div role="radiogroup" aria-label="Gizmo operation" class="flex items-center gap-2">
					<label
						v-for="g in gizmoOps"
						:key="g.id"
						:title="g.hint"
						class="flex flex-1 items-center justify-center gap-1 min-w-0 text-2xs text-t1 cursor-pointer select-none"
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
				</div>
			</div>
			<div class="shrink-0 px-2 py-1 flex items-center gap-2 border-b border-brd">
				<label
					class="flex items-center gap-1.5 text-2xs text-t1 cursor-pointer select-none"
					title="Off: clicking selects the whole linked object. On: selects the individual prim under the cursor."
				>
					<input type="checkbox" v-model="ui.editLinked" class="accent-accent" />
					Edit linked
				</label>
				<span class="text-2xs text-white/40 italic ml-auto truncate">Ctrl = rotate • Ctrl+Shift = scale</span>
			</div>

			<!-- Link controls (FS-parity) ─────────────────────────────────────── -->
			<div class="shrink-0 px-2 py-1.5 border-b border-brd space-y-1.5">
				<div class="flex items-center gap-1">
					<button
						title="Select previous linked part or face"
						:disabled="!canCycle"
						class="ui-btn p-1 text-2xs rounded border transition-colors"
						:class="canCycle ? 'border-brd text-white/70 hover:text-t1 hover:bg-white/5' : 'border-brd text-white/30 cursor-not-allowed bg-white/[0.02]'"
						@click="selectLink(-1)"
					><ChevronLeftIcon class="w-3 h-3" /></button>
					<button
						title="Select next linked part or face"
						:disabled="!canCycle"
						class="ui-btn p-1 text-2xs rounded border transition-colors"
						:class="canCycle ? 'border-brd text-white/70 hover:text-t1 hover:bg-white/5' : 'border-brd text-white/30 cursor-not-allowed bg-white/[0.02]'"
						@click="selectLink(1)"
					><ChevronRightIcon class="w-3 h-3" /></button>
					<button
						title="Link selected objects (Phase 3 — perms)"
						disabled
						class="ui-btn flex-1 px-2 py-1 text-2xs rounded border border-brd text-white/30 cursor-not-allowed bg-white/[0.02]"
					>Link</button>
					<button
						title="Unlink selected object (Phase 3 — perms)"
						disabled
						class="ui-btn flex-1 px-2 py-1 text-2xs rounded border border-brd text-white/30 cursor-not-allowed bg-white/[0.02]"
					>Unlink</button>
					<button
						title="World (Phase 3)"
						disabled
						class="ui-btn ml-auto px-2 py-1 text-2xs rounded border border-brd text-white/30 cursor-not-allowed bg-white/[0.02]"
					>World <ChevronDownIcon class="w-4 h-4" /></button>
				</div>
				<div class="text-2xs text-white/60 font-mono space-y-0.5">
					<div v-show="ui.editLinked">Link number: <span class="text-t1">{{ linkNumber }}</span></div>
					<div>{{ objectsSelected }} object{{ objectsSelected === 1 ? '' : 's' }} selected, land impact <span class="text-t1">{{ landImpact }}</span></div>
					<div>
						Remaining capacity <span class="me-2 text-t1">{{ remainingCapacity || '??' }}</span>
						<a href="https://docs.opensimulator.org/en/latest/features/build-tools/" target="_blank" rel="noopener noreferrer"
							title="More info (Phase 3)"
							disabled
							class="text-white/30 cursor-not-allowed"
						>More info</a>
					</div>
				</div>
			</div>

			<!-- Tab strip -->
			<nav class="tabs">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					:class="activeTab === tab.id
						? 'active'
						: ''"
					@click="activeTab = tab.id"
				>{{ tab.label }}</button>
			</nav>

			<div v-if="!obj" class="flex-1 flex items-center justify-center text-white/30 italic px-4 text-center">
				Right-click a prim → Edit to inspect properties.
			</div>

			<div v-else class="flex-1 overflow-y-auto px-3 py-2 space-y-3">
				<!-- General ─────────────────────────────────────────────── -->
				<template v-if="activeTab === 'general'">
					<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1.5 text-xs">
						<div class="text-white/50" title="63 chars, ASCII-7 + pipe.">Name:</div>
						<input :value="obj.name || '(Object)'" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1" />
						<div class="text-white/50" title="127 chars. May get used in hover tips or scripting">Description:</div>
						<input :value="obj.description || ''" readonly placeholder="—" class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1" />
						<div class="text-white/50">UUID:</div>
						<input :value="obj.fullId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
						<div class="text-white/50">Type:</div>
						<div class="text-t1">{{ typeInfo.label }}</div>
						<div class="text-white/50">Hover Text:</div>
						<div class="text-t1 whitespace-pre-wrap">{{ obj.text || '—' }}</div>
					</div>
					<div v-if="obj.creatorId" class="border-t border-brd pt-2">
						<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1.5 text-xs">
							<div class="text-white/50">Creator:</div>
							<input :value="obj.creatorId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
							<div class="text-white/50">Owner:</div>
							<input :value="obj.ownerId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
							<div class="text-white/50">Group:</div>
							<input :value="obj.groupId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
							<div class="text-white/50">Created:</div>
							<div class="text-t1 font-mono">{{ fmtCreationDate(obj.creationDate) }}</div>
							<div class="text-white/50">Sale:</div>
							<div class="text-t1">{{ obj.saleType ? `Type ${obj.saleType} — L$${obj.salePrice}` : 'Not for sale' }}</div>
						</div>
					</div>
					<div v-if="obj.baseMask != null" class="border-t border-brd pt-2">
						<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Permissions</div>
						<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1 text-xs font-mono">
							<div class="text-white/50">Base:</div>      <div class="text-t1">{{ permLetters(obj.baseMask) }}</div>
							<div class="text-white/50">Owner:</div>     <div class="text-t1">{{ permLetters(obj.ownerMask) }}</div>
							<div class="text-white/50">Group:</div>     <div class="text-t1">{{ permLetters(obj.groupMask) }}</div>
							<div class="text-white/50">Everyone:</div>  <div class="text-t1">{{ permLetters(obj.everyoneMask) }}</div>
							<div class="text-white/50">Next Owner:</div><div class="text-t1">{{ permLetters(obj.nextOwnerMask) }}</div>
						</div>
					</div>
					<div v-if="!obj.creatorId" class="border-t border-brd pt-2 text-2xs text-white/40 italic">
						Loading properties from sim…
					</div>
				</template>

				<!-- Object ──────────────────────────────────────────────── -->
				<!-- WHY: FS-parity — the Object tab carries identity, transform AND the parametric
					prim-shape params + the building-block / mesh / sculpt type. The type row is how
					you tell a mesh from a sculpt from a plain prim. -->
				<template v-else-if="activeTab === 'object'">
					<!-- Identity / linkset -->
					<div class="grid grid-cols-[5.5rem,1fr] gap-x-2 gap-y-1.5 text-xs">
						<div class="text-white/50">Building Block</div>
						<div class="text-t1">{{ typeInfo.label }}</div>
						<template v-if="typeInfo.detail">
							<div class="text-white/50">{{ typeInfo.kind === 'mesh' ? 'Mesh asset' : 'Sculpt map' }}</div>
							<div class="flex items-center gap-1.5 min-w-0">
								<button
									class="w-9 h-9 shrink-0 bg-white/5 border border-brd rounded flex items-center justify-center text-white/30 text-2xs overflow-hidden hover:border-accent"
									:title="typeInfo.kind === 'mesh' ? 'Mesh asset (no image preview)' : 'Preview sculpt map'"
									@click="typeInfo.kind === 'sculpt' ? openPreview(typeInfo.detail) : copyText(typeInfo.detail)"
								>
									<span>{{ typeInfo.kind === 'mesh' ? '◰' : '⛰' }}</span>
								</button>
								<input :value="typeInfo.detail" readonly class="flex-1 min-w-0 bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
							</div>
						</template>
						<div class="text-white/50">LocalID</div>
						<div class="text-t1 font-mono">{{ obj.localId }}</div>
						<div class="text-white/50">Parent ID</div>
						<div class="text-t1 font-mono">{{ obj.parentId ?? 0 }}{{ obj.parentId ? '' : ' (root)' }}</div>
						<div class="text-white/50">Link Count</div>
						<div class="text-t1">{{ linkCount }}</div>
					</div>

					<!-- Transform -->
					<div class="border-t border-brd pt-2">
						<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Position (meters)</div>
						<div class="grid grid-cols-3 gap-1 text-xs">
							<div><span class="text-red-500 font-bold">X</span> <span class="text-t1 font-mono">{{ obj.pos?.[0]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-green-500 font-bold">Y</span> <span class="text-t1 font-mono">{{ obj.pos?.[1]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-blue-500 font-bold">Z</span> <span class="text-t1 font-mono">{{ obj.pos?.[2]?.toFixed(3) ?? '—' }}</span></div>
						</div>
					</div>
					<div>
						<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Size (meters)</div>
						<div class="grid grid-cols-3 gap-1 text-xs">
							<div><span class="text-white/40">X</span> <span class="text-t1 font-mono">{{ obj.scale?.[0]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-white/40">Y</span> <span class="text-t1 font-mono">{{ obj.scale?.[1]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-white/40">Z</span> <span class="text-t1 font-mono">{{ obj.scale?.[2]?.toFixed(3) ?? '—' }}</span></div>
						</div>
					</div>
					<div>
						<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Rotation (degrees)</div>
						<div class="grid grid-cols-3 gap-1 text-xs">
							<div><span class="text-white/40">X</span> <span class="text-t1 font-mono">{{ quatToEulerDeg(obj.rot)[0] }}</span></div>
							<div><span class="text-white/40">Y</span> <span class="text-t1 font-mono">{{ quatToEulerDeg(obj.rot)[1] }}</span></div>
							<div><span class="text-white/40">Z</span> <span class="text-t1 font-mono">{{ quatToEulerDeg(obj.rot)[2] }}</span></div>
						</div>
					</div>

					<!-- Parametric prim shape (FS: lives on the Object tab) -->
					<div v-if="showPrimShape" class="border-t border-brd pt-2 space-y-2">
						<div class="text-white/50 text-2xs uppercase tracking-wide">Prim Shape</div>
						<div class="grid grid-cols-[7rem,1fr] gap-x-2 gap-y-1.5 text-xs">
							<div class="text-white/50">Profile</div>
							<div class="text-t1">{{ profileCurveLabel }}</div>
							<div class="text-white/50">Path Cut (B/E)</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathBegin }} / {{ obj.shape.pathEnd }}</div>
							<div class="text-white/50">Profile Cut (B/E)</div>
							<div class="text-t1 font-mono">{{ obj.shape.profileBegin }} / {{ obj.shape.profileEnd }}</div>
							<div class="text-white/50">Hollow</div>
							<div class="text-t1 font-mono">{{ obj.shape.profileHollow }}</div>
							<div class="text-white/50">Twist (B/E)</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathTwistBegin }} / {{ obj.shape.pathTwist }}</div>
							<div class="text-white/50">Taper X/Y</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathTaperX }} / {{ obj.shape.pathTaperY }}</div>
							<div class="text-white/50">Top Shear X/Y</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathShearX }} / {{ obj.shape.pathShearY }}</div>
							<div class="text-white/50">Hole Size X/Y</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathScaleX }} / {{ obj.shape.pathScaleY }}</div>
							<div class="text-white/50">Revolutions</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathRevolutions }}</div>
							<div class="text-white/50">Radius Offset</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathRadiusOffset }}</div>
							<div class="text-white/50">Skew</div>
							<div class="text-t1 font-mono">{{ obj.shape.pathSkew }}</div>
						</div>
					</div>
					<div v-else-if="typeInfo.kind === 'mesh'" class="border-t border-brd pt-2 text-2xs text-white/40 italic">
						Geometry comes from the mesh asset above. LOD triangle counts arrive with the
						mesh-info decode (Phase 3).
					</div>
				</template>

				<!-- Features ────────────────────────────────────────────── -->
				<!-- WHY: FS-parity LLPanelVolume layout — Flexible Path, Light, Reflection Probe and
					Physics. None of these are carried in the ObjectUpdate we decode today, so each
					section shows its FS structure with a "not decoded" note instead of the misplaced
					prim-shape params that used to live here (those now sit on the Object tab). -->
				<template v-else-if="activeTab === 'features'">
					<div class="grid grid-cols-[8rem,1fr] gap-x-2 gap-y-1.5 text-xs">
						<div class="text-white/50">Flexible Path</div>
						<div class="text-white/40 italic">not decoded</div>
						<div class="text-white/50">Light</div>
						<div class="text-white/40 italic">not decoded</div>
						<div class="text-white/50">Reflection Probe</div>
						<div class="text-white/40 italic">not decoded</div>
						<div class="text-white/50">Physics Shape</div>
						<div class="text-white/40 italic">not decoded</div>
						<div class="text-white/50">Material (physics)</div>
						<div class="text-white/40 italic">not decoded</div>
					</div>
					<div class="text-2xs text-white/30 italic pt-1">
						Flexi / light / physics flags aren't carried in the object update we decode yet —
						they arrive with the Phase 3 ExtraParams + physics-flags work.
					</div>
				</template>

				<!-- Texture ─────────────────────────────────────────────── -->
				<!-- WHY: FS matmedia split — Blinn-Phong (legacy diffuse/normal/specular) vs PBR
					(GLTF metallic-roughness) sub-tabs. "Multiple" surfaces when faces differ; every
					texture chip opens a larger preview ("texture picker"). Read-only (Phase 3 edit). -->
				<template v-else-if="activeTab === 'texture'">
					<!-- Sub-tab strip -->
					<nav class="tabs -mt-1 whitespace-nowrap">
						<button :class="texSubTab === 'pbr' ? 'active' : ''" @click="texSubTab = 'pbr'">PBR</button>
						<button :class="texSubTab === 'bp' ? 'active' : ''" @click="texSubTab = 'bp'">Blinn-Phong</button>
						<button :class="texSubTab === 'mdia' ? 'active' : ''" @click="texSubTab = 'mdia'">Media</button>
					</nav>

					<!-- Blinn-Phong (legacy) ─────────────────────────────── -->
					<template v-if="texSubTab === 'bp'">
						<div class="grid grid-cols-[6rem,1fr] gap-x-2 gap-y-2 text-xs">
							<div class="text-white/50 self-center">Texture</div>
							<div class="flex items-center gap-2 min-w-0">
								<button
									class="w-16 h-16 shrink-0 bg-white/5 border border-brd rounded flex items-center justify-center text-white/30 text-2xs overflow-hidden hover:border-accent"
									:title="obj.defaultTexture ? 'Click for larger preview' : 'No texture'"
									@click="openPreview(obj.defaultTexture)"
								>
									<img v-if="texUrls[obj.defaultTexture]" :src="texUrls[obj.defaultTexture]" class="w-full h-full object-cover" alt="texture" />
									<span v-else>{{ obj.defaultTexture ? '…' : 'No tex' }}</span>
								</button>
								<div class="flex-1 min-w-0">
									<div v-if="isMultiTexture" class="text-accent font-semibold mb-0.5">Multiple ({{ distinctTextures.length }})</div>
									<input
										:value="obj.defaultTexture || '(none)'"
										readonly
										class="w-full bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs"
									/>
								</div>
							</div>
							<div class="text-white/50 self-center">Color</div>
							<div class="flex items-center gap-2">
								<div
									class="w-6 h-6 rounded border border-brd"
									:style="obj.defaultColor
										? { background: `rgba(${Math.round(obj.defaultColor[0]*255)},${Math.round(obj.defaultColor[1]*255)},${Math.round(obj.defaultColor[2]*255)},${obj.defaultColor[3].toFixed(2)})` }
										: { background: 'rgba(255,255,255,0.05)' }"
								></div>
								<span v-if="isMultiColor" class="text-accent font-semibold">Multiple</span>
								<input
									v-else
									:value="obj.defaultColor ? obj.defaultColor.slice(0,3).map(v => Math.round(v*255)).join(', ') : '255, 255, 255'"
									readonly
									class="flex-1 bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono"
								/>
							</div>
							<div class="text-white/50 self-center">Trans %</div>
							<input
								:value="obj.defaultColor ? Math.round((1 - obj.defaultColor[3]) * 100) : 0"
								readonly
								class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono"
							/>
							<div class="text-white/50 self-center">Glow</div>
							<input :value="(obj.defaultGlow ?? 0).toFixed(2)" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
							<div class="text-white/50 self-center">Full bright</div>
							<div class="text-t1">{{ obj.defaultFullbright ? 'Yes' : 'No' }}</div>
							<div class="text-white/50 self-center">Shininess</div>
							<div class="text-t1">{{ shinyLabel }}</div>
						</div>

						<!-- Per-face diffuse chips (only faces overriding the default) -->
						<div v-if="faceTexChips.length" class="border-t border-brd pt-2">
							<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Per-face textures</div>
							<div class="flex flex-wrap gap-1.5">
								<button
									v-for="c in faceTexChips"
									:key="c.face"
									class="relative w-10 h-10 bg-white/5 border border-brd rounded overflow-hidden hover:border-accent"
									:title="`Face ${c.face} — click for preview`"
									@click="openPreview(c.uuid)"
								>
									<img v-if="texUrls[c.uuid]" :src="texUrls[c.uuid]" class="w-full h-full object-cover" alt="" />
									<span v-else class="absolute inset-0 flex items-center justify-center text-white/30 text-2xs">…</span>
									<span class="absolute bottom-0 right-0 px-0.5 bg-black/60 text-[0.5rem] text-white/80 rounded-tl">{{ c.face }}</span>
								</button>
							</div>
						</div>

						<!-- Per-face mapping overrides (Scale / Offset / Rotation / Mapping, planar-aware) -->
						<div v-if="faceUvRows.length" class="border-t border-brd pt-2">
							<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Per-face mapping</div>
							<div class="space-y-1">
								<div v-for="r in faceUvRows" :key="r.face" class="grid grid-cols-[2rem,1fr] gap-x-2 items-baseline text-2xs">
									<span class="text-white/50">F{{ r.face }}</span>
									<div class="font-mono text-t1">
										<span v-if="r.mapping !== 'Default'" class="text-accent">{{ r.mapping }}</span>
										Scale {{ r.repeats[0].toFixed(5) }}×{{ r.repeats[1].toFixed(5) }}
										· Off {{ r.offset[0].toFixed(5) }},{{ r.offset[1].toFixed(5) }}
										· Rot {{ (r.rotation * 180 / Math.PI).toFixed(5) }}°
									</div>
								</div>
							</div>
						</div>

						<!-- Mapping (default face) — FS-style: Mapping mode + Scale H/V + Offset H/V + Rotation -->
						<div class="border-t border-brd pt-2">
							<div class="grid grid-cols-[6rem,1fr] gap-x-2 gap-y-1.5 text-xs">
								<div class="text-white/50 self-center">Mapping</div>
								<div class="text-t1">{{ defaultMapping.mapping }}</div>
								<div class="text-white/50 self-center">Scale H / V</div>
								<div class="grid grid-cols-2 gap-1">
									<input :value="defaultMapping.repeats[0].toFixed(5)" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
									<input :value="defaultMapping.repeats[1].toFixed(5)" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
								</div>
								<div class="text-white/50 self-center">Offset H / V</div>
								<div class="grid grid-cols-2 gap-1">
									<input :value="defaultMapping.offset[0].toFixed(5)" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
									<input :value="defaultMapping.offset[1].toFixed(5)" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
								</div>
								<div class="text-white/50 self-center">Rotation°</div>
								<input :value="(defaultMapping.rotation * 180 / Math.PI).toFixed(5)" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
							</div>
						</div>
						<div v-if="obj.defaultMaterialId" class="border-t border-brd pt-2">
							<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Legacy material (normal/specular)</div>
							<input :value="obj.defaultMaterialId" readonly class="w-full bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
						</div>
					</template>

					<!-- PBR (GLTF metallic-roughness) ────────────────────── -->
					<template v-if="texSubTab === 'pbr'">
						<div v-if="!hasPbr" class="text-white/40 italic px-1 py-3 text-center">
							No PBR material on this object — it uses Blinn-Phong (legacy) textures.
						</div>
						<template v-else>
							<div class="grid grid-cols-[6rem,1fr] gap-x-2 gap-y-2 text-xs">
								<div class="text-white/50 self-center">Material</div>
								<div class="flex-1 min-w-0">
									<div v-if="isMultiPbr" class="text-accent font-semibold mb-0.5">Multiple ({{ distinctPbr.length }})</div>
									<div class="flex items-center gap-1.5">
										<input
											:value="obj.defaultPbrMaterial || distinctPbr[0] || '(none)'"
											readonly
											class="flex-1 min-w-0 bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs"
										/>
										<button class="ui-btn p-1 rounded border border-brd text-white/60 hover:text-t1 hover:bg-white/5" title="Copy material UUID" @click="copyText(obj.defaultPbrMaterial || distinctPbr[0])"><CopyIcon class="w-3 h-3" /></button>
									</div>
								</div>
							</div>
							<div v-if="pbrFaceChips.length" class="border-t border-brd pt-2">
								<div class="text-white/50 text-2xs uppercase tracking-wide mb-1">Per-face PBR materials</div>
								<div class="space-y-1">
									<div v-for="c in pbrFaceChips" :key="c.face" class="flex items-center gap-1.5 text-2xs">
										<span class="w-8 shrink-0 text-white/50">F{{ c.face }}</span>
										<input :value="c.uuid" readonly class="flex-1 min-w-0 bg-white/5 border border-brd rounded px-1 py-0.5 text-t1 font-mono" />
									</div>
								</div>
							</div>
							<div class="text-2xs text-white/30 italic pt-1">
								GLTF material assets (base color / metallic-roughness / emissive / normal maps)
								render via the materials cap. Per-channel editing arrives in Phase 3.
							</div>
						</template>
					</template>

					<template v-else>
						<div class="text-white/40 italic px-1 py-3 text-center">
							Media to-do
						</div>
					</template>

				</template>

				<!-- Content ─────────────────────────────────────────────── -->
				<!-- WHY: FS-parity layout. Phase 2: empty inventory placeholder + disabled
					New Script button. Inventory list arrives with HTTP-cap fetch in Phase 3. -->
				<template v-else-if="activeTab === 'content'">
					<div class="flex items-center gap-1 pb-1">
						<button class="px-2 py-1 text-2xs border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>New Script</button>
						<button class="px-2 py-1 text-2xs border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>Open</button>
						<button class="px-2 py-1 text-2xs border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>Edit</button>
						<div class="ml-auto text-2xs text-white/40">0 items</div>
					</div>
					<div class="border border-brd rounded bg-white/[0.02] min-h-[10rem] flex items-center justify-center text-white/30 italic text-xs px-4 text-center">
						Inventory contents will appear here (Phase 3).
					</div>
					<div class="text-2xs text-white/30 italic pt-1">
						Object inventory uses HTTP capabilities — wired with Phase 3 cap layer.
					</div>
				</template>
			</div>

			<!-- Texture preview ("texture picker") overlay ─────────────────────── -->
			<div
				v-if="previewUuid"
				class="absolute inset-0 z-10 flex flex-col bg-card/95 backdrop-blur-sm"
				@click.self="closePreview"
			>
				<div class="flex items-center gap-2 px-3 py-2 border-b border-brd shrink-0">
					<span class="text-xs text-t1 font-semibold">Texture Preview</span>
					<button class="ml-auto ui-btn p-1 rounded border border-brd text-white/60 hover:text-t1 hover:bg-white/5" title="Close" @click="closePreview"><XIcon class="w-3.5 h-3.5" /></button>
				</div>
				<div class="flex-1 min-h-0 flex items-center justify-center p-3">
					<img
						v-if="texUrls[previewUuid]"
						:src="texUrls[previewUuid]"
						class="max-w-full max-h-full object-contain border border-brd rounded"
						:style="{ background: 'repeating-conic-gradient(#0003 0 25%, transparent 0 50%) 0 0 / 1rem 1rem' }"
						alt="texture preview"
					/>
					<div v-else class="text-white/40 italic text-xs">Loading texture…</div>
				</div>
				<div class="flex items-center gap-1.5 px-3 py-2 border-t border-brd shrink-0">
					<input :value="previewUuid" readonly class="flex-1 min-w-0 bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-2xs" />
					<button class="ui-btn p-1.5 rounded border border-brd text-white/60 hover:text-t1 hover:bg-white/5" title="Copy UUID" @click="copyText(previewUuid)"><CopyIcon class="w-3.5 h-3.5" /></button>
				</div>
			</div>
		</div>
	</FloaterWindow>
</template>
