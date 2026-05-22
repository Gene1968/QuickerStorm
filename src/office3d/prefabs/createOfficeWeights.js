import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeWeights (mats) {
	const g = new THREE.Group()
	const rack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 0.5), mats.desk)
	rack.position.y = 0.7
	g.add(rack)
	return g
}
