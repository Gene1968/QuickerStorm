// server/state/sessions.ts — per-user circuit state for LLUDP bridge
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'

export interface CircuitState {
	agentId:      string
	sessionId:    string
	simIp:        string
	simPort:      number
	circuitCode:  number
	// WHY: regionHandle is U64 extracted from AgentMovementComplete. Required to build
	// TeleportLocationRequest (same-region teleport from LocationBar coord edit).
	regionHandle: bigint
	seqNum:       number   // next outgoing sequence number (increment before use)
	pendingAcks: number[] // incoming reliable packet IDs awaiting our ack
	// Reliable packets we sent, waiting for sim's ack
	reliableOut: Map<number, { buf: Buffer; sentAt: number; retries: number }>
	udpSocket:   dgram.Socket
	ws:          ServerWebSocket<unknown>
	// Diagnostic counters (updated by lludp handler)
	udpRxCount:   number  // total UDP packets received from sim
	lastPingAt:   number  // timestamp of last StartPingCheck received (0 = never)
	lastUdpRxAt:  number  // timestamp of last ANY packet from sim (0 = never)
	circuitEstablished: boolean  // true once UseCircuitCode acked
	// Diagnostic: track packet types seen, logged once each for unhandled types
	loggedTypes: Set<string>
	// Diagnostic counters
	wsMoveCount?: number  // total MOVE messages received from browser client
	// Heartbeat: send AgentUpdate periodically to prevent sim 60s timeout
	lastAgentUpdateAt: number  // 0 = never sent
	lastAgentParams: {
		controlFlags: number
		bodyRot:   [number, number, number]
		headRot:   [number, number, number]
		camCenter: [number, number, number]
		camAt:     [number, number, number]
		camLeft:   [number, number, number]
		camUp:     [number, number, number]
		far:       number
	} | null
	// Capability URLs negotiated from seed cap (populated 3s after login)
	caps: Map<string, string>
	// ── Session resume fields ────────────────────────────────────────────
	// WHY: On page reload, WS drops but sim circuit stays alive. Bun holds the
	// circuit for CIRCUIT_HOLD_MS so the browser can reconnect without a full
	// XML-RPC re-login (which would be rejected "already logged in").
	userKey?:     string                          // "grid:First Last" — reconnect lookup key
	expireTimer?: ReturnType<typeof setTimeout>   // fires deleteSession if browser never reconnects
	cachedLoginOk?: {                             // re-sent as LOGIN_OK on WS reconnect
		agentId:       string
		sessionId:     string
		simIp:         string
		simPort:       number
		seedCap:       string
		regionName:    string
		regionX:       number
		regionY:       number
		startLocation: string
		agentAccess:   string
	}
}

const sessions     = new Map<string, CircuitState>()
const userSessions = new Map<string, string>()   // userKey   → circuitId
const wsToCircuit  = new Map<string, string>()   // wsId (per-connection UUID) → circuitId

// How long to hold a circuit after WS drops before destroying UDP socket
const CIRCUIT_HOLD_MS = 15_000

// ── Core CRUD ────────────────────────────────────────────────────────────

export function createSession(id: string, state: CircuitState): void {
	sessions.set(id, state)
	if (state.userKey) userSessions.set(state.userKey, id)
}

export function getSession(id: string): CircuitState | undefined {
	return sessions.get(id)
}

export function deleteSession(id: string): void {
	const s = sessions.get(id)
	if (s) {
		if (s.expireTimer) clearTimeout(s.expireTimer)
		if (s.userKey) userSessions.delete(s.userKey)
		try { s.udpSocket.close() } catch { /* already closed */ }
		sessions.delete(id)
	}
	// Clean up any WS→circuit mappings pointing at this circuit
	for (const [wsId, cId] of wsToCircuit) {
		if (cId === id) wsToCircuit.delete(wsId)
	}
}

export function allSessions(): Map<string, CircuitState> {
	return sessions
}

// ── Session resume helpers ────────────────────────────────────────────────

/** Look up an existing live circuit by "grid:username" key. */
export function findCircuitByUser(userKey: string): { circuitId: string; circuit: CircuitState } | undefined {
	const id = userSessions.get(userKey)
	if (!id) return undefined
	const c = sessions.get(id)
	if (!c) return undefined
	return { circuitId: id, circuit: c }
}

/**
 * Record that wsId routes to circuitId.
 * WHY: Reconnect WS has a new per-connection UUID that differs from the circuitId
 * (which was the first WS's UUID). wsToCircuit lets MOVE/CHAT/close all route correctly.
 */
export function attachWs(wsId: string, circuitId: string): void {
	wsToCircuit.set(wsId, circuitId)
}

export function detachWs(wsId: string): void {
	wsToCircuit.delete(wsId)
}

/**
 * Resolve the circuit key for a given WS session ID.
 * First connection: wsId === circuitId (no entry → fallback to wsId).
 * Reconnect:        wsId → circuitId via wsToCircuit map.
 */
export function resolveCircuitId(wsId: string): string {
	return wsToCircuit.get(wsId) ?? wsId
}

/** Start the hold timer — deletes circuit if browser doesn't reconnect in time. */
export function scheduleExpire(circuitId: string): void {
	const s = sessions.get(circuitId)
	if (!s) return
	if (s.expireTimer) clearTimeout(s.expireTimer)
	s.expireTimer = setTimeout(() => deleteSession(circuitId), CIRCUIT_HOLD_MS)
}

/** Cancel a pending expire — called when browser reconnects successfully. */
export function cancelExpire(circuitId: string): void {
	const s = sessions.get(circuitId)
	if (!s?.expireTimer) return
	clearTimeout(s.expireTimer)
	s.expireTimer = undefined
}
