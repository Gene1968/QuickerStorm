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
