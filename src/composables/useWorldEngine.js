// src/composables/useWorldEngine.js — Three.js scene driven by LLUDP ObjectUpdate data
import { onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import gsap from 'gsap'
import { useWorldStore, PCODE_AVATAR } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUiStore } from '@/stores/uiStore'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { S } from '@shared/protocol.js'

// SL uses Z-up; Three.js uses Y-up. Convert: THREE.Vector3(sl.x, sl.z, -sl.y)
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }

const CAM_SPEED      = 8    // m/s walk
const CAM_TURN_SPEED = 1.8  // rad/s
const CAM_FLY_SPEED  = 12   // m/s fly (PageUp/Dn)

export function useWorldEngine(canvasRef) {
	const worldStore   = useWorldStore()
	const sessionStore = useSessionStore()
	const uiStore      = useUiStore()
	const { on, off }  = useRealtimeSocket()
	const { sendMove } = useLLUDP()

	let renderer, labelRenderer, scene, camera, animId, ro
	const meshMap = new Map()  // localId → THREE.Mesh

	// ── Input state ─────────────────────────────────────────────────────────
	const keys    = {}
	let yaw       = 0        // horizontal camera rotation, radians
	let pitch     = -0.08   // slight downward tilt

	function onKeyDown(e) {
		// Don't capture keys when typing in an input
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
		keys[e.code] = true
		e.preventDefault?.()
	}
	function onKeyUp(e) {
		keys[e.code] = false
	}

	// ── Camera update (called each frame with dt) ────────────────────────────
	function updateCamera(dt) {
		if (!camera) return
		const turn = CAM_TURN_SPEED * dt
		const spd  = CAM_SPEED * dt
		const fly  = CAM_FLY_SPEED * dt

		// Yaw (Q/E, or ArrowLeft/Right without Shift)
		if (keys['KeyQ'] || keys['ArrowLeft'])  yaw += turn
		if (keys['KeyE'] || keys['ArrowRight']) yaw -= turn

		// Forward direction (ignores pitch for horizontal movement)
		const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
		const rgt = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw))

		if (keys['KeyW'] || keys['ArrowUp'])   camera.position.addScaledVector(fwd, spd)
		if (keys['KeyS'] || keys['ArrowDown']) camera.position.addScaledVector(fwd, -spd)
		if (keys['KeyA'])                      camera.position.addScaledVector(rgt, -spd)
		if (keys['KeyD'])                      camera.position.addScaledVector(rgt, spd)
		if (keys['PageUp'])                    camera.position.y += fly
		if (keys['PageDown'])                  camera.position.y -= fly

		// Stay above terrain
		camera.position.y = Math.max(0.5, camera.position.y)

		// Apply rotation (YXZ order = yaw first, then pitch)
		camera.rotation.set(pitch, yaw, 0, 'YXZ')

		// Derive controlFlags for AgentUpdate
		let cf = 0
		if (keys['KeyW'] || keys['ArrowUp'])   cf |= 0x01
		if (keys['KeyS'] || keys['ArrowDown']) cf |= 0x02
		if (keys['KeyA'])                      cf |= 0x04
		if (keys['KeyD'])                      cf |= 0x08
		if (keys['PageUp'])                    cf |= 0x10
		if (keys['PageDown'])                  cf |= 0x20
		return cf
	}

	// ── AgentUpdate to server ─────────────────────────────────────────────────
	let agentUpdateAccum = 0
	const AGENT_UPDATE_HZ = 10
	let controlFlags = 0

	function maybeAgentUpdate(dt, cf) {
		agentUpdateAccum += dt
		controlFlags = cf
		if (agentUpdateAccum < 1 / AGENT_UPDATE_HZ) return
		agentUpdateAccum = 0
		sendMove({
			controlFlags,
			bodyRot:   [0, 0, 0],
			headRot:   [0, 0, 0],
			// Convert Three.js Y-up camera pos → SL Z-up coords
			camCenter: [camera.position.x, -camera.position.z, camera.position.y],
			camAt:     [-Math.sin(yaw), 0, -Math.cos(yaw)],
			camLeft:   [-Math.cos(yaw), 0, Math.sin(yaw)],
			camUp:     [0, 1, 0],
			far:       128,
		})
	}

	// ── Camera position → uiStore ~4 Hz ──────────────────────────────────────
	let posReportAccum = 0
	function maybeReportPos(dt) {
		posReportAccum += dt
		if (posReportAccum < 0.25) return
		posReportAccum = 0
		// Convert Three.js Y-up → SL Z-up for display (x, z=height, y=depth)
		uiStore.setCameraPos(camera.position.x, camera.position.y, -camera.position.z)
	}

	// ── Scene setup ──────────────────────────────────────────────────────────
	function initScene() {
		scene = new THREE.Scene()
		scene.background = new THREE.Color(0x87ceeb)
		scene.fog = new THREE.FogExp2(0x87ceeb, 0.002)

		camera = new THREE.PerspectiveCamera(70, 1, 0.1, 512)
		camera.position.set(128, 25, -128)  // SL default — region center, ~25m up
		camera.rotation.set(pitch, yaw, 0, 'YXZ')

		renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
		renderer.shadowMap.enabled = true
		renderer.shadowMap.type = THREE.PCFSoftShadowMap
		renderer.toneMapping = THREE.ACESFilmicToneMapping
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

		labelRenderer = new CSS2DRenderer()
		labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;'
		canvasRef.value.parentElement.appendChild(labelRenderer.domElement)

		// Terrain placeholder
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
	function upsertMesh(obj) {
		let mesh = meshMap.get(obj.localId)
		if (!mesh) {
			const isAvatar = obj.pcode === PCODE_AVATAR
			const geo = isAvatar
				? new THREE.CapsuleGeometry(0.3, 1.2, 4, 8)
				: new THREE.BoxGeometry(1, 1, 1)
			const mat = new THREE.MeshStandardMaterial({ color: isAvatar ? 0x00b4d8 : 0xcccccc })
			mesh = new THREE.Mesh(geo, mat)
			mesh.castShadow = true

			if (isAvatar) {
				const div = document.createElement('div')
				div.style.cssText = 'color:#fff;font-size:0.75rem;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:4px;white-space:nowrap;'
				div.textContent = obj.name ?? 'Avatar'
				const label = new CSS2DObject(div)
				label.position.set(0, 1.2, 0)
				mesh.add(label)
			}

			scene.add(mesh)
			meshMap.set(obj.localId, mesh)
		}

		if (obj.scale) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])
		if (obj.pos) {
			const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
			gsap.to(mesh.position, { x: t.x, y: t.y, z: t.z, duration: 0.1, overwrite: true })
		}
	}

	function removeMesh(localId) {
		const mesh = meshMap.get(localId)
		if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); meshMap.delete(localId) }
	}

	// ── Incoming messages ─────────────────────────────────────────────────────
	function onObjectUpdate(msg) {
		for (const obj of (msg.d?.objects ?? [])) {
			worldStore.upsertObject(obj)
			upsertMesh(obj)
		}
	}

	// ── Render loop ───────────────────────────────────────────────────────────
	let lastTime = 0
	function animate(time) {
		animId = requestAnimationFrame(animate)
		const dt = Math.min((time - lastTime) * 0.001, 0.1)
		lastTime = time

		const cf = updateCamera(dt)
		maybeAgentUpdate(dt, cf ?? 0)
		maybeReportPos(dt)

		renderer.render(scene, camera)
		labelRenderer.render(scene, camera)
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMounted(() => {
		if (!canvasRef.value) return
		initScene()
		requestAnimationFrame(t => { lastTime = t; animate(t) })
		window.addEventListener('keydown', onKeyDown, { passive: false })
		window.addEventListener('keyup',   onKeyUp)
		on(S.OBJECT_UPDATE, onObjectUpdate)
	})

	onUnmounted(() => {
		cancelAnimationFrame(animId)
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

	// WHY: sessionStore kept for future own-avatar tint based on agentId
	void sessionStore

	return { scene, camera }
}
