import * as THREE from "three"

/**
 * @param {{ floorRubber: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeMat (mats) {
	const g = new THREE.Group()
	const mat = new THREE.Mesh(
		new THREE.BoxGeometry(1.8, 0.04, 0.9),
		mats.floorRubber,
	)
	mat.position.y = 0.02
	g.add(mat)
	return g
}
