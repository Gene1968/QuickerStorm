<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()

// ── Synthetic event helpers ───────────────────────────────────────────────
// WHY: useWorldEngine listens on `window` for keydown/keyup. Synthetic events
// let floater buttons reuse existing engine handlers with zero engine changes.
// target.tagName check in onKeyDown passes since window has no tagName.
function press(code) {
	window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, cancelable: true }))
}
function release(code) {
	window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true, cancelable: true }))
}
function tap(code) {
	press(code)
	setTimeout(() => release(code), 50)
}

// WHY: World engine wheel handler is on renderer.domElement (the <canvas>),
// not window — so wheel events must target it directly.
function zoomCanvas(deltaY) {
	const canvas = document.querySelector('canvas')
	if (!canvas) return
	canvas.dispatchEvent(new WheelEvent('wheel', {
		deltaY, deltaMode: 0, bubbles: true, cancelable: true,
	}))
}

// ── Hold-zoom ─────────────────────────────────────────────────────────────
let _zoomTimer = null
function startZoom(dir) { // dir: -1=in, +1=out
	zoomCanvas(dir * 120)
	_zoomTimer = setInterval(() => zoomCanvas(dir * 120), 120)
}
function stopZoom() { clearInterval(_zoomTimer); _zoomTimer = null }

// ── Button maps ───────────────────────────────────────────────────────────
// Preset view row (top) — only Reset wired; others need camera-preset system
// CPP: CameraPresets.ChangeView → gAgentCamera.setPositionTargetGlobal / rotations
const PRESETS = [
	{ id: 'front',     label: '⬆', title: 'Front View — Phase 2',          wired: false },
	{ id: 'side',      label: '➡', title: 'Side View — Phase 2',           wired: false },
	{ id: 'rear',      label: '⬇', title: 'Rear View (default)',           wired: true },
	{ id: 'tpp',       label: '👁', title: 'Third-Person View — Phase 2',   wired: false },
	{ id: 'mouselook', label: '🎯', title: 'Mouselook — Phase 2',           wired: false },
	{ id: 'reset',     label: '↩', title: 'Reset camera view (Esc)',        wired: true  },
]

// Orbit 3×3 grid — left/right wired via ArrowLeft/ArrowRight (yaw).
// Pitch up/down = Phase 2 (no keyboard pitch in useWorldEngine — mouse only).
// CPP: LLJoystickCameraRotate → gAgentCamera.cameraOrbitAround / cameraOrbitOver
const ORBIT = [
	{ id: 'tl',    label: '↖', title: 'Orbit up-left — Phase 2',    code: null,         tap: false, wired: false },
	{ id: 'up',    label: '↑', title: 'Pitch up — Phase 2',          code: null,         tap: false, wired: false },
	{ id: 'tr',    label: '↗', title: 'Orbit up-right — Phase 2',   code: null,         tap: false, wired: false },
	{ id: 'left',  label: '↰', title: 'Orbit left (Arrow ←)',        code: 'ArrowLeft',  tap: false, wired: true  },
	{ id: 'rst',   label: '↺', title: 'Reset camera view (Esc)',     code: 'Escape',     tap: true,  wired: true  },
	{ id: 'right', label: '↱', title: 'Orbit right (Arrow →)',       code: 'ArrowRight', tap: false, wired: true  },
	{ id: 'bl',    label: '↙', title: 'Orbit down-left — Phase 2',   code: null,         tap: false, wired: false },
	{ id: 'down',  label: '↓', title: 'Pitch down — Phase 2',        code: null,         tap: false, wired: false },
	{ id: 'br',    label: '↘', title: 'Orbit down-right — Phase 2',  code: null,         tap: false, wired: false },
]

// Track 3×3 grid — all Phase 2 (needs Alt+scroll pan or engine-exposed API).
// CPP: LLJoystickCameraTrack → gAgentCamera.cameraPanLeft / cameraPanUp / cameraPanIn
const TRACK = [
	{ id: 'tl', label: '↖', title: 'Pan up-left — Phase 2'    },
	{ id: 'up', label: '↑', title: 'Pan up — Phase 2'          },
	{ id: 'tr', label: '↗', title: 'Pan up-right — Phase 2'   },
	{ id: 'l',  label: '←', title: 'Pan left — Phase 2'        },
	{ id: 'c',  label: '⊕', title: 'Pan reset — Phase 2'       },
	{ id: 'r',  label: '→', title: 'Pan right — Phase 2'       },
	{ id: 'bl', label: '↙', title: 'Pan down-left — Phase 2'   },
	{ id: 'dn', label: '↓', title: 'Pan down — Phase 2'        },
	{ id: 'br', label: '↘', title: 'Pan down-right — Phase 2'  },
]

function onOrbitDown(btn) {
	if (!btn.wired) return
	if (btn.tap) { tap(btn.code); return }
	press(btn.code)
}
function onOrbitUp(btn) {
	if (!btn.wired || btn.tap) return
	release(btn.code)
}
function onPresetClick(p) {
	if (!p.wired) return
	tap('Escape') // only reset preset is wired
}

// Safety: release all held orbit keys + stop zoom on global mouseup
function globalUp() {
	for (const b of ORBIT) if (b.wired && !b.tap && b.code) release(b.code)
	stopZoom()
}
onMounted(()   => window.addEventListener('mouseup', globalUp))
onUnmounted(() => window.removeEventListener('mouseup', globalUp))
</script>

<template>
	<FloaterWindow
		id="camera"
		title="🎥 Camera"
		:wrap-style="{ width: '17rem', resize: 'both' }"
		:default-pos="{ left: '21vw', bottom: '2.5rem' }"
		@close="ui.toggleCameraControls()"
	>
		<div class="containerQ flex flex-col gap-[3px] p-[5px] select-none">

			<!-- ── Preset view row ─────────────────────────────────── -->
			<div class="flex gap-[3px]">
				<button
					v-for="p in PRESETS" :key="p.id"
					class="flex-1 flex items-center justify-center rounded border leading-none transition-colors"
					:class="p.wired
						? 'bg-card2 border-brd/70 text-t1 hover:bg-accent2 hover:border-accent active:bg-accent/50 cursor-default'
						: 'bg-white/3 border-brd/30 text-white/25 cursor-not-allowed'"
					:title="p.title"
					:disabled="!p.wired"
					@click="onPresetClick(p)"
				>{{ p.label }}</button>
			</div>

			<!-- ── Main 3-column: Orbit | Zoom | Track ─────────────── -->
			<div class="flex gap-[3px]">

				<!-- Orbit 3×3 -->
				<div class="flex flex-col flex-1 gap-[2px]">
					<div class="text-te text-white/35 uppercase tracking-widest text-center">Orbit</div>
					<div class="grid grid-cols-3 gap-[2px]">
						<button
							v-for="btn in ORBIT" :key="btn.id"
							class="flex items-center justify-center rounded border leading-none transition-colors cam-btn"
							:class="btn.wired
								? 'bg-card2 border-brd/70 text-t1 hover:bg-accent2 hover:border-accent active:bg-accent/50 cursor-default'
								: 'bg-white/3 border-brd/30 text-white/25 cursor-not-allowed'"
							:title="btn.title"
							:disabled="!btn.wired"
							@mousedown.prevent="onOrbitDown(btn)"
							@mouseup="onOrbitUp(btn)"
							@mouseleave="onOrbitUp(btn)"
						>{{ btn.label }}</button>
					</div>
				</div>

				<!-- Zoom column -->
				<div class="flex flex-col items-center gap-[2px] w-[9cqi] shrink-0">
					<div class="text-te text-white/35 uppercase tracking-widest">Zoom</div>
					<!-- Zoom In -->
					<button
						class="flex items-center justify-center w-full rounded border font-bold bg-card2 border-brd/70 text-t1 hover:bg-accent2 hover:border-accent active:bg-accent/50 text-[8cqw] cursor-default transition-colors"
						title="Zoom in (hold)"
						@mousedown.prevent="startZoom(-1)"
						@mouseup="stopZoom"
						@mouseleave="stopZoom"
					>+</button>
					<!-- Slider (disabled — Phase 2) -->
					<div class="flex flex-1 items-center justify-center w-full">
						<input
							type="range" min="1" max="10" value="5"
							class="flex-1 accent-accent opacity-25 cursor-not-allowed"
							style="writing-mode: vertical-lr; direction: rtl; width: 0.5rem;"
							disabled title="Zoom slider — Phase 2"
						/>
					</div>
					<!-- Zoom Out -->
					<button
						class="flex items-center justify-center w-full rounded border font-bold bg-card2 border-brd/70 text-t1 hover:bg-accent2 hover:border-accent active:bg-accent/50 text-[8cqw] cursor-default transition-colors"
						title="Zoom out (hold)"
						@mousedown.prevent="startZoom(1)"
						@mouseup="stopZoom"
						@mouseleave="stopZoom"
					>−</button>
				</div>

				<!-- Track 3×3 (all Phase 2) -->
				<div class="flex flex-col flex-1 gap-[2px]">
					<div class="text-te text-white/35 uppercase tracking-widest text-center">Track</div>
					<div class="grid grid-cols-3 gap-[2px]">
						<button
							v-for="btn in TRACK" :key="btn.id"
							class="flex items-center justify-center rounded border leading-none bg-white/3 border-brd/30 text-white/25 cursor-not-allowed cam-btn"
							:title="btn.title"
							disabled
						>{{ btn.label }}</button>
					</div>
				</div>

			</div>

			<!-- ── Tip ─────────────────────────────────────────────── -->
			<div class="text-[6cqi] text-white/25 text-center leading-none mt-0.5">
				Drag → look · Alt+drag → orbit · Scroll → zoom · Esc → reset
			</div>

		</div>
	</FloaterWindow>
</template>

<style scoped>
.containerQ {
	container-type: inline-size;
}
button {
	font-size: 13cqi;
	white-space: nowrap;
	overflow: hidden;
	aspect-ratio: 1/1
}
input[type="range"] {
	max-height: 4cqi;
}
.text-te {
	font-size: 4cqw;
}
</style>
