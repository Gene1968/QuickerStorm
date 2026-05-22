import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * @param {{ pot: THREE.Material; plant: THREE.Material; plantDouble: THREE.Material; lowEnd?: boolean }} mats
 * @returns {THREE.Group}
 */
export function createOfficeFern (mats) {
	const g = new THREE.Group()

	const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 8), mats.pot)
	pot.position.y = 0.2
	g.add(pot)

	if (mats.lowEnd) {
		// Low-end: crown sphere + 6 flat frond planes
		const crown = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 5), mats.plant)
		crown.scale.set(1, 0.7, 1)
		crown.position.y = 0.54
		g.add(crown)

		for (let i = 0; i < 6; i++) {
			const frondGeo = new THREE.PlaneGeometry(0.16, 0.62)
			frondGeo.translate(0, 0.31, 0)
			const frond = new THREE.Mesh(frondGeo, mats.plantDouble)
			frond.rotation.y = (i / 6) * Math.PI * 2
			frond.rotation.z = 0.44
			frond.position.y = 0.48
			g.add(frond)
		}
		return g
	}

	// Mid/std: 10 drooping fronds × (spine + 5 leaflet pairs), merged into one draw call
	const _t  = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z)
	const _ry = (a) => new THREE.Matrix4().makeRotationY(a)
	const _rz = (a) => new THREE.Matrix4().makeRotationZ(a)

	const N      = 10
	const FL     = 0.74
	const DROOP  = 0.54
	const BASE_Y = 0.44

	const frondGeos = []

	for (let i = 0; i < N; i++) {
		const ay = (i / N) * Math.PI * 2
		const frondM = _t(0, BASE_Y, 0).multiply(_ry(ay)).multiply(_rz(DROOP))

		const spineGeo = new THREE.PlaneGeometry(0.05, FL)
		spineGeo.translate(0, FL / 2, 0)
		spineGeo.applyMatrix4(frondM)
		frondGeos.push(spineGeo)

		for (let p = 0; p < 5; p++) {
			const t       = (p + 0.5) / 5
			const leafY   = t * FL * 0.86
			const leafLen = 0.155 * (1 - t * 0.52)
			const leafAng = 0.55 + t * 0.30

			for (const side of [-1, 1]) {
				const leafGeo = new THREE.PlaneGeometry(leafLen, 0.038)
				leafGeo.translate(side * leafLen / 2, 0, 0)
				const lm = frondM.clone()
					.multiply(_t(0, leafY, 0))
					.multiply(_rz(-side * leafAng))
				leafGeo.applyMatrix4(lm)
				frondGeos.push(leafGeo)
			}
		}
	}

	g.add(new THREE.Mesh(mergeGeometries(frondGeos), mats.plantDouble))
	return g
}
