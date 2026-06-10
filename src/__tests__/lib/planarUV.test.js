import { describe, it, expect } from 'bun:test'
import { planarUV, planarUVFromThree } from '@/lib/planarUV.js'

// Expected values hand-derived from the FS llface.cpp planarProjection() formula:
//   binormal: |n.x|≥0.5 → (0, sign(n.x), 0); else n.y>0 → (−1,0,0), else (1,0,0)
//   tangent = binormal × normal
//   u = 1 + (B·P)·2 − 0.5 ; v = −((T·P)·2 − 0.5)

describe('planarUV', () => {
	it('origin projects to the texture center-ish (0.5, 0.5) for any normal', () => {
		expect(planarUV(0, 0, 0, 0, 0, 1)).toEqual([0.5, 0.5])
		expect(planarUV(0, 0, 0, 1, 0, 0)).toEqual([0.5, 0.5])
		expect(planarUV(0, 0, 0, 0, -1, 0)).toEqual([0.5, 0.5])
	})

	it('+Z (top) face: binormal (1,0,0), tangent (0,−1,0)', () => {
		// B·P = px = 0.5 → u = 1.5 ; T·P = −py = −0.5 → v = 1.5
		expect(planarUV(0.5, 0.5, 7, 0, 0, 1)).toEqual([1.5, 1.5])
		// 1m face spans ±0.5 → u spans [−0.5, 1.5]: 2 texture repeats per meter (SL planar default)
		expect(planarUV(-0.5, 0, 0, 0, 0, 1)[0]).toBeCloseTo(-0.5)
		expect(planarUV(0.5, 0, 0, 0, 0, 1)[0]).toBeCloseTo(1.5)
	})

	it('+X face: binormal (0,1,0), tangent (0,0,−1)', () => {
		// B·P = py = 0.25 → u = 1.0 ; T·P = −pz = −0.75 → v = 2.0
		expect(planarUV(9, 0.25, 0.75, 1, 0, 0)).toEqual([1, 2])
	})

	it('−X face: binormal (0,−1,0), tangent (0,0,−1)', () => {
		// B·P = −py = −0.25 → u = 0 ; T·P = −pz = −0.75 → v = 2.0
		expect(planarUV(9, 0.25, 0.75, -1, 0, 0)).toEqual([0, 2])
	})

	it('+Y face: binormal (−1,0,0), tangent (0,0,−1)', () => {
		// B·P = −px = −0.25 → u = 1 + (−0.5 − 0.5) = 0 ; T·P = −pz = −0.5 → v = 1.5
		expect(planarUV(0.25, 9, 0.5, 0, 1, 0)).toEqual([0, 1.5])
	})

	it('normalizes a non-unit normal before the dominant-axis test', () => {
		expect(planarUV(0.5, 0.5, 7, 0, 0, 10)).toEqual(planarUV(0.5, 0.5, 7, 0, 0, 1))
		// (0.4, 0, 0.4) normalizes to x≈0.707 ≥ 0.5 → +X branch, not the y-fallback
		expect(planarUV(9, 0.25, 0.75, 0.4, 0, 0.4)[0]).toBeCloseTo(planarUV(9, 0.25, 0.75, 0.707, 0, 0.707)[0])
	})

	it('zero normal does not produce NaN', () => {
		const [u, v] = planarUV(1, 2, 3, 0, 0, 0)
		expect(Number.isFinite(u)).toBe(true)
		expect(Number.isFinite(v)).toBe(true)
	})

	it('planarUVFromThree matches planarUV through the (x, z, −y) bake', () => {
		// SL (0.5, 0.5, 1) ↔ Three (0.5, 1, −0.5); SL +Z normal ↔ Three +Y
		expect(planarUVFromThree(0.5, 1, -0.5, 0, 1, 0)).toEqual(planarUV(0.5, 0.5, 1, 0, 0, 1))
		// SL +X face passthrough
		expect(planarUVFromThree(9, 0.75, -0.25, 1, 0, 0)).toEqual(planarUV(9, 0.25, 0.75, 1, 0, 0))
	})
})
