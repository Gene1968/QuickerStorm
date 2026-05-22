import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import benchUrl from "@/assets/3d/bench.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null

function loadBenchGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(benchUrl, (gltf) => {
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
export function createCourtyardBench () {
	const g = new THREE.Group()
	loadBenchGltf()
		.then((benchScene) => {
			const clone = benchScene.clone(true)
			clone.scale.setScalar(0.6)
			g.add(clone)
		})
		.catch((err) => console.warn("[createCourtyardBench] load failed:", err))
	return g
}
