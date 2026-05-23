// src/composables/useWorldEngine.js — Three.js scene driven by LLUDP ObjectUpdate data
import { onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import gsap from 'gsap'
import { useWorldStore, PCODE_AVATAR } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { S } from '@shared/protocol.js'

// SL uses Z-up; Three.js uses Y-up. Convert: THREE.Vector3(sl.x, sl.z, -sl.y)
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }

export function useWorldEngine(canvasRef) {
	const worldStore   = useWorldStore()
	const sessionStore = useSessionStore()  // WHY: kept for future agentId-based own-avatar tint
	const { on, off }  = useRealtimeSocket()
	const { sendMove } = useLLUDP()

	let renderer, labelRenderer, scene, camera, animId, ro
	const meshMap = new Map()  // localId → THREE.Mesh

	// ── Input state ─────────────────────────────────────────────────────────
	const keys = {}
	let controlFlags = 0
	let agentUpdateTimer = null

	const CTRL = {
		FORWARD:  0x01,
		BACKWARD: 0x02,
		LEFT:     0x04,
		RIGHT:    0x08,
		UP:       0x10,
		DOWN:     0x20,
	}

	function onKeyDown(e) { keys[e.code] = true;  updateControlFlags() }
	function onKeyUp(e)   { keys[e.code] = false; updateControlFlags() }

	function updateControlFlags() {
		controlFlags = 0
		if (keys['KeyW'] || keys['ArrowUp'])    controlFlags |= CTRL.FORWARD
		if (keys['KeyS'] || keys['ArrowDown'])  controlFlags |= CTRL.BACKWARD
		if (keys['KeyA'] || keys['ArrowLeft'])  controlFlags |= CTRL.LEFT
		if (keys['KeyD'] || keys['ArrowRight']) controlFlags |= CTRL.RIGHT
		if (keys['PageUp'])                     controlFlags |= CTRL.UP
		if (keys['PageDown'])                   controlFlags |= CTRL.DOWN
	}

	function sendAgentUpdate() {
		sendMove({
			controlFlags,
			bodyRot:   [0, 0, 0],
			headRot:   [0, 0, 0],
			camCenter: [camera.position.x, -camera.position.z, camera.position.y],
			camAt:     [0, 0, 1],
			camLeft:   [-1, 0, 0],
			camUp:     [0, 1, 0],
			far:       128,
		})
	}

	// ── Scene setup ──────────────────────────────────────────────────────────
	function initScene() {
		scene = new THREE.Scene()
		scene.background = new THREE.Color(0x87ceeb)  // sky blue placeholder
		scene.fog = new THREE.FogExp2(0x87ceeb, 0.002)

		camera = new THREE.PerspectiveCamera(60, 1, 0.1, 512)
		camera.position.set(0, 2, 10)

		renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
		renderer.shadowMap.enabled = true
		renderer.shadowMap.type = THREE.PCFSoftShadowMap
		renderer.toneMapping = THREE.ACESFilmicToneMapping

		labelRenderer = new CSS2DRenderer()
		labelRenderer.domElement.style.position = 'absolute'
		labelRenderer.domElement.style.top = '0'
		labelRenderer.domElement.style.left = '0'
		labelRenderer.domElement.style.width = '100%'
		labelRenderer.domElement.style.height = '100%'
		labelRenderer.domElement.style.pointerEvents = 'none'
		canvasRef.value.parentElement.appendChild(labelRenderer.domElement)

		// Terrain placeholder — flat green plane
		const terrain = new THREE.Mesh(
			new THREE.PlaneGeometry(256, 256, 64, 64),
			new THREE.MeshStandardMaterial({ color: 0x4a7c59 }),
		)
		terrain.rotation.x = -Math.PI / 2
		terrain.receiveShadow = true
		scene.add(terrain)

		// Lighting
		const sun = new THREE.DirectionalLight(0xfff4e6, 1.5)
		sun.position.set(50, 80, 50)
		sun.castShadow = true
		scene.add(sun)
		scene.add(new THREE.AmbientLight(0x6688cc, 0.4))

		// Resize observer
		ro = new ResizeObserver(onResize)
		ro.observe(canvasRef.value.parentElement)
		onResize()
	}

	function onResize() {
		const el = canvasRef.value?.parentElement
		if (!el) return
		const w = el.clientWidth, h = el.clientHeight
		camera.aspect = w / h
		camera.updateProjectionMatrix()
		renderer.setSize(w, h)
		labelRenderer.setSize(w, h)
	}

	// ── Mesh management ───────────────────────────────────────────────────────
	const PRIM_GEOM = {
		9:  () => new THREE.BoxGeometry(1, 1, 1),
		47: () => new THREE.CapsuleGeometry(0.3, 1.2, 4, 8),  // avatar capsule
	}

	function upsertMesh(obj) {
		let mesh = meshMap.get(obj.localId)
		if (!mesh) {
			const geomFn = PRIM_GEOM[obj.pcode] ?? PRIM_GEOM[9]
			const mat = obj.pcode === PCODE_AVATAR
				? new THREE.MeshStandardMaterial({ color: 0x00b4d8 })
				: new THREE.MeshStandardMaterial({ color: 0xcccccc })
			mesh = new THREE.Mesh(geomFn(), mat)
			mesh.castShadow = true

			if (obj.pcode === PCODE_AVATAR) {
				const div = document.createElement('div')
				div.style.cssText = 'color:#fff;font-size:0.75rem;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;white-space:nowrap;'
				div.textContent = obj.name ?? 'Avatar'
				const label = new CSS2DObject(div)
				label.position.set(0, 1.2, 0)
				mesh.add(label)
			}

			scene.add(mesh)
			meshMap.set(obj.localId, mesh)
		}

		// Scale (SL → Three.js: swap Y/Z)
		if (obj.scale) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])

		// Position — smooth GSAP tween
		if (obj.pos) {
			const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
			gsap.to(mesh.position, { x: t.x, y: t.y, z: t.z, duration: 0.1, overwrite: true })
		}
	}

	function removeMesh(localId) {
		const mesh = meshMap.get(localId)
		if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); meshMap.delete(localId) }
	}

	// ── Incoming object updates ───────────────────────────────────────────────
	function onObjectUpdate(msg) {
		for (const obj of (msg.d?.objects ?? [])) {
			worldStore.upsertObject(obj)
			upsertMesh(obj)
		}
	}

	// ── Render loop ───────────────────────────────────────────────────────────
	function animate() {
		animId = requestAnimationFrame(animate)
		renderer.render(scene, camera)
		labelRenderer.render(scene, camera)
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMounted(() => {
		if (!canvasRef.value) return
		initScene()
		animate()
		window.addEventListener('keydown', onKeyDown)
		window.addEventListener('keyup',   onKeyUp)
		agentUpdateTimer = setInterval(sendAgentUpdate, 100)  // 10 Hz
		on(S.OBJECT_UPDATE, onObjectUpdate)
	})

	onUnmounted(() => {
		cancelAnimationFrame(animId)
		clearInterval(agentUpdateTimer)
		window.removeEventListener('keydown', onKeyDown)
		window.removeEventListener('keyup',   onKeyUp)
		off(S.OBJECT_UPDATE, onObjectUpdate)
		ro?.disconnect()
		renderer?.dispose()
		labelRenderer?.domElement.remove()
		for (const mesh of meshMap.values()) mesh.geometry.dispose()
		meshMap.clear()
		worldStore.clearAll()
	})

	// WHY: sessionStore imported to suppress lint, used for future own-avatar highlight
	void sessionStore

	return { scene, camera }
}
