import { describe, it, expect } from 'bun:test'
import { skinSubmeshes } from '../lib/meshSkin'
import { jointRestWorld } from '../lib/avatarSkeleton'
import type { SkinInfo } from '../lib/meshDecode'

// World rest translation of a joint (last row of its world matrix) — bones are pure translation.
const restPos = (name: string) => { const m = jointRestWorld(name)!; return [m[12], m[13], m[14]] }

const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

// Build a one-submesh mesh with the given per-vertex influences (idx→weight).
function sub(positions: number[], influences: Array<Array<[number, number]>>) {
	const n = positions.length / 3
	const ji = new Uint8Array(n * 4), jw = new Float32Array(n * 4)
	influences.forEach((infl, v) => infl.slice(0, 4).forEach(([idx, w], i) => { ji[v * 4 + i] = idx; jw[v * 4 + i] = w }))
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(n * 3),
		uvs: new Float32Array(n * 2),
		indices: new Uint16Array([0, 0, 0]),
		jointIndices: ji, jointWeights: jw,
	}
}

describe('skinSubmeshes (rest-pose)', () => {
	it('100% weight to a joint places the vertex at that joint world pos + local offset (bind=invBind=I)', () => {
		const skin: SkinInfo = {
			jointNames: ['mChest'],
			bindShapeMatrix: IDENT.slice(),
			inverseBindMatrix: [IDENT.slice()],
			pelvisOffset: 0, lockScaleIfJointPosition: false,
		}
		const out = skinSubmeshes([sub([0.1, 0.2, 0.3], [[[0, 1.0]]])], skin)
		const [chx, chy, chz] = restPos('mChest')   // (-0.015, 0, 1.356)
		expect(out[0].positions[0]).toBeCloseTo(0.1 + chx, 4)
		expect(out[0].positions[1]).toBeCloseTo(0.2 + chy, 4)
		expect(out[0].positions[2]).toBeCloseTo(0.3 + chz, 4)
	})

	it('50/50 blend between two joints lands at the midpoint of their world positions', () => {
		const skin: SkinInfo = {
			jointNames: ['mHead', 'mPelvis'],
			bindShapeMatrix: IDENT.slice(),
			inverseBindMatrix: [IDENT.slice(), IDENT.slice()],
			pelvisOffset: 0, lockScaleIfJointPosition: false,
		}
		const out = skinSubmeshes([sub([0, 0, 0], [[[0, 0.5], [1, 0.5]]])], skin)
		const head = restPos('mHead'), pel = restPos('mPelvis')
		expect(out[0].positions[0]).toBeCloseTo((head[0] + pel[0]) / 2, 4)
		expect(out[0].positions[2]).toBeCloseTo((head[2] + pel[2]) / 2, 4)   // ~ (1.683+1.067)/2 = 1.375
	})

	it('bind_shape scale is applied before the joint transform', () => {
		// bind_shape = uniform 2× scale; vertex (0.1,0,0) → (0.2,0,0) then + joint world pos.
		const bind = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]
		const skin: SkinInfo = {
			jointNames: ['mPelvis'], bindShapeMatrix: bind,
			inverseBindMatrix: [IDENT.slice()], pelvisOffset: 0, lockScaleIfJointPosition: false,
		}
		const out = skinSubmeshes([sub([0.1, 0, 0], [[[0, 1.0]]])], skin)
		const pel = restPos('mPelvis')   // (0,0,1.067)
		expect(out[0].positions[0]).toBeCloseTo(0.2 + pel[0], 4)
		expect(out[0].positions[2]).toBeCloseTo(pel[2], 4)
	})
})
