// src/composables/useWorldEngine.js — Three.js scene driven by LLUDP ObjectUpdate data
import { onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import gsap from 'gsap'
import { useWorldStore, PCODE_AVATAR } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUiStore } from '@/stores/uiStore'
import { useDebugStore } from '@/stores/debugStore'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { S } from '@shared/protocol.js'

// SL uses Z-up; Three.js uses Y-up. Convert: THREE.Vector3(sl.x, sl.z, -sl.y)
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }

const CAM_SPEED      = 8    // m/s walk
const CAM_RUN_SPEED  = 16   // m/s run (Shift)
const CAM_TURN_SPEED = 1.8  // rad/s
const CAM_FLY_SPEED  = 12   // m/s fly (PageUp/Dn)

// SL AgentUpdate control flags — verified against SL message template
// WHY: Previous code had 0x1000 (FAST_UP) for YAW_POS and 0x2000 (FLY) for YAW_NEG —
// pressing D sent AGENT_CONTROL_FLY, causing the avatar to fly/"jump".
const CTRL_AT_POS    = 0x0001  // forward
const CTRL_AT_NEG    = 0x0002  // backward
const CTRL_LEFT_POS  = 0x0004  // strafe left
const CTRL_LEFT_NEG  = 0x0008  // strafe right
const CTRL_UP_POS    = 0x0010  // jump / fly up
const CTRL_UP_NEG    = 0x0020  // crouch / fly down
const CTRL_YAW_POS   = 0x0100  // turn left
const CTRL_YAW_NEG   = 0x0200  // turn right
const CTRL_FAST_AT   = 0x0400  // run modifier (with AT_POS/NEG)
const CTRL_FAST_LEFT = 0x0800  // run strafe modifier
const CTRL_FLY       = 0x2000  // sustained fly state

const FOLLOW_DIST   = 7.0   // metres behind avatar (third-person)
const FOLLOW_HEIGHT = 4.0   // metres above avatar feet

export function useWorldEngine(canvasRef) {
	const worldStore   = useWorldStore()
	const sessionStore = useSessionStore()
	const uiStore      = useUiStore()
	const debugStore   = useDebugStore()
	const { on, off }  = useRealtimeSocket()
	const { sendMove } = useLLUDP()

	let renderer, labelRenderer, scene, camera, animId, ro
	const meshMap = new Map()  // localId → THREE.Mesh
	let terrainMesh = null  // THREE.Mesh with 257×257 vertex PlaneGeometry
	let waterMesh   = null  // flat blue plane at y=20

	// ── Own avatar tracking ───────────────────────────────────────────────────
	// Set from first ObjectUpdate where fullId == agentId
	let ownAvatarLocalId = null
	// WHY: avatarSLPos is sim-authoritative [slX, slY, slZ], updated from every TerseUpdate and
	// ObjectUpdate for own avatar. Drives third-person follow camera in animate().
	// Replacing old snap (ownAvatarSnapPos/ownAvatarPosNeedsApply) with lerp-based follow.
	let avatarSLPos      = null
	let followDist       = FOLLOW_DIST
	let terseUpdateCount = 0  // diagnostic: confirm TerseUpdates are flowing

	// ── Input state ─────────────────────────────────────────────────────────
	const keys  = {}
	let yaw     = 0        // horizontal camera rotation, radians (Y-up Three.js)
	let pitch   = -0.08    // slight downward tilt
	let isFlying  = false  // F toggles; sustained CTRL_FLY sent each frame while true
	let eHoldTime = 0      // seconds E has been continuously held

	// WHY: Esc or W-press when camera is displaced snaps camera back to follow position.
	// Flag set in onKeyDown (Escape) or detected via distance in animate().
	let cameraSnapRequested = false

	// Alt-orbit (third-person camera): alt+drag orbits around a pivot
	let isAltOrbit  = false
	let orbitPivot  = new THREE.Vector3(128, 0, -128)  // SL center in Three.js coords
	let orbitRadius = 8   // metres from pivot
	let orbitYaw    = 0   // orbit horizontal angle
	let orbitPitch  = 0.3 // orbit vertical angle (radians)

	// Mouse drag state
	let isDragging   = false
	let lastMouseX   = 0
	let lastMouseY   = 0
	const MOUSE_SENSITIVITY = 0.003  // rad per pixel

	const MOVE_KEYS = [
		'KeyW','KeyS','KeyA','KeyD','KeyQ','KeyE','KeyC','KeyF',
		'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown',
	]

	function onKeyDown(e) {
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
		keys[e.code] = true
		if (e.code === 'KeyF') {
			isFlying = !isFlying
			e.preventDefault()
			return
		}
		// WHY: Esc resets camera to default follow position behind avatar.
		// Same effect as W (which auto-snaps when far) but explicit and instant.
		// Also exits alt-orbit mode so follow camera resumes.
		if (e.code === 'Escape' && avatarSLPos) {
			// WHY: Reset zoom distance too so Esc is visibly useful even when camera
			// was only displaced by scrollwheel (followDist changed, position wasn't lost).
			followDist = FOLLOW_DIST
			cameraSnapRequested = true
			isAltOrbit = false
			isDragging = false
			e.preventDefault()
			return
		}
		if (MOVE_KEYS.includes(e.code)) e.preventDefault()
	}
	function onKeyUp(e) { keys[e.code] = false }
	// WHY: When the window loses focus (tab switch, alt-tab), keyup events are not delivered.
	// Keys appear stuck and the avatar spins / walks indefinitely.
	// Clear all held keys and mouse drag state on blur to prevent this.
	function onBlur() {
		for (const k in keys) keys[k] = false
		isDragging  = false
		isAltOrbit  = false
		eHoldTime   = 0
	}

	function onMouseDown(e) {
		if (e.button !== 0) return
		isDragging  = true
		isAltOrbit  = e.altKey
		lastMouseX  = e.clientX
		lastMouseY  = e.clientY
		if (isAltOrbit) {
			// Seed orbit angles from current camera state
			orbitYaw   = yaw
			orbitPitch = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, -pitch + 0.3))
			// WHY: Pivot on avatar when known; avoids y=0 ground-lock when flying.
			// Fallback: project forward from camera at ground level (old behavior).
			if (avatarSLPos) {
				orbitPivot.copy(slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2]))
			} else {
				const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
				orbitPivot.copy(camera.position).addScaledVector(fwd, orbitRadius)
				orbitPivot.y = 0
			}
		}
	}
	function onMouseMove(e) {
		if (!isDragging) return
		const dx = e.clientX - lastMouseX
		const dy = e.clientY - lastMouseY
		lastMouseX = e.clientX
		lastMouseY = e.clientY
		if (isAltOrbit) {
			// WHY: Alt-drag orbits camera around pivot (third-person view), matching SL alt+drag
			orbitYaw   -= dx * MOUSE_SENSITIVITY
			orbitPitch  = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, orbitPitch + dy * MOUSE_SENSITIVITY))
		} else {
			yaw   -= dx * MOUSE_SENSITIVITY
			pitch -= dy * MOUSE_SENSITIVITY
			pitch  = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 4, pitch))
		}
	}
	function onMouseUp() { isDragging = false; isAltOrbit = false }

	// Scroll wheel: zoom in orbit mode or third-person; forward/back in explore mode
	function onWheel(e) {
		if (!camera) return
		e.preventDefault()
		const delta = e.deltaY > 0 ? -1 : 1
		if (isAltOrbit || (e.altKey && isDragging)) {
			orbitRadius = Math.max(2, Math.min(64, orbitRadius - delta * 2))
		} else if (avatarSLPos) {
			// WHY: Third-person — scroll zooms follow distance, not camera position.
			// Camera position is driven by avatarSLPos + followDist in animate().
			followDist = Math.max(1.5, Math.min(20, followDist - delta))
		} else {
			// Explore mode (no avatar yet): scroll moves camera forward
			const spd = CAM_SPEED * 0.4
			const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
			camera.position.addScaledVector(fwd, delta * spd)
			camera.position.y = Math.max(0.5, camera.position.y)
		}
	}

	// ── Camera update (called each frame with dt) ────────────────────────────
	function updateCamera(dt) {
		if (!camera) return 0

		const shift = keys['ShiftLeft'] || keys['ShiftRight']
		const turn  = CAM_TURN_SPEED * dt
		const spd   = (shift ? CAM_RUN_SPEED : CAM_SPEED) * dt
		const fly   = CAM_FLY_SPEED * dt

		if (isAltOrbit) {
			// Alt-orbit: update camera position only, no control flags
			const cx = orbitPivot.x + orbitRadius * Math.sin(orbitYaw) * Math.cos(orbitPitch)
			const cy = orbitPivot.y + orbitRadius * Math.sin(orbitPitch)
			const cz = orbitPivot.z + orbitRadius * Math.cos(orbitYaw) * Math.cos(orbitPitch)
			camera.position.set(cx, cy, cz)
			camera.lookAt(orbitPivot)
			return 0
		}

		// WHY: Shift held = strafe instead of turn (matches SL/Firestorm Shift behaviour)
		if (!shift) {
			if (keys['KeyA'] || keys['ArrowLeft'])  yaw += turn
			if (keys['KeyD'] || keys['ArrowRight']) yaw -= turn
		}

		// E = jump/fly-up; C = crouch/fly-down; PgUp/PgDn same
		// WHY: hold E > 1.5s auto-activates fly, matching SL/Firestorm behaviour
		const goUp   = keys['KeyE'] || keys['PageUp']
		const goDown = keys['KeyC'] || keys['PageDown']
		if (goUp) {
			eHoldTime += dt
			if (eHoldTime >= 1.5 && !isFlying) isFlying = true
		} else {
			eHoldTime = 0
		}

		// WHY: Explore-mode (before avatar position known): move camera freely with WASD.
		// Once avatarSLPos is set, animate() drives camera via third-person follow and
		// camera.position / camera.rotation are set there instead.
		if (!avatarSLPos) {
			const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
			const rgt = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw))
			if (keys['KeyW'] || keys['ArrowUp'])   camera.position.addScaledVector(fwd,  spd)
			if (keys['KeyS'] || keys['ArrowDown']) camera.position.addScaledVector(fwd, -spd)
			if (keys['KeyQ'] || (shift && (keys['KeyA'] || keys['ArrowLeft'])))
				camera.position.addScaledVector(rgt, -spd)
			if (shift && (keys['KeyD'] || keys['ArrowRight']))
				camera.position.addScaledVector(rgt,  spd)
			if (goUp)   camera.position.y += (isFlying ? fly : spd * 0.5)
			if (goDown && isFlying) camera.position.y -= fly
			camera.position.y = Math.max(0.5, camera.position.y)
			camera.rotation.set(pitch, yaw, 0, 'YXZ')
		}

		// ── Control flags (always sent to sim regardless of camera mode) ──────
		let cf = 0
		if (isFlying) cf |= CTRL_FLY

		if (!shift) {
			if (keys['KeyA'] || keys['ArrowLeft'])  cf |= CTRL_YAW_POS
			if (keys['KeyD'] || keys['ArrowRight']) cf |= CTRL_YAW_NEG
		}
		if (keys['KeyW'] || keys['ArrowUp'])   cf |= CTRL_AT_POS  | (shift ? CTRL_FAST_AT   : 0)
		if (keys['KeyS'] || keys['ArrowDown']) cf |= CTRL_AT_NEG  | (shift ? CTRL_FAST_AT   : 0)
		if (keys['KeyQ'] || (shift && (keys['KeyA'] || keys['ArrowLeft'])))
			cf |= CTRL_LEFT_POS | (shift ? CTRL_FAST_LEFT : 0)
		if (shift && (keys['KeyD'] || keys['ArrowRight']))
			cf |= CTRL_LEFT_NEG | CTRL_FAST_LEFT
		if (goUp)   cf |= CTRL_UP_POS
		if (goDown) cf |= CTRL_UP_NEG

		return cf
	}

	// ── AgentUpdate to server ─────────────────────────────────────────────────
	let agentUpdateAccum = 0
	const AGENT_UPDATE_HZ = 10
	let controlFlags = 0

	// WHY: diagnostic counter — track how many MOVE messages are actually sent
	let moveCount = 0
	function maybeAgentUpdate(dt, cf) {
		agentUpdateAccum += dt
		controlFlags = cf
		if (agentUpdateAccum < 1 / AGENT_UPDATE_HZ) return
		agentUpdateAccum = 0
		moveCount++

		// WHY: SL body rotation quaternion for Z-up yaw.
		// Three.js yaw rotates around Y (Y-up); SL equivalent rotates around Z (Z-up).
		// SL facing angle = π/2 + yaw (Three.js yaw=0 → facing north = SL +Y → angle=π/2).
		// LLQuaternion stores only xyz; w = sqrt(1-x²-y²-z²) derived by server (always ≥ 0).
		// WHY negate when w<0: if cos(halfAngle)<0 the server's sqrt recovers the wrong sign,
		// making avatar face the mirror direction. Negating xyz preserves the same rotation
		// since (q and -q) are equivalent quaternions, but ensures reconstructed w > 0.
		const slAngle  = Math.PI / 2 + yaw
		const halfAngle = slAngle / 2
		let bodyRotZ = Math.sin(halfAngle)
		if (Math.cos(halfAngle) < 0) bodyRotZ = -bodyRotZ

		// WHY: camAt/camLeft must be in SL Z-up space, not Three.js Y-up space.
		// Conversion: SL(x,y,z) = Three(x, -z, y).
		// Three.js forward = (-sin(yaw), 0, -cos(yaw)) → SL = (-sin(yaw), cos(yaw), 0)
		// Three.js right   = ( cos(yaw), 0, -sin(yaw)) → SL = ( cos(yaw), sin(yaw), 0)
		// SL camLeft is actually the camera's LEFT vector = -right in SL space
		// WHY: Update minimap compass yaw at AgentUpdate rate (10Hz); avoids needing
		// a separate timer and keeps uiStore.cameraYaw close to avatar facing direction.
		uiStore.setCameraYaw(yaw)
		sendMove({
			controlFlags,
			bodyRot:   [0, 0, bodyRotZ],
			headRot:   [0, 0, bodyRotZ],
			camCenter: [camera.position.x, -camera.position.z, camera.position.y],  // Three→SL
			camAt:     [-Math.sin(yaw),  Math.cos(yaw), 0],   // forward in SL space
			camLeft:   [-Math.cos(yaw), -Math.sin(yaw), 0],   // left   in SL space
			camUp:     [0, 0, 1],                              // Z-up in SL space
			far:       128,
		})
	}

	// WHY: Camera position reporting replaced by worldStore.setAvatarPos() calls
	// in onObjectUpdate/onTerseUpdate. LocationBar reads worldStore.avatarPos directly.

	// WHY: Topo coloring matches spec: teal near water, green mid, stone high.
	// Returns [r, g, b] in 0–1 range. Smooth lerp between bands avoids hard edges.
	function heightColor(h) {
		// deep/underwater
		if (h <= 0)   return [0.08, 0.30, 0.60]
		// shallow → low land
		if (h <= 10)  return lerpRgb([0.16, 0.50, 0.83], [0.25, 0.55, 0.45], h / 10)
		// low land → grass
		if (h <= 20)  return lerpRgb([0.25, 0.55, 0.45], [0.29, 0.49, 0.35], (h - 10) / 10)
		// grass → earthy mid
		if (h <= 40)  return lerpRgb([0.29, 0.49, 0.35], [0.45, 0.42, 0.35], (h - 20) / 20)
		// earthy → stone grey
		return lerpRgb([0.45, 0.42, 0.35], [0.60, 0.58, 0.58], Math.min((h - 40) / 60, 1))
	}

	function lerpRgb(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t) }

	function applyHeightColor(colAttr, vertexIndex, h) {
		const [r, g, b] = heightColor(h)
		colAttr.setXYZ(vertexIndex, r, g, b)
	}

	// WHY: HMR and navigation away/back trigger onUnmounted+onMounted. worldStore.terrainHeights
	// persists across remounts (Pinia ref). Rebuild geometry immediately on mount so terrain
	// appears without waiting for another LayerData burst from the sim.
	function rebuildTerrainFromStore() {
		if (!terrainMesh) return
		const pos     = terrainMesh.geometry.attributes.position
		const col     = terrainMesh.geometry.attributes.color
		const rx      = sessionStore.regionSizeX
		const ry      = sessionStore.regionSizeY
		// WHY: hStride=TERRAIN_STRIDE (513) matches worldStore.terrainHeights layout.
		// vStride=rx+1 matches the terrain geometry vertex layout (rx segments → rx+1 vertices/row).
		const hStride = worldStore.TERRAIN_STRIDE  // 513 — heights array row width
		const vStride = rx + 1                     // geometry vertex row width
		let anyNonZero = false
		for (let slY = 0; slY <= ry; slY++) {
			for (let slX = 0; slX <= rx; slX++) {
				const hIdx = slY * hStride + slX
				const vi   = slY * vStride + slX
				const h    = worldStore.terrainHeights[hIdx]
				if (h !== 0) anyNonZero = true
				pos.setY(vi, h)
				applyHeightColor(col, vi, h)
			}
		}
		// WHY: always mark dirty — even an all-zero heights write (clearTerrain + rebuild)
		// must flush stale GPU data. computeVertexNormals only needed when heights change.
		pos.needsUpdate = true
		col.needsUpdate = true
		if (anyNonZero) terrainMesh.geometry.computeVertexNormals()
	}

	// ── Scene setup ──────────────────────────────────────────────────────────
	function initScene() {
		scene = new THREE.Scene()
		scene.background = new THREE.Color(0x87ceeb)
		scene.fog = new THREE.FogExp2(0x87ceeb, 0.002)

		// WHY far=1024: diagonal of 512×512 var-region is ~724m; 512 clips objects at far corners.
		// 1024 covers any standard or var-region without aggressive fog truncation.
		camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1024)
		// WHY: Start at SL z=25 (Three.js y=25) — matches heartbeat camCenter default so
		// the sim receives a sensible above-ground camera while waiting for first TerseUpdate.
		// TerseUpdate snap corrects to real avatar position once sim responds.
		camera.position.set(128, 25, -128)
		camera.rotation.set(pitch, yaw, 0, 'YXZ')

		renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
		// WHY: Shadow maps disabled for Phase 1 (see prior WHY on shadow frustum mismatch).
		renderer.shadowMap.enabled = false
		renderer.toneMapping = THREE.ACESFilmicToneMapping
		// WHY: Explicit SRGBColorSpace — older Three.js defaulted to LinearEncoding which skips
		// gamma correction. Without this, ACES linear output hits an sRGB monitor raw → colours
		// appear darker than expected, and prim shadow faces show as an unintended dark brown.
		renderer.outputColorSpace = THREE.SRGBColorSpace
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

		labelRenderer = new CSS2DRenderer()
		labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;'
		canvasRef.value.parentElement.appendChild(labelRenderer.domElement)

		// WHY: Region size from sessionStore (256 standard, 512 var-region). PlaneGeometry segments
		// = regionSize so there's one vertex per metre in each axis — matches terrainHeights stride.
		// rotateX(-π/2) lays the plane flat. translate(rx/2, 0, -ry/2) centres the region at
		// Three.js origin matching slToThree(rx/2, ry/2, 0). Vertex Y updated per TERRAIN_PATCH.
		const rx = sessionStore.regionSizeX
		const ry = sessionStore.regionSizeY
		const terrainGeo = new THREE.PlaneGeometry(rx, ry, rx, ry)
		terrainGeo.rotateX(-Math.PI / 2)
		terrainGeo.translate(rx / 2, 0, -ry / 2)

		// Add vertex color attribute — updated per patch in onTerrainPatch
		const vtxColors = new Float32Array(terrainGeo.attributes.position.count * 3)
		// Initial fill: mid-green (r=0.29, g=0.49, b=0.35)
		for (let i = 0; i < vtxColors.length; i += 3) {
			vtxColors[i]     = 0.29  // r
			vtxColors[i + 1] = 0.49  // g
			vtxColors[i + 2] = 0.35  // b
		}
		terrainGeo.setAttribute('color', new THREE.BufferAttribute(vtxColors, 3))

		terrainMesh = new THREE.Mesh(
			terrainGeo,
			new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
		)
		scene.add(terrainMesh)

		// WHY: Water plane sized to region + 4m margin on each side to avoid visible seam.
		// Centred at region midpoint (rx/2, ry/2 in SL) = Three.js (rx/2, 20, -ry/2).
		waterMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(rx + 8, ry + 8),
			new THREE.MeshBasicMaterial({
				color: 0x2266aa,
				transparent: true,
				opacity: 0.72,
				side: THREE.FrontSide,
			}),
		)
		waterMesh.rotation.x = -Math.PI / 2
		waterMesh.position.set(rx / 2, 20, -ry / 2)
		scene.add(waterMesh)

		// Lighting — avatar capsules use MeshStandardMaterial so they need real lights.
		// Prims now use MeshBasicMaterial (unlit) so lighting doesn't affect them at all.
		const sun = new THREE.DirectionalLight(0xfff4e6, 1.2)
		sun.position.set(50, 80, 50)
		scene.add(sun)
		// WHY: Fill light from opposite side of sun. Prevents avatar shadow faces going near-zero
		// (which after ACES + any outputColorSpace quirk produces the dark-face artefact).
		// ~35% sun intensity keeps shadow side visible without flattening the 3D form.
		const fill = new THREE.DirectionalLight(0xaad4f5, 0.45)
		fill.position.set(-60, -20, -80)
		scene.add(fill)
		scene.add(new THREE.AmbientLight(0xfff4e6, 0.5))

		// Resize observer
		ro = new ResizeObserver(onResize)
		ro.observe(canvasRef.value.parentElement)
		onResize()

		rebuildTerrainFromStore()
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
		const isNew = !mesh

		if (isNew) {
			const isAvatar = obj.pcode === PCODE_AVATAR
			const geo = isAvatar
				? new THREE.CapsuleGeometry(0.3, 1.2, 4, 8)
				: new THREE.BoxGeometry(1, 1, 1)
			// WHY: Avatars = MeshStandardMaterial so the capsule shows 3D volume under lighting.
			// Prims = MeshBasicMaterial (unlit) — placeholder boxes don't benefit from PBR and
			// their shadow faces (facing away from sun) produced the dark-artefact flicker.
			// MeshBasicMaterial ignores all lights; all faces render at full material colour.
			const mat = isAvatar
				? new THREE.MeshStandardMaterial({ color: 0x00b4d8 })
				: new THREE.MeshBasicMaterial({ color: 0xcccccc })
			mesh = new THREE.Mesh(geo, mat)

			if (isAvatar) {
				// WHY: Forward-pointing arm so avatar rotation direction is visually obvious.
				// Three.js -Z = forward when yaw=0. Orange box pokes out ~0.15m past capsule radius.
				const armGeo = new THREE.BoxGeometry(0.12, 0.12, 0.35)
				const armMat = new THREE.MeshStandardMaterial({ color: 0xff6600 })
				const arm = new THREE.Mesh(armGeo, armMat)
				arm.position.set(0, 0.1, -0.42)  // -Z = forward direction
				arm.castShadow = false
				mesh.add(arm)

				const div = document.createElement('div')
				div.style.cssText = 'color:#fff;font-size:0.75rem;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:4px;white-space:nowrap;'
				// WHY: obj.name may be absent on first ObjectUpdate (NameValue arrives later).
				// Fall back to worldStore (just upserted) then 'Avatar'. Stored on userData
				// so later ObjectUpdates can refresh the label text without recreating the mesh.
				div.textContent = obj.name || worldStore.objects.get(obj.localId)?.name || 'Avatar'
				mesh.userData.labelDiv = div
				const label = new CSS2DObject(div)
				label.position.set(0, 1.2, 0)
				mesh.add(label)
			}

			// WHY: Set position BEFORE scene.add — prevents 1-frame flash at world origin.
			// Zero-pos guard: skip placement if pos is [0,0,0] (decode error); mesh stays
			// at origin temporarily but won't be at camera level for legit scene objects.
			if (obj.pos && (obj.pos[0] !== 0 || obj.pos[1] !== 0 || obj.pos[2] !== 0)) {
				const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
				mesh.position.set(t.x, t.y, t.z)
			}
			if (obj.scale) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])

			scene.add(mesh)
			meshMap.set(obj.localId, mesh)
		} else {
			// Existing mesh: scale update + animated position
			if (obj.scale) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])
			if (obj.pos) {
				const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
				// WHY: ObjectUpdate is sparse (login + new objects in range). Avatar gets GSAP
				// so a belated full-update doesn't jerk it mid-motion. Prims: direct set.
				if (obj.pcode === PCODE_AVATAR) {
					gsap.to(mesh.position, { x: t.x, y: t.y, z: t.z, duration: 0.1, overwrite: true })
				} else {
					mesh.position.set(t.x, t.y, t.z)
				}
			}
			// WHY: NameValue data can arrive in a later ObjectUpdate after the mesh was created.
			// Refresh label text whenever we get a real name so "Avatar" placeholder gets replaced.
			if (obj.pcode === PCODE_AVATAR && obj.name && mesh.userData.labelDiv) {
				const current = mesh.userData.labelDiv.textContent
				if (current !== obj.name) mesh.userData.labelDiv.textContent = obj.name
			}
		}
	}

	function removeMesh(localId) {
		const mesh = meshMap.get(localId)
		if (mesh) {
			// WHY: Traverse to dispose child geometry/materials (arm indicator etc.) not just root
			mesh.traverse(child => {
				if (child.isMesh) { child.geometry.dispose(); child.material.dispose() }
			})
			scene.remove(mesh)
			meshMap.delete(localId)
		}
	}

	// ── Incoming messages ─────────────────────────────────────────────────────
	let objUpdateCount = 0
	function onObjectUpdate(payload) {
		// WHY: useRealtimeSocket dispatches msg.d (unwrapped) to handlers, not the full {t,d} envelope.
		// So payload = { objects: [...] } — access as payload.objects, not payload.d.objects.
		const objs = payload?.objects ?? []
		objUpdateCount++
		if (objUpdateCount === 1 || objUpdateCount % 20 === 0) {
			const avCount = objs.filter(o => o.pcode === PCODE_AVATAR).length
			debugStore.push('info', `[3D] ObjectUpdate #${objUpdateCount}: ${objs.length} objects (${avCount} av) agentId=${sessionStore.agentId?.slice(0,8)}`)
		}
		for (const obj of objs) {
			worldStore.upsertObject(obj)
			upsertMesh(obj)
			// WHY: Identify our own avatar by fullId == agentId so TerseUpdate can
			// drive the third-person follow camera via avatarSLPos.
			// WHY: bytesToUuid() returns lowercase; login XML may return uppercase agentId.
			// Case-insensitive compare prevents ownAvatarLocalId from staying null.
			if (obj.pcode === PCODE_AVATAR) {
				// WHY: log fullId comparison even on mismatch so we can detect UUID format bugs
				const objId = obj.fullId?.toLowerCase() ?? ''
				const myId  = sessionStore.agentId?.toLowerCase() ?? ''
				if (myId && objId !== myId) {
					// Other avatar — not our own; no action needed
				} else if (objId === myId && myId) {
					ownAvatarLocalId = obj.localId
					// WHY: Recolor own avatar to green so it's visually distinct from other cyan avatars.
					// Material is set after mesh creation so this works whether mesh was just created
					// or already existed (e.g., duplicate ObjectUpdate).
					const ownMesh = meshMap.get(obj.localId)
					if (ownMesh) ownMesh.material.color.setHex(0x00e676)
					const p = obj.pos
					debugStore.push('info', `[3D] Own avatar id=${obj.localId} fullId=${objId.slice(0,8)} pos=${p?.[0]?.toFixed(1) ?? '?'},${p?.[1]?.toFixed(1) ?? '?'},${p?.[2]?.toFixed(1) ?? '?'}`)
					if (p && (p[0] !== 0 || p[1] !== 0 || p[2] !== 0)) {
						avatarSLPos = [...p]  // WHY: own copy — dead reckoning mutates avatarSLPos in-place
						worldStore.setAvatarPos(p[0], p[1], p[2])
						worldStore.setSpawnPos(p[0], p[1], p[2])
						const rx = sessionStore.regionSizeX, ry = sessionStore.regionSizeY
						if (p[0] < 10 || p[0] > rx - 10 || p[1] < 10 || p[1] > ry - 10) {
							debugStore.push('warn', `[3D] Avatar near region edge (${p[0].toFixed(0)},${p[1].toFixed(0)},${p[2].toFixed(0)}) — movement may be blocked. Teleport to region centre.`)
						}
					}
				} else {
					// myId is empty — agentId not yet set (shouldn't happen, but log it)
					debugStore.push('warn', `[3D] pcode=47 received but sessionStore.agentId empty — can't identify own avatar`)
				}
			}
		}
	}

	function onTerseUpdate(payload) {
		// WHY: useRealtimeSocket dispatches msg.d (unwrapped) to handlers.
		// payload = { objects: [...] } — use payload.objects directly.
		const objs = payload?.objects ?? []
		terseUpdateCount++
		if (terseUpdateCount === 1 || terseUpdateCount % 50 === 0) {
			debugStore.push('info', `[3D] TerseUpdate #${terseUpdateCount} — ${objs.length} objects, ownId=${ownAvatarLocalId}`)
		}
		for (const obj of objs) {
			const pos = obj.pos
			// WHY: Zero-pos guard for ALL objects. A TerseUpdate with pos=[0,0,0] is a decode
			// error — legitimate prims/avatars at exact SL origin are essentially impossible.
			// Without this, a large prim briefly teleports to SL(0,0,0) = Three.js(0,0,0) which
			// can be near the camera, filling half the viewport with a grey rectangle.
			if (!pos || (pos[0] === 0 && pos[1] === 0 && pos[2] === 0)) continue
			// Update world store position
			worldStore.updateObjectPos(obj.localId, pos)
			// Move the mesh
			const mesh = meshMap.get(obj.localId)
			if (mesh) {
				const t = slToThree(pos[0], pos[1], pos[2])
				// WHY: Avatars get GSAP lerp to smooth 10Hz TerseUpdate jitter into fluid motion.
				// Prims use direct set — GSAP on many static prims restarts tweens every update
				// and can cause brief visible oscillation when position data has decode noise.
				const stored = worldStore.objects.get(obj.localId)
				if (stored?.pcode === PCODE_AVATAR) {
					gsap.to(mesh.position, { x: t.x, y: t.y, z: t.z, duration: 0.1, overwrite: true })
				} else {
					mesh.position.set(t.x, t.y, t.z)
				}
			}
			// WHY: avatarSLPos drives third-person follow camera in animate().
			// WHY blend not snap: dead reckoning in animate() keeps avatarSLPos moving between
			// TerseUpdates. Snapping to sim pos would cause visible jerk. Blend smoothly corrects
			// accumulated dead-reckoning drift. Large corrections (>5m = teleport or big physics
			// correction) snap immediately so the camera doesn't lag across the region.
			const p = obj.pos
			if (obj.localId === ownAvatarLocalId && p &&
				(p[0] !== 0 || p[1] !== 0 || p[2] !== 0)) {
				const firstUpdate = !avatarSLPos
				if (!avatarSLPos) {
					avatarSLPos = [...p]
				} else {
					const d = Math.hypot(p[0] - avatarSLPos[0], p[1] - avatarSLPos[1], p[2] - avatarSLPos[2])
					const blend = d > 5 ? 1.0 : 0.4
					avatarSLPos[0] += (p[0] - avatarSLPos[0]) * blend
					avatarSLPos[1] += (p[1] - avatarSLPos[1]) * blend
					avatarSLPos[2] += (p[2] - avatarSLPos[2]) * blend
				}
				worldStore.setAvatarPos(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
				if (firstUpdate) {
					debugStore.push('info', `[3D] First TerseUpdate own avatar → ${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}`)
				}
			}
		}
	}

	function onAgentSpawnPos(payload) {
		// WHY: AgentMovementComplete fires once after login — sim's authoritative spawn position.
		// Arrives before ObjectUpdate (pcode=47) and before any TerseUpdate.
		// Set avatarSLPos immediately so camera snaps to correct location before scene loads.
		const p = payload?.pos
		if (!p || p.length < 3) return
		const [x, y, z] = p
		if (x === 0 && y === 0 && z === 0) return
		avatarSLPos = [...p]  // WHY: own copy — dead reckoning mutates in-place
		worldStore.setAvatarPos(x, y, z)
		worldStore.setSpawnPos(x, y, z)  // also update persistent store for future remounts
		cameraSnapRequested = true  // snap camera to new position immediately
		debugStore.push('info', `[3D] AgentMovementComplete spawn pos=${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} (regionSize=${sessionStore.regionSizeX}×${sessionStore.regionSizeY})`)
		const rx = sessionStore.regionSizeX, ry = sessionStore.regionSizeY
		if (x < 10 || x > rx - 10 || y < 10 || y > ry - 10) {
			debugStore.push('warn', `[3D] Spawn near region edge — movement may be blocked`)
		}
	}

	function onKillObject(payload) {
		// WHY: Sim sends KillObject (High #16) when prims/avatars/NPCs leave or are deleted.
		// Remove from Three.js scene and worldStore so they don't persist as ghost objects.
		const ids = payload?.ids ?? []
		for (const id of ids) {
			removeMesh(id)
			worldStore.removeObject(id)
		}
		if (ids.length > 0) {
			// If own avatar was killed (region cross / sim kick), clear tracking
			if (ids.includes(ownAvatarLocalId)) {
				ownAvatarLocalId = null
				avatarSLPos = null
				debugStore.push('warn', `[3D] Own avatar killed — awaiting respawn`)
			}
			debugStore.push('info', `[3D] KillObject: removed ${ids.length} objects`)
		}
	}

	function onTerrainPatch(payload) {
		if (!terrainMesh) return
		const { layerType, patchSize = 16, patches } = payload
		if (layerType === 'WATER') return  // water plane height fixed at 20 for Phase 1

		const pos     = terrainMesh.geometry.attributes.position
		const col     = terrainMesh.geometry.attributes.color
		const rx      = sessionStore.regionSizeX
		const ry      = sessionStore.regionSizeY
		// WHY: vStride=rx+1 matches terrain geometry vertex layout (rx segments → rx+1 verts/row).
		const vStride = rx + 1

		for (const { x: px, y: py, heights } of patches) {
			// Store in worldStore for remount persistence
			worldStore.setTerrainPatch(px, py, heights, patchSize)

			// WHY: Update (patchSize+1)×(patchSize+1) vertices to fill seam between patches.
			// Clamped height index prevents reading out-of-bounds on the patch edge.
			for (let j = 0; j <= patchSize; j++) {
				for (let i = 0; i <= patchSize; i++) {
					const slX = px * patchSize + i
					const slY = py * patchSize + j
					if (slX > rx || slY > ry) continue
					const vi = slY * vStride + slX
					const hIdx = Math.min(j, patchSize - 1) * patchSize + Math.min(i, patchSize - 1)
					const h = heights[hIdx]
					pos.setY(vi, h)
					applyHeightColor(col, vi, h)
				}
			}
		}

		pos.needsUpdate = true
		col.needsUpdate = true
		terrainMesh.geometry.computeVertexNormals()
	}

	// ── Render loop ───────────────────────────────────────────────────────────
	let lastTime = 0
	function animate(time) {
		animId = requestAnimationFrame(animate)
		const dt = Math.min((time - lastTime) * 0.001, 0.1)
		lastTime = time

		const cf = updateCamera(dt)

		// WHY: Third-person follow camera — positions camera behind and above avatar.
		// Lerp factor 0.15 smooths 10Hz TerseUpdate jitter into fluid motion.
		// Hard-snap (lerp=1.0) only on Esc or >50m off target (see snap comment below).
		if (avatarSLPos && !isAltOrbit) {
			const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			const target = new THREE.Vector3(
				t.x + Math.sin(yaw) * followDist,
				t.y + FOLLOW_HEIGHT,
				t.z + Math.cos(yaw) * followDist,
			)
			const distToTarget = camera.position.distanceTo(target)
			// WHY: Hard-snap only on Esc (explicit) or >50m (teleport/first login).
			// Variable lerp: when a movement key is held and camera is displaced, glide back
			// faster (up to 0.35) so pressing W naturally re-centres the camera without a jarring
			// teleport. Scales with distance so the acceleration eases off as it converges.
			const snap = cameraSnapRequested || distToTarget > 50
			cameraSnapRequested = false
			const isMoving = MOVE_KEYS.some(k => keys[k])
			const lerpFactor = snap ? 1.0
				: isMoving ? Math.min(0.35, 0.15 + distToTarget * 0.02)
				: 0.15
			camera.position.lerp(target, lerpFactor)
			// WHY: lookAt at y+1.4 (chest/shoulder level, not waist). Higher lookAt + taller
			// camera height pushes avatar into lower frame area — feet near bottom, more scene above.
			camera.lookAt(t.x, t.y + 1.4, t.z)

			// WHY: Rotate own avatar mesh to match current yaw so it faces camera direction.
			// Capsule is symmetric so visual diff is subtle, but sets up correct orientation
			// for when we get directional avatar geometry. Three.js Y-up: rotation.y = yaw
			// where yaw=0 faces -Z (= SL north). No TerseUpdate rotation decode needed for own avatar.
			if (ownAvatarLocalId) {
				const ownMesh = meshMap.get(ownAvatarLocalId)
				if (ownMesh) ownMesh.rotation.y = yaw
			}
		}

		maybeAgentUpdate(dt, cf ?? 0)

		// ── Dead reckoning: predict own avatar position from control flags ───────
		// WHY: OSGrid and NeverWorld do not relay TerseUpdates back to the sending avatar
		// during normal movement. Without this block, avatarSLPos never updates while walking
		// → camera frozen, LocationBar coords stall. When TerseUpdates do arrive (physics
		// corrections, other grids), onTerseUpdate blends them in softly rather than snapping,
		// preventing the position oscillation that caused the previous removal of dead reckoning.
		if (avatarSLPos && ownAvatarLocalId && cf) {
			const hasFwd  = cf & (CTRL_AT_POS | CTRL_AT_NEG)
			const hasLat  = cf & (CTRL_LEFT_POS | CTRL_LEFT_NEG)
			const hasVert = cf & (CTRL_UP_POS | CTRL_UP_NEG)
			if (hasFwd || hasLat || hasVert) {
				const spd  = (cf & CTRL_FAST_AT)   ? CAM_RUN_SPEED : CAM_SPEED
				const lspd = (cf & CTRL_FAST_LEFT)  ? CAM_RUN_SPEED : CAM_SPEED
				// SL space vectors (Z-up): forward = (-sin(yaw), cos(yaw)), right = (cos(yaw), sin(yaw))
				const fX = -Math.sin(yaw), fY = Math.cos(yaw)
				const rX =  Math.cos(yaw), rY = Math.sin(yaw)
				if (cf & CTRL_AT_POS)   { avatarSLPos[0] += fX * spd  * dt; avatarSLPos[1] += fY * spd  * dt }
				if (cf & CTRL_AT_NEG)   { avatarSLPos[0] -= fX * spd  * dt; avatarSLPos[1] -= fY * spd  * dt }
				if (cf & CTRL_LEFT_POS) { avatarSLPos[0] -= rX * lspd * dt; avatarSLPos[1] -= rY * lspd * dt }
				if (cf & CTRL_LEFT_NEG) { avatarSLPos[0] += rX * lspd * dt; avatarSLPos[1] += rY * lspd * dt }
				if (cf & CTRL_UP_POS)   avatarSLPos[2] += CAM_FLY_SPEED * dt
				if (cf & CTRL_UP_NEG)   avatarSLPos[2] -= CAM_FLY_SPEED * dt
				// WHY: clamp to [1, regionSize-1] — prevents walking off the sim edge.
				// Uses sessionStore.regionSizeX/Y so var regions (e.g. 512×512) work correctly.
				avatarSLPos[0] = Math.max(1, Math.min(sessionStore.regionSizeX - 1, avatarSLPos[0]))
				avatarSLPos[1] = Math.max(1, Math.min(sessionStore.regionSizeY - 1, avatarSLPos[1]))
				avatarSLPos[2] = Math.max(0, avatarSLPos[2])
				// Move own avatar mesh to predicted position
				const ownMesh = meshMap.get(ownAvatarLocalId)
				if (ownMesh) {
					const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
					gsap.to(ownMesh.position, { x: t.x, y: t.y, z: t.z, duration: 0.08, overwrite: true })
				}
				// Update store so LocationBar stays current
				worldStore.setAvatarPos(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			}
		}

		renderer.render(scene, camera)
		labelRenderer.render(scene, camera)
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMounted(() => {
		if (!canvasRef.value) return
		debugStore.push('info', '[3D] World engine mounted — 3D mode active')

		// WHY: avatarSLPos is composable-local (let variable) — resets to null on any remount
		// (HMR, navigation away/back). Restore from worldStore.spawnPos (preferred — unclamped
		// sim-authoritative spawn position set by App.vue's always-live AGENT_SPAWN_POS handler)
		// or worldStore.avatarPos (last known position from prior session). This eliminates the
		// race condition where AGENT_SPAWN_POS arrives before WorldCanvas onMounted.
		const sp = worldStore.spawnPos
		if (sp && (sp[0] !== 0 || sp[1] !== 0 || sp[2] !== 0)) {
			avatarSLPos = [...sp]
			worldStore.setAvatarPos(sp[0], sp[1], sp[2])
			debugStore.push('info', `[3D] avatarSLPos init from spawnPos: ${sp[0].toFixed(1)},${sp[1].toFixed(1)},${sp[2].toFixed(1)}`)
		} else {
			const wp = worldStore.avatarPos
			avatarSLPos = [wp.x, wp.y, wp.z]
			debugStore.push('info', `[3D] avatarSLPos init from worldStore: ${wp.x.toFixed(1)},${wp.y.toFixed(1)},${wp.z.toFixed(1)}`)
		}
		cameraSnapRequested = true
		// WHY: Also try to restore ownAvatarLocalId from worldStore.objects so TerseUpdate
		// attribution works across remounts.
		const agId = sessionStore.agentId
		if (agId) {
			for (const [lid, obj] of worldStore.objects) {
				if (obj.pcode === 47 && obj.fullId?.toLowerCase() === agId.toLowerCase()) {
					ownAvatarLocalId = lid
					debugStore.push('info', `[3D] Restored ownAvatarLocalId=${lid} from worldStore`)
					break
				}
			}
		}

		initScene()
		requestAnimationFrame(t => { lastTime = t; animate(t) })
		window.addEventListener('keydown', onKeyDown, { passive: false })
		window.addEventListener('keyup',   onKeyUp)
		window.addEventListener('blur',    onBlur)
		// Mouse drag on canvas for look control
		canvasRef.value.addEventListener('mousedown', onMouseDown)
		window.addEventListener('mousemove', onMouseMove)
		window.addEventListener('mouseup',   onMouseUp)
		// Scroll wheel for forward/back movement; passive:false so we can preventDefault
		canvasRef.value.addEventListener('wheel', onWheel, { passive: false })
		on(S.OBJECT_UPDATE,    onObjectUpdate)
		on(S.TERSE_UPDATE,     onTerseUpdate)
		on(S.AGENT_SPAWN_POS,  onAgentSpawnPos)
		on(S.KILL_OBJECT,      onKillObject)
		on(S.TERRAIN_PATCH,    onTerrainPatch)
	})

	onUnmounted(() => {
		cancelAnimationFrame(animId)
		window.removeEventListener('keydown', onKeyDown)
		window.removeEventListener('keyup',   onKeyUp)
		window.removeEventListener('blur',    onBlur)
		window.removeEventListener('mousemove', onMouseMove)
		window.removeEventListener('mouseup',   onMouseUp)
		canvasRef.value?.removeEventListener('mousedown', onMouseDown)
		canvasRef.value?.removeEventListener('wheel', onWheel)
		off(S.OBJECT_UPDATE,   onObjectUpdate)
		off(S.TERSE_UPDATE,    onTerseUpdate)
		off(S.AGENT_SPAWN_POS, onAgentSpawnPos)
		off(S.KILL_OBJECT,     onKillObject)
		off(S.TERRAIN_PATCH,   onTerrainPatch)
		ro?.disconnect()
		renderer?.dispose()
		labelRenderer?.domElement.remove()
		for (const mesh of meshMap.values()) mesh.geometry.dispose()
		meshMap.clear()
		worldStore.clearTerrain()
		worldStore.clearAll()
	})

	return { scene, camera }
}
