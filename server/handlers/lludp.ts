// server/handlers/lludp.ts — UDP→WS relay: decode incoming LLUDP packets, forward to browser
import * as dgram from 'dgram'
import * as fs from 'fs'
import { getSession, deleteSession } from '../state/sessions'
import type { CircuitState } from '../state/sessions'
import {
	parseHeader, parseMsgType,
	decodeChatFromSimulator, decodeObjectUpdate, decodeImprovedTerseObjectUpdate,
	decodeObjectUpdateCached, encodeRequestMultipleObjects, decodeObjectUpdateCompressed,
	decodeRegionHandshake, decodeZeroCoded,
	encodeAgentUpdate, encodeChatFromViewer, encodeCompletePingCheck, encodeRegionHandshakeReply,
	encodeTeleportLocationRequest, encodeCompleteAgentMovement,
	decodeTeleportLocal, decodeTeleportFinish, encodeAgentSetAppearance, decodeKillObject,
	encodeImprovedInstantMessage, decodeImprovedInstantMessage,
	encodeUseCircuitCode, encodeAgentThrottle, encodeAgentHeightWidth,
	encodeObjectGrab, encodeObjectDeGrab, encodeAgentRequestSit, encodeAgentSit,
	encodeObjectSelect, encodeObjectDeselect, decodeObjectProperties,
	encodeSetAlwaysRun,
	encodeMapBlockRequest, encodeMapNameRequest, decodeMapBlockReply,
	encodeMapLayerRequest,
	decodeOnlineNotification, decodeUUIDNameReply,
	decodeAvatarPropertiesReply, decodeAvatarInterestsReply, decodeAvatarGroupsReply,
	decodeAgentGroupDataUpdate, decodeAgentDataUpdate, decodeParcelInfoReply,
	encodeAvatarPropertiesRequest, encodeParcelInfoRequest, encodeUUIDNameRequest,
	encodeAcceptFriendship, encodeDeclineFriendship, encodeTerminateFriendship, encodeChangeUserRights,
} from '../lib/lludp-codec'
import { queueAck, nextSeq, trackReliable, ackReceived, retransmitOverdue, sendPendingAcks } from '../lib/circuit'
import { slog } from '../lib/serverLog'
import { S, C } from '../../shared/protocol.js'
import { decodeLayerData } from '../lib/terrain-codec.js'
import { replayCachedWorld } from '../lib/resync'

// Message type codes — verified against phoenix-firestorm/scripts/messages/message_template.msg
// WHY: High-freq = 1-byte prefix. Medium-freq = 0xFF + 1-byte ID. Low-freq = 0xFF 0xFF + U16LE.
// Earlier code had MEDIUM_LAYER_DATA=6 (wrong — Medium 6 is CoarseLocationUpdate, not terrain)
// and HIGH_OBJECT_UPDATE_CACHED=11 (wrong — High 11 is LayerData; ObjectUpdateCached is High 14).
// Both bugs caused terrain to never decode and ObjectUpdateCached to fire on terrain packets.
const HIGH_START_PING_CHECK    = 1     // Sim → viewer: keepalive ping (High freq, 1-byte prefix)
const HIGH_LAYER_DATA          = 11    // LayerData (terrain patches) — High freq, msg ID 11
const HIGH_OBJECT_UPDATE       = 12    // Sim → viewer: full object/avatar update (High freq)
const HIGH_OBJECT_UPDATE_COMPRESSED = 13  // Sim → viewer: ObjectUpdateCompressed (High freq, common for ReqMulti replies)
const HIGH_OBJECT_UPDATE_CACHED= 14    // ObjectUpdateCached — reply with RequestMultipleObjects (High freq)
const HIGH_OBJECT_UPDATE_TERSE = 15    // ImprovedTerseObjectUpdate — position-only (High freq)
const HIGH_KILL_OBJECT         = 16    // Sim → viewer: remove these localIds from scene (High freq)
const LOW_REGION_HANDSHAKE        = 148   // Sim → viewer: region name + terrain info (Low freq)
const LOW_AGENT_MOVEMENT_COMPLETE = 250   // Sim → viewer: confirms avatar spawn position (Low freq)
const LOW_DISABLE_SIMULATOR       = 152   // Sim → viewer: circuit terminated (Low freq)
const LOW_CHAT_FROM_SIM       = 139   // Low freq
const LOW_TELEPORT_LOCAL      = 64    // Sim → viewer: same-region TP completed (Low freq)
const LOW_IMPROVED_INSTANT_MSG= 254   // ImprovedInstantMessage — both directions (Low freq)
const LOW_TELEPORT_FINISH     = 69    // Sim → viewer: cross-sim TP, new circuit needed (Low freq)
const LOW_MAP_BLOCK_REPLY     = 409   // Sim → viewer: world-map region entries (Low freq)
const LOW_MAP_LAYER_REPLY     = 406   // Sim → viewer: map layer info — alive-probe response
const FIXED_PACKET_ACK        = 251   // PacketAck fixed ID
const MEDIUM_COARSE_LOCATION_UPDATE = 6  // CoarseLocationUpdate (minimap positions) — Medium freq, msg ID 6
const MEDIUM_OBJECT_PROPERTIES      = 9  // ObjectProperties — sim's reply to ObjectSelect (Medium freq)
// ── Social (Phase 3) inbound Low-freq message IDs ──
const LOW_PARCEL_INFO_REPLY         = 55   // ParcelInfoReply (Zerocoded)
const LOW_AVATAR_PROPERTIES_REPLY   = 171  // AvatarPropertiesReply (Zerocoded)
const LOW_AVATAR_INTERESTS_REPLY    = 172  // AvatarInterestsReply (Zerocoded)
const LOW_AVATAR_GROUPS_REPLY       = 173  // AvatarGroupsReply (Zerocoded)
const LOW_UUID_NAME_REPLY           = 236  // UUIDNameReply
const LOW_ONLINE_NOTIFICATION       = 322  // OnlineNotification
const LOW_OFFLINE_NOTIFICATION      = 323  // OfflineNotification
const LOW_AGENT_DATA_UPDATE         = 387  // AgentDataUpdate (Zerocoded) — self active group/title
const LOW_AGENT_GROUP_DATA_UPDATE   = 389  // AgentGroupDataUpdate (Zerocoded) — self group list

// WHY: Sim disconnects if no packets received for 60s. Send AgentUpdate every 2s when idle.
const HEARTBEAT_INTERVAL_MS = 2000
// WHY: 65s — sim kicks idle circuits at 60s. If we've received packets before (circuitEstablished)
// and then see silence for 65s, the sim dropped the circuit without sending DisableSimulator.
const SIM_IDLE_TIMEOUT_MS = 65_000

// Log every N packets to avoid flooding the debug panel
const LOG_EVERY_N_PACKETS = 20

/**
 * Cross-region teleport — swap session's UDP socket onto the new sim and replay the
 * circuit handshake (UseCircuitCode + CompleteAgentMovement + AgentThrottle + AgentHeightWidth).
 * agentId/sessionId/circuitCode are preserved across the hop — only sim addr changes.
 * Caps are cleared; the new seed cap is fetched 3s later (same convention as login.ts).
 */
function swapCircuit(sessionId: string, newSimIp: string, newSimPort: number, newRegionHandle: bigint, newSeedCap: string): void {
	const session = getSession(sessionId)
	if (!session) return
	const ws = session.ws

	slog.info(ws, `↻ swapCircuit: ${session.simIp}:${session.simPort} → ${newSimIp}:${newSimPort}`)

	// Tear down old socket; in-flight reliable packets are abandoned by design (new sim
	// won't ack them, so retransmission would loop forever).
	try { session.udpSocket.close() } catch { /* already closed */ }
	session.reliableOut.clear()
	session.pendingAcks.length = 0
	session.objCache.clear()
	session.terrainCache.clear()
	session.caps.clear()
	session.seqNum = 0
	session.lastPingAt = 0
	session.lastUdpRxAt = Date.now()
	session.circuitEstablished = false
	session.simIp = newSimIp
	session.simPort = newSimPort
	session.regionHandle = newRegionHandle
	// WHY: cachedLoginOk is what gets replayed on WS reconnect. Without updating it, a page
	// reload after cross-region TP would re-attach to the OLD sim's circuit — but our local
	// state already swapped. Update sim addr + seed cap; region name comes from new
	// RegionHandshake (cachedRegionName updated in the handler when it arrives).
	if (session.cachedLoginOk) {
		session.cachedLoginOk.simIp   = newSimIp
		session.cachedLoginOk.simPort = newSimPort
		session.cachedLoginOk.seedCap = newSeedCap
		session.cachedLoginOk.regionX = Number(newRegionHandle & 0xFFFFFFFFn)
		session.cachedLoginOk.regionY = Number(newRegionHandle >> 32n)
	}

	const newSock = dgram.createSocket('udp4')
	session.udpSocket = newSock
	newSock.on('message', (msg: Buffer) => handleUdpMessage(sessionId, msg))
	newSock.on('error', (err: Error) => {
		slog.error(ws, `[swap] UDP socket error: ${err.message}`)
		deleteSession(sessionId)
	})
	newSock.bind(0, '0.0.0.0', () => {
		slog.info(ws, `[swap] UDP socket bound (local port ${newSock.address().port}) → ${newSimIp}:${newSimPort}`)
		const seq1 = nextSeq(session)
		const useCircuit = encodeUseCircuitCode({
			agentId: session.agentId, sessionId: session.sessionId,
			circuitCode: session.circuitCode, seq: seq1,
		})
		trackReliable(session, seq1, useCircuit)
		newSock.send(useCircuit, newSimPort, newSimIp)

		const seq2 = nextSeq(session)
		const completeMove = encodeCompleteAgentMovement({
			agentId: session.agentId, sessionId: session.sessionId,
			circuitCode: session.circuitCode, seq: seq2,
		})
		trackReliable(session, seq2, completeMove)
		newSock.send(completeMove, newSimPort, newSimIp)

		const seq3 = nextSeq(session)
		const throttlePkt = encodeAgentThrottle({
			agentId: session.agentId, sessionId: session.sessionId,
			circuitCode: session.circuitCode, seq: seq3,
		})
		trackReliable(session, seq3, throttlePkt)
		newSock.send(throttlePkt, newSimPort, newSimIp)

		const seq4 = nextSeq(session)
		const hwPkt = encodeAgentHeightWidth({
			agentId: session.agentId, sessionId: session.sessionId,
			circuitCode: session.circuitCode, seq: seq4,
		})
		newSock.send(hwPkt, newSimPort, newSimIp)

		slog.info(ws, `[swap] handshake sent (UseCircuitCode+CompleteAgentMovement+AgentThrottle+AgentHeightWidth)`)
	})

	// Same 3s convention as login: POST to new seed cap so SentSeeds flag flips.
	if (newSeedCap) {
		setTimeout(async () => {
			try {
				const res = await fetch(newSeedCap, {
					method: 'POST',
					headers: { 'Content-Type': 'application/llsd+xml' },
					body: '<?xml version="1.0"?>\n<llsd><array><string>RebakeAvatarTextures</string></array></llsd>',
				})
				slog.info(ws, `[swap] ✓ new seed cap fetched (${res.status})`)
				const xml = await res.text()
				const m = xml.match(/RebakeAvatarTextures<\/key>\s*<string>([^<]+)<\/string>/)
				const s = getSession(sessionId)
				if (s && m) s.caps.set('RebakeAvatarTextures', m[1].trim())
			} catch (e) {
				slog.warn(ws, `[swap] seed cap fetch failed: ${(e as Error).message}`)
			}
		}, 3000)
	}
}

/** Called when a UDP packet arrives from the grid sim */
export function handleUdpMessage(sessionId: string, rawBuf: Buffer): void {
	const session = getSession(sessionId)
	if (!session) return

	session.udpRxCount++
	session.lastUdpRxAt = Date.now()

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

	// Per-type RX counter for prim-dropout investigation. Lets us compare sim send vs
	// decode-success vs relay-out rates across message types (#12 ObjectUpdate, #13
	// ObjectUpdateCompressed, #14 ObjectUpdateCached, #15 ImprovedTerseObjectUpdate, etc).
	session.msgRxCounts.set(type, (session.msgRxCounts.get(type) ?? 0) + 1)

	// Periodic 5s summary so we can compute boundary drop rates without grep-fu.
	const _now = Date.now()
	if (_now - session.lastDiagLogAt >= 5000) {
		session.lastDiagLogAt = _now
		// Show object-stream message types prominently; also dump full map so unknown types
		// (e.g. high:13 ObjectUpdateCompressed which has no handler) appear in summary.
		const PRIM_TYPES = ['high:12', 'high:13', 'high:14', 'high:15']
		const primParts = PRIM_TYPES.map(t => `${t}=${session.msgRxCounts.get(t) ?? 0}`)
		const other: string[] = []
		for (const [k, v] of session.msgRxCounts) {
			if (!PRIM_TYPES.includes(k)) other.push(`${k}=${v}`)
		}
		const counts = [...primParts, ...other]
		// Camera pos (SL coords) from last MOVE so we can correlate distinct-count rise
		// vs avatar movement / camera rotation. camAt vector reveals facing direction
		// (sim interest-list cone is camera-facing-aware).
		const camP = session.lastAgentParams?.camCenter
		const camA = session.lastAgentParams?.camAt
		const camStr = camP
			? `cam=${camP[0].toFixed(0)},${camP[1].toFixed(0)},${camP[2].toFixed(0)} at=${camA?.[0].toFixed(2)},${camA?.[1].toFixed(2)}`
			: 'cam=?'
		// Unfulfilled = asked-via-ReqMulti minus received-as-ObjectUpdate. Sample first 5
		// so user can `grep <localId> server-log.txt` and confirm "asked but sim ignored".
		let unfulfilledCount = 0
		const unfulfilledSample: number[] = []
		for (const id of session.cacheMissAskedEver) {
			if (!session.distinctLocalIds.has(id)) {
				unfulfilledCount++
				if (unfulfilledSample.length < 5) unfulfilledSample.push(id)
			}
		}
		slog.info(session.ws,
			`[PrimDiag] rx{${counts.join(' ')}} decoded=${session.objDecodedCount} relayed=${session.objRelayedCount} ` +
			`distinct=${session.distinctLocalIds.size} asked=${session.cacheMissAskedEver.size} reqMulti=${session.reqMultiOutCount}batches/${session.reqMultiIdsCount}ids ` +
			`pending=${session.cacheMissPending.length} retryPending=${session.cacheMissRetryPending.length} unfulfilled=${unfulfilledCount}(${unfulfilledSample.join(',')}) ${camStr}`)
	}

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
			// Cache for resync replays (HMR / page reload / manual "Resync World")
			session.cachedRegionName   = simName
			session.cachedRegionAccess = simAccess
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
			// Cache for resync replays
			session.cachedSpawnPos = [x, y, z]
			// Forward confirmed sim-authoritative position to browser so it can correct
			// worldStore.avatarPos before the first TerseUpdate arrives.
			session.ws.send(JSON.stringify({ t: S.AGENT_SPAWN_POS, d: { pos: [x, y, z] } }))

			// WHY: AgentSetAppearance NOT sent here despite being tempting for physics.
			// OpenSim source confirms: appearance pipeline does NOT gate PhysicsActor creation.
			// Sending with empty TextureEntry (our minimal stub) sets avatar texture data to null
			// → all other viewers see avatar as invisible cloud. STAND_UP alone handles PhysicsActor.

			// WHY: Send AgentUpdate with AGENT_CONTROL_STAND_UP (0x00080000) once after
			// AgentMovementComplete. OpenSim source (ScenePresence.cs line 2650):
			//   if ((allFlags & ACFlags.AGENT_CONTROL_STAND_UP) != 0) StandUp();
			// StandUp() calls AddToPhysicalScene(false) if PhysicsActor == null (line 3226).
			// Root cause of "walk anim, no movement": avatar was seated in previous session
			// (ParentID != 0) → MakeRootAgent skips AddToPhysicalScene → PhysicsActor stays
			// null → HandleAgentUpdate gates at actor==null, TargetVelocity never set.
			// STAND_UP is safe when already standing: StandUp() skips AddToPhysics if actor≠null.
			const CTRL_STAND_UP = 0x00080000
			const standParams = session.lastAgentParams ?? {
				controlFlags: 0, bodyRot: [0, 0, 0] as [number, number, number],
				headRot:   [0, 0, 0] as [number, number, number],
				camCenter: [128, 128, 25] as [number, number, number],
				camAt:     [1, 0, 0] as [number, number, number],
				camLeft:   [0, 1, 0] as [number, number, number],
				camUp:     [0, 0, 1] as [number, number, number], far: 128,
			}
			const seqS = nextSeq(session)
			const standPkt = encodeAgentUpdate({
				agentId: session.agentId, sessionId: session.sessionId, seq: seqS,
				...standParams, controlFlags: CTRL_STAND_UP,
			})
			session.udpSocket.send(standPkt, session.simPort, session.simIp)
			slog.info(session.ws, `→ AgentUpdate STAND_UP sent (seq=${seqS}) — force AddToPhysicalScene`)
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

	if (type === `low:${LOW_IMPROVED_INSTANT_MSG}`) {
		try {
			const im = decodeImprovedInstantMessage(buf, dataOffset)
			slog.info(session.ws, `IM from "${im.fromAgentName}" dialog=${im.dialog}: ${im.message.slice(0, 60)}`)
			session.ws.send(JSON.stringify({ t: S.IM_RECV, d: im }))
		} catch (e) {
			slog.warn(session.ws, `IM decode error: ${(e as Error).message}`)
		}
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

	if (type === `high:${HIGH_OBJECT_UPDATE_COMPRESSED}`) {
		// MVP decoder — fixed prefix only (pos/rot/scale/pcode/fullId/localId). Shape defaults
		// to cube on client. Adequate to surface ~2000 prims sim sends as Compressed replies
		// to RequestMultipleObjects when cache-miss volume is high.
		try {
			const objects = decodeObjectUpdateCompressed(buf, dataOffset,
				(errMsg) => slog.warn(session.ws, `[ObjCompressed] partial: ${errMsg}`))
			if (objects.length > 0) {
				session.objDecodedCount += objects.length
				for (const o of objects) {
					if (typeof o.localId === 'number') {
						session.objCache.set(o.localId, o)
						session.distinctLocalIds.add(o.localId)
						const idx = session.cacheMissPending.indexOf(o.localId)
						if (idx >= 0) session.cacheMissPending.splice(idx, 1)
					}
				}
				session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects } }))
				session.objRelayedCount += objects.length
				if (!session.loggedTypes.has('objcompressed')) {
					session.loggedTypes.add('objcompressed')
					slog.info(session.ws, `[ObjCompressed] first decode: ${objects.length} objects, localIds=${objects.slice(0,3).map(o=>o.localId).join(',')}`)
				}
			}
		} catch (e) { slog.warn(session.ws, `ObjectUpdateCompressed decode error: ${(e as Error).message}`) }
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
				// WHY: Sim's EntityUpdateQueue aged out RequestMultipleObjects entries when we
				// bursted 348 batches in <5s — only 113/4792 returned. Enqueue here, drain at
				// paced rate via heartbeat timer (drainCacheMissQueue). Skip IDs already
				// fulfilled (in objCache) and any already queued (cheap O(n) check; pending
				// list typically stays small after drain).
				let enqueued = 0
				for (const id of ids) {
					if (session.objCache.has(id)) continue
					if (session.cacheMissPending.includes(id)) continue
					session.cacheMissPending.push(id)
					enqueued++
				}
				if (enqueued > 0) session.lastCacheEnumAt = Date.now()
				if (!session.loggedTypes.has('objcache')) {
					session.loggedTypes.add('objcache')
					slog.info(session.ws, `[ObjCached] +${ids.length} ids enqueued (pending=${session.cacheMissPending.length})`)
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
			session.objDecodedCount += objects.length
			// Cache by localId for resync replay (page reload / "Resync World").
			// Drop from cache-miss queue — sim just fulfilled the request so we don't need to ask again.
			for (const o of objects) {
				if (typeof o.localId === 'number') {
					session.objCache.set(o.localId, o)
					session.distinctLocalIds.add(o.localId)
					const idx = session.cacheMissPending.indexOf(o.localId)
					if (idx >= 0) session.cacheMissPending.splice(idx, 1)
				}
			}
			session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects } }))
			session.objRelayedCount += objects.length
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
				// Update cached position so a resync replay reflects current state, not the
				// stale spawn position from the first ObjectUpdate.
				for (const o of objects) {
					const cached = session.objCache.get(o.localId) as { pos?: [number, number, number] } | undefined
					if (cached) cached.pos = o.pos
				}
				session.ws.send(JSON.stringify({ t: S.TERSE_UPDATE, d: { objects } }))
			}
		} catch (e) { slog.warn(session.ws, `terseObjectUpdate decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `high:${HIGH_KILL_OBJECT}`) {
		// WHY: Sim sends KillObject when prims, avatars, or NPCs leave the region or are deleted.
		// Without this, they stay in our Three.js scene and Pinia worldStore indefinitely.
		try {
			const ids = decodeKillObject(buf, dataOffset)
			if (ids.length > 0) {
				slog.info(session.ws, `[KillObj] removing ${ids.length} localIds: ${ids.slice(0, 4).join(',')}${ids.length > 4 ? '…' : ''}`)
				// Drop from object cache too — otherwise resync would re-add killed objects.
				for (const id of ids) session.objCache.delete(id)
				session.ws.send(JSON.stringify({ t: S.KILL_OBJECT, d: { ids } }))
			}
		} catch (e) { slog.warn(session.ws, `KillObject decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `high:${HIGH_LAYER_DATA}`) {
		// WHY: LayerData is High 11. Body layout at dataOffset (= bodyOffset+1 = 7):
		//   [0] LayerID.Type U8 — layer type byte (0x4C='L' for LAND, etc.)
		//   [1] DataBlock.LayerType U8 — same type value repeated (LLUDP Single-block layout)
		//   [2..3] DataBlock.Data.Length U16LE — byte count of terrain data payload
		//   [4+] DataBlock.Data — group header (stride U16, patchSize U8, layerType U8) + bit-packed patches
		// terrain-codec.ts tries two-type layout ([0]=type, [2..3]=dataLen, [4+]=data) first,
		// falls back to single-type layout ([0]=type, [1..2]=dataLen, [3+]=data) if it overruns.
		// body24 will show which layout the sim uses: two same bytes at [0..1] → two-type.
		const typeB = dataOffset < buf.length ? `0x${buf[dataOffset].toString(16).padStart(2,'0')}` : '??'
		const raw10 = Array.from(rawBuf.slice(0, Math.min(10, rawBuf.length)))
			.map(b => b.toString(16).padStart(2, '0')).join(' ')
		const body24 = Array.from(buf.slice(dataOffset, Math.min(dataOffset + 24, buf.length)))
			.map(b => b.toString(16).padStart(2, '0')).join(' ')
		slog.info(session.ws, `[terrain] high:11 rx size=${rawBuf.length}b typeB=${typeB} raw10=[${raw10}] body24=[${body24}]`)
		const result = decodeLayerData(buf, dataOffset, session.ws)
		if (!result) {
			slog.warn(session.ws, `[terrain] decode returned null for typeB=${typeB}`)
			return
		}
		if (result.patches.length === 0) {
			slog.warn(session.ws, `[terrain] ${result.type} decoded but 0 patches (patchSize=${result.patchSize})`)
			return
		}
		// WHY: Log first patch coords/height to confirm IDCT output is plausible.
		// dcOffset should be ~20-100m for normal sims. range typically 0-256m.
		// Heights in 0-300m = valid. NaN/Inf/huge = decode bug.
		const p0 = result.patches[0]
		const h0 = p0.heights[0].toFixed(2)
		const hN = p0.heights[p0.heights.length - 1].toFixed(2)
		// WHY: Diagnostic for [[terrain-decoder-missing-patches]] — full key list per
		// packet so we can compare codec emit set vs client patchReceived set and find
		// which (px,py) the decoder is silently dropping.
		const keyList = result.patches.map(p => `${p.x},${p.y}`).join(' ')
		slog.info(session.ws, `[terrain] ${result.type} patches=${result.patches.length} patchSize=${result.patchSize} first=[${p0.x},${p0.y}] h0=${h0}m hN=${hN}m keys=[${keyList}]`)
		const wirePatches = result.patches.map(p => ({
			x: p.x,
			y: p.y,
			heights: Array.from(p.heights),
		}))
		// Cache LAND patches for resync replays. WATER plane is fixed flat so skip.
		if (result.type === 'LAND') {
			for (const p of wirePatches) {
				session.terrainCache.set(`${p.x},${p.y}`, {
					patchSize: result.patchSize,
					x: p.x,
					y: p.y,
					heights: p.heights,
				})
			}
			slog.info(session.ws, `[terrain] cache size after packet: ${session.terrainCache.size}`)
		}
		session.ws.send(JSON.stringify({
			t: S.TERRAIN_PATCH,
			d: {
				layerType: result.type,
				patchSize: result.patchSize,
				patches: wirePatches,
			},
		}))
		return
	}

	if (type === `med:${MEDIUM_OBJECT_PROPERTIES}`) {
		try {
			const items = decodeObjectProperties(buf, dataOffset)
			if (items.length > 0) {
				slog.info(session.ws, `[ObjProps] ${items.length} object(s) — first: "${items[0].name || '(unnamed)'}" owner=${items[0].ownerId.slice(0,8)}…`)
				// Serialize bigints (creationDate) for JSON wire safety
				const serial = items.map(i => ({ ...i, creationDate: i.creationDate.toString() }))
				session.ws.send(JSON.stringify({ t: S.OBJECT_PROPS, d: { items: serial } }))
			}
		} catch (e) {
			slog.warn(session.ws, `ObjectProperties decode error: ${(e as Error).message}`)
		}
		return
	}

	if (type === `med:${MEDIUM_COARSE_LOCATION_UPDATE}`) {
		// WHY: CoarseLocationUpdate (Medium 6) arrives every ~4.5s with approximate avatar positions
		// for the minimap. Body: locCount U8 | [X U8, Y U8, Z U8]×N | You S16 | Prey S16 |
		// agentCount U8 | [AgentID UUID(16)]×N. X/Y = region metres (0-255). Z = metres/4 (0xFF=unknown).
		// You/Prey are indices into the Locations array identifying self and tracked target.
		try {
			const locCount = buf[dataOffset]
			const locs: { x: number; y: number; z: number }[] = []
			let off = dataOffset + 1
			for (let i = 0; i < locCount && off + 3 <= buf.length; i++, off += 3) {
				locs.push({ x: buf[off], y: buf[off + 1], z: buf[off + 2] === 0xFF ? -1 : buf[off + 2] * 4 })
			}
			// Log once so we can confirm body parsing is correct
			if (!session.loggedTypes.has('coarse_loc')) {
				session.loggedTypes.add('coarse_loc')
				slog.info(session.ws, `[CoarseLoc] first rx: ${locCount} avatar(s) ${locs.map(l => `(${l.x},${l.y},${l.z === -1 ? '?m' : l.z + 'm'})`).join(' ')}`)
			}
		} catch (e) { slog.warn(session.ws, `CoarseLocationUpdate decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_TELEPORT_LOCAL}`) {
		// WHY: TeleportLocal = same-region teleport completed. Sim sends new position within
		// current circuit; no new UDP circuit needed. Just update avatar position.
		// Body: AgentID(16) + LocationID(4) + Position(LLVector3) + LookAt(LLVector3) + TeleportFlags(4)
		try {
			const { pos, lookAt } = decodeTeleportLocal(buf, dataOffset)
			slog.info(session.ws, `✓ TeleportLocal: pos=${pos[0].toFixed(1)},${pos[1].toFixed(1)},${pos[2].toFixed(1)} lookAt=${lookAt[0].toFixed(2)},${lookAt[1].toFixed(2)},${lookAt[2].toFixed(2)}`)
			// Cache for resync replays
			session.cachedSpawnPos = pos as [number, number, number]
			// Forward to browser as a position update (same as AgentMovementComplete)
			session.ws.send(JSON.stringify({ t: S.AGENT_SPAWN_POS, d: { pos } }))
		} catch (e) { slog.warn(session.ws, `TeleportLocal decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_TELEPORT_FINISH}`) {
		// WHY: TeleportFinish = cross-region teleport (or same-region TP on some OpenSim grids).
		// For same sim IP/port: re-send CompleteAgentMovement; sim replies with AgentMovementComplete.
		// For different sim: forward to browser for future cross-sim reconnection (Phase 2).
		try {
			const { simIp, simPort, regionHandle, seedCap, simAccess } = decodeTeleportFinish(buf, dataOffset)
			slog.info(session.ws, `✓ TeleportFinish: ${simIp}:${simPort} handle=${regionHandle} access=${simAccess} cap=${seedCap.slice(0, 40)}…`)

			const sameSim = simIp === session.simIp && simPort === session.simPort
			if (sameSim) {
				// WHY: Same sim = position teleport within current circuit. Re-send CompleteAgentMovement
				// so the sim re-places the avatar at the destination. AgentMovementComplete reply
				// will arrive with new position and we forward it to the browser via AGENT_SPAWN_POS.
				session.regionHandle = regionHandle
				const seq = nextSeq(session)
				const pkt = encodeCompleteAgentMovement({ agentId: session.agentId, sessionId: session.sessionId, circuitCode: session.circuitCode, seq })
				trackReliable(session, seq, pkt)
				session.udpSocket.send(pkt, session.simPort, session.simIp)
				slog.info(session.ws, `→ CompleteAgentMovement re-sent (same sim) — awaiting AgentMovementComplete at new pos`)
			} else {
				// WHY: Different sim = true cross-region teleport. Swap UDP socket onto new sim,
				// replay circuit handshake (UseCircuitCode + CompleteAgentMovement + AgentThrottle +
				// AgentHeightWidth). agentId/sessionId/circuitCode preserved by SL protocol.
				// Notify browser so client clears the scene + waits for new RegionHandshake.
				slog.info(session.ws, `TeleportFinish cross-sim → ${simIp}:${simPort} — swapping circuit`)
				session.ws.send(JSON.stringify({
					t: S.TELEPORT_FINISH,
					d: { simIp, simPort, regionHandle: regionHandle.toString(), seedCap, simAccess },
				}))
				swapCircuit(sessionId, simIp, simPort, regionHandle, seedCap)
			}
		} catch (e) { slog.warn(session.ws, `TeleportFinish decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_MAP_LAYER_REPLY}`) {
		slog.info(session.ws, `[MapLayer] reply received — map pipeline alive (size=${rawBuf.length}b)`)
		return
	}

	if (type === `low:${LOW_MAP_BLOCK_REPLY}`) {
		try {
			const blocks = decodeMapBlockReply(buf, dataOffset)
			// Log every reply (incl. empty) for diagnostics until map proven stable.
			const hex = buf.slice(dataOffset, Math.min(dataOffset + 40, buf.length)).toString('hex')
			slog.info(session.ws,
				`[MapBlocks] rx ${blocks.length} block(s) bufLen=${buf.length} hex[${hex}]` +
				(blocks.length > 0 ? ` first="${blocks[0].name}"(${blocks[0].regionX},${blocks[0].regionY}) access=${blocks[0].access}` : ''))
			if (blocks.length > 0) {
				session.ws.send(JSON.stringify({ t: S.MAP_BLOCKS, d: { blocks } }))
			}
		} catch (e) { slog.warn(session.ws, `MapBlockReply decode error: ${(e as Error).message}`) }
		return
	}

	// ══ Social (Phase 3) — friends / profile / groups / parcel ════════════════
	if (type === `low:${LOW_ONLINE_NOTIFICATION}` || type === `low:${LOW_OFFLINE_NOTIFICATION}`) {
		try {
			const online = type === `low:${LOW_ONLINE_NOTIFICATION}`
			const ids = decodeOnlineNotification(buf, dataOffset)
			if (ids.length) {
				slog.info(session.ws, `[Friends] ${online ? 'online' : 'offline'}: ${ids.length} id(s)`)
				session.ws.send(JSON.stringify({ t: S.FRIEND_STATUS, d: { online, ids } }))
			}
		} catch (e) { slog.warn(session.ws, `OnlineNotification decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_UUID_NAME_REPLY}`) {
		try {
			const pairs = decodeUUIDNameReply(buf, dataOffset)
			if (pairs.length) {
				const names: Record<string, string> = {}
				for (const p of pairs) names[p.id] = p.name
				session.ws.send(JSON.stringify({ t: S.NAME_REPLY, d: { names } }))
			}
		} catch (e) { slog.warn(session.ws, `UUIDNameReply decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_AVATAR_PROPERTIES_REPLY}`) {
		try {
			const props = decodeAvatarPropertiesReply(buf, dataOffset)
			session.ws.send(JSON.stringify({ t: S.AVATAR_PROPS, d: { avatarId: props.avatarId, properties: props } }))
		} catch (e) { slog.warn(session.ws, `AvatarPropertiesReply decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_AVATAR_INTERESTS_REPLY}`) {
		try {
			const interests = decodeAvatarInterestsReply(buf, dataOffset)
			session.ws.send(JSON.stringify({ t: S.AVATAR_PROPS, d: { avatarId: interests.avatarId, interests } }))
		} catch (e) { slog.warn(session.ws, `AvatarInterestsReply decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_AVATAR_GROUPS_REPLY}`) {
		try {
			const { avatarId, groups } = decodeAvatarGroupsReply(buf, dataOffset)
			session.ws.send(JSON.stringify({ t: S.AVATAR_PROPS, d: { avatarId, groups } }))
		} catch (e) { slog.warn(session.ws, `AvatarGroupsReply decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_AGENT_GROUP_DATA_UPDATE}`) {
		try {
			const { groups } = decodeAgentGroupDataUpdate(buf, dataOffset)
			slog.info(session.ws, `[Groups] self group list: ${groups.length} group(s)`)
			session.ws.send(JSON.stringify({ t: S.SELF_GROUPS, d: { groups } }))
		} catch (e) { slog.warn(session.ws, `AgentGroupDataUpdate decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_AGENT_DATA_UPDATE}`) {
		try {
			const d = decodeAgentDataUpdate(buf, dataOffset)
			// WHY: only forward when it concerns our own agent (sim also routes others' updates).
			// Compare case-insensitively — login agentId casing may differ from decoded UUID.
			if (d.agentId.toLowerCase() === session.agentId.toLowerCase()) {
				session.ws.send(JSON.stringify({ t: S.AGENT_DATA, d: {
					activeGroupId: d.activeGroupId, groupTitle: d.groupTitle, groupName: d.groupName, groupPowers: d.groupPowers,
				} }))
			}
		} catch (e) { slog.warn(session.ws, `AgentDataUpdate decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_PARCEL_INFO_REPLY}`) {
		try {
			const parcel = decodeParcelInfoReply(buf, dataOffset)
			slog.info(session.ws, `[Parcel] "${parcel.name}" area=${parcel.actualArea} sim="${parcel.simName}"`)
			session.ws.send(JSON.stringify({ t: S.PARCEL_INFO, d: { parcel } }))
		} catch (e) { slog.warn(session.ws, `ParcelInfoReply decode error: ${(e as Error).message}`) }
		return
	}

	// WHY: Log each unknown packet type once so we can detect unhandled messages.
	// Handled: high:1,11,12,14,15,16 med:6 low:64,69,139,148,152,250 fixed:251.
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
		// WHY: Client sometimes sends nulls in cam vectors before camera fully initializes
		// (e.g. first MOVE after login, before WorldEngine has computed yaw/pos). Coerce to
		// 0 so encodeAgentUpdate writes valid floats and logging can't crash on null.toFixed.
		const safeVec = (v: unknown): [number, number, number] => {
			if (!Array.isArray(v)) return [0, 0, 0]
			return [
				typeof v[0] === 'number' ? v[0] : 0,
				typeof v[1] === 'number' ? v[1] : 0,
				typeof v[2] === 'number' ? v[2] : 0,
			]
		}
		d.bodyRot   = safeVec(d.bodyRot)
		d.headRot   = safeVec(d.headRot)
		d.camCenter = safeVec(d.camCenter)
		d.camAt     = safeVec(d.camAt)
		d.camLeft   = safeVec(d.camLeft)
		d.camUp     = safeVec(d.camUp)
		if (typeof d.far !== 'number') d.far = 64
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
			// WHY: camCenter array may contain nulls (client cam not initialized yet). Guard
			// per-element so logging can't crash the handler. Previously `v.toFixed(1)` on null
			// threw TypeError that killed Bun's WebSocket message handler.
			const fmtVec = (v: unknown): string => {
				if (!Array.isArray(v)) return String(v)
				return v.map(c => (typeof c === 'number' ? c.toFixed(1) : '?')).join(',')
			}
			slog.info(session.ws, `→ MOVE #${mc} cf=0x${d.controlFlags.toString(16)} camCenter=${fmtVec(d.camCenter)}`)
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

	if (msg.t === C.OBJECT_SELECT) {
		const d = msg.d as { localIds: number[] }
		if (!d.localIds?.length) return
		const seq = nextSeq(session)
		const pkt = encodeObjectSelect({ agentId: session.agentId, sessionId: session.sessionId, seq, localIds: d.localIds })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ ObjectSelect ${d.localIds.length} id(s) — awaiting ObjectProperties reply`)
		return
	}

	if (msg.t === C.OBJECT_DESELECT) {
		const d = msg.d as { localIds: number[] }
		if (!d.localIds?.length) return
		const seq = nextSeq(session)
		const pkt = encodeObjectDeselect({ agentId: session.agentId, sessionId: session.sessionId, seq, localIds: d.localIds })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		return
	}

	if (msg.t === C.SET_ALWAYS_RUN) {
		const d = msg.d as { alwaysRun: boolean }
		const seq = nextSeq(session)
		const pkt = encodeSetAlwaysRun({ agentId: session.agentId, sessionId: session.sessionId, seq, alwaysRun: !!d.alwaysRun })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ SetAlwaysRun ${d.alwaysRun ? 'true' : 'false'}`)
		return
	}

	if (msg.t === C.OBJECT_TOUCH) {
		const d = msg.d as { localId: number }
		const seqA = nextSeq(session)
		const grab = encodeObjectGrab({ agentId: session.agentId, sessionId: session.sessionId, seq: seqA, localId: d.localId })
		trackReliable(session, seqA, grab)
		session.udpSocket.send(grab, session.simPort, session.simIp)
		const seqB = nextSeq(session)
		const degrab = encodeObjectDeGrab({ agentId: session.agentId, sessionId: session.sessionId, seq: seqB, localId: d.localId })
		trackReliable(session, seqB, degrab)
		session.udpSocket.send(degrab, session.simPort, session.simIp)
		slog.info(session.ws, `→ ObjectGrab+DeGrab localId=${d.localId}`)
		return
	}

	if (msg.t === C.OBJECT_SIT) {
		const d = msg.d as { targetId: string }
		const seqA = nextSeq(session)
		const req = encodeAgentRequestSit({ agentId: session.agentId, sessionId: session.sessionId, seq: seqA, targetId: d.targetId })
		trackReliable(session, seqA, req)
		session.udpSocket.send(req, session.simPort, session.simIp)
		const seqB = nextSeq(session)
		const sit = encodeAgentSit({ agentId: session.agentId, sessionId: session.sessionId, seq: seqB })
		trackReliable(session, seqB, sit)
		session.udpSocket.send(sit, session.simPort, session.simIp)
		slog.info(session.ws, `→ AgentRequestSit+AgentSit target=${d.targetId.slice(0,8)}…`)
		return
	}

	if (msg.t === C.IM_SEND) {
		const d = msg.d as { toAgentId: string; fromAgentName: string; message: string }
		const seq = nextSeq(session)
		const pkt = encodeImprovedInstantMessage({
			agentId:       session.agentId,
			sessionId:     session.sessionId,
			seq,
			toAgentId:     d.toAgentId,
			// WHY: Client supplies fromAgentName but may pass an empty/placeholder string when
			// avatarStore.displayName isn't populated yet. Fall back to the SL "First Last" from
			// XML-RPC login so recipients see a real name, not "User".
			fromAgentName: d.fromAgentName || session.agentName || 'User',
			message:       d.message,
			dialog:        0,  // MessageFromAgent
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ IM to ${d.toAgentId.slice(0, 8)}: "${d.message.slice(0, 40)}"`)
		return
	}

	// ══ Social (Phase 3) ══════════════════════════════════════════════════════
	if (msg.t === C.AVATAR_PROPS_REQ) {
		const d = msg.d as { avatarId: string }
		if (!d.avatarId) return
		const seq = nextSeq(session)
		const pkt = encodeAvatarPropertiesRequest({ agentId: session.agentId, sessionId: session.sessionId, seq, avatarId: d.avatarId })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ AvatarPropertiesRequest ${d.avatarId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.PARCEL_INFO_REQ) {
		const d = msg.d as { parcelId: string }
		if (!d.parcelId) return
		const seq = nextSeq(session)
		const pkt = encodeParcelInfoRequest({ agentId: session.agentId, sessionId: session.sessionId, seq, parcelId: d.parcelId })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ ParcelInfoRequest ${d.parcelId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.NAME_REQ) {
		const d = msg.d as { ids: string[] }
		const ids = (d.ids ?? []).filter(Boolean)
		if (!ids.length) return
		const seq = nextSeq(session)
		const pkt = encodeUUIDNameRequest({ ids, seq })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ UUIDNameRequest ${ids.length} id(s)`)
		return
	}

	if (msg.t === C.FRIEND_OFFER) {
		const d = msg.d as { toAgentId: string; toAgentName?: string; message?: string }
		if (!d.toAgentId) return
		const seq = nextSeq(session)
		// WHY: a friendship offer is an ImprovedInstantMessage with dialog 38 (IM_FRIENDSHIP_OFFERED).
		// The IM's message-id becomes the transaction id the peer echoes in Accept/DeclineFriendship.
		const pkt = encodeImprovedInstantMessage({
			agentId:       session.agentId,
			sessionId:     session.sessionId,
			seq,
			toAgentId:     d.toAgentId,
			fromAgentName: session.agentName || 'User',
			message:       d.message || 'Will you be my friend?',
			dialog:        38,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ OfferFriendship (IM dialog 38) to ${d.toAgentId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.FRIEND_RESPOND) {
		const d = msg.d as { transactionId: string; accept: boolean; folderId?: string }
		if (!d.transactionId) return
		const seq = nextSeq(session)
		const pkt = d.accept
			? encodeAcceptFriendship({
				agentId: session.agentId, sessionId: session.sessionId, seq,
				transactionId: d.transactionId,
				// WHY: AcceptFriendship needs a folder for the new calling card. Empty UUID lets
				// the sim drop it in the default Calling Cards folder.
				folderId: d.folderId || '00000000-0000-0000-0000-000000000000',
			})
			: encodeDeclineFriendship({
				agentId: session.agentId, sessionId: session.sessionId, seq, transactionId: d.transactionId,
			})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ ${d.accept ? 'Accept' : 'Decline'}Friendship tx=${d.transactionId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.FRIEND_REMOVE) {
		const d = msg.d as { agentId: string }
		if (!d.agentId) return
		const seq = nextSeq(session)
		const pkt = encodeTerminateFriendship({ agentId: session.agentId, sessionId: session.sessionId, seq, otherId: d.agentId })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ TerminateFriendship ${d.agentId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.FRIEND_RIGHTS) {
		const d = msg.d as { agentId: string; rights: number }
		if (!d.agentId) return
		const seq = nextSeq(session)
		const pkt = encodeChangeUserRights({ agentId: session.agentId, seq, agentRelated: d.agentId, relatedRights: d.rights | 0 })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ ChangeUserRights ${d.agentId.slice(0, 8)}… rights=${d.rights}`)
		return
	}

	if (msg.t === C.REBAKE) {
		const url = session.caps?.get('RebakeAvatarTextures')
		if (!url) {
			slog.warn(session.ws, 'Rebake: RebakeAvatarTextures cap not available (grid may not support it, or 3s init window not elapsed)')
			return
		}
		// WHY: POST to RebakeAvatarTextures cap triggers server-side avatar appearance re-bake.
		// This makes the avatar visible/correct on other viewers without needing local texture baking.
		fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/llsd+xml' },
			body: '<llsd><map /></llsd>',
		})
			.then(() => slog.info(session.ws, '✓ RebakeAvatarTextures → avatar appearance pushed to grid'))
			.catch((e: Error) => slog.error(session.ws, `RebakeAvatarTextures failed: ${e.message}`))
		return
	}

	if (msg.t === C.CLIENT_DIAG) {
		// Client-side mirror of [PrimDiag] so server-log.txt holds both ends of the pipe.
		// Without this we have no record of mesh-count or upsert failures after session ends.
		const d = msg.d as {
			received?: number; stored?: number; prims?: number; av?: number;
			meshes?: number; upsertFails?: number; skippedNoPos?: number; placeholders?: number
		}
		slog.info(session.ws,
			`[ClientDiag] received=${d.received ?? '?'} stored=${d.stored ?? '?'} ` +
			`prims=${d.prims ?? '?'} av=${d.av ?? '?'} meshes=${d.meshes ?? '?'} ` +
			`upsertFails=${d.upsertFails ?? '?'} skipNoPos=${d.skippedNoPos ?? '?'} placeholders=${d.placeholders ?? '?'}`)
		return
	}

	if (msg.t === C.MAP_QUERY) {
		const d = msg.d as { minX: number; maxX: number; minY: number; maxY: number }
		// First-time probe: send MapLayerRequest once per circuit. Some OpenSim builds gate
		// WorldMapModule until at least one MapLayerRequest seen. Tracks via flag on session.
		if (!session.mapLayerSent) {
			session.mapLayerSent = true
			const layerSeq = nextSeq(session)
			const layerPkt = encodeMapLayerRequest({
				agentId: session.agentId, sessionId: session.sessionId, seq: layerSeq,
			})
			trackReliable(session, layerSeq, layerPkt)
			session.udpSocket.send(layerPkt, session.simPort, session.simIp)
			slog.info(session.ws, `→ MapLayerRequest (probe) seq=${layerSeq} pktLen=${layerPkt.length}`)
		}
		const seq = nextSeq(session)
		const pkt = encodeMapBlockRequest({
			agentId:   session.agentId,
			sessionId: session.sessionId,
			seq,
			minX: d.minX, maxX: d.maxX, minY: d.minY, maxY: d.maxY,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ MapBlockRequest minX=${d.minX} maxX=${d.maxX} minY=${d.minY} maxY=${d.maxY} pktLen=${pkt.length}`)
		return
	}

	if (msg.t === C.MAP_NAME_QUERY) {
		const d = msg.d as { name: string }
		if (!d.name) return
		const seq = nextSeq(session)
		const pkt = encodeMapNameRequest({
			agentId:   session.agentId,
			sessionId: session.sessionId,
			seq,
			name:      d.name,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ MapNameRequest "${d.name}" pktLen=${pkt.length} hex=${pkt.toString('hex')}`)
		return
	}

	if (msg.t === C.MAP_TELEPORT) {
		const d = msg.d as { regionX: number; regionY: number; x: number; y: number; z: number }
		// regionX/Y are sim grid coords; pack into RegionHandle (Y<<32)|X scaled by 256.
		// regionX/Y from MapBlockReply are grid indices; meters = idx*256. Handle = (Y_m<<32)|X_m.
		const handle = ((BigInt(d.regionY) * 256n) << 32n) | (BigInt(d.regionX) * 256n)
		const x = Math.max(1, Math.min(255, d.x))
		const y = Math.max(1, Math.min(255, d.y))
		const z = Math.max(0.5, d.z)
		const seq = nextSeq(session)
		const pkt = encodeTeleportLocationRequest({
			agentId:      session.agentId,
			sessionId:    session.sessionId,
			seq,
			regionHandle: handle,
			x, y, z,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ MapTeleport: region(${d.regionX},${d.regionY}) pos=${x.toFixed(0)},${y.toFixed(0)},${z.toFixed(0)} handle=${handle}`)
		return
	}

	if (msg.t === C.RESYNC_WORLD) {
		// WHY: Manual resync trigger — replay cached region/terrain/spawn to the browser,
		// then send an AgentUpdate to nudge the sim to refresh its interest list so prims
		// (cached only client-side) eventually stream back via ObjectUpdate as the user moves.
		slog.info(session.ws, '→ RESYNC_WORLD requested by client')
		replayCachedWorld(session)
		if (session.lastAgentParams) {
			const seq = nextSeq(session)
			const pkt = encodeAgentUpdate({
				agentId:   session.agentId,
				sessionId: session.sessionId,
				seq,
				...session.lastAgentParams,
			})
			session.udpSocket.send(pkt, session.simPort, session.simIp)
			slog.info(session.ws, `→ AgentUpdate nudge sent (seq=${seq}) to refresh sim interest list`)
		}
		return
	}
}

/**
 * Drain N cache-miss IDs per tick and send RequestMultipleObjects to sim.
 * Called from heartbeat timer (500ms). With BATCH=16 and PER_TICK=2 we send 32 ids/tick
 * = 64 ids/sec — ~75s to drain 4792-id region enumeration. Each packet is tracked as
 * reliable so UDP drops auto-retransmit.
 */
/**
 * Dump per-set localId snapshot to disk once the cache-miss drain completes. Used to
 * confirm whether a specific "missing" prim was ever enumerated by sim (asked-ever)
 * vs whether sim ignored our cache-miss reply (unfulfilled). User greps prim-ids-snapshot.txt
 * for the suspect localId — appearance in `asked` but absence from `distinct` = sim culled
 * the reply; absence from `asked` = sim never enumerated the prim at all.
 */
function dumpPrimIdsSnapshot(s: CircuitState): void {
	if (s.primIdsSnapshotDumped) return
	if (s.cacheMissPending.length > 0) return
	if (s.cacheMissAskedEver.size === 0) return
	s.primIdsSnapshotDumped = true
	const askedSorted = [...s.cacheMissAskedEver].sort((a, b) => a - b)
	const distinctSorted = [...s.distinctLocalIds].sort((a, b) => a - b)
	const unfulfilled = askedSorted.filter(id => !s.distinctLocalIds.has(id))
	const lines: string[] = []
	lines.push(`=== distinctLocalIds (${distinctSorted.length}) ===`)
	lines.push(...distinctSorted.map(String))
	lines.push(``)
	lines.push(`=== cacheMissAskedEver (${askedSorted.length}) ===`)
	lines.push(...askedSorted.map(String))
	lines.push(``)
	lines.push(`=== unfulfilled — asked but no ObjectUpdate received (${unfulfilled.length}) ===`)
	lines.push(...unfulfilled.map(String))
	try {
		fs.writeFileSync('prim-ids-snapshot.txt', lines.join('\n'))
		slog.info(s.ws, `[PrimIdsSnapshot] wrote prim-ids-snapshot.txt (distinct=${distinctSorted.length} asked=${askedSorted.length} unfulfilled=${unfulfilled.length})`)
	} catch (e) {
		slog.warn(s.ws, `[PrimIdsSnapshot] write failed: ${(e as Error).message}`)
	}
}

function sendCacheMissBatch(s: CircuitState, queue: number[], cacheMissType: 0 | 1): void {
	const BATCH = 16
	const PER_TICK = 2
	for (let p = 0; p < PER_TICK; p++) {
		if (queue.length === 0) break
		const chunk = queue.splice(0, BATCH)
		const seq = nextSeq(s)
		const pkt = encodeRequestMultipleObjects({
			agentId:   s.agentId,
			sessionId: s.sessionId,
			seq,
			ids:       chunk,
			cacheMissType,
		})
		trackReliable(s, seq, pkt)
		s.udpSocket.send(pkt, s.simPort, s.simIp)
		s.reqMultiOutCount++
		s.reqMultiIdsCount += chunk.length
		for (const id of chunk) s.cacheMissAskedEver.add(id)
	}
}

function drainCacheMissQueue(s: CircuitState): void {
	// Phase 1: primary queue with CacheMissType=0 (Full update).
	if (s.cacheMissPending.length > 0) {
		sendCacheMissBatch(s, s.cacheMissPending, 0)
		return
	}
	// Primary drain done. Initiate retry pass once with CacheMissType=1 for any
	// asked-but-unfulfilled ids. Hypothesis: sim may treat the two CacheMissTypes differently,
	// so a second pass with type=1 might coax it into satisfying requests it ignored at type=0.
	// WHY 5s silence gate: sim sends ObjectUpdateCached enum over time as we settle in. An
	// early empty-pending window mid-enum used to trigger retry with 0 unfulfilled; new
	// cached batches then arrived but never triggered retry again. Wait until sim has been
	// silent on enum for 5s to be confident enumeration is done.
	if (!s.cacheMissRetryStarted) {
		if (s.lastCacheEnumAt === 0) return  // sim never sent any cached enum yet
		if (Date.now() - s.lastCacheEnumAt < 5000) return  // enum may still be in-flight
		s.cacheMissRetryStarted = true
		const unfulfilled: number[] = []
		for (const id of s.cacheMissAskedEver) {
			if (!s.distinctLocalIds.has(id)) unfulfilled.push(id)
		}
		s.cacheMissRetryPending = unfulfilled
		slog.info(s.ws, `[CacheMissRetry] primary drain done — retrying ${unfulfilled.length} unfulfilled ids with CacheMissType=1`)
	}
	if (s.cacheMissRetryPending.length > 0) {
		sendCacheMissBatch(s, s.cacheMissRetryPending, 1)
		return
	}
	// Both phases drained — safe to dump snapshot now.
	dumpPrimIdsSnapshot(s)
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

/** Start per-session retransmit + heartbeat + idle-detection timer. Returns cleanup fn. */
export function startCircuitTimers(sessionId: string): () => void {
	const timer = setInterval(() => {
		const s = getSession(sessionId)
		if (!s) { clearInterval(timer); return }

		// WHY: Sim may drop circuit silently (no DisableSimulator) after 60s of no outbound
		// or inbound traffic. We send heartbeat AgentUpdates, but if the sim stops responding
		// we'd never know — avatar stays "online" in UI forever. Detect via lastUdpRxAt.
		// Only start checking after circuit is live and we've received at least one packet;
		// circuit setup itself takes a few seconds before first sim packet arrives.
		if (s.circuitEstablished && s.udpRxCount > 0) {
			const idleMs = Date.now() - s.lastUdpRxAt
			if (idleMs > SIM_IDLE_TIMEOUT_MS) {
				const idleSec = Math.round(idleMs / 1000)
				slog.warn(s.ws, `⚠ No UDP from sim for ${idleSec}s — circuit dropped without DisableSimulator`)
				s.ws.send(JSON.stringify({
					t: S.DISCONNECTED,
					d: { reason: `No response from simulator for ${idleSec}s — connection lost` },
				}))
				deleteSession(sessionId)
				clearInterval(timer)
				return
			}
		}

		retransmitOverdue(s)
		sendPendingAcks(s)
		sendHeartbeat(s)
		drainCacheMissQueue(s)
	}, 500)
	return () => clearInterval(timer)
}

