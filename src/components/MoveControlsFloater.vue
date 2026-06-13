<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/uiStore'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()

// ── Mode state ────────────────────────────────────────────────────────────
// WHY: Run drives uiStore.alwaysRun (AGENT_CONTROL_ALWAYS_RUN, Ctrl+R).
// Fly mirrors uiStore.flying which the engine updates when F or hold-E flips isFlying.
// Fly takes precedence in the highlight since it's the dominant mode.
// CPP refs: MM_RUN → gAgent.setAlwaysRun(); MM_FLY → LLAgent::toggleFlying()
const moveMode = computed(() => {
	if (ui.flying) return 'fly'
	if (ui.alwaysRun) return 'run'
	return 'walk'
})

// ── Synthetic key dispatch ────────────────────────────────────────────────
// WHY: useWorldEngine.js movement loop reads `heldKeys` Set populated by
// window keydown/keyup listeners. Synthetic events means these buttons work
// identically to keyboard with zero engine changes needed.
function press(code, key, shiftKey = false) {
	// WHY: dispatch ShiftLeft first so engine sees shiftKey=true on the move key
	if (shiftKey) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', bubbles: true, cancelable: true }))
	window.dispatchEvent(new KeyboardEvent('keydown', { code, key, shiftKey, bubbles: true, cancelable: true }))
}
function release(code, key, shiftKey = false) {
	window.dispatchEvent(new KeyboardEvent('keyup', { code, key, shiftKey, bubbles: true, cancelable: true }))
	if (shiftKey) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true, cancelable: true }))
}
// WHY: tap = keydown + delayed keyup for toggle keys (fly F) — hold not needed
function tap(code, key) {
	press(code, key)
	setTimeout(() => release(code, key), 50)
}

// Safety: global mouseup releases all movement keys if pointer leaves button
// while held (prevents stuck avatar movement)
function globalUp() {
	for (const b of BTNS) if (b.code) release(b.code, b.key, !!b.shift)
	// Unconditional ShiftLeft release — safety net for any shift strafe held
	window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift', bubbles: true, cancelable: true }))
}
onMounted(()   => window.addEventListener('mouseup', globalUp))
onUnmounted(() => window.removeEventListener('mouseup', globalUp))

// ── Button map ────────────────────────────────────────────────────────────
// Row layout: [TurnL][Fwd][TurnR][Up] / [StrafeL][Back][StrafeR][Down]
// CPP ref for strafe: LLJoystickAgentSlide → gAgent.moveLeft(1) / gAgent.moveLeft(-1)
// JS wired via Shift+A / Shift+D — confirmed working in useWorldEngine.js
const BTNS = [
	// ── Row 1 ──────────────────────────────────────────────────────────
	{ id: 'turn_left',    label: '↰', sub: '← A',   title: 'Turn left (← or A)',    code: 'ArrowLeft',  key: 'ArrowLeft',  wired: true              },
	{ id: 'forward',      label: '↑', sub: '↑ W',   title: 'Move forward (↑ or W)', code: 'ArrowUp',    key: 'ArrowUp',    wired: true              },
	{ id: 'turn_right',   label: '↱', sub: '→ D',   title: 'Turn right (→ or D)',   code: 'ArrowRight', key: 'ArrowRight', wired: true              },
	{ id: 'move_up',      label: '⬆', sub: 'E',     title: 'Jump / Fly up (E)',     code: 'KeyE',       key: 'e',          wired: true              },
	// ── Row 2 ──────────────────────────────────────────────────────────
	{ id: 'strafe_left',  label: '←', sub: 'Shft+A', title: 'Sidestep left (Shift+A)', code: 'KeyA',     key: 'a',          wired: true, shift: true },
	{ id: 'backward',     label: '↓', sub: '↓ S',   title: 'Move backward (↓ or S)',code: 'ArrowDown',  key: 'ArrowDown',  wired: true              },
	{ id: 'strafe_right', label: '→', sub: 'Shft+D', title: 'Strafe right (Shift+D)',code: 'KeyD',     key: 'd',          wired: true, shift: true },
	{ id: 'move_down',    label: '⬇', sub: 'C',     title: 'Crouch / Fly down (C)', code: 'KeyC',       key: 'c',          wired: true              },
]

const MODES = [
	{ id: 'walk', label: '🚶', sub: 'Walk', wired: true,  title: 'Walk mode not run (Ctrl+R)' },
	{ id: 'run',  label: '🏃', sub: 'Run',  wired: true,  title: 'Always Run (Ctrl+R)' },
	{ id: 'fly',  label: '✈',  sub: 'Fly',  wired: true,  title: 'Fly toggle (F)' },
]

function shiftFor(btn) { return !!btn.shift }
function onBtnDown(btn) { if (btn.wired && btn.code) press(btn.code, btn.key, shiftFor(btn)) }
function onBtnUp(btn)   { if (btn.wired && btn.code) release(btn.code, btn.key, shiftFor(btn)) }
function selectMode(m) {
	if (!m.wired) return
	if (m.id === 'fly') {
		// WHY: F key toggles fly in engine — tap (not hold)
		tap('KeyF', 'f')
		return
	}
	// WHY: FS parity — clicking Walk/Run while flying also lands the avatar
	if (ui.flying) tap('KeyF', 'f')
	ui.setAlwaysRun(m.id === 'run')
}
</script>

<template>
	<FloaterWindow
		id="move"
		title="🚶 Movement"
		:wrap-style="{ width: '10rem', resize: 'both' }"
		:default-pos="{ left: '15.35vw', bottom: '2.5rem' }"
		@close="ui.toggleMoveControls()"
		class="min-w-[10rem] min-h-[10.5rem]"
	>
		<div class="flex flex-col grow gap-[3px] h-full p-[5px]">

			<!-- Movement grid: 4 cols × 2 rows -->
			<div class="grid grid-cols-4 gap-[3px] h-2/3">
				<button
					v-for="btn in BTNS"
					:key="btn.id"
					class="custom flex flex-col items-center justify-center min-h-10 rounded-sm border text-base font-mono leading-none transition-colors"
					:class="btn.wired
						? 'bg-card2 border-brd/70 text-t1 hover:bg-accent2 hover:border-accent active:bg-accent/50 cursor-default'
						: 'bg-white/3 border-brd/30 text-white/25 cursor-not-allowed'"
					:title="btn.title"
					:disabled="!btn.wired"
					@mousedown.prevent="onBtnDown(btn)"
					@mouseup="onBtnUp(btn)"
					@mouseleave="onBtnUp(btn)"
				>
					<span class="text-ic">{{ btn.label }}</span>
					<!-- <span class="text-te leading-none mt-0.5 opacity-50">{{ btn.sub }}</span> -->
				</button>
			</div>

			<!-- Mode row: Walk / Run / Fly -->
			<div class="flex grow gap-[3px]">
				<button
					v-for="mode in MODES"
					:key="mode.id"
					class="custom flex-1 flex flex-col items-center justify-center py-1 rounded-sm border text-xs leading-none transition-colors"
					:class="moveMode === mode.id && mode.wired
						? 'active'
						: mode.wired
							? 'bg-card2 border-brd/70 text-t1 hover:bg-accent2 hover:border-accent/50'
							: 'bg-white/3 border-brd/30 text-white/25 cursor-not-allowed'"
					:title="mode.title"
					:disabled="!mode.wired"
					@click="selectMode(mode)"
				>
					<span class="text-ic leading-none">{{ mode.label }}</span>
					<!-- <span class="text-te leading-none mt-0.5">{{ mode.sub }}</span> -->
				</button>
			</div>

		</div>
	</FloaterWindow>
</template>

<style scoped>
button {
	overflow: hidden;
	white-space: nowrap;
	container: card-grid / inline-size;
}
.text-ic {
	/* font-size: 45cqw; */
	font-size: 55cqw;
}
.text-te {
	font-size: 14cqw;
}
</style>
