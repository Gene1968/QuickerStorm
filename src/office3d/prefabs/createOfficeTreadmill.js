import * as THREE from "three"

/**
 * @param {{ treadmill: THREE.Material; desk: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeTreadmill (mats) {
	const g = new THREE.Group()
	const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 2), mats.treadmill)
	frame.position.y = 0.11
	g.add(frame)
	const handles = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.06), mats.desk)
	handles.position.set(0, 0.67, -0.5)
	g.add(handles)
	return g
}
