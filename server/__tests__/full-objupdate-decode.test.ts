import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeObjectUpdate } from '../lib/lludp-codec'

// Real packets captured live (objupdate-raw.json holds both full ObjectUpdate and
// ObjectUpdateCompressed records, tagged by `kind`). Here we exercise the FULL path
// after it was unified onto the generic parseTextureEntryFields TE parser.
const all: Array<{ kind: string; hex: string; dataOffset: number }> =
	JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/objupdate-raw.json'), 'utf8'))
const full = all.filter(p => p.kind === 'full')

const decode = (p: { hex: string; dataOffset: number }) =>
	decodeObjectUpdate(Buffer.from(p.hex, 'hex'), p.dataOffset)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('decodeObjectUpdate (full path) — unified TE parse', () => {
	it('has full-update fixtures to test', () => {
		expect(full.length).toBeGreaterThan(0)
	})

	it('still decodes texture + shape + pos (regression: nothing dropped by unification)', () => {
		for (const p of full) {
			for (const o of decode(p)) {
				expect(o.shape).toBeDefined()
				expect(o.pos.length).toBe(3)
				if (o.defaultTexture !== undefined) expect(o.defaultTexture).toMatch(UUID_RE)
			}
		}
	})

	it('now exposes defaultRepeats/defaultOffset/defaultRotation (previously absent on full updates)', () => {
		// Every prim that decodes a TE should now carry the UV transform the compressed path always had.
		let withReps = 0
		for (const p of full) {
			for (const o of decode(p)) {
				if (o.defaultRepeats) {
					withReps++
					expect(o.defaultRepeats.length).toBe(2)
					expect(o.defaultRepeats[0]).toBeGreaterThan(0)
					expect(o.defaultRepeats[1]).toBeGreaterThan(0)
					expect(o.defaultOffset).toBeDefined()
					expect(Math.abs(o.defaultOffset![0])).toBeLessThanOrEqual(1.01)
					expect(typeof o.defaultRotation).toBe('number')
					expect(Math.abs(o.defaultRotation!)).toBeLessThanOrEqual(Math.PI * 2 + 0.01)
				}
			}
		}
		expect(withReps).toBeGreaterThan(0)
	})

	it('per-face UV fields, when present, are well-formed (and never crash when absent)', () => {
		for (const p of full) {
			for (const o of decode(p)) {
				if (o.faceRepeats) for (const e of o.faceRepeats) {
					if (e == null) continue
					expect(e.length).toBe(2); expect(e[0]).toBeGreaterThan(0)
				}
				if (o.faceOffset) for (const e of o.faceOffset) {
					if (e == null) continue
					expect(Math.abs(e[0])).toBeLessThanOrEqual(1.01)
				}
				if (o.faceRotation) for (const e of o.faceRotation) {
					if (e == null) continue
					expect(Math.abs(e)).toBeLessThanOrEqual(Math.PI * 2 + 0.01)
				}
			}
		}
	})
})
