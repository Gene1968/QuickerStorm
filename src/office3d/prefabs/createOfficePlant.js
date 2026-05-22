import * as THREE from 'three'

/**
 * @param {{ pot: THREE.Material; plant: THREE.Material; lowEnd?: boolean }} mats
 * @returns {THREE.Group}
 */
export function createOfficePlant (mats) {
	const g = new THREE.Group()

	if (mats.lowEnd) {
		// Low-end: single sphere
		const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.35, 8), mats.pot)
		pot.position.y = 0.175
		g.add(pot)

		const plant = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), mats.plant)
		plant.scale.set(1, 1.3, 1)
		plant.position.y = 0.72
		g.add(plant)
		return g
	}

	// Mid/std: bigger pot, bushy multi-lobe foliage
	const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.40, 8), mats.pot)
	pot.position.y = 0.20
	g.add(pot)

	const lobes = [
		// [x, y, z, rx, ry, rz, sx, sy, sz]
		[ 0.00, 0.92, 0.00,  1.00, 1.20, 1.00],  // main crown
		[ 0.24, 0.82, 0.08,  0.90, 1.00, 0.90],  // right
		[-0.22, 0.80,-0.06,  0.88, 1.00, 0.88],  // left
		[ 0.06, 0.78, 0.24,  0.82, 0.95, 0.82],  // front
		[-0.08, 0.76,-0.22,  0.80, 0.92, 0.80],  // back
		[ 0.00, 1.14, 0.00,  0.68, 0.78, 0.68],  // top tuft
		[ 0.16, 1.04,-0.14,  0.60, 0.70, 0.60],  // upper side
	]

	for (const [x, y, z, sx, sy, sz] of lobes) {
		const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.36, 9, 7), mats.plant)
		lobe.position.set(x, y, z)
		lobe.scale.set(sx, sy, sz)
		g.add(lobe)
	}

	return g
}
