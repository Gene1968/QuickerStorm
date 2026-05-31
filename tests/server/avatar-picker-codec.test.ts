import { describe, it, expect } from 'vitest'
import {
	encodeAvatarPickerRequest,
	decodeAvatarPickerReply,
	decodeChangeUserRights,
	uuidToBytes,
} from '../../server/lib/lludp-codec'

const A = '11111111-1111-1111-1111-111111111111'
const Q = '22222222-2222-2222-2222-222222222222'
const S = '33333333-3333-3333-3333-333333333333'

describe('encodeAvatarPickerRequest (Low 26)', () => {
	it('emits the Low 26 message number and a length-prefixed name', () => {
		const pkt = encodeAvatarPickerRequest({ agentId: A, sessionId: S, queryId: Q, name: 'Bob', seq: 5 })
		const idx = pkt.indexOf(Buffer.from([0xff, 0xff, 0x00, 0x1a]))
		expect(idx).toBeGreaterThanOrEqual(0)
		const body = pkt.subarray(idx + 4)
		expect(body.subarray(0, 16).equals(uuidToBytes(A))).toBe(true)
		expect(body.subarray(16, 32).equals(uuidToBytes(S))).toBe(true)
		expect(body.subarray(32, 48).equals(uuidToBytes(Q))).toBe(true)
		const len = body[48]
		expect(len).toBe(4) // "Bob" + NUL
		expect(body.subarray(49, 49 + 3).toString('utf8')).toBe('Bob')
	})
})

describe('decodeAvatarPickerReply (Low 28)', () => {
	it('decodes agentId, queryId, and the avatar array', () => {
		const av = '44444444-4444-4444-4444-444444444444'
		const first = Buffer.from('Bob\0', 'utf8')
		const last = Buffer.from('Linden\0', 'utf8')
		const body = Buffer.concat([
			uuidToBytes(A), uuidToBytes(Q), Buffer.from([1]),
			uuidToBytes(av), Buffer.from([first.length]), first,
			Buffer.from([last.length]), last,
		])
		const out = decodeAvatarPickerReply(body, 0)
		expect(out.queryId).toBe(Q.toLowerCase())
		expect(out.avatars).toEqual([{ id: av.toLowerCase(), firstName: 'Bob', lastName: 'Linden' }])
	})
})

describe('decodeChangeUserRights (Low 321)', () => {
	it('decodes the agent and the rights entries', () => {
		const related = '55555555-5555-5555-5555-555555555555'
		const body = Buffer.concat([
			uuidToBytes(A), Buffer.from([1]),
			uuidToBytes(related), (() => { const b = Buffer.alloc(4); b.writeInt32LE(3, 0); return b })(),
		])
		const out = decodeChangeUserRights(body, 0)
		expect(out.agentId).toBe(A.toLowerCase())
		expect(out.rights).toEqual([{ agentRelated: related.toLowerCase(), relatedRights: 3 }])
	})
})
