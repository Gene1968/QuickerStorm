// server/handlers/login.ts — XML-RPC login proxy + LLUDP circuit setup
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'
import { getGrid } from '../lib/grids'
import { hashPassword, buildLoginXml, parseLoginResponse, xmlRpcPost } from '../lib/xmlrpc'
import { encodeUseCircuitCode, encodeCompleteAgentMovement } from '../lib/lludp-codec'
import { nextSeq, trackReliable } from '../lib/circuit'
import { createSession, deleteSession } from '../state/sessions'
import { handleUdpMessage } from './lludp'
import { S } from '../../shared/protocol.js'

export async function handleLogin(
	ws: ServerWebSocket<unknown>,
	sessionId: string,
	data: { grid: string; username: string; password: string }
): Promise<void> {
	const grid = getGrid(data.grid)
	if (!grid) {
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: `Unknown grid: ${data.grid}` } }))
		return
	}

	// Split "FirstName LastName"; default last = "Resident"
	const parts = data.username.trim().split(/\s+/)
	const first = parts[0]
	const last  = parts.length > 1 ? parts.slice(1).join(' ') : 'Resident'

	const hashedPass = hashPassword(data.password)
	const loginXml   = buildLoginXml({ first, last, hashedPass, start: 'last' })

	let loginResult
	try {
		const responseXml = await xmlRpcPost(grid.loginURI, loginXml)
		loginResult = parseLoginResponse(responseXml)
	} catch (err) {
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: `Network error: ${(err as Error).message}` } }))
		return
	}

	if (!loginResult.login) {
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: loginResult.message } }))
		return
	}

	// Open UDP socket for this session
	const udpSocket = dgram.createSocket('udp4')

	const circuit = {
		agentId:     loginResult.agent_id!,
		sessionId:   loginResult.session_id!,
		simIp:       loginResult.sim_ip!,
		simPort:     loginResult.sim_port!,
		circuitCode: loginResult.circuit_code!,
		seqNum:      0,
		pendingAcks: [] as number[],
		reliableOut: new Map(),
		udpSocket,
		ws,
	}

	createSession(sessionId, circuit)

	// Wire up UDP → WS relay
	udpSocket.on('message', (msg: Buffer) => handleUdpMessage(sessionId, msg))
	udpSocket.on('error', (err: Error) => {
		console.error(`[udp:${sessionId}] error:`, err)
		deleteSession(sessionId)
	})

	// Bind, then send UseCircuitCode + CompleteAgentMovement to establish circuit
	udpSocket.bind(() => {
		const seq1 = nextSeq(circuit)
		const useCircuit = encodeUseCircuitCode({
			agentId: circuit.agentId, sessionId: circuit.sessionId,
			circuitCode: circuit.circuitCode, seq: seq1,
		})
		trackReliable(circuit, seq1, useCircuit)
		udpSocket.send(useCircuit, circuit.simPort, circuit.simIp)

		const seq2 = nextSeq(circuit)
		const completeMove = encodeCompleteAgentMovement({
			agentId: circuit.agentId, sessionId: circuit.sessionId,
			circuitCode: circuit.circuitCode, seq: seq2,
		})
		trackReliable(circuit, seq2, completeMove)
		udpSocket.send(completeMove, circuit.simPort, circuit.simIp)

		// Notify browser
		ws.send(JSON.stringify({
			t: S.LOGIN_OK,
			d: {
				agentId:   loginResult.agent_id,
				sessionId: loginResult.session_id,
				simIp:     loginResult.sim_ip,
				simPort:   loginResult.sim_port,
				seedCap:   loginResult.seed_capability,
			},
		}))
	})
}

export function handleLogout(_ws: ServerWebSocket<unknown>, sessionId: string): void {
	deleteSession(sessionId)
}
