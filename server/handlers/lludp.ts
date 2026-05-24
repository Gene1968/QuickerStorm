// server/handlers/lludp.ts — UDP→WS relay: decode incoming LLUDP packets, forward to browser
import { getSession, deleteSession } from '../state/sessions'
import type { CircuitState } from '../state/sessions'
import {
	parseHeader, parseMsgType,
	decodeChatFromSimulator, decodeObjectUpdate, decodeImprovedTerseObjectUpdate,
	decodeObjectUpdateCached, encodeRequestMultipleObjects,
	decodeRegionHandshake, decodeZeroCoded,
	encodeAgentUpdate, encodeChatFromViewer, encodeCompletePingCheck, encodeRegionHandshakeReply,
	encodeTeleportLocationRequest,
} from '../lib/lludp-codec'
import { queueAck, nextSeq, trackReliable, ackReceived, retransmitOverdue, sendPendingAcks } from '../lib/circuit'
import { slog } from '../lib/serverLog'
import { S, C } from '../../shared/protocol.js'

// Message type codes — verified against packet log + LibOpenMetaverse message.xml
// WHY: ObjectUpdate (12), ImprovedTerseObjectUpdate (15), StartPingCheck (1), CompletePingCheck (2)
// are HIGH-frequency messages (1-byte ID prefix). Earlier code incorrectly used LOW prefix
// (4-byte 0xFF 0xFF + U16), so handlers never fired and no object data reached the browser.
// RegionHandshake (148), DisableSimulator (152), ChatFromSimulator (139) ARE Low-frequency.
const HIGH_START_PING_CHECK    = 1     // Sim → viewer: keepalive ping (High freq, 1-byte prefix)
const HIGH_OBJECT_UPDATE_CACHED= 11    // ObjectUpdateCached — reply with RequestMultipleObjects (High freq)
const HIGH_OBJECT_UPDATE       = 12    // Sim → viewer: full object/avatar update (High freq)
const HIGH_OBJECT_UPDATE_TERSE = 15    // ImprovedTerseObjectUpdate — position-only (High freq)
const LOW_REGION_HANDSHAKE        = 148   // Sim → viewer: region name + terrain info (Low freq)
const LOW_AGENT_MOVEMENT_COMPLETE = 250   // Sim → viewer: confirms avatar spawn position (Low freq)
const LOW_DISABLE_SIMULATOR       = 152   // Sim → viewer: circuit terminated (Low freq)
const LOW_CHAT_FROM_SIM       = 139   // Low freq
const FIXED_PACKET_ACK        = 251   // PacketAck fixed ID

// WHY: Sim disconnects if no packets received for 60s. Send AgentUpdate every 2s when idle.
const HEARTBEAT_INTERVAL_MS = 2000

// Log every N packets to avoid flooding the debug panel
const LOG_EVERY_N_PACKETS = 20

/** Called when a UDP packet arrives from the grid sim */
export function handleUdpMessage(sessionId: string, rawBuf: Buffer): void {
	const session = getSession(sessionId)
	if (!session) return

	session.udpRxCount++

	let buf = rawBuf
	const hdr = parseHeader(buf)
	let msgEnd = buf.length

	// WHY: Sim piggybacks acks at end of packet (FLAG_HAS_ACKS=0x10). Format:
	//   [...body][ack0 BE-U32][ack1 BE-U32]...[count U8]
	// Strip acks first so zero-decode and message parse don't see garbage.
	if (hdr.hasAcks) {
		const count = buf[buf.length - 1]
		const acksSize = count * 4 + 1
		if (acksSize < buf.length) {
			const acksStart = buf.length - acksSize
			for (let i = 0; i < count; i++) {
				const ackSeq = buf.readUInt32BE(acksStart + i * 4)
				ackReceived(session, ackSeq)
			}
			msgEnd = acksStart
			buf = buf.slice(0, msgEnd)
		}
	}

	// Decode zero-coded body if needed
	if (hdr.zeroCoded) {
		const body = decodeZeroCoded(buf.slice(hdr.bodyOffset))
		buf = Buffer.concat([buf.slice(0, hdr.bodyOffset), body])
	}

	// Queue ack for reliable packets
	if (hdr.reliable) queueAck(session, hdr.seq)

	const { type, dataOffset } = parseMsgType(buf, hdr.bodyOffset)

	// Log first packet + every LOG_EVERY_N_PACKETS thereafter
	if (session.udpRxCount === 1 || session.udpRxCount % LOG_EVERY_N_PACKETS === 0) {
		slog.info(session.ws, `UDP RX #${session.udpRxCount}: type=${type} size=${rawBuf.length}b reliable=${hdr.reliable}`)
	}

	if (type === `fixed:${FIXED_PACKET_ACK}`) {
		// Sim is acking our reliable packets
		const count = buf[dataOffset]
		for (let i = 0; i < count; i++) {
			const ackSeq = buf.readUInt32LE(dataOffset + 1 + i * 4)
			if (!session.circuitEstablished) {
				// First ack from sim = circuit is live
				session.circuitEstablished = true
				slog.info(session.ws, `✓ Circuit established! Sim acked seq=${ackSeq} (udpRx=${session.udpRxCount})`)
			}
			ackReceived(session, ackSeq)
		}
		return
	}

	// WHY: StartPingCheck is sent periodically by the sim; we MUST reply with CompletePingCheck
	// or the circuit is declared dead and the viewer goes "not online" to others.
	if (type === `high:${HIGH_START_PING_CHECK}`) {
		const pingId = buf[dataOffset]
		const pkt    = encodeCompletePingCheck(pingId, nextSeq(session))
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		const wasFirst = session.lastPingAt === 0
		session.lastPingAt = Date.now()
		if (wasFirst) {
			slog.info(session.ws, `✓ First StartPingCheck received (pingId=${pingId}) — circuit keepalive active`)
		}
		return
	}

	if (type === `low:${LOW_REGION_HANDSHAKE}`) {
		// WHY: Sim sends this right after circuit established; must reply or avatar won't appear.
		// SimName field gives us the region name that OSGrid omits from the login response.
		try {
			const { simName, simAccess } = decodeRegionHandshake(buf, dataOffset)
			slog.info(session.ws, `✓ RegionHandshake: SimName="${simName}" access=${simAccess}`)
			// Reply is required
			const seq = nextSeq(session)
			const reply = encodeRegionHandshakeReply({ agentId: session.agentId, sessionId: session.sessionId, seq })
			trackReliable(session, seq, reply)
			session.udpSocket.send(reply, session.simPort, session.simIp)
			// Forward region name to browser
			session.ws.send(JSON.stringify({ t: S.REGION_INFO, d: { name: simName, access: simAccess } }))
		} catch (e) { slog.warn(session.ws, `RegionHandshake decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_AGENT_MOVEMENT_COMPLETE}`) {
		// WHY: Sim confirms avatar placed in region at authoritative position.
		// Body: AgentID(16)+SessionID(16)+Position(12=3xF32LE)+LookAt(12)+RegionHandle(8)+Timestamp(4)+ChannelVersion(V1)
		try {
			const x = buf.readFloatLE(dataOffset + 32)
			const y = buf.readFloatLE(dataOffset + 36)
			const z = buf.readFloatLE(dataOffset + 40)
			// WHY: Extract region handle from packet (more authoritative than login estimate).
			// Required for TeleportLocationRequest (user can teleport by editing LocationBar coords).
			// readBigUInt64LE at offset+56 (after position(12) + lookAt(12) = 24 bytes past +32)
			if (dataOffset + 64 <= buf.length) {
				session.regionHandle = buf.readBigUInt64LE(dataOffset + 56)
			}
			slog.info(session.ws, `✓ AgentMovementComplete: confirmed spawn pos=${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} handle=${session.regionHandle}`)
			// Forward confirmed sim-authoritative position to browser so it can correct
			// worldStore.avatarPos before the first TerseUpdate arrives.
			session.ws.send(JSON.stringify({ t: S.AGENT_SPAWN_POS, d: { pos: [x, y, z] } }))
		} catch (e) { slog.warn(session.ws, `AgentMovementComplete parse error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_DISABLE_SIMULATOR}`) {
		// Sim terminated the circuit (timeout, teleport out, admin kick, etc.)
		slog.warn(session.ws, '⚠ DisableSimulator received — sim terminated circuit')
		session.ws.send(JSON.stringify({ t: S.DISCONNECTED, d: { reason: 'Simulator terminated the circuit' } }))
		deleteSession(sessionId)
		return
	}

	if (type === `low:${LOW_CHAT_FROM_SIM}`) {
		try {
			const chat = decodeChatFromSimulator(buf, dataOffset)
			slog.info(session.ws, `Chat from "${chat.fromName}": ${chat.message.slice(0, 60)}`)
			session.ws.send(JSON.stringify({ t: S.CHAT_MSG, d: chat }))
		} catch (e) { slog.warn(session.ws, `chat decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `high:${HIGH_OBJECT_UPDATE_CACHED}`) {
		// WHY: Sim sends ObjectUpdateCached when it believes we have objects cached from a
		// previous session. Since we maintain no object cache, we request full updates for
		// all IDs. Without this, our own avatar's ObjectUpdate (pcode=47) is never received:
		// ownAvatarLocalId stays null → TerseUpdates not attributed → location bar frozen.
		try {
			const ids = decodeObjectUpdateCached(buf, dataOffset)
			if (ids.length > 0) {
				// Batch into chunks of 16 to avoid oversized packets
				const BATCH = 16
				for (let i = 0; i < ids.length; i += BATCH) {
					const chunk = ids.slice(i, i + BATCH)
					const seq = nextSeq(session)
					const pkt = encodeRequestMultipleObjects({
						agentId:   session.agentId,
						sessionId: session.sessionId,
						seq,
						ids:       chunk,
					})
					session.udpSocket.send(pkt, session.simPort, session.simIp)
				}
				if (ids.length <= 4 || !session.loggedTypes.has('objcache')) {
					session.loggedTypes.add('objcache')
					slog.info(session.ws, `[ObjCached] ${ids.length} ids → RequestMultipleObjects (first batch ids=${ids.slice(0,4).join(',')})`)
				}
			}
		} catch (e) { slog.warn(session.ws, `ObjectUpdateCached decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `high:${HIGH_OBJECT_UPDATE}`) {
		// WHY: onError callback lets decoder return partial results (objects decoded before
		// the bad one) instead of throwing and losing the whole packet.
		// onDiag logs each successful obj in multi-object packets to verify byte counts.
		// zeroCoded logged to diagnose whether zero-expand output is correct length.
		slog.info(session.ws, `[ObjUpd] zeroCoded=${hdr.zeroCoded} bufLen=${buf.length} dataOffset=${dataOffset}`)
		const objects = decodeObjectUpdate(buf, dataOffset,
			(errMsg)  => slog.warn(session.ws, `[ObjUpd] partial decode error: ${errMsg}`),
			(diagMsg) => slog.info(session.ws, `[ObjUpd:diag] ${diagMsg}`),
		)
		if (objects.length > 0) {
			slog.info(session.ws, `ObjectUpdate: ${objects.length} objects (pcodes: ${objects.map(o=>o.pcode).join(',')})`)
			session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects } }))
		} else {
			slog.warn(session.ws, `[ObjUpd] decode returned 0 objects (bufLen=${buf.length})`)
		}
		return
	}

	if (type === `high:${HIGH_OBJECT_UPDATE_TERSE}`) {
		try {
			// WHY: onRaw logs each entry before kill-sentinel filter so we can confirm whether
			// own avatar's TerseUpdates ever arrive (sentinel or valid). Critical for movement diag.
			const rawEntries: string[] = []
			const objects = decodeImprovedTerseObjectUpdate(buf, dataOffset,
				(localId, dataLen, pos, sentinel) => {
					rawEntries.push(`${localId}(dlen=${dataLen} pos=${pos.map(v=>v.toFixed(1)).join(',')} ${sentinel?'SENTINEL':''})`)
				},
			)
			if (rawEntries.length > 0) {
				slog.info(session.ws, `[TerseRaw] ${rawEntries.join(' | ')}`)
			}
			if (objects.length > 0) {
				// WHY: Log first TerseUpdate + every 50th so we can see which localIds the sim
				// is sending position updates for. Critical for diagnosing whether own-avatar
				// TerseUpdates are flowing when keys are pressed.
				if (session.udpRxCount <= 25 || session.udpRxCount % 50 === 1) {
					const ids = objects.slice(0, 5).map(o => `${o.localId}(${o.pos[0].toFixed(1)},${o.pos[1].toFixed(1)},${o.pos[2].toFixed(1)})`).join(' ')
					slog.info(session.ws, `[TerseUpd] ${objects.length} objs: ${ids}`)
				}
				session.ws.send(JSON.stringify({ t: S.TERSE_UPDATE, d: { objects } }))
			}
		} catch (e) { slog.warn(session.ws, `terseObjectUpdate decode error: ${(e as Error).message}`) }
		return
	}

	// WHY: Log each unknown packet type once so we can see if sim sends ObjectUpdateCompressed
	// (low:13), ObjectUpdateCached (low:14), or other unhandled types.
	if (!session.loggedTypes.has(type)) {
		session.loggedTypes.add(type)
		slog.info(session.ws, `[UDP] first-seen unhandled type=${type} size=${rawBuf.length}b`)
	}

	// Flush any pending acks after processing
	sendPendingAcks(session)
}

/** Called when a WS message arrives from the browser wanting to move/chat */
export function handleClientMessage(sessionId: string, msg: { t: string; d: unknown }): void {
	const session = getSession(sessionId)
	if (!session) return

	if (msg.t === C.MOVE) {
		const d = msg.d as {
			controlFlags: number
			bodyRot: [number, number, number]
			headRot: [number, number, number]
			camCenter: [number, number, number]
			camAt: [number, number, number]
			camLeft: [number, number, number]
			camUp: [number, number, number]
			far: number
		}
		// Save for heartbeat retransmit when client is idle
		session.lastAgentParams    = d
		session.lastAgentUpdateAt  = Date.now()
		const seq = nextSeq(session)
		const pkt = encodeAgentUpdate({ agentId: session.agentId, sessionId: session.sessionId, seq, ...d })
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		// WHY: Log move count so we can verify moves reach server even when cf=0.
		// Log first move, every 50th, and every non-zero cf (first per unique value).
		session.wsMoveCount = (session.wsMoveCount ?? 0) + 1
		const mc = session.wsMoveCount
		if (mc === 1 || mc % 50 === 0) {
			slog.info(session.ws, `→ MOVE #${mc} cf=0x${d.controlFlags.toString(16)} camCenter=${d.camCenter?.map(v=>v.toFixed(1)).join(',')}`)
		}
		if (d.controlFlags !== 0 && !session.loggedTypes.has(`cf:${d.controlFlags}`)) {
			session.loggedTypes.add(`cf:${d.controlFlags}`)
			slog.info(session.ws, `→ AgentUpdate controlFlags=0x${d.controlFlags.toString(16)} (first occurrence)`)
		}
		return
	}

	if (msg.t === C.TELEPORT) {
		const d = msg.d as { x: number; y: number; z: number }
		const x = Math.max(1, Math.min(255, d.x))
		const y = Math.max(1, Math.min(255, d.y))
		const z = Math.max(0.5, d.z)
		const seq = nextSeq(session)
		const pkt = encodeTeleportLocationRequest({
			agentId:      session.agentId,
			sessionId:    session.sessionId,
			seq,
			regionHandle: session.regionHandle,
			x, y, z,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ TeleportLocationRequest: ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} handle=${session.regionHandle}`)
		return
	}

	if (msg.t === C.CHAT) {
		const d = msg.d as { message: string; chatType: number; channel: number }
		const seq = nextSeq(session)
		const pkt = encodeChatFromViewer({ agentId: session.agentId, sessionId: session.sessionId, seq, ...d })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ ChatFromViewer: "${d.message.slice(0, 40)}" type=${d.chatType} ch=${d.channel}`)
		return
	}
}

/** Send an AgentUpdate heartbeat to prevent sim 60s idle timeout */
function sendHeartbeat(s: CircuitState): void {
	const now = Date.now()
	if (now - s.lastAgentUpdateAt < HEARTBEAT_INTERVAL_MS) return
	s.lastAgentUpdateAt = now

	// Use last known move data if available, else stand-still defaults.
	// WHY: camCenter is the avatar world position; [128,128,25] is generic sim-center
	// until the world engine sends real coordinates.
	const p = s.lastAgentParams ?? {
		controlFlags: 0,
		bodyRot:   [0, 0, 0] as [number, number, number],
		headRot:   [0, 0, 0] as [number, number, number],
		camCenter: [128, 128, 25] as [number, number, number],
		camAt:     [1, 0, 0] as [number, number, number],
		camLeft:   [0, 1, 0] as [number, number, number],
		camUp:     [0, 0, 1] as [number, number, number],
		far: 128,
	}
	const seq = nextSeq(s)
	const pkt = encodeAgentUpdate({ agentId: s.agentId, sessionId: s.sessionId, seq, ...p })
	s.udpSocket.send(pkt, s.simPort, s.simIp)
}

/** Start per-session retransmit + heartbeat timer. Returns cleanup fn. */
export function startCircuitTimers(sessionId: string): () => void {
	const timer = setInterval(() => {
		const s = getSession(sessionId)
		if (!s) { clearInterval(timer); return }
		retransmitOverdue(s)
		sendPendingAcks(s)
		sendHeartbeat(s)
	}, 500)
	return () => clearInterval(timer)
}

