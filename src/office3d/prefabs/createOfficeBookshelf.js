import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeBookshelf (mats) {
	const g = new THREE.Group()
	const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.8, 0.7), mats.desk)
	shelf.position.y = 0.9
	g.add(shelf)
	return g
}
