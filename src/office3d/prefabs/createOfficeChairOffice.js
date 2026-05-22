import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material; chair: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeChairOffice (mats) {
	const g = new THREE.Group()
	const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), mats.chair)
	seat.position.y = 0.46
	g.add(seat)
	const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.65, 0.07), mats.chair)
	back.position.set(0, 0.85, -0.24)
	back.rotation.x = 0.1
	g.add(back)
	const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 5), mats.desk)
	base.position.y = 0.05
	g.add(base)
	const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8), mats.desk)
	pole.position.y = 0.27
	g.add(pole)
	return g
}
