<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()

// ── Synthetic event helpers ───────────────────────────────────────────────
// WHY: useWorldEngine listens on `window` for keydown/keyup. Synthetic events
// let floater buttons reuse existing engine handlers with zero engine changes.
// target.tagName check in onKeyDown passes since window has no tagName.
// WHY alt param: orbit pitch (KeyE/KeyC) requires altKey=true so the engine
// enters the alt-orbit path instead of triggering fly/jump.
function press(code, alt = false) {
	// WHY: dispatch AltLeft first so keys['AltLeft'] is set before the move key arrives.
	if (alt) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'AltLeft', key: 'Alt', bubbles: true, cancelable: true }))
	window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, altKey: alt, bubbles: true, cancelable: true }))
}
function release(code, alt = false) {
	window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, altKey: alt, bubbles: true, cancelable: true }))
	if (alt) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'AltLeft', key: 'Alt', bubbles: true, cancelable: true }))
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
// Preset view row (top) — dispatched as window CustomEvent('qs:camera-preset')
// consumed by useWorldEngine which sets orbit yaw/pitch/radius to a fixed pose.
// CPP: CameraPresets.ChangeView → gAgentCamera.setPositionTargetGlobal / rotations
const PRESETS = [
	{ id: 'front',     label: '⬆', title: 'Front View',                     wired: true  },
	{ id: 'side',      label: '➡', title: 'Side View (left of avatar)',     wired: true  },
	{ id: 'rear',      label: '⬇', title: 'Rear View (default)',            wired: true  },
	{ id: 'tpp',       label: '👁', title: 'Third-Person View',              wired: true  },
	{ id: 'mouselook', label: '🎯', title: 'Mouselook — Phase 2',           wired: false },
	{ id: 'reset',     label: '↩', title: 'Reset camera view (Esc)',        wired: true  },
]

// Orbit 3×3 grid — cardinals via single key, diagonals via two-key combos.
// The engine reads keys['KeyA']/['KeyE']/etc. simultaneously, so dispatching both
// keydown events at once produces diagonal orbit motion. CPP: LLJoystickCameraRotate.
const ORBIT = [
	{ id: 'tl',    label: '↖', title: 'Orbit up-left (Alt+A+E)',    codes: ['KeyA','KeyE'], alt: true,  tap: false, wired: true },
	{ id: 'up',    label: '↑', title: 'Pitch up (Alt+E)',            codes: ['KeyE'],         alt: true,  tap: false, wired: true },
	{ id: 'tr',    label: '↗', title: 'Orbit up-right (Alt+D+E)',   codes: ['KeyD','KeyE'], alt: true,  tap: false, wired: true },
	{ id: 'left',  label: '↰', title: 'Orbit left (Arrow ←)',        codes: ['ArrowLeft'],   alt: false, tap: false, wired: true },
	{ id: 'rst',   label: '↺', title: 'Reset camera view (Esc)',     codes: ['Escape'],      alt: false, tap: true,  wired: true },
	{ id: 'right', label: '↱', title: 'Orbit right (Arrow →)',       codes: ['ArrowRight'],  alt: false, tap: false, wired: true },
	{ id: 'bl',    label: '↙', title: 'Orbit down-left (Alt+A+C)',  codes: ['KeyA','KeyC'], alt: true,  tap: false, wired: true },
	{ id: 'down',  label: '↓', title: 'Pitch down (Alt+C)',          codes: ['KeyC'],         alt: true,  tap: false, wired: true },
	{ id: 'br',    label: '↘', title: 'Orbit down-right (Alt+D+C)', codes: ['KeyD','KeyC'], alt: true,  tap: false, wired: true },
]

// Track 3×3 grid — pan the orbit pivot in screen-relative axes (no orbit angle change).
// CPP: LLJoystickCameraTrack → gAgentCamera.cameraPanLeft / cameraPanUp / cameraPanIn
// Each entry's dirs[] gets dispatched per held-tick via window CustomEvent('qs:camera-track').
const TRACK = [
	{ id: 'tl', label: '↖', title: 'Pan up-left',        dirs: ['up','left'],     wired: true },
	{ id: 'up', label: '↑', title: 'Pan up',             dirs: ['up'],            wired: true },
	{ id: 'tr', label: '↗', title: 'Pan up-right',       dirs: ['up','right'],    wired: true },
	{ id: 'l',  label: '←', title: 'Pan left',           dirs: ['left'],          wired: true },
	{ id: 'c',  label: '⊕', title: 'Pan reset to avatar',dirs: ['reset'], tap: true, wired: true },
	{ id: 'r',  label: '→', title: 'Pan right',          dirs: ['right'],         wired: true },
	{ id: 'bl', label: '↙', title: 'Pan down-left',      dirs: ['down','left'],   wired: true },
	{ id: 'dn', label: '↓', title: 'Pan down',           dirs: ['down'],          wired: true },
	{ id: 'br', label: '↘', title: 'Pan down-right',     dirs: ['down','right'],  wired: true },
]

function onOrbitDown(btn) {
	if (!btn.wired) return
	if (btn.tap) { tap(btn.codes[0]); return }
	// WHY: For diagonals, dispatch both keydowns so the engine's per-frame key state
	// has both axes held simultaneously. Alt prefix added once.
	for (const c of btn.codes) press(c, btn.alt)
}
function onOrbitUp(btn) {
	if (!btn.wired || btn.tap) return
	for (const c of btn.codes) release(c, btn.alt)
}
function onPresetClick(p) {
	if (!p.wired) return
	if (p.id === 'reset') { tap('Escape'); return }
	// Engine listens for this CustomEvent and sets orbit yaw/pitch/radius to the named pose
	window.dispatchEvent(new CustomEvent('qs:camera-preset', { detail: { name: p.id } }))
}

// ── Track pan: hold-fire dispatching CustomEvent at ~30Hz while held ──────
let _trackTimer = null
function fireTrack(dirs) {
	for (const d of dirs) {
		window.dispatchEvent(new CustomEvent('qs:camera-track', { detail: { dir: d, step: 0.25 } }))
	}
}
function onTrackDown(btn) {
	if (!btn.wired) return
	if (btn.tap) { fireTrack(btn.dirs); return }
	fireTrack(btn.dirs)
	_trackTimer = setInterval(() => fireTrack(btn.dirs), 33)
}
function onTrackUp() { clearInterval(_trackTimer); _trackTimer = null }

// Safety: release all held orbit keys + stop zoom/track on global mouseup
function globalUp() {
	for (const b of ORBIT) {
		if (b.wired && !b.tap) for (const c of b.codes) release(c, b.alt)
	}
	stopZoom()
	onTrackUp()
}
onMounted(()   => window.addEventListener('mouseup', globalUp))
onUnmounted(() => window.removeEventListener('mouseup', globalUp))
</script>

<template>
	<FloaterWindow
		id="camera"
		title="🎥 Camera"
		:wrap-style="{ width: '19rem', resize: 'both' }"
		:default-pos="{ left: '17.25vw', top: 'calc(100vh - 2.5rem - 12.25vw)' }"
		@close="ui.toggleCameraControls()"
	>
		<div class="containerQ flex flex-col gap-[3px] p-[5px] select-none">

			<!-- ── Preset view row ─────────────────────────────────── -->
			<div class="flex gap-[3px]">
				<button
					v-for="p in PRESETS" :key="p.id"
					class="custom flex-1 flex items-center justify-center rounded-sm border leading-none transition-colors"
					:class="p.wired
						? 'bg-panel-alt border-edge/70 text-fg hover:bg-accent-dark hover:text-white hover:border-accent active:bg-accent/50 cursor-default'
						: 'bg-white/3 border-edge/30 text-fg/25 cursor-not-allowed'"
					:title="p.title"
					:disabled="!p.wired"
					@click="onPresetClick(p)"
				>{{ p.label }}</button>
			</div>

			<!-- ── Main 3-column: Orbit | Zoom | Track ─────────────── -->
			<div class="flex gap-[3px]">

				<!-- Orbit 3×3 -->
				<div class="flex flex-col flex-1 gap-[2px]">
					<div class="text-te text-fg/35 uppercase tracking-widest text-center">Orbit</div>
					<div class="grid grid-cols-3 gap-[2px]">
						<button
							v-for="btn in ORBIT" :key="btn.id"
							class="custom flex items-center justify-center rounded-sm border leading-none transition-colors cam-btn"
							:class="btn.wired
								? 'bg-panel-alt border-edge/70 text-fg hover:bg-accent-dark hover:text-white hover:border-accent active:bg-accent/50 cursor-default'
								: 'bg-white/3 border-edge/30 text-fg/25 cursor-not-allowed'"
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
					<div class="text-te text-fg/35 uppercase tracking-widest">Zoom</div>
					<!-- Zoom In -->
					<button
						class="custom sqtiny flex items-center justify-center bg-panel-alt hover:bg-accent-dark hover:text-white active:bg-accent/50 border border-edge/70 hover:border-accent rounded-sm w-full aspect-square font-bold text-fg cursor-default transition-colors"
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
						class="custom flex items-center justify-center bg-panel-alt hover:bg-accent-dark hover:text-white active:bg-accent/50 border border-edge/70 sqtiny hover:border-accent rounded-sm w-full aspect-square font-bold text-fg cursor-default transition-colors"
						title="Zoom out (hold)"
						@mousedown.prevent="startZoom(1)"
						@mouseup="stopZoom"
						@mouseleave="stopZoom"
					>−</button>
				</div>

				<!-- Track 3×3 (pan pivot in screen-relative axes) -->
				<div class="flex flex-col flex-1 gap-[2px]">
					<div class="text-te text-fg/35 uppercase tracking-widest text-center">Track</div>
					<div class="grid grid-cols-3 gap-[2px]">
						<button
							v-for="btn in TRACK" :key="btn.id"
							class="custom flex items-center justify-center rounded-sm border leading-none transition-colors cam-btn"
							:class="btn.wired
								? 'bg-panel-alt border-edge/70 text-fg hover:bg-accent-dark hover:text-white hover:border-accent active:bg-accent/50 cursor-default'
								: 'bg-white/3 border-edge/30 text-fg/25 cursor-not-allowed'"
							:title="btn.title"
							:disabled="!btn.wired"
							@mousedown.prevent="onTrackDown(btn)"
							@mouseup="onTrackUp"
							@mouseleave="onTrackUp"
						>{{ btn.label }}</button>
					</div>
				</div>

			</div>

			<!-- ── Tip ─────────────────────────────────────────────── -->
			<div class="hidden text-[6cqi] text-fg/25 text-center leading-none mt-0.5">
				Alt+drag/A/D/E/C → orbit · Alt+W/D/Scroll → zoom · Esc → reset
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
	/* aspect-ratio: 1/1; */
}
button.sqtiny {
	font-size: 7cqi;
	aspect-ratio: 1/1;
}
input[type="range"] {
	max-height: 5.3cqi;
}
.text-te {
	font-size: 4cqw;
}
</style>
