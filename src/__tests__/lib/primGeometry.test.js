import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
	buildPrimGeometry, bakePrimScale, geometryHasFiniteVerts,
	extractGeomArrays, geometryFromArrays, bakeJob,
} from '@/lib/primGeometry.js'

describe('primGeometry', () => {
	it('builds finite box geometry for a default shape', () => {
		const g = bakePrimScale(buildPrimGeometry({ pathCurve: 16, profileCurve: 1 }), [2, 3, 4])
		expect(geometryHasFiniteVerts(g)).toBe(true)
		// bakePrimScale maps Three (x=sx, y=sz, z=sy): scale [2,3,4] → geom.scale(2,4,3)
		g.computeBoundingBox()
		const size = new THREE.Vector3()
		g.boundingBox.getSize(size)
		expect(size.x).toBeCloseTo(2, 5)
		expect(size.y).toBeCloseTo(4, 5)
		expect(size.z).toBeCloseTo(3, 5)
	})

	it('extract → geometryFromArrays roundtrips position/index/groups', () => {
		const subs = [{
			positions: [0,0,0, 1,0,0, 0,1,0],
			normals:   [0,0,1, 0,0,1, 0,0,1],
			uvs:       [0,0, 1,0, 0,1],
			indices:   [0,1,2],
		}]
		const arrays = bakeJob({ kind: 'submesh', subs, scale: [1,1,1] })
		const g = geometryFromArrays(arrays)
		expect(g.attributes.position.count).toBe(3)
		expect(Array.from(g.index.array)).toEqual([0,1,2])
		expect(g.groups.length).toBe(1)
		expect(g.groups[0]).toMatchObject({ start: 0, count: 3, materialIndex: 0 })
	})

	it('bakeJob flags non-finite geometry as bad instead of returning arrays', () => {
		const subs = [{ positions: [NaN,0,0, 1,0,0, 0,1,0], normals:[0,0,1,0,0,1,0,0,1], uvs:[0,0,1,0,0,1], indices:[0,1,2] }]
		expect(bakeJob({ kind: 'submesh', subs, scale: [1,1,1] })).toEqual({ bad: true })
	})

	it('swapSubmeshesToGeometry applies the SL→Three axis swap (y←SLz, z←−SLy)', () => {
		const subs = [{ positions: [0,1,0], normals: [0,0,1], uvs: [0,0], indices: [0] }]
		const g = geometryFromArrays(bakeJob({ kind: 'submesh', subs, scale: [1,1,1] }))
		const p = g.attributes.position
		expect(p.getX(0)).toBeCloseTo(0, 6)
		expect(p.getY(0)).toBeCloseTo(0, 6)   // y ← SL z (0)
		expect(p.getZ(0)).toBeCloseTo(-1, 6)  // z ← −SL y (−1)
	})

	it('bakeJob bakes the prim path to finite arrays', () => {
		const out = bakeJob({ kind: 'prim', shape: { pathCurve: 16, profileCurve: 1 }, scale: [1,1,1] })
		expect(out.bad).toBeUndefined()
		expect(out.position).toBeInstanceOf(Float32Array)
		expect(out.position.length).toBeGreaterThan(0)
	})
})
