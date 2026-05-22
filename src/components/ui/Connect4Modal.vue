<script setup>
/**
 * Connect4Modal — multiplayer Connect 4 with a lobby of concurrent games.
 *
 * Sync model: dumb-relay over the existing WS server (no Yjs, no auth needed).
 * Each game lives in the server's in-memory map keyed by gameId. Clients send
 * full game state on every move; server relays to all other subscribers.
 *
 * Two views inside the modal:
 *   - lobby: list of active games + "New game" button
 *   - game:  the actual board for one game, plus seat / spectator handling
 *
 * Player identity uses presenceStore.myUserId so dev users (no Supabase auth)
 * can play too.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

const emit = defineEmits(['close'])

const COLS = 7
const ROWS = 6

const presenceStore = usePresenceStore()
const avatarStore   = useAvatarStore()
const { emit: wsEmit, on: wsOn, off: wsOff, connected: wsConnected } = useRealtimeSocket()

const meId   = computed(() => String(presenceStore.myUserId || avatarStore.authUserId || 'me'))
const meName = computed(() => avatarStore.displayName || 'Anonymous')

// ── View state ────────────────────────────────────────────────────────
const view = ref('lobby')              // 'lobby' | 'game'
const lobbyGames = ref([])             // [{ id, players, winner, spectatorCount, isActive, createdAt }]
const currentGameId = ref(null)
const gameState = ref(_emptyState())

function _emptyState() {
	return {
		board: Array(COLS * ROWS).fill(null),
		turn: 'red',
		players: { red: null, yellow: null },
		winner: null,
		winningCells: [],
		lastMoveAt: 0,
	}
}

// ── Computed ──────────────────────────────────────────────────────────

const myColor = computed(() => {
	const p = gameState.value.players || {}
	if (p.red?.id === meId.value)    return 'red'
	if (p.yellow?.id === meId.value) return 'yellow'
	return null
})

const isMyTurn = computed(() =>
	!!myColor.value && gameState.value.turn === myColor.value && !gameState.value.winner,
)

const status = computed(() => {
	const s = gameState.value
	if (s.winner === 'draw') return "Draw — board's full"
	if (s.winner) {
		const winnerName = s.players?.[s.winner]?.name || s.winner
		return `${s.winner === 'red' ? '🔴' : '🟡'} ${winnerName} wins!`
	}
	if (!s.players?.red)    return 'Waiting for first player…'
	if (!s.players?.yellow) return 'Waiting for an opponent…'
	if (myColor.value && isMyTurn.value) return 'Your turn — pick a column'
	if (myColor.value)      return `${s.players[s.turn]?.name || s.turn}'s turn`
	return 'Spectating'
})

// Render top row first so high indices appear at the top of the grid.
const visualCells = computed(() => {
	const s = gameState.value
	const out = []
	for (let r = ROWS - 1; r >= 0; r--) {
		for (let c = 0; c < COLS; c++) {
			const idx = c * ROWS + r
			out.push({
				idx,
				col: c,
				val: s.board[idx],
				winning: (s.winningCells || []).includes(idx),
			})
		}
	}
	return out
})

// ── Network ────────────────────────────────────────────────────────────

function _push(stateOverride) {
	if (!currentGameId.value) return
	wsEmit('c4', {
		k: 'state',
		gameId: currentGameId.value,
		state: stateOverride || gameState.value,
	})
}

function onC4(payload) {
	if (!payload?.k) return
	if (payload.k === 'lobby') {
		lobbyGames.value = payload.games || []
		return
	}
	if (payload.k === 'state') {
		if (payload.gameId !== currentGameId.value) return
		gameState.value = payload.state || _emptyState()
		return
	}
	if (payload.k === 'created') {
		clearTimeout(_createTimer)
		creating.value = false
		currentGameId.value = payload.gameId
		view.value = 'game'
		return
	}
	if (payload.k === 'gone') {
		if (payload.gameId === currentGameId.value) {
			currentGameId.value = null
			gameState.value = _emptyState()
			view.value = 'lobby'
			wsEmit('c4', { k: 'lobby_join' })
		}
	}
}

// ── Game actions ───────────────────────────────────────────────────────

const creating = ref(false)
let _createTimer = null

function newGame() {
	if (!wsConnected.value) {
		window.dispatchEvent(new CustomEvent('ava-toast', {
			detail: { message: '⚠️ Not connected to the game server. Reconnecting…', type: 'warn' },
		}))
		return
	}
	creating.value = true
	wsEmit('c4', { k: 'create' })
	// Server should respond near-instantly. If we hear nothing in 3 s, show a hint.
	clearTimeout(_createTimer)
	_createTimer = setTimeout(() => {
		creating.value = false
		if (view.value === 'lobby') {
			window.dispatchEvent(new CustomEvent('ava-toast', {
				detail: {
					message: "⚠️ Server didn't respond. Restart the WS dev server (npm run dev:server) to pick up the latest handlers.",
					type: 'warn',
				},
			}))
		}
	}, 3000)
}

function joinGame(gameId) {
	currentGameId.value = gameId
	view.value = 'game'
	wsEmit('c4', { k: 'join', gameId })
	// Server will respond with 'state'. Auto-claim happens on state arrival via
	// the watcher below.
}

function _autoClaimSeatIfOpen() {
	if (!myColor.value) {
		const p = { ...(gameState.value.players || {}) }
		const me = { id: meId.value, name: meName.value }
		if (!p.red)         p.red    = me
		else if (!p.yellow) p.yellow = me
		else return
		const next = { ...gameState.value, players: p }
		gameState.value = next
		_push(next)
	}
}

function _vacateSeat() {
	const p = { ...(gameState.value.players || {}) }
	let changed = false
	if (p.red?.id    === meId.value) { p.red    = null; changed = true }
	if (p.yellow?.id === meId.value) { p.yellow = null; changed = true }
	if (!changed) return
	const next = { ...gameState.value, players: p }
	gameState.value = next
	_push(next)
}

function leaveGameToLobby() {
	if (!currentGameId.value) return
	_vacateSeat()
	wsEmit('c4', { k: 'leave', gameId: currentGameId.value })
	currentGameId.value = null
	gameState.value = _emptyState()
	view.value = 'lobby'
	wsEmit('c4', { k: 'lobby_join' })
}

function _findLowestEmptyRow(b, col) {
	for (let r = 0; r < ROWS; r++) {
		if (b[col * ROWS + r] === null) return r
	}
	return -1
}

function dropInColumn(col) {
	if (!isMyTurn.value) return
	const s = gameState.value
	const b = s.board.slice()
	const row = _findLowestEmptyRow(b, col)
	if (row === -1) return
	const color = myColor.value
	b[col * ROWS + row] = color
	const win = _detectWin(b, col, row, color)
	const draw = !win && b.every(c => c !== null)
	const next = {
		...s,
		board: b,
		turn: win || draw ? s.turn : (color === 'red' ? 'yellow' : 'red'),
		winner: win ? color : draw ? 'draw' : null,
		winningCells: win || [],
		lastMoveAt: Date.now(),
	}
	gameState.value = next
	_push(next)
}

function _detectWin(b, col, row, color) {
	const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]]
	for (const [dx, dy] of dirs) {
		const line = []
		let c = col - dx, r = row - dy
		while (c >= 0 && c < COLS && r >= 0 && r < ROWS && b[c * ROWS + r] === color) {
			line.unshift(c * ROWS + r); c -= dx; r -= dy
		}
		c = col; r = row
		while (c >= 0 && c < COLS && r >= 0 && r < ROWS && b[c * ROWS + r] === color) {
			line.push(c * ROWS + r); c += dx; r += dy
		}
		const uniq = [...new Set(line)]
		if (uniq.length >= 4) return uniq.slice(0, 4)
	}
	return null
}

function newRound() {
	const next = {
		..._emptyState(),
		players: gameState.value.players || { red: null, yellow: null },
		// Loser of last round goes first; default red on draw/none
		turn: gameState.value.winner === 'red' ? 'yellow'
			: gameState.value.winner === 'yellow' ? 'red'
			: 'red',
	}
	gameState.value = next
	_push(next)
}

// ── Lifecycle ──────────────────────────────────────────────────────────

function onEscCapture(e) {
	if (e.key !== 'Escape') return
	e.preventDefault()
	e.stopPropagation()
	emit('close')
}

let _unwatchState = null
onMounted(() => {
	wsOn('c4', onC4)
	wsEmit('c4', { k: 'lobby_join' })
	document.addEventListener('keydown', onEscCapture, true)

	// Auto-claim on incoming state when in a game (via a small interval check —
	// avoids needing a Vue watcher import for this single side effect).
	_unwatchState = setInterval(() => {
		if (view.value === 'game' && currentGameId.value && gameState.value.players) {
			if (!myColor.value) _autoClaimSeatIfOpen()
		}
	}, 250)
})

onUnmounted(() => {
	clearInterval(_unwatchState)
	clearTimeout(_createTimer)
	document.removeEventListener('keydown', onEscCapture, true)
	if (currentGameId.value) {
		_vacateSeat()
		wsEmit('c4', { k: 'leave', gameId: currentGameId.value })
	}
	wsEmit('c4', { k: 'lobby_leave' })
	wsOff('c4', onC4)
})

// ── Lobby helpers ──────────────────────────────────────────────────────

function describeGame(g) {
	const r = g.players?.red?.name    || 'Open seat'
	const y = g.players?.yellow?.name || 'Open seat'
	return { r, y }
}
function gameStateBadge(g) {
	if (g.winner === 'draw') return { label: 'Draw', cls: 'c4-pill--neutral' }
	if (g.winner)            return { label: 'Finished', cls: 'c4-pill--neutral' }
	const open = !g.players?.red || !g.players?.yellow
	if (open)                return { label: 'Open seat', cls: 'c4-pill--open' }
	return { label: 'In progress', cls: 'c4-pill--live' }
}
</script>

<template>
	<Teleport to="body">
		<div class="c4-backdrop" @click.self="$emit('close')">
			<div class="c4-panel" role="dialog" aria-modal="true">
				<div class="c4-header">
					<div class="c4-header-left">
						<button
							v-if="view === 'game'"
							class="c4-back"
							title="Back to lobby"
							@click="leaveGameToLobby"
						>← Lobby</button>
						<span class="c4-title">🔴🟡 Connect 4</span>
						<span v-if="view === 'game' && currentGameId" class="c4-subtle">#{{ currentGameId.slice(-5) }}</span>
					</div>
					<button type="button" class="c4-close" @click="$emit('close')" aria-label="Close">✕</button>
				</div>

				<!-- ── Lobby view ───────────────────────────────────────────── -->
				<div v-if="view === 'lobby'" class="c4-lobby">
					<div class="c4-lobby-actions">
						<button
							class="c4-btn c4-btn--primary c4-btn--lg"
							:disabled="creating || !wsConnected"
							@click="newGame"
						>
							{{ creating ? 'Creating…' : '+ New game' }}
						</button>
						<span class="c4-subtle">{{ lobbyGames.length }} active</span>
						<span v-if="!wsConnected" class="c4-subtle" style="margin-left:auto;color:var(--color-red)">
							⚠️ Disconnected
						</span>
					</div>

					<div v-if="lobbyGames.length === 0" class="c4-empty">
						No games in progress. Start one and wait for an opponent!
					</div>

					<ul v-else class="c4-game-list">
						<li v-for="g in lobbyGames" :key="g.id" class="c4-game-row">
							<div class="c4-row-main">
								<div class="c4-row-vs">
									<span class="c4-disk c4-disk--red c4-disk--xs" />
									<span class="c4-row-name" :class="{ 'c4-row-name--open': !g.players?.red }">
										{{ describeGame(g).r }}
									</span>
									<span class="c4-row-vs-sep">vs</span>
									<span class="c4-row-name" :class="{ 'c4-row-name--open': !g.players?.yellow }">
										{{ describeGame(g).y }}
									</span>
									<span class="c4-disk c4-disk--yellow c4-disk--xs" />
								</div>
								<div class="c4-row-meta">
									<span class="c4-pill" :class="gameStateBadge(g).cls">{{ gameStateBadge(g).label }}</span>
									<span v-if="g.spectatorCount > 0" class="c4-subtle">
										👀 {{ g.spectatorCount }} watching
									</span>
								</div>
							</div>
							<button class="c4-btn c4-btn--primary" @click="joinGame(g.id)">
								{{ !g.players?.red || !g.players?.yellow ? 'Join' : 'Watch' }}
							</button>
						</li>
					</ul>
				</div>

				<!-- ── Game view ────────────────────────────────────────────── -->
				<template v-else-if="view === 'game'">
					<div class="c4-meta">
						<div class="c4-seat" :class="{ 'c4-seat--turn': gameState.turn === 'red' && !gameState.winner }">
							<span class="c4-disk c4-disk--red" />
							<span class="c4-seat-name">{{ gameState.players?.red?.name || 'Open seat' }}</span>
						</div>
						<div class="c4-status">{{ status }}</div>
						<div class="c4-seat c4-seat--right" :class="{ 'c4-seat--turn': gameState.turn === 'yellow' && !gameState.winner }">
							<span class="c4-seat-name">{{ gameState.players?.yellow?.name || 'Open seat' }}</span>
							<span class="c4-disk c4-disk--yellow" />
						</div>
					</div>

					<div
						class="c4-board"
						:style="{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }"
					>
						<button
							v-for="cell in visualCells"
							:key="cell.idx"
							class="c4-cell"
							:class="{
								'c4-cell--clickable': isMyTurn && !cell.val,
								'c4-cell--winning':  cell.winning,
							}"
							:disabled="!isMyTurn || !!gameState.winner"
							:aria-label="`Column ${cell.col + 1}`"
							@click="dropInColumn(cell.col)"
						>
							<span
								v-if="cell.val"
								class="c4-disk"
								:class="cell.val === 'red' ? 'c4-disk--red' : 'c4-disk--yellow'"
							/>
						</button>
					</div>

					<div class="c4-actions">
						<button v-if="gameState.winner" class="c4-btn c4-btn--primary" @click="newRound">New round</button>
						<span v-if="!myColor" class="c4-spectate">👀 Spectating</span>
						<button class="c4-btn" @click="leaveGameToLobby">Back to lobby</button>
					</div>
				</template>
			</div>
		</div>
	</Teleport>
</template>

<style scoped>
.c4-backdrop {
	position: fixed;
	inset: 0;
	z-index: 320;
	background: rgba(0, 0, 0, 0.55);
	backdrop-filter: blur(4px);
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 1rem;
}

.c4-panel {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 1rem;
	padding: 1.25rem 1.5rem 1.5rem;
	width: min(38rem, 100%);
	max-height: 90vh;
	display: flex;
	flex-direction: column;
	box-shadow: 0 1.25rem 3.5rem rgba(0, 0, 0, 0.55);
}

.c4-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 1rem;
	gap: 0.5rem;
}
.c4-header-left {
	display: flex;
	align-items: center;
	gap: 0.625rem;
}
.c4-back {
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	color: var(--color-t2);
	padding: 0.25rem 0.625rem;
	border-radius: 0.4375rem;
	font-size: 0.75rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
}
.c4-back:hover { background: rgba(255, 255, 255, 0.08); color: var(--color-t1); }
.c4-title { font-size: 1.0625rem; font-weight: 700; color: var(--color-t1); }
.c4-subtle { font-size: 0.6875rem; color: var(--color-tm); }
.c4-close {
	background: transparent; border: 0;
	color: var(--color-tm); cursor: pointer;
	font-size: 0.875rem; padding: 0.25rem 0.5rem; border-radius: 0.375rem;
	transition: background 0.15s, color 0.15s;
}
.c4-close:hover { background: rgba(255, 255, 255, 0.06); color: var(--color-t1); }

/* ── Lobby ────────────────────────────────────────────────────────── */

.c4-lobby { display: flex; flex-direction: column; gap: 0.875rem; min-height: 18rem; }
.c4-lobby-actions {
	display: flex;
	align-items: center;
	gap: 0.875rem;
}
.c4-empty {
	text-align: center;
	color: var(--color-tm);
	font-size: 0.8125rem;
	padding: 2.5rem 1rem;
	border: 1px dashed var(--color-brd2);
	border-radius: 0.625rem;
}
.c4-game-list {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	overflow-y: auto;
	max-height: 22rem;
}
.c4-game-row {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.75rem 0.875rem;
	background: rgba(255, 255, 255, 0.03);
	border: 1px solid var(--color-brd2);
	border-radius: 0.625rem;
	transition: background 0.15s, border-color 0.15s;
}
.c4-game-row:hover {
	background: rgba(255, 255, 255, 0.06);
	border-color: rgba(255, 255, 255, 0.2);
}
.c4-row-main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
}
.c4-row-vs {
	display: flex;
	align-items: center;
	gap: 0.4375rem;
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--color-t1);
	min-width: 0;
}
.c4-row-name {
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 9rem;
}
.c4-row-name--open { color: var(--color-tm); font-style: italic; font-weight: 500; }
.c4-row-vs-sep {
	color: var(--color-tm);
	font-size: 0.75rem;
	font-weight: 500;
	margin: 0 0.125rem;
}
.c4-row-meta {
	display: flex;
	align-items: center;
	gap: 0.625rem;
	flex-wrap: wrap;
}
.c4-pill {
	display: inline-block;
	font-size: 0.625rem;
	font-weight: 700;
	padding: 0.125rem 0.4375rem;
	border-radius: 999px;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}
.c4-pill--open    { background: rgba(0, 200, 140, 0.18); color: #2fda9d; }
.c4-pill--live    { background: rgba(255, 205, 60, 0.18); color: #f0b90b; }
.c4-pill--neutral { background: rgba(255, 255, 255, 0.08); color: var(--color-tm); }

/* ── Game ─────────────────────────────────────────────────────────── */

.c4-meta {
	display: grid;
	grid-template-columns: 1fr 1.25fr 1fr;
	align-items: center;
	gap: 0.625rem;
	padding: 0.875rem 0.75rem;
	background: rgba(255, 255, 255, 0.03);
	border-radius: 0.625rem;
	margin-bottom: 0.875rem;
}
.c4-seat {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.4rem 0.5rem;
	border-radius: 0.4375rem;
	min-width: 0;
	transition: background 0.18s, box-shadow 0.18s;
}
.c4-seat--right { justify-content: flex-end; }
.c4-seat-name {
	font-size: 0.9375rem;
	font-weight: 700;
	color: var(--color-t1);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.c4-seat--turn {
	background: rgba(255, 255, 255, 0.08);
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}
.c4-status {
	font-size: 0.8125rem;
	color: var(--color-tm);
	text-align: center;
	font-weight: 500;
}

.c4-board {
	display: grid;
	gap: 0.4rem;
	background: linear-gradient(180deg, #1c2640, #11182a);
	border: 1px solid #0a0f1c;
	border-radius: 0.75rem;
	padding: 0.75rem;
	margin-bottom: 1rem;
}
.c4-cell {
	aspect-ratio: 1;
	background: #0a1018;
	border: 1px solid #050810;
	border-radius: 50%;
	padding: 0;
	cursor: default;
	display: flex; align-items: center; justify-content: center;
	transition: transform 0.12s, box-shadow 0.18s;
}
.c4-cell--clickable { cursor: pointer; }
.c4-cell--clickable:hover { transform: scale(1.07); box-shadow: 0 0 0 2px rgba(255, 215, 100, 0.45); }
.c4-cell--winning { box-shadow: 0 0 0 2px #ffe680, 0 0 14px rgba(255, 230, 128, 0.65); }
.c4-cell:disabled { cursor: default; }

.c4-disk {
	width: 78%;
	height: 78%;
	border-radius: 50%;
	display: inline-block;
}
.c4-disk--xs { width: 0.875rem; height: 0.875rem; }
.c4-disk--red {
	background: radial-gradient(circle at 30% 28%, #ff6a55, #b71c1c);
	box-shadow: inset -2px -3px 5px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.4);
}
.c4-disk--yellow {
	background: radial-gradient(circle at 30% 28%, #ffe890, #d49a1a);
	box-shadow: inset -2px -3px 5px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.4);
}

.c4-actions {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	justify-content: flex-end;
}
.c4-btn {
	padding: 0.4375rem 0.875rem;
	border-radius: 0.4375rem;
	border: 1px solid var(--color-brd2);
	background: var(--color-card2);
	color: var(--color-t2);
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.c4-btn:hover { background: rgba(255, 255, 255, 0.08); color: var(--color-t1); }
.c4-btn--primary {
	background: var(--color-accent);
	color: #fff;
	border-color: transparent;
}
.c4-btn--primary:hover { opacity: 0.9; color: #fff; }
.c4-btn--lg { padding: 0.5625rem 1.125rem; font-size: 0.875rem; }
.c4-spectate { font-size: 0.8125rem; color: var(--color-tm); margin-right: auto; }

:global(html.light) .c4-board { background: linear-gradient(180deg, #2a3550, #1a2138); }
:global(html.light) .c4-cell { background: #f6f7fb; border-color: #d6dae6; }
</style>
