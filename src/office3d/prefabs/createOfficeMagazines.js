import * as THREE from "three"

/**
 * Two stacked decorative magazines (fixed palette).
 * @returns {THREE.Group}
 */
export function createOfficeMagazines () {
	const g = new THREE.Group()
	const covers = [
		{ color: 0x0d2240, ry: -0.18, y: 0.006 },
		{ color: 0x1a4a3a, ry: 0.12, y: 0.018 },
	]
	for (const { color, ry, y } of covers) {
		const mag = new THREE.Mesh(
			new THREE.BoxGeometry(0.22, 0.012, 0.30),
			new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 }),
		)
		mag.position.y = y
		mag.rotation.y = ry
		const edge = new THREE.Mesh(
			new THREE.BoxGeometry(0.005, 0.012, 0.30),
			new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.8 }),
		)
		edge.position.set(0.1075, y, 0)
		g.add(edge)
		g.add(mag)
	}
	return g
}
