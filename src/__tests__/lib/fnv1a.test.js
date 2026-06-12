// src/__tests__/lib/fnv1a.test.js
import { describe, it, expect } from 'bun:test'
import { fnv1a32, fnv1aHex64 } from '@/lib/fnv1a.js'

const bytes = (s) => new TextEncoder().encode(s)

describe('fnv1a32', () => {
	it('matches known FNV-1a vectors with the standard offset basis', () => {
		expect(fnv1a32(bytes(''))).toBe(0x811c9dc5)
		expect(fnv1a32(bytes('a'))).toBe(0xe40c292c)
		expect(fnv1a32(bytes('foobar'))).toBe(0xbf9cf968)
	})
	it('is deterministic and input-sensitive', () => {
		const u = new Uint8Array([1, 2, 3, 4])
		expect(fnv1a32(u)).toBe(fnv1a32(new Uint8Array([1, 2, 3, 4])))
		expect(fnv1a32(u)).not.toBe(fnv1a32(new Uint8Array([1, 2, 3, 5])))
	})
	it('a different seed produces a different hash (seeds are correlated, not independent)', () => {
		const u = bytes('hello')
		expect(fnv1a32(u, 0x811c9dc5)).not.toBe(fnv1a32(u, 0xcbf29ce4))
	})
	it('alternate-seed vector pin (IV 0xcbf29ce4 = high-32 of FNV-64 offset basis)', () => {
		// regression pin (computed from this implementation, not a published vector)
		expect(fnv1a32(bytes('hello'), 0xcbf29ce4)).toBe(0xf2b853b4)
	})
})

describe('fnv1aHex64', () => {
	it('returns 16 lowercase hex chars', () => {
		expect(fnv1aHex64(bytes('hello'))).toMatch(/^[0-9a-f]{16}$/)
	})
	it('differs when any byte differs', () => {
		expect(fnv1aHex64(new Uint8Array([0]))).not.toBe(fnv1aHex64(new Uint8Array([1])))
	})
	it('hex output is zero-padded when high nibble is 0 (proves padStart)', () => {
		// Uint8Array([0]) produces a result starting with '0'; regression pin (computed from this implementation, not a published vector)
		expect(fnv1aHex64(new Uint8Array([0]))).toBe('050c5d1ff2ecfaec')
	})
})
