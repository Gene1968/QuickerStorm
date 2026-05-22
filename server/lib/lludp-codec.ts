// server/lib/lludp-codec.ts — LLUDP binary packet encoder/decoder for Phase 1 messages
// Reference: http://wiki.secondlife.com/wiki/LLUDP
// Message IDs: verify against phoenix-firestorm/indra/newview/app_settings/message.xml

// ── Flags ────────────────────────────────────────────────────────────────
const FLAG_RELIABLE    = 0x10
const FLAG_HAS_ACKS    = 0x40
const FLAG_ZERO_CODED  = 0x01

// ── Message ID bytes (verify against message.xml) ─────────────────────────
const MSG_ID = {
  AgentUpdate:               Buffer.from([0x04]),                     // High #4
  UseCircuitCode:            Buffer.from([0xFF, 0xFF, 0x00, 0x03]),   // Low #3
  CompleteAgentMovement:     Buffer.from([0xFF, 0xFF, 0x00, 0xF9]),   // Low #249
  LogoutRequest:             Buffer.from([0xFF, 0xFF, 0x00, 0xFC]),   // Low #252
  PacketAck:                 Buffer.from([0xFF, 0xFF, 0xFF, 0xFB]),   // Fixed #251
  // Verify these in phoenix-firestorm/indra/newview/app_settings/message.xml:
  ChatFromViewer:            Buffer.from([0xFF, 0xFF, 0x00, 0x50]),   // TODO verify
  ChatFromSimulator:         Buffer.from([0xFF, 0xFF, 0x00, 0x8B]),   // TODO verify
  ObjectUpdate:              Buffer.from([0xFF, 0xFF, 0x00, 0x0C]),   // TODO verify
  ImprovedTerseObjectUpdate: Buffer.from([0xFF, 0xFF, 0x00, 0x0B]),   // TODO verify
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
      for (let z = 0; z < count; z++) out.push(0x00)
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
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  body.writeUInt32LE(p.circuitCode, 32)
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

export function encodePacketAck(ackIds: number[], seq: number): Buffer {
  const hdr  = buildHeader({ seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(1 + ackIds.length * 4)
  body[0] = ackIds.length
  ackIds.forEach((id, i) => body.writeUInt32LE(id, 1 + i * 4))
  return Buffer.concat([hdr, MSG_ID.PacketAck, body])
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
  const hdr    = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const msgBuf = Buffer.from(p.message, 'utf8')
  const body   = Buffer.allocUnsafe(32 + 1 + msgBuf.length + 1 + 4)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = msgBuf.length  // variable1 length prefix
  msgBuf.copy(body, off);      off += msgBuf.length
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
  const fromName = buf.slice(off, off + nameLen).toString('utf8'); off += nameLen
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
  const message = buf.slice(off, off + msgLen).toString('utf8')
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
 * Minimal ObjectUpdate decoder — extracts type and scale.
 * Position is inside a packed ObjectData blob (complex format); returns [0,0,0] until
 * ImprovedTerseObjectUpdate parser is added (Task 9 TODO).
 */
export function decodeObjectUpdate(buf: Buffer, dataOffset: number): ObjectData[] {
  const objects: ObjectData[] = []
  let off = dataOffset

  // RegionData block (1)
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16

  // ObjectData block (variable count)
  const count = buf[off++]
  for (let i = 0; i < count && off < buf.length; i++) {
    const localId = buf.readUInt32LE(off); off += 4
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _state   = buf[off++]
    const fullId   = bytesToUuid(buf, off); off += 16
    off += 4   // CRC
    const pcode = buf[off++]
    off += 2   // material, clickAction
    const sx = buf.readFloatLE(off); off += 4  // Scale
    const sy = buf.readFloatLE(off); off += 4
    const sz = buf.readFloatLE(off); off += 4
    // ObjectData variable1: packed position/velocity/rotation — skip
    const odLen = buf[off++]; off += odLen
    off += 4   // parentId
    off += 4   // updateFlags
    // Skip path/profile params (10 bytes)
    off += 10
    // Variable fields: each variable2 has 2-byte length prefix, variable1 has 1-byte
    const skipVar2 = () => { const len = buf.readUInt16LE(off); off += 2 + len }
    const skipVar1 = () => { const len = buf[off++]; off += len }
    skipVar2()  // TextureEntry
    skipVar2()  // TextureAnim
    // NameValue: variable2
    const nvLen    = buf.readUInt16LE(off); off += 2
    const nameValue = buf.slice(off, off + nvLen).toString('utf8'); off += nvLen
    skipVar1()  // Data
    skipVar1()  // Text
    skipVar1()  // MediaURL
    objects.push({ localId, fullId, pcode, scale: [sx, sy, sz], pos: [0, 0, 0], nameValue })
  }
  return objects
}
