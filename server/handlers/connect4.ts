/**
 * server/handlers/connect4.ts — Connect 4 lobby + game state relay.
 *
 * Ephemeral, in-memory only (no DB). Server is a dumb relay: it stores the
 * latest known game state and broadcasts updates to that game's subscribers.
 * Game logic (move validation, win detection) lives entirely on the client.
 *
 * Authentication: only requires `presenceUserId` (works for dev users too).
 *
 * Protocol — client ↔ server, all wrapped as `{ t: 'c4', d: { k: <kind>, ... } }`:
 *
 *   client → server kinds:
 *     'lobby_join'   subscribe to lobby updates                     → server replies 'lobby'
 *     'lobby_leave'  unsubscribe from lobby
 *     'create'       create a new game                              → server replies 'created' + 'state' + broadcasts 'lobby'
 *     'join'         { gameId } subscribe to a game                 → server replies 'state'
 *     'leave'        { gameId } unsubscribe from a game             → broadcasts 'lobby' if subscriber count changed
 *     'state'        { gameId, state } push full game state         → server stores + relays to other game subscribers + broadcasts 'lobby'
 *
 *   server → client kinds:
 *     'lobby'        { games: [{ id, players, winner, spectators, isActive }] }
 *     'created'      { gameId } — confirms creation
 *     'state'        { gameId, state } — full game state
 *     'gone'         { gameId } — game was destroyed
 *
 * Game garbage-collection: every 60 s, drop games with 0 subscribers AND
 * lastActivity > 10 min ago. Active games with subscribers stay forever.
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { sendToUser } from '../state/world.ts'

interface PlayerInfo { id: string, name: string }

interface GameState {
	board?: (string | null)[]      // length 42, 'red' | 'yellow' | null
	turn?: 'red' | 'yellow'
	players?: { red: PlayerInfo | null, yellow: PlayerInfo | null }
	winner?: 'red' | 'yellow' | 'draw' | null
	winningCells?: number[]
	lastMoveAt?: number
}

interface C4Game {
	id: string
	state: GameState
	subscribers: Set<string>       // presenceUserId set
	createdAt: number
	lastActivity: number
}

const games = new Map<string, C4Game>()
const lobbySubscribers = new Set<string>()

const GC_INTERVAL_MS  = 60_000
const GAME_TTL_MS     = 10 * 60_000

function _newGameId(): string {
	return `c4_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function _serializeLobby() {
	const out: any[] = []
	for (const g of games.values()) {
		const p = g.state.players || { red: null, yellow: null }
		const playerCount = (p.red ? 1 : 0) + (p.yellow ? 1 : 0)
		out.push({
			id: g.id,
			players: {
				red:    p.red    ? { name: p.red.name }    : null,
				yellow: p.yellow ? { name: p.yellow.name } : null,
			},
			winner: g.state.winner || null,
			spectatorCount: Math.max(0, g.subscribers.size - playerCount),
			isActive: !!g.state.lastMoveAt,
			createdAt: g.createdAt,
		})
	}
	// Newest first
	out.sort((a, b) => b.createdAt - a.createdAt)
	return out
}

function _broadcastLobby() {
	const payload = { t: 'c4', d: { k: 'lobby', games: _serializeLobby() } }
	const json = JSON.stringify(payload)
	for (const userId of lobbySubscribers) {
		// Inline send so we only stringify once across all subscribers.
		const sendPath = sendToUser as any  // sendToUser stringifies internally; trade-off OK for small lobbies
		sendPath(userId, payload)
		void json // (kept for future micro-opt if lobbies get large)
	}
}

function _broadcastGameState(game: C4Game, excludeUserId?: string) {
	const msg = { t: 'c4', d: { k: 'state', gameId: game.id, state: game.state } }
	for (const userId of game.subscribers) {
		if (userId === excludeUserId) continue
		sendToUser(userId, msg)
	}
}

export function handleConnect4(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return
	const kind = data?.k
	if (!kind) return

	switch (kind) {
		case 'lobby_join': {
			lobbySubscribers.add(userId)
			sendToUser(userId, { t: 'c4', d: { k: 'lobby', games: _serializeLobby() } })
			return
		}
		case 'lobby_leave': {
			lobbySubscribers.delete(userId)
			return
		}
		case 'create': {
			const id = _newGameId()
			const game: C4Game = {
				id,
				state: {
					board: Array(42).fill(null),
					turn: 'red',
					players: { red: null, yellow: null },
					winner: null,
					winningCells: [],
					lastMoveAt: 0,
				},
				subscribers: new Set([userId]),
				createdAt: Date.now(),
				lastActivity: Date.now(),
			}
			games.set(id, game)
			sendToUser(userId, { t: 'c4', d: { k: 'created', gameId: id } })
			sendToUser(userId, { t: 'c4', d: { k: 'state', gameId: id, state: game.state } })
			_broadcastLobby()
			return
		}
		case 'join': {
			const gameId = data.gameId
			const game = games.get(gameId)
			if (!game) {
				sendToUser(userId, { t: 'c4', d: { k: 'gone', gameId } })
				return
			}
			game.subscribers.add(userId)
			game.lastActivity = Date.now()
			sendToUser(userId, { t: 'c4', d: { k: 'state', gameId, state: game.state } })
			_broadcastLobby()
			return
		}
		case 'leave': {
			const gameId = data.gameId
			const game = games.get(gameId)
			if (!game) return
			game.subscribers.delete(userId)
			game.lastActivity = Date.now()
			// If creator/players left and no one is left subscribed, GC immediately
			if (game.subscribers.size === 0) {
				games.delete(gameId)
			}
			_broadcastLobby()
			return
		}
		case 'state': {
			const gameId = data.gameId
			const game = games.get(gameId)
			if (!game) return
			if (!game.subscribers.has(userId)) return
			game.state = data.state || {}
			game.lastActivity = Date.now()
			_broadcastGameState(game, userId)
			_broadcastLobby()
			return
		}
	}
}

/** Called on disconnect — strip this user from all c4 subscriptions. */
export function cleanupConnect4(presenceUserId: string) {
	lobbySubscribers.delete(presenceUserId)
	let lobbyChanged = false
	for (const [id, game] of games) {
		if (game.subscribers.delete(presenceUserId)) {
			lobbyChanged = true
			game.lastActivity = Date.now()
			if (game.subscribers.size === 0) {
				games.delete(id)
			} else {
				// Vacate the disconnected user's seat so others can play
				const players = game.state.players
				if (players) {
					if (players.red?.id === presenceUserId) players.red = null
					if (players.yellow?.id === presenceUserId) players.yellow = null
					_broadcastGameState(game)
				}
			}
		}
	}
	if (lobbyChanged) _broadcastLobby()
}

// ── GC: periodically drop empty games whose last activity is older than TTL ──
setInterval(() => {
	const now = Date.now()
	let removed = 0
	for (const [id, game] of games) {
		if (game.subscribers.size === 0 && (now - game.lastActivity) > GAME_TTL_MS) {
			games.delete(id)
			removed++
		}
	}
	if (removed > 0) _broadcastLobby()
}, GC_INTERVAL_MS)
