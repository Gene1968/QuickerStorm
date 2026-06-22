// src/__tests__/lib/geomKey.test.js
import { describe, it, expect } from 'bun:test'
import { primGeomKey, meshGeomKey, sculptGeomKey, SHAPE_KEY_FIELDS } from '@/lib/geomKey.js'
import { GEOM_VERSION } from '@/lib/primGeometry.js'

const SHAPE = {
	pathCurve: 16, profileCurve: 1, pathBegin: 0, pathEnd: 50000,
	profileBegin: 0, profileEnd: 50000, pathScaleX: 100, pathScaleY: 100,
	pathShearX: 0, pathShearY: 0, pathTwist: 0, pathTwistBegin: 0,
	pathRadiusOffset: 0, pathTaperX: 0, pathTaperY: 0,
	pathRevolutions: 0, pathSkew: 0, profileHollow: 0,
}
const SCALE = [1, 2, 0.5]

describe('primGeomKey', () => {
	it('is deterministic and carries the version + p1 prefix', () => {
		const k = primGeomKey(SHAPE, SCALE)
		expect(k).toBe(primGeomKey({ ...SHAPE }, [...SCALE]))
		expect(k.startsWith(`p1:${GEOM_VERSION}:`)).toBe(true)
	})
	it('keys all 18 shape fields — changing ANY field changes the key', () => {
		expect(SHAPE_KEY_FIELDS.length).toBe(18)
		const base = primGeomKey(SHAPE, SCALE)
		for (const f of SHAPE_KEY_FIELDS) {
			expect(primGeomKey({ ...SHAPE, [f]: (SHAPE[f] || 0) + 1 }, SCALE)).not.toBe(base)
		}
	})
	it('changing any scale component changes the key', () => {
		const base = primGeomKey(SHAPE, SCALE)
		expect(primGeomKey(SHAPE, [1.001, 2, 0.5])).not.toBe(base)
		expect(primGeomKey(SHAPE, [1, 2.001, 0.5])).not.toBe(base)
		expect(primGeomKey(SHAPE, [1, 2, 0.501])).not.toBe(base)
	})
	it('missing/undefined shape fields read as 0 (matches decode defaults)', () => {
		const zeros = Object.fromEntries(SHAPE_KEY_FIELDS.map(f => [f, 0]))
		expect(primGeomKey({}, SCALE)).toBe(primGeomKey(zeros, SCALE))
		expect(primGeomKey(undefined, SCALE)).toBe(primGeomKey(zeros, SCALE))
	})
	it('null/undefined scale defaults to [1,1,1]', () => {
		expect(primGeomKey(SHAPE, null)).toBe(primGeomKey(SHAPE, [1, 1, 1]))
		expect(primGeomKey(SHAPE, undefined)).toBe(primGeomKey(SHAPE, [1, 1, 1]))
	})
})

describe('meshGeomKey / sculptGeomKey', () => {
	it('embed asset id + version, scale-FREE (unscaled bakes, m2/s2 prefixes)', () => {
		const k = meshGeomKey('aaaa-bbbb')
		expect(k).toBe(`m2:${GEOM_VERSION}:aaaa-bbbb`)   // lod 0 = bare-uuid (warm-cache back-compat)
		expect(meshGeomKey('xxxx')).not.toBe(meshGeomKey('yyyy'))
	})
	it('sculpt key includes sculptType (type changes decode output)', () => {
		expect(sculptGeomKey('ssss', 1)).not.toBe(sculptGeomKey('ssss', 2))
		expect(sculptGeomKey('ssss', 1)).toBe(`s2:${GEOM_VERSION}:ssss:1`)
	})
})

describe('meshGeomKey with LOD', () => {
	it('different LODs of the same mesh produce different keys', () => {
		const uuid = '0123abcd-0000-0000-0000-000000000000'
		expect(meshGeomKey(uuid, 0)).not.toBe(meshGeomKey(uuid, 2))
	})
	it('embeds the lod in the key', () => {
		expect(meshGeomKey('abc', 3).endsWith(':3')).toBe(true)
	})
	it('defaults to high (0) when lod omitted (back-compat call shape)', () => {
		expect(meshGeomKey('abc')).toBe(meshGeomKey('abc', 0))
	})
})
