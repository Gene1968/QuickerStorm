// server/handlers/login.ts — XML-RPC login proxy + LLUDP circuit setup
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'
import { getGrid } from '../lib/grids'
import { hashPassword, buildLoginXml, parseLoginResponse, xmlRpcPost } from '../lib/xmlrpc'
import { encodeUseCircuitCode, encodeCompleteAgentMovement, encodeAgentThrottle } from '../lib/lludp-codec'
import { nextSeq, trackReliable } from '../lib/circuit'
import { createSession, deleteSession, getSession } from '../state/sessions'
import { handleUdpMessage, startCircuitTimers } from './lludp'
import { slog } from '../lib/serverLog'
import { S } from '../../shared/protocol.js'

export async function handleLogin(
	ws: ServerWebSocket<unknown>,
	sessionId: string,
	data: { grid: string; username: string; password: string; destination?: string }
): Promise<void> {
	const grid = getGrid(data.grid)
	if (!grid) {
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: `Unknown grid: ${data.grid}` } }))
		return
	}

	slog.info(ws, `Login start — grid=${data.grid} user="${data.username}" dest="${data.destination ?? 'last'}"`)

	// Split "FirstName LastName"; default last = "Resident"
	const parts = data.username.trim().split(/\s+/)
	const first = parts[0]
	const last  = parts.length > 1 ? parts.slice(1).join(' ') : 'Resident'

	const hashedPass = hashPassword(data.password)
	// WHY: destination forwarded from client — 'last', 'home', or 'uri:RegionName&x&y&z'
	const start      = data.destination ?? 'last'
	const loginXml   = buildLoginXml({ first, last, hashedPass, start })

	slog.info(ws, `XML-RPC POST → ${grid.loginURI}`)

	let loginResult
	try {
		const responseXml = await xmlRpcPost(grid.loginURI, loginXml)
		loginResult = parseLoginResponse(responseXml)
	} catch (err) {
		const msg = `Network error: ${(err as Error).message}`
		slog.error(ws, msg)
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: msg } }))
		return
	}

	if (!loginResult.login) {
		slog.warn(ws, `Login rejected by grid: ${loginResult.message}`)
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: loginResult.message } }))
		return
	}

	slog.info(ws, `XML-RPC OK — agentId=${loginResult.agent_id?.slice(0,8)}… region="${loginResult.region_name}" sim=${loginResult.sim_ip}:${loginResult.sim_port} circuit=${loginResult.circuit_code}`)

	// Open UDP socket for this session
	const udpSocket = dgram.createSocket('udp4')

	// WHY: regionHandle is U64 = (regionY << 32) | regionX. Both values are global
	// meter coordinates from XML-RPC login. Updated from AgentMovementComplete once circuit
	// is live. Pre-seeded here so TeleportLocationRequest can be sent immediately after login.
	const regionX = loginResult.region_x ?? 0
	const regionY = loginResult.region_y ?? 0
	const circuit = {
		agentId:      loginResult.agent_id!,
		sessionId:    loginResult.session_id!,
		simIp:        loginResult.sim_ip!,
		simPort:      loginResult.sim_port!,
		circuitCode:  loginResult.circuit_code!,
		regionHandle: (BigInt(regionY) << 32n) | BigInt(regionX),
		seqNum:       0,
		pendingAcks:  [] as number[],
		reliableOut:  new Map(),
		udpSocket,
		ws,
		udpRxCount:   0,
		lastPingAt:   0,
		circuitEstablished: false,
		lastAgentUpdateAt:  0,
		lastAgentParams:    null,
		loggedTypes:        new Set<string>(),
	}

	createSession(sessionId, circuit)

	// Wire up UDP → WS relay
	udpSocket.on('message', (msg: Buffer) => handleUdpMessage(sessionId, msg))
	udpSocket.on('error', (err: Error) => {
		slog.error(ws, `UDP socket error: ${err.message}`)
		deleteSession(sessionId)
	})

	// Bind explicitly to 0.0.0.0 (all interfaces, OS-assigned port)
	// WHY: Bun on Windows may default to loopback only without explicit address.
	udpSocket.bind(0, '0.0.0.0', () => {
		const localAddr = udpSocket.address()
		slog.info(ws, `UDP socket bound — local port ${localAddr.port} → ${circuit.simIp}:${circuit.simPort}`)

		// WHY: Timer started here (after session + socket ready). Starting at WS open finds
		// no session yet → auto-clears → retransmit never runs. Stops itself when session gone.
		startCircuitTimers(sessionId)

		const seq1 = nextSeq(circuit)
		const useCircuit = encodeUseCircuitCode({
			agentId: circuit.agentId, sessionId: circuit.sessionId,
			circuitCode: circuit.circuitCode, seq: seq1,
		})
		// Log raw bytes for wire-level debugging
		slog.info(ws, `UseCircuitCode raw(46b): ${useCircuit.toString('hex')}`)
		trackReliable(circuit, seq1, useCircuit)
		udpSocket.send(useCircuit, circuit.simPort, circuit.simIp, (err) => {
			if (err) slog.error(ws, `UseCircuitCode send error: ${err.message}`)
			else     slog.info(ws, `→ UseCircuitCode sent (seq=${seq1}, code=${circuit.circuitCode}) → ${circuit.simIp}:${circuit.simPort}`)
		})

		const seq2 = nextSeq(circuit)
		const completeMove = encodeCompleteAgentMovement({
			agentId: circuit.agentId, sessionId: circuit.sessionId,
			circuitCode: circuit.circuitCode, seq: seq2,
		})
		slog.info(ws, `CompleteAgentMovement raw(46b): ${completeMove.toString('hex')}`)
		trackReliable(circuit, seq2, completeMove)
		udpSocket.send(completeMove, circuit.simPort, circuit.simIp, (err) => {
			if (err) slog.error(ws, `CompleteAgentMovement send error: ${err.message}`)
			else     slog.info(ws, `→ CompleteAgentMovement sent (seq=${seq2}) → ${circuit.simIp}:${circuit.simPort}`)
		})

		// WHY: AgentThrottle tells sim bandwidth allocation per packet category.
		// OpenSim requires this after CompleteAgentMovement to enable avatar physics.
		// Without it: animations work (state-only) but movement/rotation silently blocked.
		// Firestorm sends this immediately after CompleteAgentMovement.
		const seq3 = nextSeq(circuit)
		const throttlePkt = encodeAgentThrottle({
			agentId:     circuit.agentId,
			sessionId:   circuit.sessionId,
			circuitCode: circuit.circuitCode,
			seq:         seq3,
		})
		trackReliable(circuit, seq3, throttlePkt)
		udpSocket.send(throttlePkt, circuit.simPort, circuit.simIp, (err) => {
			if (err) slog.error(ws, `AgentThrottle send error: ${err.message}`)
			else     slog.info(ws, `→ AgentThrottle sent (seq=${seq3}) — physics movement enabled`)
		})

		// WHY: OpenSim's NeedInitialData counter (ScenePresence.cs) waits for
		// ViewerFlags.SentSeeds before fully initializing world data. SentSeeds is set
		// ONLY when the viewer HTTP POSTs to the seed capability URL (BunchOfCaps.cs line 391).
		// Without this fetch, NeedInitialData loops and world-state init is indefinitely deferred.
		// POST empty LLSD array — server sets SentSeeds regardless of requested caps list.
		const seedCapUrl = loginResult.seed_capability
		if (seedCapUrl) {
			setTimeout(async () => {
				try {
					const res = await fetch(seedCapUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/llsd+xml' },
						body: '<?xml version="1.0"?>\n<llsd><array/></llsd>',
					})
					slog.info(ws, `✓ Seed cap fetched (${res.status}) → SentSeeds set in OpenSim`)
				} catch (e) {
					slog.warn(ws, `Seed cap fetch failed: ${(e as Error).message}`)
				}
			}, 3000)  // WHY: 3s delay — allow UDP circuit + RegionHandshake exchange to complete first
		}

		// 10-second diagnostic: warn if sim has sent nothing back
		// WHY: Most common cause is Windows Firewall blocking inbound UDP for bun.exe.
		setTimeout(() => {
			const s = getSession(sessionId)
			if (s && s.udpRxCount === 0) {
				slog.warn(ws,
					'⚠ No UDP packets from sim after 10s. Likely cause: Windows Firewall blocking ' +
					'inbound UDP for bun.exe. Fix (run as Administrator): ' +
					'New-NetFirewallRule -DisplayName "bun UDP" -Direction Inbound ' +
					'-Program "<bun.exe path>" -Protocol UDP -Action Allow'
				)
			}
		}, 10_000)

		// Notify browser — includes all session data from login response
		ws.send(JSON.stringify({
			t: S.LOGIN_OK,
			d: {
				agentId:       loginResult.agent_id,
				sessionId:     loginResult.session_id,
				simIp:         loginResult.sim_ip,
				simPort:       loginResult.sim_port,
				seedCap:       loginResult.seed_capability,
				regionName:    loginResult.region_name ?? '',
				regionX:       loginResult.region_x ?? 0,
				regionY:       loginResult.region_y ?? 0,
				startLocation: loginResult.start_location ?? start,
				agentAccess:   loginResult.agent_access ?? '',
			},
		}))
	})
}

export function handleLogout(_ws: ServerWebSocket<unknown>, sessionId: string): void {
	deleteSession(sessionId)
}
