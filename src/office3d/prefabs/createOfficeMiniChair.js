import * as THREE from "three"

/**
 * Small decorative chair for round / conference tables.
 * @param {{ chair: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeMiniChair (mats) {
	const g = new THREE.Group()
	const seat = new THREE.Mesh(
		new THREE.BoxGeometry(0.44, 0.06, 0.44),
		mats.chair,
	)
	seat.position.y = 0.45
	g.add(seat)
	const back = new THREE.Mesh(
		new THREE.BoxGeometry(0.44, 0.4, 0.055),
		mats.chair,
	)
	back.position.set(0, 0.72, -0.19)
	g.add(back)
	return g
}
