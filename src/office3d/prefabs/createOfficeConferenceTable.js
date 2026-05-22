import * as THREE from "three"
import { createOfficeMiniChair } from "@/office3d/prefabs/createOfficeMiniChair.js"

/**
 * @param {{ table: THREE.Material; desk: THREE.Material; chair: THREE.Material }} mats
 * @returns {THREE.Group}
 */
export function createOfficeConferenceTable (mats) {
	const g = new THREE.Group()
	const mini = () => createOfficeMiniChair({ chair: mats.chair })

	const top = new THREE.Mesh(
		new THREE.BoxGeometry(10.5, 0.08, 2.4),
		mats.table,
	)
	top.position.y = 0.76
	g.add(top)
	for (const bx of [-2.5, 2.5]) {
		const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 1.8), mats.desk)
		base.position.set(bx, 0.35, 0)
		g.add(base)
	}
	const chairDefs = [
		[-4.2, -1.5, 0], [-3.0, -1.5, 0], [-1.8, -1.5, 0], [-0.6, -1.5, 0],
		[0.6, -1.5, 0], [1.8, -1.5, 0], [3.0, -1.5, 0], [4.2, -1.5, 0],
		[-4.2, 1.5, Math.PI], [-3.0, 1.5, Math.PI], [-1.8, 1.5, Math.PI], [-0.6, 1.5, Math.PI],
		[0.6, 1.5, Math.PI], [1.8, 1.5, Math.PI], [3.0, 1.5, Math.PI], [4.2, 1.5, Math.PI],
		[-5.5, -0.6, Math.PI / 2], [-5.5, 0.6, Math.PI / 2],
		[5.5, -0.6, -Math.PI / 2], [5.5, 0.6, -Math.PI / 2],
	]
	for (const [cx, cz, ry] of chairDefs) {
		const c = mini()
		c.position.set(cx, 0, cz)
		c.rotation.y = ry
		g.add(c)
	}
	return g
}
