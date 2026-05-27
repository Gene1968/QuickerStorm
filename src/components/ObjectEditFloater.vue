<script setup>
import { ref, computed } from 'vue'
import FloaterWindow from '@/components/FloaterWindow.vue'
import { useUiStore } from '@/stores/uiStore'
import { useWorldStore } from '@/stores/worldStore'

const ui    = useUiStore()
const world = useWorldStore()

const activeTab = ref('general')
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
			<!-- Tab strip -->
			<nav class="flex shrink-0 border-b border-brd">
				<button
					v-for="tab in tabs"
					:key="tab.id"
					class="flex-1 py-1.5 text-xs transition-colors border-b-2"
					:class="activeTab === tab.id
						? 'text-accent border-accent'
						: 'text-white/50 hover:text-white/70 border-transparent'"
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
						<div class="text-white/50">Name</div>
						<input :value="obj.name || '(Object)'" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1" />
						<div class="text-white/50">Description</div>
						<input :value="obj.description || ''" readonly placeholder="—" class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1" />
						<div class="text-white/50">UUID</div>
						<input :value="obj.fullId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
						<div class="text-white/50">Type</div>
						<div class="text-t1">{{ pcodeLabel }}</div>
						<div class="text-white/50">Hover Text</div>
						<div class="text-t1 whitespace-pre-wrap">{{ obj.text || '—' }}</div>
					</div>
					<div v-if="obj.creatorId" class="border-t border-brd pt-2">
						<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1.5 text-[0.7rem]">
							<div class="text-white/50">Creator</div>
							<input :value="obj.creatorId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
							<div class="text-white/50">Owner</div>
							<input :value="obj.ownerId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
							<div class="text-white/50">Group</div>
							<input :value="obj.groupId" readonly class="bg-white/5 border border-brd rounded px-1.5 py-0.5 text-t1 font-mono text-[0.6rem]" />
							<div class="text-white/50">Created</div>
							<div class="text-t1 font-mono">{{ fmtCreationDate(obj.creationDate) }}</div>
							<div class="text-white/50">Sale</div>
							<div class="text-t1">{{ obj.saleType ? `Type ${obj.saleType} — L$${obj.salePrice}` : 'Not for sale' }}</div>
						</div>
					</div>
					<div v-if="obj.baseMask != null" class="border-t border-brd pt-2">
						<div class="text-white/50 text-[0.65rem] uppercase tracking-wide mb-1">Permissions</div>
						<div class="grid grid-cols-[5rem,1fr] gap-x-2 gap-y-1 text-[0.7rem] font-mono">
							<div class="text-white/50">Base</div>      <div class="text-t1">{{ permLetters(obj.baseMask) }}</div>
							<div class="text-white/50">Owner</div>     <div class="text-t1">{{ permLetters(obj.ownerMask) }}</div>
							<div class="text-white/50">Group</div>     <div class="text-t1">{{ permLetters(obj.groupMask) }}</div>
							<div class="text-white/50">Everyone</div>  <div class="text-t1">{{ permLetters(obj.everyoneMask) }}</div>
							<div class="text-white/50">Next Owner</div><div class="text-t1">{{ permLetters(obj.nextOwnerMask) }}</div>
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
			</div>
		</div>
	</FloaterWindow>
</template>
