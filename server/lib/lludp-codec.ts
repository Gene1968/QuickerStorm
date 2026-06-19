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
  SetAlwaysRun:              Buffer.from([0xFF, 0xFF, 0x00, 0x15]),   // Low #21 (we send) — sticky run state
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
  // Categories in order: Resend, Land, Wind, Cloud, Task, Texture, Asset (per Firestorm).
  // WHY land 500kbps (was 162k): terrain patches drip in slowly at low alloc — distant
  // patches stay at h=0 (flat ocean) for many seconds, making islands at region corner
  // appear submerged. 500k matches FS "high" preset and pushes the full 16×16 patch grid
  // in well under a minute.
  const THROTTLES = [150000, 500000, 20000, 20000, 700000, 1300000, 500000]
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

/** CreateInventoryItem (Low #305) — ask the sim to create an inventory item.
 *  WHY: For a Landmark (Type=InvType=3) sent with a ZERO TransactionID, the sim builds the
 *  landmark asset from the agent's CURRENT region + position automatically — no asset upload.
 *  The sim replies with UpdateCreateInventoryItem (Low #267) carrying the new ItemID + AssetID.
 *  Block layout (message_template.msg): AgentData{AgentID,SessionID} +
 *    InventoryBlock{CallbackID U32, FolderID, TransactionID, NextOwnerMask U32, Type S8,
 *                   InvType S8, WearableType U8, Name Var1, Description Var1}.
 */
export function encodeCreateInventoryItem(p: {
  agentId: string; sessionId: string; seq: number
  callbackId?: number; folderId: string; transactionId?: string
  nextOwnerMask?: number; type: number; invType: number; wearableType?: number
  name: string; description?: string
}): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG = Buffer.from([0xFF, 0xFF, 0x01, 0x31])  // Low #305 = 0x131
  const nameBuf = Buffer.from((p.name || '') + '\0', 'utf8')          // Variable1: null-terminated
  const descBuf = Buffer.from((p.description || '') + '\0', 'utf8')
  const txn = p.transactionId ?? '00000000-0000-0000-0000-000000000000'
  const body = Buffer.allocUnsafe(32 + 4 + 16 + 16 + 4 + 1 + 1 + 1 + 1 + nameBuf.length + 1 + descBuf.length)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE((p.callbackId ?? 0) >>> 0, off); off += 4
  uuidToBytes(p.folderId).copy(body, off);  off += 16
  uuidToBytes(txn).copy(body, off);         off += 16
  body.writeUInt32LE((p.nextOwnerMask ?? 0x7FFFFFFF) >>> 0, off); off += 4
  body.writeInt8(p.type, off);    off += 1
  body.writeInt8(p.invType, off); off += 1
  body.writeUInt8(p.wearableType ?? 0, off); off += 1
  body.writeUInt8(nameBuf.length, off); off += 1
  nameBuf.copy(body, off); off += nameBuf.length
  body.writeUInt8(descBuf.length, off); off += 1
  descBuf.copy(body, off); off += descBuf.length
  return Buffer.concat([hdr, MSG, body])
}

/** CreateInventoryFolder (Low #273) — create a new folder. Client generates the FolderID UUID
 *  (so it can optimistically show the folder immediately). Type S8 = -1 for a plain user folder.
 *  Block: AgentData{AgentID,SessionID} + FolderData{FolderID, ParentID, Type S8, Name Var1}.
 */
export function encodeCreateInventoryFolder(p: {
  agentId: string; sessionId: string; seq: number
  folderId: string; parentId: string; type?: number; name: string
}): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG = Buffer.from([0xFF, 0xFF, 0x01, 0x11])  // Low #273 = 0x111
  const nameBuf = Buffer.from((p.name || '') + '\0', 'utf8')
  const body = Buffer.allocUnsafe(32 + 16 + 16 + 1 + 1 + nameBuf.length)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  uuidToBytes(p.folderId).copy(body, off);  off += 16
  uuidToBytes(p.parentId).copy(body, off);  off += 16
  body.writeInt8(p.type ?? -1, off); off += 1
  body.writeUInt8(nameBuf.length, off); off += 1
  nameBuf.copy(body, off); off += nameBuf.length
  return Buffer.concat([hdr, MSG, body])
}

export interface CreatedInventoryItem {
  itemId:    string
  parentId:  string   // FolderID the item landed in
  assetId:   string
  name:      string
  desc:      string
  assetType: number
  invType:   number
  flags:     number
  createdAt: number
  ownerMask: number
}

/** Decode UpdateCreateInventoryItem (Low #267) — the sim's reply after creating an item.
 *  AgentData{AgentID, SimApproved BOOL, TransactionID} + InventoryData Variable (U8 count) of
 *  full item blocks. We extract the fields the client inventory list needs and shape them to
 *  match the FetchInventoryDescendents2 item rows so the UI renders them identically.
 *  NOTE: Zerocoded on the wire, but the dispatcher hands us the already-expanded buffer.
 */
export function decodeUpdateCreateInventoryItem(buf: Buffer, dataOffset: number): CreatedInventoryItem[] {
  let off = dataOffset
  off += 16  // AgentID
  off += 1   // SimApproved BOOL
  off += 16  // TransactionID
  const count = buf[off++]
  const items: CreatedInventoryItem[] = []
  for (let i = 0; i < count && off + 16 <= buf.length; i++) {
    const itemId    = bytesToUuid(buf, off); off += 16
    const parentId  = bytesToUuid(buf, off); off += 16   // FolderID
    off += 4   // CallbackID
    off += 16  // CreatorID
    off += 16  // OwnerID
    off += 16  // GroupID
    off += 4   // BaseMask
    const ownerMask = buf.readUInt32LE(off); off += 4
    off += 4   // GroupMask
    off += 4   // EveryoneMask
    off += 4   // NextOwnerMask
    off += 1   // GroupOwned BOOL
    const assetId   = bytesToUuid(buf, off); off += 16
    const assetType = buf.readInt8(off); off += 1
    const invType   = buf.readInt8(off); off += 1
    const flags     = buf.readUInt32LE(off); off += 4
    off += 1   // SaleType
    off += 4   // SalePrice
    const nameLen = buf[off++]; const name = buf.slice(off, off + nameLen).toString('utf8').replace(/\0/g, ''); off += nameLen
    const descLen = buf[off++]; const desc = buf.slice(off, off + descLen).toString('utf8').replace(/\0/g, ''); off += descLen
    const createdAt = buf.readInt32LE(off); off += 4
    off += 4   // CRC
    items.push({ itemId, parentId, assetId, name, desc, assetType, invType, flags, createdAt, ownerMask })
  }
  return items
}

/** RequestMultipleObjects (Medium #3 = 0xFF 0x03) — ask sim for full ObjectUpdate for
 *  objects we have in ObjectUpdateCached but don't know about.
 *  WHY: Sims send ObjectUpdateCached (high:14) for objects they think the viewer has cached.
 *  Since we have no object cache, we must reply to get the full update (pcode, pos, name).
 *  WHY Medium 3 (not 22): Verified against Firestorm scripts/messages/message_template.msg —
 *  earlier code used 0xFF 0x16 (Medium 22) which sim silently drops (no matching handler),
 *  causing 100% of 366 ReqMulti retransmits to go unacked and ~4700 cache-miss IDs to never
 *  yield ObjectUpdate replies.
 */
export function encodeRequestMultipleObjects(p: {
  agentId:       string
  sessionId:     string
  seq:           number
  ids:           number[]   // localIds to request
  cacheMissType?: 0 | 1     // 0 = Full (we have nothing), 1 = CrcMismatch (we have stale)
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG  = Buffer.from([0xFF, 0x03])  // Medium #3
  const body = Buffer.allocUnsafe(16 + 16 + 1 + p.ids.length * 5)
  const missType = p.cacheMissType ?? 0
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = p.ids.length
  for (const id of p.ids) {
    body[off++] = missType
    body.writeUInt32LE(id, off); off += 4
  }
  return Buffer.concat([hdr, MSG, body])
}

/** Decode ObjectUpdateCached (High #11) — sim sends this for objects viewer supposedly has.
 *  Returns array of localIds we should request via RequestMultipleObjects.
 */
export function decodeObjectUpdateCached(buf: Buffer, dataOffset: number): Array<{ localId: number; crc: number }> {
  const out: Array<{ localId: number; crc: number }> = []
  let off = dataOffset
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16
  const count = buf[off++]
  // WHY: ObjectUpdateCached per-entry layout: LocalID(4) + CRC(4) + UpdateFlags(4) = 12 bytes.
  // The CRC (PseudoCRC) increments on every change and is the cache key for downstream validation.
  for (let i = 0; i < count && off + 11 < buf.length; i++) {
    const localId = buf.readUInt32LE(off); off += 4
    const crc = buf.readUInt32LE(off); off += 4
    off += 4   // UpdateFlags U32
    if (localId !== 0) out.push({ localId, crc })
  }
  return out
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

// ── ImprovedInstantMessage (Low #254) ────────────────────────────────────
// Per phoenix-firestorm message_template.msg: NotTrusted Zerocoded. AgentData carries
// AgentID + SessionID; MessageBlock carries FromGroup, ToAgentID, ParentEstateID, RegionID,
// Position, Offline, Dialog (0=MessageFromAgent), ID (msg UUID), Timestamp, FromAgentName
// (Variable1), Message (Variable2), BinaryBucket (Variable2). SL convention: text Variables
// include trailing null terminator in length.
export function encodeImprovedInstantMessage(p: {
  agentId:        string
  sessionId:      string
  seq:            number
  toAgentId:      string
  fromAgentName:  string
  message:        string
  regionId?:      string
  position?:      [number, number, number]
  dialog?:        number      // 0 = MessageFromAgent
  messageId?:     string
}): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const fromBuf = Buffer.from(p.fromAgentName + '\0', 'utf8')
  const msgBuf  = Buffer.from(p.message + '\0', 'utf8')
  const regionId = p.regionId  ?? '00000000-0000-0000-0000-000000000000'
  const pos      = p.position  ?? [0, 0, 0]
  const dialog   = p.dialog    ?? 0
  // The IM `ID` field doubles as the conversation/session id for 1:1 chat IMs (dialog 0): the
  // recipient viewer (Firestorm) threads the conversation by it, computed as agentID XOR otherID
  // (symmetric, so both sides agree — see LLIMMgr::computeSessionID, llimview.cpp). A random id
  // here makes every message open a NEW IM tab on the recipient. For non-chat dialogs (e.g. 38
  // friendship offer) the ID is a transaction id the peer echoes back, so a fresh random is right.
  let idBytes: Buffer
  if (p.messageId) {
    idBytes = uuidToBytes(p.messageId)
  } else if (dialog === 0) {
    const a = uuidToBytes(p.agentId)
    const b = uuidToBytes(p.toAgentId)
    idBytes = Buffer.allocUnsafe(16)
    for (let i = 0; i < 16; i++) idBytes[i] = a[i] ^ b[i]
  } else {
    idBytes = uuidToBytes(crypto.randomUUID())
  }
  const bucketLen = 0

  const bodySize = 32 + 1 + 16 + 4 + 16 + 12 + 1 + 1 + 16 + 4 +
                   1 + fromBuf.length + 2 + msgBuf.length + 2 + bucketLen
  const body = Buffer.allocUnsafe(bodySize)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = 0  // FromGroup = false
  uuidToBytes(p.toAgentId).copy(body, off); off += 16
  body.writeUInt32LE(0, off); off += 4      // ParentEstateID
  uuidToBytes(regionId).copy(body, off);    off += 16
  body.writeFloatLE(pos[0], off); off += 4
  body.writeFloatLE(pos[1], off); off += 4
  body.writeFloatLE(pos[2], off); off += 4
  body[off++] = 0       // Offline = 0
  body[off++] = dialog
  idBytes.copy(body, off); off += 16
  body.writeUInt32LE(Math.floor(Date.now() / 1000), off); off += 4
  body[off++] = fromBuf.length
  fromBuf.copy(body, off); off += fromBuf.length
  body.writeUInt16LE(msgBuf.length, off); off += 2
  msgBuf.copy(body, off); off += msgBuf.length
  body.writeUInt16LE(bucketLen, off); off += 2
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0xFE]), body])
}

export interface ImprovedInstantMessageData {
  fromAgentId:   string
  fromAgentName: string
  toAgentId:     string
  dialog:        number
  message:       string
  timestamp:     number
  position:      [number, number, number]
  imId:          string   // message UUID — for friendship dialogs this is the transaction id echoed in Accept/Decline
}

export function decodeImprovedInstantMessage(buf: Buffer, dataOffset: number): ImprovedInstantMessageData {
  let off = dataOffset
  // AgentData
  const fromAgentId = bytesToUuid(buf, off); off += 16
  off += 16  // SessionID — not useful client-side
  // MessageBlock
  off += 1   // FromGroup (bool)
  const toAgentId = bytesToUuid(buf, off); off += 16
  off += 4   // ParentEstateID
  off += 16  // RegionID
  const px = buf.readFloatLE(off); off += 4
  const py = buf.readFloatLE(off); off += 4
  const pz = buf.readFloatLE(off); off += 4
  off += 1   // Offline
  const dialog = buf[off++]
  const imId = bytesToUuid(buf, off); off += 16  // ID (message UUID) — friendship transaction id
  const timestamp = buf.readUInt32LE(off); off += 4
  const nameLen = buf[off++]
  const fromAgentName = buf.slice(off, off + nameLen).toString('utf8').replace(/\0/g, '')
  off += nameLen
  const msgLen = buf.readUInt16LE(off); off += 2
  const message = buf.slice(off, off + msgLen).toString('utf8').replace(/\0/g, '')
  return { fromAgentId, fromAgentName, toAgentId, dialog, message, timestamp, position: [px, py, pz], imId }
}

// ── ObjectSelect / ObjectDeselect (Low #110 / #111) — selection set ──────
// libomv ObjectSelectPacket: AgentData(agentId+sessionId) + ObjectData Variable count of
// ObjectLocalID(U32). Sim replies with ObjectProperties for each selected object.
export function encodeObjectSelect(p: {
  agentId: string; sessionId: string; seq: number; localIds: number[]
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 1 + p.localIds.length * 4)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = p.localIds.length
  for (const id of p.localIds) { body.writeUInt32LE(id, off); off += 4 }
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x6E]), body])  // Low 110
}

export function encodeObjectDeselect(p: {
  agentId: string; sessionId: string; seq: number; localIds: number[]
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 1 + p.localIds.length * 4)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = p.localIds.length
  for (const id of p.localIds) { body.writeUInt32LE(id, off); off += 4 }
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x6F]), body])  // Low 111
}

// ── ObjectProperties (Medium #9) — sim → viewer per-object metadata ──────
// Per message_template.msg:3704 — ObjectData block (Variable count), each block:
//   ObjectID(UUID) CreatorID(UUID) OwnerID(UUID) GroupID(UUID)
//   CreationDate(U64) BaseMask/OwnerMask/GroupMask/EveryoneMask/NextOwnerMask(U32×5)
//   OwnershipCost(S32) SaleType(U8) SalePrice(S32)
//   AggregatePerms/AggregatePermTextures/AggregatePermTexturesOwner(U8×3)
//   Category(U32) InventorySerial(S16) ItemID/FolderID/FromTaskID/LastOwnerID(UUID×4)
//   Name(V1) Description(V1) TouchName(V1) SitName(V1) TextureID(V1)
export interface ObjectPropertiesData {
  fullId:         string
  creatorId:      string
  ownerId:        string
  groupId:        string
  creationDate:   bigint
  baseMask:       number
  ownerMask:      number
  groupMask:      number
  everyoneMask:   number
  nextOwnerMask:  number
  ownershipCost:  number
  saleType:       number
  salePrice:      number
  category:       number
  lastOwnerId:    string
  name:           string
  description:    string
  touchName:      string
  sitName:        string
}

export function decodeObjectProperties(buf: Buffer, dataOffset: number): ObjectPropertiesData[] {
  const results: ObjectPropertiesData[] = []
  let off = dataOffset
  if (off >= buf.length) return results
  const count = buf[off++]

  const readVar1 = (): string => {
    if (off >= buf.length) return ''
    const len = buf[off++]
    if (off + len > buf.length) { off = buf.length; return '' }
    const s = buf.slice(off, off + len).toString('utf8').replace(/\0/g, '')
    off += len
    return s
  }

  for (let i = 0; i < count && off < buf.length; i++) {
    try {
      const fullId      = bytesToUuid(buf, off); off += 16
      const creatorId   = bytesToUuid(buf, off); off += 16
      const ownerId     = bytesToUuid(buf, off); off += 16
      const groupId     = bytesToUuid(buf, off); off += 16
      const creationDate = buf.readBigUInt64LE(off); off += 8
      const baseMask      = buf.readUInt32LE(off); off += 4
      const ownerMask     = buf.readUInt32LE(off); off += 4
      const groupMask     = buf.readUInt32LE(off); off += 4
      const everyoneMask  = buf.readUInt32LE(off); off += 4
      const nextOwnerMask = buf.readUInt32LE(off); off += 4
      const ownershipCost = buf.readInt32LE(off);  off += 4
      const saleType      = buf[off++]
      const salePrice     = buf.readInt32LE(off);  off += 4
      off += 3   // AggregatePerms + AggregatePermTextures + AggregatePermTexturesOwner
      const category   = buf.readUInt32LE(off); off += 4
      off += 2   // InventorySerial S16
      off += 16  // ItemID
      off += 16  // FolderID
      off += 16  // FromTaskID
      const lastOwnerId = bytesToUuid(buf, off); off += 16
      const name        = readVar1()
      const description = readVar1()
      const touchName   = readVar1()
      const sitName     = readVar1()
      // TextureID Variable 1 — list of texture UUIDs; skip for Phase 2 (no texture fetch yet)
      readVar1()
      results.push({
        fullId, creatorId, ownerId, groupId, creationDate,
        baseMask, ownerMask, groupMask, everyoneMask, nextOwnerMask,
        ownershipCost, saleType, salePrice, category, lastOwnerId,
        name, description, touchName, sitName,
      })
    } catch {
      // Decode failure on one entry — return what we have so far rather than corrupting offset chain
      break
    }
  }
  return results
}

// ── ObjectGrab / ObjectDeGrab (Low #117 / #118) — "touch" gesture ────────
// libomv ObjectGrabPacket: AgentData(agentId+sessionId) + ObjectData(LocalID+GrabOffset) +
// SurfaceInfo (Variable count-prefixed). Minimal touch sends SurfaceInfo count=0.
export function encodeObjectGrab(p: {
  agentId: string; sessionId: string; seq: number; localId: number
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 12 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(p.localId, off);       off += 4
  body.writeFloatLE(0, off); off += 4   // GrabOffset.x
  body.writeFloatLE(0, off); off += 4   // GrabOffset.y
  body.writeFloatLE(0, off); off += 4   // GrabOffset.z
  body[off++] = 0  // SurfaceInfo count = 0
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x75]), body])  // Low 117
}

export function encodeObjectDeGrab(p: {
  agentId: string; sessionId: string; seq: number; localId: number
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(p.localId, off);       off += 4
  body[off++] = 0  // SurfaceInfo count = 0
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x76]), body])  // Low 118
}

// ── AgentRequestSit (Low #122) — claim a target prim as the sit target ───
// Followed by AgentSit (Low #123) which actually sits. Sim broadcasts the result via
// ObjectUpdate carrying the avatar's new parent + offset. Phase 2: send both immediately.
export function encodeAgentRequestSit(p: {
  agentId: string; sessionId: string; seq: number; targetId: string
  offset?: [number, number, number]
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const off3 = p.offset ?? [0, 0, 0]
  const body = Buffer.allocUnsafe(16 + 16 + 16 + 12)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  uuidToBytes(p.targetId).copy(body, off);  off += 16
  body.writeFloatLE(off3[0], off); off += 4
  body.writeFloatLE(off3[1], off); off += 4
  body.writeFloatLE(off3[2], off); off += 4
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x7A]), body])  // Low 122
}

export function encodeAgentSit(p: {
  agentId: string; sessionId: string; seq: number
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x7B]), body])  // Low 123
}

// WHY: SL/OpenSim track always-run as a sticky agent flag via SetAlwaysRun (Low #21),
// NOT as a ControlFlags bit. Bit 20 (0x00100000) is AGENT_CONTROL_NUDGE_AT_NEG which
// causes the sim to nudge the agent backward each tick — appears as auto-walk in viewer.
// Body: AgentData { AgentID, SessionID, AlwaysRun BOOL (1 byte) }.
export function encodeSetAlwaysRun(p: {
  agentId: string; sessionId: string; seq: number; alwaysRun: boolean
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body[off++] = p.alwaysRun ? 1 : 0
  return Buffer.concat([hdr, MSG_ID.SetAlwaysRun, body])
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

// WHY: SL TextureEntry face overrides use a varint-style bitfield (each byte's top bit
// flags continuation, low 7 bits are payload). Returns the assembled bitmask and next offset.
function readFaceBitfield(buf: Buffer, off: number, end: number): { bits: number, next: number } {
  let bits = 0
  let cur = off
  let more = true
  while (more && cur < end) {
    const b = buf[cur]
    bits = (bits << 7) | (b & 0x7F)
    more = (b & 0x80) !== 0
    cur++
  }
  return { bits, next: cur }
}

// Decode the color + texture fields of a TextureEntry blob spanning [start, end).
// WHY: shared by the full ObjectUpdate and ObjectUpdateCompressed decoders. Layout:
//   defaultTex(16B) → [faceBitfield + texUUID]* → defaultColor(4B) → [faceBitfield + RGBA]* → …
// Colors are stored inverted on the wire (actual = (255-byte)/255). Best-effort: a truncated blob
// yields whatever decoded so far.
interface TEFields {
  defaultColor?:    [number, number, number, number]
  faceColors?:      Array<[number, number, number, number] | null>
  defaultTexture?:  string
  faceTextures?:    Array<string | null>
  defaultRepeats?:  [number, number]   // scale_s / scale_t (UV tiling); SL default 1,1
  defaultOffset?:   [number, number]   // offset_s / offset_t; SL default 0,0
  defaultRotation?: number             // radians; SL default 0
  faceRepeats?:     Array<[number, number] | null>  // per-face scale_s/scale_t override; null = use default
  faceOffset?:      Array<[number, number] | null>  // per-face offset_s/offset_t override; null = use default
  faceRotation?:    Array<number | null>            // per-face rotation (radians) override; null = use default
  defaultGlow?:      number            // 0..1 (TE field 10)
  defaultShiny?:     number            // 0..3 (bump byte bits 7:6)
  defaultFullbright?: boolean          // bump byte bit 5
  defaultMaterialId?: string           // TE field 11 — legacy LLMaterial UUID (omitted if null)
  defaultTexGen?:    number            // TexGen mapping mode: 0=default, 1=planar (MediaFlags bits 1:2)
  faceTexGen?:       Array<number | null>  // per-face TexGen override; null = use default
}

// TexGen (texture mapping mode) is packed into the TE MediaFlags byte (field 9), bits 1-2
// (TEM_TEX_GEN_MASK 0x06, shift 1). 0=DEFAULT (per-face UV), 1=PLANAR (projected; repeats are
// expressed per-half-meter, i.e. FS displays them ×2). Bit 0 is the media-present flag (ignored here).
export function texGenFromMediaByte(b: number): number {
  return (b >> 1) & 0x03
}

// Read one TextureEntry field: a default value, then [faceBitfield + value]* overrides, then the
// 0x00 terminator. Returns the default plus a per-face array (or null) and the next read offset.
// WHY generic: a TE packs 7+ such fields back-to-back (texture, color, scaleS, scaleT, offsetS,
// offsetT, rotation, …). Each must be fully consumed — including its overrides — to reach the next.
function readTEField<T>(
  buf: Buffer, p: number, end: number, size: number, read: (b: Buffer, o: number) => T,
): { def: T; faces: Array<T | null> | null; next: number } {
  if (p + size > end) return { def: read(buf, p), faces: null, next: end }
  const def = read(buf, p); p += size
  let faces: Array<T | null> | null = null
  while (p < end) {
    const { bits, next } = readFaceBitfield(buf, p, end); p = next
    if (bits === 0) break
    if (p + size > end) break
    const v = read(buf, p); p += size
    if (!faces) faces = new Array(32).fill(null)
    for (let f = 0; f < 32; f++) if (bits & (1 << f)) faces[f] = v
  }
  return { def, faces, next: p }
}

// Combine two per-axis face-override arrays (e.g. scaleS.faces + scaleT.faces) into a single
// per-face pair array. Element i is present iff EITHER axis overrides face i; the missing axis
// falls back to its default. Returns null if no face overrides either axis (so callers can omit
// the field entirely). WHY pure helper: unit-testable without constructing a full TE blob.
export function combineFacePairs(
  aFaces: Array<number | null> | null,
  bFaces: Array<number | null> | null,
  aDef: number,
  bDef: number,
): Array<[number, number] | null> | null {
  if (!aFaces && !bFaces) return null
  const out: Array<[number, number] | null> = new Array(32).fill(null)
  let any = false
  for (let f = 0; f < 32; f++) {
    const a = aFaces ? aFaces[f] : null
    const b = bFaces ? bFaces[f] : null
    if (a == null && b == null) continue
    out[f] = [a ?? aDef, b ?? bDef]
    any = true
  }
  return any ? out : null
}

function parseTextureEntryFields(buf: Buffer, start: number, end: number): TEFields {
  const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
  const res: TEFields = {}
  const rUuid  = (b: Buffer, o: number) => bytesToUuid(b, o)
  const rColor = (b: Buffer, o: number): [number, number, number, number] =>
    [(255 - b[o]) / 255, (255 - b[o + 1]) / 255, (255 - b[o + 2]) / 255, (255 - b[o + 3]) / 255]
  const rF32   = (b: Buffer, o: number) => b.readFloatLE(o)
  const rOff   = (b: Buffer, o: number) => b.readInt16LE(o) / 0x7fff           // -1..1
  const rRot   = (b: Buffer, o: number) => (b.readInt16LE(o) / 0x8000) * Math.PI * 2
  try {
    let p = start
    const tex    = readTEField(buf, p, end, 16, rUuid);  p = tex.next
    const color  = readTEField(buf, p, end, 4,  rColor); p = color.next
    const scaleS = readTEField(buf, p, end, 4,  rF32);   p = scaleS.next
    const scaleT = readTEField(buf, p, end, 4,  rF32);   p = scaleT.next
    const offS   = readTEField(buf, p, end, 2,  rOff);   p = offS.next
    const offT   = readTEField(buf, p, end, 2,  rOff);   p = offT.next
    const rot    = readTEField(buf, p, end, 2,  rRot);   p = rot.next
    const bump   = readTEField(buf, p, end, 1,  (b, o) => b[o]); p = bump.next        // field 8
    const media  = readTEField(buf, p, end, 1,  (b, o) => b[o]); p = media.next       // field 9 (unused)
    const glow   = readTEField(buf, p, end, 1,  (b, o) => b[o] / 255); p = glow.next  // field 10
    // field 11 material_id (optional — older blobs end before it)
    let matId = ZERO_UUID
    if (p < end) { const m = readTEField(buf, p, end, 16, rUuid); matId = m.def; p = m.next }

    if (tex.def !== ZERO_UUID) res.defaultTexture = tex.def
    if (tex.faces) res.faceTextures = tex.faces.map(t => (t && t !== ZERO_UUID ? t : null))
    res.defaultColor = color.def
    if (color.faces) res.faceColors = color.faces
    res.defaultRepeats  = [scaleS.def, scaleT.def]
    res.defaultOffset   = [offS.def, offT.def]
    res.defaultRotation = rot.def
    // Per-face UV overrides: present only where the wire carried a face bitfield for the axis.
    const faceRepeats = combineFacePairs(scaleS.faces, scaleT.faces, scaleS.def, scaleT.def)
    const faceOffset  = combineFacePairs(offS.faces,   offT.faces,   offS.def,   offT.def)
    if (faceRepeats) res.faceRepeats = faceRepeats
    if (faceOffset)  res.faceOffset  = faceOffset
    if (rot.faces && rot.faces.some(v => v != null)) res.faceRotation = rot.faces
    res.defaultGlow       = glow.def
    res.defaultShiny      = (bump.def >> 6) & 0x03
    res.defaultFullbright = ((bump.def >> 5) & 0x01) === 1
    res.defaultTexGen     = texGenFromMediaByte(media.def)
    if (media.faces) {
      const ft = media.faces.map(m => (m == null ? null : texGenFromMediaByte(m)))
      if (ft.some(v => v != null)) res.faceTexGen = ft
    }
    if (matId !== ZERO_UUID) res.defaultMaterialId = matId
  } catch { /* best-effort: partial TE still yields texture/color */ }
  return res
}

// ExtraParam type 0x80 (MaterialsEP): [count U8] then [te_index U8][asset_UUID 16B]×count → per-face
// GLTF PBR material asset UUIDs. Returns a face→uuid map (zero UUIDs dropped).
export function parseMaterialsExtraParam(buf: Buffer, start: number, len: number): Record<number, string> {
  const faces: Record<number, string> = {}
  let p = start
  const end = start + len
  if (p >= end) return faces
  const count = buf[p++]
  for (let i = 0; i < count && p + 17 <= end; i++) {
    const te = buf[p++]
    const uuid = bytesToUuid(buf, p); p += 16
    if (uuid !== '00000000-0000-0000-0000-000000000000') faces[te] = uuid
  }
  return faces
}

// ExtraParam type 0x30 (Sculpt/Mesh): [sculptTexture UUID 16B][sculptType U8]. sculptType & 0x07:
// 1 sphere, 2 torus, 3 plane, 4 cylinder, 5 MESH. For mesh, the UUID is the mesh asset id.
export interface TextureAnim {
	mode: number    // bit flags: 0x01 ON, 0x02 LOOP, 0x04 REVERSE, 0x08 PING_PONG, 0x10 SMOOTH, 0x20 ROTATE, 0x40 SCALE
	face: number    // -1 = all faces
	sizeX: number
	sizeY: number
	start: number
	length: number
	rate: number
}

// LLTextureAnim wire format (FS llprimitive.cpp LLTextureAnim::unpackTAMessage): 16 bytes —
// mode u8, face s8, sizeX u8, sizeY u8, start f32le, length f32le, rate f32le. WHY captured:
// when a texture animation is ON, viewers route the face through a texture matrix and BYPASS the
// TE repeats entirely (llface.cpp tex_mode path) — creators exploit this as a static UV-scale
// trick (e.g. sculpt foliage carrying garbage TE repeats like V=-256 that FS never applies).
// Without this field the client tiles those garbage repeats → striping. Returns null when the
// block is absent/short or ANIM_ON is clear (no render effect either way).
export function parseTextureAnim(buf: Buffer, off: number, len: number): TextureAnim | null {
	if (len < 16 || off + 16 > buf.length) return null
	const mode = buf[off]
	if (!(mode & 0x01)) return null
	return {
		mode,
		face:   buf.readInt8(off + 1),
		sizeX:  buf[off + 2],
		sizeY:  buf[off + 3],
		start:  buf.readFloatLE(off + 4),
		length: buf.readFloatLE(off + 8),
		rate:   buf.readFloatLE(off + 12),
	}
}

export function parseSculptExtraParam(buf: Buffer, start: number, len: number): { uuid: string; sculptType: number } | null {
  if (len < 17) return null
  return { uuid: bytesToUuid(buf, start), sculptType: buf[start + 16] }
}

export interface PrimShape {
  pathCurve:        number  // U8 — 16=line/box, 32=circle, 33=half-circle (sphere top), etc.
  profileCurve:     number  // U8 — low nibble: 0=circle, 1=square, 2=isoTri, 3=eqTri, 4=rightTri, 5=halfCircle
  pathBegin:        number  // U16 → 0..1
  pathEnd:          number  // U16 → 0..1
  pathScaleX:       number  // U8  → 0..1 (taper-style scale start)
  pathScaleY:       number  // U8  → 0..1
  pathShearX:       number  // U8 (signed) → -0.5..0.5
  pathShearY:       number  // U8 (signed) → -0.5..0.5
  pathTwist:        number  // S8 (signed)
  pathTwistBegin:   number  // S8
  pathRadiusOffset: number  // S8
  pathTaperX:       number  // S8
  pathTaperY:       number  // S8
  pathRevolutions:  number  // U8 → 1..4
  pathSkew:         number  // S8
  profileBegin:     number  // U16 → 0..1
  profileEnd:       number  // U16 → 0..1
  profileHollow:    number  // U16 → 0..1
}

export interface ObjectData {
  localId:       number
  fullId:        string
  pcode:         number   // 9=prim, 47=avatar
  scale:         [number, number, number]
  pos:           [number, number, number]
  rot:           [number, number, number, number]   // quaternion xyzw (w derived from xyz, w≥0)
  nameValue:     string   // raw NameValue string (contains avatar display name)
  parentId?:     number   // U32 — 0=root, else localId of parent prim (linked sets)
  crc?:          number   // U32 PseudoCRC from ObjectUpdate/Compressed — increments on change; used for cache validation
  shape?:        PrimShape
  defaultColor?: [number, number, number, number]   // RGBA 0..1 from TextureEntry default
  faceColors?:   Array<[number, number, number, number] | null>  // length up to 32; null where face uses defaultColor
  defaultTexture?: string   // TextureEntry default face texture UUID (omitted if null UUID)
  faceTextures?:  Array<string | null>  // length up to 32; per-face texture UUID override; null = use default
  defaultRepeats?:  [number, number]    // TE scale_s/scale_t (UV tiling); SL default 1,1
  defaultOffset?:   [number, number]    // TE offset_s/offset_t; SL default 0,0
  defaultRotation?: number              // TE rotation in radians; SL default 0
  faceRepeats?:     Array<[number, number] | null>  // per-face scale_s/scale_t override; null = use default
  faceOffset?:      Array<[number, number] | null>  // per-face offset_s/offset_t override; null = use default
  faceRotation?:    Array<number | null>            // per-face TE rotation (radians) override; null = use default
  defaultGlow?:      number             // TE glow 0..1
  defaultShiny?:     number             // TE shiny 0..3
  defaultFullbright?: boolean           // TE fullbright
  defaultTexGen?:    number             // TE TexGen mapping mode: 0=default, 1=planar
  faceTexGen?:       Array<number | null>  // per-face TexGen override; null = use default
  defaultMaterialId?: string            // TE legacy LLMaterial UUID (RenderMaterials cap)
  defaultPbrMaterial?: string           // GLTF PBR material asset UUID (ExtraParam 0x80, default face)
  pbrMaterials?:     Array<string | null>  // per-face GLTF PBR material asset UUIDs
  meshId?:          string              // mesh asset UUID (Sculpt ExtraParam 0x30, sculptType&7==5)
  sculptId?:        string              // legacy sculpt-map texture UUID (sculptType&7 == 1..4)
  sculptType?:      number              // raw sculpt type byte (1 sphere..4 cylinder, 5 mesh)
  text?:         string   // hovertext (Variable1)
  textColor?:    [number, number, number, number]  // RGBA 0..1
  phantom?:      boolean  // PrimFlags bit 0x400 — avatar passes through; skip collision
  handleTouch?:  boolean  // PrimFlags bit 0x80 — object has a touch event handler script
  clickAction?:  number   // U8: 0=Touch,1=Sit,2=Buy,3=Pay,4=Open,5=PlayAnim,6=Zoom,7=Disabled
}

/**
 * ObjectUpdateCompressed (High #13) decoder — MVP, fixed-block only.
 * WHY: OpenSim sends ObjectUpdateCompressed for most prims after we send a valid
 * RequestMultipleObjects burst. Format per libomv Primitive.FromCompressedPacket:
 *   RegionHandle U64 + TimeDilation U16 + count U8 + N × (UpdateFlags U32 + Data Variable2)
 * Data payload starts with 64 fixed bytes (fullId..rotation). Beyond that, CompressedFlags
 * U32 + OwnerID UUID + flag-conditional fields + Path/Profile shape + TextureEntry. Parsing
 * conditionals correctly is non-trivial; this MVP reads only the fixed prefix and reports
 * pos/rot/scale with default cube shape. Adequate for Phase 2 "world looks like world"
 * — full shape decode is Phase 2.5 polish.
 */
export function decodeObjectUpdateCompressed(
  buf: Buffer,
  dataOffset: number,
  onError?: (msg: string) => void,
): ObjectData[] {
  const objects: ObjectData[] = []
  let off = dataOffset
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16
  const count = buf[off++]
  for (let i = 0; i < count && off < buf.length; i++) {
    try {
      const cUpdateFlags = buf.readUInt32LE(off); off += 4
      if (off + 2 > buf.length) throw new Error(`Data Variable2 prefix OOB at off=${off}`)
      const dataLen = buf.readUInt16LE(off); off += 2
      const dataEnd = off + dataLen
      if (dataEnd > buf.length) throw new Error(`Data Variable2 length ${dataLen} exceeds buf at off=${off}`)
      if (dataLen < 64) { off = dataEnd; continue }   // too short for fixed block
      const fullId   = bytesToUuid(buf, off); off += 16
      const localId  = buf.readUInt32LE(off); off += 4
      const pcode    = buf[off++]
      off += 1   // state
      const crc = buf.readUInt32LE(off); off += 4   // PseudoCRC (was skipped)
      off += 1                        // material (not stored)
      const clickAction = buf[off++]  // ClickAction U8
      const sx = buf.readFloatLE(off);     off += 4
      const sy = buf.readFloatLE(off);     off += 4
      const sz = buf.readFloatLE(off);     off += 4
      const px = buf.readFloatLE(off);     off += 4
      const py = buf.readFloatLE(off);     off += 4
      const pz = buf.readFloatLE(off);     off += 4
      const rx = buf.readFloatLE(off);     off += 4
      const ry = buf.readFloatLE(off);     off += 4
      const rz = buf.readFloatLE(off);     off += 4
      const rw = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry - rz * rz))
      // WHY: After Rot comes SpecialCode (U32), then an ALWAYS-present Owner UUID (16B), then the
      // optional fields. Per Firestorm (llviewerobject.cpp sObjectDataMap + unpackParentID):
      //   SpecialCode(U32) | Owner(UUID,16) | Omega(Vec3,12 — only if 0x80) | ParentID(U32 — only if 0x20)
      // The previous code skipped on the wrong bits (0x08/0x10 as "velocity") and NEVER skipped the
      // 16-byte Owner UUID, so ParentID was read from inside Owner → children got a garbage parentId,
      // were treated as roots, and rendered at their parent-local offset as region coords → underwater
      // near origin. Correct bits: 0x80 = HasAngularVelocity (Omega), 0x20 = HasParent.
      // === Conditional zone → ExtraParams → shape → TextureEntry ===
      // Field order + CompressedFlags bits are authoritative from OpenSim's encoder
      // (LLClientView.cs CreateCompressedUpdateBlockZC) and verified against captured packets.
      // CompressedFlags: 0x01 ScratchPad, 0x02 Tree, 0x04 HasText, 0x08 ParticlesLegacy,
      // 0x10 HasSound, 0x20 HasParent, 0x40 TextureAnim, 0x80 AngularVelocity,
      // 0x100 NameValues, 0x200 MediaURL, 0x400 ParticlesNew.
      let parentId = 0
      let shape: PrimShape | undefined
      let te: TEFields = {}
      let textureAnim: TextureAnim | undefined
      let pbrFaces: Record<number, string> = {}
      let meshId: string | undefined
      let sculptId: string | undefined
      let sculptType: number | undefined
      let text = ''
      let textColor: [number, number, number, number] | undefined
      try {
        if (off + 4 > dataEnd) throw new Error('cflags OOB')
        const cflags = buf.readUInt32LE(off); off += 4
        off += 16                                    // OwnerID — always present
        if (cflags & 0x80) off += 12                 // AngularVelocity
        if (cflags & 0x20) { parentId = buf.readUInt32LE(off); off += 4 }  // ParentID
        // WHY bail on these: ScratchPad/Tree/ParticlesLegacy/ParticlesNew use raw blobs with no
        // length prefix we can trust here → skipping risks desync. Emit pos/rot/scale only (cube)
        // for the rare prims that set them rather than mis-parse the TE of every following object.
        const RARE = cflags & (0x01 | 0x02 | 0x08 | 0x400)
        if (!RARE) {
          if (cflags & 0x04) {                       // HasText: null-terminated string + RGBA
            const ts = off; while (off < dataEnd && buf[off] !== 0) off++
            text = buf.toString('utf8', ts, off); off++
            if (off + 4 <= dataEnd) {
              textColor = [(255 - buf[off]) / 255, (255 - buf[off + 1]) / 255, (255 - buf[off + 2]) / 255, (255 - buf[off + 3]) / 255]
              off += 4
            }
          }
          if (cflags & 0x200) { while (off < dataEnd && buf[off] !== 0) off++; off++ }  // MediaURL
          // ExtraParams — always present: count U8, then [type U16, size U32, data]×count.
          // Capture type 0x80 (MaterialsEP → per-face GLTF PBR material UUIDs); skip the rest.
          if (off < dataEnd) {
            const epCount = buf[off++]
            for (let e = 0; e < epCount && off + 6 <= dataEnd; e++) {
              const epType = buf.readUInt16LE(off); off += 2
              const epSize = buf.readUInt32LE(off); off += 4
              if (epType === 0x80 && off + epSize <= dataEnd) pbrFaces = parseMaterialsExtraParam(buf, off, epSize)
              else if (epType === 0x30 && off + epSize <= dataEnd) {
                const sc = parseSculptExtraParam(buf, off, epSize)
                if (sc) { sculptType = sc.sculptType; const t = sc.sculptType & 0x07; if (t === 5) meshId = sc.uuid; else if (t >= 1 && t <= 4) sculptId = sc.uuid }
              }
              off += epSize
            }
          }
          if (cflags & 0x10) off += 25                // Sound: UUID16 + gain4 + flags1 + radius4
          if (cflags & 0x100) { while (off < dataEnd && buf[off] !== 0) off++; off++ }  // NameValue
          // Shape block — 23 bytes. NOTE: compressed order puts profileCurve at +16 (after all
          // path fields), UNLIKE the full ObjectUpdate layout (profileCurve at +1).
          if (off + 23 <= dataEnd) {
            shape = {
              pathCurve:        buf.readUInt8(off + 0),
              pathBegin:        buf.readUInt16LE(off + 1),
              pathEnd:          buf.readUInt16LE(off + 3),
              pathScaleX:       buf.readUInt8(off + 5),
              pathScaleY:       buf.readUInt8(off + 6),
              pathShearX:       buf.readInt8(off + 7),
              pathShearY:       buf.readInt8(off + 8),
              pathTwist:        buf.readInt8(off + 9),
              pathTwistBegin:   buf.readInt8(off + 10),
              pathRadiusOffset: buf.readInt8(off + 11),
              pathTaperX:       buf.readInt8(off + 12),
              pathTaperY:       buf.readInt8(off + 13),
              pathRevolutions:  buf.readUInt8(off + 14),
              pathSkew:         buf.readInt8(off + 15),
              profileCurve:     buf.readUInt8(off + 16),
              profileBegin:     buf.readUInt16LE(off + 17),
              profileEnd:       buf.readUInt16LE(off + 19),
              profileHollow:    buf.readUInt16LE(off + 21),
            }
            off += 23
            // TextureEntry — U32 length prefix (only low 16 bits used; high word must be 0).
            // This differs from the full ObjectUpdate, where TE uses a U16 length.
            if (off + 4 <= dataEnd) {
              const teLen = buf.readUInt32LE(off); off += 4
              if (teLen > 0 && (teLen & 0xffff0000) === 0 && off + teLen <= dataEnd) {
                te = parseTextureEntryFields(buf, off, off + teLen)
              }
              off += teLen
              // TextureAnim trails the TE in compressed layout (LLClientView
              // CreateCompressedUpdateBlock), U32 length prefix, only when flag 0x40 set.
              if ((cflags & 0x40) && off + 4 <= dataEnd) {
                const taLen = buf.readUInt32LE(off); off += 4
                if (off + taLen <= dataEnd) textureAnim = parseTextureAnim(buf, off, taLen) ?? undefined
                off += taLen
              }
            }
          }
        }
      } catch { /* best-effort: emit pos/rot/scale + whatever parsed cleanly */ }
      off = dataEnd
      // Trees/grass/particles render-skipped (same convention as full ObjectUpdate decoder).
      if (pcode === 0 || pcode === 3 || pcode === 95 || pcode === 255) continue
      const pbrKeys = Object.keys(pbrFaces)
      const defaultPbr = pbrFaces[0] ?? (pbrKeys.length ? pbrFaces[+pbrKeys[0]] : undefined)
      objects.push({
        localId, fullId, pcode,
        scale: [sx, sy, sz],
        pos:   [px, py, pz],
        rot:   [rx, ry, rz, rw],
        nameValue: '',
        parentId, crc,
        ...(shape ? { shape } : {}),
        ...(te.defaultColor   ? { defaultColor:   te.defaultColor }   : {}),
        ...(te.faceColors     ? { faceColors:     te.faceColors }     : {}),
        ...(te.defaultTexture ? { defaultTexture: te.defaultTexture } : {}),
        ...(te.faceTextures   ? { faceTextures:   te.faceTextures }   : {}),
        ...(te.defaultRepeats  ? { defaultRepeats:  te.defaultRepeats }  : {}),
        ...(te.defaultOffset   ? { defaultOffset:   te.defaultOffset }   : {}),
        ...(te.defaultRotation != null ? { defaultRotation: te.defaultRotation } : {}),
        ...(te.faceRepeats  ? { faceRepeats:  te.faceRepeats }  : {}),
        ...(te.faceOffset   ? { faceOffset:   te.faceOffset }   : {}),
        ...(te.faceRotation ? { faceRotation: te.faceRotation } : {}),
        ...(te.defaultGlow != null ? { defaultGlow: te.defaultGlow } : {}),
        ...(te.defaultShiny ? { defaultShiny: te.defaultShiny } : {}),
        ...(te.defaultFullbright ? { defaultFullbright: te.defaultFullbright } : {}),
        ...(te.defaultTexGen ? { defaultTexGen: te.defaultTexGen } : {}),
        ...(te.faceTexGen ? { faceTexGen: te.faceTexGen } : {}),
        ...(te.defaultMaterialId ? { defaultMaterialId: te.defaultMaterialId } : {}),
        ...(defaultPbr ? { defaultPbrMaterial: defaultPbr } : {}),
        ...(pbrKeys.length ? { pbrMaterials: Object.assign(new Array(32).fill(null), Object.fromEntries(Object.entries(pbrFaces))) } : {}),
        ...(meshId ? { meshId } : {}),
        ...(sculptType != null ? { sculptType } : {}),
        ...(sculptId ? { sculptId } : {}),
        ...(text ? { text } : {}),
        ...(textColor ? { textColor } : {}),
        ...(textureAnim ? { textureAnim } : {}),
        ...((cUpdateFlags & 0x400) ? { phantom: true } : {}),
        ...((cUpdateFlags & 0x80)  ? { handleTouch: true } : {}),
        ...(clickAction !== 0 ? { clickAction } : {}),
      })
    } catch (e) {
      onError?.(`compressedObj[${i}/${count}] failOff=${off}: ${(e as Error).message}`)
      break
    }
  }
  return objects
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
      const crc      = buf.readUInt32LE(off); off += 4   // PseudoCRC
      pcode = buf[off++]
      // WHY: pcode=3 (legacy tree/particle), pcode=95 (grass), pcode=255 (tree) use
      // non-standard ObjectData layouts in OpenSim. Their TE field reads as garbage
      // (animated texture UV data) rather than a real TE size prefix, causing thousands
      // of OOB errors per session that flood server-log.txt. We don't render these in
      // Phase 1. Break SILENTLY (no onError call) to suppress the log spam. Cannot
      // `continue` because off would be corrupted after the failed TE variable-field skip.
      // avatarSLPos and ownAvatarLocalId survive any avatar-packet loss via worldStore
      // restore in onMounted (see useWorldEngine.js).
      // pcode=0 tombstone: OpenSim inserts these mid-packet with non-zero localId but
      // zeros for fullId/CRC. All 26 header bytes (localId+state+fullId+CRC+pcode) have
      // already been consumed — just continue; the next object follows immediately.
      if (pcode === 0) { continue }
      // pcode=3/95/255 (legacy particle/grass/tree): variable-length ObjectData with
      // non-standard TE layout — can't advance `off` reliably. Drop remaining objects.
      if (pcode === 3 || pcode === 95 || pcode === 255) {
        const remaining = count - i - 1
        if (remaining > 0) {
          onError?.(`obj[${i}/${count}] localId=${localId} pcode=${pcode} unsupported; remaining ${remaining} objects in packet dropped`)
        }
        break
      }
      off += 1                        // material (not stored)
      const clickAction = buf[off++]  // ClickAction U8
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
      let rot: [number, number, number, number] = [0, 0, 0, 1]
      // ObjectData layout for F32 forms (libomv ObjectManager.cs):
      //   odLen=76 (avatar full): CollisionPlane(16) | Pos(12) | Vel(12) | Acc(12) | Rot(12) | AngVel(12)
      //   odLen=60 (prim full):   Pos(12) | Vel(12) | Acc(12) | Rot(12) | AngVel(12)
      // Rotation is 3 F32 = xyz of quaternion; w derived (w = sqrt(max(0, 1−x²−y²−z²)), w≥0).
      // odLen=48 is the half-precision form (U16-quantized); rotation decode TODO.
      if (odLen === 76) {
        pos = [buf.readFloatLE(off + 16), buf.readFloatLE(off + 20), buf.readFloatLE(off + 24)]
        const rx = buf.readFloatLE(off + 52)
        const ry = buf.readFloatLE(off + 56)
        const rz = buf.readFloatLE(off + 60)
        const rw = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry - rz * rz))
        rot = [rx, ry, rz, rw]
      } else if (odLen === 60) {
        pos = [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)]
        const rx = buf.readFloatLE(off + 36)
        const ry = buf.readFloatLE(off + 40)
        const rz = buf.readFloatLE(off + 44)
        const rw = Math.sqrt(Math.max(0, 1 - rx * rx - ry * ry - rz * rz))
        rot = [rx, ry, rz, rw]
      } else if (odLen >= 12) {
        pos = [buf.readFloatLE(off), buf.readFloatLE(off + 4), buf.readFloatLE(off + 8)]
      }
      off += odLen
      const parentId = buf.readUInt32LE(off); off += 4
      const updateFlags = buf.readUInt32LE(off); off += 4
      // WHY: Path/profile block is 23 bytes. Decode each field for client-side prim shape.
      //   PathCurve(1) + ProfileCurve(1) + PathBegin(2) + PathEnd(2) +
      //   PathScaleX(1) + PathScaleY(1) + PathShearX(1) + PathShearY(1) +
      //   PathTwist(1) + PathTwistBegin(1) + PathRadiusOffset(1) +
      //   PathTaperX(1) + PathTaperY(1) + PathRevolutions(1) + PathSkew(1) +
      //   ProfileBegin(2) + ProfileEnd(2) + ProfileHollow(2) = 23
      const shape: PrimShape = {
        pathCurve:        buf.readUInt8(off + 0),
        profileCurve:     buf.readUInt8(off + 1),
        pathBegin:        buf.readUInt16LE(off + 2),
        pathEnd:          buf.readUInt16LE(off + 4),
        pathScaleX:       buf.readUInt8(off + 6),
        pathScaleY:       buf.readUInt8(off + 7),
        pathShearX:       buf.readInt8(off + 8),
        pathShearY:       buf.readInt8(off + 9),
        pathTwist:        buf.readInt8(off + 10),
        pathTwistBegin:   buf.readInt8(off + 11),
        pathRadiusOffset: buf.readInt8(off + 12),
        pathTaperX:       buf.readInt8(off + 13),
        pathTaperY:       buf.readInt8(off + 14),
        pathRevolutions:  buf.readUInt8(off + 15),
        pathSkew:         buf.readInt8(off + 16),
        profileBegin:     buf.readUInt16LE(off + 17),
        profileEnd:       buf.readUInt16LE(off + 19),
        profileHollow:    buf.readUInt16LE(off + 21),
      }
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
        // WHY: Sim occasionally sends a Variable1 length that exceeds remaining buffer
        // (truncated packet or off-by-one in an earlier optional field). Clamp the
        // advance to buf.length so a tail OOB doesn't poison this object's decode — the
        // outer try will still salvage the prim via the push-on-tail-fail fallback.
        if (off + len > buf.length) {
          off = buf.length
          throw new Error(`${name}: length ${len} exceeds remaining buffer at off=${off - 1 - len}`)
        }
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
      // === TextureEntry — decode default RGBA + per-face color overrides ===
      // WHY: TE colors are stored inverted (actual = (255-byte)/255) so uninitialized
      // 0xFFFFFFFF decodes to transparent black, signaling "use default."
      // Format: defaultTex(16B) → [bitfield + texUUID]* → defaultColor(4B) → [bitfield + RGBA]* → ...
      // We capture the texture UUIDs (default + per-face) so the client can fetch them via the
      // asset cap (slice 1), then continue on to default + face colors.
      if (off + 1 >= buf.length) throw new Error(`TE prefix OOB at off=${off}`)
      const _teLen = buf.readUInt16LE(off); off += 2
      _diag += ` TE=${_teLen}`
      const _teEnd = off + _teLen
      let defaultColor: [number, number, number, number] | undefined
      let faceColors: Array<[number, number, number, number] | null> | undefined
      let defaultTexture: string | undefined
      let faceTextures: Array<string | null> | undefined
      let pbrFaces: Record<number, string> = {}
      let meshId: string | undefined
      let sculptId: string | undefined
      let sculptType: number | undefined
      // WHY: unified onto the generic parser shared with the compressed path so the full
      // update gets full UV transform (repeats/offset/rotation, default + per-face), glow,
      // shiny, fullbright, material_id — not just textures + colors. Bounded to [off, _teEnd]
      // so it can't read past the TE blob. meshId/sculptId are still set later by ExtraParams.
      const te = parseTextureEntryFields(buf, off, _teEnd)
      defaultTexture = te.defaultTexture
      faceTextures   = te.faceTextures
      defaultColor   = te.defaultColor
      faceColors     = te.faceColors
      off = _teEnd
      // WHY: TextureAnim is Variable1 (1-byte prefix), NOT Variable2.
      // LLUDP message_template: TextureAnim { Variable 1 }
      // Bug was: skipVar2() reading 1-byte TA prefix + 1-byte NV prefix as U16LE → crash.
      // === Tail fields — best-effort; if any OOB, push partial object below ===
      // WHY: Sim occasionally truncates ObjectUpdate packets mid-tail (rare but seen on
      // OpenSim during heavy load). Header through TextureEntry is enough to render the
      // prim (pos/rot/scale/shape/colors); MediaURL/PSBlock/ExtraParams/Sound/OwnerID/etc
      // are optional render-side. Wrap in nested try so a tail OOB still produces a
      // usable mesh rather than dropping the entire prim.
      let nameValue = ''
      let text = ''
      let textColor: [number, number, number, number] | undefined
      let textureAnim: TextureAnim | undefined
      let tailOk = false
      let _silentTail = false
      try {
        // TextureAnim (Variable1) — capture, advance like skipVar1 (clamped on truncated tails).
        {
          if (off >= buf.length) throw new Error(`TA prefix OOB at off=${off}`)
          const taLen = buf[off++]
          _diag += ` TA=${taLen}`
          textureAnim = parseTextureAnim(buf, off, taLen) ?? undefined
          off = Math.min(off + taLen, buf.length)
        }
        // NameValue: Variable2
        if (off + 1 >= buf.length) throw new Error(`NV prefix OOB at off=${off}`)
        const nvLen = buf.readUInt16LE(off); off += 2
        _diag += ` NV=${nvLen}`
        // WHY: nvLen > 2048 = misaligned pointer (pcode=1/2 and similar legacy pcodes whose
        // tail layout diverges from standard after TE). Matches the TE > 2048 silent-break
        // guard above. Partial object still pushed below; no onError to suppress log spam.
        if (nvLen > 2048) { _silentTail = true; throw new Error(`NV: length ${nvLen} misaligned`) }
        if (off + nvLen > buf.length) throw new Error(`NV: length ${nvLen} exceeds remaining buf`)
        nameValue = buf.slice(off, off + nvLen).toString('utf8'); off += nvLen
        // Data: Variable2 per message_template.msg — NOT Variable1. The old skipVar1 here read one
        // length byte of the U16; for empty Data (00 00) the stray second zero was swallowed by the
        // empty Text length (accidental realignment), masking the bug on most objects — but any
        // non-trivial tail desynced the walk at ExtraParams and silently dropped meshId/sculptId
        // (live-captured roof-fixture regression: objupdate-data-var2.test.ts).
        if (off + 1 >= buf.length) throw new Error(`Data prefix OOB at off=${off}`)
        const dataLen = buf.readUInt16LE(off); off += 2
        _diag += ` Data=${dataLen}`
        if (off + dataLen > buf.length) throw new Error(`Data: length ${dataLen} exceeds remaining buf`)
        off += dataLen
        // Text Variable1 + TextColor Fixed4 inverted RGBA
        if (off + 1 <= buf.length) {
          const tlen = buf[off++]
          _diag += ` Text=${tlen}`
          if (off + tlen > buf.length) throw new Error(`Text: length ${tlen} exceeds remaining buf`)
          text = buf.slice(off, off + tlen).toString('utf8').replace(/\0/g, '')
          off += tlen
        }
        if (off + 4 <= buf.length) {
          textColor = [
            (255 - buf[off])     / 255,
            (255 - buf[off + 1]) / 255,
            (255 - buf[off + 2]) / 255,
            (255 - buf[off + 3]) / 255,
          ]
          off += 4
        }
        skipVar1('MediaURL')
        skipVar1('PSBlock')      // particle system data, Variable1 (OpenSim extended can reach 192+)
        // ExtraParams (Variable1) — parse for type 0x80 (PBR material UUIDs); advance like skipVar1.
        {
          if (off >= buf.length) throw new Error(`ExtraParams prefix OOB at off=${off}`)
          const epLen = buf[off++]
          _diag += ` ExtraParams=${epLen}`
          if (off + epLen > buf.length) { off = buf.length; throw new Error(`ExtraParams length ${epLen} exceeds buffer`) }
          const epEnd = off + epLen
          let q = off
          if (q < epEnd) {
            const c = buf[q++]
            for (let e = 0; e < c && q + 6 <= epEnd; e++) {
              const t = buf.readUInt16LE(q); q += 2
              const sz = buf.readUInt32LE(q); q += 4
              if (t === 0x80 && q + sz <= epEnd) pbrFaces = parseMaterialsExtraParam(buf, q, sz)
              else if (t === 0x30 && q + sz <= epEnd) {
                const sc = parseSculptExtraParam(buf, q, sz)
                if (sc) { sculptType = sc.sculptType; const t = sc.sculptType & 0x07; if (t === 5) meshId = sc.uuid; else if (t >= 1 && t <= 4) sculptId = sc.uuid }
              }
              q += sz
            }
          }
          off += epLen
        }
        off += 16   // Sound UUID
        off += 16   // OwnerID UUID
        off += 4    // SoundGain F32
        off += 1    // Flags U8
        off += 4    // SoundRadius F32
        off += 1    // JointType U8
        off += 12   // JointPivot LLVector3
        off += 12   // JointAxisOrAnchor LLVector3
        tailOk = true
      } catch (tailErr) {
        if (!_silentTail) onError?.(`obj[${i}/${count}] localId=${localId} pcode=${pcode} tail decode OOB at off=${off}: ${(tailErr as Error).message}; pushing partial`)
      }
      objects.push({
        localId, fullId, pcode,
        scale: [sx, sy, sz], pos, rot, nameValue,
        parentId, crc,
        shape,
        ...(defaultColor ? { defaultColor } : {}),
        ...(faceColors ? { faceColors } : {}),
        ...(defaultTexture ? { defaultTexture } : {}),
        ...(faceTextures ? { faceTextures } : {}),
        ...(te.defaultRepeats  ? { defaultRepeats:  te.defaultRepeats }  : {}),
        ...(te.defaultOffset   ? { defaultOffset:   te.defaultOffset }   : {}),
        ...(te.defaultRotation != null ? { defaultRotation: te.defaultRotation } : {}),
        ...(te.faceRepeats  ? { faceRepeats:  te.faceRepeats }  : {}),
        ...(te.faceOffset   ? { faceOffset:   te.faceOffset }   : {}),
        ...(te.faceRotation ? { faceRotation: te.faceRotation } : {}),
        ...(te.defaultGlow != null ? { defaultGlow: te.defaultGlow } : {}),
        ...(te.defaultShiny ? { defaultShiny: te.defaultShiny } : {}),
        ...(te.defaultFullbright ? { defaultFullbright: te.defaultFullbright } : {}),
        ...(te.defaultTexGen ? { defaultTexGen: te.defaultTexGen } : {}),
        ...(te.faceTexGen ? { faceTexGen: te.faceTexGen } : {}),
        ...(te.defaultMaterialId ? { defaultMaterialId: te.defaultMaterialId } : {}),
        ...(Object.keys(pbrFaces).length ? { defaultPbrMaterial: pbrFaces[0] ?? pbrFaces[+Object.keys(pbrFaces)[0]], pbrMaterials: Object.assign(new Array(32).fill(null), pbrFaces) } : {}),
        ...(meshId ? { meshId } : {}),
        ...(sculptType != null ? { sculptType } : {}),
        ...(sculptId ? { sculptId } : {}),
        ...(text ? { text } : {}),
        ...(textColor ? { textColor } : {}),
        ...(textureAnim ? { textureAnim } : {}),
        ...((updateFlags & 0x400) ? { phantom: true } : {}),
        ...((updateFlags & 0x80)  ? { handleTouch: true } : {}),
        ...(clickAction !== 0 ? { clickAction } : {}),
      })
      // WHY: A tail OOB means `off` is no longer aligned to the next object's start.
      // Subsequent objects in this packet can't be safely decoded — break out cleanly so
      // we don't waste cycles on garbage and we keep the partial we already pushed.
      if (!tailOk) break
      // WHY: log each successful decode + 40 bytes AFTER endOff so we can see whether
      // the bytes immediately following are the next real object header or zero-padding.
      // This lets us diagnose the 25-zero gap that appears between objects in multi-object packets.
      if (count >= 1) {
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
  rot?:    [number, number, number, number]   // quaternion xyzw, dequantized from U16
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

  if (off >= buf.length) return results
  const count = buf[off++]

  // WHY: Per message_template.msg, ObjectData block has ONLY two fields:
  //   Data (Variable1) + TextureEntry (Variable2)
  // EVERYTHING (LocalID, State, AvatarFlag, CollisionPlane, Pos, Vel, Acc, Rot, AngVel)
  // lives INSIDE the Data variable1 blob. Previous decoder read LocalID+State+CollisionPlane
  // outside the wrapper → reading byte 22 as the Variable1 length prefix → dlen=255 sentinel
  // garbage → every terse update dropped → other-user movement invisible.
  //
  // Data binary layout (per phoenix-firestorm llviewerobject.cpp:1739-1776 dp branch):
  //   LocalID (U32 LE) — 4B
  //   State   (U8)     — 1B
  //   Agent   (U8)     — 1B (0=prim, 1=avatar)
  //   [CollisionPlane LLVector4 = 4×F32 = 16B] — avatar only
  //   Pos     (LLVector3 = 3×F32 = 12B)        — F32, NOT U16
  //   Vel     (3 U16) range -128..128          — 6B
  //   Acc     (3 U16) range -64..64            — 6B
  //   Rot     (4 U16) range -1..1              — 8B
  //   AngVel  (3 U16) range -64..64            — 6B
  // Prim length 32, avatar length 48.
  const dequantQ = (u16: number) => (u16 / 65535) * 2 - 1

  for (let i = 0; i < count && off < buf.length; i++) {
    if (off >= buf.length) break
    const dataLen = buf[off++]
    if (off + dataLen > buf.length) break
    const dStart = off

    const localId = buf.readUInt32LE(dStart)
    let dp = 4
    /* state = */ dp += 1
    const agentFlag = buf[dStart + dp]; dp += 1

    if (agentFlag) dp += 16  // CollisionPlane (avatar only)

    // Position: 3 F32
    let pos: [number, number, number] = [0, 0, 0]
    let rot: [number, number, number, number] | undefined
    if (dStart + dp + 12 <= dStart + dataLen) {
      pos = [
        buf.readFloatLE(dStart + dp),
        buf.readFloatLE(dStart + dp + 4),
        buf.readFloatLE(dStart + dp + 8),
      ]
      dp += 12
    }

    // Skip Vel (6) + Acc (6), then read Rot (8 U16)
    if (dStart + dp + 12 + 8 <= dStart + dataLen) {
      const rOff = dStart + dp + 12
      rot = [
        dequantQ(buf.readUInt16LE(rOff)),
        dequantQ(buf.readUInt16LE(rOff + 2)),
        dequantQ(buf.readUInt16LE(rOff + 4)),
        dequantQ(buf.readUInt16LE(rOff + 6)),
      ]
    }

    off = dStart + dataLen

    // TextureEntry (Variable 2) — usually empty for terse, skip
    if (off + 2 > buf.length) break
    const teLen = buf.readUInt16LE(off); off += 2
    off += teLen

    const isSentinel = !isFinite(pos[0]) || !isFinite(pos[1]) || !isFinite(pos[2])
      || Math.abs(pos[0]) > 1e30 || Math.abs(pos[1]) > 1e30 || Math.abs(pos[2]) > 1e30
    onRaw?.(localId, dataLen, pos, isSentinel)
    if (isSentinel) continue
    results.push({ localId, pos, rot })
  }

  return results
}

// ── RegionHandshake (Low #148) ────────────────────────────────────────────

export interface RegionHandshakeData {
  simName:    string
  simAccess:  number  // 13=PG, 21=Mature, 42=Adult
  // ── Render-critical fields from the RegionInfo block (default-safe if the sim
  //    sends a truncated packet — older OpenSim builds omit the trailing blocks) ──
  waterHeight:        number    // sea level in metres (SL default 20); anchors water plane + terrain palette
  terrainDetail:      string[]  // 4 detail-texture UUIDs (sand/grass/rock/mountain); '' if absent
  terrainStartHeight: number[]  // 4 corner start heights for texture blending (SW,NW,SE,NE order on wire)
  terrainHeightRange: number[]  // 4 corner height ranges
  regionId:           string    // RegionInfo2.RegionID UUID; '' if absent
  cacheId:            string    // RegionInfo.CacheID UUID; changes on region restart — localIds from
                                // a previous run are then dead, so the client must drop its object
                                // cache for this region (the sim silently ignores stale-id requests)
}

/**
 * Decode RegionHandshake — sent by sim right after circuit establishment.
 * We MUST reply with RegionHandshakeReply or the sim won't fully initialize our avatar.
 *
 * RegionInfo block layout (message_template.msg, in wire order):
 *   RegionFlags U32 | SimAccess U8 | SimName Var1 | SimOwner UUID | IsEstateManager U8 |
 *   WaterHeight F32 | BillableFactor F32 | CacheID UUID |
 *   TerrainBase0..3 UUID (legacy, usually null) | TerrainDetail0..3 UUID |
 *   TerrainStartHeight00/01/10/11 F32 | TerrainHeightRange00/01/10/11 F32
 * RegionInfo2 block: RegionID UUID. Trailing blocks (RegionInfo3/4) ignored.
 *
 * WHY default-safe: variable-length SimName means absolute offsets aren't fixed, and some
 * grids send shorter packets. Every read past SimName is bounds-checked; on overrun we
 * return SL-default waterHeight=20 and empty texture fields so render still works.
 */
export function decodeRegionHandshake(buf: Buffer, dataOffset: number): RegionHandshakeData {
  let off = dataOffset
  off += 4  // RegionFlags U32
  const simAccess = buf[off++]  // SimAccess U8 (13=PG, 21=Moderate, 42=Adult)
  // SimName: Variable1 (1-byte length prefix)
  const nameLen = buf[off++]
  const simName = buf.slice(off, off + nameLen).toString('utf8').replace(/\x00/g, '').trim()
  off += nameLen

  // Defaults used if the packet is truncated before a given field.
  let waterHeight        = 20
  const terrainDetail: string[]      = ['', '', '', '']
  const terrainStartHeight: number[] = [0, 0, 0, 0]
  const terrainHeightRange: number[] = [0, 0, 0, 0]
  let regionId           = ''
  let cacheId            = ''

  // WHY: each step guards against a short buffer. `need(n)` returns true only if n more
  // bytes are available from the current offset.
  const need = (n: number) => off + n <= buf.length
  try {
    if (need(16)) off += 16                              // SimOwner UUID (unused here)
    if (need(1))  off += 1                               // IsEstateManager U8
    if (need(4)) { waterHeight = buf.readFloatLE(off); off += 4 }
    if (need(4)) off += 4                                // BillableFactor F32
    if (need(16)) { cacheId = bytesToUuid(buf, off); off += 16 }  // CacheID UUID (region-run marker)
    if (need(64)) off += 64                              // TerrainBase0..3 (legacy, skip)
    for (let i = 0; i < 4; i++) {
      if (need(16)) { terrainDetail[i] = bytesToUuid(buf, off); off += 16 }
    }
    for (let i = 0; i < 4; i++) {
      if (need(4)) { terrainStartHeight[i] = buf.readFloatLE(off); off += 4 }
    }
    for (let i = 0; i < 4; i++) {
      if (need(4)) { terrainHeightRange[i] = buf.readFloatLE(off); off += 4 }
    }
    if (need(16)) { regionId = bytesToUuid(buf, off); off += 16 }  // RegionInfo2.RegionID
  } catch {
    // Any unexpected read error → keep whatever was parsed plus defaults.
  }

  return { simName, simAccess, waterHeight, terrainDetail, terrainStartHeight, terrainHeightRange, regionId, cacheId }
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

// ── World Map (Low #405/#406/#407/#408/#409) ──────────────────────────────
// MapLayerRequest body (Low 405): AgentData { AgentID, SessionID, Flags, EstateID, Godlike }.
// Many OpenSim builds gate WorldMapModule on a prior MapLayerRequest. Firestorm sends one
// at startup. Use as alive-probe — if sim replies with MapLayerReply (low:406), the map
// pipeline is functional.
export function encodeMapLayerRequest(p: {
  agentId:   string
  sessionId: string
  seq:       number
  flags?:    number
}): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG = Buffer.from([0xFF, 0xFF, 0x01, 0x95])  // Low #405 = 0x0195
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 4 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(p.flags ?? 0, off);    off += 4
  body.writeUInt32LE(0, off);                off += 4
  body[off++] = 0
  return Buffer.concat([hdr, MSG, body])
}


// MapBlockRequest body per Firestorm indra/newview/llworldmap.cpp:
//   AgentData { AgentID, SessionID, Flags U32, EstateID U32, Godlike Bool }
//   PositionData { MinX U16, MaxX U16, MinY U16, MaxY U16 }
// WHY flags = 0x10000: Firestorm sets `flags |= layer | (returnNonExistent ? 0x10000 : 0)`.
// Layer 0 = GridLayerType.Objects (libomv default). The 0x10000 "return non-existent" bit
// makes sim emit MapBlockReply entries even for empty grid slots — needed so map UI can
// show "offline" tiles, not silently drop replies.
export function encodeMapBlockRequest(p: {
  agentId:   string
  sessionId: string
  seq:       number
  minX:      number
  maxX:      number
  minY:      number
  maxY:      number
  flags?:    number
}): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG = Buffer.from([0xFF, 0xFF, 0x01, 0x97])  // Low #407 = 0x0197
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 4 + 1 + 2 + 2 + 2 + 2)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(p.flags ?? 0x00010000, off); off += 4
  body.writeUInt32LE(0, off);                     off += 4   // EstateID
  body[off++] = 0                                              // Godlike
  body.writeUInt16LE(p.minX, off);                off += 2
  body.writeUInt16LE(p.maxX, off);                off += 2
  body.writeUInt16LE(p.minY, off);                off += 2
  body.writeUInt16LE(p.maxY, off);                off += 2
  return Buffer.concat([hdr, MSG, body])
}

// MapNameRequest body per libomv / Firestorm llworldmap.cpp:
//   AgentData { AgentID, SessionID, Flags U32, EstateID U32, Godlike Bool }
//   NameData { Name Variable1 }
// Flags same convention as MapBlockRequest.
export function encodeMapNameRequest(p: {
  agentId:   string
  sessionId: string
  seq:       number
  name:      string
  flags?:    number
}): Buffer {
  const hdr = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG = Buffer.from([0xFF, 0xFF, 0x01, 0x98])  // Low #408 = 0x0198
  const nameBuf = Buffer.from(p.name + '\0', 'utf8')
  const body = Buffer.allocUnsafe(16 + 16 + 4 + 4 + 1 + 1 + nameBuf.length)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  body.writeUInt32LE(p.flags ?? 0x00010000, off); off += 4
  body.writeUInt32LE(0, off);                     off += 4
  body[off++] = 0
  body[off++] = nameBuf.length
  nameBuf.copy(body, off)
  return Buffer.concat([hdr, MSG, body])
}

export interface MapBlock {
  regionX:     number   // sim grid X (multiply by 256 for world metres)
  regionY:     number
  name:        string
  access:      number   // 13=PG, 21=Mature, 42=Adult, 254=down/offline
  regionFlags: number
  waterHeight: number
  agents:      number
  mapImageId:  string
  sizeX:       number   // region width in metres — 256 standard, 512/1024 var-region
  sizeY:       number
}

// MapBlockReply body per libomv + OpenSim LLClientView.SendMapBlock:
//   AgentData { AgentID, Flags U32 }
//   Data Variable count of { X U16, Y U16, Name V1, Access U8, RegionFlags U32,
//                            WaterHeight U8, Agents U8, MapImageID UUID }
//   Size Variable count of { SizeX U16, SizeY U16 } — var-region metres; OpenSim writes
//   count=0 when every block is standard 256m, else one pair per Data entry (same order).
export function decodeMapBlockReply(buf: Buffer, dataOffset: number): MapBlock[] {
  const out: MapBlock[] = []
  let off = dataOffset
  off += 16   // AgentID
  off += 4    // Flags
  if (off >= buf.length) return out
  const count = buf[off++]
  for (let i = 0; i < count && off < buf.length; i++) {
    try {
      const regionX = buf.readUInt16LE(off); off += 2
      const regionY = buf.readUInt16LE(off); off += 2
      if (off >= buf.length) break
      const nLen = buf[off++]
      if (off + nLen > buf.length) break
      const name = buf.slice(off, off + nLen).toString('utf8').replace(/\0/g, ''); off += nLen
      const access = buf[off++]
      const regionFlags = buf.readUInt32LE(off); off += 4
      const waterHeight = buf[off++]
      const agents      = buf[off++]
      const mapImageId  = bytesToUuid(buf, off); off += 16
      out.push({ regionX, regionY, name, access, regionFlags, waterHeight, agents, mapImageId, sizeX: 256, sizeY: 256 })
    } catch { break }
  }
  // Size block. WHY the count===out.length guard: appended-ack bytes can trail the body,
  // so only trust the block when its count matches the Data count and the pairs fit.
  if (off < buf.length) {
    const szCount = buf[off++]
    if (szCount === out.length && off + szCount * 4 <= buf.length) {
      for (let i = 0; i < szCount; i++) {
        const sx = buf.readUInt16LE(off); off += 2
        const sy = buf.readUInt16LE(off); off += 2
        if (sx > 0) out[i].sizeX = sx
        if (sy > 0) out[i].sizeY = sy
      }
    }
  }
  return out
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

// ══ Social (Phase 3) — friends / profile / groups / parcel ════════════════
// Message numbers verified against data/message_template.msg. Reply packets marked
// "Zerocoded" in the template are zero-DECODED by the handler (handleUdpMessage) before
// these decoders run, so they parse straight from the already-expanded buffer.

/** Variable1 string: U8 length prefix. Returns [string, nextOffset]. */
function readV1(buf: Buffer, off: number): [string, number] {
  const n = buf[off]
  const s = buf.slice(off + 1, off + 1 + n).toString('utf8').replace(/\0/g, '')
  return [s, off + 1 + n]
}
/** Variable2 string: U16-LE length prefix. Returns [string, nextOffset]. */
function readV2(buf: Buffer, off: number): [string, number] {
  const n = buf.readUInt16LE(off)
  const s = buf.slice(off + 2, off + 2 + n).toString('utf8').replace(/\0/g, '')
  return [s, off + 2 + n]
}

// ── Outbound requests ─────────────────────────────────────────────────────

/** TeleportLandmarkRequest (Low 65) — teleport to a saved inventory landmark. The sim resolves
 *  the landmark ASSET's stored region+position, so we only send its asset UUID (LandmarkID).
 *  Info{AgentID, SessionID, LandmarkID}. A zero LandmarkID means "teleport home". */
export function encodeTeleportLandmarkRequest(p: { agentId: string; sessionId: string; landmarkId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 16)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  uuidToBytes(p.landmarkId).copy(body, 32)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x41]), body])  // Low 65
}

/** SetStartLocationRequest (Low 204) — set avatar home/last position.
 *  LocationID 1 = home, 0 = last. SimName is variable-length (1-byte prefix). */
export function encodeSetStartLocationRequest(p: {
  agentId:    string
  sessionId:  string
  seq:        number
  simName:    string
  locationId: number   // 1 = home
  x: number; y: number; z: number
}): Buffer {
  const hdr      = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const MSG      = Buffer.from([0xFF, 0xFF, 0x00, 0xCC])  // Low 204
  const nameBytes = Buffer.from(p.simName, 'utf8')
  const body = Buffer.allocUnsafe(16 + 16 + 1 + nameBytes.length + 4 + 12 + 12)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);    off += 16
  uuidToBytes(p.sessionId).copy(body, off);  off += 16
  body.writeUInt8(nameBytes.length, off);    off += 1
  nameBytes.copy(body, off);                 off += nameBytes.length
  body.writeUInt32LE(p.locationId, off);     off += 4
  body.writeFloatLE(p.x, off); off += 4
  body.writeFloatLE(p.y, off); off += 4
  body.writeFloatLE(p.z, off); off += 4
  // LookAt — face north (0, 1, 0)
  body.writeFloatLE(0, off); off += 4
  body.writeFloatLE(1, off); off += 4
  body.writeFloatLE(0, off); off += 4
  return Buffer.concat([hdr, MSG, body])
}

/** AvatarPropertiesRequest (Low 169) — ask for an avatar's profile. Sim replies with
 *  AvatarPropertiesReply (+Interests +Groups). Body: AgentData{AgentID, SessionID, AvatarID}. */
export function encodeAvatarPropertiesRequest(p: { agentId: string; sessionId: string; avatarId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 16)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  uuidToBytes(p.avatarId).copy(body, 32)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0xA9]), body])  // Low 169
}

/** ParcelInfoRequest (Low 54). Body: AgentData{AgentID, SessionID}; Data{ParcelID}. */
export function encodeParcelInfoRequest(p: { agentId: string; sessionId: string; parcelId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 16)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  uuidToBytes(p.parcelId).copy(body, 32)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x36]), body])  // Low 54
}

/** UUIDNameRequest (Low 235) — resolve avatar UUIDs to names. UUIDNameBlock Variable{ID}×N.
 *  Note: no AgentData block in this message (per template). */
export function encodeUUIDNameRequest(p: { ids: string[]; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const ids  = p.ids.slice(0, 255)  // U8 count cap
  const body = Buffer.allocUnsafe(1 + ids.length * 16)
  body[0] = ids.length
  ids.forEach((id, i) => uuidToBytes(id).copy(body, 1 + i * 16))
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0xEB]), body])  // Low 235
}

/** AcceptFriendship (Low 297). AgentData{AgentID,SessionID}; TransactionBlock{TransactionID};
 *  FolderData Variable{FolderID} — where the calling card goes. */
export function encodeAcceptFriendship(p: { agentId: string; sessionId: string; transactionId: string; folderId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 16 + 1 + 16)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);       off += 16
  uuidToBytes(p.sessionId).copy(body, off);     off += 16
  uuidToBytes(p.transactionId).copy(body, off); off += 16
  body[off++] = 1  // FolderData count = 1
  uuidToBytes(p.folderId).copy(body, off)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x01, 0x29]), body])  // Low 297
}

/** DeclineFriendship (Low 298). AgentData{AgentID,SessionID}; TransactionBlock{TransactionID}. */
export function encodeDeclineFriendship(p: { agentId: string; sessionId: string; transactionId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 16)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  uuidToBytes(p.transactionId).copy(body, 32)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x01, 0x2A]), body])  // Low 298
}

/** TerminateFriendship (Low 300). AgentData{AgentID,SessionID}; ExBlock{OtherID}. */
export function encodeTerminateFriendship(p: { agentId: string; sessionId: string; otherId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 16)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  uuidToBytes(p.otherId).copy(body, 32)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x01, 0x2C]), body])  // Low 300
}

/** ChangeUserRights (Low 321) — change rights I grant a friend. AgentData{AgentID};
 *  Rights Variable{AgentRelated LLUUID, RelatedRights S32}. rights bits: 1=online,2=map,4=modify. */
export function encodeChangeUserRights(p: { agentId: string; agentRelated: string; relatedRights: number; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 1 + 16 + 4)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off); off += 16
  body[off++] = 1  // Rights count = 1
  uuidToBytes(p.agentRelated).copy(body, off); off += 16
  body.writeInt32LE(p.relatedRights, off)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x01, 0x41]), body])  // Low 321
}

/** AvatarPickerRequest (Low 26) — name search for Add-Friend.
 *  AgentData{AgentID, SessionID, QueryID}; Data{Name Variable 1 (NUL-terminated)}. */
export function encodeAvatarPickerRequest(p: { agentId: string; sessionId: string; queryId: string; name: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const name = Buffer.from((p.name || '') + '\0', 'utf8').subarray(0, 255)
  const body = Buffer.allocUnsafe(16 + 16 + 16 + 1 + name.length)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  uuidToBytes(p.queryId).copy(body, off);   off += 16
  body[off++] = name.length
  name.copy(body, off)
  return Buffer.concat([hdr, Buffer.from([0xFF, 0xFF, 0x00, 0x1A]), body])  // Low 26
}

// ── Inbound decoders ──────────────────────────────────────────────────────

/** OnlineNotification (322) / OfflineNotification (323): AgentBlock Variable{AgentID}×N. */
export function decodeOnlineNotification(buf: Buffer, dataOffset: number): string[] {
  const count = buf[dataOffset]
  const ids: string[] = []
  let off = dataOffset + 1
  for (let i = 0; i < count && off + 16 <= buf.length; i++, off += 16) ids.push(bytesToUuid(buf, off))
  return ids
}

/** UUIDNameReply (236): UUIDNameBlock Variable{ID, FirstName V1, LastName V1}×N. */
export function decodeUUIDNameReply(buf: Buffer, dataOffset: number): { id: string; name: string }[] {
  const count = buf[dataOffset]
  const out: { id: string; name: string }[] = []
  let off = dataOffset + 1
  for (let i = 0; i < count; i++) {
    const id = bytesToUuid(buf, off); off += 16
    let first: string, last: string
    ;[first, off] = readV1(buf, off)
    ;[last,  off] = readV1(buf, off)
    out.push({ id, name: [first, last].filter(Boolean).join(' ') })
  }
  return out
}

/** AvatarPickerReply (Low 28). AgentData{AgentID, QueryID};
 *  Data Variable{AvatarID, FirstName V1, LastName V1}×N. */
export function decodeAvatarPickerReply(buf: Buffer, dataOffset: number): {
  agentId: string; queryId: string; avatars: { id: string; firstName: string; lastName: string }[]
} {
  let off = dataOffset
  const agentId = bytesToUuid(buf, off); off += 16
  const queryId = bytesToUuid(buf, off); off += 16
  const count = buf[off++]
  const avatars: { id: string; firstName: string; lastName: string }[] = []
  const readV1Inline = (): string => {
    const len = buf[off++]
    const s = buf.toString('utf8', off, off + len).replace(/\0+$/, '')
    off += len
    return s
  }
  for (let i = 0; i < count && off + 16 <= buf.length; i++) {
    const id = bytesToUuid(buf, off); off += 16
    const firstName = readV1Inline()
    const lastName = readV1Inline()
    avatars.push({ id, firstName, lastName })
  }
  return { agentId, queryId, avatars }
}

/** ChangeUserRights (Low 321) inbound. AgentData{AgentID};
 *  Rights Variable{AgentRelated LLUUID, RelatedRights S32}×N. */
export function decodeChangeUserRights(buf: Buffer, dataOffset: number): {
  agentId: string; rights: { agentRelated: string; relatedRights: number }[]
} {
  let off = dataOffset
  const agentId = bytesToUuid(buf, off); off += 16
  const count = buf[off++]
  const rights: { agentRelated: string; relatedRights: number }[] = []
  for (let i = 0; i < count && off + 20 <= buf.length; i++) {
    const agentRelated = bytesToUuid(buf, off); off += 16
    const relatedRights = buf.readInt32LE(off); off += 4
    rights.push({ agentRelated, relatedRights })
  }
  return { agentId, rights }
}

export interface AvatarPropertiesData {
  avatarId: string; imageId: string; flImageId: string; partnerId: string
  aboutText: string; flAboutText: string; bornOn: string; profileURL: string
  charterMember: string; flags: number
}
/** AvatarPropertiesReply (171). */
export function decodeAvatarPropertiesReply(buf: Buffer, dataOffset: number): AvatarPropertiesData {
  let off = dataOffset + 16            // skip AgentID
  const avatarId = bytesToUuid(buf, off); off += 16
  const imageId   = bytesToUuid(buf, off); off += 16
  const flImageId = bytesToUuid(buf, off); off += 16
  const partnerId = bytesToUuid(buf, off); off += 16
  let aboutText: string, flAboutText: string, bornOn: string, profileURL: string, charterMember: string
  ;[aboutText,     off] = readV2(buf, off)
  ;[flAboutText,   off] = readV1(buf, off)
  ;[bornOn,        off] = readV1(buf, off)
  ;[profileURL,    off] = readV1(buf, off)
  ;[charterMember, off] = readV1(buf, off)
  const flags = buf.readUInt32LE(off)
  return { avatarId, imageId, flImageId, partnerId, aboutText, flAboutText, bornOn, profileURL, charterMember, flags }
}

export interface AvatarInterestsData {
  avatarId: string; wantToMask: number; wantToText: string
  skillsMask: number; skillsText: string; languagesText: string
}
/** AvatarInterestsReply (172). */
export function decodeAvatarInterestsReply(buf: Buffer, dataOffset: number): AvatarInterestsData {
  let off = dataOffset + 16            // skip AgentID
  const avatarId = bytesToUuid(buf, off); off += 16
  const wantToMask = buf.readUInt32LE(off); off += 4
  let wantToText: string, skillsText: string, languagesText: string
  ;[wantToText, off] = readV1(buf, off)
  const skillsMask = buf.readUInt32LE(off); off += 4
  ;[skillsText,    off] = readV1(buf, off)
  ;[languagesText, off] = readV1(buf, off)
  return { avatarId, wantToMask, wantToText, skillsMask, skillsText, languagesText }
}

export interface AvatarGroupEntry { id: string; name: string; title: string; insignia: string; powers: string; acceptNotices: boolean }
/** AvatarGroupsReply (173). GroupData field order: Powers,Notices,Title,ID,Name,Insignia. */
export function decodeAvatarGroupsReply(buf: Buffer, dataOffset: number): { avatarId: string; groups: AvatarGroupEntry[] } {
  let off = dataOffset + 16            // skip AgentID
  const avatarId = bytesToUuid(buf, off); off += 16
  const count = buf[off++]
  const groups: AvatarGroupEntry[] = []
  for (let i = 0; i < count; i++) {
    const powers = buf.readBigUInt64LE(off).toString(); off += 8
    const acceptNotices = buf[off++] !== 0
    let title: string, name: string
    ;[title, off] = readV1(buf, off)
    const id = bytesToUuid(buf, off); off += 16
    ;[name, off] = readV1(buf, off)
    const insignia = bytesToUuid(buf, off); off += 16
    groups.push({ id, name, title, insignia, powers, acceptNotices })
  }
  return { avatarId, groups }
}

export interface SelfGroupEntry { id: string; name: string; insignia: string; powers: string; acceptNotices: boolean; contribution: number }
/** AgentGroupDataUpdate (389) — self group list. GroupData order: ID,Powers,Notices,Insignia,Contribution,Name. */
export function decodeAgentGroupDataUpdate(buf: Buffer, dataOffset: number): { agentId: string; groups: SelfGroupEntry[] } {
  let off = dataOffset
  const agentId = bytesToUuid(buf, off); off += 16
  const count = buf[off++]
  const groups: SelfGroupEntry[] = []
  for (let i = 0; i < count; i++) {
    const id = bytesToUuid(buf, off); off += 16
    const powers = buf.readBigUInt64LE(off).toString(); off += 8
    const acceptNotices = buf[off++] !== 0
    const insignia = bytesToUuid(buf, off); off += 16
    const contribution = buf.readInt32LE(off); off += 4
    let name: string
    ;[name, off] = readV1(buf, off)
    groups.push({ id, name, insignia, powers, acceptNotices, contribution })
  }
  return { agentId, groups }
}

/** AgentDataUpdate (387) — self active group + title. */
export function decodeAgentDataUpdate(buf: Buffer, dataOffset: number): {
  agentId: string; firstName: string; lastName: string; groupTitle: string
  activeGroupId: string; groupPowers: string; groupName: string
} {
  let off = dataOffset
  const agentId = bytesToUuid(buf, off); off += 16
  let firstName: string, lastName: string, groupTitle: string, groupName: string
  ;[firstName,  off] = readV1(buf, off)
  ;[lastName,   off] = readV1(buf, off)
  ;[groupTitle, off] = readV1(buf, off)
  const activeGroupId = bytesToUuid(buf, off); off += 16
  const groupPowers = buf.readBigUInt64LE(off).toString(); off += 8
  ;[groupName, off] = readV1(buf, off)
  return { agentId, firstName, lastName, groupTitle, activeGroupId, groupPowers, groupName }
}

export interface ParcelInfoData {
  parcelId: string; ownerId: string; name: string; desc: string
  actualArea: number; billableArea: number; flags: number
  globalX: number; globalY: number; globalZ: number
  simName: string; snapshotId: string; dwell: number; salePrice: number; auctionId: number
}
/** ParcelInfoReply (55). */
export function decodeParcelInfoReply(buf: Buffer, dataOffset: number): ParcelInfoData {
  let off = dataOffset + 16            // skip AgentID
  const parcelId = bytesToUuid(buf, off); off += 16
  const ownerId  = bytesToUuid(buf, off); off += 16
  let name: string, desc: string, simName: string
  ;[name, off] = readV1(buf, off)
  ;[desc, off] = readV1(buf, off)
  const actualArea   = buf.readInt32LE(off); off += 4
  const billableArea = buf.readInt32LE(off); off += 4
  const flags = buf[off++]
  const globalX = buf.readFloatLE(off); off += 4
  const globalY = buf.readFloatLE(off); off += 4
  const globalZ = buf.readFloatLE(off); off += 4
  ;[simName, off] = readV1(buf, off)
  const snapshotId = bytesToUuid(buf, off); off += 16
  const dwell = buf.readFloatLE(off); off += 4
  const salePrice = buf.readInt32LE(off); off += 4
  const auctionId = buf.readInt32LE(off)
  return { parcelId, ownerId, name, desc, actualArea, billableArea, flags, globalX, globalY, globalZ, simName, snapshotId, dwell, salePrice, auctionId }
}
