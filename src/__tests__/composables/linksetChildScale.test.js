import { describe, it, expect } from 'vitest'
import * as THREE from 'three'

// Regression for the "rotated linkset child stretches ~half a region on one axis" bug.
//
// In SL a linked child's SIZE is independent of its parent — scale is NOT inherited. Our viewer
// rendered children as Three.js children of the parent's geometry mesh, which DOES inherit scale.
// The old fix divided the child's scale by the parent's scale per-axis. That cancels parent scale
// ONLY when the child is not rotated relative to the parent: the world matrix is
// `parentT · parentR · parentS · childT · childR · childS`, and a non-uniform `parentS` does not
// commute with a non-identity `childR`, so the divided axis lands on the wrong world axis and the
// child is sheared/stretched.
//
// Correct fix: bake each prim's scale into its GEOMETRY and keep every mesh's node scale at
// (1,1,1). Then children inherit an identity scale and the parent's scale never enters the chain.

// Intended absolute size of the child box, in Three.js axes.
const CHILD_SIZE = [0.965, 0.071, 0.414]   // note Y tiny — the axis that blew up in the field report
// A heavily non-uniform parent (a thin panel) — this is what makes the shear visible.
const PARENT_SCALE = [12, 1, 0.08]
// Heavily rotated child (field example was R-103 P90 Y103).
const CHILD_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.8, 1.57, 1.8))
const PARENT_QUAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.7, -0.4))

function worldSize(object3d) {
	let root = object3d
	while (root.parent) root = root.parent   // update from the topmost ancestor so parent
	root.updateMatrixWorld(true)             // transforms propagate into the child's matrixWorld
	const box = new THREE.Box3().setFromObject(object3d)
	const v = new THREE.Vector3()
	box.getSize(v)
	return [v.x, v.y, v.z]
}

// Ground truth: the child is an independent box of CHILD_SIZE, oriented by parentRot * childRot.
function referenceSize() {
	const geo = new THREE.BoxGeometry(...CHILD_SIZE)
	const mesh = new THREE.Mesh(geo)
	mesh.quaternion.copy(PARENT_QUAT.clone().multiply(CHILD_QUAT))
	return worldSize(mesh)
}

describe('linkset child scale under a rotated, non-uniform parent', () => {
	it('OLD approach (parent node scaled, child scale divided) shears the child — wrong size', () => {
		const parent = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
		parent.quaternion.copy(PARENT_QUAT)
		parent.scale.set(...PARENT_SCALE)

		const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
		child.quaternion.copy(CHILD_QUAT)
		child.scale.set(
			CHILD_SIZE[0] / PARENT_SCALE[0],
			CHILD_SIZE[1] / PARENT_SCALE[1],
			CHILD_SIZE[2] / PARENT_SCALE[2],
		)
		parent.add(child)

		const ref = referenceSize()
		const got = worldSize(child)
		// At least one axis is off by a large factor (the "extends half the region" symptom).
		const maxRatio = Math.max(...got.map((g, i) => Math.max(g / ref[i], ref[i] / g)))
		expect(maxRatio).toBeGreaterThan(3)
	})

	it('NEW approach (scale baked into geometry, node scale = 1) renders the correct size', () => {
		// Parent: scale baked into geometry, node scale stays 1.
		const parent = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).scale(...PARENT_SCALE))
		parent.quaternion.copy(PARENT_QUAT)

		// Child: its own scale baked into geometry, node scale stays 1.
		const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).scale(...CHILD_SIZE))
		child.quaternion.copy(CHILD_QUAT)
		parent.add(child)

		const ref = referenceSize()
		const got = worldSize(child)
		got.forEach((g, i) => expect(g).toBeCloseTo(ref[i], 4))
	})
})
