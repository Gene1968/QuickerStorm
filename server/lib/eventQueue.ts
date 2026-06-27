// server/lib/eventQueue.ts — EventQueueGet long-poll client.
//
// WHY: Cross-region TeleportFinish is NOT a UDP packet. In message.xml it is `flavor=llsd`
// (trusted-sender), meaning the sim delivers it over the EventQueueGet capability — an HTTP
// long-poll — and the viewer's LLMessageSystem::dispatch routes it to the same handler as a
// UDP message would. Without polling EventQueueGet the event sits unread in the sim's queue,
// the agent never CompleteAgentMovement's at the destination, and the source sim's
// WaitForAgentArrivedAtDestination times out at ~31s → TeleportFailed. This is THE blocker for
// cross-region teleport. (Reference: phoenix-firestorm lleventpoll.cpp, llviewerregion.cpp:3642.)
//
// Protocol (from lleventpoll.cpp eventPollCoro):
//   POST <eq-url>  body=llsd { ack: <last id | undef>, done: false }
//   sim long-polls, holding the request ~20-60s
//   on HTTP 502 (OpenSim "no events" timeout) → re-POST immediately
//   on 200 → { events: [ { message, body }, ... ], id: N }  → dispatch each, ack = N, re-POST
//   on 404/410 → queue closed, stop
import { parseLLSD, llsdNum, llsdStr, type LLSDValue } from './llsd'
import { getSession } from '../state/sessions'
import { slog } from './serverLog'
import { applyTeleportFinish } from '../handlers/lludp'
import { S } from '../../shared/protocol.js'

export interface TeleportFinishFields {
	simIp:         string
	simPort:       number
	regionHandle:  bigint
	seedCap:       string
	simAccess:     number
	teleportFlags: number
	regionSizeX:   number   // var-region size of the DESTINATION (0 = absent/unknown on this grid)
	regionSizeY:   number
}

/** Decode a base64 <binary> LLSD leaf (our parser keeps it as verbatim text) to bytes. */
function b64bytes(v: LLSDValue): Buffer {
	return Buffer.from(llsdStr(v).replace(/\s+/g, ''), 'base64')
}

/**
 * Decode the LLSD `body` of a TeleportFinish event-queue event.
 * Body shape: { Info: [ { AgentID, LocationID, RegionHandle, SeedCapability,
 *                         SimAccess, SimIP, SimPort, TeleportFlags } ] }
 * WHY big-endian: OpenSim's EventQueueHelper.TeleportFinishEvent encodes SimIP / RegionHandle /
 * TeleportFlags / LocationID as network-byte-order (BIG-endian) <binary>. This DIFFERS from the
 * UDP packet layout (decodeTeleportFinish reads RegionHandle little-endian) — do not share code.
 * SimPort and SimAccess arrive as plain <integer>; SimPort is tolerated as binary too for safety.
 */
export function decodeTeleportFinishLLSD(body: LLSDValue): TeleportFinishFields | null {
	const info = (body as Record<string, LLSDValue>)?.Info
	const m = (Array.isArray(info) ? info[0] : info) as Record<string, LLSDValue> | undefined
	if (!m || typeof m !== 'object') return null

	const ip = b64bytes(m.SimIP)
	const simIp = ip.length >= 4 ? `${ip[0]}.${ip[1]}.${ip[2]}.${ip[3]}` : ''

	const rh = b64bytes(m.RegionHandle)
	const regionHandle = rh.length >= 8 ? rh.readBigUInt64BE(0) : 0n

	// SimPort: usually <integer>; fall back to 2-byte BE <binary> if encoded that way.
	let simPort = llsdNum(m.SimPort)
	if (!simPort && typeof m.SimPort === 'string') {
		const pb = b64bytes(m.SimPort)
		if (pb.length >= 2) simPort = pb.readUInt16BE(0)
	}

	// TeleportFlags: some OpenSim builds send <integer>, others 4-byte BE <binary>.
	let teleportFlags = llsdNum(m.TeleportFlags)
	if (typeof m.TeleportFlags === 'string') {
		const fb = b64bytes(m.TeleportFlags)
		if (fb.length >= 4) teleportFlags = fb.readUInt32BE(0)
	}

	// Var-region size of the DESTINATION region. Modern OpenSim/SL include RegionSizeX/RegionSizeY as
	// <integer> in the TeleportFinish Info block; older grids omit them (→ 0 = unknown, client keeps its
	// fallback). A 4-byte BE <binary> form is tolerated too. WHY this matters: without it the client's
	// regionSize stays at the LOGIN region's value, and the avatar movement clamp [1, regionSize-1] walls
	// the avatar at the wrong boundary in a larger var-region (1024 region → stuck at 511).
	const sizeOf = (v: LLSDValue): number => {
		let n = llsdNum(v)
		if (!n && typeof v === 'string') { const b = b64bytes(v); if (b.length >= 4) n = b.readUInt32BE(0) }
		return n || 0
	}
	return {
		simIp,
		simPort,
		regionHandle,
		seedCap:   llsdStr(m.SeedCapability),
		simAccess: llsdNum(m.SimAccess),
		teleportFlags,
		regionSizeX: sizeOf(m.RegionSizeX),
		regionSizeY: sizeOf(m.RegionSizeY),
	}
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Start (or restart) the EventQueueGet long-poll for a session.
 * WHY generation counter: a session has at most one active poll. Region crossing or logout bumps
 * eqGen, which the in-flight loop checks after each await and bails when superseded. eqAbort lets
 * us cancel the suspended fetch immediately rather than waiting out its timeout.
 */
export function startEventQueue(sessionId: string, eqUrl: string): void {
	const s = getSession(sessionId)
	if (!s || !eqUrl) return
	s.eqAbort?.abort()
	const gen = (s.eqGen ?? 0) + 1
	s.eqGen = gen
	s.eqAbort = new AbortController()
	slog.info(s.ws, `[EQ] starting event-queue poll (gen ${gen}) → ${eqUrl.slice(0, 60)}…`)
	void pollLoop(sessionId, eqUrl, gen, s.eqAbort.signal)
}

/** Stop the active poll (logout / leaving a region). */
export function stopEventQueue(sessionId: string): void {
	const s = getSession(sessionId)
	if (!s) return
	s.eqAbort?.abort()
	s.eqAbort = undefined
	s.eqGen = (s.eqGen ?? 0) + 1   // supersede any loop that doesn't see the abort
}

async function pollLoop(sessionId: string, eqUrl: string, gen: number, signal: AbortSignal): Promise<void> {
	let ack: LLSDValue = null   // <undef/> on the first poll
	let errorCount = 0

	while (true) {
		const s = getSession(sessionId)
		if (!s || s.eqGen !== gen) return   // superseded (region swap / logout) or session gone

		const ackXml = ack == null ? '<undef/>' : `<integer>${Number(ack)}</integer>`
		const reqBody =
			`<?xml version="1.0"?>\n<llsd><map>` +
			`<key>ack</key>${ackXml}` +
			`<key>done</key><boolean>false</boolean>` +
			`</map></llsd>`

		let res: Response
		try {
			// 65s ceiling: OpenSim holds 20-60s, then 502s. AbortSignal.any ties the fetch to both
			// our explicit abort (region swap) and the per-request timeout.
			res = await fetch(eqUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
				body: reqBody,
				signal: AbortSignal.any([signal, AbortSignal.timeout(65_000)]),
			})
		} catch {
			if (signal.aborted) return
			// Timeout / transient network — treat like an OpenSim "no events" and back off briefly.
			if (++errorCount > 15) { slog.warn(s.ws, `[EQ] giving up after ${errorCount} errors`); return }
			await sleep(1000 * errorCount)
			continue
		}

		const sa = getSession(sessionId)
		if (!sa || sa.eqGen !== gen) return

		// OpenSim signals "no events, re-poll now" with 502 (and occasionally 499/504).
		if (res.status === 502 || res.status === 504 || res.status === 499) { errorCount = 0; continue }
		// 404/410 → the sim closed this queue (we left the region). Stop quietly.
		if (res.status === 404 || res.status === 410) { slog.info(sa.ws, `[EQ] queue closed (${res.status})`); return }
		if (!res.ok) {
			if (++errorCount > 15) { slog.warn(sa.ws, `[EQ] giving up after ${errorCount} HTTP errors (last ${res.status})`); return }
			await sleep(1000 * errorCount)
			continue
		}

		errorCount = 0
		let parsed: LLSDValue
		try { parsed = parseLLSD(await res.text()) } catch { continue }
		const obj = parsed as Record<string, LLSDValue> | null
		if (!obj || !Array.isArray(obj.events)) continue
		if (obj.id != null) ack = obj.id

		for (const ev of obj.events) {
			const e = ev as Record<string, LLSDValue>
			if (e && typeof e === 'object' && e.message != null) {
				dispatchEvent(sessionId, llsdStr(e.message), e.body)
			}
		}
	}
}

type EqHandler = (sessionId: string, body: LLSDValue) => void

export const eqRegistry = new Map<string, EqHandler>([
	['TeleportFinish', (sessionId, body) => {
		const s = getSession(sessionId); if (!s) return
		const f = decodeTeleportFinishLLSD(body)
		if (!f || !f.simIp) { slog.warn(s.ws, `[EQ] TeleportFinish: undecodable body`); return }
		slog.info(s.ws, `[EQ] ✓ TeleportFinish ${f.simIp}:${f.simPort} handle=${f.regionHandle} cap=${f.seedCap.slice(0, 40)}…`)
		applyTeleportFinish(sessionId, f)
	}],
	['TeleportFailed', (sessionId) => {
		const s = getSession(sessionId); if (!s) return
		slog.warn(s.ws, `[EQ] TeleportFailed event`)
		const now = Date.now()
		if (!s.lastTeleportFailedAt || now - s.lastTeleportFailedAt > 5000) {
			s.lastTeleportFailedAt = now
			s.pendingTpHandle = undefined
			s.tpDebugUntil = 0
			s.ws.send(JSON.stringify({ t: S.TELEPORT_FAILED, d: { reason: 'sim reported teleport failed (EQ)' } }))
		}
	}],
	['EnableSimulator', (sessionId, body) => {
		const s = getSession(sessionId); if (!s) return
		try {
			const info = (body as Record<string, LLSDValue>)?.SimulatorInfo
			const e = (Array.isArray(info) ? info[0] : info) as Record<string, LLSDValue> | undefined
			if (e) {
				const sx = llsdNum(e.RegionSizeX), sy = llsdNum(e.RegionSizeY)
				const hb = typeof e.Handle === 'string' ? b64bytes(e.Handle) : Buffer.alloc(0)
				const handle = hb.length >= 8 ? hb.readBigUInt64BE(0) : 0n
				slog.info(s.ws, `[EQ] EnableSimulator handle=${handle} size=${sx || '?'}×${sy || '?'}`)
			} else {
				slog.info(s.ws, `[EQ] (unhandled) EnableSimulator (no SimulatorInfo)`)
			}
		} catch { slog.info(s.ws, `[EQ] (unhandled) EnableSimulator`) }
	}],
])

function dispatchEvent(sessionId: string, message: string, body: LLSDValue): void {
	const s = getSession(sessionId)
	if (!s) return
	const handler = eqRegistry.get(message)
	if (handler) { handler(sessionId, body); return }
	// No dedicated server-side logic → forward raw to the client (LLSD already decoded to JSON).
	// Reacting to a new EQ event becomes client-only work — no server restart.
	slog.info(s.ws, `[EQ] → client (generic) ${message}`)
	s.ws.send(JSON.stringify({ t: S.EQ_EVENT, d: { name: message, body } }))
}
