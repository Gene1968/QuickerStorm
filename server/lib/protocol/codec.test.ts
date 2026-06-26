import { describe, it, expect } from 'bun:test'
import { encode, decode, messageName } from './codec.ts'
import { parseHeader, decodeZeroCoded } from './wire.ts'

const AGENT = '11111111-1111-1111-1111-111111111111'
const SESS  = '22222222-2222-2222-2222-222222222222'

describe('generic codec', () => {
	it('encodes SetAlwaysRun with Low 88 prefix and decodes back', () => {
		const buf = encode('SetAlwaysRun',
			{ AgentData: { AgentID: AGENT, SessionID: SESS, AlwaysRun: true } },
			{ seq: 5, reliable: true })
		const hdr = parseHeader(buf)
		expect([...buf.slice(hdr.bodyOffset, hdr.bodyOffset + 4)]).toEqual([0xFF, 0xFF, 0x00, 0x58])
		const msg = decode(buf)
		expect(msg.name).toBe('SetAlwaysRun')
		expect(msg.blocks.AgentData[0].AgentID).toBe(AGENT)
		expect(msg.blocks.AgentData[0].AlwaysRun).toBe(true)
	})

	it('round-trips a Variable block (PacketAck Packets)', () => {
		const buf = encode('PacketAck',
			{ Packets: [{ ID: 100 }, { ID: 200 }, { ID: 300 }] },
			{ seq: 1, reliable: false })
		const msg = decode(buf)
		expect(msg.name).toBe('PacketAck')
		expect(msg.blocks.Packets.map((p: any) => p.ID)).toEqual([100, 200, 300])
	})

	it('does NOT zero-code by default (matches hand-written encoders)', () => {
		const buf = encode('AgentThrottle', {
			AgentData: { AgentID: AGENT, SessionID: SESS, CircuitCode: 12345 },
			Throttle: { GenCounter: 0, Throttles: Buffer.alloc(28) },
		}, { seq: 2, reliable: true })
		expect(parseHeader(buf).zeroCoded).toBe(false)
		const msg = decode(buf)
		expect(msg.blocks.AgentData[0].CircuitCode).toBe(12345)
		expect((msg.blocks.Throttle[0].Throttles as Buffer).length).toBe(28)
	})

	it('zero-codes on opt-in and decode reverses it transparently', () => {
		const buf = encode('AgentThrottle', {
			AgentData: { AgentID: AGENT, SessionID: SESS, CircuitCode: 12345 },
			Throttle: { GenCounter: 0, Throttles: Buffer.alloc(28) },
		}, { seq: 2, reliable: true, zeroCoded: true })
		expect(parseHeader(buf).zeroCoded).toBe(true)
		const msg = decode(buf)
		expect(msg.blocks.AgentData[0].CircuitCode).toBe(12345)
		expect((msg.blocks.Throttle[0].Throttles as Buffer).length).toBe(28)
	})

	it('returns unknown marker for an unrecognized message id', () => {
		const fake = Buffer.from([0x00, 0, 0, 0, 1, 0, 0xFF, 0xFF, 0x7F, 0xFF]) // Low 0x7FFF unused
		const msg = decode(fake)
		expect(msg.unknown).toBe(true)
	})

	it('messageName identifies a packet cheaply without zero-decoding', () => {
		const buf = encode('SetAlwaysRun', { AgentData: { AgentID: AGENT, SessionID: SESS, AlwaysRun: true } }, { seq: 1, reliable: true })
		expect(messageName(buf)).toBe('SetAlwaysRun')
		const fake = Buffer.from([0x00, 0, 0, 0, 1, 0, 0xFF, 0xFF, 0x7F, 0xFF])
		expect(messageName(fake)).toBeUndefined()
	})

	it('decode with alreadyExpanded skips the (already-done) zero-decode', () => {
		// Simulate a dispatcher that expanded the body itself: build a zero-coded packet, then
		// hand decode a buffer whose body is already expanded but whose header still flags zeroCoded.
		const zc = encode('AgentThrottle', {
			AgentData: { AgentID: AGENT, SessionID: SESS, CircuitCode: 999 },
			Throttle: { GenCounter: 0, Throttles: Buffer.alloc(28) },
		}, { seq: 3, reliable: true, zeroCoded: true })
		const hdr = parseHeader(zc)
		// Expand exactly as the LLUDP dispatcher does (whole body from bodyOffset, id included).
		const expanded = Buffer.concat([zc.slice(0, hdr.bodyOffset), decodeZeroCoded(zc.slice(hdr.bodyOffset))])
		const msg = decode(expanded, { alreadyExpanded: true })
		expect(msg.blocks.AgentData[0].CircuitCode).toBe(999)
	})
})
