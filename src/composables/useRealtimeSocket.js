/**
 * useRealtimeSocket — Singleton WebSocket connection to the quickerSTORM server.
 *
 * Single multiplexed WebSocket for all real-time communication with the server.
 * Carries signaling, pose, chat, and LLUDP relay via { t, d } envelope.
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
// WHY: After this long without a WS connection, fire '_lost' so the app can
// surface a "disconnected from grid" overlay. Matches sim's 60s idle timeout —
// once we're past it, the sim has already dropped our circuit anyway.
const WS_DOWN_GIVEUP_MS = 60_000
let shouldReconnect = false
let lostTimer = null
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
	if (lostTimer) { clearTimeout(lostTimer); lostTimer = null }
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
		// WHY: WS open again — cancel the "give up" timer started on close.
		if (lostTimer) { clearTimeout(lostTimer); lostTimer = null }
		_dispatch('_open', null)
	}

	ws.onmessage = ({ data }) => {
		if (data instanceof ArrayBuffer) {
			_bytesIn += data.byteLength
			_dispatch('_binary', data)
			return
		}
		_bytesIn += data.length   // chars ≈ bytes for our (ASCII-dominant) JSON envelopes

		let msg
		const _p0 = performance.now()
		try { msg = JSON.parse(data) } catch { return }
		_parseMs += performance.now() - _p0

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
			// WHY: Arm "give up" timer only on first close in a down period.
			// If reconnect attempts keep closing, we don't reset — total downtime is what matters.
			if (!lostTimer) {
				lostTimer = setTimeout(() => {
					lostTimer = null
					_dispatch('_lost', null)
				}, WS_DOWN_GIVEUP_MS)
			}
		}
	}

	ws.onerror = () => {
		// onclose will fire after this — reconnect handled there
		_dispatch('_error', null)
	}
}

// Per-message-type handler cost + JSON.parse cost on the main thread. WHY: ~125ms long tasks starve
// every timer ([Main] telemetry); the WS pipeline is the prime suspect. Read+reset via takeWsStats()
// by the engine's 5s telemetry so the top offenders are visible in the server log.
const _msgStats = new Map()  // type → { n, ms, max }
let _parseMs = 0
// Inbound WS bytes since last take — feeds the top-bar bandwidth meter (engine samples ~1 Hz).
// All sim traffic reaches the client through this socket, so this IS the client's network intake.
let _bytesIn = 0

export function takeWsBytes() {
	const b = _bytesIn
	_bytesIn = 0
	return b
}

export function takeWsStats() {
	const top = [..._msgStats.entries()]
		.sort((a, b) => b[1].ms - a[1].ms).slice(0, 4)
		.map(([t, s]) => `${t}:n=${s.n},${s.ms.toFixed(0)}ms(max ${s.max.toFixed(0)})`)
		.join(' ')
	const out = { top, parseMs: _parseMs }
	_msgStats.clear(); _parseMs = 0
	return out
}

function _dispatch(type, data) {
	const set = handlers.get(type)
	if (!set) return
	const t0 = performance.now()
	for (const cb of set) {
		try { cb(data) } catch (e) { console.error(`[ws] handler error for "${type}":`, e) }
	}
	const dt = performance.now() - t0
	let s = _msgStats.get(type)
	if (!s) { s = { n: 0, ms: 0, max: 0 }; _msgStats.set(type, s) }
	s.n++; s.ms += dt; if (dt > s.max) s.max = dt
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
