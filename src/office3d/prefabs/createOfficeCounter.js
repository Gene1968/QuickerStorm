import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeCounter (mats) {
	const g = new THREE.Group()
	const ctr = new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, 0.65), mats.desk)
	ctr.position.y = 0.45
	g.add(ctr)
	const top = new THREE.Mesh(new THREE.BoxGeometry(5, 0.06, 0.7), mats.desk)
	top.position.y = 0.93
	g.add(top)
	return g
}
