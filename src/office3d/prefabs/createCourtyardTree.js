import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import jacarandaUrl from "@/assets/3d/tree-jacaranda.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null

function loadJacarandaGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(jacarandaUrl, (gltf) => {
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
 * Returns a Group immediately; the jacaranda GLB is inserted async once loaded.
 * GLB is loaded once and shared (cloned) across all instances.
 * @returns {THREE.Group}
 */
export function createCourtyardTree () {
	const g = new THREE.Group()
	loadJacarandaGltf()
		.then((treeScene) => {
			const clone = treeScene.clone(true)
			clone.scale.setScalar(0.5)
			g.add(clone)
		})
		.catch((err) => console.warn("[createCourtyardTree] load failed:", err))
	return g
}
