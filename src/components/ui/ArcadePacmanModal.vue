<script setup>
/**
 * ArcadePacmanModal — "AVA-Man" breakroom pac-man game; leaderboard via ListApi.
 *
 * Same score table as Snake: `public.arcade_scores` with Title = 'AVA-Man'.
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import ListApi from '@/api/ListApi.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()
import { openModal, closeModal } from '@/composables/useModalStack.js'
import { config } from '@/config/configuration.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useTheme } from '@/composables/useTheme.js'

const { isDark } = useTheme()

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
const COLS = 21
const ROWS = 23
const CELL = 24
const WIDTH  = COLS * CELL
const HEIGHT = ROWS * CELL
const TICK_MS = 230

// ── Maze layout ──────────────────────────────────────────────────────
// 1=wall, 0=dot, 2=empty(no dot), 3=power pellet, 4=ghost house
const MAZE_TEMPLATE = [
	[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
	[1,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,1],
	[1,0,1,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1],
	[1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
	[1,0,1,0,1,1,1,0,1,1,1,1,1,0,1,1,1,0,1,0,1],
	[1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1],
	[1,0,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,0,1],
	[2,2,0,0,1,0,0,0,0,2,2,2,0,0,0,0,1,0,0,2,2],
	[1,0,1,0,1,1,1,0,1,4,4,4,1,0,1,1,1,0,1,0,1],
	[1,0,1,0,0,0,0,0,1,4,4,4,1,0,0,0,0,0,1,0,1],
	[1,0,1,0,1,1,1,0,1,1,1,1,1,0,1,1,1,0,1,0,1],
	[2,2,0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,2,2],
	[1,0,1,0,1,0,1,1,1,0,1,0,1,1,1,0,1,0,1,0,1],
	[1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,1],
	[1,0,1,0,1,1,1,0,1,1,1,1,1,0,1,1,1,0,1,0,1],
	[1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
	[1,0,1,1,1,0,1,1,1,0,1,0,1,1,1,0,1,1,1,0,1],
	[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
	[1,0,1,0,1,1,1,0,1,1,1,1,1,0,1,1,1,0,1,0,1],
	[1,3,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,3,1],
	[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
	// tunnel rows (7, 11) wrap left↔right via wrapCol logic
]

// ── State ────────────────────────────────────────────────────────────
const canvasRef = ref(null)
const status    = ref('idle')  // 'idle' | 'playing' | 'over' | 'won'
const score     = ref(0)
const lives     = ref(3)
const level     = ref(1)
const highScores = ref([])
const loadingScores = ref(true)
const saveError  = ref(null)

let maze, player, ghosts, dir, nextDir, loopTimer, dotsLeft
let powerTimer = null
let mouthOpen = true
let mouthFrame = 0
let rafId = null
let lastTickTime = 0
let prevPlayer = { r: 17, c: 10 }
let prevGhostPos = []

const GHOST_COLORS_DARK  = ['#ff4455', '#ff88cc', '#44ddff', '#ffbb44']
const GHOST_COLORS_LIGHT = ['#cc2233', '#cc5599', '#2299bb', '#cc8822']

// Theme-aware color palette — resolved each frame from isDark
function palette() {
	const dark = isDark.value
	return {
		bg:        dark ? '#0a0a2e' : '#e0e4f0',
		wallOuter: dark ? '#1e3a6e' : '#5570a0',
		wallInner: dark ? '#2a55aa' : '#7088bb',
		dot:       dark ? '#ffdd44' : '#bb7700',
		pellet:    dark ? '#ffdd44' : '#bb7700',
		player:    dark ? '#00ccee' : '#0077aa',
		scared:    dark ? '#6644dd' : '#5533bb',
		overlay:   dark ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.75)',
		title:     dark ? '#00ccee' : '#0077aa',
		subtitle:  dark ? '#ffdd44' : '#bb7700',
		hint:      dark ? '#cccccc' : '#444444',
		gameover:  '#ff4444',
		ghosts:    dark ? GHOST_COLORS_DARK : GHOST_COLORS_LIGHT,
	}
}

const sortedScores = computed(() =>
	[...highScores.value].sort((a, b) => b.Score - a.Score).slice(0, 10)
)

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
			$filter: "Title eq 'AVA-Man'",
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
		console.warn('[Arcade] AVA-Man score load failed:', err.message)
	} finally {
		loadingScores.value = false
	}
}

async function submitScore(finalScore) {
	if (finalScore <= 0) return
	try {
		await listApi.createListItem({
			Title: 'AVA-Man',
			PlayerName: avatarStore.displayName || 'Anonymous',
			PlayerEmail: avatarStore.avaEmail || '',
			Score: finalScore,
		})
		await loadScores()
	} catch (err) {
		saveError.value = 'Score could not be saved.'
		console.warn('[Arcade] AVA-Man score save failed:', err.message)
	}
}

// ── Maze helpers ─────────────────────────────────────────────────────
function cloneMaze() {
	return MAZE_TEMPLATE.map(row => [...row])
}

function isWall(r, c) {
	if (r < 0 || r >= ROWS - 2 || c < 0 || c >= COLS) return true
	const cell = maze[r]?.[c]
	return cell === 1
}

function isGhostHouse(r, c) {
	if (r < 0 || r >= ROWS - 2) return false
	return maze[r]?.[c] === 4
}

function canMove(r, c) {
	// Tunnel wrap
	if (c < 0 || c >= COLS) return true
	if (r < 0 || r >= ROWS - 2) return false
	const cell = maze[r][c]
	return cell !== 1
}

function wrapCol(c) {
	if (c < 0) return COLS - 1
	if (c >= COLS) return 0
	return c
}

// ── Ghost AI ─────────────────────────────────────────────────────────
function createGhosts() {
	return [
		{ r: 9, c: 9,  dr: 0, dc: -1, color: 0, scared: false, eaten: false, home: true },
		{ r: 9, c: 10, dr: 0, dc: 0,  color: 1, scared: false, eaten: false, home: true },
		{ r: 9, c: 11, dr: 0, dc: 1,  color: 2, scared: false, eaten: false, home: true },
		{ r: 9, c: 10, dr: 0, dc: 0,  color: 3, scared: false, eaten: false, home: true, delay: 3 },
	]
}

function ghostStep(ghost, idx) {
	if (ghost.delay && ghost.delay > 0) { ghost.delay--; return }

	// Leave ghost house
	if (ghost.home) {
		ghost.r = 7; ghost.c = 10; ghost.home = false
		ghost.dr = -1; ghost.dc = 0
		return
	}

	if (ghost.eaten) {
		// Move toward ghost house entrance — double speed
		const tr = 8, tc = 10
		for (let i = 0; i < 2; i++) {
			moveToward(ghost, tr, tc)
			if (ghost.r === tr && ghost.c === tc) {
				ghost.eaten = false; ghost.scared = false; ghost.home = false
				ghost.r = 9; ghost.c = 10
				break
			}
		}
		return
	}

	const choices = []
	const dirs = [[-1,0],[1,0],[0,-1],[0,1]]
	for (const [dr, dc] of dirs) {
		// No reversing
		if (dr === -ghost.dr && dc === -ghost.dc) continue
		const nr = ghost.r + dr
		const nc = wrapCol(ghost.c + dc)
		if (canMove(nr, nc) && !isGhostHouse(nr, nc)) {
			choices.push({ dr, dc, nr, nc })
		}
	}

	if (choices.length === 0) {
		// Dead end — reverse
		ghost.dr = -ghost.dr; ghost.dc = -ghost.dc
		const nr = ghost.r + ghost.dr
		const nc = wrapCol(ghost.c + ghost.dc)
		if (canMove(nr, nc)) { ghost.r = nr; ghost.c = nc }
		return
	}

	if (ghost.scared) {
		// Random when scared
		const pick = choices[Math.floor(Math.random() * choices.length)]
		ghost.dr = pick.dr; ghost.dc = pick.dc
		ghost.r = pick.nr; ghost.c = pick.nc
		return
	}

	// Chase: target player (Blinky-style for all, with slight variation)
	let tr = player.r, tc = player.c
	if (idx === 1) { tr = player.r + dir.r * 4; tc = player.c + dir.c * 4 } // Pinky: ahead of player
	if (idx === 3) { // Clyde: scatter if close
		const dist = Math.abs(ghost.r - player.r) + Math.abs(ghost.c - player.c)
		if (dist < 8) { tr = ROWS - 3; tc = 0 }
	}

	let best = null, bestDist = Infinity
	for (const ch of choices) {
		const d = Math.abs(ch.nr - tr) + Math.abs(ch.nc - tc)
		if (d < bestDist) { bestDist = d; best = ch }
	}
	if (best) {
		ghost.dr = best.dr; ghost.dc = best.dc
		ghost.r = best.nr; ghost.c = best.nc
	}
}

function moveToward(ghost, tr, tc) {
	const dirs = [[-1,0],[1,0],[0,-1],[0,1]]
	let best = null, bestDist = Infinity
	for (const [dr, dc] of dirs) {
		const nr = ghost.r + dr
		const nc = wrapCol(ghost.c + dc)
		if (canMove(nr, nc) || isGhostHouse(nr, nc)) {
			const d = Math.abs(nr - tr) + Math.abs(nc - tc)
			if (d < bestDist) { bestDist = d; best = { dr, dc, nr, nc } }
		}
	}
	if (best) { ghost.r = best.nr; ghost.c = best.nc; ghost.dr = best.dr; ghost.dc = best.dc }
}

// ── Game loop ────────────────────────────────────────────────────────
function reset() {
	maze = cloneMaze()
	player = { r: 17, c: 10 }
	dir = { r: 0, c: -1 }
	nextDir = { r: 0, c: -1 }
	ghosts = createGhosts()
	score.value = 0
	lives.value = 3
	level.value = 1
	dotsLeft = 0
	mouthOpen = true
	mouthFrame = 0
	if (powerTimer) { clearTimeout(powerTimer); powerTimer = null }

	// Count dots
	for (let r = 0; r < maze.length; r++) {
		for (let c = 0; c < COLS; c++) {
			if (maze[r][c] === 0 || maze[r][c] === 3) dotsLeft++
		}
	}
}

function resetPositions() {
	player.r = 17; player.c = 10
	dir = { r: 0, c: -1 }; nextDir = { r: 0, c: -1 }
	ghosts = createGhosts()
	if (powerTimer) { clearTimeout(powerTimer); powerTimer = null }
}

function snapPrev() {
	prevPlayer = { r: player.r, c: player.c }
	prevGhostPos = ghosts.map(g => ({ r: g.r, c: g.c }))
}

function step() {
	mouthFrame++
	mouthOpen = mouthFrame % 3 !== 0

	// Save previous positions for smooth interpolation
	snapPrev()
	lastTickTime = performance.now()

	// Try next dir first
	const tryR = player.r + nextDir.r
	const tryC = wrapCol(player.c + nextDir.c)
	if (canMove(tryR, tryC) && !isGhostHouse(tryR, tryC)) {
		dir = { ...nextDir }
	}

	const nr = player.r + dir.r
	const nc = wrapCol(player.c + dir.c)
	if (canMove(nr, nc) && !isGhostHouse(nr, nc)) {
		player.r = nr; player.c = nc
	}

	// Eat dot
	if (player.r >= 0 && player.r < maze.length && player.c >= 0 && player.c < COLS) {
		const cell = maze[player.r][player.c]
		if (cell === 0) {
			maze[player.r][player.c] = 2
			score.value += 10
			dotsLeft--
		} else if (cell === 3) {
			maze[player.r][player.c] = 2
			score.value += 50
			dotsLeft--
			activatePower()
		}
	}

	// Move ghosts
	ghosts.forEach((gh, i) => ghostStep(gh, i))

	// Check ghost collisions
	for (const gh of ghosts) {
		if (gh.r === player.r && gh.c === player.c) {
			if (gh.scared && !gh.eaten) {
				gh.eaten = true
				score.value += 200
			} else if (!gh.eaten) {
				lives.value--
				if (lives.value <= 0) return end()
				resetPositions()
				snapPrev()
				return
			}
		}
	}

	// Win check
	if (dotsLeft <= 0) {
		level.value++
		startLevel()
		snapPrev()
	}
}

function activatePower() {
	if (powerTimer) clearTimeout(powerTimer)
	for (const gh of ghosts) {
		if (!gh.eaten) gh.scared = true
	}
	powerTimer = setTimeout(() => {
		for (const gh of ghosts) gh.scared = false
		powerTimer = null
	}, 6000)
}

function startLevel() {
	maze = cloneMaze()
	dotsLeft = 0
	for (let r = 0; r < maze.length; r++) {
		for (let c = 0; c < COLS; c++) {
			if (maze[r][c] === 0 || maze[r][c] === 3) dotsLeft++
		}
	}
	resetPositions()
}

function end() {
	clearInterval(loopTimer); loopTimer = null
	if (rafId) { cancelAnimationFrame(rafId); rafId = null }
	if (powerTimer) { clearTimeout(powerTimer); powerTimer = null }
	status.value = 'over'
	draw(1)
	submitScore(score.value)
}

function renderLoop() {
	const t = lastTickTime ? Math.min((performance.now() - lastTickTime) / TICK_MS, 1) : 1
	draw(t)
	if (status.value === 'playing') rafId = requestAnimationFrame(renderLoop)
}

function start() {
	saveError.value = null
	reset()
	snapPrev()
	status.value = 'playing'
	lastTickTime = performance.now()
	loopTimer = setInterval(step, TICK_MS)
	rafId = requestAnimationFrame(renderLoop)
	nextTick(() => canvasRef.value?.focus())
}

// ── Rendering ────────────────────────────────────────────────────────
function lerpCell(prev, curr, t) {
	// Don't interpolate wraps / teleports
	if (Math.abs(curr - prev) > 2) return curr
	return prev + (curr - prev) * t
}

function draw(t = 1) {
	const cv = canvasRef.value
	if (!cv) return
	const ctx = cv.getContext('2d')

	const P = palette()

	// Background
	ctx.fillStyle = P.bg
	ctx.fillRect(0, 0, WIDTH, HEIGHT)

	const mazeRows = maze.length

	// Draw maze
	for (let r = 0; r < mazeRows; r++) {
		for (let c = 0; c < COLS; c++) {
			const cell = maze[r][c]
			const x = c * CELL, y = r * CELL

			if (cell === 1) {
				ctx.fillStyle = P.wallOuter
				ctx.fillRect(x, y, CELL, CELL)
				ctx.fillStyle = P.wallInner
				ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4)
			} else if (cell === 0) {
				ctx.fillStyle = P.dot
				ctx.beginPath()
				ctx.arc(x + CELL / 2, y + CELL / 2, 3, 0, Math.PI * 2)
				ctx.fill()
			} else if (cell === 3) {
				const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 200)
				ctx.globalAlpha = pulse
				ctx.fillStyle = P.pellet
				ctx.beginPath()
				ctx.arc(x + CELL / 2, y + CELL / 2, 7, 0, Math.PI * 2)
				ctx.fill()
				ctx.globalAlpha = 1
			}
		}
	}

	// Draw player (AVA-Man) — smoothly interpolated
	const drawPC = lerpCell(prevPlayer.c, player.c, t)
	const drawPR = lerpCell(prevPlayer.r, player.r, t)
	const px = drawPC * CELL + CELL / 2
	const py = drawPR * CELL + CELL / 2
	const angle = Math.atan2(dir.r, dir.c)
	const mouthAngle = mouthOpen ? 0.35 : 0.05

	ctx.fillStyle = P.player
	ctx.beginPath()
	ctx.arc(px, py, CELL / 2 - 1, angle + mouthAngle * Math.PI, angle - mouthAngle * Math.PI + 2 * Math.PI)
	ctx.lineTo(px, py)
	ctx.closePath()
	ctx.fill()

	// Draw ghosts — smoothly interpolated
	for (let gi = 0; gi < ghosts.length; gi++) {
		const gh = ghosts[gi]
		if (gh.home && gh.delay && gh.delay > 0) continue
		const prev = prevGhostPos[gi]
		const drawGC = prev ? lerpCell(prev.c, gh.c, t) : gh.c
		const drawGR = prev ? lerpCell(prev.r, gh.r, t) : gh.r
		const gx = drawGC * CELL + CELL / 2
		const gy = drawGR * CELL + CELL / 2
		const radius = CELL / 2 - 1

		if (gh.eaten) {
			drawGhostEyes(ctx, gx, gy, gh)
			continue
		}

		ctx.fillStyle = gh.scared ? P.scared : P.ghosts[gh.color]
		ctx.beginPath()
		ctx.arc(gx, gy - 2, radius, Math.PI, 0, false)
		ctx.lineTo(gx + radius, gy + radius - 2)
		const waveCnt = 3
		const waveW = (radius * 2) / waveCnt
		for (let i = 0; i < waveCnt; i++) {
			const wx = gx + radius - i * waveW
			ctx.quadraticCurveTo(wx - waveW * 0.25, gy + radius + 3, wx - waveW * 0.5, gy + radius - 2)
			ctx.quadraticCurveTo(wx - waveW * 0.75, gy + radius - 7, wx - waveW, gy + radius - 2)
		}
		ctx.closePath()
		ctx.fill()

		drawGhostEyes(ctx, gx, gy, gh)
	}

	// Lives display
	for (let i = 0; i < lives.value; i++) {
		ctx.fillStyle = P.player
		ctx.beginPath()
		ctx.arc(16 + i * 22, HEIGHT - 10, 7, 0.25 * Math.PI, 1.75 * Math.PI)
		ctx.lineTo(16 + i * 22, HEIGHT - 10)
		ctx.closePath()
		ctx.fill()
	}

	// Level display
	ctx.fillStyle = P.subtitle
	ctx.font = 'bold 11px Arial, sans-serif'
	ctx.textAlign = 'right'
	ctx.fillText(`LVL ${level.value}`, WIDTH - 8, HEIGHT - 5)

	// Overlays
	if (status.value === 'over') {
		ctx.fillStyle = P.overlay
		ctx.fillRect(0, 0, WIDTH, HEIGHT)
		ctx.fillStyle = P.gameover
		ctx.font = 'bold 32px Impact, sans-serif'
		ctx.textAlign = 'center'
		ctx.fillText('GAME OVER', WIDTH / 2, HEIGHT / 2 - 12)
		ctx.fillStyle = P.title
		ctx.font = 'bold 18px Arial, sans-serif'
		ctx.fillText(`Score: ${score.value}`, WIDTH / 2, HEIGHT / 2 + 16)
	} else if (status.value === 'idle') {
		ctx.fillStyle = P.overlay
		ctx.fillRect(0, 0, WIDTH, HEIGHT)
		ctx.fillStyle = P.title
		ctx.font = 'bold 26px Impact, sans-serif'
		ctx.textAlign = 'center'
		ctx.fillText('AVA-MAN', WIDTH / 2, HEIGHT / 2 - 20)
		ctx.fillStyle = P.subtitle
		ctx.font = 'bold 16px Impact, sans-serif'
		ctx.fillText('PRESS START', WIDTH / 2, HEIGHT / 2 + 6)
		ctx.fillStyle = P.hint
		ctx.font = '12px Arial, sans-serif'
		ctx.fillText('Arrow keys / WASD', WIDTH / 2, HEIGHT / 2 + 26)
	}
}

function drawGhostEyes(ctx, gx, gy, ghost) {
	const eyeOff = 4
	// White
	ctx.fillStyle = '#fff'
	ctx.beginPath()
	ctx.ellipse(gx - eyeOff, gy - 3, 4, 5.5, 0, 0, Math.PI * 2)
	ctx.fill()
	ctx.beginPath()
	ctx.ellipse(gx + eyeOff, gy - 3, 4, 5.5, 0, 0, Math.PI * 2)
	ctx.fill()
	// Pupil — look toward player
	const pdx = Math.sign(player.c - ghost.c)
	const pdy = Math.sign(player.r - ghost.r)
	ctx.fillStyle = '#1122dd'
	ctx.beginPath()
	ctx.arc(gx - eyeOff + pdx * 2, gy - 3 + pdy * 2, 2.5, 0, Math.PI * 2)
	ctx.fill()
	ctx.beginPath()
	ctx.arc(gx + eyeOff + pdx * 2, gy - 3 + pdy * 2, 2.5, 0, Math.PI * 2)
	ctx.fill()
}

// ── Input ────────────────────────────────────────────────────────────
function onKey(e) {
	if (status.value !== 'playing') {
		if (e.key === 'Enter' || e.key === ' ') { start(); e.preventDefault() }
		return
	}
	const k = e.key
	if (k === 'ArrowUp'    || k === 'w' || k === 'W') { nextDir = { r: -1, c: 0 }; e.preventDefault() }
	else if (k === 'ArrowDown'  || k === 's' || k === 'S') { nextDir = { r: 1, c: 0 };  e.preventDefault() }
	else if (k === 'ArrowLeft'  || k === 'a' || k === 'A') { nextDir = { r: 0, c: -1 }; e.preventDefault() }
	else if (k === 'ArrowRight' || k === 'd' || k === 'D') { nextDir = { r: 0, c: 1 };  e.preventDefault() }
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
	if (rafId) cancelAnimationFrame(rafId)
	if (powerTimer) clearTimeout(powerTimer)
	window.removeEventListener('keydown', onKey)
})
</script>

<template>
	<Teleport to="body">
		<div class="pac-overlay" @click.self="$emit('close')">
			<div class="pac-panel">
				<div class="pac-header">
					<div class="pac-header-left">
						<span class="pac-icon">👾</span>
						<span class="pac-title">AVA-Man</span>
						<span class="pac-score">Score: <b>{{ score }}</b></span>
						<span class="pac-best" v-if="personalBest > 0">Your best: <b>{{ personalBest }}</b></span>
					</div>
					<button class="pac-close" @click="$emit('close')" aria-label="Close">✕</button>
				</div>

				<div class="pac-body">
					<div class="pac-stage">
						<canvas
							ref="canvasRef"
							:width="WIDTH"
							:height="HEIGHT"
							class="pac-canvas"
							tabindex="0"
						/>
						<div class="pac-controls">
							<button v-if="status !== 'playing'" class="pac-btn" @click="start">
								{{ status === 'over' ? 'Play Again' : 'Start' }}
							</button>
							<span v-else class="pac-hint">Arrow keys / WASD</span>
							<span v-if="saveError" class="pac-err">{{ saveError }}</span>
						</div>
					</div>

					<div class="pac-leaderboards">
						<div class="pac-today">
							<div class="pac-lb-heading">Today's top score</div>
							<div v-if="loadingScores" class="pac-today-line pac-today-muted">Loading</div>
							<div v-else-if="!topScoreToday" class="pac-today-line pac-today-muted">None yet</div>
							<div
								v-else
								class="pac-today-line"
								:class="{ 'is-mine': topScoreToday.PlayerEmail === avatarStore.avaEmail }"
							>
								<span class="pac-today-name">{{ topScoreToday.PlayerName }}</span>
								<span class="pac-today-pts">{{ topScoreToday.Score }}</span>
							</div>
						</div>
						<div class="pac-scores-section pac-scores-section--alltime">
							<div class="pac-lb-heading">All-time high scores</div>
							<div v-if="loadingScores" class="pac-scores-empty">Loading...</div>
							<div v-else-if="!sortedScores.length" class="pac-scores-empty">
								No scores yet — be the first!
							</div>
							<ol v-else class="pac-scores-list">
								<li
									v-for="(s, i) in sortedScores"
									:key="`a-${s.Id}`"
									:class="{ 'is-mine': s.PlayerEmail === avatarStore.avaEmail }"
								>
									<span class="pac-rank">{{ i + 1 }}</span>
									<span class="pac-name">{{ s.PlayerName }}</span>
									<span class="pac-pts">{{ s.Score }}</span>
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
.pac-overlay {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.78);
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 590;
	backdrop-filter: blur(4px);
}
.pac-panel {
	width: min(62rem, 96vw);
	max-height: 92vh;
	background: var(--color-card);
	border: 1px solid var(--color-brd);
	border-radius: 0.875rem;
	box-shadow: 0 20px 80px rgba(0, 0, 0, 0.7);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}
.pac-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.75rem 1.1rem;
	border-bottom: 1px solid var(--color-brd);
	background: var(--color-card2);
}
.pac-header-left { display: flex; align-items: center; gap: 0.9rem; flex-wrap: wrap; }
.pac-icon  { font-size: 1.2rem; }
.pac-title { font-weight: 700; color: var(--color-t1); font-size: 1rem; }
.pac-score, .pac-best { font-size: 0.82rem; color: var(--color-tm); }
.pac-score b, .pac-best b { color: var(--color-accent); font-weight: 700; }
.pac-close {
	background: none; border: none; color: var(--color-tm);
	font-size: 1rem; cursor: pointer; padding: 0.25rem 0.5rem;
	border-radius: 0.25rem; line-height: 1;
}
.pac-close:hover { color: var(--color-t1); background: rgba(255,255,255,0.06); }

.pac-body {
	display: flex;
	gap: 1rem;
	padding: 1rem;
	min-height: 0;
}
.pac-stage {
	display: flex;
	flex-direction: column;
	gap: 0.6rem;
	align-items: center;
}
.pac-canvas {
	border: 2px solid var(--color-brd);
	border-radius: 0.5rem;
	background: var(--color-card);
	image-rendering: pixelated;
	outline: none;
	max-width: 100%;
	height: auto;
}
.pac-canvas:focus { border-color: var(--color-accent); }
.pac-controls {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	min-height: 2rem;
}
.pac-btn {
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
.pac-btn:hover { background: var(--color-accent2); }
.pac-hint { font-size: 0.78rem; color: var(--color-tm); }
.pac-err  { font-size: 0.78rem; color: #c04040; }

.pac-leaderboards {
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
.pac-today {
	flex: 0 0 auto;
	line-height: 1.25;
	display: flex;
	flex-direction: column;
	align-items: stretch;
}
.pac-lb-heading {
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
.pac-today-line {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.5rem;
	font-size: 0.82rem;
	color: var(--color-t1);
	padding: 0.1rem 0;
}
.pac-today-line.is-mine {
	background: rgba(0, 180, 216, 0.09);
	margin: 0 -0.25rem;
	padding-left: 0.25rem;
	padding-right: 0.25rem;
	border-radius: 0.25rem;
}
.pac-today-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}
.pac-today-pts {
	font-weight: 700;
	color: var(--color-accent);
	flex-shrink: 0;
}
.pac-today-muted {
	color: var(--color-tm);
	font-style: italic;
	font-size: 0.8rem;
}
.pac-scores-section {
	display: flex;
	flex-direction: column;
	min-height: 0;
	flex: 1;
}
.pac-scores-section--alltime {
	flex: 1;
	border-top: 1px solid var(--color-brd);
	padding-top: 0.45rem;
	margin-top: 0.15rem;
}
.pac-scores-empty {
	color: var(--color-tm);
	font-size: 0.82rem;
	font-style: italic;
}
.pac-scores-list {
	list-style: none;
	margin: 0; padding: 0;
	overflow-y: auto;
	flex: 1;
}
.pac-scores-list li {
	display: grid;
	grid-template-columns: 1.6rem 1fr auto;
	gap: 0.5rem;
	align-items: center;
	padding: 0.3rem 0.25rem;
	font-size: 0.82rem;
	color: var(--color-t1);
	border-bottom: 1px solid var(--color-brd);
}
.pac-scores-list li:last-child { border-bottom: none; }
.pac-scores-list li.is-mine { background: rgba(0, 180, 216, 0.09); }
.pac-rank { color: var(--color-tm); font-weight: 700; text-align: right; }
.pac-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pac-pts  { color: var(--color-accent); font-weight: 700; }

@media (max-width: 780px) {
	.pac-body { flex-direction: column; }
	.pac-leaderboards { min-width: 0; }
}
</style>
