import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import solarPanelUrl from "@/assets/3d/solarpanel.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null

function loadSolarPanelGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(solarPanelUrl, (gltf) => {
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
 * Returns a Group immediately; solar panel GLB inserted async once loaded.
 * Native Y offset (~3.576 units at scale 100) compensated so bottom sits at y=0.
 * @returns {THREE.Group}
 */
export function createSolarPanel () {
	const g = new THREE.Group()
	loadSolarPanelGltf()
		.then((panelScene) => {
			const clone = panelScene.clone(true)
			clone.position.y = -3.585
			g.add(clone)
		})
		.catch((err) => console.warn("[createSolarPanel] load failed:", err))
	return g
}
