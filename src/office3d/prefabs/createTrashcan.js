import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import trashcanUrl from "@/assets/3d/trashcan.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null

function loadTrashcanGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(trashcanUrl, (gltf) => {
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
 * @returns {THREE.Group}
 */
export function createTrashcan () {
	const g = new THREE.Group()
	loadTrashcanGltf()
		.then((scene) => {
			const clone = scene.clone(true)
			clone.scale.setScalar(1.5)
			g.add(clone)
		})
		.catch((err) => console.warn("[createTrashcan] load failed:", err))
	return g
}
