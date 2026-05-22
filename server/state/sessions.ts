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
