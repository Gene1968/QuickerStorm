// server/handlers/lludp.ts — UDP→WS relay: decode incoming LLUDP packets, forward to browser
import { getSession } from '../state/sessions'
import {
	parseHeader, parseMsgType,
	decodeChatFromSimulator, decodeObjectUpdate,
	decodeZeroCoded,
	encodeAgentUpdate, encodeChatFromViewer,
} from '../lib/lludp-codec'
import { queueAck, nextSeq, trackReliable, ackReceived, retransmitOverdue, sendPendingAcks } from '../lib/circuit'
import { S, C } from '../../shared/protocol.js'

// Message type codes (low freq IDs) — verify against message.xml
const LOW_CHAT_FROM_SIM       = 139   // TODO verify
const LOW_OBJECT_UPDATE       = 12    // TODO verify
const LOW_OBJECT_UPDATE_TERSE = 11    // TODO verify (ImprovedTerseObjectUpdate)
const FIXED_PACKET_ACK        = 251   // PacketAck fixed ID

/** Called when a UDP packet arrives from the grid sim */
export function handleUdpMessage(sessionId: string, rawBuf: Buffer): void {
	const session = getSession(sessionId)
	if (!session) return

	let buf = rawBuf
	const hdr = parseHeader(buf)

	// Decode zero-coded body if needed
	if (hdr.zeroCoded) {
		const body = decodeZeroCoded(buf.slice(hdr.bodyOffset))
		buf = Buffer.concat([buf.slice(0, hdr.bodyOffset), body])
	}

	// Queue ack for reliable packets
	if (hdr.reliable) queueAck(session, hdr.seq)

	const { type, dataOffset } = parseMsgType(buf, hdr.bodyOffset)

	if (type === `fixed:${FIXED_PACKET_ACK}`) {
		// Sim is acking our reliable packets
		const count = buf[dataOffset]
		for (let i = 0; i < count; i++) {
			const ackSeq = buf.readUInt32LE(dataOffset + 1 + i * 4)
			ackReceived(session, ackSeq)
		}
		return
	}

	if (type === `low:${LOW_CHAT_FROM_SIM}`) {
		try {
			const chat = decodeChatFromSimulator(buf, dataOffset)
			session.ws.send(JSON.stringify({ t: S.CHAT_MSG, d: chat }))
		} catch (e) { console.warn('[lludp] chat decode error', e) }
		return
	}

	if (type === `low:${LOW_OBJECT_UPDATE}`) {
		try {
			const objects = decodeObjectUpdate(buf, dataOffset)
			if (objects.length > 0) {
				session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects } }))
			}
		} catch (e) { console.warn('[lludp] objectUpdate decode error', e) }
		return
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
		const seq = nextSeq(session)
		const pkt = encodeAgentUpdate({ agentId: session.agentId, sessionId: session.sessionId, seq, ...d })
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		return
	}

	if (msg.t === C.CHAT) {
		const d = msg.d as { message: string; chatType: number; channel: number }
		const seq = nextSeq(session)
		const pkt = encodeChatFromViewer({ agentId: session.agentId, sessionId: session.sessionId, seq, ...d })
		trackReliable(session, seq, pkt)
		session.udpSocket.send(pkt, session.simPort, session.simIp)
		return
	}
}

/** Start per-session retransmit timer. Returns cleanup fn. */
export function startCircuitTimers(sessionId: string): () => void {
	const timer = setInterval(() => {
		const s = getSession(sessionId)
		if (!s) { clearInterval(timer); return }
		retransmitOverdue(s)
		sendPendingAcks(s)
	}, 500)
	return () => clearInterval(timer)
}

// Suppress unused variable warning for LOW_OBJECT_UPDATE_TERSE — reserved for Task 9
void LOW_OBJECT_UPDATE_TERSE
