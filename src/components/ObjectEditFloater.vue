<script setup>
import { ref, computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'

const ui    = useUiStore()
const world = useWorldStore()

const activeTab = ref('general')

// WHY: FS-parity Build Tools toolbar — Focus/Move/Edit/Create/Land top-row buttons.
// Phase 2: visual only. Edit corresponds to the prim-handle preview already wired through
// uiStore.gizmoMode; clicking Move/Edit/Rotate (Ctrl)/Scale (Ctrl+Shift) lets the user
// preview the gizmo type without holding modifiers. Focus/Create/Land are Phase 3 stubs.
const buildTools = [
	{ id: 'focus',  label: 'Focus',  hint: 'Camera focus (Phase 3)', mode: null,     disabled: true  },
	{ id: 'move',   label: 'Move',   hint: 'Position handles',        mode: 'move',   disabled: false },
	{ id: 'edit',   label: 'Edit',   hint: 'Edit linked',             mode: 'move',   disabled: false },
	{ id: 'rotate', label: 'Rotate', hint: 'Rotation rings (Ctrl)',  mode: 'rotate', disabled: false },
	{ id: 'scale',  label: 'Scale',  hint: 'Scale handles (Ctrl+Shift)', mode: 'scale', disabled: false },
	{ id: 'create', label: 'Create', hint: 'Create prim (Phase 3)',  mode: null,     disabled: true  },
	{ id: 'land',   label: 'Land',   hint: 'Edit land (Phase 3)',    mode: null,     disabled: true  },
]
function pickTool(t) {
	if (t.disabled || !t.mode) return
	ui.setGizmoMode(t.mode)
}
const obj       = computed(() => ui.editObjectId ? world.objects.get(ui.editObjectId) : null)

const tabs = [
	{ id: 'general',  label: 'General' },
	{ id: 'object',   label: 'Object' },
	{ id: 'features', label: 'Features' },
	{ id: 'texture',  label: 'Texture' },
	{ id: 'content',  label: 'Content' },
]

// WHY: quaternion (xyzw) → Euler degrees (XYZ) for human-readable display. Phase 2 read-only;
// editing rotation would feed back through ObjectUpdate (Phase 3 perms work).
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

const pcodeLabel = computed(() => {
	const pc = obj.value?.pcode
	if (pc === 47) return 'Avatar (47)'
	if (pc === 9)  return 'Primitive (9)'
	if (pc === 25) return 'Tree (25)'
	if (pc === 29) return 'Grass (29)'
	return pc != null ? `pcode ${pc}` : '—'
})

const pathCurveLabel = computed(() => {
	const c = obj.value?.shape?.pathCurve
	if (c === 16) return 'Line (16)'
	if (c === 32) return 'Circle (32)'
	if (c === 33) return 'Circle2 (33)'
	return c != null ? String(c) : '—'
})

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
		<div class="flex flex-col h-full text-xs">
			<!-- Build-tools toolbar (FS-parity placeholder) ─────────────────────── -->
			<div class="shrink-0 px-2 py-1.5 border-b border-brd flex items-center gap-1">
				<button
					v-for="t in buildTools"
					:key="t.id"
					:title="t.hint"
					:disabled="t.disabled"
					class="ui-btn flex-1 min-w-0 px-1.5 py-1 text-[0.65rem] rounded border transition-colors truncate"
					:class="t.disabled
						? 'border-brd text-white/30 cursor-not-allowed bg-white/[0.02]'
						: ui.gizmoMode === t.mode && t.id !== 'edit'
							? 'border-accent text-accent bg-accent/10'
							: 'border-brd text-white/70 hover:text-t1 hover:bg-white/5'"
					@click="pickTool(t)"
				>{{ t.label }}</button>
			</div>
			<div class="shrink-0 px-2 py-1 text-[0.6rem] text-white/40 italic border-b border-brd">
				Click a prim to select • Ctrl = rotate • Ctrl+Shift = scale
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
					<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
						<div class="text-white/50" title="63 chars, ASCII-7 + pipe.">Name:</div>
						<input :value="obj.name || '(Object)'" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1" />
						<div class="text-white/50" title="127 chars. May get used in hover tips or scripting">Description:</div>
						<input :value="obj.description || ''" readonly placeholder="—" class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1" />
						<div class="text-white/50">UUID:</div>
						<input :value="obj.fullId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
						<div class="text-white/50">Type:</div>
						<div class="text-t1">{{ pcodeLabel }}</div>
						<div class="text-white/50">Hover Text:</div>
						<div class="text-t1 whitespace-pre-wrap">{{ obj.text || '—' }}</div>
					</div>
					<div v-if="obj.creatorId" class="border-t border-brd pt-2">
						<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
							<div class="text-white/50">Creator:</div>
							<input :value="obj.creatorId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
							<div class="text-white/50">Owner:</div>
							<input :value="obj.ownerId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
							<div class="text-white/50">Group:</div>
							<input :value="obj.groupId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
							<div class="text-white/50">Created:</div>
							<div class="text-t1 font-mono">{{ fmtCreationDate(obj.creationDate) }}</div>
							<div class="text-white/50">Sale:</div>
							<div class="text-t1">{{ obj.saleType ? `Type ${obj.saleType} — L$${obj.salePrice}` : 'Not for sale' }}</div>
						</div>
					</div>
					<div v-if="obj.baseMask != null" class="border-t border-brd pt-2">
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Permissions</div>
						<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1 text-[0.7rem] font-mono">
							<div class="text-white/50">Base:</div>      <div class="text-t1">{{ permLetters(obj.baseMask) }}</div>
							<div class="text-white/50">Owner:</div>     <div class="text-t1">{{ permLetters(obj.ownerMask) }}</div>
							<div class="text-white/50">Group:</div>     <div class="text-t1">{{ permLetters(obj.groupMask) }}</div>
							<div class="text-white/50">Everyone:</div>  <div class="text-t1">{{ permLetters(obj.everyoneMask) }}</div>
							<div class="text-white/50">Next Owner:</div><div class="text-t1">{{ permLetters(obj.nextOwnerMask) }}</div>
						</div>
					</div>
					<div v-if="!obj.creatorId" class="border-t border-brd pt-2 text-[0.65rem] text-white/40 italic">
						Loading properties from sim…
					</div>
				</template>

				<!-- Object ──────────────────────────────────────────────── -->
				<template v-else-if="activeTab === 'object'">
					<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
						<div class="text-white/50">LocalID</div>
						<div class="text-t1 font-mono">{{ obj.localId }}</div>
						<div class="text-white/50">Parent ID</div>
						<div class="text-t1 font-mono">{{ obj.parentId ?? 0 }}{{ obj.parentId ? '' : ' (root)' }}</div>
						<div class="text-white/50">Link Count</div>
						<div class="text-t1">{{ linkCount }}</div>
					</div>
					<div class="border-t border-brd pt-2">
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Position (SL)</div>
						<div class="grid grid-cols-3 gap-1 text-[0.7rem]">
							<div><span class="text-white/40">X</span> <span class="text-t1 font-mono">{{ obj.pos?.[0]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-white/40">Y</span> <span class="text-t1 font-mono">{{ obj.pos?.[1]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-white/40">Z</span> <span class="text-t1 font-mono">{{ obj.pos?.[2]?.toFixed(3) ?? '—' }}</span></div>
						</div>
					</div>
					<div>
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Size (m)</div>
						<div class="grid grid-cols-3 gap-1 text-[0.7rem]">
							<div><span class="text-white/40">X</span> <span class="text-t1 font-mono">{{ obj.scale?.[0]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-white/40">Y</span> <span class="text-t1 font-mono">{{ obj.scale?.[1]?.toFixed(3) ?? '—' }}</span></div>
							<div><span class="text-white/40">Z</span> <span class="text-t1 font-mono">{{ obj.scale?.[2]?.toFixed(3) ?? '—' }}</span></div>
						</div>
					</div>
					<div>
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Rotation (deg)</div>
						<div class="grid grid-cols-3 gap-1 text-[0.7rem]">
							<div><span class="text-white/40">R</span> <span class="text-t1 font-mono">{{ quatToEulerDeg(obj.rot)[0] }}</span></div>
							<div><span class="text-white/40">P</span> <span class="text-t1 font-mono">{{ quatToEulerDeg(obj.rot)[1] }}</span></div>
							<div><span class="text-white/40">Y</span> <span class="text-t1 font-mono">{{ quatToEulerDeg(obj.rot)[2] }}</span></div>
						</div>
					</div>
				</template>

				<!-- Features ────────────────────────────────────────────── -->
				<template v-else-if="activeTab === 'features'">
					<div v-if="!obj.shape" class="text-white/40 italic">No shape data (avatar or undecoded).</div>
					<div v-else class="grid grid-cols-[7rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
						<div class="text-white/50">Path Curve</div>
						<div class="text-t1">{{ pathCurveLabel }}</div>
						<div class="text-white/50">Profile Curve</div>
						<div class="text-t1">{{ profileCurveLabel }}</div>
						<div class="text-white/50">Path Begin/End</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathBegin }} / {{ obj.shape.pathEnd }}</div>
						<div class="text-white/50">Profile Begin/End</div>
						<div class="text-t1 font-mono">{{ obj.shape.profileBegin }} / {{ obj.shape.profileEnd }}</div>
						<div class="text-white/50">Profile Hollow</div>
						<div class="text-t1 font-mono">{{ obj.shape.profileHollow }}</div>
						<div class="text-white/50">Twist Start/End</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathTwistBegin }} / {{ obj.shape.pathTwist }}</div>
						<div class="text-white/50">Taper X/Y</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathTaperX }} / {{ obj.shape.pathTaperY }}</div>
						<div class="text-white/50">Shear X/Y</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathShearX }} / {{ obj.shape.pathShearY }}</div>
						<div class="text-white/50">Scale X/Y</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathScaleX }} / {{ obj.shape.pathScaleY }}</div>
						<div class="text-white/50">Revolutions</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathRevolutions }}</div>
						<div class="text-white/50">Skew</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathSkew }}</div>
						<div class="text-white/50">Radius Offset</div>
						<div class="text-t1 font-mono">{{ obj.shape.pathRadiusOffset }}</div>
					</div>
					<div v-if="obj.defaultColor" class="border-t border-brd pt-2">
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">TE Default Color</div>
						<div class="flex items-center gap-2 text-[0.7rem]">
							<div
								class="w-6 h-6 rounded border border-brd"
								:style="{ background: `rgba(${Math.round(obj.defaultColor[0]*255)},${Math.round(obj.defaultColor[1]*255)},${Math.round(obj.defaultColor[2]*255)},${obj.defaultColor[3].toFixed(2)})` }"
							></div>
							<div class="font-mono text-white/70">
								{{ obj.defaultColor.map(v => v.toFixed(2)).join(', ') }}
							</div>
						</div>
					</div>
				</template>

				<!-- Texture ─────────────────────────────────────────────── -->
				<!-- WHY: FS-parity layout (read-only Phase 2). Slots correspond to libomv
					TextureEntry fields — texture UUID, RGBA color, RepeatU/V, OffsetU/V,
					Rotation, Glow, Bumpiness, Shininess. Wired through in Phase 3 when
					J2C decode + perms land. -->
				<template v-else-if="activeTab === 'texture'">
					<div class="grid grid-cols-[6rem,1fr] gap-x-2 gap-y-2 text-[0.7rem]">
						<div class="text-white/50 self-center">Texture</div>
						<div class="flex items-center gap-2">
							<div class="w-12 h-12 bg-white/5 border border-brd rounded flex items-center justify-center text-white/30 text-[0.6rem]">No tex</div>
							<button class="flex-1 px-2 py-1 border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>Pick…</button>
						</div>
						<div class="text-white/50 self-center">Color</div>
						<div class="flex items-center gap-2">
							<div
								class="w-6 h-6 rounded border border-brd"
								:style="obj.defaultColor
									? { background: `rgba(${Math.round(obj.defaultColor[0]*255)},${Math.round(obj.defaultColor[1]*255)},${Math.round(obj.defaultColor[2]*255)},${obj.defaultColor[3].toFixed(2)})` }
									: { background: 'rgba(255,255,255,0.05)' }"
							></div>
							<input
								:value="obj.defaultColor ? obj.defaultColor.slice(0,3).map(v => Math.round(v*255)).join(', ') : '255, 255, 255'"
								readonly
								class="flex-1 bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono"
							/>
						</div>
						<div class="text-white/50 self-center">Transparency %</div>
						<input
							:value="obj.defaultColor ? Math.round((1 - obj.defaultColor[3]) * 100) : 0"
							readonly
							class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono"
						/>
						<div class="text-white/50 self-center">Glow</div>
						<input value="0.00" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
					</div>
					<div class="border-t border-brd pt-2">
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Mapping</div>
						<div class="grid grid-cols-[6rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
							<div class="text-white/50 self-center">Mapping</div>
							<select disabled class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-white/40 cursor-not-allowed">
								<option>Default</option><option>Planar</option>
							</select>
							<div class="text-white/50 self-center">Repeats / face</div>
							<div class="grid grid-cols-2 gap-1">
								<input value="1.00" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
								<input value="1.00" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
							</div>
							<div class="text-white/50 self-center">Offset</div>
							<div class="grid grid-cols-2 gap-1">
								<input value="0.00" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
								<input value="0.00" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
							</div>
							<div class="text-white/50 self-center">Rotation°</div>
							<input value="0.0" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono" />
						</div>
					</div>
					<div class="border-t border-brd pt-2">
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Material</div>
						<div class="grid grid-cols-[6rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
							<div class="text-white/50 self-center">Bumpiness</div>
							<select disabled class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-white/40 cursor-not-allowed">
								<option>None</option>
							</select>
							<div class="text-white/50 self-center">Shininess</div>
							<select disabled class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-white/40 cursor-not-allowed">
								<option>None</option>
							</select>
						</div>
					</div>
					<div class="text-[0.6rem] text-white/30 italic pt-1">
						J2C texture decode + edit (Phase 3, HTTP caps).
					</div>
				</template>

				<!-- Content ─────────────────────────────────────────────── -->
				<!-- WHY: FS-parity layout. Phase 2: empty inventory placeholder + disabled
					New Script button. Inventory list arrives with HTTP-cap fetch in Phase 3. -->
				<template v-else-if="activeTab === 'content'">
					<div class="flex items-center gap-1 pb-1">
						<button class="px-2 py-1 text-[0.65rem] border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>New Script</button>
						<button class="px-2 py-1 text-[0.65rem] border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>Open</button>
						<button class="px-2 py-1 text-[0.65rem] border border-brd rounded text-white/40 cursor-not-allowed bg-white/[0.02]" disabled>Edit</button>
						<div class="ml-auto text-[0.6rem] text-white/40">0 items</div>
					</div>
					<div class="border border-brd rounded bg-white/[0.02] min-h-[10rem] flex items-center justify-center text-white/30 italic text-[0.7rem] px-4 text-center">
						Inventory contents will appear here (Phase 3).
					</div>
					<div class="text-[0.6rem] text-white/30 italic pt-1">
						Object inventory uses HTTP capabilities — wired with Phase 3 cap layer.
					</div>
				</template>
			</div>
		</div>
	</FloaterWindow>
</template>
