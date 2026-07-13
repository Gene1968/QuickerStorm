import { describe, it, expect } from 'vitest'
import {
	PRIM_SHAPES, PRIM_SHAPE_KEYS, getPrimShape,
	PROFILE_CIRCLE, PROFILE_SQUARE, PROFILE_EQUALTRI, PROFILE_CIRCLE_HALF,
	PATH_LINE, PATH_CIRCLE, PCODE_VOLUME,
} from '@/lib/primShapes.js'

const SQRT1_2 = Math.SQRT1_2

describe('primShapes', () => {
	it('exposes all 13 basic-prim keys, in Create-tab button order', () => {
		expect(PRIM_SHAPE_KEYS).toEqual([
			'cube', 'prism', 'pyramid', 'tetrahedron', 'cylinder', 'hemicylinder',
			'cone', 'hemicone', 'sphere', 'hemisphere', 'torus', 'tube', 'ring',
		])
		for (const key of PRIM_SHAPE_KEYS) expect(PRIM_SHAPES[key]).toBeTruthy()
	})

	// Hand-derived from lltoolplacer.cpp:398-406 (LL_PCODE_CUBE): profile=SQUARE/path=LINE,
	// S(0,1) T(0,1), ratio(1,1), shear(0,0), no rotation quirk.
	it('cube matches the FS LL_PCODE_CUBE case exactly', () => {
		expect(PRIM_SHAPES.cube).toEqual({
			pcode: PCODE_VOLUME,
			profileCurve: PROFILE_SQUARE,
			pathCurve: PATH_LINE,
			profileBegin: 0, profileEnd: 1,
			pathBegin: 0, pathEnd: 1,
			pathScaleX: 1, pathScaleY: 1,
			pathShearX: 0, pathShearY: 0,
			profileHollow: 0,
			pathTwist: 0, pathTwistBegin: 0, pathRadiusOffset: 0,
			pathTaperX: 0, pathTaperY: 0,
			pathRevolutions: 1, pathSkew: 0,
			rotation: [0, 0, 0, 1],
		})
	})

	// Hand-derived from lltoolplacer.cpp:352-362 (LL_PCODE_TORUS): profile=CIRCLE/path=CIRCLE,
	// S(0,1) T(0,1), ratio(1, 0.25) "top size", shear(0,0), PLUS the 90°-about-Y rotation quirk
	// shared by sphere/torus/tube/ring (lltoolplacer.cpp:353).
	it('torus matches the FS LL_PCODE_TORUS case exactly, incl. 90-Y rotation quirk', () => {
		expect(PRIM_SHAPES.torus).toEqual({
			pcode: PCODE_VOLUME,
			profileCurve: PROFILE_CIRCLE,
			pathCurve: PATH_CIRCLE,
			profileBegin: 0, profileEnd: 1,
			pathBegin: 0, pathEnd: 1,
			pathScaleX: 1, pathScaleY: 0.25,
			pathShearX: 0, pathShearY: 0,
			profileHollow: 0,
			pathTwist: 0, pathTwistBegin: 0, pathRadiusOffset: 0,
			pathTaperX: 0, pathTaperY: 0,
			pathRevolutions: 1, pathSkew: 0,
			rotation: [0, SQRT1_2, 0, SQRT1_2],
		})
		// Quaternion stays unit length (angle/2=45°, sin=cos=SQRT1_2 → x²+y²+z²+w²=1).
		const [x, y, z, w] = PRIM_SHAPES.torus.rotation
		expect(x * x + y * y + z * z + w * w).toBeCloseTo(1, 10)
	})

	it('sphere/tube/ring share the same 90-Y rotation quirk as torus', () => {
		for (const key of ['sphere', 'tube', 'ring']) {
			expect(PRIM_SHAPES[key].rotation).toEqual([0, SQRT1_2, 0, SQRT1_2])
		}
	})

	it('hemisphere has no rotation quirk (FS leaves rotation identity, lltoolplacer.cpp:388-396)', () => {
		expect(PRIM_SHAPES.hemisphere.rotation).toEqual([0, 0, 0, 1])
		expect(PRIM_SHAPES.hemisphere.pathBegin).toBe(0)
		expect(PRIM_SHAPES.hemisphere.pathEnd).toBe(0.5)
	})

	it('hemicylinder/hemicone cut profile S to 0.25..0.75, keep full path T', () => {
		expect(PRIM_SHAPES.hemicylinder.profileBegin).toBe(0.25)
		expect(PRIM_SHAPES.hemicylinder.profileEnd).toBe(0.75)
		expect(PRIM_SHAPES.hemicylinder.pathBegin).toBe(0)
		expect(PRIM_SHAPES.hemicylinder.pathEnd).toBe(1)
		expect(PRIM_SHAPES.hemicone.profileBegin).toBe(0.25)
		expect(PRIM_SHAPES.hemicone.profileEnd).toBe(0.75)
	})

	it('prism has the shear(-0.5,0) + ratio(0,1) quirk (lltoolplacer.cpp:408-416)', () => {
		expect(PRIM_SHAPES.prism.pathScaleX).toBe(0)
		expect(PRIM_SHAPES.prism.pathScaleY).toBe(1)
		expect(PRIM_SHAPES.prism.pathShearX).toBe(-0.5)
		expect(PRIM_SHAPES.prism.pathShearY).toBe(0)
	})

	it('tetrahedron uses the EQUALTRI profile (lltoolplacer.cpp:428-436)', () => {
		expect(PRIM_SHAPES.tetrahedron.profileCurve).toBe(PROFILE_EQUALTRI)
		expect(PRIM_SHAPES.tetrahedron.pathCurve).toBe(PATH_LINE)
	})

	it('ring uses EQUALTRI profile + CIRCLE path (FS "triangle torus", lltoolplacer.cpp:376-386)', () => {
		expect(PRIM_SHAPES.ring.profileCurve).toBe(PROFILE_EQUALTRI)
		expect(PRIM_SHAPES.ring.pathCurve).toBe(PATH_CIRCLE)
	})

	it('sphere uses the CIRCLE_HALF profile (lltoolplacer.cpp:340-350)', () => {
		expect(PRIM_SHAPES.sphere.profileCurve).toBe(PROFILE_CIRCLE_HALF)
		expect(PRIM_SHAPES.sphere.pathCurve).toBe(PATH_CIRCLE)
	})

	it('every shape carries pcode=PCODE_VOLUME (llvolume.h:102) and full default path params', () => {
		for (const key of PRIM_SHAPE_KEYS) {
			const s = PRIM_SHAPES[key]
			expect(s.pcode).toBe(PCODE_VOLUME)
			expect(s.profileHollow).toBe(0)
			expect(s.pathTwist).toBe(0)
			expect(s.pathTwistBegin).toBe(0)
			expect(s.pathRadiusOffset).toBe(0)
			expect(s.pathTaperX).toBe(0)
			expect(s.pathTaperY).toBe(0)
			expect(s.pathRevolutions).toBe(1)
			expect(s.pathSkew).toBe(0)
			expect(s.rotation).toHaveLength(4)
		}
	})

	describe('getPrimShape', () => {
		it('returns a deep-enough clone: mutating rotation does not affect the table', () => {
			const shape = getPrimShape('cube')
			shape.rotation[0] = 999
			shape.pathScaleX = 999
			expect(PRIM_SHAPES.cube.rotation).toEqual([0, 0, 0, 1])
			expect(PRIM_SHAPES.cube.pathScaleX).toBe(1)
		})

		it('returns null for an unknown shape key', () => {
			expect(getPrimShape('nope')).toBeNull()
			expect(getPrimShape(undefined)).toBeNull()
		})

		it('round-trips every known key', () => {
			for (const key of PRIM_SHAPE_KEYS) {
				expect(getPrimShape(key)).toEqual(PRIM_SHAPES[key])
			}
		})
	})
})
