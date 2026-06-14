// src/__tests__/lib/geomParts.test.js
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { splitParts } from '@/lib/geomParts.js'

// Build an indexed geometry: 2 quads (8 verts, 12 indices), two material groups.
function twoGroupGeom() {
	const g = new THREE.BufferGeometry()
	const pos = []
	for (let q = 0; q < 2; q++) {
		const z = q
		pos.push(0,0,z, 1,0,z, 1,1,z, 0,1,z)
	}
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(16).fill(0), 2))
	// quad 0 → verts 0..3, quad 1 → verts 4..7
	g.setIndex([0,1,2, 0,2,3,  4,5,6, 4,6,7])
	g.addGroup(0, 6, 0)   // first quad → materialIndex 0
	g.addGroup(6, 6, 7)   // second quad → materialIndex 7 (SL face index, non-contiguous)
	return g
}

describe('splitParts', () => {
	it('returns one part for single-group geometry', () => {
		// BoxGeometry in three r183 carries 6 groups (one per face) — use a plain
		// BufferGeometry with no groups as the true "single-material" proxy.
		const g = new THREE.BufferGeometry()
		g.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3))
		g.setIndex([0, 1, 2])
		const parts = splitParts(g)
		expect(parts).toHaveLength(1)
		expect(parts[0].materialIndex).toBe(0)
		expect(parts[0].geometry).toBe(g)   // passthrough, not copied
	})

	it('splits multi-group geometry into one compacted part per materialIndex', () => {
		const parts = splitParts(twoGroupGeom())
		expect(parts).toHaveLength(2)
		expect(parts.map(p => p.materialIndex).sort((a, b) => a - b)).toEqual([0, 7])
		for (const p of parts) {
			// each part = one quad = 4 compacted verts, 6 indices
			expect(p.geometry.getAttribute('position').count).toBe(4)
			expect(p.geometry.getIndex().count).toBe(6)
			expect(p.geometry.getAttribute('uv')).toBeTruthy()
		}
	})
})
