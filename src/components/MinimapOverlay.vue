<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
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

const SIZE   = 128   // viewBox coordinate space
const REGION = 256   // SL region = 256×256 m
const R_DOTS = SIZE / 2 - 2   // avatar dot radius from center (fills the square)
const R_COMP = SIZE / 2 - 7   // compass label orbit radius (just inside edge)

// ── Avatar dots ────────────────────────────────────────────────────────────
const dots = computed(() =>
	world.avatars.map(av => ({
		id: av.localId,
		x:  av.pos ? (av.pos[0] / REGION) * SIZE : SIZE / 2,
		y:  av.pos ? SIZE - (av.pos[1] / REGION) * SIZE : SIZE / 2,
	}))
)

// ── Compass rose (8 directions, rotate with avatar heading) ────────────────
// three_yaw = 0 → facing North (SL +Y). SVG_angle for label = three_yaw − dir_sl_rad
// where dir_sl_rad is the SL world angle (0=East, π/2=North, CCW).
// Derivation: bearing from avatar to direction = dir−(π/2+yaw); SVG = -bearing−π/2
//   → simplifies to: svgAngle = yaw − dir_sl_rad   (verified per compass point)
const COMPASS = [
	{ label: 'N',  dir: Math.PI / 2     },
	{ label: 'NE', dir: Math.PI / 4     },
	{ label: 'E',  dir: 0               },
	{ label: 'SE', dir: -Math.PI / 4    },
	{ label: 'S',  dir: -Math.PI / 2    },
	{ label: 'SW', dir: -3 * Math.PI / 4 },
	{ label: 'W',  dir: Math.PI         },
	{ label: 'NW', dir: 3 * Math.PI / 4 },
]

const compassPoints = computed(() => {
	const yaw = ui.cameraYaw   // Three.js yaw; 0 = facing North
	return COMPASS.map(pt => {
		const a = yaw - pt.dir
		return {
			label: pt.label,
			x: SIZE / 2 + R_COMP * Math.cos(a),
			y: SIZE / 2 + R_COMP * Math.sin(a),
			// N and S get full brightness; cardinals slightly dimmer; intercardinals dimmer still
			opacity: pt.label.length === 1 ? (pt.label === 'N' || pt.label === 'S' ? 0.9 : 0.65) : 0.45,
			weight: pt.label === 'N' ? 'bold' : 'normal',
		}
	})
})

// Double-click → teleport within current region. Convert SVG-local coords back to SL meters.
function onMinimapDblClick(e) {
	const svg = e.currentTarget
	const rect = svg.getBoundingClientRect()
	const fx = (e.clientX - rect.left) / rect.width    // 0..1 across SVG
	const fy = (e.clientY - rect.top)  / rect.height
	const sizeX = session.regionSizeX || 256
	const sizeY = session.regionSizeY || 256
	const tx = fx * sizeX                                // SL X
	const ty = (1 - fy) * sizeY                          // SL Y (flip — minimap +Y is up)
	// Keep current altitude; teleport composable handles z floor.
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
			title="Double-click to teleport within region"
			@dblclick="onMinimapDblClick"
		>
			<rect width="100%" height="100%" fill="transparent" />

			<!-- Cross-hairs -->
			<line :x1="SIZE/2" y1="0"      :x2="SIZE/2" :y2="SIZE"   stroke="#ffffff18" stroke-width="1"/>
			<line x1="0"       :y1="SIZE/2" :x2="SIZE"   :y2="SIZE/2" stroke="#ffffff18" stroke-width="1"/>

			<!-- Avatar dots -->
			<circle
				v-for="d in dots" :key="d.id"
				:cx="d.x" :cy="d.y" r="3"
				fill="#00b4d8"
			/>

			<!-- Compass labels (orbit around edge as avatar rotates) -->
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
