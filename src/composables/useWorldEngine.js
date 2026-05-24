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

const FOLLOW_DIST   = 3.5   // metres behind avatar (third-person)
const FOLLOW_HEIGHT = 1.8   // metres above avatar feet

export function useWorldEngine(canvasRef) {
	const worldStore   = useWorldStore()
	const sessionStore = useSessionStore()
	const uiStore      = useUiStore()
	const debugStore   = useDebugStore()
	const { on, off }  = useRealtimeSocket()
	const { sendMove } = useLLUDP()

	let renderer, labelRenderer, scene, camera, animId, ro
	const meshMap = new Map()  // localId → THREE.Mesh

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
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
			// WHY: Log input-focus blocks so user can see W/S arriving but skipped.
			if (e.code === 'KeyW' || e.code === 'KeyS') console.log(`[3D] ${e.code} skipped — INPUT focused (${e.target.tagName}#${e.target.id})`)
			return
		}
		keys[e.code] = true
		if (e.code === 'KeyW' || e.code === 'KeyS') {
			console.log(`[3D] ${e.code} registered avatarSLPos=${JSON.stringify(avatarSLPos)} ownAvatarLocalId=${ownAvatarLocalId}`)
		}
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
		if (cf !== 0) console.log(`[3D] sendMove #${moveCount} cf=0x${cf.toString(16)}`)
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

	// ── Scene setup ──────────────────────────────────────────────────────────
	function initScene() {
		scene = new THREE.Scene()
		scene.background = new THREE.Color(0x87ceeb)
		scene.fog = new THREE.FogExp2(0x87ceeb, 0.002)

		camera = new THREE.PerspectiveCamera(70, 1, 0.1, 512)
		// WHY: Start at SL z=25 (Three.js y=25) — matches heartbeat camCenter default so
		// the sim receives a sensible above-ground camera while waiting for first TerseUpdate.
		// TerseUpdate snap corrects to real avatar position once sim responds.
		camera.position.set(128, 25, -128)
		camera.rotation.set(pitch, yaw, 0, 'YXZ')

		renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
		renderer.shadowMap.enabled = true
		renderer.shadowMap.type = THREE.PCFShadowMap
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
				const agId = sessionStore.agentId
				const match = obj.fullId.toLowerCase() === agId.toLowerCase()
				console.log(`[3D] pcode=47 localId=${obj.localId} fullId=${obj.fullId} agentId=${agId} match=${match}`)
			}
			if (obj.pcode === PCODE_AVATAR &&
				obj.fullId.toLowerCase() === sessionStore.agentId.toLowerCase()) {
				ownAvatarLocalId = obj.localId
				const p = obj.pos
				debugStore.push('info', `[3D] Own avatar localId=${obj.localId} pos=${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}`)
				if (p && (p[0] !== 0 || p[1] !== 0 || p[2] !== 0)) {
					avatarSLPos = p
					worldStore.setAvatarPos(p[0], p[1], p[2])
					// WHY: Edge positions (< 10 or > 246 in X/Y) indicate a region boundary.
					// Avatars stuck near edges cannot move — likely a stale sim state from
					// a previous session that ended without proper logout.
					if (p[0] < 10 || p[0] > 246 || p[1] < 10 || p[1] > 246) {
						debugStore.push('warn', `[3D] Avatar near region edge (${p[0].toFixed(0)},${p[1].toFixed(0)},${p[2].toFixed(0)}) — movement may be blocked. Re-login with "home" or teleport to 128,128.`)
					}
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
			// Update world store position
			worldStore.updateObjectPos(obj.localId, obj.pos)
			// Move the mesh
			const mesh = meshMap.get(obj.localId)
			if (mesh && obj.pos) {
				const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
				gsap.to(mesh.position, { x: t.x, y: t.y, z: t.z, duration: 0.1, overwrite: true })
			}
			// WHY: avatarSLPos drives third-person follow camera in animate().
			// Updated here (inside WS callback) — lerp in animate() smooths any jitter.
			if (obj.localId === ownAvatarLocalId && obj.pos) {
				const firstUpdate = !avatarSLPos
				avatarSLPos = obj.pos
				worldStore.setAvatarPos(obj.pos[0], obj.pos[1], obj.pos[2])
				if (firstUpdate) {
					const p = obj.pos
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
		avatarSLPos = p
		worldStore.setAvatarPos(x, y, z)
		cameraSnapRequested = true  // snap camera to new position immediately
		debugStore.push('info', `[3D] AgentMovementComplete spawn pos=${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`)
		if (x < 10 || x > 246 || y < 10 || y > 246) {
			debugStore.push('warn', `[3D] Spawn near region edge — movement may be blocked`)
		}
	}

	// ── Render loop ───────────────────────────────────────────────────────────
	let lastTime = 0
	function animate(time) {
		animId = requestAnimationFrame(animate)
		const dt = Math.min((time - lastTime) * 0.001, 0.1)
		lastTime = time

		const cf = updateCamera(dt)

		// WHY: Third-person follow camera — positions camera behind and above avatar.
		// Lerp factor 0.15 smooths latency from ~10Hz TerseUpdate into fluid motion.
		// Snap (lerp=1.0) when: Esc pressed, camera far (>8m off target), or W/S moving
		// so forward movement always resets a lost camera back to follow position.
		if (avatarSLPos && !isAltOrbit) {
			const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			const target = new THREE.Vector3(
				t.x + Math.sin(yaw) * followDist,
				t.y + FOLLOW_HEIGHT,
				t.z + Math.cos(yaw) * followDist,
			)
			const distToTarget = camera.position.distanceTo(target)
			// WHY: Only hard-snap when Esc pressed or camera is very far (>12m) from avatar.
			// Removed isMovingFwd from snap condition — pressing W/S should produce a smooth
			// glide into follow position, not a jarring teleport. The 0.15 lerp (~30 frames
			// at 60fps) gives a natural "follow" feel matching Firestorm third-person camera.
			const snap = cameraSnapRequested || distToTarget > 12
			cameraSnapRequested = false
			camera.position.lerp(target, snap ? 1.0 : 0.15)
			camera.lookAt(t.x, t.y + 1.0, t.z)
		}

		maybeAgentUpdate(dt, cf ?? 0)

		// WHY: Dead reckoning — update avatarSLPos locally when movement keys pressed.
		// Some OpenSim sims don't send TerseUpdates for own avatar; sim corrects via
		// TerseUpdate if/when it arrives. Without this, avatarSLPos freezes and the
		// location bar / camera never reflect movement. Clamp dt to 50ms to prevent
		// large jumps on tab return. SL forward dir in SL coords: fwdX = -sin(yaw),
		// fwdY = cos(yaw) (SL Y = sim north, yaw=0 faces south = -Y in three.js).
		if (avatarSLPos && controlFlags) {
			const spd = (controlFlags & CTRL_FAST_AT) ? CAM_RUN_SPEED : CAM_SPEED
			const dtClamp = Math.min(dt, 0.05)
			const fwdX = -Math.sin(yaw)
			const fwdY =  Math.cos(yaw)
			let [sx, sy, sz] = avatarSLPos
			if (controlFlags & CTRL_AT_POS) { sx += fwdX * spd * dtClamp; sy += fwdY * spd * dtClamp }
			if (controlFlags & CTRL_AT_NEG) { sx -= fwdX * spd * dtClamp; sy -= fwdY * spd * dtClamp }
			if (controlFlags & CTRL_UP_POS) sz += (isFlying ? CAM_FLY_SPEED : spd * 0.5) * dtClamp
			if (controlFlags & CTRL_UP_NEG) sz -= (isFlying ? CAM_FLY_SPEED : spd * 0.5) * dtClamp
			avatarSLPos = [sx, sy, sz]
			worldStore.setAvatarPos(sx, sy, sz)
		}

		renderer.render(scene, camera)
		labelRenderer.render(scene, camera)
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	onMounted(() => {
		if (!canvasRef.value) return
		debugStore.push('info', '[3D] World engine mounted — 3D mode active')

		// WHY: avatarSLPos is composable-local (let variable) — resets to null on any remount
		// (HMR, navigation away/back). worldStore.avatarPos is Pinia and survives remount.
		// Restore here so dead reckoning and camera work immediately without waiting for
		// the next AGENT_SPAWN_POS or ObjectUpdate. Even restoring the default (128,128,25)
		// is better than null: explore-mode camera has no avatar anchor, so A/D rotation
		// produces no visible reference when the scene has objects at real positions.
		const wp = worldStore.avatarPos
		avatarSLPos = [wp.x, wp.y, wp.z]
		cameraSnapRequested = true
		debugStore.push('info', `[3D] avatarSLPos init from worldStore: ${wp.x.toFixed(1)},${wp.y.toFixed(1)},${wp.z.toFixed(1)}`)
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
		ro?.disconnect()
		renderer?.dispose()
		labelRenderer?.domElement.remove()
		for (const mesh of meshMap.values()) mesh.geometry.dispose()
		meshMap.clear()
		worldStore.clearAll()
	})

	return { scene, camera }
}
