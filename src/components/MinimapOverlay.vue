<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useWorldStore }   from '@/stores/worldStore'
import { useUiStore }      from '@/stores/uiStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useTeleport }     from '@/composables/useTeleport'
import { useAudio } from '@/composables/useAudio.js'

const world   = useWorldStore()
const ui      = useUiStore()
const session = useSessionStore()
const { requestTeleport } = useTeleport()
const { playSound } = useAudio()

onMounted(()   => playSound('pop.mp3', 0.7))
onUnmounted(() => playSound('pop.mp3', 0.7))

const SIZE   = 128            // viewBox coordinate space
const CENTER = SIZE / 2       // self sits at centre — minimap is self-centred, north-up
const R_COMP = SIZE / 2 - 7   // compass label orbit radius (just inside edge)

// ── Zoom (metres shown across the minimap) ─────────────────────────────────
// Wheel scrolls the zoom. Smaller = closer. Default = one region across.
const metersAcross = ref(256)
const MIN_M = 48, MAX_M = 1024
function onWheel(e) {
	e.preventDefault()
	const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2
	metersAcross.value = Math.max(MIN_M, Math.min(MAX_M, metersAcross.value * factor))
}
// px (viewBox units) per SL metre
const pxPerM = computed(() => SIZE / metersAcross.value)

// Self SL position (authoritative own-avatar ref, always current — unlike the avatar
// object's pos, which is stale because own movement is dead-reckoned separately).
const selfPos = computed(() => world.avatarPos ?? { x: 128, y: 128, z: 25 })

// ── Heading-up rotation ──────────────────────────────────────────────────────
// The minimap rotates so the avatar's facing direction is always "up". We compute a
// screen-space rotation Δ that maps the facing vector onto straight-up (0,−1), then
// apply it to every plotted point. SL facing = π/2 + cameraYaw; in SVG (y-down) its
// unit vector is (−sin yaw, −cos yaw). Δ = −π/2 − angle(facing). yaw 0 (north) → Δ 0.
const headingDelta = computed(() =>
	-Math.PI / 2 - Math.atan2(-Math.cos(ui.cameraYaw), -Math.sin(ui.cameraYaw))
)

// Rotate a north-up screen offset (ox, oy) by Δ. (Standard 2D rotation, SVG y-down.)
function rot(ox, oy) {
	const d = headingDelta.value
	const c = Math.cos(d), s = Math.sin(d)
	return { x: ox * c - oy * s, y: ox * s + oy * c }
}

// Map an SL (x, y) → minimap viewBox px: self-centred, heading-up.
function slToMini(x, y) {
	const ox = (x - selfPos.value.x) * pxPerM.value
	const oy = -(y - selfPos.value.y) * pxPerM.value   // north-up offset (SL +Y → screen up)
	const r = rot(ox, oy)
	return { x: CENTER + r.x, y: CENTER + r.y }
}

// ── Other avatars ───────────────────────────────────────────────────────────
// Self is drawn separately (centred); here we plot everyone else from the
// ObjectUpdate-driven object list. Cull dots that fall outside the view.
const otherDots = computed(() => {
	const myId = session.agentId?.toLowerCase()
	const out = []
	for (const av of world.avatars) {
		if (!av.pos) continue
		if (av.fullId?.toLowerCase() === myId) continue
		const p = slToMini(av.pos[0], av.pos[1])
		if (p.x < 1 || p.x > SIZE - 1 || p.y < 1 || p.y > SIZE - 1) continue
		out.push({ id: av.localId, x: p.x, y: p.y, name: av.name || 'Avatar' })
	}
	return out
})

// ── Heading cone (~120° FOV wedge) — fixed pointing up (we always face "up") ──
const FOV_HALF = Math.PI / 3   // 60° → 120° total
const CONE_R   = 30
const headingCone = (() => {
	const phi = -Math.PI / 2     // straight up
	const x1 = CENTER + CONE_R * Math.cos(phi - FOV_HALF)
	const y1 = CENTER + CONE_R * Math.sin(phi - FOV_HALF)
	const x2 = CENTER + CONE_R * Math.cos(phi + FOV_HALF)
	const y2 = CENTER + CONE_R * Math.sin(phi + FOV_HALF)
	return `M ${CENTER} ${CENTER} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${CONE_R} ${CONE_R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
})()

// ── Compass rose — rotates with heading (N drifts as the map turns) ──────────
const COMPASS = [
	{ label: 'N',  dir: Math.PI / 2      },
	{ label: 'NE', dir: Math.PI / 4      },
	{ label: 'E',  dir: 0                },
	{ label: 'SE', dir: -Math.PI / 4     },
	{ label: 'S',  dir: -Math.PI / 2     },
	{ label: 'SW', dir: -3 * Math.PI / 4 },
	{ label: 'W',  dir: Math.PI          },
	{ label: 'NW', dir: 3 * Math.PI / 4  },
]
const compassPoints = computed(() =>
	COMPASS.map(pt => {
		// north-up unit vector for this SL direction, then rotate with the map
		const r = rot(Math.cos(pt.dir), -Math.sin(pt.dir))
		return {
			label: pt.label,
			x: CENTER + R_COMP * r.x,
			y: CENTER + R_COMP * r.y,
			opacity: pt.label.length === 1 ? (pt.label === 'N' || pt.label === 'S' ? 0.9 : 0.65) : 0.45,
			weight:  pt.label === 'N' ? 'bold' : 'normal',
		}
	})
)

// Double-click → teleport. Convert SVG-local px back to SL metres (inverse of slToMini:
// un-rotate the screen offset, then un-scale).
function onMinimapDblClick(e) {
	const svg = e.currentTarget
	const rect = svg.getBoundingClientRect()
	const sx = ((e.clientX - rect.left) / rect.width)  * SIZE - CENTER
	const sy = ((e.clientY - rect.top)  / rect.height) * SIZE - CENTER
	// inverse rotation (−Δ)
	const d = -headingDelta.value
	const ox = sx * Math.cos(d) - sy * Math.sin(d)
	const oy = sx * Math.sin(d) + sy * Math.cos(d)
	const tx = selfPos.value.x + ox / pxPerM.value
	const ty = selfPos.value.y - oy / pxPerM.value
	const tz = world.avatarPos?.z ?? 50
	requestTeleport({ x: tx, y: ty, z: tz })
}

// TODO: draggable + persist position — use indexedDB (too many floaters for localStorage)
// See docs/tech-debt.md
</script>

<template>
	<!-- Default: ~20% from right edge, 0.75% from top. Eventually draggable + persisted. -->
	<div
		class="absolute bg-black/60 rounded overflow-hidden"
		style="width: clamp(8rem, 10vw, 20rem); aspect-ratio: 1/1; right: 20%; top: 0.75%;"
	>
		<svg
			class="w-full h-full cursor-crosshair"
			:viewBox="`0 0 ${SIZE} ${SIZE}`"
			preserveAspectRatio="xMidYMid meet"
			title="Double-click to teleport · scroll to zoom"
			@dblclick="onMinimapDblClick"
			@wheel="onWheel"
		>
			<rect width="100%" height="100%" fill="transparent" />

			<!-- Cross-hairs -->
			<line :x1="CENTER" y1="0"      :x2="CENTER" :y2="SIZE"   stroke="#ffffff18" stroke-width="1"/>
			<line x1="0"       :y1="CENTER" :x2="SIZE"   :y2="CENTER" stroke="#ffffff18" stroke-width="1"/>

			<!-- Heading cone (own avatar FOV) -->
			<path :d="headingCone" fill="#00e67633" stroke="#00e67688" stroke-width="0.5" />

			<!-- Other avatars — cyan -->
			<circle
				v-for="d in otherDots" :key="d.id"
				:cx="d.x" :cy="d.y" r="3"
				fill="#00b4d8" stroke="#0a0a0a" stroke-width="0.75"
			><title>{{ d.name }}</title></circle>

			<!-- Self — green, always centred -->
			<circle :cx="CENTER" :cy="CENTER" r="3.5" fill="#00e676" stroke="#0a0a0a" stroke-width="1" />

			<!-- Compass labels (fixed, north-up) -->
			<text
				v-for="pt in compassPoints" :key="pt.label"
				:x="pt.x" :y="pt.y"
				:font-weight="pt.weight"
				:fill-opacity="pt.opacity"
				fill="#e2e8f0"
				font-size="8"
				font-family="monospace"
				text-anchor="middle"
				dominant-baseline="middle"
				style="user-select:none;"
			>{{ pt.label }}</text>
		</svg>
	</div>
</template>
