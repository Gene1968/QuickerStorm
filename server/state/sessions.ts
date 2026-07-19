// server/state/sessions.ts — per-user circuit state for LLUDP bridge
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'

export interface CircuitState {
	agentId:      string
	sessionId:    string
	simIp:        string
	simPort:      number
	circuitCode:  number
	// WHY: SL "First Last" name from XML-RPC login response. Required for IM FromAgentName
	// so recipients see real name rather than client's possibly-empty displayName.
	agentName?:   string
	// WHY: regionHandle is U64 extracted from AgentMovementComplete. Required to build
	// TeleportLocationRequest (same-region teleport from LocationBar coord edit).
	regionHandle: bigint
	seqNum:       number   // next outgoing sequence number (increment before use)
	pendingAcks: number[] // incoming reliable packet IDs awaiting our ack
	// Reliable packets we sent, waiting for sim's ack
	reliableOut: Map<number, { buf: Buffer; sentAt: number; retries: number }>
	udpSocket:   dgram.Socket
	ws:          ServerWebSocket<unknown>
	// Diagnostic counters (updated by lludp handler)
	udpRxCount:   number  // total UDP packets received from sim
	lastPingAt:   number  // timestamp of last StartPingCheck received (0 = never)
	lastUdpRxAt:  number  // timestamp of last ANY packet from sim (0 = never)
	circuitEstablished: boolean  // true once UseCircuitCode acked
	// Diagnostic: track packet types seen, logged once each for unhandled types
	loggedTypes: Set<string>
	// Diagnostic: prim-dropout investigation. Counts per LLUDP message type ("high:12" etc),
	// total objects emerging from decodeObjectUpdate, total objects forwarded to WS,
	// distinct localIds ever upserted to objCache, RequestMultipleObjects batches sent +
	// total cached IDs requested. Periodic 5s summary log identifies which boundary drops prims.
	msgRxCounts:        Map<string, number>
	objDecodedCount:    number
	objRelayedCount:    number
	reqMultiOutCount:   number
	reqMultiIdsCount:   number
	distinctLocalIds:   Set<number>
	lastDiagLogAt:      number
	// Paced cache-miss queue. Sim's EntityUpdateQueue ages out RequestMultipleObjects
	// entries when bursted faster than it can process — testing showed 348 batches in <5s
	// yielded only 113 ObjectUpdates from 4792 requested IDs. Drain N per heartbeat tick.
	cacheMissPending:   number[]
	// Every localId we've ever sent via RequestMultipleObjects. Comparing against
	// distinctLocalIds (full ObjectUpdate replies received) tells us which prims sim chose
	// not to satisfy. Useful for debugging "missing in viewer but exists in sim" cases.
	cacheMissAskedEver: Set<number>
	// Phase 2.5 retry pass — after primary drain (CacheMissType=0) completes, re-request any
	// localId still missing from distinctLocalIds using CacheMissType=1 (CRC mismatch). Some
	// OpenSim builds honor type=1 differently than type=0. Single retry; on second drain
	// completion we dump the snapshot.
	cacheMissRetryPending: number[]
	cacheMissRetryStarted: boolean
	// Timestamp of last enqueue into cacheMissPending (i.e. last ObjectUpdateCached enum
	// packet from sim). Retry pass waits for 5s of silence on this stamp before firing so
	// we don't trigger retry mid-enum.
	lastCacheEnumAt: number
	// True once we've dumped the prim-ids snapshot file after pending drained to 0. Prevents
	// re-dumping every tick once drain completes.
	primIdsSnapshotDumped: boolean
	// Looping cache-miss retry: keep re-requesting still-unfulfilled localIds across multiple passes
	// (sim's EntityUpdateQueue drops some under backlog; repeated asks eventually fill). Stops at
	// MAX passes, or on plateau (2 consecutive passes with no progress = sim structurally won't send).
	retryPassCount?:       number   // how many retry passes started
	lastUnfulfilledCount?: number   // unfulfilled count at the start of the previous pass (progress check)
	retryPlateauCount?:    number   // consecutive passes with no progress
	lastRetryPassAt?:      number   // timestamp the last pass's batch finished queueing (cooldown gate)
	// True once a MapLayerRequest has been sent on this circuit (one-shot probe).
	mapLayerSent?: boolean
	// Set when a cross-region TP is in flight; cleared on TeleportFinish/Failed.
	// While set, every incoming UDP packet is logged with raw hex for diagnosis.
	tpDebugUntil?: number
	// Destination regionHandle for in-flight cross-region TP (set when MAP_TELEPORT sent).
	pendingTpHandle?: bigint
	// Timestamp of last TELEPORT_FAILED sent to browser — debounce duplicate reliable retransmits.
	lastTeleportFailedAt?: number
	// Diagnostic counters
	wsMoveCount?: number  // total MOVE messages received from browser client
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
		interestRadius?: number   // client-desired interest radius (m); server clamps via resolveRadius
	} | null
	// Capability URLs negotiated from seed cap (populated 3s after login)
	caps: Map<string, string>
	// ── EventQueueGet long-poll state ─────────────────────────────────────────
	// WHY: Cross-region TeleportFinish (and EnableSimulator/CrossedRegion) arrive over the
	// EventQueueGet HTTP cap, not UDP. eqGen is a generation counter — region crossing or logout
	// bumps it so the in-flight poll loop bails when superseded. eqAbort cancels the suspended
	// fetch immediately. See server/lib/eventQueue.ts.
	eqGen?:   number
	eqAbort?: AbortController
	// ── Session resume fields ────────────────────────────────────────────
	// WHY: On page reload, WS drops but sim circuit stays alive. Bun holds the
	// circuit for CIRCUIT_HOLD_MS so the browser can reconnect without a full
	// XML-RPC re-login (which would be rejected "already logged in").
	userKey?:     string                          // "grid:First Last" — reconnect lookup key
	expireTimer?: ReturnType<typeof setTimeout>   // fires deleteSession if browser never reconnects
	cachedLoginOk?: {                             // re-sent as LOGIN_OK on WS reconnect
		agentId:       string
		sessionId:     string
		simIp:         string
		simPort:       number
		seedCap:       string
		regionName:    string
		regionX:       number
		regionY:       number
		startLocation: string
		agentAccess:   string
		lookAt?:       [number, number, number]   // saved facing (SL look_at) — client seeds initial yaw
	}
	// ── World snapshot cache (resync after WS reconnect / HMR / page reload) ─
	// WHY: Sim sends RegionHandshake, terrain LayerData, and ObjectUpdates exactly once
	// when a circuit comes online. After page reload the UDP circuit stays alive (no
	// re-handshake) so the browser has no way to get this data back without a full
	// logout/relogin. Cache the snapshots server-side and replay on demand.
	cachedRegionName?:   string
	cachedRegionAccess?: number
	// WHY: render-critical environment from RegionHandshake (water level + terrain textures).
	// Replayed via REGION_INFO on resync so HMR/reload keeps correct water height + palette.
	cachedRegionEnv?: {
		waterHeight:        number
		terrainDetail:      string[]
		terrainStartHeight: number[]
		terrainHeightRange: number[]
		regionId:           string
	}
	cachedSpawnPos?:     [number, number, number]
	// ── Avatar appearance (bundle 7) ─────────────────────────────────────────
	// WHY: The sim sends AvatarAppearance once per avatar (then only on change). After a WS
	// reconnect/reload the client's appearance map is empty and the sim won't re-send, so every
	// peer would re-cloud. Cache the forwarded WS payload per avatarId and replay on resync.
	appearanceCache: Map<string, unknown>   // avatarId → S.AVATAR_APPEARANCE `d` payload
	// WHY: same replay rationale as appearanceCache — AvatarAnimation is a full-state signal sent
	// only on change, so a reloaded client would leave every avatar frozen at rest pose until their
	// NEXT anim change. Cache the latest signaled set per avatarId and replay on resync (7·D).
	animationCache: Map<string, unknown>    // avatarId → S.AVATAR_ANIMATION `d` payload
	/** AgentSetAppearance SerialNum counter — stub send is 1, each appearance echo bumps it. */
	appearanceSerial?: number
	/** Dedup key (params+TE hash) of the last echoed own appearance — breaks the echo loop when
	 *  the sim rebroadcasts our own AvatarAppearance after our AgentSetAppearance. */
	lastAppearanceEchoKey?: string
	// Keyed by `${patchX},${patchY}` — last decoded LAND patch for that tile.
	// WHY: WATER layer omitted (water plane is fixed flat).
	terrainCache: Map<string, { patchSize: number; x: number; y: number; heights: number[] }>
	// WHY: Track which patches have received real LAND (0x4C/0x4D) data. WATER_FLOOR (0x37)
	// patches are only forwarded for keys NOT in this set — prevents the original bug where
	// 0x37 arrived after LAND and overwrote h=23m with h≈0.
	coveredLandPatches: Set<string>
	// WHY: Cache the last full ObjectUpdate per localId. On WS reconnect / manual resync we
	// replay these so prims and avatars reappear without waiting for the sim to re-blast its
	// interest list. TerseUpdates (position deltas) layer on top — they reference the localId
	// established by an ObjectUpdate, so the cache is what makes the scene reconstitutable.
	// objCache stores the raw decoded obj payload as forwarded to the browser.
	objCache: Map<number, unknown>   // localId → obj record (shape matches decodeObjectUpdate output)
	// ── Interest filter (Phase 0 spike, INTEREST_FILTER=1) ──────────────────
	// WHY: localIds currently forwarded to the browser. The forward path only sends objects
	// inside the camera interest volume; the 500ms reconcile tick streams the rest in (ENTER)
	// and KillObjects them out (LEAVE) as the camera moves. Distinct from distinctLocalIds
	// (ever-received) and objCache (everything cached server-side) — this is what the browser
	// is holding RIGHT NOW, the set we keep bounded so the tab heap stays bounded.
	sentToClient: Set<number>
	// ── Stale-scene ghost reconciliation (see docs/superpowers/specs/2026-06-27-…-design.md) ──
	/** localIds the client pre-seeded from its qs-objects IDB for the current region run. Diffed
	 *  against distinctLocalIds to find ghosts. Null until OBJ_CLIENT_CACHED arrives. */
	clientCached: Set<number> | null
	/** One-shot guard: ghost reconciliation has already run for the current region run. */
	ghostReconcileDone: boolean
	/** Timestamp of region entry / login — min-age gate so reconcile never fires during the flood. */
	regionEnteredAt: number
	lastInterestLogAt?: number   // throttle the [Interest] telemetry line
	// The own avatar's last full ObjectUpdate (pcode 47, fullId == agentId), captured at receive time.
	// WHY: on session resume the sim won't re-broadcast the avatar (agent already present) and a
	// duplicate CompleteAgentMovement is ignored, so without this the own avatar is lost on reload
	// (no ownAvatarLocalId → follow-cam dead, movement blocked). resync replays this so the client
	// re-establishes ownAvatarLocalId; the localId is session-stable, so live TerseUpdates reconcile.
	ownAvatarUpdate?: unknown

	// Every ObjectUpdateCached probe (localId → crc) seen this session. WHY: the sim floods these in
	// the first seconds after login — often BEFORE the browser's world engine has mounted its WS
	// handlers — so the forwarded copies dispatch into the void and the client never requests the
	// objects (scene stuck near-empty after a cache purge). The client asks for a replay of this
	// backlog (C.OBJ_PROBE_RESYNC) once its engine is actually listening. Lazily initialized.
	probeBacklog?: Map<number, number>
	// Client asked for a probe-backlog replay (C.OBJ_PROBE_RESYNC). WHY a flag drained by the
	// heartbeat, not an immediate reply: the client's request races the START of the sim's probe
	// flood (preseed fires on the first ObjectUpdate, often before any probe packet) — replying
	// instantly replays an empty/partial backlog. The heartbeat waits for enum-quiet, then drips.
	probeResyncWanted?: boolean
	lastProbeRxAt?:     number   // timestamp of last ObjectUpdateCached packet (enum-quiet gate)
}

const sessions     = new Map<string, CircuitState>()
const userSessions = new Map<string, string>()   // userKey   → circuitId
const wsToCircuit  = new Map<string, string>()   // wsId (per-connection UUID) → circuitId

// How long to hold a circuit after WS drops before destroying UDP socket
const CIRCUIT_HOLD_MS = 15_000

// ── Core CRUD ────────────────────────────────────────────────────────────

export function createSession(id: string, state: CircuitState): void {
	sessions.set(id, state)
	if (state.userKey) userSessions.set(state.userKey, id)
}

export function getSession(id: string): CircuitState | undefined {
	return sessions.get(id)
}

export function deleteSession(id: string): void {
	const s = sessions.get(id)
	if (s) {
		if (s.expireTimer) clearTimeout(s.expireTimer)
		if (s.userKey) userSessions.delete(s.userKey)
		s.eqAbort?.abort()   // stop the EventQueueGet long-poll
		try { s.udpSocket.close() } catch { /* already closed */ }
		sessions.delete(id)
	}
	// Clean up any WS→circuit mappings pointing at this circuit
	for (const [wsId, cId] of wsToCircuit) {
		if (cId === id) wsToCircuit.delete(wsId)
	}
}

export function allSessions(): Map<string, CircuitState> {
	return sessions
}

// ── Session resume helpers ────────────────────────────────────────────────

/** Look up an existing live circuit by "grid:username" key. */
export function findCircuitByUser(userKey: string): { circuitId: string; circuit: CircuitState } | undefined {
	const id = userSessions.get(userKey)
	if (!id) return undefined
	const c = sessions.get(id)
	if (!c) return undefined
	return { circuitId: id, circuit: c }
}

/**
 * Record that wsId routes to circuitId.
 * WHY: Reconnect WS has a new per-connection UUID that differs from the circuitId
 * (which was the first WS's UUID). wsToCircuit lets MOVE/CHAT/close all route correctly.
 */
export function attachWs(wsId: string, circuitId: string): void {
	wsToCircuit.set(wsId, circuitId)
}

export function detachWs(wsId: string): void {
	wsToCircuit.delete(wsId)
}

/**
 * Resolve the circuit key for a given WS session ID.
 * First connection: wsId === circuitId (no entry → fallback to wsId).
 * Reconnect:        wsId → circuitId via wsToCircuit map.
 */
export function resolveCircuitId(wsId: string): string {
	return wsToCircuit.get(wsId) ?? wsId
}

/** Start the hold timer — deletes circuit if browser doesn't reconnect in time. */
export function scheduleExpire(circuitId: string): void {
	const s = sessions.get(circuitId)
	if (!s) return
	if (s.expireTimer) clearTimeout(s.expireTimer)
	s.expireTimer = setTimeout(() => deleteSession(circuitId), CIRCUIT_HOLD_MS)
}

/** Cancel a pending expire — called when browser reconnects successfully. */
export function cancelExpire(circuitId: string): void {
	const s = sessions.get(circuitId)
	if (!s?.expireTimer) return
	clearTimeout(s.expireTimer)
	s.expireTimer = undefined
}
