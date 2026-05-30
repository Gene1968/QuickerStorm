// src/composables/useWorldEngine.js — Three.js scene driven by LLUDP ObjectUpdate data
import { onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import gsap from 'gsap'
import { useWorldStore, PCODE_AVATAR } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUiStore } from '@/stores/uiStore'
import { useDebugStore } from '@/stores/debugStore'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useAudio } from './useAudio.js'
import { useTeleport } from './useTeleport.js'
import { C, S } from '@shared/protocol.js'

// SL uses Z-up; Three.js uses Y-up. Convert: THREE.Vector3(sl.x, sl.z, -sl.y)
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }

// WHY: Map SL prim PathCurve+ProfileCurve to a Three.js geometry. Reference table
// (libomv Primitive.cs PrimType): box/cylinder/prism use PathCurve=16 (Line);
// sphere/torus/tube/ring use PathCurve=32 (Circle). ProfileCurve low nibble: 0=Circle,
// 1=Square, 2=IsoTri, 3=EqualTri, 4=RightTri, 5=HalfCircle. Default unit-scale geometry;
// mesh.scale.set applies the prim's sx/sy/sz afterwards. Hollow deferred to Phase 3
// (true CSG needed); Twist + Taper applied as per-vertex deformation below.
function buildPrimGeometry(shape) {
	const pc = shape?.pathCurve ?? 16
	const pf = (shape?.profileCurve ?? 1) & 0x0F
	let geom
	if (pc === 16) {
		// HeightSegments=8 so Twist/Taper deformation has enough vertices to look smooth.
		if (pf === 0)      geom = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8)
		else if (pf === 3) geom = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 8)   // prism
		else               geom = new THREE.BoxGeometry(1, 1, 1, 2, 8, 2)
	} else if (pc === 32 || pc === 33) {
		if (pf === 5) geom = new THREE.SphereGeometry(0.5, 16, 12)
		// torus / tube / ring — Three TorusGeometry stand-in; full profile sweep is Phase 3
		else          geom = new THREE.TorusGeometry(0.35, 0.15, 12, 24)
	} else {
		geom = new THREE.BoxGeometry(1, 1, 1, 2, 8, 2)
	}
	return applyShapeDeformation(geom, shape)
}

// WHY: SL Twist + Taper applied per-vertex. Twist rotates around the path axis (Three.js
// local Y for our PathCurve=16/32 geometries) by an angle that lerps from PathTwistBegin
// at the bottom to PathTwist at the top. Taper shrinks XZ scale linearly from bottom to
// top. Both encoded as S8 with 0.01 quantization (libomv Primitive.cs TWIST_QUANTA).
// Skip torus (PathCurve=32 + non-half-circle profile) — deformation doesn't follow the
// same axis convention and would mangle the geometry.
function applyShapeDeformation(geom, shape) {
	if (!shape) return geom
	const pc = shape.pathCurve ?? 16
	const isTorusLike = (pc === 32 || pc === 33) && (shape.profileCurve & 0x0F) !== 5
	if (isTorusLike) return geom
	const twist      = (shape.pathTwist      || 0) * 0.01   // turns: -1..1
	const twistBegin = (shape.pathTwistBegin || 0) * 0.01
	const taperX     = (shape.pathTaperX     || 0) * 0.01
	const taperY     = (shape.pathTaperY     || 0) * 0.01
	if (twist === 0 && twistBegin === 0 && taperX === 0 && taperY === 0) return geom
	const pos = geom.attributes.position
	const TWO_PI = Math.PI * 2
	for (let i = 0; i < pos.count; i++) {
		let x = pos.getX(i)
		const y = pos.getY(i)
		let z = pos.getZ(i)
		// t in [0, 1] from bottom (y=-0.5) to top (y=+0.5)
		const t = y + 0.5
		// Taper: pinches/expands at top (positive value = narrow at top, SL convention)
		const sX = 1 - t * taperX
		const sZ = 1 - t * taperY
		x *= sX
		z *= sZ
		// Twist: rotation around Y axis, lerps begin → end across height
		const angle = ((1 - t) * twistBegin + t * twist) * TWO_PI
		if (angle !== 0) {
			const ca = Math.cos(angle)
			const sa = Math.sin(angle)
			const xr = x * ca - z * sa
			const zr = x * sa + z * ca
			pos.setXYZ(i, xr, y, zr)
		} else {
			pos.setXYZ(i, x, y, z)
		}
	}
	pos.needsUpdate = true
	geom.computeVertexNormals()
	return geom
}

// Quaternion: same axis remap as position (SL Z-up → Three Y-up). The imaginary
// components (x,y,z) carry the rotation axis × sin(θ/2), so they transform like
// a vector; w is invariant. Returns a new THREE.Quaternion.
function slQuatToThree(x, y, z, w) { return new THREE.Quaternion(x, z, -y, w) }

const CAM_SPEED      = 8    // m/s walk (camera-free explore mode only)
const CAM_RUN_SPEED  = 16   // m/s run (camera-free explore mode only)
// WHY: SL avatar physics — walk ≈ 3.2 m/s, run ≈ 5.2 m/s, fly ≈ 11 m/s. Dead
// reckoning MUST use these (not the 8/16 m/s camera speeds) or local position
// drifts ahead of the sim, putting our LocationBar 2× further than where other
// users see us in Firestorm.
const SL_WALK_SPEED  = 3.2
const SL_RUN_SPEED   = 5.2
const SL_FLY_SPEED   = 11
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
// NOTE: Always-run is NOT a ControlFlags bit. It is sent via SetAlwaysRun (Low #21).
// Bit 20 (0x00100000) is AGENT_CONTROL_NUDGE_AT_NEG and would make the sim auto-walk backward.

const FOLLOW_DIST   = 1.0   // metres behind avatar (third-person)
const FOLLOW_HEIGHT = 2.0   // metres above avatar feet
const LOOKAT_Y      = 1.25   // metres above avatar feet for camera lookAt (lower = avatar lower in frame)

export function useWorldEngine(canvasRef) {
	const worldStore   = useWorldStore()
	const sessionStore = useSessionStore()
	const uiStore      = useUiStore()
	const debugStore   = useDebugStore()
	const { on, off, emit: wsEmit }  = useRealtimeSocket()
	const { sendMove, sendSelect, sendDeselect, sendSetAlwaysRun } = useLLUDP()

	// WHY: SL/OpenSim track always-run as a sticky agent flag set via SetAlwaysRun packet
	// (Low #21), NOT via AgentUpdate ControlFlags. Send once on each toggle.
	const stopAlwaysRunWatch = watch(() => uiStore.alwaysRun, (v) => sendSetAlwaysRun(v))
	// WHY: RegionHandshake (water level + terrain textures) usually lands after the scene is
	// built — water plane starts at the default 20m and terrain is coloured against it. When the
	// real sea level arrives, reposition the water plane and recolour terrain to match.
	const stopWaterHeightWatch = watch(() => sessionStore.waterHeight, (h) => {
		if (waterMesh) waterMesh.position.y = h
		rebuildTerrainFromStore()
	})
	const stopGizmoSelWatch  = watch(() => uiStore.editObjectId,    () => refreshGizmo())
	const stopGizmoModeWatch = watch(() => uiStore.gizmoMode,        () => refreshGizmo())
	const stopGizmoVisWatch  = watch(() => uiStore.showObjectEdit, (v) => { if (!v) clearGizmo(); else refreshGizmo() })
	// WHY: Sim-side ObjectSelect must be paired with ObjectDeselect or selections leak server-side
	// (sim keeps the prim flagged for this agent forever). Single source of truth: the prim that
	// SHOULD be selected on the sim is whatever the UI is acting on — the Build Tools target while
	// the edit floater is open, otherwise the right-click context-menu target. This watcher diffs
	// that desired id against the last id we told the sim and emits only the select/deselect delta,
	// so every code path that opens/closes a menu or edit floater is covered automatically.
	let simSelectedId = null
	const stopSelSyncWatch = watch(
		[() => uiStore.showObjectEdit, () => uiStore.editObjectId, () => uiStore.objectMenu],
		() => {
			const desired = uiStore.showObjectEdit
				? uiStore.editObjectId
				: (uiStore.objectMenu?.localId ?? null)
			if (desired === simSelectedId) return
			if (simSelectedId != null) sendDeselect([simSelectedId])
			if (desired != null) sendSelect([desired])
			simSelectedId = desired
		},
	)
	const { playSound } = useAudio()
	const { requestTeleport } = useTeleport()

	let renderer, labelRenderer, scene, camera, animId, ro
	const meshMap = new Map()  // localId → THREE.Mesh
	let terrainMesh = null  // THREE.Mesh with 257×257 vertex PlaneGeometry
	let waterMesh   = null  // animated water plane
	let waterMaterial = null  // ShaderMaterial — uTime updated each frame for ripple
	// WHY: Selection gizmo — RGB arrows / rotation rings / scale handles drawn around the
	// prim selected in Build Tools. Constant world-space size relative to the prim bbox; sits
	// at scene root (not parented to mesh) so prim parent rotation doesn't twist the axes.
	let gizmoGroup    = null  // THREE.Group | null
	let gizmoMeshId   = null  // localId the gizmo is currently tracking, for repositioning

	// ── Physics state ─────────────────────────────────────────────────────────
	// WHY: simple per-session vertical velocity for gravity. SL standard g ≈ 9.8 m/s².
	// Reset on fly/teleport. Terminal velocity caps fall so jumps off cliffs don't accelerate forever.
	let vertVel = 0
	const GRAVITY       = 9.8   // m/s²
	const TERMINAL_VEL  = 50    // m/s downward cap
	const FOOT_CLEAR    = 1.0   // m — capsule centre above terrain surface when grounded
	// WHY: SL jump impulse — peak height = JUMP_VEL² / (2·GRAVITY). 5.5 m/s → ~1.54m peak,
	// matching SL physics. FS goes higher (~2m) because it uses a slightly larger force;
	// 5.5 is the OpenSim canonical value. Edge-triggered: applied once on E keydown.
	const JUMP_VEL      = 5.5
	const GROUNDED_EPS  = 0.2   // m — foot within this much of groundZ counts as grounded

	// WHY: Bilinear-interpolated terrain height at SL coord (slX, slY). Stride matches
	// worldStore.TERRAIN_STRIDE (513). Clamped 1px short of stride edge for the +1 index.
	function sampleTerrainHeight(slX, slY) {
		const stride  = worldStore.TERRAIN_STRIDE
		const heights = worldStore.terrainHeights
		if (!heights || heights.length === 0) return 0
		const maxIdx = stride - 1.001
		const x = Math.max(0, Math.min(maxIdx, slX))
		const y = Math.max(0, Math.min(maxIdx, slY))
		const x0 = Math.floor(x), y0 = Math.floor(y)
		const x1 = x0 + 1, y1 = y0 + 1
		const fx = x - x0, fy = y - y0
		const h00 = heights[y0 * stride + x0]
		const h10 = heights[y0 * stride + x1]
		const h01 = heights[y1 * stride + x0]
		const h11 = heights[y1 * stride + x1]
		return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy
	}

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
	let prevGoUp  = false  // edge-trigger jump impulse only on the keydown frame

	// WHY: Esc or W-press when camera is displaced snaps camera back to follow position.
	// Flag set in onKeyDown (Escape) or detected via distance in animate().
	let cameraSnapRequested = false

	// WHY: Smoothed lookAt target. avatarSLPos jitters every frame (gravity re-samples
	// terrain, terse blend fights dead reckoning). Pointing the camera at the RAW point
	// each frame snapped the view angle → whole scene bobbed up/down. Lerp the focus point
	// separately (slower than position) so the view glides. Mirrors Firestorm, which smooths
	// the camera focus in avatar space because "the avatar moves too jerkily in global space".
	let camLook     = new THREE.Vector3()
	let camLookInit = false
	const _v3a      = new THREE.Vector3()  // scratch — reused for per-frame lookAt target
	// Frame-rate-independent lerp rates (larger = snappier). POS faster than LOOK so the
	// camera tracks position while the view angle eases. Half-life ≈ ln(2)/rate seconds.
	const CAM_POS_RATE  = 12  // ~0.06s half-life
	const CAM_LOOK_RATE = 8   // ~0.09s half-life — slower glide on rotation

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
		'Home',
	]

	function syncGizmoModeFromModifiers(e) {
		if (!uiStore.showObjectEdit) return
		const ctrl = e.ctrlKey || e.metaKey
		const shift = e.shiftKey
		const next = ctrl && shift ? 'scale' : ctrl ? 'rotate' : 'move'
		if (uiStore.gizmoMode !== next) uiStore.setGizmoMode(next)
	}

	function onKeyDown(e) {
		// WHY: modifier-only updates need to flow even when focus is in an input — but mode
		// reset on keyup of Ctrl/Shift only matters in the canvas. Keep the input early-return
		// for non-modifier keys to avoid hijacking text fields.
		if (e.code === 'ControlLeft' || e.code === 'ControlRight'
			|| e.code === 'ShiftLeft' || e.code === 'ShiftRight'
			|| e.code === 'MetaLeft' || e.code === 'MetaRight') {
			syncGizmoModeFromModifiers(e)
		}
		if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
		keys[e.code] = true
		if (e.code === 'KeyF' || e.code === 'Home') {
			isFlying = !isFlying
			uiStore.setFlying(isFlying)
			e.preventDefault()
			return
		}
		// WHY: Esc exits orbit and glides camera back to follow position behind avatar.
		// No instant snap — animate()'s lerp provides smooth ~0.25s glide-back.
		// Reset zoom distance so Esc is useful even when only scroll displaced the camera.
		if (e.code === 'Escape' && avatarSLPos) {
			followDist = FOLLOW_DIST
			isAltOrbit = false
			isDragging = false
			e.preventDefault()
			return
		}
		if (MOVE_KEYS.includes(e.code)) e.preventDefault()
	}
	function onKeyUp(e) {
		keys[e.code] = false
		if (e.code === 'ControlLeft' || e.code === 'ControlRight'
			|| e.code === 'ShiftLeft' || e.code === 'ShiftRight'
			|| e.code === 'MetaLeft' || e.code === 'MetaRight') {
			syncGizmoModeFromModifiers(e)
		}
	}
	// WHY: When the window loses focus (tab switch, alt-tab), keyup events are not delivered.
	// Keys appear stuck and the avatar spins / walks indefinitely.
	// Clear all held keys and mouse drag state on blur to prevent this.
	// WHY: Keep isAltOrbit on blur — frozen orbit survives alt-tab; only isDragging clears.
	function onBlur() {
		for (const k in keys) keys[k] = false
		isDragging = false
		eHoldTime  = 0
	}

	// WHY: Enter alt-orbit by deriving radius/yaw/pitch from current camera position
	// relative to pivot. Without this, orbit entry teleports the camera to a default
	// shape (radius=8, fixed pitch) — visible "jump" on the first alt+drag pixel.
	function enterOrbit() {
		if (avatarSLPos) {
			orbitPivot.copy(slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2]))
		} else {
			const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw))
			orbitPivot.copy(camera.position).addScaledVector(fwd, orbitRadius)
			orbitPivot.y = 0
		}
		const dx = camera.position.x - orbitPivot.x
		const dy = camera.position.y - orbitPivot.y
		const dz = camera.position.z - orbitPivot.z
		const r  = Math.sqrt(dx * dx + dy * dy + dz * dz)
		orbitRadius = Math.max(2, Math.min(64, r))
		orbitPitch  = Math.asin(dy / orbitRadius)
		orbitYaw    = Math.atan2(dx, dz)
		isAltOrbit  = true
	}

	// WHY: Camera preset selector — receives a name and locks orbit at a canonical angle.
	// Dispatched from CameraControlsFloater preset buttons via window CustomEvent so the
	// component doesn't have to import or thread engine state through props.
	// 'rear'  → behind avatar (= default follow yaw)
	// 'front' → in front of avatar, looking back
	// 'side'  → to avatar's left, looking right
	// 'tpp'   → alias for rear (FS preset naming)
	const PRESET_DIST  = 5.0
	const PRESET_PITCH = 0.35   // ~20° above horizontal — same vibe as default follow
	function setCameraPreset(name) {
		if (!camera || !avatarSLPos) return
		orbitPivot.copy(slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2]))
		orbitRadius = PRESET_DIST
		orbitPitch  = PRESET_PITCH
		switch (name) {
			case 'rear':
			case 'tpp':   orbitYaw = yaw;                      break
			case 'front': orbitYaw = yaw + Math.PI;            break
			case 'side':  orbitYaw = yaw - Math.PI / 2;        break
			default: return
		}
		isAltOrbit = true
		isDragging = false
	}
	function onCameraPreset(e) { setCameraPreset(e?.detail?.name) }

	// WHY: Camera Track pan — shift orbit pivot in screen-relative directions.
	// Detail: { dir: 'left'|'right'|'up'|'down', step: metres }. Pivot moves in the
	// camera's view-perpendicular axes so the avatar slides across the frame.
	function onCameraTrack(e) {
		if (!camera) return
		const dir = e?.detail?.dir
		const step = e?.detail?.step ?? 0.5
		if (!isAltOrbit) enterOrbit()
		// Camera right/forward vectors in Three.js world space derived from orbitYaw.
		// Camera looks from (sin*r*cos(p), sin(p)*r, cos*r*cos(p)) toward pivot.
		// View dir (pivot - cam) projected to xz plane = (-sin(yaw), 0, -cos(yaw)).
		// Right = (cos(yaw), 0, -sin(yaw)).
		const ry = orbitYaw
		switch (dir) {
			case 'left':   orbitPivot.x -= Math.cos(ry) * step; orbitPivot.z += Math.sin(ry) * step; break
			case 'right':  orbitPivot.x += Math.cos(ry) * step; orbitPivot.z -= Math.sin(ry) * step; break
			case 'up':     orbitPivot.y += step;                                                       break
			case 'down':   orbitPivot.y -= step;                                                       break
			case 'reset':  if (avatarSLPos) orbitPivot.copy(slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])); break
		}
	}

	// WHY: Alt+click camera focal-point pick — raycast against terrain + objects, set
	// orbitPivot to hit point so user can zoom/orbit around any clicked feature. Matches
	// SL/Firestorm behaviour (Alt-LMB-click sets focus, Alt-LMB-drag orbits around it).
	function enterOrbitAt(pivot) {
		orbitPivot.copy(pivot)
		const dx = camera.position.x - pivot.x
		const dy = camera.position.y - pivot.y
		const dz = camera.position.z - pivot.z
		const r  = Math.hypot(dx, dy, dz)
		orbitRadius = Math.max(2, Math.min(128, r))
		orbitPitch  = Math.asin(dy / orbitRadius)
		orbitYaw    = Math.atan2(dx, dz)
		isAltOrbit  = true
	}

	function onMouseDown(e) {
		if (e.button !== 0) return
		// WHY: Build Tools open → left-click picks prim for selection. Avoid hijacking
		// alt+click (camera focus) — alt path falls through below. Ctrl/Shift modifiers
		// pass through too so the user can pre-set the gizmo mode while clicking.
		if (!e.altKey && uiStore.showObjectEdit && canvasRef.value && camera) {
			const rect = canvasRef.value.getBoundingClientRect()
			_pickNdc.set(
				((e.clientX - rect.left) / rect.width) * 2 - 1,
				-((e.clientY - rect.top) / rect.height) * 2 + 1,
			)
			_raycaster.setFromCamera(_pickNdc, camera)
			_raycaster.far = 1000
			const primTargets = []
			meshMap.forEach((m, lid) => {
				if (lid === ownAvatarLocalId) return
				const o = worldStore.objects.get(lid)
				if (!o || o.pcode === PCODE_AVATAR) return
				primTargets.push(m)
			})
			const hits = _raycaster.intersectObjects(primTargets, true)
			if (hits.length > 0) {
				let m = hits[0].object
				while (m && m.userData?.localId === undefined) m = m.parent
				if (m?.userData?.localId != null) {
					// WHY: stopSelSyncWatch reacts to editObjectId and emits the ObjectSelect.
					uiStore.editObjectId = m.userData.localId
					return
				}
			}
			// Miss — clicked terrain/water/sky/avatar: drop selection.
			uiStore.editObjectId = null
			return
		}
		if (!e.altKey) return   // WHY: regular drag disabled — only alt+drag active
		isDragging = true
		lastMouseX = e.clientX
		lastMouseY = e.clientY
		// WHY: Alt+click raycasts terrain/objects to set new pivot. Miss → fall back to
		// avatar-centred orbit (preserves angles/radius if already orbiting).
		if (canvasRef.value && camera) {
			const rect = canvasRef.value.getBoundingClientRect()
			_pickNdc.set(
				((e.clientX - rect.left) / rect.width) * 2 - 1,
				-((e.clientY - rect.top) / rect.height) * 2 + 1,
			)
			_raycaster.setFromCamera(_pickNdc, camera)
			_raycaster.far = 1000
			const targets = []
			if (terrainMesh) targets.push(terrainMesh)
			meshMap.forEach((m) => targets.push(m))
			const hits = _raycaster.intersectObjects(targets, true)
			if (hits.length > 0) {
				enterOrbitAt(hits[0].point)
				return
			}
		}
		if (!isAltOrbit) enterOrbit()
	}
	function onMouseMove(e) {
		if (!isDragging || !isAltOrbit) return
		const dx = e.clientX - lastMouseX
		const dy = e.clientY - lastMouseY
		lastMouseX = e.clientX
		lastMouseY = e.clientY
		// WHY: Alt-drag L/R orbits camera around pivot; U/D zooms (matches SL alt+drag).
		// Zoom is proportional to current radius for consistent feel at any distance.
		orbitYaw    -= dx * MOUSE_SENSITIVITY
		orbitRadius  = Math.max(2, Math.min(64, orbitRadius - dy * orbitRadius * 0.008))
	}
	// WHY: Mouse-up freezes orbit position — camera stays where user left it.
	// isAltOrbit stays true; cleared by Esc, reset button, or avatar movement.
	function onMouseUp() { isDragging = false }

	function onDblClick(e) {
		if (!canvasRef.value || !camera || !terrainMesh) return
		const rect = canvasRef.value.getBoundingClientRect()
		_pickNdc.set(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1,
		)
		_raycaster.setFromCamera(_pickNdc, camera)
		_raycaster.far = 1000
		const hits = _raycaster.intersectObject(terrainMesh, false)
		if (!hits.length) return
		// THREE coords: x=SL.x, y=SL.z, z=-SL.y → invert to SL
		const p = hits[0].point
		requestTeleport({ x: p.x, y: -p.z, z: p.y + 0.5 })
	}

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
		const alt   = keys['AltLeft']   || keys['AltRight']
		const turn  = CAM_TURN_SPEED * dt
		const spd   = (shift ? CAM_RUN_SPEED : CAM_SPEED) * dt
		const fly   = CAM_FLY_SPEED * dt

		// WHY: Alt+A/D orbits camera left/right; Alt+E/C orbits up/down (full FS-style vertical
		// range — true straight-up/down allowed, only ε prevents gimbal singularity).
		// Alt+W/S zooms camera in/out toward pivot with acceleration: deceleration as radius
		// approaches the pivot (so you can get to centimetre values), no upper limit (zoom out
		// to hundreds of metres). Intercept before normal yaw/fly path so avatar does NOT rotate.
		const altOrbitKey = keys['KeyA'] || keys['KeyD'] || keys['ArrowLeft'] || keys['ArrowRight']
			|| keys['KeyE'] || keys['KeyC']
			|| keys['KeyW'] || keys['KeyS'] || keys['ArrowUp'] || keys['ArrowDown']
		if (alt && altOrbitKey) {
			if (!isAltOrbit) enterOrbit()
			// WHY: Alt+A swings camera LEFT around pivot (orbitYaw decreases); Alt+D right.
			// Three.js orbit formula: increasing orbitYaw moves camera to +X side (right of avatar).
			if (keys['KeyA'] || keys['ArrowLeft'])  orbitYaw -= turn
			if (keys['KeyD'] || keys['ArrowRight']) orbitYaw += turn
			if (keys['KeyE']) orbitPitch = Math.min(Math.PI / 2 - 0.001, orbitPitch + turn)
			if (keys['KeyC']) orbitPitch = Math.max(-Math.PI / 2 + 0.001, orbitPitch - turn)
			// Alt+W/S: zoom in/out. Speed proportional to current radius so:
			//   - large radius → fast metres/sec (accelerates as you zoom out)
			//   - tiny radius  → small metres/sec (decelerates near pivot, can reach cm)
			// Floor at 0.01m, no upper cap.
			const zoomRate = Math.max(0.05, orbitRadius * 1.2) * dt
			if (keys['KeyW'] || keys['ArrowUp'])   orbitRadius = Math.max(0.01, orbitRadius - zoomRate)
			if (keys['KeyS'] || keys['ArrowDown']) orbitRadius = orbitRadius + zoomRate
		}

		if (isAltOrbit) {
			// Alt-orbit: update camera position only. ZERO control flags returned so avatar
			// doesn't walk/turn/fly while user is moving the camera.
			const cx = orbitPivot.x + orbitRadius * Math.sin(orbitYaw) * Math.cos(orbitPitch)
			const cy = orbitPivot.y + orbitRadius * Math.sin(orbitPitch)
			const cz = orbitPivot.z + orbitRadius * Math.cos(orbitYaw) * Math.cos(orbitPitch)
			camera.position.set(cx, cy, cz)
			camera.lookAt(orbitPivot)
			return 0
		}

		// WHY: alt held but no orbit (e.g. only alt held with no W/A/S/D/E/C) — still must NOT
		// rotate or move avatar. Suppress all walk/turn flags, but keep CTRL_FLY sustained so
		// sim doesn't drop the avatar out of the air mid-camera-adjustment.
		if (alt) return isFlying ? CTRL_FLY : 0

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
			if (eHoldTime >= 1.5 && !isFlying) { isFlying = true; uiStore.setFlying(true) }
		} else {
			eHoldTime = 0
		}
		// WHY: Edge-triggered jump impulse. Continuous Z push (old behaviour) gave a tiny
		// fly-like rise instead of a real jump. On E keydown when grounded and not flying,
		// set vertVel = JUMP_VEL; gravity loop carries the parabolic arc + landing.
		if (goUp && !prevGoUp && !isFlying && avatarSLPos && worldStore.terrainPatchCount > 0) {
			const gZ = sampleTerrainHeight(avatarSLPos[0], avatarSLPos[1]) + FOOT_CLEAR
			if (avatarSLPos[2] - gZ < GROUNDED_EPS) vertVel = JUMP_VEL
		}
		prevGoUp = goUp

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
			// WHY: Sim interest list culls ObjectUpdate replies by far/draw-distance.
			// 128m left ~97% of cache-miss requests unsatisfied in a sparse-corner spawn
			// (4338 cached IDs requested → 44 ObjectUpdates returned over 70s). Firestorm
			// default is 256m; matches FS behaviour and quadruples interest-list radius.
			far:       256,
		})
	}

	// WHY: Camera position reporting replaced by worldStore.setAvatarPos() calls
	// in onObjectUpdate/onTerseUpdate. LocationBar reads worldStore.avatarPos directly.

	// WHY: Topo coloring matches spec: teal near water, green mid, stone high.
	// Band values are authored in sRGB (the colors a designer would pick); we
	// convert to linear via srgbToLinear because Three r152+ outputs sRGB and
	// expects vertex colors in linear space — uncorrected sRGB values get
	// gamma-applied at output and look washed out (#527959 → #9ab69f → fog
	// blend → #acc2b1 in the viewer). Returns [r, g, b] in 0–1 linear.
	function heightColor(h) {
		// WHY: bands are anchored to the region's actual sea level W (from RegionHandshake),
		// not a hardcoded 20m. d = metres above water. Narrow sand band at the wave wash
		// (W±1m) blends shoreline from grass→sand→water; ground a couple metres above water
		// reads grass, not desert. Re-anchoring fixed the beige-flatland look on regions whose
		// water level ≠ 20m. See [[var-region-terrain-fix]].
		const SAND  = [0.85, 0.78, 0.58]  // pale beige
		const GRASS = [0.29, 0.49, 0.35]
		const TAN   = [0.68, 0.62, 0.45]  // dry low-land tan, between green and sand
		const d = h - sessionStore.waterHeight
		let rgb
		if      (d <= -20) rgb = [0.08, 0.30, 0.60]                                          // deep
		else if (d <= -10) rgb = lerpRgb([0.16, 0.50, 0.83], [0.25, 0.55, 0.45], (d + 20) / 10)  // shallow → low land
		else if (d <=  -1) rgb = lerpRgb([0.25, 0.55, 0.45], TAN,                (d + 10) / 9)    // low land → tan
		else if (d <=   1) rgb = lerpRgb(TAN, SAND,                              (d + 1) / 2)     // tan → sand at shoreline
		else if (d <=   3) rgb = lerpRgb(SAND, GRASS,                            (d - 1) / 2)     // sand → grass quickly
		else if (d <=  30) rgb = lerpRgb(GRASS, [0.45, 0.42, 0.35],             (d - 3) / 27)     // grass → earthy
		else               rgb = lerpRgb([0.45, 0.42, 0.35], [0.60, 0.58, 0.58], Math.min((d - 30) / 60, 1))  // earthy → stone
		return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]
	}

	function lerpRgb(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t) }

	// sRGB → linear conversion. Matches THREE.Color.convertSRGBToLinear (pow 2.4
	// with a small linear toe), but we just need approximate so pow(2.2) is fine.
	function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }

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
		// WHY: PlaneGeometry(rx,ry) rotateX(-π/2) + translate(rx/2, 0, -ry/2) puts
		// mesh vertex iy=0 at Three Z=-ry (north) and iy=ry at Three Z=0 (south).
		// Avatar SL slY maps to Three Z=-slY (slToThree). Therefore avatar at slY
		// stands on mesh vertex iy=ry-slY, not iy=slY. Writing heights at iy=slY
		// produced a north-south mirror that was invisible in flat regions but
		// caused "walking on water" / "sinking into hill" where heights varied by slY.
		for (let slY = 0; slY <= ry; slY++) {
			const iy = ry - slY
			for (let slX = 0; slX <= rx; slX++) {
				const hIdx = slY * hStride + slX
				const vi   = iy * vStride + slX
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
		// WHY: FogExp2 0.002 fades to ~0 by ~700m which clipped neighbor-region objects in
		// horizon view. 0.0006 keeps haze visible without truncating distant objects past
		// region edges. Tune per future scene-detail measurements.
		scene.fog = new THREE.FogExp2(0x87ceeb, 0.0006)

		// WHY far=4096: previous 1024 clipped objects past ~1km. SL standard draw distance is
		// 64–512m but neighbor regions + cross-region context need more headroom. 4096 covers
		// 4×4 region cluster (1024m) plus margin without z-buffer precision loss at near=0.1.
		camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4096)
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

		// Add vertex color attribute — updated per patch in onTerrainPatch.
		// Initial fill matches heightColor(20) = mid-green; stored in LINEAR
		// space so the sRGB renderer pipeline outputs the intended hue.
		const vtxColors = new Float32Array(terrainGeo.attributes.position.count * 3)
		const [ir, ig, ib] = heightColor(20)
		for (let i = 0; i < vtxColors.length; i += 3) {
			vtxColors[i]     = ir
			vtxColors[i + 1] = ig
			vtxColors[i + 2] = ib
		}
		terrainGeo.setAttribute('color', new THREE.BufferAttribute(vtxColors, 3))

		terrainMesh = new THREE.Mesh(
			terrainGeo,
			new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
		)
		scene.add(terrainMesh)

		// WHY: ONE giant water plane covers in-region AND horizon — no seam, no abrupt
		// region-edge cutoff. Ripples drawn as fragment-shader brightness modulation in
		// world XZ (not vertex displacement) so a sparse mesh works; detail fades with
		// distance from camera so far water reads smooth. Mirrors Firestorm's seamless
		// ocean appearance. Opacity tuned to "good before" baseline (0.5x); no fresnel
		// or specular — user found that look too busy.
		waterMaterial = new THREE.ShaderMaterial({
			uniforms: {
				uTime:    { value: 0 },
				uColor:   { value: new THREE.Color(0x2266aa) },
				uOpacity: { value: 0.75 },
			},
			vertexShader: `
				varying vec3 vWorld;
				void main() {
					vec4 worldPos = modelMatrix * vec4(position, 1.0);
					vWorld = worldPos.xyz;
					gl_Position = projectionMatrix * viewMatrix * worldPos;
				}
			`,
			fragmentShader: `
				uniform float uTime;
				uniform vec3 uColor;
				uniform float uOpacity;
				varying vec3 vWorld;
				void main() {
					float d = distance(cameraPosition.xz, vWorld.xz);
					// Ripples crisp under ~60 m, faded out by ~250 m.
					float near = 1.0 - smoothstep(70.0, 230.0, d);
					float r1 = sin(vWorld.x * 1.80 + uTime * 1.10);
					float r2 = sin(vWorld.z * 1.55 + uTime * 0.90);
					float r3 = sin((vWorld.x + vWorld.z) * 0.95 + uTime * 0.65);
					float ripple = (r1 + r2 + 0.7 * r3) / 2.7;
					vec3 col = uColor + ripple * 0.055 * near;
					gl_FragColor = vec4(col, uOpacity);
				}
			`,
			transparent: true,
			depthWrite: false,
			side: THREE.FrontSide,
		})
		const OCEAN_SIZE = 8192
		waterMesh = new THREE.Mesh(
			new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 4, 4),
			waterMaterial,
		)
		waterMesh.rotation.x = -Math.PI / 2
		// WHY: y = region water level from RegionHandshake (SL default 20, but var-region/estate
		// sims set custom levels). Re-applied by the sessionStore.waterHeight watcher if it arrives
		// after the scene is built.
		waterMesh.position.set(rx / 2, sessionStore.waterHeight, -ry / 2)
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

	// WHY: Hovertext label — CSS2DObject above prim mesh. Phase 2 baseline: text from
	// ObjectUpdate.Text (Variable1), color from ObjectUpdate.TextColor (4B inverted bytes,
	// already decoded server-side to 0..1 floats). Position y=0.7 is in local pre-scale
	// space so taller prims push the label further up — matches SL behaviour roughly.
	function applyHoverText(mesh, obj) {
		const text = obj.text || ''
		if (!text) {
			if (mesh.userData.hoverLabel) {
				mesh.remove(mesh.userData.hoverLabel)
				mesh.userData.hoverDiv = null
				mesh.userData.hoverLabel = null
			}
			return
		}
		let div = mesh.userData.hoverDiv
		if (!div) {
			div = document.createElement('div')
			div.style.cssText = 'font-size:0.7rem;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.9);white-space:pre;pointer-events:none;text-align:center;'
			const label = new CSS2DObject(div)
			label.position.set(0, 0.7, 0)
			mesh.add(label)
			mesh.userData.hoverDiv   = div
			mesh.userData.hoverLabel = label
		}
		if (div.textContent !== text) div.textContent = text
		const c = obj.textColor
		div.style.color = c
			? `rgba(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)},${c[3].toFixed(2)})`
			: '#ffffff'
	}

	// ── Selection gizmo (Phase 2 visual scaffold) ────────────────────────────
	// WHY: Drawn at scene root and repositioned each frame in animate() — keeping it
	// scene-level (not as a child of the prim mesh) means the prim's rotation doesn't
	// rotate the axes, and gizmo size stays consistent even when the prim has a tiny
	// localScale (we set our own scale from the mesh's world bbox).
	function clearGizmo() {
		if (!gizmoGroup) return
		gizmoGroup.traverse(c => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose() } })
		gizmoGroup.parent?.remove(gizmoGroup)
		gizmoGroup  = null
		gizmoMeshId = null
	}

	// SL convention for axis colors: X=red, Y=green, Z=blue. Matches FS prim handles.
	const _GIZMO_X = 0xff5555
	const _GIZMO_Y = 0x55ff55
	const _GIZMO_Z = 0x5588ff

	function _buildArrow(color, dir) {
		// Shaft + cone head pointing along +dir (length 1, head at tip).
		const grp = new THREE.Group()
		const shaftLen = 0.78
		const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92 })
		const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, shaftLen, 10), shaftMat)
		shaft.position.y = shaftLen / 2
		const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 12), shaftMat)
		head.position.y = shaftLen + 0.11
		grp.add(shaft); grp.add(head)
		// Rotate group so +Y of grp aligns with dir. Three.js +Y is the cylinder axis.
		grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
		grp.renderOrder = 999  // draw over scene
		return grp
	}

	function _buildRing(color, axis) {
		const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
		const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.02, 8, 48), mat)
		// Torus is in XY plane by default. Orient so its axis points along the requested axis.
		if (axis === 'x') ring.rotation.y = Math.PI / 2  // XY → YZ plane (axis = X)
		else if (axis === 'y') ring.rotation.x = Math.PI / 2 // XY → XZ plane (axis = Y)
		// z axis: default orientation already correct
		ring.renderOrder = 999
		return ring
	}

	function _buildHandle(color, dir) {
		const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.92 })
		const grp = new THREE.Group()
		const shaftLen = 0.78
		const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, shaftLen, 8), mat)
		shaft.position.y = shaftLen / 2
		const cube = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat)
		cube.position.y = shaftLen + 0.08
		grp.add(shaft); grp.add(cube)
		grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
		grp.renderOrder = 999
		return grp
	}

	function buildGizmoForMode(mode) {
		const root = new THREE.Group()
		const X = new THREE.Vector3(1, 0, 0)
		const Y = new THREE.Vector3(0, 1, 0)
		const Z = new THREE.Vector3(0, 0, 1)
		if (mode === 'rotate') {
			root.add(_buildRing(_GIZMO_X, 'x'))
			root.add(_buildRing(_GIZMO_Y, 'y'))
			root.add(_buildRing(_GIZMO_Z, 'z'))
		} else if (mode === 'scale') {
			root.add(_buildHandle(_GIZMO_X, X)); root.add(_buildHandle(_GIZMO_X, X.clone().negate()))
			root.add(_buildHandle(_GIZMO_Y, Y)); root.add(_buildHandle(_GIZMO_Y, Y.clone().negate()))
			root.add(_buildHandle(_GIZMO_Z, Z)); root.add(_buildHandle(_GIZMO_Z, Z.clone().negate()))
		} else {
			// 'move' arrows — both directions per axis so prim handles read like FS.
			root.add(_buildArrow(_GIZMO_X, X)); root.add(_buildArrow(_GIZMO_X, X.clone().negate()))
			root.add(_buildArrow(_GIZMO_Y, Y)); root.add(_buildArrow(_GIZMO_Y, Y.clone().negate()))
			root.add(_buildArrow(_GIZMO_Z, Z)); root.add(_buildArrow(_GIZMO_Z, Z.clone().negate()))
		}
		return root
	}

	function refreshGizmo() {
		if (!scene) return
		const id = uiStore.editObjectId
		if (!uiStore.showObjectEdit || !id) { clearGizmo(); return }
		const mesh = meshMap.get(id)
		if (!mesh) { clearGizmo(); return }
		clearGizmo()
		gizmoGroup  = buildGizmoForMode(uiStore.gizmoMode || 'move')
		gizmoMeshId = id
		scene.add(gizmoGroup)
		positionGizmo()
	}

	function positionGizmo() {
		if (!gizmoGroup || !gizmoMeshId || !camera) return
		const mesh = meshMap.get(gizmoMeshId)
		if (!mesh) { clearGizmo(); return }
		mesh.updateWorldMatrix?.(true, false)
		// WHY: world-axis bbox center sits dead-center of the selection on all 3 planes
		// regardless of prim rotation — matches FS, which centers handles on the selection.
		const bbox = new THREE.Box3().setFromObject(mesh)
		const ctr  = new THREE.Vector3(); bbox.getCenter(ctr)
		gizmoGroup.position.copy(ctr)
		// WHY: constant on-screen size like FS — gizmo spans a fixed fraction of viewport
		// height regardless of zoom or prim extent (old code scaled to the prim's max
		// half-extent, so a 53m prim produced a 33m gizmo towering over the region). World
		// height visible at distance d is 2·d·tan(fov/2); our gizmo's native full span is
		// ~2 units, so scaling by frac·d·tan(fov/2) holds it at ~frac of the canvas tall.
		const d = camera.position.distanceTo(ctr)
		const halfFov = (camera.fov * Math.PI / 180) / 2
		const SCREEN_FRAC = 0.18  // ~18% of viewport height, akin to FS handle sizing
		const s = Math.max(0.05, SCREEN_FRAC * d * Math.tan(halfFov))
		gizmoGroup.scale.set(s, s, s)
	}

	// ── Mesh management ───────────────────────────────────────────────────────
	// WHY: SL standard prim max = 10m. Linden megaprim spec extends to 64m; OpenSim regions
	// sometimes host genuine 256m megaprims (whole-region floors/walls). MAX raised to 256
	// so legitimate megas render. Anything beyond is decode error or pathological — render
	// as magenta placeholder (1m cube at obj.pos) so user can find/inspect rather than seeing
	// the scene quietly drop prims. Position with NaN/Inf or far outside any plausible region
	// range = no salvageable location → full skip. No MIN_PRIM_SCALE filter (Three.js handles
	// tiny meshes fine; user reported a 0.01m BOM prim was missing — guard was conservative).
	const MAX_PRIM_SCALE = 256
	const POS_MIN = -64
	const POS_MAX_XY = 1024     // var-region 512 + neighbour-sim slack
	const POS_MIN_Z = -512
	const POS_MAX_Z = 8192
	const PLACEHOLDER_COLOR = 0xff1493   // hot pink — high-contrast marker, outside hashed-HSL palette
	let skippedNoPos     = 0    // pos NaN/Inf or out of range — nowhere to draw
	let placeholderCount = 0    // bad scale → magenta 1m cube at obj.pos
	function classifySafety(obj) {
		if (obj.pcode === PCODE_AVATAR) return { ok: true }
		const p = obj.pos
		// SL convention (Firestorm "world map" etc.): unrecoverable-pos objects park at region
		// corner 0,0,0 so the owner can locate, edit, and recover them. We follow the same
		// pattern — render a hot-pink placeholder at the corner rather than dropping silently.
		if (p) {
			if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) return { placeholder: 'pos-nan', clampPos: [0, 0, 0] }
			if (p[0] < POS_MIN || p[0] > POS_MAX_XY)  return { placeholder: 'pos-x',   clampPos: [0, 0, 0] }
			if (p[1] < POS_MIN || p[1] > POS_MAX_XY)  return { placeholder: 'pos-y',   clampPos: [0, 0, 0] }
			if (p[2] < POS_MIN_Z || p[2] > POS_MAX_Z) return { placeholder: 'pos-z',   clampPos: [0, 0, 0] }
		}
		const sc = obj.scale
		if (sc) {
			if (!Number.isFinite(sc[0]) || !Number.isFinite(sc[1]) || !Number.isFinite(sc[2])) return { placeholder: 'scale-nan' }
			const maxS = Math.max(Math.abs(sc[0]), Math.abs(sc[1]), Math.abs(sc[2]))
			if (maxS > MAX_PRIM_SCALE) return { placeholder: `scale-${maxS.toFixed(0)}m` }
		}
		return { ok: true }
	}
	// WHY: Three.js multiplies a child's local transform by EVERY ancestor's scale. SL linked
	// children store absolute-metre offsets/sizes that must NOT be scaled by the root prim's
	// dimensions — yet we attach the child under the root mesh (which carries the root's prim
	// scale) so the linkset moves/rotates as a unit. We stash each prim's unparented transform
	// in userData.{baseScale,basePos} and divide the immediate prim-parent's scale back out here
	// (restoring base when unparented). Limitation: a non-uniform parent scale still slightly
	// shears a rotated child — acceptable for Phase 2; full fix needs an unscaled pivot group.
	function normalizeChildTransform(mesh) {
		const bs = mesh.userData.baseScale
		const bp = mesh.userData.basePos
		if (!bs || !bp) return
		const p = mesh.parent
		if (p && p.userData && p.userData.localId !== undefined) {
			mesh.scale.set(bs.x / p.scale.x, bs.y / p.scale.y, bs.z / p.scale.z)
			mesh.position.set(bp.x / p.scale.x, bp.y / p.scale.y, bp.z / p.scale.z)
		} else {
			mesh.scale.copy(bs)
			mesh.position.copy(bp)
		}
	}

	function upsertMesh(obj) {
		const safety = classifySafety(obj)
		if (safety.placeholder) {
			// Shallow-copy so worldStore's original record stays intact. Clamp scale to 1m,
			// drop shape so buildPrimGeometry returns a vanilla cube, drop defaultColor so
			// placeholder color applies. clampPos (if present) parks the marker at region
			// corner 0,0,0 — FS convention for unrecoverable-pos objects.
			obj = {
				...obj,
				scale:        [1, 1, 1],
				pos:          safety.clampPos ?? obj.pos,
				shape:        undefined,
				defaultColor: undefined,
				_placeholder: safety.placeholder,
			}
			placeholderCount++
			if (placeholderCount <= 10 || placeholderCount % 50 === 0) {
				debugStore.push('warn',
					`[3D] placeholder ${safety.placeholder} localId=${obj.localId} pos=${obj.pos?.map(v=>v.toFixed(0)).join(',')} (#${placeholderCount})`)
			}
		}
		let mesh = meshMap.get(obj.localId)
		const isNew = !mesh

		if (isNew) {
			const isAvatar = obj.pcode === PCODE_AVATAR
			// WHY: Capsule radius 0.33 (+10% vs old 0.30) for wider silhouette.
			// Length 0.96 gives total height 0.96 + 2×0.33 = 1.62m (~10% shorter than 1.80m).
			const geo = isAvatar
				? new THREE.CapsuleGeometry(0.33, 0.96, 4, 8)
				: buildPrimGeometry(obj.shape)
			// WHY: Both avatars AND prims use MeshBasicMaterial (unlit). MeshStandardMaterial
			// caused directional-light flicker as the mesh rotated with yaw.
			// WHY hashed-HSL fallback: legacy stand-in when TE decode produces no defaultColor.
			// Real TE color preferred; fall back keeps prims visually distinct rather than uniform grey.
			// WHY: Compressed-decoded prims (most of scene after Phase 2 prim fix) lack a real
			// TextureEntry, so they all fall back to hashedColor. Saturation 0.35 produced
			// near-white pastels that made the scene unreadable wall-to-wall. Bump to 0.6 for
			// distinguishable colors so user can tell prims apart at walking distance.
			const hashedColor = new THREE.Color().setHSL(
				((obj.localId * 2654435761) >>> 0) / 0xffffffff,
				0.6,
				0.55,
			)
			const teColor = obj.defaultColor
				? new THREE.Color(obj.defaultColor[0], obj.defaultColor[1], obj.defaultColor[2])
				: null
			const primColor = obj._placeholder ? PLACEHOLDER_COLOR : (teColor ?? hashedColor)
			const mat = new THREE.MeshBasicMaterial({ color: isAvatar ? 0x00b4d8 : primColor })
			mesh = new THREE.Mesh(geo, mat)
			mesh.userData.localId  = obj.localId
			mesh.userData.parentId = obj.parentId ?? 0

			if (isAvatar) {
				// ── Face indicator — flat box on front of upper body ─────────────────
				// WHY: Replaces the old forward-pointing orange "arm" box. Sits on the capsule
				// front face (~head height) so orbiting to the front reveals which way is forward.
				// Three.js -Z = forward. Positioned just outside capsule radius (0.33 + 0.03 = 0.36).
				const faceMat = new THREE.MeshBasicMaterial({ color: 0xffc566 })
				const faceGeo = new THREE.BoxGeometry(0.22, 0.20, 0.04)
				const faceMesh = new THREE.Mesh(faceGeo, faceMat)
				faceMesh.position.set(0, 0.40, -0.36)  // upper-body front, -Z = forward
				mesh.add(faceMesh)

				// ── Arm tubes — cylinders hanging from shoulder height ───────────────
				// WHY: Two arms tilted slightly outward give a humanoid silhouette without a
				// full rigged mesh. Shoulders sit near top of the cylindrical section (y ≈ 0.35).
				// Arm length 0.55m → center at shoulder_y − 0.275 ≈ 0.08. Tilt 18° outward.
				const armBodyMat = new THREE.MeshBasicMaterial({ color: 0x0097b5 })
				const armGeo     = new THREE.CylinderGeometry(0.08, 0.08, 0.55, 7)

				const leftArm = new THREE.Mesh(armGeo, armBodyMat)
				leftArm.position.set(-(0.33 + 0.12), 0.08, 0)  // left shoulder
				leftArm.rotation.z = Math.PI / 10               // ~18° outward lean

				const rightArm = new THREE.Mesh(armGeo, armBodyMat)
				rightArm.position.set( (0.33 + 0.12), 0.08, 0)  // right shoulder
				rightArm.rotation.z = -Math.PI / 10              // ~18° outward lean

				mesh.add(leftArm)
				mesh.add(rightArm)

				const div = document.createElement('div')
				div.style.cssText = 'color:#fff;font-size:0.75rem;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:4px;white-space:nowrap;'
				// WHY: obj.name may be absent on first ObjectUpdate (NameValue arrives later).
				// Fall back to worldStore (just upserted) then 'Avatar'. Stored on userData
				// so later ObjectUpdates can refresh the label text without recreating the mesh.
				div.textContent = obj.name || worldStore.objects.get(obj.localId)?.name || 'Avatar'
				mesh.userData.labelDiv = div
				const label = new CSS2DObject(div)
				label.position.set(0, 1.10, 0)  // WHY: capsule half-height=0.81; 0.88 puts label ~0.07m above head
				mesh.userData.label2D = label
				mesh.add(label)
			}

			// WHY: Set position BEFORE scene.add — prevents 1-frame flash at world origin.
			// Zero-pos guard: skip placement if pos is [0,0,0] (decode error); mesh stays
			// at origin temporarily but won't be at camera level for legit scene objects.
			if (obj.pos && (obj.pos[0] !== 0 || obj.pos[1] !== 0 || obj.pos[2] !== 0)) {
				const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
				mesh.position.set(t.x, t.y, t.z)
			}
			// WHY: Skip scale for avatars — capsule is fixed geometry; server scale would
			// amplify the CSS2DObject label position and push it far above the head.
			if (obj.scale && obj.pcode !== PCODE_AVATAR) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])
			// WHY: Apply quaternion rotation for prims so walls/doors point right way.
			// Skip for avatars — their orientation is driven by yaw in animate() (own) /
			// face indicator (others) and applying server rot tilts the capsule.
			if (obj.rot && obj.pcode !== PCODE_AVATAR) {
				mesh.quaternion.copy(slQuatToThree(obj.rot[0], obj.rot[1], obj.rot[2], obj.rot[3]))
			}
			// WHY: Remember the world-absolute scale/pos so normalizeChildTransform can divide a
			// prim-parent's scale back out (see helper). Avatars are never linked children.
			if (obj.pcode !== PCODE_AVATAR) {
				mesh.userData.baseScale = mesh.scale.clone()
				mesh.userData.basePos   = mesh.position.clone()
			}

			// WHY: Linked-set children carry parentId != 0. Their pos/rot from sim are in
			// parent-local space; Three.js applies them locally once mesh is added under parent.
			// If parent mesh hasn't arrived yet, attach to scene as orphan — reparent on parent spawn.
			const parentLocalId = obj.parentId ?? 0
			const parentMesh = parentLocalId ? meshMap.get(parentLocalId) : null
			if (parentMesh) parentMesh.add(mesh)
			else scene.add(mesh)
			normalizeChildTransform(mesh)
			meshMap.set(obj.localId, mesh)

			// WHY: This mesh may itself be a parent for orphans that arrived earlier. Scan and reparent.
			meshMap.forEach((other) => {
				if (other === mesh) return
				if (other.userData.parentId === obj.localId && other.parent !== mesh) {
					other.parent?.remove(other)
					mesh.add(other)
					normalizeChildTransform(other)
				}
			})
		} else {
			// Existing mesh: scale update + animated position
			if (obj.scale && obj.pcode !== PCODE_AVATAR) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])
			if (obj.rot && obj.pcode !== PCODE_AVATAR) {
				mesh.quaternion.copy(slQuatToThree(obj.rot[0], obj.rot[1], obj.rot[2], obj.rot[3]))
			}
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
			// WHY: A later full ObjectUpdate just overwrote local scale/pos with raw world values —
			// re-stash the base and re-divide the parent scale so a linked child stays normalized.
			if (obj.pcode !== PCODE_AVATAR) {
				mesh.userData.baseScale = mesh.scale.clone()
				mesh.userData.basePos   = mesh.position.clone()
				normalizeChildTransform(mesh)
			}
			// WHY: NameValue data can arrive in a later ObjectUpdate after the mesh was created.
			// Refresh label text whenever we get a real name so "Avatar" placeholder gets replaced.
			if (obj.pcode === PCODE_AVATAR && obj.name && mesh.userData.labelDiv) {
				const current = mesh.userData.labelDiv.textContent
				if (current !== obj.name) mesh.userData.labelDiv.textContent = obj.name
			}
		}
		if (obj.pcode !== PCODE_AVATAR) applyHoverText(mesh, obj)
	}

	function removeMesh(localId) {
		const mesh = meshMap.get(localId)
		if (mesh) {
			// WHY: Traverse to dispose child geometry/materials (arm indicator etc.) not just root
			mesh.traverse(child => {
				if (child.isMesh) { child.geometry.dispose(); child.material.dispose() }
			})
			// WHY: Linked-set children sit under parent mesh, not scene. Detach from actual parent.
			mesh.parent?.remove(mesh)
			meshMap.delete(localId)
		}
	}

	// ── Incoming messages ─────────────────────────────────────────────────────
	let objUpdateCount = 0
	// Prim-dropout diagnostic: receive-side counters and 5s periodic summary so we can
	// compare server-relayed prim count vs client-rendered mesh count. Failures in
	// buildPrimGeometry/upsertMesh that previously crashed the loop are now caught + counted.
	let objsReceivedTotal = 0
	let upsertMeshFailures = 0
	let lastPrimDiagAt = 0
	function onObjectUpdate(payload) {
		// WHY: useRealtimeSocket dispatches msg.d (unwrapped) to handlers, not the full {t,d} envelope.
		// So payload = { objects: [...] } — access as payload.objects, not payload.d.objects.
		const objs = payload?.objects ?? []
		objUpdateCount++
		objsReceivedTotal += objs.length
		if (objUpdateCount === 1 || objUpdateCount % 20 === 0) {
			const avCount = objs.filter(o => o.pcode === PCODE_AVATAR).length
			debugStore.push('info', `[3D] ObjectUpdate #${objUpdateCount}: ${objs.length} objects (${avCount} av) agentId=${sessionStore.agentId?.slice(0,8)}`)
		}
		const now = Date.now()
		if (now - lastPrimDiagAt >= 5000) {
			lastPrimDiagAt = now
			const primCount = worldStore.prims.length
			const avCount = worldStore.avatars.length
			debugStore.push('info', `[PrimDiag] received=${objsReceivedTotal} stored=${worldStore.objects.size} (prims=${primCount} av=${avCount}) meshes=${meshMap.size} upsertFails=${upsertMeshFailures}`)
			// Mirror to server-log via WS so server-log.txt has full client+server picture.
			wsEmit(C.CLIENT_DIAG, {
				received:     objsReceivedTotal,
				stored:       worldStore.objects.size,
				prims:        primCount,
				av:           avCount,
				meshes:       meshMap.size,
				upsertFails:  upsertMeshFailures,
				skippedNoPos,
				placeholders: placeholderCount,
			})
		}
		for (const obj of objs) {
			worldStore.upsertObject(obj)
			try {
				upsertMesh(obj)
			} catch (e) {
				upsertMeshFailures++
				if (upsertMeshFailures <= 5 || upsertMeshFailures % 25 === 0) {
					debugStore.push('warn', `[3D] upsertMesh fail #${upsertMeshFailures} localId=${obj.localId} pcode=${obj.pcode}: ${e.message}`)
				}
				continue
			}
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
					const firstOwn = ownAvatarLocalId === null
					ownAvatarLocalId = obj.localId
					// WHY: Recolor own avatar to green so it's visually distinct from other cyan avatars.
					// Material is set after mesh creation so this works whether mesh was just created
					// or already existed (e.g., duplicate ObjectUpdate).
					const ownMesh = meshMap.get(obj.localId)
					if (ownMesh) {
						ownMesh.material.color.setHex(0x00e676)
						// WHY: Own avatar mesh is placed at terrain+FOOT_CLEAR (1.0m) while other avatars
						// sit at server-reported feet position (~0m above terrain). The 1.0m extra height
						// pushes the label up in screen space; pull it back down so it appears level with
						// other avatars' labels relative to each head.
						if (ownMesh.userData.label2D) ownMesh.userData.label2D.position.setY(1.0)
					}
					// WHY: Seed yaw from sim's body rotation on first identify. Encoder pairs
					// outgoing yaw with slAngle = π/2 + yaw → bodyRot = (0, 0, sin(slAngle/2), cos(slAngle/2)).
					// Inverse: slAngle = 2 * atan2(rotZ, rotW); yaw = slAngle − π/2.
					// Without this the camera always faces north (yaw=0) even when the avatar
					// is logged in facing a different direction (e.g. from previous session).
					if (firstOwn && obj.rot && Number.isFinite(obj.rot[3])) {
						const slAngle = 2 * Math.atan2(obj.rot[2], obj.rot[3])
						yaw = slAngle - Math.PI / 2
						// normalize to [-π, π]
						while (yaw > Math.PI)  yaw -= 2 * Math.PI
						while (yaw < -Math.PI) yaw += 2 * Math.PI
						debugStore.push('info', `[3D] Initial yaw from sim: ${(yaw * 180 / Math.PI).toFixed(1)}°`)
					}
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
				// WHY: Apply rotation from TerseUpdate so other avatars visibly turn when
				// walking, and physics-driven prims (vehicles, doors animated by sim) reorient.
				// Skip own avatar — its yaw is driven locally and applying server rot would
				// fight the input-driven mesh.rotation.y in animate().
				if (obj.rot && obj.localId !== ownAvatarLocalId) {
					mesh.quaternion.copy(slQuatToThree(obj.rot[0], obj.rot[1], obj.rot[2], obj.rot[3]))
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
		// Also fires on TeleportLocal (same-region TP). Arrives before ObjectUpdate/TerseUpdate
		// for the new location, so we snap avatarSLPos, camera, AND own avatar mesh ourselves.
		const p = payload?.pos
		if (!p || p.length < 3) return
		const [x, y, z] = p
		if (x === 0 && y === 0 && z === 0) return
		avatarSLPos = [...p]  // WHY: own copy — dead reckoning mutates in-place
		worldStore.setAvatarPos(x, y, z)
		worldStore.setSpawnPos(x, y, z)  // also update persistent store for future remounts
		// WHY: Exit alt-orbit on teleport — otherwise animate() short-circuits the avatar-follow
		// camera update and the view stays stuck at the pre-TP orbit position.
		isAltOrbit = false
		isDragging = false
		followDist = FOLLOW_DIST
		cameraSnapRequested = true  // snap camera to new position immediately
		// WHY: Snap own avatar mesh too — without this it stays at pre-TP location until
		// the next ObjectUpdate/TerseUpdate, leaving camera looking at empty space.
		if (ownAvatarLocalId) {
			const ownMesh = meshMap.get(ownAvatarLocalId)
			if (ownMesh) {
				const t = slToThree(x, y, z)
				ownMesh.position.set(t.x, t.y, t.z)
			}
		}
		debugStore.push('info', `[3D] AgentMovementComplete spawn pos=${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)} (regionSize=${sessionStore.regionSizeX}×${sessionStore.regionSizeY})`)
		const rx = sessionStore.regionSizeX, ry = sessionStore.regionSizeY
		if (x < 10 || x > rx - 10 || y < 10 || y > ry - 10) {
			debugStore.push('warn', `[3D] Spawn near region edge — movement may be blocked`)
		}
	}

	// WHY: Cross-region teleport — server already swapped UDP socket onto new sim.
	// Browser side: wipe meshes/terrain/objects so the new sim's RegionHandshake +
	// LayerData + ObjectUpdates rebuild from scratch. ownAvatarLocalId is nulled so
	// re-attribution happens on the new sim's first ObjectUpdate for the agent.
	function onTeleportFinish(d) {
		debugStore.push('info', `[3D] Cross-region TP → ${d?.simIp}:${d?.simPort} (regionHandle=${d?.regionHandle}) — clearing scene`)
		meshMap.forEach((mesh) => {
			mesh.traverse(child => {
				if (child.isMesh) { child.geometry.dispose(); child.material.dispose() }
			})
			mesh.parent?.remove(mesh)
		})
		meshMap.clear()
		worldStore.clearAll()
		worldStore.clearTerrain()
		avatarSLPos = null
		ownAvatarLocalId = null
		vertVel = 0
		cameraSnapRequested = true
		// regionHandle decodes to (regionY << 32) | regionX in global meters. JSON serialised
		// as string from server (bigint) — convert via BigInt for U32 splits.
		if (d?.simIp)  sessionStore.simIp  = d.simIp
		if (d?.simPort) sessionStore.simPort = d.simPort
		if (d?.seedCap) sessionStore.seedCap = d.seedCap
		if (d?.regionHandle) {
			try {
				const h = BigInt(d.regionHandle)
				sessionStore.regionX = Number(h & 0xFFFFFFFFn)
				sessionStore.regionY = Number(h >> 32n)
			} catch { /* ignore parse error — non-blocking */ }
		}
		sessionStore.regionName = ''  // new RegionHandshake will set it
	}

	// WHY: ObjectProperties reply — merge into worldStore so right-click Inspect / Edit floater
	// see real name/description/creator/owner instead of placeholder fields.
	function onObjectProps(payload) {
		const items = payload?.items ?? []
		for (const p of items) worldStore.applyObjectProperties(p)
		if (items.length > 0) debugStore.push('info', `[3D] ObjectProperties: ${items.length} updated`)
	}

	function onKillObject(payload) {
		// WHY: Sim sends KillObject (High #16) when prims/avatars/NPCs leave or are deleted.
		// Remove from Three.js scene and worldStore so they don't persist as ghost objects.
		const ids = payload?.ids ?? []
		// WHY: Killing a linkset root must take its children with it — the sim often sends only
		// the root localId. Without cascade, child meshes detach from the (removed) parent subtree
		// visually but linger in meshMap + worldStore as ghosts. Linksets are 1-level deep (all
		// children parent directly to root), so a single non-recursive expansion covers them.
		const all = new Set(ids)
		for (const id of ids) {
			worldStore.objects.forEach((o, lid) => { if (o.parentId === id) all.add(lid) })
		}
		for (const id of all) {
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

	// WHY: Debounced missing-patch dump — fires 3s after the last TERRAIN_PATCH arrives,
	// listing any (px,py) in the expected grid that never made it from server to store.
	// Diagnostic for [[terrain-decoder-missing-patches]]. Reset on every patch so a long
	// burst only logs once at the end.
	let _missingPatchTimer = null
	function _scheduleMissingPatchDump() {
		if (_missingPatchTimer) clearTimeout(_missingPatchTimer)
		_missingPatchTimer = setTimeout(() => {
			_missingPatchTimer = null
			const rx = sessionStore.regionSizeX
			const ry = sessionStore.regionSizeY
			const missing = worldStore.getMissingPatches(rx, ry, 16)
			const total = Math.ceil(rx / 16) * Math.ceil(ry / 16)
			const got = worldStore.patchReceived.size
			if (missing.length === 0) {
				const msg = `[terrain] all ${got}/${total} patches received for ${rx}×${ry}`
				debugStore.push('info', msg)
				console.log(msg)
			} else {
				const msg = `[terrain] ${got}/${total} patches received — missing ${missing.length}: [${missing.join(' ')}]`
				debugStore.push('warn', msg)
				console.warn(msg)
			}
		}, 3000)
	}

	function onTerrainPatch(payload) {
		if (!terrainMesh) return
		const { layerType, patchSize = 16, patches } = payload
		if (layerType === 'WATER') return  // water plane height fixed at 20 for Phase 1
		_scheduleMissingPatchDump()

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
			// iy=ry-slY: see rebuildTerrainFromStore — PlaneGeometry orientation requires
			// mirroring slY → iy so heights land on the vertex avatar actually stands on.
			for (let j = 0; j <= patchSize; j++) {
				for (let i = 0; i <= patchSize; i++) {
					const slX = px * patchSize + i
					const slY = py * patchSize + j
					if (slX > rx || slY > ry) continue
					const iy = ry - slY
					const vi = iy * vStride + slX
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

	// ── Collision detection (dead-reckoning aid) ─────────────────────────────
	// WHY: Sim doesn't tell us when we bump into something for our own avatar — TerseUpdates
	// stop arriving, and other clients see us stuck while DR would march our coords through
	// the wall. Cast a short ray from the avatar in the intended SL-XY direction and check
	// for any non-own mesh in front. Hit → block step + play bump.
	const _raycaster   = new THREE.Raycaster()
	const _rayOrigin   = new THREE.Vector3()
	const _rayDir      = new THREE.Vector3()
	const COLLIDE_DIST = 0.6   // metres — avatar radius + small buffer
	const BUMP_COOLDOWN_MS = 400
	// WHY: hits whose top edge is within this much above the foot are treated as step-ups
	// (small terrain irregularities, low decorative prims, sloped ground). DR passes
	// through silently; bump is reserved for taller obstacles. SL physics uses ~0.25m.
	const STEP_UP_HEIGHT   = 0.25// To-do keep testing this to see if it feels right, could increase
	// WHY: bump only fires when truly stuck — sim refuses to move the avatar despite our
	// AgentUpdate intent. If avatarSLPos is advancing (either via DR step or sim TerseUpdate),
	// the chest ray may still hit nearby tall prims/avatars we are walking PAST, not into;
	// playing bump there is noise. Threshold: < this much horizontal motion between two
	// collision checks → treat as stuck.
	const STUCK_EPS_M      = 0.05
	let lastBumpAt = 0
	let prevCollideX = NaN
	let prevCollideY = NaN

	// WHY: Right-click on canvas → raycast against other-avatar meshes only. Hit opens
	// uiStore.avatarMenu with screen coords + target identity so AvatarContextMenu.vue can
	// render in WorldView. Miss closes any open menu. Own avatar excluded so the user can't
	// IM themselves.
	const _pickNdc = new THREE.Vector2()
	function onContextMenu(e) {
		if (!canvasRef.value || !camera) return
		e.preventDefault()
		const rect = canvasRef.value.getBoundingClientRect()
		_pickNdc.set(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-((e.clientY - rect.top) / rect.height) * 2 + 1,
		)
		_raycaster.setFromCamera(_pickNdc, camera)
		_raycaster.far = 1000
		const targets = []
		meshMap.forEach((mesh, localId) => {
			if (localId === ownAvatarLocalId) return
			const obj = worldStore.objects.get(localId)
			if (obj?.pcode !== PCODE_AVATAR) return
			targets.push(mesh)
		})
		const hits = _raycaster.intersectObjects(targets, true)
		if (hits.length > 0) {
			let hitMesh = hits[0].object
			while (hitMesh && hitMesh.userData?.localId === undefined) hitMesh = hitMesh.parent
			if (hitMesh) {
				const obj = worldStore.objects.get(hitMesh.userData.localId)
				if (obj) {
					uiStore.closeObjectMenu()
					uiStore.openAvatarMenu({
						agentId: obj.fullId,
						name:    obj.name || 'Avatar',
						localId: hitMesh.userData.localId,
						x: e.clientX,
						y: e.clientY,
					})
					return
				}
			}
		}
		// Avatar miss → try prims. Skip terrain/water/skirt (their meshes have no userData.localId).
		const primTargets = []
		meshMap.forEach((mesh, localId) => {
			if (localId === ownAvatarLocalId) return
			const obj = worldStore.objects.get(localId)
			if (!obj || obj.pcode === PCODE_AVATAR) return
			primTargets.push(mesh)
		})
		const primHits = _raycaster.intersectObjects(primTargets, true)
		if (primHits.length === 0) {
			uiStore.closeAvatarMenu()
			uiStore.closeObjectMenu()
			return
		}
		let hitMesh = primHits[0].object
		while (hitMesh && hitMesh.userData?.localId === undefined) hitMesh = hitMesh.parent
		if (!hitMesh) return
		const obj = worldStore.objects.get(hitMesh.userData.localId)
		if (!obj) return
		uiStore.closeAvatarMenu()
		uiStore.openObjectMenu({
			localId: hitMesh.userData.localId,
			fullId:  obj.fullId,
			name:    obj.name || obj.text || `Object ${hitMesh.userData.localId}`,
			pos:     obj.pos,
			x: e.clientX,
			y: e.clientY,
		})
		// WHY: Sim only sends ObjectProperties (name/creator/owner/perms) in response to an
		// explicit ObjectSelect. Opening objectMenu triggers stopSelSyncWatch, which emits the
		// ObjectSelect (and the paired ObjectDeselect once the menu/edit floater closes).
	}

	// WHY: Right-click avatar menu "Face Toward" action — set yaw so own avatar looks at target.
	// SL forward vector for yaw=0 is (-sin(0), cos(0)) = (0,1) = +SL Y. To face target T from own
	// position O: dx = T.x - O.x, dy = T.y - O.y. yaw such that (-sin(y), cos(y)) ∝ (dx, dy).
	// Solution: yaw = atan2(-dx, dy).
	function onFaceToward(e) {
		const localId = e?.detail?.localId
		if (!localId || !avatarSLPos) return
		const target = worldStore.objects.get(localId)
		if (!target?.pos) return
		const dx = target.pos[0] - avatarSLPos[0]
		const dy = target.pos[1] - avatarSLPos[1]
		if (Math.hypot(dx, dy) < 0.01) return
		yaw = Math.atan2(-dx, dy)
	}

	function checkCollision(slDirX, slDirY) {
		if (!avatarSLPos || !ownAvatarLocalId) return false
		// Avatar collision ray origin: chest height in Three.js coords.
		// SL→Three: (slX, slZ, -slY). SL dir (dx, dy, 0) → Three dir (dx, 0, -dy).
		_rayOrigin.set(avatarSLPos[0], avatarSLPos[2] + 1.0, -avatarSLPos[1])
		_rayDir.set(slDirX, 0, -slDirY).normalize()
		_raycaster.set(_rayOrigin, _rayDir)
		_raycaster.far = COLLIDE_DIST
		// Collect candidate meshes — skip own avatar, terrain, water.
		const targets = []
		for (const [lid, m] of meshMap) {
			if (lid === ownAvatarLocalId) continue
			targets.push(m)
		}
		if (targets.length === 0) return false
		const hits = _raycaster.intersectObjects(targets, false)
		if (hits.length === 0) {
			prevCollideX = avatarSLPos[0]
			prevCollideY = avatarSLPos[1]
			return false
		}
		// WHY: Step-up — if the hit mesh's top edge is within STEP_UP_HEIGHT above the
		// foot, treat as low clutter / slope and pass through silently. FS does a similar
		// physics-side step assist; without this, any low decorative prim or sloped ground
		// mesh triggers a bump on every walk cycle.
		const footY  = avatarSLPos[2]
		const hitMesh = hits[0].object
		hitMesh.updateWorldMatrix?.(true, false)
		const bbox = new THREE.Box3().setFromObject(hitMesh)
		const obstacleTopY = bbox.max.y
		if (obstacleTopY - footY < STEP_UP_HEIGHT) {
			prevCollideX = avatarSLPos[0]
			prevCollideY = avatarSLPos[1]
			return false
		}
		// WHY: Only bump when avatar is actually stuck — if we've advanced since the last
		// collision check, we're walking past a tall obstacle (or sim is pushing us through),
		// not into it. Block DR step either way to keep predicted pose conservative.
		const moved = Number.isFinite(prevCollideX)
			? Math.hypot(avatarSLPos[0] - prevCollideX, avatarSLPos[1] - prevCollideY)
			: 0
		prevCollideX = avatarSLPos[0]
		prevCollideY = avatarSLPos[1]
		if (moved < STUCK_EPS_M) {
			const now = performance.now()
			if (now - lastBumpAt > BUMP_COOLDOWN_MS) {
				lastBumpAt = now
				try { playSound('bump.mp3', 0.5) } catch {}
			}
		}
		return true
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
		// Hard-snap (lerp=1.0) only for teleport/spawn >50m (cameraSnapRequested).
		const altHeld  = keys['AltLeft'] || keys['AltRight']
		const isMoving = MOVE_KEYS.some(k => keys[k])
		// WHY: Movement cancels frozen orbit — avatar walking triggers smooth glide back
		// to follow position. EXCEPT when alt is held — alt+W/S/A/D/E/C are camera orbit
		// keys, not avatar move keys. Without the !altHeld guard, holding Alt+A clears
		// isAltOrbit every frame → orbit barely advances before being yanked back to follow.
		if (isAltOrbit && isMoving && !isDragging && !altHeld) {
			isAltOrbit = false
		}
		if (avatarSLPos && !isAltOrbit) {
			const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			const target = new THREE.Vector3(
				t.x + Math.sin(yaw) * followDist,
				t.y + FOLLOW_HEIGHT,
				t.z + Math.cos(yaw) * followDist,
			)
			const distToTarget = camera.position.distanceTo(target)
			// WHY: Hard-snap ONLY when explicitly flagged (teleport/spawn). Distance
			// heuristic removed — Esc-from-orbit can put camera >50m from follow target
			// (especially zoomed-out alt-orbit), and snapping then jumps the view instead
			// of gliding back smoothly.
			// Variable lerp: movement key held → faster glide (up to 0.35); idle or Esc exit →
			// smooth 0.15 glide (~0.25s).
			const snap = cameraSnapRequested
			cameraSnapRequested = false
			// WHY: frame-rate-independent lerp — 1 - exp(-rate*dt) gives the same smoothing
			// at 30 or 144 fps. The old fixed 0.15/frame factor under-smoothed at low fps
			// (visible stutter) and over-smoothed at high fps. Movement bumps the rate up a
			// bit so the camera keeps pace with a walking avatar.
			const posRate = isMoving ? CAM_POS_RATE + distToTarget * 1.5 : CAM_POS_RATE
			const posF = snap ? 1.0 : 1 - Math.exp(-posRate * dt)
			camera.position.lerp(target, posF)
			// WHY: lookAt at LOOKAT_Y above avatar feet. Camera at FOLLOW_HEIGHT looking
			// down at this lower point pushes avatar into lower portion of frame.
			// Smooth the focus point separately so jitter in avatarSLPos doesn't snap the
			// view angle every frame (the main cause of the scene bobbing up/down).
			const lookTarget = _v3a.set(t.x, t.y + LOOKAT_Y, t.z)
			if (snap || !camLookInit) { camLook.copy(lookTarget); camLookInit = true }
			else camLook.lerp(lookTarget, 1 - Math.exp(-CAM_LOOK_RATE * dt))
			camera.lookAt(camLook)

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
				const runSticky = uiStore.alwaysRun
				const spd  = ((cf & CTRL_FAST_AT)   || runSticky) ? SL_RUN_SPEED : SL_WALK_SPEED
				const lspd = ((cf & CTRL_FAST_LEFT) || runSticky) ? SL_RUN_SPEED : SL_WALK_SPEED
				// SL space vectors (Z-up): forward = (-sin(yaw), cos(yaw)), right = (cos(yaw), sin(yaw))
				const fX = -Math.sin(yaw), fY = Math.cos(yaw)
				const rX =  Math.cos(yaw), rY = Math.sin(yaw)
				// WHY: Raycast against scene meshes (prims/avatars) before applying the DR step.
				// If something is in the way, block that axis and play the bump SFX (rate-limited).
				// Sim already has us stuck — DR would otherwise march coords through walls and
				// LocationBar/camera diverge from where everyone else sees us.
				const dxStep = (cf & CTRL_AT_POS ? fX : 0) - (cf & CTRL_AT_NEG ? fX : 0)
				                - (cf & CTRL_LEFT_POS ? rX : 0) + (cf & CTRL_LEFT_NEG ? rX : 0)
				const dyStep = (cf & CTRL_AT_POS ? fY : 0) - (cf & CTRL_AT_NEG ? fY : 0)
				                - (cf & CTRL_LEFT_POS ? rY : 0) + (cf & CTRL_LEFT_NEG ? rY : 0)
				const stepMag = Math.hypot(dxStep, dyStep)
				let blocked = false
				if (stepMag > 0.001 && (hasFwd || hasLat)) {
					blocked = checkCollision(dxStep / stepMag, dyStep / stepMag)
				}
				if (!blocked) {
					if (cf & CTRL_AT_POS)   { avatarSLPos[0] += fX * spd  * dt; avatarSLPos[1] += fY * spd  * dt }
					if (cf & CTRL_AT_NEG)   { avatarSLPos[0] -= fX * spd  * dt; avatarSLPos[1] -= fY * spd  * dt }
					if (cf & CTRL_LEFT_POS) { avatarSLPos[0] -= rX * lspd * dt; avatarSLPos[1] -= rY * lspd * dt }
					if (cf & CTRL_LEFT_NEG) { avatarSLPos[0] += rX * lspd * dt; avatarSLPos[1] += rY * lspd * dt }
				}
				// WHY: only push Z directly while flying. On the ground the jump impulse
				// (vertVel = JUMP_VEL) drives vertical motion through the gravity loop, which
				// produces a real parabolic arc instead of a continuous lift.
				if (isFlying && (cf & CTRL_UP_POS)) avatarSLPos[2] += SL_FLY_SPEED * dt
				if (isFlying && (cf & CTRL_UP_NEG)) avatarSLPos[2] -= SL_FLY_SPEED * dt
				// WHY: clamp to [1, regionSize-1] — prevents walking off the sim edge.
				// Uses sessionStore.regionSizeX/Y so var regions (e.g. 512×512) work correctly.
				avatarSLPos[0] = Math.max(1, Math.min(sessionStore.regionSizeX - 1, avatarSLPos[0]))
				avatarSLPos[1] = Math.max(1, Math.min(sessionStore.regionSizeY - 1, avatarSLPos[1]))
				avatarSLPos[2] = Math.max(0, avatarSLPos[2])
				// Move own avatar mesh to predicted position directly (no GSAP tween).
				// WHY: Dead reckoning runs every animation frame at 60fps. Starting a GSAP
				// tween with overwrite:true 60×/sec adds tween overhead and can cause micro-stutter.
				// Direct set is sufficient — the camera lerp already provides smooth visual motion.
				const ownMesh = meshMap.get(ownAvatarLocalId)
				if (ownMesh) {
					const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
					ownMesh.position.set(t.x, t.y, t.z)
				}
				// Update store so LocationBar stays current
				worldStore.setAvatarPos(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			}
		}

		// ── Gravity + ground clamp ───────────────────────────────────────────────
		// WHY: Runs every frame regardless of input. Without input the avatar still
		// must fall toward terrain (landing after fly-off, walking off ledges).
		// Flying zeroes vertVel so toggling fly back off starts a fresh fall, not a
		// continuation of stale accumulated velocity.
		// WHY terrainPatchCount guard: sampleTerrainHeight returns 0 when heights array
		// is empty (pre-RegionHandshake or right after cross-region TP). Without the
		// guard, gravity would pull avatar to z=1 (FOOT_CLEAR over zero) and the snap-up
		// when terrain finally arrives would visibly teleport the avatar upward.
		if (avatarSLPos && ownAvatarLocalId && worldStore.terrainPatchCount > 0) {
			const groundZ = sampleTerrainHeight(avatarSLPos[0], avatarSLPos[1]) + FOOT_CLEAR
			if (isFlying) {
				vertVel = 0
			} else {
				// WHY: unconditional integration so an upward jump impulse (vertVel > 0)
				// actually carries the avatar above groundZ before gravity overcomes it.
				// Previous branching cleared vertVel any time foot started at groundZ, which
				// killed the impulse on the first frame and the jump never rose.
				vertVel = Math.max(vertVel - GRAVITY * dt, -TERMINAL_VEL)
				avatarSLPos[2] += vertVel * dt
				if (avatarSLPos[2] < groundZ) { avatarSLPos[2] = groundZ; vertVel = 0 }
			}
			const ownMesh = meshMap.get(ownAvatarLocalId)
			if (ownMesh) {
				const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
				ownMesh.position.set(t.x, t.y, t.z)
			}
			worldStore.setAvatarPos(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
		}

		if (waterMaterial) waterMaterial.uniforms.uTime.value += dt
		if (gizmoGroup) positionGizmo()

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
		window.addEventListener('qs:camera-preset', onCameraPreset)
		window.addEventListener('qs:camera-track',  onCameraTrack)
		window.addEventListener('qs:face-toward',   onFaceToward)
		// Mouse drag on canvas for look control
		canvasRef.value.addEventListener('mousedown', onMouseDown)
		window.addEventListener('mousemove', onMouseMove)
		window.addEventListener('mouseup',   onMouseUp)
		// Scroll wheel for forward/back movement; passive:false so we can preventDefault
		canvasRef.value.addEventListener('wheel', onWheel, { passive: false })
		canvasRef.value.addEventListener('contextmenu', onContextMenu)
		canvasRef.value.addEventListener('dblclick', onDblClick)
		on(S.OBJECT_UPDATE,    onObjectUpdate)
		on(S.TERSE_UPDATE,     onTerseUpdate)
		on(S.AGENT_SPAWN_POS,  onAgentSpawnPos)
		on(S.KILL_OBJECT,      onKillObject)
		on(S.TERRAIN_PATCH,    onTerrainPatch)
		on(S.TELEPORT_FINISH,  onTeleportFinish)
		on(S.OBJECT_PROPS,     onObjectProps)
	})

	onUnmounted(() => {
		stopAlwaysRunWatch()
		stopGizmoSelWatch()
		stopGizmoModeWatch()
		stopGizmoVisWatch()
		stopSelSyncWatch()
		stopWaterHeightWatch()
		// WHY: drop any lingering sim-side selection so we don't leave the prim flagged after unmount.
		if (simSelectedId != null) { sendDeselect([simSelectedId]); simSelectedId = null }
		clearGizmo()
		cancelAnimationFrame(animId)
		window.removeEventListener('keydown', onKeyDown)
		window.removeEventListener('keyup',   onKeyUp)
		window.removeEventListener('blur',    onBlur)
		window.removeEventListener('qs:camera-preset', onCameraPreset)
		window.removeEventListener('qs:camera-track',  onCameraTrack)
		window.removeEventListener('qs:face-toward',   onFaceToward)
		window.removeEventListener('mousemove', onMouseMove)
		window.removeEventListener('mouseup',   onMouseUp)
		canvasRef.value?.removeEventListener('mousedown', onMouseDown)
		canvasRef.value?.removeEventListener('wheel', onWheel)
		canvasRef.value?.removeEventListener('contextmenu', onContextMenu)
		canvasRef.value?.removeEventListener('dblclick', onDblClick)
		off(S.OBJECT_UPDATE,   onObjectUpdate)
		off(S.TERSE_UPDATE,    onTerseUpdate)
		off(S.AGENT_SPAWN_POS, onAgentSpawnPos)
		off(S.KILL_OBJECT,     onKillObject)
		off(S.TERRAIN_PATCH,   onTerrainPatch)
		off(S.TELEPORT_FINISH, onTeleportFinish)
		off(S.OBJECT_PROPS,    onObjectProps)
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
