import * as THREE from "three"

/**
 * Break-room style wall TV.
 * @param {{ projScreen: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeTV (mats) {
	const g = new THREE.Group()
	const bezelMat = new THREE.MeshStandardMaterial({
		color: 0x0d0d0d,
		roughness: 0.25,
		metalness: 0.65,
	})
	const mountMat = new THREE.MeshStandardMaterial({
		color: 0x181818,
		roughness: 0.5,
		metalness: 0.7,
	})
	const bezel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 0.08), bezelMat)
	bezel.position.set(0, 1.95, 0)
	g.add(bezel)
	const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.12, 0.04), mats.projScreen)
	tvScreen.position.set(0, 1.95, 0.03)
	g.add(tvScreen)
	const mount = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.07), mountMat)
	mount.position.set(0, 1.6, -0.04)
	g.add(mount)
	return g
}
