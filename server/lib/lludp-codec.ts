// server/lib/lludp-codec.ts — LLUDP binary packet encoder/decoder for Phase 1 messages
// Reference: http://wiki.secondlife.com/wiki/LLUDP
// Message IDs: verify against phoenix-firestorm/indra/newview/app_settings/message.xml

// ── Flags — LLUDP spec (wiki.secondlife.com/wiki/LLUDP, LibOpenMetaverse) ──
// WHY: Flags are bit-significant. Previous values (0x10/0x40/0x01) were wrong:
//   0x10 = MSG_APPENDED_ACKS (not Reliable!) → sim crashed with IndexOutOfRange
//   parsing appended acks from our reliable packet bodies.
const FLAG_ZERO_CODED  = 0x80  // body is zero-coded
const FLAG_RELIABLE    = 0x40  // packet must be ACKed by receiver
const FLAG_RESEND      = 0x20  // retransmit of a reliable packet
const FLAG_HAS_ACKS    = 0x10  // appended ACK list at end of packet

// ── Message ID bytes (verify against message.xml) ─────────────────────────
const MSG_ID = {
  AgentUpdate:               Buffer.from([0x04]),                     // High #4
  UseCircuitCode:            Buffer.from([0xFF, 0xFF, 0x00, 0x03]),   // Low #3
  CompleteAgentMovement:     Buffer.from([0xFF, 0xFF, 0x00, 0xF9]),   // Low #249
  AgentThrottle:             Buffer.from([0xFF, 0xFF, 0x00, 0x51]),   // Low #81
  AgentHeightWidth:          Buffer.from([0xFF, 0xFF, 0x00, 0x18]),   // Low #24
  LogoutRequest:             Buffer.from([0xFF, 0xFF, 0x00, 0xFC]),   // Low #252
  PacketAck:                 Buffer.from([0xFF, 0xFF, 0xFF, 0xFB]),   // Fixed #251
  StartPingCheck:            Buffer.from([0x01]),                     // High #1 (received from sim)
  CompletePingCheck:         Buffer.from([0x02]),                     // High #2 (we send back)
  RegionHandshake:           Buffer.from([0xFF, 0xFF, 0x00, 0x94]),   // Low #148 (received from sim)
  RegionHandshakeReply:      Buffer.from([0xFF, 0xFF, 0x00, 0x95]),   // Low #149 (we send back)
  AgentMovementComplete:     Buffer.from([0xFF, 0xFF, 0x00, 0xFA]),   // Low #250 (received from sim)
  // Verified from packet log: these arrive as High-frequency (1-byte prefix)
  ChatFromViewer:            Buffer.from([0xFF, 0xFF, 0x00, 0x50]),   // Low #80 (we send)
  ChatFromSimulator:         Buffer.from([0xFF, 0xFF, 0x00, 0x8B]),   // Low #139 (received)
  ObjectUpdate:              Buffer.from([0x0C]),                     // High #12 (received from sim)
  ImprovedTerseObjectUpdate: Buffer.from([0x0F]),                     // High #15 (received from sim)
}

// ── UUID helpers ─────────────────────────────────────────────────────────
export function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

export function bytesToUuid(buf: Buffer, offset = 0): string {
  const h = buf.slice(offset, offset + 16).toString('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

// ── Zero coding ──────────────────────────────────────────────────────────
export function decodeZeroCoded(buf: Buffer): Buffer {
  const out: number[] = []
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x00) {
      const count = buf[++i] ?? 1
      // WHY: count=0 means 256 zeros per LLUDP spec (LibOpenMetaverse ZeroDecode).
      // Without this, 00 00 produces 0 zeros instead of 256, truncating the decoded
      // buffer and causing OOB errors in ObjectUpdate trailing fields (ExtraParams, Sound, etc.).
      const zeros = count === 0 ? 256 : count
      for (let z = 0; z < zeros; z++) out.push(0x00)
    } else {
      out.push(buf[i])
    }
  }
  return Buffer.from(out)
}

export function encodeZeroCoded(buf: Buffer): Buffer {
  const out: number[] = []
  let i = 0
  while (i < buf.length) {
    if (buf[i] === 0x00) {
      let count = 0
      while (i < buf.length && buf[i] === 0x00 && count < 255) { count++; i++ }
      out.push(0x00, count)
    } else {
      out.push(buf[i++])
    }
  }
  return Buffer.from(out)
}

// ── Header ───────────────────────────────────────────────────────────────
interface HeaderOpts { seq: number; reliable: boolean; hasAcks: boolean; zeroCoded: boolean }

export function buildHeader(o: HeaderOpts): Buffer {
  const flags = (o.reliable   ? FLAG_RELIABLE   : 0)
              | (o.hasAcks    ? FLAG_HAS_ACKS    : 0)
              | (o.zeroCoded  ? FLAG_ZERO_CODED  : 0)
  const hdr = Buffer.alloc(6)
  hdr[0] = flags
  hdr.writeUInt32BE(o.seq, 1)
  hdr[5] = 0  // no extra bytes
  return hdr
}

export interface ParsedHeader {
  flags:      number
  reliable:   boolean
  hasAcks:    boolean
  zeroCoded:  boolean
  seq:        number
  extraBytes: number
  bodyOffset: number // where body starts (after header + extra)
}

export function parseHeader(buf: Buffer): ParsedHeader {
  const flags      = buf[0]
  const seq        = buf.readUInt32BE(1)
  const extraBytes = buf[5]
  return {
    flags,
    reliable:   (flags & FLAG_RELIABLE)   !== 0,
    hasAcks:    (flags & FLAG_HAS_ACKS)   !== 0,
    zeroCoded:  (flags & FLAG_ZERO_CODED) !== 0,
    seq,
    extraBytes,
    bodyOffset: 6 + extraBytes,
  }
}

// ── Message type detection ────────────────────────────────────────────────
export function parseMsgType(buf: Buffer, bodyOffset: number): { type: string; dataOffset: number } {
  const b0 = buf[bodyOffset]
  if (b0 !== 0xFF) {
    // High frequency — 1 byte ID
    return { type: `high:${b0}`, dataOffset: bodyOffset + 1 }
  }
  const b1 = buf[bodyOffset + 1]
  if (b1 !== 0xFF) {
    // Medium frequency — 2 bytes
    return { type: `med:${b1}`, dataOffset: bodyOffset + 2 }
  }
  const b2 = buf[bodyOffset + 2]
  if (b2 !== 0xFF) {
    // Low frequency — 4 bytes, ID is uint16 from bytes 2-3
    const id = buf.readUInt16BE(bodyOffset + 2)
    return { type: `low:${id}`, dataOffset: bodyOffset + 4 }
  }
  // Fixed — 4 bytes
  const id = buf[bodyOffset + 3]
  return { type: `fixed:${id}`, dataOffset: bodyOffset + 4 }
}

// ── Outgoing message encoders ─────────────────────────────────────────────

interface CircuitParams { agentId: string; sessionId: string; circuitCode: number; seq: number }

export function encodeUseCircuitCode(p: CircuitParams): Buffer {
  // WHY: SL spec CircuitCode block order is Code(U32), SessionID(UUID), ID/AgentID(UUID)
  // Previous version had wrong order (AgentID first) — sim silently rejected every packet.
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(4 + 16 + 16)
  body.writeUInt32LE(p.circuitCode, 0)        // Code  (U32)   — FIRST
  uuidToBytes(p.sessionId).copy(body, 4)      // SessionID     — SECOND
  uuidToBytes(p.agentId).copy(body, 20)       // ID (AgentID)  — THIRD
  return Buffer.concat([hdr, MSG_ID.UseCircuitCode, body])
}

export function encodeCompleteAgentMovement(p: CircuitParams): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  body.writeUInt32LE(p.circuitCode, 32)
  return Buffer.concat([hdr, MSG_ID.CompleteAgentMovement, body])
}

/** AgentThrottle — tell sim bandwidth allocation per category (bps).
 *  WHY: OpenSim requires this after CompleteAgentMovement to enable avatar physics.
 *  Without it, animations work (state-only) but movement/rotation are silently blocked.
 *  Firestorm sends this immediately after CompleteAgentMovement with Firestorm-typical values.
 *  Values are in bits/sec: resend, land, wind, cloud, task, texture, asset.
 */
export function encodeAgentThrottle(p: { agentId: string; sessionId: string; circuitCode: number; seq: number }): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  // 7 throttle categories × 4 bytes F32LE = 28 bytes
  // WHY: Using Firestorm-like defaults. Too low → sim starves textures/objects.
  // Too high → sim floods us and we can't keep up. These are typical mid-range values.
  const THROTTLES = [150000, 162000, 20000, 20000, 700000, 1300000, 500000]
  const throttleBuf = Buffer.allocUnsafe(28)
  THROTTLES.forEach((v, i) => throttleBuf.writeFloatLE(v, i * 4))

  // WHY: AgentThrottle has two blocks: AgentData(AgentID+SessionID+CircuitCode) and
  // Throttle(GenCounter+Throttles). GenCounter is always 0 for the initial throttle set.
  // Missing GenCounter shifts Throttles by 4 bytes → sim reads garbage throttle values.
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 4 + 1 + 28)  // 69 bytes
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(p.circuitCode, off);   off += 4
  body.writeUInt32LE(0, off);               off += 4  // GenCounter = 0
  body[off++] = 28  // Variable1 length prefix for Throttle field
  throttleBuf.copy(body, off)
  return Buffer.concat([hdr, MSG_ID.AgentThrottle, body])
}

/** AgentHeightWidth — tell sim viewport dimensions so it knows our field of view.
 *  WHY: Sent by all real viewers after CompleteAgentMovement. Some OpenSim builds gate
 *  SendInitialDataToMe (which sends terrain) until this is received.
 *  Firestorm-typical values: 1024 × 768. GenCounter = 0 for initial send.
 */
export function encodeAgentHeightWidth(p: { agentId: string; sessionId: string; circuitCode: number; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 4 + 2 + 2)  // 44 bytes
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);    off += 16
  uuidToBytes(p.sessionId).copy(body, off);  off += 16
  body.writeUInt32LE(p.circuitCode, off);    off += 4
  body.writeUInt32LE(0, off);                off += 4   // GenCounter = 0
  body.writeUInt16LE(768, off);              off += 2   // Height
  body.writeUInt16LE(1024, off)                         // Width
  return Buffer.concat([hdr, MSG_ID.AgentHeightWidth, body])
}

export function encodePacketAck(ackIds: number[], seq: number): Buffer {
  const hdr  = buildHeader({ seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(1 + ackIds.length * 4)
  body[0] = ackIds.length
  ackIds.forEach((id, i) => body.writeUInt32LE(id, 1 + i * 4))
  return Buffer.concat([hdr, MSG_ID.PacketAck, body])
}

/** Respond to StartPingCheck (Low#1) with CompletePingCheck (Low#2) to keep circuit alive */
export function encodeCompletePingCheck(pingId: number, seq: number): Buffer {
  const hdr  = buildHeader({ seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(1)
  body[0] = pingId
  return Buffer.concat([hdr, MSG_ID.CompletePingCheck, body])
}

/** TeleportLocationRequest (Low #63) — teleport avatar to position within any region.
 *  WHY: Triggered when user edits coords in LocationBar. Same-region teleport completes
 *  with TeleportLocal (Low #64); cross-region teleport gets TeleportFinish (Low #69).
 *  Previous code had wrong ID 0x45 (Low #69 = TeleportFinish!) — sim got garbled packet.
 */
export function encodeTeleportLocationRequest(p: {
  agentId:      string
  sessionId:    string
  seq:          number
  regionHandle: bigint   // U64LE — current or target region handle
  x:            number   // SL X (east) in metres [0..256]
  y:            number   // SL Y (north) in metres [0..256]
  z:            number   // SL Z (height) in metres
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG  = Buffer.from([0xFF, 0xFF, 0x00, 0x3F])  // Low #63
  // AgentData block (32) + TeleportData block (8+12+12=32) = 64 bytes
  const body = Buffer.allocUnsafe(64)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeBigUInt64LE(p.regionHandle, off); off += 8
  body.writeFloatLE(p.x, off); off += 4
  body.writeFloatLE(p.y, off); off += 4
  body.writeFloatLE(p.z, off); off += 4
  // LookAt — face north (0, 1, 0) as default orientation
  body.writeFloatLE(0, off); off += 4
  body.writeFloatLE(1, off); off += 4
  body.writeFloatLE(0, off); off += 4
  return Buffer.concat([hdr, MSG, body])
}

/** RequestMultipleObjects (Medium #22 = 0xFF 0x16) — ask sim for full ObjectUpdate for
 *  objects we have in ObjectUpdateCached but don't know about.
 *  WHY: Sims send ObjectUpdateCached (high:11) for objects they think the viewer has cached.
 *  Since we have no object cache, we must reply to get the full update (pcode, pos, name).
 *  Without this, our own avatar's ObjectUpdate (pcode=47) is never received, ownAvatarLocalId
 *  stays null, and TerseUpdates are never attributed → location bar never updates on movement.
 */
export function encodeRequestMultipleObjects(p: {
  agentId:   string
  sessionId: string
  seq:       number
  ids:       number[]  // localIds to request
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG  = Buffer.from([0xFF, 0x16])  // Medium #22
  const body = Buffer.allocUnsafe(16 + 16 + 1 + p.ids.length * 5)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = p.ids.length
  for (const id of p.ids) {
    body[off++] = 0   // CacheMissType = 0 (full update)
    body.writeUInt32LE(id, off); off += 4
  }
  return Buffer.concat([hdr, MSG, body])
}

/** Decode ObjectUpdateCached (High #11) — sim sends this for objects viewer supposedly has.
 *  Returns array of localIds we should request via RequestMultipleObjects.
 */
export function decodeObjectUpdateCached(buf: Buffer, dataOffset: number): number[] {
  const ids: number[] = []
  let off = dataOffset
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16
  const count = buf[off++]
  for (let i = 0; i < count && off + 7 < buf.length; i++) {
    const localId = buf.readUInt32LE(off); off += 4
    off += 4   // CRC U32
    if (localId !== 0) ids.push(localId)
  }
  return ids
}

export function encodeLogoutRequest(p: { agentId: string; sessionId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(32)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  return Buffer.concat([hdr, MSG_ID.LogoutRequest, body])
}

interface AgentUpdateParams {
  agentId:      string
  sessionId:    string
  seq:          number
  controlFlags: number              // bitmask: 0x01=fwd, 0x02=back, 0x04=left, 0x08=right, 0x10=up, 0x20=down
  bodyRot:      [number, number, number]  // quaternion xyz (w derived)
  headRot:      [number, number, number]
  camCenter:    [number, number, number]
  camAt:        [number, number, number]
  camLeft:      [number, number, number]
  camUp:        [number, number, number]
  far:          number
}

export function encodeAgentUpdate(p: AgentUpdateParams): Buffer {
  // AgentUpdate: High freq, NOT reliable (sent at ~10Hz, dropped if lost)
  const hdr = buildHeader({ seq: p.seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 12 + 12 + 1 + 12 + 12 + 12 + 12 + 4 + 4 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  // BodyRotation (3 floats = xyz of quaternion)
  p.bodyRot.forEach(v => { body.writeFloatLE(v, off); off += 4 })
  // HeadRotation
  p.headRot.forEach(v => { body.writeFloatLE(v, off); off += 4 })
  body[off++] = 0  // State
  // Camera vectors
  p.camCenter.forEach(v => { body.writeFloatLE(v, off); off += 4 })
  p.camAt.forEach(v    => { body.writeFloatLE(v, off); off += 4 })
  p.camLeft.forEach(v  => { body.writeFloatLE(v, off); off += 4 })
  p.camUp.forEach(v    => { body.writeFloatLE(v, off); off += 4 })
  body.writeFloatLE(p.far, off);         off += 4
  body.writeUInt32LE(p.controlFlags, off); off += 4
  body[off++] = 0  // Flags
  return Buffer.concat([hdr, MSG_ID.AgentUpdate, body])
}

export function encodeChatFromViewer(p: {
  agentId: string; sessionId: string; seq: number
  message: string; chatType: number; channel: number
}): Buffer {
  // WHY: ChatData.Message is Variable2 (2-byte length prefix), not Variable1 (1-byte).
  // Previous version used 1-byte prefix — chat was malformed and sim ignored it.
  const hdr    = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const msgBuf = Buffer.from(p.message, 'utf8')
  const body   = Buffer.allocUnsafe(16 + 16 + 2 + msgBuf.length + 1 + 4)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);     off += 16
  uuidToBytes(p.sessionId).copy(body, off);   off += 16
  body.writeUInt16LE(msgBuf.length, off);     off += 2  // Variable2 — 2-byte length
  msgBuf.copy(body, off);                     off += msgBuf.length
  body[off++] = p.chatType
  body.writeInt32LE(p.channel, off)
  return Buffer.concat([hdr, MSG_ID.ChatFromViewer, body])
}

// ── Incoming message decoders ─────────────────────────────────────────────

export interface ChatFromSimData {
  fromName: string
  sourceId: string
  chatType: number
  channel:  number
  message:  string
  position: [number, number, number]
}

export function decodeChatFromSimulator(buf: Buffer, dataOffset: number): ChatFromSimData {
  let off = dataOffset
  // FromName: variable1 (1-byte length prefix)
  const nameLen  = buf[off++]
  const fromName = buf.slice(off, off + nameLen).toString('utf8').replace(/\0/g, ''); off += nameLen
  // SourceID: UUID (16 bytes)
  const sourceId = bytesToUuid(buf, off); off += 16
  // OwnerID: UUID (16 bytes) — skip
  off += 16
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _sourceType = buf[off++]  // unused in Phase 1
  const chatType    = buf[off++]
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _audible    = buf[off++]  // unused
  // Position: 3 floats
  const px = buf.readFloatLE(off); off += 4
  const py = buf.readFloatLE(off); off += 4
  const pz = buf.readFloatLE(off); off += 4
  // Message: variable2 (2-byte length prefix)
  const msgLen = buf.readUInt16LE(off); off += 2
  const message = buf.slice(off, off + msgLen).toString('utf8').replace(/\0/g, '')
  return { fromName, sourceId, chatType, channel: 0, message, position: [px, py, pz] }
}

export interface ObjectData {
  localId:   number
  fullId:    string
  pcode:     number   // 9=prim, 47=avatar
  scale:     [number, number, number]
  pos:       [number, number, number]
  nameValue: string   // raw NameValue string (contains avatar display name)
}

/**
 * Minimal ObjectUpdate decoder — extracts type, scale, position, and name.
 * WHY: ObjectData blob format: if length >= 12, first 12 bytes are position as 3 F32LE.
 * Full float updates (76 bytes) and half-precision (48 bytes) both start with F32 position.
 */
export function decodeObjectUpdate(
  buf: Buffer,
  dataOffset: number,
  onError?: (msg: string) => void,
  onDiag?: (msg: string) => void,
): ObjectData[] {
  const objects: ObjectData[] = []
  let off = dataOffset

  // RegionData block (1)
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16

  // ObjectData block (variable count)
  const count = buf[off++]
  for (let i = 0; i < count && off < buf.length; i++) {
    // WHY: Per-object try/catch — if one object's decode fails (corrupt packet, unknown
    // extension, wrong offset) we still forward the objects decoded so far rather than
    // losing the entire packet. Error is rethrown with position context for server logging.
    const objStartOff = off
    let localId = 0, pcode = 0
    let _diag = ''   // WHY: declared before try so catch block can read it
    try {
      localId = buf.readUInt32LE(off); off += 4
      // WHY: OpenSim inserts 25-byte null/tombstone entries between real objects in
      // multi-object packets. Format: localId(0,4)+state(1)+fullId(16)+CRC(4)=25 bytes.
      // These are NOT full ObjectData records. localId=0 is reserved/invalid in SL/OS.
      // Skip the remaining 21 bytes and continue so we land on the next real object.
      if (localId === 0) { off += 21; continue }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _state   = buf[off++]
      const fullId   = bytesToUuid(buf, off); off += 16
      off += 4   // CRC
      pcode = buf[off++]
      // WHY: pcode=3 (legacy tree/particle), pcode=95 (grass), pcode=255 (tree) use
      // non-standard ObjectData layouts in OpenSim. Their TE field reads as garbage
      // (animated texture UV data) rather than a real TE size prefix, causing thousands
      // of OOB errors per session that flood server-log.txt. We don't render these in
      // Phase 1. Break SILENTLY (no onError call) to suppress the log spam. Cannot
      // `continue` because off would be corrupted after the failed TE variable-field skip.
      // avatarSLPos and ownAvatarLocalId survive any avatar-packet loss via worldStore
      // restore in onMounted (see useWorldEngine.js).
      // WHY pcode=0: OpenSim emits pcode=0 objects with garbage scale and CRC=0 in some
      // multi-object packets. These are not standard LLUDP prims/avatars and decode to
      // absurd ObjectData lengths (235+), pushing @TE OOB. Silently skip.
      if (pcode === 0 || pcode === 3 || pcode === 95 || pcode === 255) break
      off += 2   // material, clickAction
      const sx = buf.readFloatLE(off); off += 4  // Scale
      const sy = buf.readFloatLE(off); off += 4
      const sz = buf.readFloatLE(off); off += 4
      // WHY: ObjectData blob format per LibOpenMetaverse ObjectManager.cs:
      //   76 bytes → avatar full update: CollisionPlane(16B F32) THEN Position(12B F32)
      //   60 bytes → prim full update: Position(12B F32) at byte 0
      //   48 bytes → mixed update: Position(12B F32) at byte 0
      // Reading byte 0 for a 76-byte blob gives the collision-plane normal [0,0,1,−z],
      // which decodes as SL pos (0,0,1) and places the avatar mesh at the region corner.
      const odLen = buf[off++]
      _diag = `od=${odLen}`
      let pos: [number, number, number] = [0, 0, 0]
      if (odLen >= 12) {
        const posOff = (odLen === 76) ? off + 16 : off   // skip CollisionPlane for avatar blobs
        pos = [buf.readFloatLE(posOff), buf.readFloatLE(posOff + 4), buf.readFloatLE(posOff + 8)]
      }
      off += odLen
      off += 4   // parentId
      off += 4   // updateFlags
      // WHY: Path/profile block is 23 bytes, not 10.
      //   PathCurve(1) + ProfileCurve(1) + PathBegin(2) + PathEnd(2) +
      //   PathScaleX(1) + PathScaleY(1) + PathShearX(1) + PathShearY(1) +
      //   PathTwist(1) + PathTwistBegin(1) + PathRadiusOffset(1) +
      //   PathTaperX(1) + PathTaperY(1) + PathRevolutions(1) + PathSkew(1) +
      //   ProfileBegin(2) + ProfileEnd(2) + ProfileHollow(2) = 23
      // Previous off+=10 caused readUInt16LE to land on PathScaleX/Y (0x80,0x80 = 32896),
      // making TextureEntry skip 32KB → RangeError → decode crash → no obj_upd WS message.
      off += 23
      // Variable fields: each variable2 has 2-byte length prefix, variable1 has 1-byte
      // WHY: closures capture `off` by reference so each call advances the shared offset.
      // WHY safe guards: if off goes OOB inside a field skip, throw with field name
      // rather than silently producing NaN (undefined arithmetic) that masks which field failed.
      const skipVar2 = (name: string) => {
        if (off + 1 >= buf.length) throw new Error(`${name} prefix OOB at off=${off}`)
        const len = buf.readUInt16LE(off)
        _diag += ` ${name}=${len}`
        off += 2 + len
      }
      const skipVar1 = (name: string) => {
        if (off >= buf.length) throw new Error(`${name} prefix OOB at off=${off}`)
        const len = buf[off++]
        _diag += ` ${name}=${len}`
        if (len === undefined) throw new Error(`${name}: undefined len at off=${off - 1}`)
        off += len
      }
      // WHY: Log the actual 2 bytes at the TE prefix position so we can see if the
      // length is garbage (misalignment) or legitimately large. TE bytes change each packet
      // for animated-texture objects — if they're always "random" values the field is misaligned.
      const _teBytesHex = off + 1 < buf.length ? buf.slice(off, off + 2).toString('hex') : 'OOB'
      _diag += ` @TE=${off}[${_teBytesHex}]`  // WHY: prefix bytes confirm alignment
      // WHY: Sanity-check TE prefix before skipping. Legitimate TE for any SL/OpenSim
      // object (prim, avatar, particle) is ≤ ~500 bytes (16 faces × ~30B each).
      // Prefix > 2048 means the field pointer is misaligned — this pcode's layout
      // differs from the standard decoder (hits pcode=25, pcode=29, and any future
      // unknowns that also have garbage TE). Break SILENTLY (no onError) to suppress
      // log spam. Cannot `continue` — off is at a wrong position for this packet.
      if (off + 1 < buf.length && buf.readUInt16LE(off) > 2048) break
      skipVar2('TE')  // TextureEntry (Variable2)
      // WHY: TextureAnim is Variable1 (1-byte prefix), NOT Variable2.
      // LLUDP message_template: TextureAnim { Variable 1 }
      // Bug was: skipVar2() reading 1-byte TA prefix + 1-byte NV prefix as U16LE → crash.
      skipVar1('TA')  // TextureAnim (Variable1 — 1-byte prefix)
      // NameValue: variable2 — read value before skipping
      if (off + 1 >= buf.length) throw new Error(`NV prefix OOB at off=${off}`)
      const nvLen    = buf.readUInt16LE(off); off += 2
      _diag += ` NV=${nvLen}`
      const nameValue = buf.slice(off, off + nvLen).toString('utf8'); off += nvLen
      skipVar1('Data')
      skipVar1('Text')
      off += 4    // WHY: TextColor is Fixed4 (RGBA), NOT a variable field — easy to miss
      skipVar1('MediaURL')
      // WHY: Must skip ALL remaining fields so `off` lands at the next object's ID for
      // multi-object packets (count > 1). Stopping at MediaURL leaves ~66+ bytes unread,
      // corrupting every subsequent object parse.
      skipVar1('PSBlock')  // particle system data, 0-86 bytes
      skipVar1('ExtraParams')
      off += 16   // Sound UUID
      off += 16   // OwnerID UUID
      off += 4    // SoundGain F32
      off += 1    // Flags U8
      off += 4    // SoundRadius F32
      off += 1    // JointType U8
      off += 12   // JointPivot LLVector3
      off += 12   // JointAxisOrAnchor LLVector3
      objects.push({ localId, fullId, pcode, scale: [sx, sy, sz], pos, nameValue })
      // WHY: log each successful decode + 40 bytes AFTER endOff so we can see whether
      // the bytes immediately following are the next real object header or zero-padding.
      // This lets us diagnose the 25-zero gap that appears between objects in multi-object packets.
      if (count > 1) {
        const _nextHex = buf.slice(off, Math.min(buf.length, off + 40)).toString('hex')
        onDiag?.(`obj[${i}/${count}] localId=${localId} pcode=${pcode} startOff=${objStartOff} endOff=${off} [${_diag}] NEXT40=${_nextHex}`)
      }
    } catch (e) {
      // WHY: Extend hex dump to 320 bytes so it covers @TE (typically at offset 131–304 from
      // objStart). 200 bytes was insufficient for large-ObjectData objects (od=232 → @TE=304).
      const _dumpEnd = Math.min(buf.length, Math.max(objStartOff + 320, off + 4))
      const _hex = buf.slice(objStartOff, _dumpEnd).toString('hex')
      const _msg = `obj[${i}/${count}] localId=${localId} pcode=${pcode} startOff=${objStartOff} failOff=${off} bufLen=${buf.length} [${_diag}]\n  hex@start: ${_hex}\n  cause: ${(e as Error).message}`
      if (onError) {
        // WHY: with error callback, return objects decoded so far rather than losing the whole packet
        onError(_msg)
        break
      }
      throw new Error(_msg)
    }
  }
  return objects
}

// ── ImprovedTerseObjectUpdate (Low #11) ──────────────────────────────────────

export interface TerseObjectData {
  localId: number
  pos:     [number, number, number]
}

/**
 * Decode ImprovedTerseObjectUpdate — sent by sim for every position/velocity change.
 * WHY: Per SL message.xml, ObjectData block layout is always:
 *   ID(U32) + State(U8) + FootCollisionPlane(LLVector4=16B) + Data(Variable1)
 * FootCollisionPlane is always present (zeroed for non-avatars).
 * Data.length == 38 → avatar with F32 position; Data.length == 32 → prim with U16 position.
 */
export function decodeImprovedTerseObjectUpdate(
  buf: Buffer,
  dataOffset: number,
  onRaw?: (localId: number, dataLen: number, pos: [number, number, number], sentinel: boolean) => void,
): TerseObjectData[] {
  const results: TerseObjectData[] = []
  let off = dataOffset

  // RegionData block
  off += 8  // RegionHandle U64
  off += 2  // TimeDilation U16

  const count = buf[off++]

  for (let i = 0; i < count && off < buf.length; i++) {
    const localId = buf.readUInt32LE(off); off += 4
    off += 1   // State U8
    off += 16  // FootCollisionPlane: LLVector4 (4 F32) — always present, zeroed for prims

    const dataLen = buf[off++]
    let pos: [number, number, number] = [0, 0, 0]

    if (dataLen >= 12 && dataLen > 32) {
      // WHY: Avatar terse data (38 bytes) starts with F32 position (3 * 4 = 12 bytes).
      // Prim terse data (32 bytes) starts with U16 quantized position (3 * 2 = 6 bytes).
      // dataLen > 32 reliably distinguishes avatar from prim across OpenSim versions.
      pos = [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)]
    } else if (dataLen >= 6) {
      // WHY: Prim position quantized to region bounds [0, 256] as U16 in range [0, 65535].
      const px = buf.readUInt16LE(off)     * (256.0 / 65535.0)
      const py = buf.readUInt16LE(off + 2) * (256.0 / 65535.0)
      const pz = buf.readUInt16LE(off + 4) * (256.0 / 65535.0)
      pos = [px, py, pz]
    }

    off += dataLen
    // WHY: Positions near ±FLT_MAX (3.4e38) are "kill sentinels" — the sim signals
    // that an object should be removed from the scene. Skip these to avoid garbage
    // positions that break camera follow or location bar. Object removal will arrive
    // via ObjectUpdate with KillObject flag (handled separately or ignored for now).
    const FLT_MAX = 3.4e38
    const isSentinel = Math.abs(pos[0]) > FLT_MAX * 0.5 || Math.abs(pos[1]) > FLT_MAX * 0.5 || Math.abs(pos[2]) > FLT_MAX * 0.5
    onRaw?.(localId, dataLen, pos, isSentinel)
    if (isSentinel) continue
    results.push({ localId, pos })
  }

  return results
}

// ── RegionHandshake (Low #148) ────────────────────────────────────────────

export interface RegionHandshakeData {
  simName:    string
  simAccess:  number  // 13=PG, 21=Mature, 42=Adult
}

/**
 * Decode RegionHandshake — sent by sim right after circuit establishment.
 * Contains the region name (SimName) among other terrain/flag data.
 * We MUST reply with RegionHandshakeReply or the sim won't fully initialize our avatar.
 */
export function decodeRegionHandshake(buf: Buffer, dataOffset: number): RegionHandshakeData {
  let off = dataOffset
  off += 4  // RegionFlags U32
  const simAccess = buf[off++]  // SimAccess U8 (13=PG, 21=Moderate, 42=Adult)
  // SimName: Variable1 (1-byte length prefix)
  const nameLen = buf[off++]
  const simName = buf.slice(off, off + nameLen).toString('utf8').replace(/\x00/g, '').trim()
  return { simName, simAccess }
}

/** Decode KillObject (High #16) — sim removes objects from the viewer's scene.
 *  Body: count(U8) + array of LocalID(U32). One packet can kill multiple objects.
 *  WHY: Without this handler, removed prims/avatars/NPCs stay in scene forever.
 */
export function decodeKillObject(buf: Buffer, dataOffset: number): number[] {
  const ids: number[] = []
  let off = dataOffset
  const count = buf[off++]
  for (let i = 0; i < count && off + 3 < buf.length; i++) {
    ids.push(buf.readUInt32LE(off)); off += 4
  }
  return ids
}

/** Decode TeleportLocal (Low #64) — sim's response to same-region TeleportLocationRequest.
 *  Contains the new avatar position within the same region circuit.
 *  Sim sends this instead of TeleportFinish when the target is in the current region.
 *  Body: AgentID(16) + LocationID(4) + Position(12) + LookAt(12) + TeleportFlags(4)
 */
export function decodeTeleportLocal(buf: Buffer, dataOffset: number): {
  pos:    [number, number, number]
  lookAt: [number, number, number]
} {
  let off = dataOffset
  off += 16  // AgentID (UUID)
  off += 4   // LocationID (U32)
  const x = buf.readFloatLE(off); off += 4
  const y = buf.readFloatLE(off); off += 4
  const z = buf.readFloatLE(off); off += 4
  const lx = buf.readFloatLE(off); off += 4
  const ly = buf.readFloatLE(off); off += 4
  const lz = buf.readFloatLE(off); off += 4
  // TeleportFlags U32 — skip
  return { pos: [x, y, z], lookAt: [lx, ly, lz] }
}

/** Decode TeleportFinish (Low #69) — sim's response to cross-region TeleportLocationRequest.
 *  Contains new sim IP/port, regionHandle, and seed capability URL for new circuit.
 *  Body: AgentID(16) + LocationID(4) + SimIP(4 BE) + SimPort(2 BE) + RegionHandle(8 LE) +
 *        SeedCapability(V2) + SimAccess(1) + TeleportFlags(4)
 */
export function decodeTeleportFinish(buf: Buffer, dataOffset: number): {
  simIp:        string
  simPort:      number
  regionHandle: bigint
  seedCap:      string
  simAccess:    number
  teleportFlags: number
} {
  let off = dataOffset
  off += 16  // AgentID (UUID)
  off += 4   // LocationID (U32)
  // WHY: IPADDR is 4-byte big-endian (network byte order), IPPORT is 2-byte big-endian
  const ipU32 = buf.readUInt32BE(off); off += 4
  const simIp = `${(ipU32 >> 24) & 0xFF}.${(ipU32 >> 16) & 0xFF}.${(ipU32 >> 8) & 0xFF}.${ipU32 & 0xFF}`
  const simPort = buf.readUInt16BE(off); off += 2
  const regionHandle = buf.readBigUInt64LE(off); off += 8
  // SeedCapability: Variable2 (2-byte LE length prefix + UTF8 string)
  const seedLen = buf.readUInt16LE(off); off += 2
  const seedCap = buf.slice(off, off + seedLen).toString('utf8').replace(/\0/g, ''); off += seedLen
  const simAccess = buf[off++]
  const teleportFlags = buf.readUInt32LE(off)
  return { simIp, simPort, regionHandle, seedCap, simAccess, teleportFlags }
}

/** AgentSetAppearance (Low #84) — minimal stub to signal appearance readiness.
 *  WHY: Some OpenSim sims defer full physics initialization until AgentSetAppearance received.
 *  Send after AgentMovementComplete with empty wearables/params (gray avatar, physics enabled).
 *  Firestorm sends full baked textures; we send minimal to unblock physics without art pipeline.
 *  Body: AgentData(48) + WearableData(1=count) + ObjectData.TE(2=empty) + VisualParam(1=count)
 */
export function encodeAgentSetAppearance(p: { agentId: string; sessionId: string; seq: number }): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG = Buffer.from([0xFF, 0xFF, 0x00, 0x54])  // Low #84
  // AgentData Single: AgentID(16) + SessionID(16) + SerialNum(4) + Size LLVector3(12)
  // WearableData Variable: count(1) = 0 items
  // ObjectData Single: TextureEntry Variable2(2) = empty
  // VisualParam Variable: count(1) = 0 items
  const body = Buffer.alloc(16 + 16 + 4 + 12 + 1 + 2 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(1, off); off += 4  // SerialNum = 1
  // WHY: Default avatar bounding box (width, depth, height) in SL metres.
  // Sim uses this for collision detection. Approximate standard avatar size.
  body.writeFloatLE(0.45, off); off += 4
  body.writeFloatLE(0.60, off); off += 4
  body.writeFloatLE(1.84, off); off += 4
  body[off++] = 0          // WearableData count = 0
  body.writeUInt16LE(0, off); off += 2  // ObjectData.TextureEntry length = 0
  body[off++] = 0          // VisualParam count = 0
  return Buffer.concat([hdr, MSG, body])
}

/** Reply to RegionHandshake — required, or avatar won't appear in-world */
export function encodeRegionHandshakeReply(p: { agentId: string; sessionId: string; seq: number }): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  // AgentData block: AgentID + SessionID
  // RegionInfo block: Flags U32 = 0
  const body = Buffer.allocUnsafe(16 + 16 + 4)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  body.writeUInt32LE(0, 32)  // Flags = 0
  return Buffer.concat([hdr, MSG_ID.RegionHandshakeReply, body])
}
