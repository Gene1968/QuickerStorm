import * as THREE from "three"

/**
 * @param {{ sofa: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeSofa (mats) {
	const g = new THREE.Group()
	const sofa = mats.sofa

	const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 0.86), sofa)
	base.position.y = 0.14
	g.add(base)

	for (let i = 0; i < 3; i++) {
		const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.09, 0.50), sofa)
		cushion.position.set((i - 1) * 0.77, 0.325, 0.10)
		g.add(cushion)
	}

	const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.46, 0.20), sofa)
	back.position.set(0, 0.51, -0.33)
	g.add(back)

	const topRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 2.4, 16), sofa)
	topRoll.rotation.z = Math.PI / 2
	topRoll.position.set(0, 0.74, -0.33)
	g.add(topRoll)

	return g
}
