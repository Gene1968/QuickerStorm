/**
 * useRealtimeSocket — Singleton WebSocket connection to the QuickerStorm server.
 *
 * Replaces the per-composable WebSocket connections (signal-server for voice,
 * Supabase Realtime for presence/pose/chat) with a single multiplexed socket.
 *
 * Phase 1: Carries signaling + room privacy (same JSON format as signal-server.js).
 * Phase 2+: Will carry presence, pose, cursor, chat via { t, d } envelope.
 *
 * Usage:
 *   import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
 *   const { connect, send, on, off, connected } = useRealtimeSocket()
 */

import { ref } from 'vue'

// ── Configuration ───────────────────────────────────────────────────────
const WS_URL = import.meta.env.VITE_WS_URL
	|| import.meta.env.VITE_SIGNAL_URL
	|| ''

// ── Module-level singleton state ────────────────────────────────────────
let ws = null
let reconnectTimer = null
let reconnectDelay = 1000
const MAX_RECONNECT_DELAY = 30_000
let shouldReconnect = false
let _connectArgs = null   // { roomId } — for reconnect

const connected = ref(false)

// Event handlers: Map<messageType, Set<callback>>
const handlers = new Map()

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Connect to the WebSocket server. Idempotent — if already connected,
 * this is a no-op unless the connection is in a bad state.
 */
function connect() {
	if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
		return
	}

	if (!WS_URL) {
		console.warn('[ws] No server URL — set VITE_WS_URL or VITE_SIGNAL_URL in .env')
		return
	}

	shouldReconnect = true
	_createConnection()
}

/**
 * Send a raw JSON message (any shape).
 * Phase 1 signaling uses { type: 'join', userId, roomId }.
 */
function send(msg) {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(msg))
	}
}

/**
 * Send an envelope message: { t: type, d: data }.
 * Used for Phase 2+ presence/pose/chat messages.
 */
function emit(type, data) {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ t: type, d: data }))
	}
}

/**
 * Send raw binary data (Phase 4: pose/cursor binary encoding).
 */
function sendBinary(buf) {
	if (ws?.readyState === WebSocket.OPEN) {
		ws.send(buf)
	}
}

/**
 * Register a handler for a message type.
 * For Phase 1 (signaling), type is the `msg.type` string (e.g. 'peer-joined').
 * For Phase 2+, type is the `msg.t` string (e.g. 'pose').
 *
 * @param {string} type
 * @param {Function} cb - called with the full parsed message
 */
function on(type, cb) {
	if (!handlers.has(type)) handlers.set(type, new Set())
	handlers.get(type).add(cb)
}

/**
 * Remove a handler for a message type.
 */
function off(type, cb) {
	const set = handlers.get(type)
	if (set) {
		set.delete(cb)
		if (set.size === 0) handlers.delete(type)
	}
}

/**
 * Disconnect and stop reconnecting.
 */
function disconnect() {
	shouldReconnect = false
	clearTimeout(reconnectTimer)
	reconnectTimer = null
	if (ws) {
		ws.close()
		ws = null
	}
	connected.value = false
}

/**
 * Get the raw WebSocket instance (for readyState checks, etc.).
 * Prefer using send() and on()/off() instead.
 */
function getRawSocket() {
	return ws
}

// ── Internal ────────────────────────────────────────────────────────────

function _createConnection() {
	clearTimeout(reconnectTimer)
	reconnectTimer = null

	ws = new WebSocket(WS_URL)
	ws.binaryType = 'arraybuffer'

	ws.onopen = () => {
		connected.value = true
		reconnectDelay = 1000  // reset backoff on success
		_dispatch('_open', null)
	}

	ws.onmessage = ({ data }) => {
		if (data instanceof ArrayBuffer) {
			_dispatch('_binary', data)
			return
		}

		let msg
		try { msg = JSON.parse(data) } catch { return }

		// Route by format:
		// Envelope messages { t, d } — dispatch by `t`, pass `d` as payload
		// Signaling messages { type, ... } — dispatch by `type`, pass full message
		if (msg.t) {
			_dispatch(msg.t, msg.d !== undefined ? msg.d : msg)
		} else if (msg.type) {
			_dispatch(msg.type, msg)
		}
	}

	ws.onclose = (ev) => {
		connected.value = false
		_dispatch('_close', ev)

		if (shouldReconnect) {
			reconnectTimer = setTimeout(() => {
				_createConnection()
			}, reconnectDelay)
			// Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s max
			reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY)
		}
	}

	ws.onerror = () => {
		// onclose will fire after this — reconnect handled there
		_dispatch('_error', null)
	}
}

function _dispatch(type, data) {
	const set = handlers.get(type)
	if (!set) return
	for (const cb of set) {
		try { cb(data) } catch (e) { console.error(`[ws] handler error for "${type}":`, e) }
	}
}

// ── Export composable ───────────────────────────────────────────────────

export function useRealtimeSocket() {
	return {
		connect,
		disconnect,
		send,
		emit,
		sendBinary,
		on,
		off,
		connected,
		getRawSocket,
	}
}
