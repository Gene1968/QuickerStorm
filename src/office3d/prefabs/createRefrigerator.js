import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { createHingeDoor } from "@/office3d/utils/createHingeDoor.js"
import refrigeratorUrl from "@/assets/3d/refrigerator.glb?url"
import fridgeOpenUrl from "@/assets/audio/fridge-open.mp3?url"
import fridgeCloseUrl from "@/assets/audio/fridge-close.mp3?url"

function _localPlayOpen ()  { try { new Audio(fridgeOpenUrl).play()  } catch {} }
function _localPlayClose () { try { const a = new Audio(fridgeCloseUrl); a.volume = 0.3; a.play() } catch {} }

const loader = new GLTFLoader()
let _scene = null
let _promise = null

function loadRefrigeratorGltf () {
	if (_scene) return Promise.resolve(_scene)
	if (!_promise) {
		_promise = new Promise((resolve, reject) => {
			loader.load(refrigeratorUrl, (gltf) => {
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
 * @param {Function} [onReady] Called with [{mesh, door}] after GLB loads and doors are wired.
 * @param {{ onOpen?: Function, onClose?: Function }} [sounds] Override sound callbacks (e.g. to broadcast via playSoundForRoom).
 * @returns {THREE.Group}
 */
export function createRefrigerator (onReady, { onOpen = _localPlayOpen, onClose = _localPlayClose } = {}) {
	const g = new THREE.Group()
	loadRefrigeratorGltf()
		.then((scene) => {
			const clone = scene.clone(true)
			clone.scale.setScalar(1.0)
			g.add(clone)

			// LSL HINGE_POSITION <x,y,z> → Three.js {x, y:z, z:-y}
			// prim0 (right door):        LSL <0,-0.37,0> → {z: 0.37}, swings +120°
			// prim1 (left door): LSL <0, 0.34,0> → {z: 0.34}, swings -120°

			const prim0 = clone.getObjectByName("prim0")
			const prim1 = clone.getObjectByName("prim1")
			const doorMeshes = []

			if (prim0) {
				const door = createHingeDoor(prim0, {
					hingeOffset: { z: -0.37 },
					openAngle: Math.PI * 120 / 180,
					axis: "y",
					duration: 0.8,
					autoClose: 15,
					onOpen,
					onClose: () => onClose('right'),
				})
				g.userData.doorRight = door
				door.pivot.traverse((c) => {
					if (c.isMesh) doorMeshes.push({ mesh: c, door, side: 'right' })
				})
			} else {
				console.warn("[createRefrigerator] prim0 not found")
			}

			if (prim1) {
				const door = createHingeDoor(prim1, {
					hingeOffset: { z: 0.34 },
					openAngle: -Math.PI * 120 / 180,
					axis: "y",
					duration: 0.8,
					autoClose: 15,
					onOpen,
					onClose: () => onClose('left'),
				})
				g.userData.doorLeft = door
				door.pivot.traverse((c) => {
					if (c.isMesh) doorMeshes.push({ mesh: c, door, side: 'left' })
				})
			} else {
				console.warn("[createRefrigerator] prim1 not found")
			}

			// Invisible hitbox in LOCAL space — covers the full fridge volume so
			// clicks on GLB geometry gaps don't fall through to the floor behind.
			// Fixed dimensions; avoids matrixWorld dependency before first render.
			const hitbox = new THREE.Mesh(
				new THREE.BoxGeometry(1.0, 2.85, 1.5),
				new THREE.MeshBasicMaterial({ visible: false }),
			)
			hitbox.position.set(0, 0, 0)
			g.add(hitbox)

			const allMeshes = []
			g.traverse((c) => { if (c.isMesh) allMeshes.push(c) })
			if (onReady) onReady(doorMeshes, allMeshes)
		})
		.catch((err) => console.warn("[createRefrigerator] load failed:", err))
	return g
}
