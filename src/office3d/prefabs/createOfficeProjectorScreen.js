import * as THREE from "three"

/**
 * @param {{ projScreen: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeProjectorScreen (mats) {
	const g = new THREE.Group()
	const screen = new THREE.Mesh(
		new THREE.BoxGeometry(4.984, 2.8, 0.05),
		mats.projScreen,
	)
	screen.position.set(0, 1.7, 0)
	g.add(screen)
	return g
}
