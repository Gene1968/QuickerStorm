<script setup>
import { ref, nextTick, onBeforeUnmount, onActivated, onDeactivated } from 'vue'
import { useGraphicsEngine } from '@/composables/centipede/useGraphicsEngine'
import { useGame } from '@/composables/centipede/useGame'
import { useRender } from '@/composables/centipede/useRender'
import { useKeyPress } from '@/composables/centipede/useKeyPress'
import { useGameBoard } from '@/composables/centipede/useGameBoard'
import { useGameState } from '@/composables/centipede/useGameState'
import { useCentipede } from '@/composables/centipede/useCentipede'
import { useSpider } from '@/composables/centipede/useSpider'
import { useFlea } from '@/composables/centipede/useFlea'
import { useSnail } from '@/composables/centipede/useSnail'
import graphicsFile from '@/assets/img/centipede-graphics.png'
import { openModal, closeModal } from '@/composables/useModalStack.js'

const instructionsDisplayed = ref(false)
const isPaused = ref(false)
const isActive = ref(false)

defineEmits(['close'])

const CANVAS_W = 600
const CANVAS_H = 640

const canvasRef = ref(null)
const gameStarted = ref(false)

const gfx = useGraphicsEngine()
const gameService = useGame()
const renderService = useRender()
const keyPressHandler = useKeyPress()
const gameBoardService = useGameBoard()
const gameStateService = useGameState()
const centipedeService = useCentipede()
const spiderService = useSpider()
const fleaService = useFlea()
const snailService = useSnail()

const showStats = ref(false)
const showRestartConfirm = ref(false)
const statsRowsCleared = ref(0)
const statsMushrooms = ref('0.00')
const statsPoisoned = ref('0.00')
const statsCentSegs = ref(0)
const statsFastSegs = ref(0)
const statsMonsters = ref(0)
const statsElapsed = ref('0:00')

let intervalId = null
let animation = 0

function formatElapsed(ms) {
	const totalSeconds = Math.floor(ms / 1000)
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function gameLoop() {
	animation = (animation + 1) % 4
	gameService.update(animation)
	renderService.draw(animation)
	if (showStats.value) {
		statsRowsCleared.value = gameBoardService.clearedRowCount
		statsMushrooms.value = gameBoardService.totalMushroomHealth.toFixed(2)
		statsPoisoned.value = gameBoardService.totalPoisonMushroomHealth.toFixed(2)
		statsCentSegs.value = centipedeService.segmentCount
		statsFastSegs.value = centipedeService.fastSegmentCount
		statsMonsters.value = (spiderService.isActive ? 1 : 0) + (fleaService.isActive ? 1 : 0) + (snailService.isActive ? 1 : 0)
		statsElapsed.value = formatElapsed(gameStateService.elapsedMs)
	}
}

function startInterval() {
	if (intervalId) clearInterval(intervalId)
	intervalId = setInterval(gameLoop, 50)
}

function startGame() {
	animation = 0
	const ctx = canvasRef.value.getContext('2d')
	gfx.initialise(ctx, graphicsFile)
	gameService.initialise()
	startInterval()
	gameStarted.value = true
	instructionsDisplayed.value = true
	isPaused.value = false
	canvasRef.value?.focus()
}

function drawPauseOverlay() {
	const ctx = canvasRef.value.getContext('2d')
	ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
	ctx.fillRect(0, 0, 600, 640)
	ctx.fillStyle = 'white'
	ctx.font = 'bold 48px monospace'
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.fillText('PAUSED', 300, 320)
}

function handleKeyDown(e) {
	if ([32, 37, 38, 39, 40].includes(e.keyCode)) e.preventDefault()
	if (!gameStarted.value) { startGame(); return }

	if (!instructionsDisplayed.value) {
		instructionsDisplayed.value = true
		const ctx = canvasRef.value.getContext('2d')
		gfx.initialise(ctx, graphicsFile)
		gameService.initialise()
		intervalId = setInterval(gameLoop, 50)
		return
	}

	if (e.keyCode === 80) {
		isPaused.value = !isPaused.value
		if (isPaused.value) {
			clearInterval(intervalId)
			intervalId = null
			drawPauseOverlay()
		} else {
			startInterval()
		}
		return
	}

	if (e.keyCode === 73) {
		showStats.value = !showStats.value
		return
	}

	if (e.keyCode === 82) {
		if (showRestartConfirm.value) {
			showRestartConfirm.value = false
			isPaused.value = false
			gameService.restart()
			if (!intervalId) startInterval()
		} else {
			showRestartConfirm.value = true
			if (intervalId) { clearInterval(intervalId); intervalId = null }
		}
		return
	}

	if (e.keyCode === 27 && showRestartConfirm.value) {
		showRestartConfirm.value = false
		if (!isPaused.value && !intervalId) startInterval()
		return
	}

	if (isPaused.value) return
	keyPressHandler.keyPress(e.keyCode)
}

function handleKeyUp(e) {
	keyPressHandler.keyRelease(e.keyCode)
}

onActivated(async () => {
	isActive.value = true
	openModal()
	window.addEventListener('keydown', handleKeyDown)
	window.addEventListener('keyup', handleKeyUp)
	if (gameStarted.value) {
		await nextTick()
		const ctx = canvasRef.value.getContext('2d')
		gfx.initialise(ctx, graphicsFile)
		renderService.draw(animation)
		if (isPaused.value) {
			drawPauseOverlay()
		} else {
			startInterval()
		}
		canvasRef.value?.focus()
	}
})

onDeactivated(() => {
	isActive.value = false
	closeModal()
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	if (intervalId) {
		clearInterval(intervalId)
		intervalId = null
		if (gameStarted.value && !isPaused.value) {
			isPaused.value = true
		}
	}
})

onBeforeUnmount(() => {
	closeModal()
	window.removeEventListener('keydown', handleKeyDown)
	window.removeEventListener('keyup', handleKeyUp)
	if (intervalId) clearInterval(intervalId)
})
</script>

<template>
	<Teleport to="body">
		<div v-if="isActive" class="ctp-overlay font-roboto" @click.self="$emit('close')">
			<div class="ctp-panel" :class="{ 'ctp-panel--wide': showStats }">
				<div class="ctp-header">
					<div class="ctp-header-left">
						<span class="ctp-icon">🐛</span>
						<span class="ctp-title">Centipede</span>
						<span class="ctp-hint" v-if="!gameStarted && !isPaused">Press any key or click Start to play</span>
					<span class="ctp-hint" v-else-if="isPaused">Paused · press P to resume</span>
					</div>
					<button class="ctp-close" @click="$emit('close')" aria-label="Close">✕</button>
				</div>

				<div class="ctp-body">
					<div class="ctp-stage">
						<div v-if="!gameStarted" class="ctp-instructions">
							<h2>Centipede Instructions</h2>
							<strong> Shoot everything and stay alive</strong>
							<p>Arrow Keys to move</p>
							<p>Space bar to fire</p>
							<p>Press any key to start</p>
							<br />
							<p>(I to toggle stats)</p>
							<p>(P to toggle pause)</p>
							<p>(R to restart game)</p>
							<button class="ctp-btn" @click="startGame">Start</button>
						</div>
						<canvas
							v-show="gameStarted"
							ref="canvasRef"
							:width="CANVAS_W"
							:height="CANVAS_H"
							class="ctp-canvas"
							tabindex="0"
						/>
						<div v-if="showRestartConfirm" class="restart-confirm">
							<div class="restart-confirm-title">RESTART?</div>
							<div><kbd>R</kbd> Yes &nbsp; <kbd>Esc</kbd> Cancel</div>
						</div>
						<div v-if="showStats" class="stats-panel">
							<div class="stats-title">STATS / INFO</div>
							<div>Play time: <span>{{ statsElapsed }}</span></div>
							<div>Mushrooms: <span>{{ statsMushrooms }}</span></div>
							<div v-if="statsPoisoned > 0">Poisoned!: <span style="color: #ff4444">{{ statsPoisoned }}</span></div>
							<div>Cent segs: <span>{{ statsCentSegs }}</span></div>
							<div v-if="statsFastSegs > 0">Fast segs: <span style="color: #f44">{{ statsFastSegs }}</span></div>
							<div>Open rows: <span :style="{ color: statsRowsCleared < 3 ? '#ff4444' : statsRowsCleared < 6 ? '#ff9900' : undefined }">{{ statsRowsCleared }}</span></div>
							<div v-if="statsMonsters > 0">Monsters!: <span style="color: #ff4444">{{ statsMonsters }}</span></div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.ctp-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.82);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 590;
	backdrop-filter: blur(4px);
}
.ctp-panel {
	width: min(40rem, 96vw);
	transition: width 0.2s ease;
	max-height: 96vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.875rem;
	box-shadow: 0 20px 80px rgba(0, 0, 0, 0.75);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.ctp-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.75rem 1.1rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
}
.ctp-header-left { display: flex; align-items: center; gap: 0.75rem; }
.ctp-icon  { font-size: 1.2rem; }
.ctp-title { font-weight: 700; color: var(--color-t1); font-size: 1rem; }
.ctp-hint  { font-size: 0.8rem; color: var(--color-tm); }
.ctp-close {
	background: none; border: none; color: var(--color-tm);
	font-size: 1rem; cursor: pointer; padding: 0.25rem 0.5rem;
	border-radius: 0.25rem; line-height: 1;
}
.ctp-close:hover { color: var(--color-t1); background: rgba(255,255,255,0.06); }

.ctp-body {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem;
	min-height: 0;
}
.ctp-stage {
	display: flex;
	align-items: flex-start;
	justify-content: center;
	gap: 0.75rem;
}
.ctp-panel--wide {
	width: min(50rem, 96vw);
}
.ctp-instructions {
	text-align: center;
	color: var(--color-t1);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.6rem;
	padding: 2rem;
}
.ctp-instructions h2 {
	font-size: 1.6rem;
	font-weight: 700;
	color: var(--color-accent);
	margin: 0;
}
.ctp-instructions p {
	font-size: 0.9rem;
	color: var(--color-tm);
	margin: 0;
}
.ctp-btn {
	margin-top: 0.5rem;
	background: var(--color-accent);
	border: none;
	border-radius: 0.4375rem;
	color: #fff;
	font-size: 0.9rem;
	font-weight: 700;
	padding: 0.55rem 1.5rem;
	cursor: pointer;
	transition: background 0.15s;
}
.ctp-btn:hover { background: var(--color-accent2); }
.ctp-canvas {
	border: 2px solid var(--color-brd);
	border-radius: 0.5rem;
	background: #000;
	image-rendering: pixelated;
	outline: none;
	max-width: 100%;
	height: auto;
}
.ctp-canvas:focus { border-color: var(--color-accent); }

.stats-panel {
	align-self: flex-start;
	background: rgba(0, 0, 0, 0.75);
	color: #fff;
	font-family: monospace;
	font-size: 13px;
	padding: 10px 14px;
	border: 1px solid #0f0;
	white-space: nowrap;
	line-height: 1.8;
}
.stats-title {
	font-weight: bold;
	margin-bottom: 4px;
	color: #ff0;
	letter-spacing: 2px;
}
.stats-panel span {
	color: #0f0;
}

.restart-confirm {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	background: rgba(0, 0, 0, 0.88);
	color: #fff;
	font-family: monospace;
	font-size: 15px;
	padding: 18px 28px;
	border: 2px solid #ff0;
	text-align: center;
	white-space: nowrap;
}

.restart-confirm-title {
	font-weight: bold;
	font-size: 18px;
	color: #ff0;
	letter-spacing: 3px;
	margin-bottom: 10px;
}

.restart-confirm kbd {
	background: #333;
	border: 1px solid #888;
	border-radius: 3px;
	padding: 1px 5px;
	font-family: monospace;
}
</style>
