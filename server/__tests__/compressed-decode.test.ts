import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeObjectUpdateCompressed } from '../lib/lludp-codec'

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
})
