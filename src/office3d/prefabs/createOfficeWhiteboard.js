import * as THREE from "three"

/**
 * @param {{ whiteboard: THREE.Material; desk: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeWhiteboard (mats) {
	const g = new THREE.Group()
	const board = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 0.05), mats.whiteboard)
	board.position.set(0, 1.5, 0)
	g.add(board)
	const tray = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.12), mats.desk)
	tray.position.set(0, 0.94, 0.05)
	g.add(tray)
	return g
}
