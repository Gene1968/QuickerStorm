import { describe, it, expect } from 'bun:test'
import { primFaceMap, slFaceForGroup, BOX_FACE_MAP, CYL_FACE_MAP } from '@/lib/primFaceMap.js'

const box  = { pathCurve: 16, profileCurve: 1 }   // square box
const cyl  = { pathCurve: 16, profileCurve: 0 }   // cylinder
const prism = { pathCurve: 16, profileCurve: 3 }
const sphere = { pathCurve: 32, profileCurve: 5 }
const torus  = { pathCurve: 32, profileCurve: 0 }

describe('primFaceMap', () => {
	it('square box → verified group→SLface map', () => {
		expect(primFaceMap(box)).toEqual([2, 4, 0, 5, 1, 3])
		expect(BOX_FACE_MAP).toEqual([2, 4, 0, 5, 1, 3])
	})
	it('cylinder → verified group→SLface map', () => {
		expect(primFaceMap(cyl)).toEqual([1, 0, 2])
		expect(CYL_FACE_MAP).toEqual([1, 0, 2])
	})
	it('prism / sphere / torus → null (fallback)', () => {
		expect(primFaceMap(prism)).toBeNull()
		expect(primFaceMap(sphere)).toBeNull()
		expect(primFaceMap(torus)).toBeNull()
	})
	it('null / missing shape → null', () => {
		expect(primFaceMap(null)).toBeNull()
		expect(primFaceMap({})).toBeNull()
	})
	it('hollow box → null (faces renumber)', () => {
		expect(primFaceMap({ ...box, profileHollow: 12000 })).toBeNull()
	})
	it('path-cut box → null', () => {
		expect(primFaceMap({ ...box, pathBegin: 5000 })).toBeNull()
		expect(primFaceMap({ ...box, pathEnd: 5000 })).toBeNull()
	})
	it('profile-cut cylinder → null', () => {
		expect(primFaceMap({ ...cyl, profileBegin: 5000 })).toBeNull()
		expect(primFaceMap({ ...cyl, profileEnd: 5000 })).toBeNull()
	})
})

describe('slFaceForGroup', () => {
	it('null map → identity', () => {
		expect(slFaceForGroup(null, 3)).toBe(3)
	})
	it('uses the map when present', () => {
		expect(slFaceForGroup(BOX_FACE_MAP, 0)).toBe(2)
		expect(slFaceForGroup(BOX_FACE_MAP, 2)).toBe(0)
	})
	it('out-of-range group index → identity fallback', () => {
		expect(slFaceForGroup(CYL_FACE_MAP, 9)).toBe(9)
	})
})
