import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import vectorRobotUrl from "@/assets/3d/vector-robot.glb?url"

const loader = new GLTFLoader()
let _scene = null
let _promise = null
const _robots = [] // all live robot groups; ticked each frame

function loadVectorRobotGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(vectorRobotUrl, (gltf) => {
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
 * Spin any THREE.Object3D around the Y axis (XZ plane rotation).
 * @param {THREE.Object3D} obj
 * @param {number} delta - seconds since last frame
 * @param {number} [speed=0.4] - radians per second
 */
export function spinY (obj, delta, speed = 0.4) {
	obj.rotation.y -= delta * speed
}

/**
 * Called every frame from the engine render loop.
 * Rotates all live vector-robot groups around Y at 0.4 rad/s.
 * @param {number} delta - seconds since last frame
 */
export function tickVectorRobots (delta) {
	for (const g of _robots) spinY(g, delta)
}

export function createVectorRobot () {
	const g = new THREE.Group()
	loadVectorRobotGltf()
		.then((scene) => {
			const clone = scene.clone(true)
			clone.scale.setScalar(0.5)
			g.add(clone)
		})
		.catch((err) => console.warn("[createVectorRobot] load failed:", err))
	_robots.push(g)
	return g
}
