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
	encodeTeleportLandmarkRequest, encodeSetStartLocationRequest,
	encodeCreateInventoryItem, encodeCreateInventoryFolder, decodeUpdateCreateInventoryItem,
	encodeAvatarPickerRequest, decodeAvatarPickerReply, decodeChangeUserRights,
} from '../lib/lludp-codec'
import { queueAck, nextSeq, trackReliable, ackReceived, retransmitOverdue, sendPendingAcks } from '../lib/circuit'
import { slog } from '../lib/serverLog'
import { S, C } from '../../shared/protocol.js'
import { decodeLayerData } from '../lib/terrain-codec.js'
import { replayCachedWorld, replayTerrain } from '../lib/resync'
import { parseLLSD } from '../lib/llsd'
import { startEventQueue, stopEventQueue } from '../lib/eventQueue'
import {
	interestEnabled, withinInterest, effectivePos, isAvatar,
	reconcileInterest, resolveRadius, type ObjLike,
} from '../lib/interestFilter'

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
const LOW_TELEPORT_PROGRESS   = 73    // Sim → viewer: TP in progress — OpenSim uses 73, SL standard is 65
const LOW_TELEPORT_FAILED_STD = 66    // Sim → viewer: TP failed (SL standard Low #66)
const LOW_TELEPORT_FAILED_OS  = 74    // Sim → viewer: TP failed (OpenSim observed Low #74)
const LOW_IMPROVED_INSTANT_MSG= 254   // ImprovedInstantMessage — both directions (Low freq)
const LOW_TELEPORT_FINISH     = 69    // Sim → viewer: cross-sim TP, new circuit needed (Low freq)
// WHY: OpenSim on this grid uses shifted Low IDs for teleport progress/failed (73/74 instead of 65/66).
// TeleportFinish still uses 69. If future grids shift it, it would appear as "first-seen unhandled" in logs.
const LOW_MAP_BLOCK_REPLY     = 409   // Sim → viewer: world-map region entries (Low freq)
const LOW_MAP_LAYER_REPLY     = 406   // Sim → viewer: map layer info — alive-probe response
const FIXED_PACKET_ACK        = 251   // PacketAck fixed ID
// WHY: OpenSim LLUDPClient.DequeueOutgoing() STOPS sending when NeedAcks.Count() > 50
// (unacked reliable packets). During the object-update flood (Task throttle ~700 KB/s ≈
// 300+ reliable packets/500ms) acking only on the 500ms circuit tick pins the sim's unacked
// window past 50 → object delivery stalls (≈half undelivered) and the resend queue overflows
// → silent circuit death. Mirror Firestorm: flush acks as soon as enough accumulate so the
// sim's window stays well under 50. Verified against OpenSim LLUDPClient.cs:608.
const ACK_FLUSH_THRESHOLD     = 16    // flush pending acks immediately once this many queue up
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
const LOW_UPDATE_CREATE_INV_ITEM    = 267  // UpdateCreateInventoryItem — sim's reply after CreateInventoryItem
const LOW_AVATAR_PICKER_REPLY       = 28   // AvatarPickerReply
const LOW_CHANGE_USER_RIGHTS        = 321  // ChangeUserRights (inbound notification)

// WHY: Sim disconnects if no packets received for 60s. Send AgentUpdate every 2s when idle.
const HEARTBEAT_INTERVAL_MS = 2000
// WHY: 65s — sim kicks idle circuits at 60s. If we've received packets before (circuitEstablished)
// and then see silence for 65s, the sim dropped the circuit without sending DisableSimulator.
const SIM_IDLE_TIMEOUT_MS = 65_000

// Log every N packets to avoid flooding the debug panel
const LOG_EVERY_N_PACKETS = 500

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

	// Stop polling the OLD region's event queue — we're leaving it. A fresh poll starts once the
	// destination seed cap is fetched below.
	stopEventQueue(sessionId)

	// Tear down old socket; in-flight reliable packets are abandoned by design (new sim
	// won't ack them, so retransmission would loop forever).
	try { session.udpSocket.close() } catch { /* already closed */ }
	session.reliableOut.clear()
	session.pendingAcks.length = 0
	session.objCache.clear()
	session.terrainCache.clear()
	session.coveredLandPatches.clear()
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
		// WHY: Handle format is (X_meters << 32) | Y_meters — upper 32 = X, lower 32 = Y.
		session.cachedLoginOk.regionX = Number(newRegionHandle >> 32n)
		session.cachedLoginOk.regionY = Number(newRegionHandle & 0xFFFFFFFFn)
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
	// WHY EventQueueGet here too: the destination region has its OWN event queue. Without starting
	// a poll on it, the NEXT cross-region TP out of this region would silently fail the same way
	// the first one did before this fix.
	if (newSeedCap) {
		setTimeout(async () => {
			try {
				const reqBody = '<?xml version="1.0"?>\n<llsd><array>' +
					DEST_REGION_CAPS.map(c => `<string>${c}</string>`).join('') +
					'</array></llsd>'
				const res = await fetch(newSeedCap, {
					method: 'POST',
					headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
					body: reqBody,
				})
				slog.info(ws, `[swap] ✓ new seed cap fetched (${res.status})`)
				const map = parseLLSD(await res.text()) as Record<string, unknown> | null
				const s = getSession(sessionId)
				if (s && map && typeof map === 'object') {
					for (const [name, url] of Object.entries(map)) {
						if (typeof url === 'string' && url) s.caps.set(name, url)
					}
					const eqUrl = s.caps.get('EventQueueGet')
					if (eqUrl) startEventQueue(sessionId, eqUrl)
					s.ws.send(JSON.stringify({ t: S.CAPS_READY, d: { caps: [...s.caps.keys()] } }))
				}
			} catch (e) {
				slog.warn(ws, `[swap] seed cap fetch failed: ${(e as Error).message}`)
			}
		}, 3000)
	}
}

// Caps requested against a destination region's seed after a cross-region swap. EventQueueGet is
// the one that matters for further teleports; the rest keep inventory/texture/rebake working.
const DEST_REGION_CAPS = [
	'EventQueueGet',
	'FetchInventoryDescendents2',
	'FetchInventory2',
	'GetTexture',
	'GetMesh2',
	'RebakeAvatarTextures',
]

/**
 * Apply a decoded TeleportFinish from EITHER transport: the UDP Low #69 packet OR (the common
 * cross-region case) the EventQueueGet `TeleportFinish` event. Same-sim → re-send
 * CompleteAgentMovement so the sim re-places the avatar; cross-sim → swap the circuit onto the
 * destination (which replays the handshake and starts a fresh event-queue poll there).
 */
export function applyTeleportFinish(
	sessionId: string,
	f: { simIp: string; simPort: number; regionHandle: bigint; seedCap: string; simAccess: number;
	     regionSizeX?: number; regionSizeY?: number },
): void {
	const session = getSession(sessionId)
	if (!session) return
	const { simIp, simPort, regionHandle, seedCap, simAccess } = f
	// Var-region size of the destination (0 when the grid's TeleportFinish omits it — UDP path always
	// does). Forwarded to the client so its movement clamp uses the real region bounds; 0 → client keeps
	// its map-block fallback. See docs/superpowers/specs/2026-06-19-varregion-size-on-tp-design.md.
	const regionSizeX = f.regionSizeX ?? 0
	const regionSizeY = f.regionSizeY ?? 0
	if (regionSizeX > 0) slog.info(session.ws, `[TP] destination region size = ${regionSizeX}×${regionSizeY}`)
	session.pendingTpHandle = undefined
	session.tpDebugUntil = 0

	const sameSim = simIp === session.simIp && simPort === session.simPort
	if (sameSim) {
		// Same sim/IP:port. OpenSim hosts multiple regions per process, so a cross-region TP can
		// land here with regionHandle changed but address identical — notify the browser to clear
		// the scene in that case. Re-send CompleteAgentMovement; AgentMovementComplete returns the
		// new position, forwarded via AGENT_SPAWN_POS.
		const sameRegion = regionHandle === session.regionHandle
		session.regionHandle = regionHandle
		const seq = nextSeq(session)
		const pkt = encodeCompleteAgentMovement({ agentId: session.agentId, sessionId: session.sessionId, circuitCode: session.circuitCode, seq })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		if (!sameRegion) {
			session.ws.send(JSON.stringify({ t: S.TELEPORT_FINISH, d: { simIp, simPort, regionHandle: regionHandle.toString(), seedCap, simAccess, regionSizeX, regionSizeY } }))
			slog.info(session.ws, `→ CompleteAgentMovement re-sent (same sim, new region handle=${regionHandle}) — browser notified to clear scene`)
		} else {
			slog.info(session.ws, `→ CompleteAgentMovement re-sent (same sim, same region) — awaiting AgentMovementComplete at new pos`)
		}
	} else {
		// True cross-region teleport: swap UDP socket onto the new sim and replay the handshake.
		// agentId/sessionId/circuitCode are preserved by SL protocol. Browser clears scene + awaits
		// the new RegionHandshake.
		slog.info(session.ws, `TeleportFinish cross-sim → ${simIp}:${simPort} — swapping circuit`)
		session.ws.send(JSON.stringify({ t: S.TELEPORT_FINISH, d: { simIp, simPort, regionHandle: regionHandle.toString(), seedCap, simAccess } }))
		swapCircuit(sessionId, simIp, simPort, regionHandle, seedCap)
	}
}

/** Called when a UDP packet arrives from the grid sim */
// Targeted decode forensics: QS_WATCH_LOCALIDS="123,456" hex-dumps the raw packet + decoded field
// summary whenever a watched localId appears in an ObjectUpdate / Compressed decode. The hex is a
// ready offline fixture for codec tests (capture → TDD offline, no login-cycle thrash).
const WATCH_LOCALIDS = new Set(
	(process.env.QS_WATCH_LOCALIDS ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0),
)
// Startup proof the watch is armed — absence of this line in the log = env var never reached us.
if (WATCH_LOCALIDS.size) console.log(`[Watch] armed for localIds: ${[...WATCH_LOCALIDS].join(',')}`)
function watchDump(session: CircuitState, path: string, objects: Array<{ localId?: number; pcode?: number }>, buf: Buffer, dataOffset: number): void {
	if (!WATCH_LOCALIDS.size) return
	for (const o of objects) {
		if (typeof o.localId !== 'number' || !WATCH_LOCALIDS.has(o.localId)) continue
		const x = o as Record<string, unknown>
		slog.warn(session.ws, `[Watch] ${path} localId=${o.localId} pcode=${o.pcode} meshId=${x.meshId ?? 'NONE'} sculptType=${x.sculptType ?? '-'} sculptId=${x.sculptId ?? '-'} keys=${Object.keys(x).join(',')}`)
		slog.warn(session.ws, `[Watch] ${path} raw dataOffset=${dataOffset} len=${buf.length} hex=${buf.toString('hex')}`)
	}
}

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

	// Queue ack for reliable packets. Flush eagerly under load so the sim's unacked
	// window never crosses its NeedAcks>50 send-stall threshold (see ACK_FLUSH_THRESHOLD).
	if (hdr.reliable) {
		queueAck(session, hdr.seq)
		if (session.pendingAcks.length >= ACK_FLUSH_THRESHOLD) sendPendingAcks(session)
	}

	const { type, dataOffset } = parseMsgType(buf, hdr.bodyOffset)

	// WHY: When a cross-region TP is in flight, log EVERY packet with hex for 60s.
	// Catches TeleportFinish regardless of whether it uses a shifted/unexpected ID.
	if (session.tpDebugUntil && Date.now() < session.tpDebugUntil) {
		const hex = buf.slice(hdr.bodyOffset, Math.min(hdr.bodyOffset + 12, buf.length)).toString('hex')
		slog.info(session.ws, `[TPdbg] type=${type} size=${rawBuf.length}b zc=${hdr.zeroCoded} rel=${hdr.reliable} hex=${hex}`)
	}

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
			const rh = decodeRegionHandshake(buf, dataOffset)
			const { simName, simAccess, waterHeight } = rh
			slog.info(session.ws, `✓ RegionHandshake: SimName="${simName}" access=${simAccess} water=${waterHeight}m cacheId=${rh.cacheId.slice(0, 8)}… detail=[${rh.terrainDetail.map(u => u.slice(0, 8)).join(' ')}]`)
			// Reply is required
			const seq = nextSeq(session)
			const reply = encodeRegionHandshakeReply({ agentId: session.agentId, sessionId: session.sessionId, seq })
			trackReliable(session, seq, reply)
			session.udpSocket.send(reply, session.simPort, session.simIp)
			// Cache for resync replays (HMR / page reload / manual "Resync World")
			session.cachedRegionName   = simName
			session.cachedRegionAccess = simAccess
			session.cachedRegionEnv    = {
				waterHeight,
				terrainDetail:      rh.terrainDetail,
				terrainStartHeight: rh.terrainStartHeight,
				terrainHeightRange: rh.terrainHeightRange,
				regionId:           rh.regionId,
				// Region-run marker: client compares against its stored value and drops the region's
				// object cache on mismatch (localIds die with the run — stale ones brick ObjectSelect).
				cacheId:            rh.cacheId,
			}
			// Forward region name + render-critical environment to browser
			session.ws.send(JSON.stringify({
				t: S.REGION_INFO,
				d: { name: simName, access: simAccess, ...session.cachedRegionEnv },
			}))
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
			let newHandle = session.regionHandle
			if (dataOffset + 64 <= buf.length) {
				newHandle = buf.readBigUInt64LE(dataOffset + 56)
				session.regionHandle = newHandle
			}
			slog.info(session.ws, `✓ AgentMovementComplete: confirmed spawn pos=${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} handle=${newHandle}`)

			// WHY: Detect same-sim cross-region TP success. If AgentMovementComplete handle matches
			// the destination handle we stored in pendingTpHandle, the TP succeeded. Send TELEPORT_FINISH
			// NOW (the real signal to clear scene and update region) rather than on TeleportProgress.
			// Resume AgentUpdates after success by clearing pendingTpHandle.
			if (session.pendingTpHandle && newHandle === session.pendingTpHandle) {
				slog.info(session.ws, `✓ Cross-region TP arrived at destHandle=${newHandle} — sending TELEPORT_FINISH to browser`)
				session.ws.send(JSON.stringify({
					t: S.TELEPORT_FINISH,
					d: { simIp: session.simIp, simPort: session.simPort, regionHandle: newHandle.toString(), seedCap: '', simAccess: 13 },
				}))
				session.pendingTpHandle = undefined
			}

			// Cache for resync replays
			session.cachedSpawnPos = [x, y, z]
			// Forward confirmed sim-authoritative position to browser so it can correct
			// worldStore.avatarPos before the first TerseUpdate arrives.
			session.ws.send(JSON.stringify({ t: S.AGENT_SPAWN_POS, d: { pos: [x, y, z] } }))

			// WHY: Send AgentSetAppearance after AgentMovementComplete so ScenePresence.Appearance
			// is non-null on the source sim before any cross-region teleport is attempted.
			// EntityTransferModule serialises sp.Appearance into AgentCircuitData for the destination
			// sim's CreateAgent call — if null, destination rejects the agent and TeleportFinish is
			// never sent, causing a 30-47s WaitForAgentArrivedAtDestination timeout then TeleportFailed.
			// The stub sends empty TextureEntry (cloud look to others); we follow up with
			// RebakeAvatarTextures cap so the sim rebakes proper textures from the bake service.
			{
				const seqA = nextSeq(session)
				const appearPkt = encodeAgentSetAppearance({ agentId: session.agentId, sessionId: session.sessionId, seq: seqA })
				trackReliable(session, seqA, appearPkt)
				session.udpSocket.send(appearPkt, session.simPort, session.simIp)
				slog.info(session.ws, `→ AgentSetAppearance sent (seq=${seqA}) — populates ScenePresence.Appearance for cross-region TP`)
				// Trigger rebake so the sim fetches proper baked textures; use a small delay so
				// the circuit is fully settled before the HTTP cap call.
				const rebakeCap = session.caps.get('RebakeAvatarTextures')
				if (rebakeCap) {
					setTimeout(() => {
						fetch(rebakeCap, { method: 'POST', body: '' })
							.then(() => slog.info(session.ws, '✓ RebakeAvatarTextures → appearance updated from bake service'))
							.catch(e => slog.warn(session.ws, `RebakeAvatarTextures failed: ${e.message}`))
					}, 5000)
				}
			}

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
				camUp:     [0, 0, 1] as [number, number, number], far: 512,
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
			watchDump(session, 'Compressed', objects, buf, dataOffset)
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
				const cfwd = filterForwardObjects(session, objects)
				if (cfwd.length > 0) {
					session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects: cfwd } }))
					session.objRelayedCount += cfwd.length
				}
				if (!session.loggedTypes.has('objcompressed')) {
					session.loggedTypes.add('objcompressed')
					slog.info(session.ws, `[ObjCompressed] first decode: ${objects.length} objects, localIds=${objects.slice(0,3).map(o=>o.localId).join(',')}`)
				}
			}
		} catch (e) { slog.warn(session.ws, `ObjectUpdateCompressed decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `high:${HIGH_OBJECT_UPDATE_CACHED}`) {
		// WHY: Sim sends ObjectUpdateCached with (localId, PseudoCRC) when it believes we have
		// objects cached. We forward the probes to the client, which owns the persistent IDB
		// cache and decides hit (CRC match → render from cache, no request) vs miss (→ request
		// full update via C.OBJ_CACHE_MISS, which feeds the existing cacheMissPending drain).
		// Objects already fulfilled this session (server objCache) are dropped — the client
		// already has them. Own avatar (pcode 47) is never client-cached, so its probe always
		// misses and is requested → ownAvatarLocalId still gets set (location bar stays live).
		try {
			const probes = decodeObjectUpdateCached(buf, dataOffset)
			// Liveness ledger: a cache probe proves the sim knows this localId THIS session — needed by
			// the ObjectSelect stale-id check below (cache-painted objects never get a full update).
			// probeBacklog additionally keeps the (localId → crc) pairs so the client can request a
			// replay after its engine mounts (the sim's initial probe flood predates the handlers).
			if (!session.probeBacklog) session.probeBacklog = new Map()
			session.lastProbeRxAt = Date.now()
			for (const p of probes) { session.distinctLocalIds.add(p.localId); session.probeBacklog.set(p.localId, p.crc) }
			const fwd = probes.filter(p => !session.objCache.has(p.localId))
			if (fwd.length > 0) {
				session.ws.send(JSON.stringify({ t: S.OBJ_CACHE_PROBE, d: { probes: fwd } }))
				if (!session.loggedTypes.has('objcache')) {
					session.loggedTypes.add('objcache')
					slog.info(session.ws, `[ObjCached] forwarded ${fwd.length} probes to client for CRC check`)
				}
			}
		} catch (e) { slog.warn(session.ws, `ObjectUpdateCached decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `high:${HIGH_OBJECT_UPDATE}`) {
		const objects = decodeObjectUpdate(buf, dataOffset,
			(errMsg) => {
				if (errMsg.includes('PSBlock:')) {
					// WHY: PSBlock OOB is expected for OpenSim extended particle systems (>86 bytes).
					// Prim renders fine as partial. Log once per localId to avoid flood.
					const m = errMsg.match(/localId=(\d+)/)
					const key = `psblock:${m?.[1] ?? 'unknown'}`
					if (!session.loggedTypes.has(key)) {
						session.loggedTypes.add(key)
						slog.info(session.ws, `[ObjUpd] PSBlock overflow (once): ${errMsg}`)
					}
					return
				}
				slog.warn(session.ws, `[ObjUpd] partial decode error: ${errMsg}`)
			},
			(diagMsg) => {
				const odMatch = diagMsg.match(/od=(\d+)/)
				const od = odMatch ? parseInt(odMatch[1]) : 0
				const lidMatch = diagMsg.match(/localId=(\d+)/)
				const lid = lidMatch?.[1] ?? 'unknown'
				// Log non-standard odLen OR the specific suspect chain
				const watchIds = new Set(['676079054', '676079037'])
				if (od !== 60 && od !== 76 || watchIds.has(lid)) {
					const key = `oddod:${lid}`
					if (!session.loggedTypes.has(key)) {
						session.loggedTypes.add(key)
						slog.info(session.ws, `[ODD-OD] ${diagMsg}`)
					}
				}
			},
		)
		watchDump(session, 'Full', objects, buf, dataOffset)
		if (objects.length > 0) {
			session.objDecodedCount += objects.length
			// Cache by localId for resync replay (page reload / "Resync World").
			// Drop from cache-miss queue — sim just fulfilled the request so we don't need to ask again.
			for (const o of objects) {
				if (typeof o.localId === 'number') {
					session.objCache.set(o.localId, o)
					session.distinctLocalIds.add(o.localId)
					const idx = session.cacheMissPending.indexOf(o.localId)
					if (idx >= 0) session.cacheMissPending.splice(idx, 1)
					// Capture the OWN avatar's full update so resync can re-establish it after a page
					// reload (the sim won't re-broadcast it on resume). pcode 47 = avatar; match fullId
					// to our agentId. Stored separately from objCache so it survives even if evicted.
					const oa = o as { pcode?: number; fullId?: string }
					if (oa.pcode === 47 && oa.fullId && oa.fullId.toLowerCase() === session.agentId.toLowerCase()) {
						session.ownAvatarUpdate = o
					}
					// DIAG: child prims — look up parent's cached pos to see if parent is underwater
					// DIAG: root prims (parentId=0) placed below water = decode or sim issue
					if ((o.parentId ?? 0) !== 0) {
						const par = session.objCache.get(o.parentId!) as { pos?: [number,number,number], parentId?: number } | undefined
						const wh = session.cachedRegionEnv?.waterHeight ?? 20
						// Only flag when PARENT is a root prim (grandparent=0) — avoids false positives
						// from intermediate chain nodes whose cached pos is a local offset, not region Z
						if (par?.pos && (par.parentId ?? 0) === 0 && par.pos[2] < wh) {
							slog.info(session.ws, `[ROOT-UW] waterH=${wh} child=${o.localId} rootParent=${o.parentId} rootPos=[${par.pos.map(v=>v.toFixed(2)).join(',')}]`)
						}
					}
				}
			}
			// DEV: dump decoded particle systems for live layout verification. Off by default.
			if (process.env.PS_BYTE_DUMP === '1') for (const o of objects) {
				if (!o.psys || typeof o.localId !== 'number') continue
				const pkey = `psdump:${o.localId}`
				if (session.loggedTypes.has(pkey)) continue
				session.loggedTypes.add(pkey)
				slog.info(session.ws, `[PSys] localId=${o.localId} pattern=${o.psys.pattern} burst=${o.psys.burstPartCount}@${o.psys.burstRate}s life=${o.psys.partMaxAge} tex=${o.psys.texture ?? '-'} flags=0x${o.psys.partFlags.toString(16)}`)
			}
			const fwd = filterForwardObjects(session, objects)
			if (fwd.length > 0) {
				session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects: fwd } }))
				session.objRelayedCount += fwd.length
			}
		} else {
			slog.warn(session.ws, `[ObjUpd] decode returned 0 objects (bufLen=${buf.length})`)
		}
		return
	}

	if (type === `high:${HIGH_OBJECT_UPDATE_TERSE}`) {
		try {
			const objects = decodeImprovedTerseObjectUpdate(buf, dataOffset)
			if (objects.length > 0) {
				// Update cached position so a resync replay reflects current state, not the
				// stale spawn position from the first ObjectUpdate.
				for (const o of objects) {
					const cached = session.objCache.get(o.localId) as { pos?: [number, number, number] } | undefined
					if (cached) cached.pos = o.pos
				}
				// WHY: When the interest filter is on, a terse position delta is only meaningful for
				// objects the browser is holding — sending one for a culled object would re-create it
				// (avatars exempt: always forwarded, always present client-side).
				const tfwd = interestEnabled()
					? objects.filter(o => session.sentToClient.has(o.localId))
					: objects
				if (tfwd.length > 0) session.ws.send(JSON.stringify({ t: S.TERSE_UPDATE, d: { objects: tfwd } }))
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
				for (const id of ids) { session.objCache.delete(id); session.sentToClient.delete(id) }
				session.ws.send(JSON.stringify({ t: S.KILL_OBJECT, d: { ids, cull: false } }))
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
		let wirePatches = result.patches.map(p => ({
			x: p.x,
			y: p.y,
			heights: Array.from(p.heights),
		}))
		if (result.type === 'LAND') {
			// Cache LAND patches for resync replays and mark as covered so WATER_FLOOR can't overwrite.
			for (const p of wirePatches) {
				const key = `${p.x},${p.y}`
				session.terrainCache.set(key, { patchSize: result.patchSize, x: p.x, y: p.y, heights: p.heights })
				session.coveredLandPatches.add(key)
			}
			slog.info(session.ws, `[terrain] cache size after packet: ${session.terrainCache.size}`)
		} else if (result.type === 'WATER_FLOOR') {
			// WHY: Only forward WATER_FLOOR patches for coords not already covered by LAND.
			// LAND patches are authoritative; 0x37 only fills genuine ocean-floor gaps.
			// Prevents the original overwrite bug (NeverWorld: LAND h=23m → 0x37 h≈0).
			wirePatches = wirePatches.filter(p => !session.coveredLandPatches.has(`${p.x},${p.y}`))
			if (wirePatches.length === 0) return
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
			// Always log arrival (even decoded=0) — a silent empty decode is indistinguishable from
			// "sim never replied" otherwise, and that ambiguity cost us a debugging session.
			slog.info(session.ws, `[ObjProps] rx size=${rawBuf.length}b zc=${hdr.zeroCoded} count=${buf[dataOffset] ?? '?'} decoded=${items.length}`)
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
		session.tpDebugUntil = 0
		slog.info(session.ws, `[TP] TeleportFinish arrived (low:${LOW_TELEPORT_FINISH}) size=${rawBuf.length}b zc=${hdr.zeroCoded}`)
		// WHY: TeleportFinish = cross-region teleport (or same-region TP on some OpenSim grids).
		// For same sim IP/port: re-send CompleteAgentMovement; sim replies with AgentMovementComplete.
		// For different sim: forward to browser for future cross-sim reconnection (Phase 2).
		// NOTE: Cross-region TPs on most OpenSim grids do NOT arrive here — TeleportFinish is an
		// EventQueueGet event (flavor=llsd), handled in eventQueue.ts. This UDP path covers same-sim
		// position TPs and any grid that still sends Low #69. Both funnel through applyTeleportFinish.
		try {
			const f = decodeTeleportFinish(buf, dataOffset)
			slog.info(session.ws, `✓ TeleportFinish (UDP): ${f.simIp}:${f.simPort} handle=${f.regionHandle} access=${f.simAccess} cap=${f.seedCap.slice(0, 40)}…`)
			applyTeleportFinish(sessionId, f)
		} catch (e) { slog.warn(session.ws, `TeleportFinish decode error: ${(e as Error).message}`) }
		return
	}

	if (type === `low:${LOW_TELEPORT_PROGRESS}`) {
		// WHY: Intermediate TP progress update. In this OpenSim build TeleportFinish (low:69) is
		// never received by the proxy even though the sim sends it. Hypothesis: DigiWorldz runs
		// multiple regions on the same simulator process (same IP:port) and TeleportFinish is
		// delivered differently. Workaround: on TeleportProgress, proactively send CompleteAgentMovement
		// to the current sim with the destination regionHandle (same-sim TP pattern), then notify
		// the browser to clear the scene. This mirrors what the TeleportFinish sameSim handler does.
		try {
			const hex = buf.slice(dataOffset, Math.min(dataOffset + 32, buf.length)).toString('hex')
			const rawStatus = buf.length > dataOffset + 3 ? buf.readUInt32LE(dataOffset) : 0
			slog.info(session.ws, `[TP] TeleportProgress (low:${LOW_TELEPORT_PROGRESS}) rawStatus=0x${rawStatus.toString(16)} hex=${hex}`)

			// Notify browser of progress: "Contacting new region."
			session.ws.send(JSON.stringify({ t: S.TELEPORT_PROGRESS, d: { status: 'contacting' } }))

			// AgentUpdates suppressed during TP (pendingTpHandle set, heartbeat + browser MOVE blocked).
			// Just log — TP broker is running on sim; wait for TeleportFinish or TeleportFailed.
		} catch { /**/ }
		return
	}

	if (type === `low:${LOW_TELEPORT_FAILED_STD}` || type === `low:${LOW_TELEPORT_FAILED_OS}`) {
		session.tpDebugUntil = 0
		session.pendingTpHandle = undefined
		// WHY: Deduplicate reliable retransmits — sim resends TeleportFailed if we don't ACK within
		// ~300ms, but sendPendingAcks runs every 500ms, so we often process the same packet twice.
		const now = Date.now()
		if (session.lastTeleportFailedAt && now - session.lastTeleportFailedAt < 5000) return
		session.lastTeleportFailedAt = now
		// WHY: Sim rejected TeleportLocationRequest. Log reason + notify browser so UI can show feedback.
		// Body: AgentID(16) + reason_len(1) + reason(N bytes). Some OpenSim builds use Low #74 instead of #66.
		try {
			const hex = buf.slice(dataOffset, Math.min(dataOffset + 48, buf.length)).toString('hex')
			let reason = '(unknown)'
			const off = dataOffset + 16  // skip AgentID
			if (off < buf.length) {
				const rLen = buf[off]
				if (off + 1 + rLen <= buf.length) {
					reason = buf.slice(off + 1, off + 1 + rLen).toString('utf8').replace(/\0/g, '').trim()
				}
			}
			slog.warn(session.ws, `✗ TeleportFailed (${type}): reason="${reason}" hex=${hex}`)
			session.ws.send(JSON.stringify({ t: S.TELEPORT_FAILED, d: { reason } }))
		} catch (e) { slog.warn(session.ws, `TeleportFailed decode error: ${(e as Error).message}`) }
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
				(blocks.length > 0 ? ` first="${blocks[0].name}"(${blocks[0].regionX},${blocks[0].regionY}) access=${blocks[0].access} size=${blocks[0].sizeX}×${blocks[0].sizeY}` : ''))
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

	if (type === `low:${LOW_AVATAR_PICKER_REPLY}`) {
		try {
			const r = decodeAvatarPickerReply(buf, dataOffset)
			const avatars = r.avatars.map(a => ({ id: a.id, name: `${a.firstName} ${a.lastName}`.trim() }))
			session.ws.send(JSON.stringify({ t: S.AVATAR_PICKER_REPLY, d: { queryId: r.queryId, avatars } }))
			slog.info(session.ws, `[Picker] ${avatars.length} result(s) q=${r.queryId.slice(0, 8)}…`)
		} catch (e) { slog.warn(session.ws, `AvatarPickerReply decode error: ${(e as Error).message}`) }
		return
	}
	if (type === `low:${LOW_CHANGE_USER_RIGHTS}`) {
		try {
			const r = decodeChangeUserRights(buf, dataOffset)
			for (const entry of r.rights) {
				session.ws.send(JSON.stringify({ t: S.FRIEND_RIGHTS_CHANGED, d: {
					agentId: r.agentId, relatedId: entry.agentRelated, rights: entry.relatedRights,
				} }))
			}
			slog.info(session.ws, `[Friends] rights changed agent=${r.agentId.slice(0, 8)}… ×${r.rights.length}`)
		} catch (e) { slog.warn(session.ws, `ChangeUserRights decode error: ${(e as Error).message}`) }
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

	if (type === `low:${LOW_UPDATE_CREATE_INV_ITEM}`) {
		try {
			const items = decodeUpdateCreateInventoryItem(buf, dataOffset)
			if (items.length) {
				slog.info(session.ws, `← UpdateCreateInventoryItem: ${items.length} item(s) [${items.map(i => `${i.name}→${i.parentId.slice(0, 8)}`).join(', ')}]`)
				session.ws.send(JSON.stringify({ t: S.INV_ITEM_CREATED, d: { items } }))
			}
		} catch (e) { slog.warn(session.ws, `UpdateCreateInventoryItem decode error: ${(e as Error).message}`) }
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

	if (type === `fixed:${FIXED_PACKET_ACK}`) {
		// WHY: Sim sends standalone PacketAck (fixed:251) to ACK reliable packets we sent it.
		// Without processing these, reliableOut keeps the packet and retransmitOverdue resends it.
		// For TeleportLocationRequest this was critical: unACK'd TP requests retransmit every 1-2s,
		// causing OpenSim to restart the TP broker on each retransmit and preventing TeleportFinish.
		// Body: count(U8) + seq0(U32BE) + seq1(U32BE) + ...
		// WHY: Standalone PacketAck body uses LE (standard message field convention).
		// Piggybacked acks (FLAG_HAS_ACKS) use BE per LLUDP spec — handled separately above.
		const count = buf[dataOffset]
		for (let i = 0; i < count; i++) {
			const seq = buf.readUInt32LE(dataOffset + 1 + i * 4)
			ackReceived(session, seq)
		}
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
			interestRadius?: number
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
		if (typeof d.far !== 'number') d.far = 512   // draw distance → sim interest radius (region-wide)
		if (typeof d.interestRadius !== 'number') d.interestRadius = undefined
		// Save for heartbeat retransmit when client is idle
		session.lastAgentParams    = d
		session.lastAgentUpdateAt  = Date.now()
		// WHY: Match FS `send_agent_update()` line 4188 — no AgentUpdates during teleport.
		// The sim treats incoming AgentUpdates as "avatar still active here", which appears to
		// prevent TeleportFinish from routing back. pendingTpHandle is cleared on arrival or failure.
		if (session.pendingTpHandle) return
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
		// WHY 8191 not 255: server doesn't know the region's dimensions (var regions are
		// 512-8192m); the client clamps to the real size, this is only a sanity bound.
		const x = Math.max(1, Math.min(8191, d.x))
		const y = Math.max(1, Math.min(8191, d.y))
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

	if (msg.t === C.TP_LANDMARK) {
		const d = msg.d as { landmarkId: string }
		if (!d.landmarkId) return
		const seq = nextSeq(session)
		const pkt = encodeTeleportLandmarkRequest({ agentId: session.agentId, sessionId: session.sessionId, seq, landmarkId: d.landmarkId })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ TeleportLandmarkRequest lm=${d.landmarkId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.TP_HOME) {
		const seq = nextSeq(session)
		const pkt = encodeTeleportLandmarkRequest({ agentId: session.agentId, sessionId: session.sessionId, seq, landmarkId: '00000000-0000-0000-0000-000000000000' })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, '→ TeleportLandmarkRequest (home/zero UUID)')
		return
	}

	if (msg.t === C.SET_HOME) {
		const d = msg.d as { regionName: string; x: number; y: number; z: number }
		const seq = nextSeq(session)
		const pkt = encodeSetStartLocationRequest({
			agentId:    session.agentId,
			sessionId:  session.sessionId,
			seq,
			simName:    d.regionName || '',
			locationId: 1,
			x: d.x, y: d.y, z: d.z,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ SetStartLocationRequest home @ ${d.regionName} ${d.x.toFixed(0)},${d.y.toFixed(0)},${d.z.toFixed(0)}`)
		return
	}

	if (msg.t === C.CREATE_LANDMARK) {
		const d = msg.d as { name: string; desc?: string; folderId: string }
		if (!d.folderId) { slog.warn(session.ws, 'CreateLandmark: missing folderId'); return }
		const seq = nextSeq(session)
		// WHY: Type=InvType=3 (Landmark) + zero TransactionID → sim creates the LM from the agent's
		// current position. Reply (UpdateCreateInventoryItem) is forwarded as S.INV_ITEM_CREATED.
		const pkt = encodeCreateInventoryItem({
			agentId: session.agentId, sessionId: session.sessionId, seq,
			folderId: d.folderId, type: 3, invType: 3,
			name: d.name || 'Landmark', description: d.desc || '',
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ CreateInventoryItem (landmark) "${d.name}" → folder ${d.folderId.slice(0, 8)}…`)
		return
	}

	if (msg.t === C.CREATE_INV_FOLDER) {
		const d = msg.d as { folderId: string; parentId: string; name: string }
		if (!d.folderId || !d.parentId) { slog.warn(session.ws, 'CreateInvFolder: missing ids'); return }
		const seq = nextSeq(session)
		const pkt = encodeCreateInventoryFolder({
			agentId: session.agentId, sessionId: session.sessionId, seq,
			folderId: d.folderId, parentId: d.parentId, name: d.name || 'New Folder',
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ CreateInventoryFolder "${d.name}" ${d.folderId.slice(0, 8)}… under ${d.parentId.slice(0, 8)}…`)
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
		// Stale-id check: ids never seen in live sim traffic this session (full/compressed updates or
		// cache probes) are almost certainly stale IDB-cache paint from a previous region run — the sim
		// silently ignores ObjectSelect for localIds it doesn't know, which presents as the edit
		// floater stuck on "Loading properties from sim…".
		const stale = d.localIds.filter(id => !session.distinctLocalIds.has(id))
		slog.info(session.ws, `→ ObjectSelect seq=${seq} ids=[${d.localIds.join(',')}] live=${d.localIds.length - stale.length}/${d.localIds.length}${stale.length ? ` STALE=[${stale.join(',')}]` : ''}`)
		return
	}

	if (msg.t === C.OBJECT_DESELECT) {
		const d = msg.d as { localIds: number[] }
		if (!d.localIds?.length) return
		const seq = nextSeq(session)
		const pkt = encodeObjectDeselect({ agentId: session.agentId, sessionId: session.sessionId, seq, localIds: d.localIds })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ ObjectDeselect seq=${seq} ids=[${d.localIds.join(',')}]`)
		return
	}

	if (msg.t === C.OBJ_PROBE_RESYNC) {
		// Engine mounted its WS handlers and wants the buffered probe flood replayed. Just arm the
		// flag — the heartbeat (drainProbeResync) waits for the sim's enumeration to go quiet first,
		// because this request usually arrives BEFORE the flood (preseed fires on the first
		// ObjectUpdate); replying immediately would replay an empty/partial backlog.
		session.probeResyncWanted = true
		slog.info(session.ws, `[ObjCached] probe-resync armed (backlog=${session.probeBacklog?.size ?? 0} so far)`)
		// The engine just registered its OBJECT_UPDATE handler — re-send the own avatar NOW. WHY: the
		// replayCachedWorld burst on resume fires BEFORE the engine mounts, so its avatar frame is lost
		// (AGENT_SPAWN_POS survives only because App.vue catches it pre-mount). Prims recover via the
		// probe backlog, but the avatar isn't a probe and is never client-cached, so it has no other
		// recovery path. This frame reaches the mounted engine → ownAvatarLocalId set, follow-cam +
		// movement restored; the session-stable localId lets live TerseUpdates reconcile the position.
		if (session.ownAvatarUpdate) {
			session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects: [session.ownAvatarUpdate] } }))
			slog.info(session.ws, `→ own-avatar re-sent on probe-resync (engine ready)`)
		}
		// Same pre-mount loss applies to TERRAIN: the resume's replayCachedWorld TERRAIN_PATCH frames
		// arrive before the engine's handler mounts, so worldStore.terrainHeights stays zeroed → the
		// collision sampler returns ~0 → client gravity floors the avatar at z≈1 (the "fall through to
		// 1m" bug; focus-dependent, fixed only by a manual resync until now). Re-send terrain NOW (engine
		// ready) so the collision heightmap rebuilds — automatic resync, no user action needed.
		const tPatches = replayTerrain(session)
		if (tPatches > 0) slog.info(session.ws, `→ terrain re-sent on probe-resync (${tPatches} patches, engine ready)`)
		return
	}

	if (msg.t === C.OBJ_CACHE_MISS) {
		// WHY: client checked the forwarded probes against its persistent cache and these
		// localIds are misses (absent or CRC mismatch). Feed the existing paced drain, skipping
		// ids already fulfilled or already queued (same guard the old auto-enqueue used).
		const d = msg.d as { ids: number[] }
		if (!d.ids?.length) return
		let enqueued = 0
		for (const id of d.ids) {
			if (session.objCache.has(id)) continue
			if (session.cacheMissPending.includes(id)) continue
			session.cacheMissPending.push(id)
			enqueued++
		}
		if (enqueued > 0) session.lastCacheEnumAt = Date.now()
		if (!session.loggedTypes.has('cachemiss')) {
			session.loggedTypes.add('cachemiss')
			slog.info(session.ws, `[CacheMiss] first batch: rx=${d.ids.length} enqueued=${enqueued} pending=${session.cacheMissPending.length}`)
		}
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

	if (msg.t === C.AVATAR_PICKER_REQ) {
		const d = msg.d as { query: string; queryId: string }
		if (!d.query || !d.queryId) return
		const seq = nextSeq(session)
		const pkt = encodeAvatarPickerRequest({
			agentId: session.agentId, sessionId: session.sessionId,
			queryId: d.queryId, name: d.query, seq,
		})
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		slog.info(session.ws, `→ AvatarPickerRequest "${d.query}" q=${d.queryId.slice(0, 8)}…`)
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
		type DiagStats = { requested?: number; done?: number; failed?: number; timeout?: number; late?: number; inflight?: number; queued?: number; cached?: number }
		const d = msg.d as {
			received?: number; stored?: number; prims?: number; av?: number;
			meshes?: number; upsertFails?: number; skippedNoPos?: number; placeholders?: number;
			geoNaN?: number; withTex?: number; mapped?: number; tex?: DiagStats; mesh?: DiagStats
			orphan?: { children?: number; orphanByMissingRoot?: number; distinctMissingRoots?: number; orphanMeshAtScene?: number }
			texApply?: { calls?: number; null?: number; applied?: number; dropNoParent?: number; dropMatSwap?: number }
			faceTex?: { realDefault?: number; blankDefault?: number; blankButRealFaceTex?: number; anyRealFaceTex?: number }
		}
		const stat = (s?: DiagStats) => s
			? `✓${s.done ?? '?'} ✗${s.failed ?? '?'} ⏱${s.timeout ?? '?'} late=${s.late ?? 0} inflight=${s.inflight ?? '?'} q=${s.queued ?? '?'} cache=${s.cached ?? '?'}`
			: '(n/a — frontend not reloaded?)'
		slog.info(session.ws,
			`[ClientDiag] received=${d.received ?? '?'} stored=${d.stored ?? '?'} ` +
			`prims=${d.prims ?? '?'} av=${d.av ?? '?'} meshes=${d.meshes ?? '?'} ` +
			`upsertFails=${d.upsertFails ?? '?'} skipNoPos=${d.skippedNoPos ?? '?'} placeholders=${d.placeholders ?? '?'} geoNaN=${d.geoNaN ?? '?'} withTex=${d.withTex ?? '?'} mapped=${d.mapped ?? '?'} | ` +
			`tex ${stat(d.tex)} | mesh ${stat(d.mesh)}`)
		if (d.orphan) slog.info(session.ws,
			`[Orphan] children=${d.orphan.children ?? '?'} orphanByMissingRoot=${d.orphan.orphanByMissingRoot ?? '?'} distinctMissingRoots=${d.orphan.distinctMissingRoots ?? '?'} orphanMeshAtScene=${d.orphan.orphanMeshAtScene ?? '?'}`)
		if (d.texApply) slog.info(session.ws,
			`[TexApply] calls=${d.texApply.calls ?? '?'} null=${d.texApply.null ?? '?'} applied=${d.texApply.applied ?? '?'} dropNoParent=${d.texApply.dropNoParent ?? '?'} dropMatSwap=${d.texApply.dropMatSwap ?? '?'}`)
		if (d.faceTex) slog.info(session.ws,
			`[FaceTex] realDefault=${d.faceTex.realDefault ?? '?'} blankDefault=${d.faceTex.blankDefault ?? '?'} blankButRealFaceTex=${d.faceTex.blankButRealFaceTex ?? '?'} anyRealFaceTex=${d.faceTex.anyRealFaceTex ?? '?'}`)
		return
	}

	if (msg.t === C.CLIENT_LOG) {
		const d = msg.d as { level?: string; msg?: string; stack?: string }
		slog.warn(session.ws, `[ClientLog/${d.level ?? '?'}] ${d.msg ?? ''}${d.stack ? `  @ ${d.stack}` : ''}`)
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
		// WHY: OpenSim/SL region handle = (X_meters << 32) | Y_meters.
		// Empirically confirmed: sim extracts X from upper 32 bits and Y from lower 32 bits.
		// Previous code had (Y<<32)|X — sim returned swapped coords and "region not found".
		const handle = ((BigInt(d.regionX) * 256n) << 32n) | (BigInt(d.regionY) * 256n)
		// Log every incoming UDP packet for 60s to catch TeleportFinish regardless of packet ID.
		session.tpDebugUntil = Date.now() + 60_000
		// Store destination handle so TeleportProgress handler can attempt same-sim completion.
		session.pendingTpHandle = handle
		// WHY 8191 not 255 (matches the C.TELEPORT handler above): server doesn't know the region's
		// dimensions (var regions are 512-8192m); the client clamps to the real size, this is only a
		// sanity bound. The old 255 cap snapped intra-region TPs to Y=255 in a 512m var region.
		const x = Math.max(1, Math.min(8191, d.x))
		const y = Math.max(1, Math.min(8191, d.y))
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
		session.ws.send(JSON.stringify({ t: S.TELEPORT_STARTED, d: {} }))
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
	// PER_TICK 6 @ 500ms heartbeat = 96 ids/tick = 192 ids/sec. Bursting ~1100/s (348 batches in
	// <5s) aged the sim's EntityUpdateQueue (only 113/4792 returned); 32/s was the over-correction
	// (~4min/region drain). 192/s is the middle ground — fast enough to test/fill, paced enough that
	// the queue keeps up. The looping retry below recovers whatever still gets dropped.
	const PER_TICK = 6
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
	// A retry batch is mid-flight → keep draining it. When the last chunk goes out, stamp the
	// cooldown so the NEXT pass waits for late replies before recomputing the unfulfilled set.
	if (s.cacheMissRetryPending.length > 0) {
		sendCacheMissBatch(s, s.cacheMissRetryPending, 1)
		if (s.cacheMissRetryPending.length === 0) s.lastRetryPassAt = Date.now()
		return
	}

	// No active batch. Decide whether to start another retry pass. The sim's EntityUpdateQueue
	// drops some requested ids under backlog; re-asking the still-missing set across several passes
	// recovers them. Stop when: nothing left, hit the pass cap, or progress stalls (plateau = sim
	// structurally won't send those ids — phantom/temp/aged-out-of-region). Each pass uses
	// CacheMissType=1 (CRC-mismatch) — some OpenSim builds honor it differently than type=0.
	const MAX_RETRY_PASSES = 10
	const RETRY_COOLDOWN_MS = 4000   // let late replies land before recomputing unfulfilled

	// Gate the FIRST pass on 5s of enum silence so we don't retry mid-enumeration.
	if (!s.cacheMissRetryStarted) {
		if (s.lastCacheEnumAt === 0) return
		if (Date.now() - s.lastCacheEnumAt < 5000) return
	}
	// Cooldown between passes.
	if (s.lastRetryPassAt && Date.now() - s.lastRetryPassAt < RETRY_COOLDOWN_MS) return

	const passCount = s.retryPassCount ?? 0
	if (passCount >= MAX_RETRY_PASSES || (s.retryPlateauCount ?? 0) >= 2) {
		dumpPrimIdsSnapshot(s)
		return
	}

	const unfulfilled: number[] = []
	for (const id of s.cacheMissAskedEver) if (!s.distinctLocalIds.has(id)) unfulfilled.push(id)
	if (unfulfilled.length === 0) { dumpPrimIdsSnapshot(s); return }

	// Progress / plateau tracking (compare against the count at the previous pass's start).
	const prev = s.lastUnfulfilledCount
	if (prev != null && unfulfilled.length >= prev) s.retryPlateauCount = (s.retryPlateauCount ?? 0) + 1
	else s.retryPlateauCount = 0
	s.lastUnfulfilledCount = unfulfilled.length
	s.retryPassCount       = passCount + 1
	s.cacheMissRetryStarted = true
	s.cacheMissRetryPending = unfulfilled
	slog.info(s.ws, `[CacheMissRetry] pass ${s.retryPassCount}/${MAX_RETRY_PASSES}: re-requesting ${unfulfilled.length} unfulfilled (prev=${prev ?? '—'}, plateau=${s.retryPlateauCount})`)
}

/**
 * Replay the buffered ObjectUpdateCached probes once the client asked (OBJ_PROBE_RESYNC) AND the
 * sim's enumeration has gone quiet for 2s. WHY: the initial probe flood predates the engine's WS
 * handlers (probes dispatched into the void client-side), and the client's resync request predates
 * the flood — so neither side can time this alone. Dripped with a bufferedAmount gate because Bun's
 * ws.send silently DROPS frames past the backpressure cap (observed: 117 burst chunks, 0 received).
 */
function drainProbeResync(s: CircuitState): void {
	if (!s.probeResyncWanted) return
	const backlog = s.probeBacklog
	if (!backlog || backlog.size === 0) return
	if (Date.now() - (s.lastProbeRxAt ?? 0) < 2000) return   // enum still streaming — wait
	s.probeResyncWanted = false
	const all = [...backlog.entries()].filter(([id]) => !s.objCache.has(id))
	if (all.length === 0) return
	const CHUNK = 200, PER_TICK = 4, TICK_MS = 100, MAX_BUFFERED = 256 * 1024
	let i = 0
	const drip = setInterval(() => {
		try {
			for (let k = 0; k < PER_TICK && i < all.length; k++) {
				if ((s.ws.getBufferedAmount?.() ?? 0) > MAX_BUFFERED) return  // socket busy — retry next tick
				const probes = all.slice(i, i + CHUNK).map(([localId, crc]) => ({ localId, crc }))
				s.ws.send(JSON.stringify({ t: S.OBJ_CACHE_PROBE, d: { probes } }))
				i += CHUNK
			}
			if (i >= all.length) {
				clearInterval(drip)
				slog.info(s.ws, `[ObjCached] probe-resync: replayed ${all.length} buffered probes (dripped ${Math.ceil(all.length / CHUNK)} chunks)`)
			}
		} catch { clearInterval(drip) }  // ws gone (reload/close) — client re-arms on next mount
	}, TICK_MS)
}

// ── Interest filter (Phase 0 spike, INTEREST_FILTER=1) ──────────────────────
// See server/lib/interestFilter.ts for the pure core + rationale.

/** Best-known camera centre for interest tests: live camera, else cached spawn (pre-first-MOVE). */
function interestCam(s: CircuitState): [number, number, number] | null {
	return s.lastAgentParams?.camCenter ?? s.cachedSpawnPos ?? null
}

/**
 * Gate the forward path: return only the objects inside the camera interest volume, and record
 * them in sentToClient. Filter OFF (or camera unknown) → forward everything untouched. Objects
 * that don't pass are still cached server-side (objCache) and stream in later via the reconcile
 * tick when the camera approaches. Avatars are never culled.
 */
function filterForwardObjects(s: CircuitState, objects: unknown[]): unknown[] {
	if (!interestEnabled()) return objects
	const cam = interestCam(s)
	if (!cam) return objects   // no idea where the avatar is yet → don't cull
	const r = resolveRadius(s.lastAgentParams?.interestRadius)
	const getObj = (id: number) => s.objCache.get(id) as ObjLike | undefined
	const fwd: unknown[] = []
	for (const o of objects) {
		const obj = o as ObjLike
		if (!isAvatar(obj) && !withinInterest(effectivePos(obj, getObj), cam, r)) continue
		fwd.push(o)
		if (typeof obj.localId === 'number') s.sentToClient.add(obj.localId)
	}
	return fwd
}

/** Pace browser builds — stream at most this many newly-entered objects per 500ms tick. */
const INTEREST_ENTER_CAP = 600

/**
 * Reconcile the browser's held set against the current interest volume (called every 500ms).
 * Forwards objects that just ENTERED the volume (replayed from objCache) and KillObjects those
 * that LEFT — FS-like streaming as the avatar/camera moves.
 */
function reconcileInterestTick(s: CircuitState): void {
	if (!interestEnabled()) return
	const cam = interestCam(s)
	if (!cam) return
	const r = resolveRadius(s.lastAgentParams?.interestRadius)
	const objCache = s.objCache as unknown as Map<number, ObjLike>
	const { enter, leave } = reconcileInterest(objCache, s.sentToClient, cam, r)

	const toEnter = enter.slice(0, INTEREST_ENTER_CAP)
	if (toEnter.length > 0) {
		const objs = toEnter.map(id => s.objCache.get(id)).filter(Boolean)
		for (const id of toEnter) s.sentToClient.add(id)
		s.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects: objs } }))
	}
	if (leave.length > 0) {
		for (const id of leave) s.sentToClient.delete(id)
		s.ws.send(JSON.stringify({ t: S.KILL_OBJECT, d: { ids: leave, cull: true } }))
	}

	// Heartbeat the interest state every ~3s regardless of activity, so the steady-state
	// (and leave/enter churn as the avatar moves) is observable — not just the busy moments.
	const now = Date.now()
	if (now - (s.lastInterestLogAt ?? 0) > 3000) {
		s.lastInterestLogAt = now
		const queued = enter.length - toEnter.length
		slog.info(s.ws, `[Interest] R=${r} cam=[${cam.map(v => v.toFixed(0)).join(',')}] sent=${s.sentToClient.size}/${s.objCache.size} enter=${toEnter.length}${queued > 0 ? `(+${queued} queued)` : ''} cull=${leave.length}`)
	}
}

/** Send an AgentUpdate heartbeat to prevent sim 60s idle timeout */
function sendHeartbeat(s: CircuitState): void {
	const now = Date.now()
	if (now - s.lastAgentUpdateAt < HEARTBEAT_INTERVAL_MS) return
	// WHY: FS `send_agent_update()` line 4188 — stops AgentUpdates while teleporting
	// (except in TELEPORT_ARRIVING state). The sim treats incoming AgentUpdates as "avatar
	// is still active here" which may prevent TeleportFinish from routing back to the viewer.
	if (s.pendingTpHandle) return
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
		far: 512,   // region-wide interest radius (matches client default)
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
		drainProbeResync(s)
		reconcileInterestTick(s)
	}, 500)
	return () => clearInterval(timer)
}

