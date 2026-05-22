import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import fountainUrl from "@/assets/3d/fountain.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null
let _waterTex = null

function loadFountainGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(fountainUrl, (gltf) => {
				gltf.scene.traverse((c) => {
					if (!c.isMesh) return
					c.castShadow = true
					c.receiveShadow = true
					// prim1 is the water mesh — grab its texture for animation
					if (c.material?.name === "Material4-material" && c.material?.map) {
						_waterTex = c.material.map
						_waterTex.wrapS = _waterTex.wrapT = THREE.RepeatWrapping
					}
				})
				_scene = gltf.scene
				resolve(gltf.scene)
			}, undefined, reject)
		})
	}
	return _promise
}

/**
 * Called every frame from the engine render loop.
 * Scrolls the water texture at 0.01 UV units/sec — matches original LSL SMOOTH LOOP rate.
 * No-op until GLB is loaded.
 * @param {number} delta - seconds since last frame
 */
export function tickFountainWater (delta) {
	if (!_waterTex) return
	_waterTex.offset.x += delta * 0.025
}

/**
 * @returns {THREE.Group}
 */
export function createCourtyardFountain () {
	const g = new THREE.Group()
	loadFountainGltf()
		.then((fountainScene) => {
			const clone = fountainScene.clone(true)
			clone.scale.setScalar(2.25)
			g.add(clone)
		})
		.catch((err) => console.warn("[createCourtyardFountain] load failed:", err))
	return g
}
