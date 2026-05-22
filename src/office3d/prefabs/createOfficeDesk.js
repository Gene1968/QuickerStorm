import * as THREE from "three"

/**
 * @param {{ desk: THREE.Material; accent: THREE.Material }} mats
 * @param {{ reception?: boolean }} [options] — reception desk is wider with accent front panel
 * @returns {THREE.Group}
 */
export function createOfficeDesk (mats, options = {}) {
	const reception = options.reception === true
	const g = new THREE.Group()
	const dw = reception ? 4.5 : 1.8
	const dd = reception ? 0.8 : 0.85

	const top = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.06, dd), mats.desk)
	top.position.y = 0.75
	g.add(top)

	const body = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.74, dd - 0.05), mats.desk)
	body.position.y = 0.37
	g.add(body)

	if (reception) {
		const front = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.55, 0.06), mats.accent)
		front.position.set(0, 0.28, dd / 2 + 0.03)
		g.add(front)
	}

	return g
}
