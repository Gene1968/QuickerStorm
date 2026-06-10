import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeObjectUpdateCompressed, combineFacePairs } from '../lib/lludp-codec'

// Real ObjectUpdateCompressed packets captured live from DigiWorldz (server/handlers/lludp.ts
// one-shot capture). These exercise the decoder against true wire bytes, not hand-rolled input.
const pkts: Array<{ hex: string; dataOffset: number }> =
	JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/compressed-packets.json'), 'utf8'))

const decode = (i: number) => {
	const p = pkts[i]
	return decodeObjectUpdateCompressed(Buffer.from(p.hex, 'hex'), p.dataOffset)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('decodeObjectUpdateCompressed — full TE decode', () => {
	it('preserves the MVP fields (regression: pos/localId/parentId unchanged)', () => {
		const o = decode(0)[0]
		expect(o.localId).toBe(675307655)
		expect(o.pos[0]).toBeCloseTo(8.0376, 2)
		expect(o.pos[2]).toBeCloseTo(25.6, 2)
		const c = decode(1)[0]
		expect(c.parentId).toBe(675306818)   // HasParent (cflags 0x20)
	})

	it('decodes the prim shape block (path/profile)', () => {
		const o = decode(0)[0]
		expect(o.shape).toBeDefined()
		expect(o.shape!.pathCurve).toBe(16)   // 0x10 = line/box path
	})

	it('decodes the TextureEntry default texture UUID (the U32-length-prefixed TE)', () => {
		const o = decode(0)[0]
		// This is the exact UUID that textured in-world ([Asset] texture 5748decc…).
		expect(o.defaultTexture).toBe('5748decc-f629-461c-9a36-a35a221fe21f')
	})

	it('decodes the TextureEntry default color (inverted-byte RGBA → 0..1)', () => {
		const o = decode(0)[0]
		expect(o.defaultColor).toBeDefined()
		for (const ch of o.defaultColor!) { expect(ch).toBeGreaterThanOrEqual(0); expect(ch).toBeLessThanOrEqual(1) }
		expect(o.defaultColor![0]).toBeCloseTo(0.176, 2)   // wire 0xd2 → (255-210)/255
	})

	it('decodes TE UV transform (repeats/offset/rotation) into sane ranges', () => {
		const o = decode(0)[0]
		expect(o.defaultRepeats).toBeDefined()
		// SL default repeats are 1,1; tiled faces go higher. Either way > 0 and not absurd.
		expect(o.defaultRepeats![0]).toBeGreaterThan(0)
		expect(o.defaultRepeats![0]).toBeLessThan(1000)
		expect(o.defaultRepeats![1]).toBeGreaterThan(0)
		// offset is -1..1, rotation -2π..2π
		expect(Math.abs(o.defaultOffset![0])).toBeLessThanOrEqual(1)
		expect(Math.abs(o.defaultRotation!)).toBeLessThanOrEqual(Math.PI * 2 + 0.01)
	})

	it('UV transform stays in range across every object in every fixture (no desync)', () => {
		for (let i = 0; i < pkts.length; i++) {
			for (const o of decode(i)) {
				if (o.defaultRepeats) {
					expect(o.defaultRepeats[0]).toBeGreaterThan(0)
					expect(o.defaultRepeats[0]).toBeLessThan(10000)
					expect(o.defaultRepeats[1]).toBeGreaterThan(0)
					expect(o.defaultRepeats[1]).toBeLessThan(10000)
				}
				if (o.defaultOffset) {
					expect(Math.abs(o.defaultOffset[0])).toBeLessThanOrEqual(1.01)
					expect(Math.abs(o.defaultOffset[1])).toBeLessThanOrEqual(1.01)
				}
			}
		}
	})

	it('does not desync: every decoded object across all fixtures has a valid/absent default texture', () => {
		for (let i = 0; i < pkts.length; i++) {
			for (const o of decode(i)) {
				if (o.defaultTexture !== undefined) expect(o.defaultTexture).toMatch(UUID_RE)
			}
		}
	})

	it('per-face UV fields are well-formed when present, never crash when absent', () => {
		for (let i = 0; i < pkts.length; i++) {
			for (const o of decode(i)) {
				// faceRepeats/faceOffset: array of [number,number]|null; present entries positive/finite.
				if (o.faceRepeats !== undefined) {
					expect(Array.isArray(o.faceRepeats)).toBe(true)
					for (const e of o.faceRepeats) {
						if (e == null) continue
						expect(e.length).toBe(2)
						expect(e[0]).toBeGreaterThan(0)
						expect(Number.isFinite(e[1])).toBe(true)
					}
				}
				if (o.faceOffset !== undefined) {
					for (const e of o.faceOffset) {
						if (e == null) continue
						expect(e.length).toBe(2)
						expect(Math.abs(e[0])).toBeLessThanOrEqual(1.01)
						expect(Math.abs(e[1])).toBeLessThanOrEqual(1.01)
					}
				}
				if (o.faceRotation !== undefined) {
					for (const e of o.faceRotation) {
						if (e == null) continue
						expect(Math.abs(e)).toBeLessThanOrEqual(Math.PI * 2 + 0.01)
					}
				}
			}
		}
	})
})

// Per-face UV combine logic — the pure helper backing parseTextureEntryFields' faceRepeats/faceOffset.
describe('combineFacePairs — per-face UV pairing', () => {
	it('returns null when neither axis has overrides', () => {
		expect(combineFacePairs(null, null, 1, 1)).toBeNull()
	})

	it('fills the missing axis from its default when only one axis overrides a face', () => {
		const a = new Array(32).fill(null); a[3] = 4   // scaleS override on face 3
		const out = combineFacePairs(a, null, 1, 1)!
		expect(out).not.toBeNull()
		expect(out[3]).toEqual([4, 1])   // S from override, T from default
		expect(out[0]).toBeNull()        // untouched faces stay null
	})

	it('pairs both axes when both override the same face, defaults elsewhere', () => {
		const s = new Array(32).fill(null); s[5] = 2
		const t = new Array(32).fill(null); t[5] = 3; t[6] = 7
		const out = combineFacePairs(s, t, 1, 1)!
		expect(out[5]).toEqual([2, 3])   // both present
		expect(out[6]).toEqual([1, 7])   // only T present → S from default
	})

	it('returns null if arrays exist but contain no non-null entries', () => {
		expect(combineFacePairs(new Array(32).fill(null), new Array(32).fill(null), 1, 1)).toBeNull()
	})
})
