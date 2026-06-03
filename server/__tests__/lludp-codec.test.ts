import { describe, it, expect } from 'bun:test'
import {
  buildHeader, parseHeader,
  encodeUseCircuitCode,
  encodeCompleteAgentMovement,
  encodePacketAck,
  encodeLogoutRequest,
  parseMsgType,
  decodeChatFromSimulator,
  decodeZeroCoded,
  encodeZeroCoded,
  decodeObjectUpdateCompressed,
} from '../lib/lludp-codec'

const AGENT_ID  = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  return Buffer.from(hex, 'hex')
}

describe('buildHeader / parseHeader', () => {
  it('round-trips a reliable header', () => {
    const hdr = buildHeader({ seq: 42, reliable: true, hasAcks: false, zeroCoded: false })
    const parsed = parseHeader(hdr)
    expect(parsed.seq).toBe(42)
    expect(parsed.reliable).toBe(true)
    expect(parsed.hasAcks).toBe(false)
  })
})

describe('zero coding', () => {
  it('decodes zero runs correctly', () => {
    // 0x00 0x03 means three zero bytes
    const encoded = Buffer.from([0x01, 0x00, 0x03, 0x02])
    const decoded = decodeZeroCoded(encoded)
    expect(decoded).toEqual(Buffer.from([0x01, 0x00, 0x00, 0x00, 0x02]))
  })

  it('encodes consecutive zeros', () => {
    const raw = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x02])
    const enc = encodeZeroCoded(raw)
    expect(enc).toEqual(Buffer.from([0x01, 0x00, 0x03, 0x02]))
  })
})

describe('decodeObjectUpdateCompressed — Data block layout (per Firestorm sObjectDataMap)', () => {
  const FULL_ID = '12345678-1234-1234-1234-1234567890ab'
  const OWNER_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'   // all-0xFF: if the decoder mis-reads
                                                            // ParentID from inside Owner it gets 0xffffffff
  // Build one Compressed "Data" block. Layout after Rot: SpecialCode(U32) | Owner(UUID,16, ALWAYS)
  //   | Omega(Vec3,12 — only if 0x80) | ParentID(U32 — only if 0x20).
  function buildData(opts: {
    localId: number
    pcode?: number
    scale: [number, number, number]
    pos: [number, number, number]
    cflags?: number
    omega?: boolean
    parentId?: number
  }): Buffer {
    const { localId, pcode = 9, scale, pos, cflags = 0, parentId = 0 } = opts
    const parts: Buffer[] = []
    parts.push(uuidToBytes(FULL_ID))                                     // FullID 16
    const lid = Buffer.alloc(4); lid.writeUInt32LE(localId); parts.push(lid)
    parts.push(Buffer.from([pcode, 0]))                                  // PCode + State
    parts.push(Buffer.alloc(4))                                         // CRC
    parts.push(Buffer.from([3, 0]))                                     // Material + ClickAction
    const sc = Buffer.alloc(12); scale.forEach((v, i) => sc.writeFloatLE(v, i * 4)); parts.push(sc)
    const ps = Buffer.alloc(12); pos.forEach((v, i) => ps.writeFloatLE(v, i * 4)); parts.push(ps)
    parts.push(Buffer.alloc(12))                                        // Rot (3 floats, all 0)
    const sp = Buffer.alloc(4); sp.writeUInt32LE(cflags); parts.push(sp) // SpecialCode
    parts.push(uuidToBytes(OWNER_ID))                                   // Owner (always)
    if (cflags & 0x80) parts.push(Buffer.alloc(12))                     // Omega
    if (cflags & 0x20) { const p = Buffer.alloc(4); p.writeUInt32LE(parentId); parts.push(p) }
    return Buffer.concat(parts)
  }

  function buildPacket(blocks: Buffer[]): Buffer {
    const head = Buffer.alloc(11)        // RegionHandle(8) + TimeDilation(2) + Count(1)
    head.writeUInt8(blocks.length, 10)
    const objs = blocks.map(d => {
      const uf = Buffer.alloc(4)         // UpdateFlags
      const len = Buffer.alloc(2); len.writeUInt16LE(d.length)
      return Buffer.concat([uf, len, d])
    })
    return Buffer.concat([head, ...objs])
  }

  it('decodes a root prim (no parent) with parentId=0 and correct position', () => {
    const data = buildData({ localId: 675307870, scale: [2, 2, 2], pos: [128.5, 64.25, 25.0], cflags: 0 })
    const objs = decodeObjectUpdateCompressed(buildPacket([data]), 0)
    expect(objs).toHaveLength(1)
    expect(objs[0].localId).toBe(675307870)
    expect(objs[0].parentId).toBe(0)
    expect(objs[0].pos[0]).toBeCloseTo(128.5, 3)
    expect(objs[0].pos[1]).toBeCloseTo(64.25, 3)
    expect(objs[0].pos[2]).toBeCloseTo(25.0, 3)
  })

  it('decodes a linkset CHILD: recovers the real parentId (regression for underwater bug)', () => {
    // Child carries its parent-local offset as "pos"; parentId must point at the root, NOT 0.
    const data = buildData({
      localId: 675304225, scale: [1, 1, 1], pos: [4.448, 0.028, -16.023],
      cflags: 0x20, parentId: 676079037,
    })
    const objs = decodeObjectUpdateCompressed(buildPacket([data]), 0)
    expect(objs[0].parentId).toBe(676079037)   // buggy code reads 0xffffffff from Owner UUID
    expect(objs[0].pos[2]).toBeCloseTo(-16.023, 3)
  })

  it('decodes a child WITH angular velocity (0x80): parentId sits after the 12-byte Omega', () => {
    const data = buildData({
      localId: 42, scale: [1, 1, 1], pos: [1, 2, 3],
      cflags: 0x20 | 0x80, parentId: 999,
    })
    const objs = decodeObjectUpdateCompressed(buildPacket([data]), 0)
    expect(objs[0].parentId).toBe(999)
  })
})

describe('encodeUseCircuitCode', () => {
  it('produces a buffer with correct circuit code', () => {
    const buf = encodeUseCircuitCode({ agentId: AGENT_ID, sessionId: SESSION_ID, circuitCode: 12345, seq: 1 })
    expect(buf.length).toBeGreaterThan(10)
    // bytes 5 == 0 (no extra), bytes 6-9 == Low freq ID 0xFF 0xFF 0x00 0x03
    expect(buf[6]).toBe(0xFF)
    expect(buf[7]).toBe(0xFF)
    expect(buf[8]).toBe(0x00)
    expect(buf[9]).toBe(0x03)
  })
})

describe('encodePacketAck', () => {
  it('encodes multiple ack IDs', () => {
    const buf = encodePacketAck([1, 2, 3], 10)
    expect(buf).toBeDefined()
    expect(buf.length).toBeGreaterThan(6)
  })
})
