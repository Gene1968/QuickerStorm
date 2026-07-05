// Pure-logic tests for the in-world sound engine (S-4/S-5/S-6):
// byte-bounded AudioBuffer LRU (shared src/lib/byteLRU.js, sized by audioBufferBytes),
// FS cutoff-radius gain rule, parent-chain world position, base64 payload decode.
// Web Audio / socket paths are exercised live, not here.
import { describe, it, expect } from 'vitest'
import { createByteLRU } from '@/lib/byteLRU.js'
import {
	audioBufferBytes, effectiveGain,
	quatRotate, composeWorldPos, b64ToArrayBuffer, isNullUuid,
} from '@/composables/useSoundEngine.js'

// Fake AudioBuffer: frames × channels × 4 bytes via audioBufferBytes — the exact sizeOf the
// engine passes to the shared LRU.
const fakeBuf = (frames, channels = 1) => ({ length: frames, numberOfChannels: channels })

describe('decoded-buffer LRU (lib/byteLRU + audioBufferBytes sizeOf)', () => {
	const makeLru = (budgetBytes) => createByteLRU({ budgetBytes, sizeOf: audioBufferBytes })

	it('stores and retrieves buffers, tracking decoded PCM bytes', () => {
		const lru = makeLru(1000)
		const a = fakeBuf(25)             // 100 bytes
		lru.set('a', a)
		expect(lru.get('a')).toBe(a)
		expect(lru.bytes()).toBe(100)
		expect(lru.size()).toBe(1)
	})

	it('evicts the oldest entry past the byte budget', () => {
		const lru = makeLru(1000)
		lru.set('a', fakeBuf(100))        // 400 B
		lru.set('b', fakeBuf(100))        // 400 B
		lru.set('c', fakeBuf(100))        // 1200 > 1000 → evict a
		expect(lru.get('a')).toBeUndefined()
		expect(lru.get('b')).toBeDefined()
		expect(lru.get('c')).toBeDefined()
		expect(lru.bytes()).toBe(800)
	})

	it('get() refreshes recency so a re-played sound survives eviction', () => {
		const lru = makeLru(1000)
		lru.set('a', fakeBuf(100))
		lru.set('b', fakeBuf(100))
		lru.get('a')                      // a is now most-recent
		lru.set('c', fakeBuf(100))        // over budget → evict b (oldest), not a
		expect(lru.get('a')).toBeDefined()
		expect(lru.get('b')).toBeUndefined()
	})

	it('a single oversized buffer still caches (protected on its own insert)', () => {
		const lru = makeLru(1000)
		lru.set('big', fakeBuf(1000, 2))  // 8000 B > budget
		expect(lru.get('big')).toBeDefined()
	})
})

describe('audioBufferBytes', () => {
	it('is frames × channels × 4 (F32 PCM)', () => {
		expect(audioBufferBytes({ length: 44100, numberOfChannels: 2 })).toBe(44100 * 2 * 4)
	})
	it('tolerates null', () => {
		expect(audioBufferBytes(null)).toBe(0)
	})
})

describe('effectiveGain (FS llaudiosourcevo.cpp:63-82 cutoff rule)', () => {
	it('no radius → gain unchanged', () => {
		expect(effectiveGain(0.8, 0, 500)).toBe(0.8)
	})
	it('radius below 0.1 m counts as off', () => {
		expect(effectiveGain(0.8, 0.05, 500)).toBe(0.8)
	})
	it('beyond the cutoff radius → hard mute', () => {
		expect(effectiveGain(0.8, 10, 15)).toBe(0)
	})
	it('inside the cutoff radius → gain unchanged', () => {
		expect(effectiveGain(0.8, 10, 5)).toBe(0.8)
	})
	it('clamps gain to 0..1 (FS llclampf)', () => {
		expect(effectiveGain(1.5, 0, 0)).toBe(1)
		expect(effectiveGain(-2, 0, 0)).toBe(0)
	})
})

describe('quatRotate / composeWorldPos', () => {
	const SQ2 = Math.SQRT1_2   // sin/cos 45° — quaternion for 90° about Z
	it('rotates +X to +Y for a 90° Z rotation', () => {
		const out = quatRotate([0, 0, SQ2, SQ2], [1, 0, 0])
		expect(out[0]).toBeCloseTo(0, 6)
		expect(out[1]).toBeCloseTo(1, 6)
		expect(out[2]).toBeCloseTo(0, 6)
	})

	it('root object: returns its own pos', () => {
		const objects = new Map([[1, { pos: [10, 20, 30] }]])
		expect(composeWorldPos(objects, 1)).toEqual([10, 20, 30])
	})

	it('child prim: composes parent rot + pos (parent-relative wire coords)', () => {
		const objects = new Map([
			[1, { pos: [10, 10, 10], rot: [0, 0, SQ2, SQ2] }],       // root rotated 90° about Z
			[2, { pos: [1, 0, 0], parentId: 1 }],                    // child 1 m along parent +X
		])
		const out = composeWorldPos(objects, 2)
		expect(out[0]).toBeCloseTo(10, 5)
		expect(out[1]).toBeCloseTo(11, 5)
		expect(out[2]).toBeCloseTo(10, 5)
	})

	it('unknown object → null', () => {
		expect(composeWorldPos(new Map(), 99)).toBeNull()
	})

	it('missing parent breaks the walk gracefully (child pos returned as-is)', () => {
		const objects = new Map([[2, { pos: [1, 2, 3], parentId: 1 }]])
		expect(composeWorldPos(objects, 2)).toEqual([1, 2, 3])
	})
})

describe('b64ToArrayBuffer', () => {
	it('round-trips bytes', () => {
		const buf = b64ToArrayBuffer(btoa('abc'))
		expect([...new Uint8Array(buf)]).toEqual([97, 98, 99])
	})
})

describe('isNullUuid', () => {
	it('null UUID / empty / undefined are null', () => {
		expect(isNullUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
		expect(isNullUuid('')).toBe(true)
		expect(isNullUuid(undefined)).toBe(true)
	})
	it('a real UUID is not', () => {
		expect(isNullUuid('4c8c3c77-de8d-bde2-b9b8-32635e0fd4a6')).toBe(false)
	})
})
