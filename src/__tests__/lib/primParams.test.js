// primParams.test.js — FS-parity display/inverse mapping acceptance tests.
// Golden PRISM values are Gene's exact reported FS-vs-us mismatch (2026-07-13): a Build-tool
// "Prism" (primShapes.js `prism` entry — profile SQUARE/path LINE, ratio 0/1, shear -0.5/0 — FS
// shows this as a Box shape family with an extreme taper, NOT the ISOTRI/EQUALTRI "ring/prism"
// profile family; see primShapes.js:63-69 lltoolplacer.cpp:408-416).
import { describe, it, expect } from 'vitest'
import { dequantShape, shapeKind, displayParams, uiToWireParams } from '@/lib/primParams.js'

// Raw wire ints exactly as the codec's PrimShape decode would produce (lludp-codec.ts:2020-2039):
// pathScaleX/Y and pathRevolutions are U8 (unsigned); pathShearX/Y, pathTwist*, pathTaperX/Y,
// pathRadiusOffset, pathSkew are S8 (signed, already sign-extended by readInt8).
const PRISM_SHAPE = {
	pathCurve: 16, profileCurve: 1,              // PATH_LINE, PROFILE_SQUARE
	pathBegin: 0, pathEnd: 0,                     // float 0 / 1
	pathScaleX: 200, pathScaleY: 100,             // ratio float 0 / 1
	pathShearX: -50, pathShearY: 0,               // float -0.5 / 0
	pathTwist: 0, pathTwistBegin: 0,
	pathRadiusOffset: 0,
	pathTaperX: 0, pathTaperY: 0,
	pathRevolutions: 0,                           // float 1.0
	pathSkew: 0,
	profileBegin: 0, profileEnd: 0,                // float 0 / 1
	profileHollow: 0,
}

// FS torus (primShapes.js `torus` entry): profile CIRCLE/path CIRCLE, ratio(1, 0.25) "top size",
// PLUS nonzero twist to exercise the ×360 circular-path display scale.
const TORUS_SHAPE = {
	pathCurve: 32, profileCurve: 0,               // PATH_CIRCLE, PROFILE_CIRCLE
	pathBegin: 0, pathEnd: 0,
	pathScaleX: 100, pathScaleY: 175,             // ratio float 1.0 / 0.25 (200-175=25 → 0.25)
	pathShearX: 0, pathShearY: 0,
	pathTwist: 50, pathTwistBegin: 0,             // float 0.5 → 0.5*360 = 180°
	pathRadiusOffset: 0,
	pathTaperX: 0, pathTaperY: 0,
	pathRevolutions: 0,
	pathSkew: 0,
	profileBegin: 0, profileEnd: 0,
	profileHollow: 0,
}

describe('shapeKind', () => {
	it('identifies the golden prism raw shape as box (SQUARE profile family)', () => {
		expect(shapeKind(PRISM_SHAPE)).toBe('box')
	})
	it('identifies the golden torus raw shape as torus (scaleY <= 0.75)', () => {
		expect(shapeKind(TORUS_SHAPE)).toBe('torus')
	})
	it('sphere: same profile/path as torus but scaleY > 0.75', () => {
		expect(shapeKind({ ...TORUS_SHAPE, pathScaleY: 100 })).toBe('sphere')   // ratio 1.0
	})
	it('unknown combos return null', () => {
		expect(shapeKind({ pathCurve: 0x30, profileCurve: 4 })).toBe(null)   // CIRCLE2 + RIGHTTRI
	})
	it('null shape returns null', () => {
		expect(shapeKind(null)).toBe(null)
	})
})

describe('displayParams — golden PRISM acceptance (Gene 2026-07-13)', () => {
	const p = displayParams(PRISM_SHAPE)
	it('Path Cut 0.00000/1.00000 (profile S-range, linear/box family)', () => {
		expect(p.pathCutBegin).toBeCloseTo(0, 5)
		expect(p.pathCutEnd).toBeCloseTo(1, 5)
	})
	it('Slice 0.00000/1.00000 (path T-range, labeled Slice for box)', () => {
		expect(p.advBegin).toBeCloseTo(0, 5)
		expect(p.advEnd).toBeCloseTo(1, 5)
		expect(p.advLabel).toBe('Slice')
	})
	it('Taper 1.00000/0.00000 (1 - ratio, labeled Taper)', () => {
		expect(p.taperX).toBeCloseTo(1, 5)
		expect(p.taperY).toBeCloseTo(0, 5)
		expect(p.taperLabel).toBe('Taper')
	})
	it('Top Shear -0.50000/0.00000', () => {
		expect(p.shearX).toBeCloseTo(-0.5, 5)
		expect(p.shearY).toBeCloseTo(0, 5)
	})
	it('Revolutions 1.00000', () => {
		expect(p.revolutions).toBeCloseTo(1, 5)
	})
	it('hides radius offset/revolutions/skew (linear family)', () => {
		expect(p.showRadiusRevSkew).toBe(false)
	})
})

describe('displayParams — torus (hole size + twist ×360)', () => {
	const p = displayParams(TORUS_SHAPE)
	it('Hole Size = raw ratio, labeled Hole Size', () => {
		expect(p.taperX).toBeCloseTo(1.0, 5)
		expect(p.taperY).toBeCloseTo(0.25, 5)
		expect(p.taperLabel).toBe('Hole Size')
	})
	it('Path Cut uses the T (path) range for torus family', () => {
		expect(p.pathCutBegin).toBeCloseTo(0, 5)
		expect(p.pathCutEnd).toBeCloseTo(1, 5)
	})
	it('advanced cut is labeled Profile Cut', () => {
		expect(p.advLabel).toBe('Profile Cut')
	})
	it('twist ×360 (circular path)', () => {
		expect(p.twistEnd).toBeCloseTo(180, 5)
	})
	it('shows radius offset/revolutions/skew (circular family)', () => {
		expect(p.showRadiusRevSkew).toBe(true)
	})
})

describe('uiToWireParams — round trip (dequant → display → wire ≈ original floats)', () => {
	it('prism: displayParams(PRISM_SHAPE) fed back through uiToWireParams reproduces the dequant floats', () => {
		const before = dequantShape(PRISM_SHAPE)
		const ui = displayParams(PRISM_SHAPE)
		const wire = uiToWireParams(PRISM_SHAPE, ui)
		expect(wire.pathCurve).toBe(before.pathCurve)
		expect(wire.profileCurve).toBe(before.profileCurve)
		expect(wire.pathBegin).toBeCloseTo(before.pathBegin, 5)
		expect(wire.pathEnd).toBeCloseTo(before.pathEnd, 5)
		expect(wire.profileBegin).toBeCloseTo(before.profileBegin, 5)
		expect(wire.profileEnd).toBeCloseTo(before.profileEnd, 5)
		expect(wire.profileHollow).toBeCloseTo(before.hollow, 5)
		expect(wire.pathTwist).toBeCloseTo(before.twist, 5)
		expect(wire.pathTwistBegin).toBeCloseTo(before.twistBegin, 5)
		expect(wire.pathScaleX).toBeCloseTo(before.scaleX, 5)
		expect(wire.pathScaleY).toBeCloseTo(before.scaleY, 5)
		expect(wire.pathShearX).toBeCloseTo(before.shearX, 5)
		expect(wire.pathShearY).toBeCloseTo(before.shearY, 5)
		expect(wire.pathTaperX).toBeCloseTo(before.taperX, 5)
		expect(wire.pathTaperY).toBeCloseTo(before.taperY, 5)
		expect(wire.pathRevolutions).toBeCloseTo(before.revolutions, 5)
		expect(wire.pathRadiusOffset).toBeCloseTo(before.radiusOffset, 5)
		expect(wire.pathSkew).toBeCloseTo(before.skew, 5)
	})
	it('torus: round trip holds through the hole-size (non-inverted) branch and ×360 twist undo', () => {
		const before = dequantShape(TORUS_SHAPE)
		const ui = displayParams(TORUS_SHAPE)
		const wire = uiToWireParams(TORUS_SHAPE, ui)
		expect(wire.pathScaleX).toBeCloseTo(before.scaleX, 5)
		expect(wire.pathScaleY).toBeCloseTo(before.scaleY, 5)
		expect(wire.pathTwist).toBeCloseTo(before.twist, 5)
		expect(wire.pathBegin).toBeCloseTo(before.pathBegin, 5)
		expect(wire.profileBegin).toBeCloseTo(before.profileBegin, 5)
	})
	it('clamps hollow to 0.95 max (primMesher.js:788 parity)', () => {
		const shape = { ...PRISM_SHAPE, profileHollow: 50000 }   // float 1.0 raw
		const ui = displayParams(shape)
		expect(ui.hollowPct).toBeCloseTo(100, 3)
		const wire = uiToWireParams(shape, ui)
		expect(wire.profileHollow).toBeCloseTo(0.95, 5)
	})
	it('enforces OBJECT_MIN_CUT_INC (0.02) between a cut pair', () => {
		const ui = { ...displayParams(PRISM_SHAPE), pathCutBegin: 0.999, pathCutEnd: 1.0 }
		const wire = uiToWireParams(PRISM_SHAPE, ui)
		expect(wire.profileBegin).toBeLessThanOrEqual(wire.profileEnd - 0.02 + 1e-9)
	})
	it('clamps hole size to its xui range (X 0.05..1, Y 0.05..0.5)', () => {
		const ui = { ...displayParams(TORUS_SHAPE), taperX: 5, taperY: -5 }
		const wire = uiToWireParams(TORUS_SHAPE, ui)
		expect(wire.pathScaleX).toBeCloseTo(1.0, 5)
		expect(wire.pathScaleY).toBeCloseTo(0.05, 5)
	})
})
