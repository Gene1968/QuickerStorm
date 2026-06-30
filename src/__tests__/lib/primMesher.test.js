// Tests for the PrimMesher port (src/lib/primMesher.js). Ported from OpenSim's
// PrimMesher.cs + Meshmerizer.cs (GenerateCoordsAndFacesFromPrimShapeData). Assertions are
// geometric/structural invariants (no compiled C# golden available), each chosen to fail on
// the old stub geometry and to pin the faithful behaviour: SL-space output spans ±0.5, SL face
// counts match the viewer (box 6, cylinder 3, prism 5), hollow/cut/twist/taper change the mesh.
import { describe, it, expect } from 'vitest'
import { buildPrimMeshArrays } from '@/lib/primMesher.js'

// Raw-byte shape fields exactly as server/lib/lludp-codec.ts decodes them (no pre-scaling).
// Defaults = a clean solid prim: neutral taper (pathScale 100), full path/profile, no hollow.
function shape(over = {}) {
	return {
		pathCurve: 16, profileCurve: 1,
		pathBegin: 0, pathEnd: 0,
		pathScaleX: 100, pathScaleY: 100,
		pathShearX: 0, pathShearY: 0,
		pathTwist: 0, pathTwistBegin: 0,
		pathRadiusOffset: 0, pathTaperX: 0, pathTaperY: 0,
		pathRevolutions: 0, pathSkew: 0,
		profileBegin: 0, profileEnd: 0, profileHollow: 0,
		...over,
	}
}

const BOX = shape()                                       // square profile, linear path
const CYL = shape({ profileCurve: 0 })                    // circle profile, linear path
const PRISM = shape({ profileCurve: 3 })                  // equilateral-triangle profile
const SPHERE = shape({ pathCurve: 32, profileCurve: 5 })  // half-circle profile, circular path
const TORUS = shape({ pathCurve: 32, profileCurve: 0 })   // circle profile, circular path

function bbox(arr) {
	const min = [Infinity, Infinity, Infinity]
	const max = [-Infinity, -Infinity, -Infinity]
	for (let i = 0; i < arr.positions.length; i += 3) {
		for (let a = 0; a < 3; a++) {
			const v = arr.positions[i + a]
			if (v < min[a]) min[a] = v
			if (v > max[a]) max[a] = v
		}
	}
	return { min, max }
}

function allFinite(arr) {
	for (const v of arr.positions) if (!Number.isFinite(v)) return false
	for (const v of arr.normals) if (!Number.isFinite(v)) return false
	for (const v of arr.uvs) if (!Number.isFinite(v)) return false
	return true
}

// Distinct face numbers among triangles with non-negligible area (the closing seam of a
// square/circle profile leaves a zero-area triangle whose face number must not be counted).
function realFaceNumbers(arr) {
	const s = new Set()
	for (let t = 0; t < arr.faceNumbers.length; t++) {
		const o = t * 9
		const ax = arr.positions[o + 3] - arr.positions[o], ay = arr.positions[o + 4] - arr.positions[o + 1], az = arr.positions[o + 5] - arr.positions[o + 2]
		const bx = arr.positions[o + 6] - arr.positions[o], by = arr.positions[o + 7] - arr.positions[o + 1], bz = arr.positions[o + 8] - arr.positions[o + 2]
		const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
		if (Math.hypot(cx, cy, cz) > 1e-6) s.add(arr.faceNumbers[t])
	}
	return [...s].sort((a, b) => a - b)
}

describe('buildPrimMeshArrays — output shape', () => {
	it('returns parallel position/normal/uv/faceNumber arrays (3 verts, 9 floats per triangle)', () => {
		const a = buildPrimMeshArrays(BOX)
		expect(a.positions.length % 9).toBe(0)
		expect(a.normals.length).toBe(a.positions.length)
		expect(a.uvs.length).toBe((a.positions.length / 3) * 2)
		expect(a.faceNumbers.length).toBe(a.positions.length / 9)
		expect(a.faceNumbers.length).toBeGreaterThan(0)
	})

	it('produces only finite coordinates for every primitive type', () => {
		for (const s of [BOX, CYL, PRISM, SPHERE, TORUS]) expect(allFinite(buildPrimMeshArrays(s))).toBe(true)
	})
})

describe('buildPrimMeshArrays — SL face counts (viewer-faithful)', () => {
	it('clean box has 6 distinct faces (one per side)', () => {
		// PrimMesher's internal face numbering is not 0..5 contiguous (a zero-area closing seam
		// consumes one number); the geometric invariant is six real faces. SL TE remap is done at
		// integration. Top face is always number 0.
		const faces = realFaceNumbers(buildPrimMeshArrays(BOX))
		expect(faces.length).toBe(6)
		expect(faces).toContain(0)
	})

	it('clean cylinder has 3 faces (side, top, bottom)', () => {
		expect(realFaceNumbers(buildPrimMeshArrays(CYL)).length).toBe(3)
	})

	it('clean prism has 5 faces', () => {
		expect(realFaceNumbers(buildPrimMeshArrays(PRISM)).length).toBe(5)
	})

	it('hollow adds an interior face beyond the solid box face set', () => {
		const solid = realFaceNumbers(buildPrimMeshArrays(BOX)).length
		const hollow = realFaceNumbers(buildPrimMeshArrays(shape({ profileHollow: 25000 }))).length
		expect(hollow).toBeGreaterThan(solid)
	})

	it('profile cut adds cut faces beyond the solid box face set', () => {
		const solid = realFaceNumbers(buildPrimMeshArrays(BOX)).length
		const cut = realFaceNumbers(buildPrimMeshArrays(shape({ profileBegin: 5000 }))).length
		expect(cut).toBeGreaterThan(solid)
	})
})

describe('buildPrimMeshArrays — geometry extents', () => {
	it('a unit box spans ±0.5 on every axis', () => {
		const { min, max } = bbox(buildPrimMeshArrays(BOX))
		for (let a = 0; a < 3; a++) {
			expect(min[a]).toBeCloseTo(-0.5, 1)
			expect(max[a]).toBeCloseTo(0.5, 1)
		}
	})

	it('a sphere is round — extent ≈ 1.0 on all three axes', () => {
		const { min, max } = bbox(buildPrimMeshArrays(SPHERE))
		for (let a = 0; a < 3; a++) expect(max[a] - min[a]).toBeGreaterThan(0.8)
		expect(max[0] - min[0]).toBeCloseTo(max[2] - min[2], 1)
	})
})

describe('buildPrimMeshArrays — deformations change the mesh', () => {
	it('hollow box has more triangles than a solid box', () => {
		expect(buildPrimMeshArrays(shape({ profileHollow: 25000 })).faceNumbers.length)
			.toBeGreaterThan(buildPrimMeshArrays(BOX).faceNumbers.length)
	})

	it('twist moves vertices off the un-twisted positions', () => {
		const plain = buildPrimMeshArrays(BOX)
		const twisted = buildPrimMeshArrays(shape({ pathTwist: 80 }))
		let moved = false
		const n = Math.min(plain.positions.length, twisted.positions.length)
		for (let i = 0; i < n; i++) if (Math.abs(plain.positions[i] - twisted.positions[i]) > 0.05) { moved = true; break }
		expect(moved).toBe(true)
	})

	it('taper narrows the top relative to the bottom', () => {
		// For a LINEAR path, taper is driven by pathScaleX (taperX = (PathScaleX-100)*0.01);
		// pathScaleX 190 → +0.9 taper → the +Z (top) layer is narrower in X than the -Z (bottom).
		const a = buildPrimMeshArrays(shape({ pathScaleX: 190 }))
		let topMaxX = 0, botMaxX = 0
		for (let i = 0; i < a.positions.length; i += 3) {
			const x = Math.abs(a.positions[i]), z = a.positions[i + 2]
			if (z > 0.3) topMaxX = Math.max(topMaxX, x)
			if (z < -0.3) botMaxX = Math.max(botMaxX, x)
		}
		expect(topMaxX).toBeLessThan(botMaxX)
	})
})

describe('buildPrimMeshArrays — cap UVs (FS LLVolume parity)', () => {
	// FS createCap / createUnCutCubeCap (indra/llmath/llvolume.cpp): the two caps of a linear
	// prim are V-mirrors of each other — TOP cap uses v = y+0.5, BOTTOM cap uses v = 0.5-y
	// ("Mirror for underside"). PrimMesher.cs flips BOTH u and v on both caps, which leaves the
	// top cap V-flipped (upside-down texture) relative to the viewer. Pin FS parity here.
	function capVertices(arr, topward) {
		// Collect (y, uv.v) for every vertex on the +Z (top) or -Z (bottom) cap of a unit box.
		const out = []
		for (let t = 0; t < arr.faceNumbers.length; t++) {
			const po = t * 9, uo = t * 6
			const zs = [arr.positions[po + 2], arr.positions[po + 5], arr.positions[po + 8]]
			const onCap = topward ? zs.every((z) => z > 0.45) : zs.every((z) => z < -0.45)
			if (!onCap) continue
			for (let v = 0; v < 3; v++) {
				out.push({ y: arr.positions[po + v * 3 + 1], uvV: arr.uvs[uo + v * 2 + 1] })
			}
		}
		return out
	}

	it('top cap maps v = y + 0.5 (matches FS, not upside-down)', () => {
		const top = capVertices(buildPrimMeshArrays(BOX), true)
		expect(top.length).toBeGreaterThan(0)
		for (const { y, uvV } of top) expect(uvV).toBeCloseTo(y + 0.5, 4)
	})

	it('bottom cap maps v = 0.5 - y (FS "mirror for underside")', () => {
		const bot = capVertices(buildPrimMeshArrays(BOX), false)
		expect(bot.length).toBeGreaterThan(0)
		for (const { y, uvV } of bot) expect(uvV).toBeCloseTo(0.5 - y, 4)
	})
})

describe('buildPrimMeshArrays — side UVs (FS LLVolume parity)', () => {
	// FS LLPath (linear/circle) sets mTexT = t and createSide uses it directly as the side V, so
	// side V runs WITH the path: 0 at the bottom (z=-0.5), 1 at the top (z=+0.5). PrimMesher.cs used
	// 1-percentOfPath, rendering side textures upside-down. Pin FS parity: V tracks Z height.
	it('box side V increases with Z (0 at bottom, 1 at top — not inverted)', () => {
		const a = buildPrimMeshArrays(BOX)
		// A side triangle spans Z (vertices at both z≈-0.5 and z≈+0.5); a cap triangle does not.
		// Within a side triangle, the bottom vertex must map V≈0 and the top vertex V≈1 (FS parity).
		let checked = 0
		for (let t = 0; t < a.faceNumbers.length; t++) {
			const po = t * 9, uo = t * 6
			const zs = [a.positions[po + 2], a.positions[po + 5], a.positions[po + 8]]
			if (Math.min(...zs) > -0.49 || Math.max(...zs) < 0.49) continue   // not a Z-spanning side tri
			for (let v = 0; v < 3; v++) {
				const z = a.positions[po + v * 3 + 2]
				const uvV = a.uvs[uo + v * 2 + 1]
				if (z < -0.49) { expect(uvV).toBeCloseTo(0, 2); checked++ }
				else if (z > 0.49) { expect(uvV).toBeCloseTo(1, 2); checked++ }
			}
		}
		expect(checked).toBeGreaterThan(0)
	})
})

describe('buildPrimMeshArrays — robustness', () => {
	it('does not throw on an empty shape and still returns finite geometry', () => {
		const a = buildPrimMeshArrays({})
		expect(a.faceNumbers.length).toBeGreaterThan(0)
		expect(allFinite(a)).toBe(true)
	})
})
