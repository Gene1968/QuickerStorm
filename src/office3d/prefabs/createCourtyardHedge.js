import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import hedgeUrl from "@/assets/3d/hedge.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null

function loadHedgeGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(hedgeUrl, (gltf) => {
				gltf.scene.traverse((c) => {
					if (!c.isMesh) return
					c.castShadow = true
					c.receiveShadow = true
				})
				_scene = gltf.scene
				resolve(gltf.scene)
			}, undefined, reject)
		})
	}
	return _promise
}

/**
 * Returns a Group immediately; hedge GLB inserted async once loaded.
 * GLB loaded once and cloned across all instances.
 * @returns {THREE.Group}
 */
export function createCourtyardHedge () {
	const g = new THREE.Group()
	loadHedgeGltf()
		.then((hedgeScene) => {
			const clone = hedgeScene.clone(true)
			clone.scale.setScalar(1.0)
			g.add(clone)
		})
		.catch((err) => console.warn("[createCourtyardHedge] load failed:", err))
	return g
}
