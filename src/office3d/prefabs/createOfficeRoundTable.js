import * as THREE from "three"
import { createOfficeMiniChair } from "@/office3d/prefabs/createOfficeMiniChair.js"

/**
 * @param {{ table: THREE.Material; desk: THREE.Material; chair: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeRoundTable (mats) {
	const g = new THREE.Group()
	const mini = () => createOfficeMiniChair({ chair: mats.chair })

	const top = new THREE.Mesh(
		new THREE.CylinderGeometry(0.9, 0.9, 0.07, 16),
		mats.table,
	)
	top.position.y = 0.75
	g.add(top)
	const pole = new THREE.Mesh(
		new THREE.CylinderGeometry(0.08, 0.08, 0.74, 8),
		mats.desk,
	)
	pole.position.y = 0.37
	g.add(pole)
	for (let i = 0; i < 4; i++) {
		const angle = (i / 4) * Math.PI * 2
		const c = mini()
		c.position.set(Math.sin(angle) * 1.25, 0, Math.cos(angle) * 1.25)
		c.rotation.y = angle + Math.PI
		g.add(c)
	}
	return g
}
