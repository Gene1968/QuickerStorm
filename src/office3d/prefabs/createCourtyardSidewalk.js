import * as THREE from "three"
import sidewalkTexUrl from "@/assets/img/sidewalk-w-edges-512.png?url"

const tex = new THREE.TextureLoader().load(sidewalkTexUrl)
tex.wrapS = tex.wrapT = THREE.RepeatWrapping
tex.colorSpace = THREE.SRGBColorSpace
tex.repeat.set(2, 16)

const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0 })

/**
 * Concrete sidewalk slab — 3 wide × 24 long × 0.05 tall.
 * @returns {THREE.Group}
 */
export function createCourtyardSidewalk () {
	const g = new THREE.Group()
	const slab = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.04, 23), mat)
	slab.position.y = 0.025
	slab.receiveShadow = true
	g.add(slab)
	return g
}
