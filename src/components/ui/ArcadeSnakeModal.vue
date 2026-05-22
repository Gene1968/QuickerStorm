<script setup>
/**
 * ArcadeSnakeModal — Breakroom snake; leaderboard via ListApi.
 *
 * Leaderboard storage: `public.arcade_scores` with columns
 *   title, player_name, player_email, score, created_at (default now()).
 * ListApi surfaces them as PascalCase (Title, PlayerName, …, CreatedAt).
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import ListApi from '@/api/ListApi.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
import { openModal, closeModal } from '@/composables/useModalStack.js'
import { config } from '@/config/configuration.js'
import { useAvatarStore } from '@/stores/avatarStore.js'

/** SharePoint /Date(ms)/ or ISO string → Date, else null */
function parseListDate(val) {
	if (val == null || val === '') return null
	if (typeof val === 'string') {
		const m = /^\/Date\((-?\d+)\)\/$/.exec(val.trim())
		if (m) return new Date(Number(m[1]))
		const t = Date.parse(val)
		return Number.isNaN(t) ? null : new Date(t)
	}
	if (typeof val === 'number') return new Date(val)
	if (val instanceof Date) return val
	return null
}

function isLocalCalendarDay(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false
	const now = new Date()
	return (
		date.getFullYear() === now.getFullYear()
		&& date.getMonth() === now.getMonth()
		&& date.getDate() === now.getDate()
	)
}

defineEmits(['close'])

const avatarStore = useAvatarStore()
const listApi = ListApi(config.siteUrl, 'QuickerStorm Arcade Scores')

// ── Board config ─────────────────────────────────────────────────────
const COLS = 24
const ROWS = 20
const CELL = 20
const WIDTH  = COLS * CELL
const HEIGHT = ROWS * CELL
const TICK_MS = 110

// ── State ────────────────────────────────────────────────────────────
const canvasRef = ref(null)
const status    = ref('idle')  // 'idle' | 'playing' | 'over'
const score     = ref(0)
const highScores = ref([])
const loadingScores = ref(true)
const saveError  = ref(null)

let snake, dir, nextDir, food, loopTimer

const sortedScores = computed(() =>
	[...highScores.value].sort((a, b) => b.Score - a.Score).slice(0, 10)
)

/** Single best score among runs timestamped today (local calendar). */
const topScoreToday = computed(() => {
	const best = [...highScores.value]
		.filter(s => s.playedAt && isLocalCalendarDay(s.playedAt))
		.sort((a, b) => b.Score - a.Score)[0]
	return best ?? null
})

const personalBest = computed(() => {
	const mine = highScores.value.filter(s => s.PlayerEmail === avatarStore.avaEmail)
	return mine.length ? Math.max(...mine.map(s => s.Score)) : 0
})

// ── Score loading ────────────────────────────────────────────────────
async function loadScores() {
	try {
		const raw = await listApi.getAll({
			$select: 'Id,Title,PlayerName,PlayerEmail,Score,CreatedAt',
			$filter: "Title eq 'Snake'",
			$orderby: 'Score desc',
			$top: 50,
		})
		const items = raw?.d?.results || []
		highScores.value = items.map(i => ({
			Id: i.Id,
			PlayerName: i.PlayerName || 'Anonymous',
			PlayerEmail: i.PlayerEmail || '',
			Score: Number(i.Score) || 0,
			playedAt: parseListDate(i.CreatedAt),
		}))
	} catch (err) {
		console.warn('[Arcade] score load failed:', err.message)
	} finally {
		loadingScores.value = false
	}
}

async function submitScore(finalScore) {
	if (finalScore <= 0) return
	try {
		await listApi.createListItem({
			Title: 'Snake',
			PlayerName: avatarStore.displayName || 'Anonymous',
			PlayerEmail: avatarStore.avaEmail || '',
			Score: finalScore,
		})
		await loadScores()
	} catch (err) {
		saveError.value = 'Score could not be saved.'
		console.warn('[Arcade] score save failed:', err.message)
	}
}

// ── Game loop ────────────────────────────────────────────────────────
function reset() {
	snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]
	dir = { x: 1, y: 0 }
	nextDir = { x: 1, y: 0 }
	score.value = 0
	placeFood()
}

function placeFood() {
	while (true) {
		const f = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }
		if (!snake.some(s => s.x === f.x && s.y === f.y)) { food = f; return }
	}
}

function step() {
	// Prevent 180° reversal
	if (nextDir.x !== -dir.x || nextDir.y !== -dir.y) dir = nextDir
	const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }

	if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) return end()
	if (snake.some(s => s.x === head.x && s.y === head.y)) return end()

	snake.unshift(head)
	if (head.x === food.x && head.y === food.y) {
		score.value += 10
		placeFood()
	} else {
		snake.pop()
	}
	draw()
}

function end() {
	clearInterval(loopTimer); loopTimer = null
	status.value = 'over'
	draw()
	submitScore(score.value)
}

function start() {
	saveError.value = null
	reset()
	status.value = 'playing'
	draw()
	loopTimer = setInterval(step, TICK_MS)
	nextTick(() => canvasRef.value?.focus())
}

// ── Rendering ────────────────────────────────────────────────────────
function draw() {
	const cv = canvasRef.value
	if (!cv) return
	const ctx = cv.getContext('2d')

	// Background with subtle grid
	ctx.fillStyle = '#05111f'
	ctx.fillRect(0, 0, WIDTH, HEIGHT)
	ctx.strokeStyle = 'rgba(0, 180, 216, 0.08)'
	ctx.lineWidth = 1
	for (let x = 0; x <= COLS; x++) {
		ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, HEIGHT); ctx.stroke()
	}
	for (let y = 0; y <= ROWS; y++) {
		ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(WIDTH, y * CELL); ctx.stroke()
	}

	// Food (pulsing)
	const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 180)
	ctx.fillStyle = `rgba(210, 50, 60, ${0.65 + 0.35 * pulse})`
	ctx.beginPath()
	ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2)
	ctx.fill()

	// Snake
	snake.forEach((s, i) => {
		const t = i / snake.length
		ctx.fillStyle = i === 0 ? '#3ad17a' : `rgba(58, 209, 122, ${1 - t * 0.55})`
		ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2)
	})

	if (status.value === 'over') {
		ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
		ctx.fillRect(0, 0, WIDTH, HEIGHT)
		ctx.fillStyle = '#f2c43b'
		ctx.font = 'bold 36px Impact, sans-serif'
		ctx.textAlign = 'center'
		ctx.fillText('GAME OVER', WIDTH / 2, HEIGHT / 2 - 12)
		ctx.fillStyle = '#00b4d8'
		ctx.font = 'bold 20px Arial, sans-serif'
		ctx.fillText(`Score: ${score.value}`, WIDTH / 2, HEIGHT / 2 + 20)
	} else if (status.value === 'idle') {
		ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
		ctx.fillRect(0, 0, WIDTH, HEIGHT)
		ctx.fillStyle = '#00b4d8'
		ctx.font = 'bold 28px Impact, sans-serif'
		ctx.textAlign = 'center'
		ctx.fillText('PRESS START', WIDTH / 2, HEIGHT / 2 - 6)
		ctx.fillStyle = '#ddd'
		ctx.font = '14px Arial, sans-serif'
		ctx.fillText('Arrow keys or WASD to move', WIDTH / 2, HEIGHT / 2 + 22)
	}
}

// ── Input ────────────────────────────────────────────────────────────
function onKey(e) {
	if (status.value !== 'playing') {
		if (e.key === 'Enter' || e.key === ' ') { start(); e.preventDefault() }
		return
	}
	const k = e.key
	if (k === 'ArrowUp'    || k === 'w' || k === 'W') { nextDir = { x: 0, y: -1 }; e.preventDefault() }
	else if (k === 'ArrowDown'  || k === 's' || k === 'S') { nextDir = { x: 0, y:  1 }; e.preventDefault() }
	else if (k === 'ArrowLeft'  || k === 'a' || k === 'A') { nextDir = { x: -1, y: 0 }; e.preventDefault() }
	else if (k === 'ArrowRight' || k === 'd' || k === 'D') { nextDir = { x:  1, y: 0 }; e.preventDefault() }
}

// ── Lifecycle ────────────────────────────────────────────────────────
onMounted(() => {
	openModal()
	reset()
	draw()
	loadScores()
	window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
	closeModal()
	if (loopTimer) clearInterval(loopTimer)
	window.removeEventListener('keydown', onKey)
})
</script>

<template>
	<Teleport to="body">
		<div class="arc-overlay" @click.self="$emit('close')">
			<div class="arc-panel">
				<div class="arc-header">
					<div class="arc-header-left">
						<span class="arc-icon">🕹️</span>
						<span class="arc-title">Snake Arcade</span>
						<span class="arc-score">Score: <b>{{ score }}</b></span>
						<span class="arc-best" v-if="personalBest > 0">Your best: <b>{{ personalBest }}</b></span>
					</div>
					<button class="arc-close" @click="$emit('close')" aria-label="Close">✕</button>
				</div>

				<div class="arc-body">
					<div class="arc-stage">
						<canvas
							ref="canvasRef"
							:width="WIDTH"
							:height="HEIGHT"
							class="arc-canvas"
							tabindex="0"
						/>
						<div class="arc-controls">
							<button v-if="status !== 'playing'" class="arc-btn" @click="start">
								{{ status === 'over' ? 'Play Again' : 'Start' }}
							</button>
							<span v-else class="arc-hint">Arrow keys / WASD</span>
							<span v-if="saveError" class="arc-err">{{ saveError }}</span>
						</div>
					</div>

					<div class="arc-leaderboards">
						<div class="arc-today">
							<div class="arc-lb-heading">Today's top score</div>
							<div v-if="loadingScores" class="arc-today-line arc-today-muted">Loading</div>
							<div v-else-if="!topScoreToday" class="arc-today-line arc-today-muted">None yet</div>
							<div
								v-else
								class="arc-today-line"
								:class="{ 'is-mine': topScoreToday.PlayerEmail === avatarStore.avaEmail }"
							>
								<span class="arc-today-name">{{ topScoreToday.PlayerName }}</span>
								<span class="arc-today-pts">{{ topScoreToday.Score }}</span>
							</div>
						</div>
						<div class="arc-scores-section arc-scores-section--alltime">
							<div class="arc-lb-heading">All-time high scores</div>
							<div v-if="loadingScores" class="arc-scores-empty">Loading…</div>
							<div v-else-if="!sortedScores.length" class="arc-scores-empty">
								No scores yet — be the first!
							</div>
							<ol v-else class="arc-scores-list">
								<li
									v-for="(s, i) in sortedScores"
									:key="`a-${s.Id}`"
									:class="{ 'is-mine': s.PlayerEmail === avatarStore.avaEmail }"
								>
									<span class="arc-rank">{{ i + 1 }}</span>
									<span class="arc-name">{{ s.PlayerName }}</span>
									<span class="arc-pts">{{ s.Score }}</span>
								</li>
							</ol>
						</div>
					</div>
				</div>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.arc-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.78);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 590;
	backdrop-filter: blur(4px);
}
.arc-panel {
	width: min(58rem, 96vw);
	max-height: 92vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.875rem;
	box-shadow: 0 20px 80px rgba(0, 0, 0, 0.7);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.arc-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.75rem 1.1rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
}
.arc-header-left { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; }
.arc-icon  { font-size: 1.2rem; }
.arc-title { font-weight: 700; color: var(--color-t1); font-size: 1rem; }
.arc-score, .arc-best { font-size: 0.82rem; color: var(--color-tm); }
.arc-score b, .arc-best b { color: var(--color-accent); font-weight: 700; }
.arc-close {
	background: none; border: none; color: var(--color-tm);
	font-size: 1rem; cursor: pointer; padding: 0.25rem 0.5rem;
	border-radius: 0.25rem; line-height: 1;
}
.arc-close:hover { color: var(--color-t1); background: rgba(255,255,255,0.06); }

.arc-body {
	display: flex;
	gap: 1rem;
	padding: 1rem;
	min-height: 0;
}
.arc-stage {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	align-items: center;
}
.arc-canvas {
	border: 2px solid var(--color-brd);
	border-radius: 0.5rem;
	background: #05111f;
	image-rendering: pixelated;
	outline: none;
	max-width: 100%;
	height: auto;
}
.arc-canvas:focus { border-color: var(--color-accent); }
.arc-controls {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	min-height: 2rem;
}
.arc-btn {
	background: var(--color-accent);
	border: none;
	border-radius: 0.4375rem;
	color: #fff;
	font-size: 0.85rem;
	font-weight: 700;
	padding: 0.5rem 1.2rem;
	cursor: pointer;
	transition: background 0.15s;
}
.arc-btn:hover { background: var(--color-accent2); }
.arc-hint { font-size: 0.78rem; color: var(--color-tm); }
.arc-err  { font-size: 0.78rem; color: #c04040; }

.arc-leaderboards {
	flex: 1;
	min-width: 14rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd);
	border-radius: 0.5rem;
	padding: 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.35rem;
	overflow: hidden;
	min-height: 0;
}
.arc-today {
	flex: 0 0 auto;
	line-height: 1.25;
	display: flex;
	flex-direction: column;
	align-items: stretch;
}
/* Leaderboard headings — small-caps + inverse pill (both sections) */
.arc-lb-heading {
	width: fit-content;
	max-width: 100%;
	align-self: flex-start;
	font-size: 0.72rem;
	font-weight: 700;
	font-variant: all-small-caps;
	letter-spacing: 0.06em;
	line-height: 1.2;
	color: var(--color-card);
	background: var(--color-t1);
	padding: 0.2rem 0.45rem;
	border-radius: 0.28rem;
	margin-bottom: 0.32rem;
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.arc-today-line {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5rem;
	font-size: 0.82rem;
	color: var(--color-t1);
	padding: 0.1rem 0;
}
.arc-today-line.is-mine {
	background: rgba(0, 180, 216, 0.09);
	margin: 0 -0.25rem;
	padding-left: 0.25rem;
	padding-right: 0.25rem;
	border-radius: 0.25rem;
}
.arc-today-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}
.arc-today-pts {
	font-weight: 700;
	color: var(--color-accent);
	flex-shrink: 0;
}
.arc-today-muted {
	color: var(--color-tm);
	font-style: italic;
	font-size: 0.8rem;
}
.arc-scores-section {
	display: flex;
	flex-direction: column;
	min-height: 0;
	flex: 1;
}
.arc-scores-section--alltime {
	flex: 1;
	border-top: 1px solid var(--color-brd);
	padding-top: 0.45rem;
	margin-top: 0.15rem;
}
.arc-scores-empty {
	color: var(--color-tm);
	font-size: 0.82rem;
	font-style: italic;
}
.arc-scores-list {
	list-style: none;
	margin: 0; padding: 0;
	overflow-y: auto;
	flex: 1;
}
.arc-scores-list li {
	display: grid;
	grid-template-columns: 1.6rem 1fr auto;
	gap: 0.5rem;
	align-items: center;
	padding: 0.3rem 0.25rem;
	font-size: 0.82rem;
	color: var(--color-t1);
	border-bottom: 1px solid var(--color-brd);
}
.arc-scores-list li:last-child { border-bottom: none; }
.arc-scores-list li.is-mine { background: rgba(0, 180, 216, 0.09); }
.arc-rank { color: var(--color-tm); font-weight: 700; text-align: right; }
.arc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.arc-pts  { color: var(--color-accent); font-weight: 700; }

@media (max-width: 780px) {
	.arc-body { flex-direction: column; }
	.arc-leaderboards { min-width: 0; }
}
</style>
