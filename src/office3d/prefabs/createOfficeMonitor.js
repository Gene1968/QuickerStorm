import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material; screen: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeMonitor (mats) {
	const g = new THREE.Group()
	const stand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.04), mats.desk)
	stand.position.y = 0.125
	g.add(stand)
	const screen = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.4, 0.04), mats.screen)
	screen.position.y = 0.45
	g.add(screen)
	return g
}
