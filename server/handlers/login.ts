// server/handlers/login.ts — XML-RPC login proxy + LLUDP circuit setup
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'
import { getGrid } from '../lib/grids'
import { hashPassword, buildLoginXml, parseLoginResponse, xmlRpcPost } from '../lib/xmlrpc'
import { encodeUseCircuitCode, encodeCompleteAgentMovement, encodeAgentThrottle, encodeAgentHeightWidth, encodeLogoutRequest } from '../lib/lludp-codec'
import { nextSeq, trackReliable } from '../lib/circuit'
import { createSession, deleteSession, getSession, findCircuitByUser, attachWs, cancelExpire } from '../state/sessions'
import { handleUdpMessage, startCircuitTimers } from './lludp'
import { slog } from '../lib/serverLog'
import { S } from '../../shared/protocol.js'
import { replayCachedWorld } from '../lib/resync'
import { parseLLSD } from '../lib/llsd'
import { startEventQueue } from '../lib/eventQueue'

// WHY: caps we ask the seed for. The seed POST doubles as OpenSim's SentSeeds trigger (world init),
// so we request the full set we'll use across Phase 3 — not just RebakeAvatarTextures.
const REQUESTED_CAPS = [
	// WHY: EventQueueGet is the HTTP long-poll the sim uses to deliver llsd-flavored messages —
	// critically TeleportFinish for cross-region teleport (see server/lib/eventQueue.ts). Without
	// it, cross-region TPs time out at the source sim. Listed first; it's the most important cap.
	'EventQueueGet',
	'FetchInventoryDescendents2',
	'WebFetchInventoryDescendents',
	'FetchInventory2',
	'FetchLib2',
	'FetchLibDescendents2',
	'GetTexture',
	'GetMesh2',
	// WHY: ViewerAsset is OpenSim's unified asset cap (textures/mesh/sound/anim/material) and is
	// preferred over GetTexture/GetMesh2 when offered; GetMesh is the v1 fallback. RenderMaterials +
	// ModifyMaterialParams carry legacy + GLTF-override material data. UploadBakedTexture is the
	// client-bake upload endpoint (OpenSim has no server-bake). See caps-feature-map slice plan.
	'ViewerAsset',
	'GetMesh',
	'RenderMaterials',
	'ModifyMaterialParams',
	'UploadBakedTexture',
	'RebakeAvatarTextures',
	'AgentPreferences',
	'UpdateAgentInformation',
]

export async function handleLogin(
	ws: ServerWebSocket<unknown>,
	wsId: string,
	data: { grid: string; username: string; password: string; destination?: string }
): Promise<void> {
	const grid = getGrid(data.grid)
	if (!grid) {
		ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: `Unknown grid: ${data.grid}` } }))
		return
	}

	// ── Fast-path: reconnect to existing live circuit ──────────────────────
	// WHY: On page reload the WS drops but the sim circuit stays alive (held for 15s).
	// If the same user reconnects within that window we skip XML-RPC re-login entirely
	// (which would be rejected "already logged in") and resume the existing circuit.
	const userKey = `${data.grid}:${data.username.trim().toLowerCase()}`
	const existing = findCircuitByUser(userKey)
	if (existing) {
		const { circuitId, circuit } = existing
		cancelExpire(circuitId)
		circuit.ws = ws         // swap WS ref so UDP relay goes to new connection
		attachWs(wsId, circuitId)
		slog.info(ws, `Session resume — reattached WS to existing circuit (circuitId=${circuitId.slice(0,8)}…)`)
		if (circuit.cachedLoginOk) {
			ws.send(JSON.stringify({ t: S.LOGIN_OK, d: circuit.cachedLoginOk }))
		} else {
			// Fallback: synthesise minimal payload from circuit state
			ws.send(JSON.stringify({
				t: S.LOGIN_OK,
				d: {
					agentId:    circuit.agentId,
					sessionId:  circuit.sessionId,
					simIp:      circuit.simIp,
					simPort:    circuit.simPort,
					seedCap:    '',
					regionName: '',
					regionX:    0,
					regionY:    0,
					startLocation: 'last',
					agentAccess:   '',
				},
			}))
		}
		// WHY: defer CAPS_READY + world replay — LOGIN_OK triggers an async router navigation on
		// the client; without a small gap, these messages arrive before WorldView mounts and the
		// CAPS_READY handler is never registered, leaving inventory in a permanently cap-less state.
		// 300ms is more than enough for Vue Router to complete navigation and call useInventory().
		setTimeout(() => {
			if (circuit.caps && circuit.caps.size) {
				ws.send(JSON.stringify({ t: S.CAPS_READY, d: { caps: [...circuit.caps.keys()] } }))
			}
			// WHY: Replay cached world snapshot on resume so terrain, region name, and spawn
			// position are restored without the user clicking anything. Sim won't re-send
			// RegionHandshake/LayerData on its own — the circuit is already established.
			replayCachedWorld(circuit)
		}, 300)
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
	const regionX     = loginResult.region_x ?? 0
	const regionY     = loginResult.region_y ?? 0
	// WHY: region_size_x/y present on OpenSim var-region grids (e.g. 512 for 512×512m).
	// Absent on standard 256×256 grids — default to 256. Forwarded to browser so terrain
	// geometry, dead-reckoning clamps, and coordinate display all scale to region dimensions.
	const regionSizeX = loginResult.region_size_x ?? 256
	const regionSizeY = loginResult.region_size_y ?? 256

	// Cache the full LOGIN_OK payload for session resume (reconnect within hold window)
	const cachedLoginOk = {
		agentId:       loginResult.agent_id!,
		sessionId:     loginResult.session_id!,
		simIp:         loginResult.sim_ip!,
		simPort:       loginResult.sim_port!,
		seedCap:       loginResult.seed_capability ?? '',
		regionName:    loginResult.region_name ?? '',
		regionX,
		regionY,
		regionSizeX,
		regionSizeY,
		startLocation: loginResult.start_location ?? start,
		agentAccess:   loginResult.agent_access ?? '',
		firstName:     loginResult.first_name ?? '',
		lastName:      loginResult.last_name  ?? '',
		// WHY: folder tree comes free in the login response — ship it so the Inventory floater
		// renders immediately. Items are fetched per-folder later via FetchInventoryDescendents2.
		inventoryRoot:        loginResult.inventory_root ?? '',
		inventorySkeleton:    loginResult.inventory_skeleton ?? [],
		inventoryLibRoot:     loginResult.inventory_lib_root ?? '',
		inventorySkeletonLib: loginResult.inventory_skeleton_lib ?? [],
		// WHY: social harvest ships free in the login response — friends (UUIDs + rights),
		// gestures, default textures, flags. Folded into LOGIN_OK so it survives session resume
		// (mirrors inventory skeleton). Friend names + online status resolve later (UUIDNameReply,
		// OnlineNotification); groups arrive via AgentGroupDataUpdate post-login.
		social: {
			friends: (loginResult.buddy_list ?? []).map(b => ({
				id:          b.buddyId,
				name:        '',          // resolved via UUIDNameReply
				rightsGiven: b.rightsGiven,
				rightsHas:   b.rightsHas,
				online:      false,       // updated by OnlineNotification
			})),
			gestures:       loginResult.gestures ?? [],
			globalTextures: loginResult.global_textures ?? {},
			loginFlags:     loginResult.login_flags ?? {},
		},
	}

	const fullName = [loginResult.first_name, loginResult.last_name].filter(Boolean).join(' ')

	const circuit = {
		agentId:      loginResult.agent_id!,
		sessionId:    loginResult.session_id!,
		simIp:        loginResult.sim_ip!,
		simPort:      loginResult.sim_port!,
		circuitCode:  loginResult.circuit_code!,
		agentName:    fullName,
		regionHandle: (BigInt(regionY) << 32n) | BigInt(regionX),
		seqNum:       0,
		pendingAcks:  [] as number[],
		reliableOut:  new Map(),
		udpSocket,
		ws,
		udpRxCount:   0,
		lastPingAt:   0,
		lastUdpRxAt:  Date.now(),  // WHY: Init to now so idle timer doesn't fire during circuit setup
		circuitEstablished: false,
		lastAgentUpdateAt:  0,
		lastAgentParams:    null,
		loggedTypes:        new Set<string>(),
		msgRxCounts:        new Map<string, number>(),
		objDecodedCount:    0,
		objRelayedCount:    0,
		reqMultiOutCount:   0,
		reqMultiIdsCount:   0,
		distinctLocalIds:   new Set<number>(),
		lastDiagLogAt:      0,
		cacheMissPending:   [],
		cacheMissAskedEver: new Set<number>(),
		cacheMissRetryPending: [],
		cacheMissRetryStarted: false,
		lastCacheEnumAt:       0,
		primIdsSnapshotDumped: false,
		caps:               new Map<string, string>(),
		userKey,
		cachedLoginOk,
		terrainCache:       new Map(),
		coveredLandPatches: new Set(),
		objCache:           new Map(),
	}

	// WHY: wsId is the first WS's per-connection UUID — used as both the circuitId and
	// the initial wsToCircuit entry. Reconnect WS gets a new UUID; attachWs maps it to this circuitId.
	createSession(wsId, circuit)
	attachWs(wsId, wsId)  // first connection: wsId === circuitId

	// Wire up UDP → WS relay
	// WHY: Closure captures wsId (= circuitId for first connection). UDP relay always uses
	// circuitId — independent of which WS is currently attached (circuit.ws is updated on reconnect).
	udpSocket.on('message', (msg: Buffer) => handleUdpMessage(wsId, msg))
	udpSocket.on('error', (err: Error) => {
		slog.error(ws, `UDP socket error: ${err.message}`)
		deleteSession(wsId)
	})

	// Bind explicitly to 0.0.0.0 (all interfaces, OS-assigned port)
	// WHY: Bun on Windows may default to loopback only without explicit address.
	udpSocket.bind(0, '0.0.0.0', () => {
		const localAddr = udpSocket.address()
		slog.info(ws, `UDP socket bound — local port ${localAddr.port} → ${circuit.simIp}:${circuit.simPort}`)

		// WHY: Timer started here (after session + socket ready). Starting at WS open finds
		// no session yet → auto-clears → retransmit never runs. Stops itself when session gone.
		startCircuitTimers(wsId)

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

		// WHY: AgentHeightWidth — tells sim our viewport dimensions (1024×768 typical).
		// Some OpenSim builds gate SendInitialDataToMe (terrain) until this is received.
		// Firestorm sends it immediately after CompleteAgentMovement + AgentThrottle.
		const seq4 = nextSeq(circuit)
		const heightWidthPkt = encodeAgentHeightWidth({
			agentId:     circuit.agentId,
			sessionId:   circuit.sessionId,
			circuitCode: circuit.circuitCode,
			seq:         seq4,
		})
		udpSocket.send(heightWidthPkt, circuit.simPort, circuit.simIp, (err) => {
			if (err) slog.error(ws, `AgentHeightWidth send error: ${err.message}`)
			else     slog.info(ws, `→ AgentHeightWidth sent (seq=${seq4}) — viewport 1024×768`)
		})

		// WHY: OpenSim's NeedInitialData counter (ScenePresence.cs) waits for
		// ViewerFlags.SentSeeds before fully initializing world data. SentSeeds is set
		// ONLY when the viewer HTTP POSTs to the seed capability URL (BunchOfCaps.cs line 391).
		// Without this fetch, NeedInitialData loops and world-state init is indefinitely deferred.
		// We request RebakeAvatarTextures so we get its URL back for Ctrl+Alt+R rebake support.
		const seedCapUrl = loginResult.seed_capability
		if (seedCapUrl) {
			setTimeout(async () => {
				try {
					const reqBody = '<?xml version="1.0"?>\n<llsd><array>' +
						REQUESTED_CAPS.map(c => `<string>${c}</string>`).join('') +
						'</array></llsd>'
					const res = await fetch(seedCapUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
						body: reqBody,
					})
					slog.info(ws, `✓ Seed cap fetched (${res.status}) → SentSeeds set in OpenSim`)
					// WHY: response is an LLSD map { capName: url }. Store every offered cap so
					// inventory/texture/rebake handlers can resolve their URL server-side (URLs carry
					// session tokens → never sent to the browser).
					const xml = await res.text()
					const map = parseLLSD(xml) as Record<string, unknown> | null
					const s = getSession(wsId)
					if (s && map && typeof map === 'object') {
						const offered: string[] = []
						for (const [name, url] of Object.entries(map)) {
							if (typeof url === 'string' && url) { s.caps.set(name, url); offered.push(name) }
						}
						slog.info(ws, `✓ ${offered.length} caps stored: ${offered.join(', ')}`)
						// WHY: start the EventQueueGet long-poll as soon as we have its URL. This is what
						// delivers cross-region TeleportFinish (and EnableSimulator/CrossedRegion) — without
						// it those events sit unread and cross-region teleport times out.
						const eqUrl = s.caps.get('EventQueueGet')
						if (eqUrl) startEventQueue(wsId, eqUrl)
						// Notify browser which caps are usable (enables Inventory fetch, etc.).
						s.ws.send(JSON.stringify({ t: S.CAPS_READY, d: { caps: offered } }))
					} else {
						slog.info(ws, `ℹ Seed cap returned no usable map`)
					}
				} catch (e) {
					slog.warn(ws, `Seed cap fetch failed: ${(e as Error).message}`)
				}
			}, 3000)  // WHY: 3s delay — allow UDP circuit + RegionHandshake exchange to complete first
		}

		// 10-second diagnostic: warn if sim has sent nothing back
		// WHY: Most common cause is Windows Firewall blocking inbound UDP for bun.exe.
		setTimeout(() => {
			const s = getSession(wsId)
			if (s && s.udpRxCount === 0) {
				slog.warn(ws,
					'⚠ No UDP packets from sim after 10s. Likely cause: Windows Firewall blocking ' +
					'inbound UDP for bun.exe. Fix (run as Administrator): ' +
					'New-NetFirewallRule -DisplayName "bun UDP" -Direction Inbound ' +
					'-Program "<bun.exe path>" -Protocol UDP -Action Allow'
				)
			}
		}, 10_000)

		// Notify browser — reuse cachedLoginOk so the fresh + resume payloads can't drift
		// (it already carries session data + the inventory skeleton).
		ws.send(JSON.stringify({ t: S.LOGIN_OK, d: cachedLoginOk }))
	})
}

export function handleLogout(_ws: ServerWebSocket<unknown>, sessionId: string): void {
	const circuit = getSession(sessionId)
	if (circuit) {
		// WHY: Send LogoutRequest UDP so the sim releases the circuit immediately.
		// Without this the sim holds the circuit ~60s, blocking re-login with "already logged in".
		const seq = nextSeq(circuit)
		const pkt = encodeLogoutRequest({
			agentId:   circuit.agentId,
			sessionId: circuit.sessionId,
			seq,
		})
		circuit.udpSocket.send(pkt, circuit.simPort, circuit.simIp)
	}
	deleteSession(sessionId)
}
