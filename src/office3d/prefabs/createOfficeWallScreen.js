import * as THREE from "three"

/**
 * Personal office calendar bezel + screen (mesh tagged in engine for canvas swap).
 * @param {{ projScreen: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeWallScreen (mats) {
	const g = new THREE.Group()
	const owsBezelMat = new THREE.MeshStandardMaterial({
		color: 0x0d0d0d,
		roughness: 0.3,
		metalness: 0.6,
	})
	const owsBezel = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.02, 0.04), owsBezelMat)
	owsBezel.position.set(0, 1.5, 0)
	g.add(owsBezel)
	const owsScreen = new THREE.Mesh(
		new THREE.BoxGeometry(1.6, 0.9, 0.025),
		mats.projScreen,
	)
	owsScreen.position.set(0, 1.5, 0.02)
	g.add(owsScreen)
	return g
}
