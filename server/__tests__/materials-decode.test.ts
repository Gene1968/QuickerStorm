import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeObjectUpdateCompressed, parseMaterialsExtraParam } from '../lib/lludp-codec'

// Real material-bearing compressed packets captured live (fullbright-heavy region). Exercises the
// extended TE decode (glow/shiny/fullbright/material_id) against true wire bytes.
const pkts = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/material-packets.json'), 'utf8'))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const decodeAll = () => pkts.flatMap((p: any) => decodeObjectUpdateCompressed(Buffer.from(p.hex, 'hex'), p.dataOffset))

describe('TE material-field decode (real fixture)', () => {
	it('decodes fullbright on real prims, no desync (glow in range, material_id valid when present)', () => {
		const objs = decodeAll()
		expect(objs.length).toBeGreaterThan(0)
		expect(objs.some((o: any) => o.defaultFullbright)).toBe(true)   // this region had fullbright prims
		for (const o of objs) {
			if (o.defaultGlow != null) { expect(o.defaultGlow).toBeGreaterThanOrEqual(0); expect(o.defaultGlow).toBeLessThanOrEqual(1) }
			if (o.defaultShiny != null) { expect(o.defaultShiny).toBeGreaterThanOrEqual(0); expect(o.defaultShiny).toBeLessThanOrEqual(3) }
			if (o.defaultMaterialId) expect(o.defaultMaterialId).toMatch(UUID_RE)
			if (o.defaultPbrMaterial) expect(o.defaultPbrMaterial).toMatch(UUID_RE)
		}
	})

	it('still decodes texture + UV on these prims (no regression from added TE fields)', () => {
		const objs = decodeAll()
		// at least some textured; UV ranges sane
		for (const o of objs) {
			if (o.defaultRepeats) { expect(o.defaultRepeats[0]).toBeGreaterThan(0); expect(o.defaultRepeats[0]).toBeLessThan(10000) }
			if (o.defaultTexture) expect(o.defaultTexture).toMatch(UUID_RE)
		}
	})
})

describe('parseMaterialsExtraParam (ExtraParam 0x80)', () => {
	const U = (hex: string) => Buffer.from(hex.replace(/-/g, ''), 'hex')
	it('maps te_index → material asset UUID, drops zero UUIDs', () => {
		// [count=2][te=0][uuid A][te=3][uuid ZERO]
		const a = '11223344-5566-7788-99aa-bbccddeeff00'
		const buf = Buffer.concat([
			Buffer.from([2]),
			Buffer.from([0]), U(a),
			Buffer.from([3]), U('00000000-0000-0000-0000-000000000000'),
		])
		const faces = parseMaterialsExtraParam(buf, 0, buf.length)
		expect(faces[0]).toBe(a)
		expect(faces[3]).toBeUndefined()   // zero UUID dropped
	})

	it('returns empty for empty param', () => {
		expect(parseMaterialsExtraParam(Buffer.from([0]), 0, 1)).toEqual({})
	})
})
