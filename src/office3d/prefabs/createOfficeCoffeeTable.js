import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeCoffeeTable (mats) {
	const g = new THREE.Group()
	const M = mats.desk

	const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.5), M)
	top.position.y = 0.38
	g.add(top)

	const legs = [
		[-0.33, -0.2],
		[0.33, -0.2],
		[-0.33, 0.2],
		[0.33, 0.2],
	]
	for (const [lx, lz] of legs) {
		const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6), M)
		leg.position.set(lx, 0.19, lz)
		g.add(leg)
	}

	return g
}
