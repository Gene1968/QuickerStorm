// server/state/sessions.ts — per-user circuit state for LLUDP bridge
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'

export interface CircuitState {
	agentId:     string
	sessionId:   string
	simIp:       string
	simPort:     number
	circuitCode: number
	seqNum:      number   // next outgoing sequence number (increment before use)
	pendingAcks: number[] // incoming reliable packet IDs awaiting our ack
	// Reliable packets we sent, waiting for sim's ack
	reliableOut: Map<number, { buf: Buffer; sentAt: number; retries: number }>
	udpSocket:   dgram.Socket
	ws:          ServerWebSocket<unknown>
	// Diagnostic counters (updated by lludp handler)
	udpRxCount:  number   // total UDP packets received from sim
	lastPingAt:  number   // timestamp of last StartPingCheck received (0 = never)
	circuitEstablished: boolean  // true once UseCircuitCode acked
	// Diagnostic: track packet types seen, logged once each for unhandled types
	loggedTypes: Set<string>
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
}

const sessions = new Map<string, CircuitState>()

export function createSession(id: string, state: CircuitState): void {
	sessions.set(id, state)
}

export function getSession(id: string): CircuitState | undefined {
	return sessions.get(id)
}

export function deleteSession(id: string): void {
	const s = sessions.get(id)
	if (s) {
		try { s.udpSocket.close() } catch { /* already closed */ }
		sessions.delete(id)
	}
}

export function allSessions(): Map<string, CircuitState> {
	return sessions
}
