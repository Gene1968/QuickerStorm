/**
 * useOfficeEngine.js — Three.js virtual world scene builder.
 *
 * Manages the 3D environment: rooms, furniture, avatars, doors,
 * camera transitions, raycasting for click-to-navigate, and the
 * animation loop.  Mount via OfficeCanvas.vue.
 *
 * Navigation model:
 *   POV view  → third-person over-shoulder camera following the player avatar.
 *   Overhead  → orthographic top-down camera (for floorplan peek).
 *   Click on a door label, room area, or sidebar button → GSAP camera lerp.
 */

import * as THREE from "three"
import {
	CSS2DRenderer,
	CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { gsap } from "gsap"
import { ref, watch } from "vue"
import {
	ALL_ROOMS,
	// OFFICES,
	getRoomById,
	FLOOR_BOUNDS,
} from "@/config/officeLayout.js"
// Door state is authoritative from the Supabase door_states table, accessed via
// isRoomLocked / getDoorStates from usePresence.js.
import { useOfficeStore } from "@/stores/officeStore.js"
import { slackStatusForDisplay } from "@/utils/slackStatusFormat.js"
import { shouldYieldDuplicateOfficeDesk } from "@/utils/officeDeskDeduplication.js"
import { createOfficeWallClock } from "@/office3d/prefabs/createOfficeWallClock.js"
import { createConferenceWorldClock } from "@/office3d/prefabs/createConferenceWorldClock.js"
import { createOfficeSofa } from "@/office3d/prefabs/createOfficeSofa.js"
import { createLobbySunkenLounge } from "@/office3d/prefabs/createLobbySunkenLounge.js"
import { createOfficeCoffeeTable } from "@/office3d/prefabs/createOfficeCoffeeTable.js"
import { createOfficeBookshelf } from "@/office3d/prefabs/createOfficeBookshelf.js"
import { createOfficePlant } from "@/office3d/prefabs/createOfficePlant.js"
import { createOfficeFern } from "@/office3d/prefabs/createOfficeFern.js"
import { createOfficeMat } from "@/office3d/prefabs/createOfficeMat.js"
import { createOfficeWeights } from "@/office3d/prefabs/createOfficeWeights.js"
import { createOfficeTreadmill } from "@/office3d/prefabs/createOfficeTreadmill.js"
import { createOfficeWhiteboard } from "@/office3d/prefabs/createOfficeWhiteboard.js"
import { createOfficeProjectorScreen } from "@/office3d/prefabs/createOfficeProjectorScreen.js"
import { createOfficeCounter } from "@/office3d/prefabs/createOfficeCounter.js"
import { createOfficeWallSign } from "@/office3d/prefabs/createOfficeWallSign.js"
import { createOfficeMondrianPainting } from "@/office3d/prefabs/createOfficeMondrianPainting.js"
import { createOfficeRoundTable } from "@/office3d/prefabs/createOfficeRoundTable.js"
import { createOfficeConferenceTable } from "@/office3d/prefabs/createOfficeConferenceTable.js"
import { createOfficeWallScreen } from "@/office3d/prefabs/createOfficeWallScreen.js"
import { createOfficeTV } from "@/office3d/prefabs/createOfficeTV.js"
import { createOfficeDesk } from "@/office3d/prefabs/createOfficeDesk.js"
import { createOfficeMonitor } from "@/office3d/prefabs/createOfficeMonitor.js"
import { createOfficeChairOffice } from "@/office3d/prefabs/createOfficeChairOffice.js"
import { createOfficeBacklitSign } from "@/office3d/prefabs/createOfficeBacklitSign.js"
import { createOfficeMagazines } from "@/office3d/prefabs/createOfficeMagazines.js"
import { createOfficeIntercom } from "@/office3d/prefabs/createOfficeIntercom.js"
import { createCourtyardTree } from "@/office3d/prefabs/createCourtyardTree.js"
import { createCourtyardBench } from "@/office3d/prefabs/createCourtyardBench.js"
import { createCourtyardFountain, tickFountainWater } from "@/office3d/prefabs/createCourtyardFountain.js"
import { createCourtyardSidewalk } from "@/office3d/prefabs/createCourtyardSidewalk.js"
import { createCourtyardHedge } from "@/office3d/prefabs/createCourtyardHedge.js"
import { createSolarPanel } from "@/office3d/prefabs/createSolarPanel.js"
import { createRecyclingBin } from "@/office3d/prefabs/createRecyclingBin.js"
import { createTrashcan } from "@/office3d/prefabs/createTrashcan.js"
import { createRefrigerator } from "@/office3d/prefabs/createRefrigerator.js"
import { createVectorRobot, tickVectorRobots } from "@/office3d/prefabs/createVectorRobot.js"
import fountainAudioUrl from "@/assets/audio/fountain.mp3?url"
import { usePresenceStore } from "@/stores/presenceStore.js"
import { useAvatarStore } from "@/stores/avatarStore.js"
import { isRoomLocked } from "@/composables/usePresence.js"
import { DoorStateRepo } from "@/api/backend.js"
import { useRealtimeSocket } from "@/composables/useRealtimeSocket.js"
import { anyModalOpen } from "@/composables/useModalStack.js"
import { useAudio, isAllAudioMuted, hasSoundConsent } from "@/composables/useAudio.js"
import { avaConfirm } from "@/composables/useConfirm.js"
import { useClientStats } from "@/composables/useClientStats.js"
import {
	peerAnalysers,
	// talkingPeers,
	localMicActive,
	muteLocal,
} from "@/composables/useProximityVoice.js"
import avatechLogoUrl from "@/assets/img/avatech-logo-gradient.svg?url"
import grassTexUrl from "@/assets/img/grass-new-3-512.png?url"
import teaMugUrl from "@/assets/3d/tea-mug-AVA.glb?url"

// ── Shared loaders ──────────────────────────────────────────────────
const gltfLoader = new GLTFLoader()

/** Base texture for cap logo; each cap uses `clone()` so avatar teardown can dispose safely. */
let _capLogoBaseTexture = null
let _capLogoBasePromise = null

let _teaMugScene = null
let _teaMugPromise = null
function loadTeaMugGltf () {
	if (_teaMugScene) return Promise.resolve(_teaMugScene)
	if (!_teaMugPromise) {
		_teaMugPromise = new Promise((resolve, reject) => {
			gltfLoader.load(teaMugUrl, (gltf) => {
				_teaMugScene = gltf.scene
				resolve(gltf.scene)
			}, undefined, reject)
		})
	}
	return _teaMugPromise
}
function loadCapLogoBaseTexture () {
	if (_capLogoBaseTexture) return Promise.resolve(_capLogoBaseTexture)
	if (!_capLogoBasePromise) {
		_capLogoBasePromise = new Promise((resolve, reject) => {
			new THREE.TextureLoader().load(
				avatechLogoUrl,
				(tex) => {
					tex.colorSpace = THREE.SRGBColorSpace
					tex.needsUpdate = true
					_capLogoBaseTexture = tex
					resolve(tex)
				},
				undefined,
				reject,
			)
		})
	}
	return _capLogoBasePromise
}

/**
 * Baseball bill: spokes from crown center, circular outer edge, smooth taper at side ends.
 * Using a circle (not ellipse) keeps the front rounded rather than pointed.
 */
function buildFlatBrimGeometry ({ innerR, outerR, yTop, height, thetaStart, thetaLength, radSegs = 5, angSegs = 30 }) {
	const yBot = yTop - height
	const mid = thetaStart + thetaLength * 0.5
	const pos = [], idx = []
	const v = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1 }
	const quad = (a, b, c, d) => idx.push(a, b, c, a, c, d)
	const T = [], B = []
	for (let ri = 0; ri <= radSegs; ri++) {
		const rowT = [], rowB = []
		for (let ai = 0; ai <= angSegs; ai++) {
			const a = thetaStart + thetaLength * (ai / angSegs)
			let w = 1 - Math.abs(a - mid) / (thetaLength * 0.5)
			w = Math.max(0, w); w = w * w * (3 - 2 * w)   // smoothstep
			const rEdge = innerR + (outerR - innerR) * w
			const r = innerR + (rEdge - innerR) * (ri / radSegs)
			rowT.push(v(r * Math.cos(a), yTop, r * Math.sin(a)))
			rowB.push(v(r * Math.cos(a), yBot, r * Math.sin(a)))
		}
		T.push(rowT); B.push(rowB)
	}
	for (let ri = 0; ri < radSegs; ri++) for (let ai = 0; ai < angSegs; ai++) {
		quad(T[ri][ai], T[ri + 1][ai], T[ri + 1][ai + 1], T[ri][ai + 1])
		quad(B[ri][ai], B[ri][ai + 1], B[ri + 1][ai + 1], B[ri + 1][ai])
	}
	for (let ai = 0; ai < angSegs; ai++) quad(T[0][ai + 1], T[0][ai], B[0][ai], B[0][ai + 1])  // inner rim
	for (let ai = 0; ai < angSegs; ai++) quad(T[radSegs][ai], T[radSegs][ai + 1], B[radSegs][ai + 1], B[radSegs][ai])  // outer rim
	for (let ri = 0; ri < radSegs; ri++) {
		quad(T[ri][0], B[ri][0], B[ri + 1][0], T[ri + 1][0])
		quad(T[ri + 1][angSegs], B[ri + 1][angSegs], B[ri][angSegs], T[ri][angSegs])
	}
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
	geo.setIndex(idx)
	geo.computeVertexNormals()
	return geo
}

export function useOfficeEngine () {
	const officeStore = useOfficeStore()
	const presenceStore = usePresenceStore()
	const avatarStore = useAvatarStore()
	const audio = useAudio()

	// ── Three.js internals ──────────────────────────────────────────
	let scene, camera, renderer, labelRenderer, timer, container
	let resizeObserver = null
	let animFrameId = null
	let ambientLight, sunLight, fillLight

	// Camera tracking
	const cameraLookAt = new THREE.Vector3(0, 1.6, -5)
	let camTween = null

	// Device capability flags — derived from clientStats perfTier, set in init()
	let isLowEnd = false
	let isMidRange = false
	let lastFrameTime = 0

	// WASD / arrow-key movement state
	const heldKeys = new Set()
	const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
	/** True while physical Alt/Option is held — used for Alt+WASD camera orbit. */
	let keyboardAltHeld = false
	let _wasdLastSync = 0
	let _wasdMoved = false
	let _overheadExiting = false  // true while the overhead→POV smooth tween is running
	let _localMoveEndedAt = 0   // Date.now() when last local movement ended; blocks presence spring-back
	let _walkSoundActive = false
	/** Phase (rad) for subtle capsule-leg lift while holding W/S without turn keys. */
	let _wasdLegPhase = 0
	let _jumpActive = false
	let _jumpStartTime = 0
	const _JUMP_DURATION = 550 // ms
	const _JUMP_HEIGHT = 0.55
	let _crouchHeld = false
	let _emoteMenuHoldTimer = null
	let _emoteMenuOpen = false

	// Emotes — local user's active emote; peers track on g.userData.peerEmote.
	// { name, startedAt (perfNow ms) } or null. Per-emote tick fns generate arm rotations.
	let _activeEmote = null
	// Each tick(t in seconds) returns absolute arm pivot rotations (not deltas from baseRotZ).
	// Missing fields fall back to base pose. bodyBob adds vertical offset to the avatar group.
	// Sign convention: arm pivots hang in -Y at rotation=0. Avatar's local forward
	// is +Z (W key moves the avatar in +Z relative to its facing). Rotating arm
	// pivots by rotation.x = -PI/2 lifts arms forward; +PI/2 swings them backward.
	const DANCE_VARIANTS = {
		// Classic side-swing with body bob
		swing (t) {
			const swing = Math.sin(t * 4)
			const fwd = Math.cos(t * 4) * 0.32
			return {
				leftRotZ:  -0.15 + swing * 0.7,
				rightRotZ:  0.15 - swing * 0.7,
				leftRotX:  -fwd,
				rightRotX:  fwd,
				bodyBob: Math.abs(Math.sin(t * 4)) * 0.08,
			}
		},
		// Hands-up shake: both arms overhead, head/body bob fast side-to-side
		raiseTheRoof (t) {
			const beat = t * 5
			const wig = Math.sin(beat * 2) * 0.18
			return {
				leftRotZ:  -Math.PI * 0.85 + wig,
				rightRotZ:  Math.PI * 0.85 - wig,
				leftRotX:  -0.15,
				rightRotX: -0.15,
				bodyBob: Math.abs(Math.sin(beat)) * 0.10,
			}
		},
		// Robot: staccato 90 degree poses snapping every ~0.6 s
		robot (t) {
			const step = Math.floor(t / 0.6) % 4
			// poses: [(leftZ, rightZ, leftX, rightX)] — alternating boxy positions
			const poses = [
				[-Math.PI / 2,  Math.PI / 2, 0, 0],
				[ 0, 0, -Math.PI / 2, -Math.PI / 2],
				[ Math.PI / 4, -Math.PI / 4, -Math.PI / 3, -Math.PI / 3],
				[-Math.PI / 4,  Math.PI / 4, 0, 0],
			]
			const [lz, rz, lx, rx] = poses[step]
			return { leftRotZ: lz, rightRotZ: rz, leftRotX: lx, rightRotX: rx, bodyBob: 0.02 }
		},
		// Disco point: alternating Travolta-style finger points up-and-across
		disco (t) {
			const phase = Math.sin(t * 3.2)
			const up = phase > 0
			return {
				leftRotZ:  up ? -Math.PI * 0.9 + phase * 0.2 : -0.2,
				rightRotZ: up ?  0.2 :  Math.PI * 0.9 + phase * 0.2,
				leftRotX:  up ? -0.4 : 0,
				rightRotX: up ?  0   : -0.4,
				bodyBob: Math.abs(Math.sin(t * 3.2)) * 0.06,
			}
		},
		// Running man: arms pump opposite each other while body bobs deep
		runningMan (t) {
			const pump = Math.sin(t * 6)
			return {
				leftRotZ:  -0.15 + pump * 0.05,
				rightRotZ:  0.15 - pump * 0.05,
				leftRotX:  -pump * 0.9,
				rightRotX:  pump * 0.9,
				bodyBob: Math.abs(Math.sin(t * 6)) * 0.12,
			}
		},
	}
	const DANCE_KEYS = Object.keys(DANCE_VARIANTS)

	const EMOTES = {
		wave: {
			duration: 2000, loop: false,
			tick (t) {
				const raise = Math.min(1, t / 0.25)
				const wig = Math.sin(Math.max(0, t - 0.25) * 9) * 0.35
				return { rightRotZ: Math.PI * 0.92 * raise - wig * raise }
			},
		},
		clap: {
			duration: 1500, loop: false,
			tick (t) {
				const raise = Math.min(1, t / 0.18)
				const beat = Math.sin(t * 14) * 0.18 * raise
				return {
					leftRotX:  -(Math.PI / 2) * raise,
					rightRotX: -(Math.PI / 2) * raise,
					leftRotZ:  -0.18 - beat,
					rightRotZ:  0.18 + beat,
				}
			},
		},
		dance: {
			duration: Infinity, loop: true,
			tick (t, variant) {
				const fn = DANCE_VARIANTS[variant] || DANCE_VARIANTS.swing
				return fn(t)
			},
		},
		point: {
			duration: 1500, loop: false,
			tick (t) {
				const phase = t < 0.22 ? t / 0.22
					: t < 1.25 ? 1
					: t < 1.5 ? 1 - (t - 1.25) / 0.25
					: 0
				return {
					rightRotX: -(Math.PI / 2) * phase,
					rightRotZ: 0.15 * (1 - phase),
				}
			},
		},
	}

	// Scene objects
	const roomGroups = new Map() // roomId → THREE.Group
	const doorPivots = new Map() // `${roomId}-${wall}` → { pivot, isOpen }
	const avatarGroups = new Map() // userId → THREE.Group
	const avatarMixers = new Map() // userId → AnimationMixer
	// Mouth-VAD scratch state — see animate loop; kept at composable scope for reuse.
	let _mouthTick = 0
	const _mouthAmpByUid = new Map()
	const doorLabelObjects = new Map() // roomId → CSS2DObject (for dynamic door labels)
	const roomNameLabels = new Map() // roomId → CSS2DObject (overhead room-name label)
	// const interactable = [] // { mesh, roomId } for raycasting
	const officeFurnitureMeshes = [] // { mesh, roomId } desk/chair click-to-sit
	const sharedSeatMeshes = [] // { mesh, roomId, seatId } invisible click targets
	const coffeeMachineMeshes = [] // { mesh, group } clickable coffee machine parts
	const waterCoolerMeshes = [] // { mesh, group } clickable water cooler parts
	const intercomMeshes = [] // { mesh, group } clickable intercom panel
	const magazineMeshes = [] // { mesh, group, url } clickable magazine stacks
	const suggestionBoxMeshes = [] // { mesh, group } clickable suggestion box
	const kudosPlaqueMeshes = [] // { mesh, group } clickable break-room kudos plaque
	const connect4Meshes    = [] // { mesh, group } clickable Connect 4 cabinet
	const arcadeMeshes = [] // { mesh, group } clickable arcade cabinet
	const arcadePacmanMeshes = [] // { mesh, group } clickable AVA-Man arcade cabinet
	const ticketDispenserMeshes = [] // { mesh, group } clickable ticket dispenser
	const nowServingMeshes = [] // { mesh, group } clickable Now Serving sign
	const monitorMeshes = [] // { mesh, group, roomId } clickable desk monitor in offices
	const refrigeratorDoorMeshes = [] // { mesh, door, side } clickable refrigerator door panels
	const refrigeratorAllMeshes = []  // all fridge meshes — blocks floor click-through
	const whiteboardMeshes = [] // { mesh, group, roomId } clickable whiteboards for collaboration
	const _floorMeshMap = new Map()   // THREE.Mesh → roomId for hover-label floor detection
	const _customEntities = new Map() // id → { group, hoverables[], getLabel(mesh) }
	const hoverLabel = ref('')        // tooltip text shown under cursor in OfficeCanvas
	// Cached references so setNowServingNumber can re-paint the LED display
	let nowServingCanvas = null
	let nowServingCtx = null
	let nowServingTex = null

	// Re-paint the "Now Serving" LED display with the given number
	function paintNowServing (n) {
		if (!nowServingCtx) return
		const ctx = nowServingCtx
		ctx.fillStyle = '#0a0400'
		ctx.fillRect(0, 0, 768, 384)

		// Header
		ctx.fillStyle = '#ff9944'
		ctx.font = 'bold 62px "Helvetica Neue", Arial, sans-serif'
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		ctx.shadowColor = '#ff4400'
		ctx.shadowBlur = 22
		ctx.fillText('NOW SERVING', 384, 80)

		// Big digit
		const text = String(Number.isFinite(+n) ? +n : 0).padStart(3, '0')
		ctx.shadowBlur = 46
		ctx.shadowColor = '#ff5a00'
		ctx.fillStyle = '#ffd080'
		ctx.font = 'bold 220px "Courier New", monospace'
		ctx.fillText(text, 384, 240)

		ctx.shadowBlur = 0
		if (nowServingTex) nowServingTex.needsUpdate = true
	}
	const aquariumFish = [] // fish groups animated in the render loop
	/** `(now: Date) => void` — wall clocks; cheap even with many instances */
	const wallClockUpdaters = []
	const worldClockUpdaters = []
	const worldClockDisposers = []
	const lavaLampBlobs = [] // blob meshes animated in the render loop
	const lavaLampMats = {} // structural material refs for theme swapping
	// Lobby greenhouse sky (procedural canvas textures; swapped on `ava-theme`).
	let lobbySkyDayTex = null
	let lobbySkyNightTex = null
	let lobbySkyMaterial = null

	// Office dog — shared across all clients via a deterministic wall-clock seed
	// for idle roaming, overridable by user-issued commands (sit/throw/go-to-user)
	// carried in any user's AvatarState.dogCmd.  Each client runs the same state
	// machine; since all inputs (wall-clock time + command timestamps) are shared,
	// every client arrives at the same dog position/action without a central server.
	let dogGroup = null
	let dogBall = null            // THREE.Mesh | null — spawned during throw-ball
	const DOG_WALK_SPEED = 1.98   // m/s — ~10% slower than 2.2 so Byte is easier to click while moving
	const DOG_IDLE_ROAM_MS = 12_000  // ms between idle waypoint picks
	/** After walking to someone (goto-user / "Call to you"), sit this long then roam again */
	const DOG_POST_GOTO_SIT_MS = 20_000
	/** "Call to you" target — offset from avatar center so Byte does not stand on your feet (~1 ft) */
	const DOG_CALL_STANDOFF_M = 0.35
	/** Full roll-over trick duration (wall-clock ms, shared across clients) */
	const DOG_ROLL_DURATION_MS = 2_200
	const dogState = {
		legPhase: 0,
		legMeshes: [],
		woofLabel: null,
		nameLabel: null,
		woofHideAt: 0,
		lastBarkAt: 0,
		// Current world position — mirrors dogGroup.position but survives re-inits
		x: 0, z: 0, roomId: 'lobby',
		// Active path: array of { x, z, roomId } waypoints to walk through, in order
		path: [],
		// What to do after the path finishes
		mode: 'idle',      // 'idle' | 'sit' | 'roll-over' | 'throw-ball' | 'goto-user'
		modeData: null,    // throw-ball / goto-user scratch, or { resumeIdleAt } for timed post-goto sit
		// The dogCmd this machine is currently executing (by issuedAt), so newer cmds preempt
		executingCmdAt: 0,
		// Deterministic idle roam — next time we pick a new room
		nextIdleAt: 0,
	}

	// Tiny seeded PRNG (mulberry32) — deterministic per integer seed.
	function prng32 (seed) {
		let a = (seed | 0) + 0x9e3779b9 | 0
		return function () {
			a = a + 0x6D2B79F5 | 0
			let x = a
			x = Math.imul(x ^ x >>> 15, x | 1)
			x ^= x + Math.imul(x ^ x >>> 7, x | 61)
			return ((x ^ x >>> 14) >>> 0) / 4294967296
		}
	}

	// ── Dog navigation helpers ───────────────────────────────────────────
	// World-space coordinate of a door on `room`. Walls: north=-z, south=+z, east=+x, west=-x.
	function doorWorldXZ (room, door) {
		const [rx, rz] = room.pos
		const [w, d] = room.size
		const off = door.offset || 0
		switch (door.wall) {
			case 'north': return { x: rx + off, z: rz - d / 2 }
			case 'south': return { x: rx + off, z: rz + d / 2 }
			case 'east': return { x: rx + w / 2, z: rz + off }
			case 'west': return { x: rx - w / 2, z: rz + off }
			default: return { x: rx, z: rz }
		}
	}
	// Door in `fromRoom` that best connects to `toRoom` — the one whose world
	// position is closest to toRoom's center.
	function doorwayTo (fromRoom, toRoom) {
		let best = null
		let bestD = Infinity
		for (const door of fromRoom.doors || []) {
			const p = doorWorldXZ(fromRoom, door)
			const d = (p.x - toRoom.pos[0]) ** 2 + (p.z - toRoom.pos[1]) ** 2
			if (d < bestD) { bestD = d; best = p }
		}
		return best || { x: fromRoom.pos[0], z: fromRoom.pos[1] }
	}
	// BFS over `connections` → array of room ids including start + end.
	function findRoomPath (fromId, toId) {
		if (fromId === toId) return [fromId]
		const queue = [[fromId]]
		const visited = new Set([fromId])
		while (queue.length) {
			const path = queue.shift()
			const last = path[path.length - 1]
			const room = getRoomById(last)
			if (!room) continue
			for (const n of room.connections || []) {
				if (visited.has(n)) continue
				visited.add(n)
				const newPath = [...path, n]
				if (n === toId) return newPath
				queue.push(newPath)
			}
		}
		return null
	}
	// Random point inside `room`, pulled in by `inset` m from each wall.
	function randomRoomXZ (room, inset = 1.8, rng = Math.random) {
		const [rx, rz] = room.pos
		const [w, d] = room.size
		const x = rx + (rng() - 0.5) * Math.max(0, w - inset * 2)
		const z = rz + (rng() - 0.5) * Math.max(0, d - inset * 2)
		return { x, z }
	}
	// Find which room an (x, z) point lies in, or null if none.
	// function roomAtXZ (x, z) {
	// 	for (const r of ALL_ROOMS) {
	// 		const [rx, rz] = r.pos
	// 		const [w, d] = r.size
	// 		if (Math.abs(x - rx) <= w / 2 && Math.abs(z - rz) <= d / 2) return r
	// 	}
	// 	return null
	// }
	// Build a waypoint list for the dog to reach (destRoomId, destX, destZ) from
	// its current room. Each waypoint is { x, z, roomId }. Passes through one
	// doorway per room transition so visually the dog walks through doors.
	function buildDogPath (destRoomId, destX, destZ) {
		const roomPath = findRoomPath(dogState.roomId, destRoomId)
		if (!roomPath) return null
		const out = []
		for (let i = 0; i < roomPath.length - 1; i++) {
			const a = getRoomById(roomPath[i])
			const b = getRoomById(roomPath[i + 1])
			if (!a || !b) continue
			// Two points at the doorway: one on A's side, one on B's side, nudged
			// into B a little so we leave A cleanly.
			const door = doorwayTo(a, b)
			out.push({ x: door.x, z: door.z, roomId: a.id })
			// Nudge ~0.5 m toward B's center to ensure we "enter" B
			const [bx, bz] = b.pos
			const dx = bx - door.x, dz = bz - door.z
			const n = Math.hypot(dx, dz) || 1
			out.push({ x: door.x + (dx / n) * 0.8, z: door.z + (dz / n) * 0.8, roomId: b.id })
		}
		out.push({ x: destX, z: destZ, roomId: destRoomId })
		return out
	}
	// Kick off walking to (destRoomId, destX, destZ). Called by all state transitions.
	function dogWalkTo (destRoomId, destX, destZ) {
		const path = buildDogPath(destRoomId, destX, destZ)
		if (!path || !path.length) return false
		dogState.path = path
		return true
	}
	// Consume the deterministic idle schedule — every DOG_IDLE_ROAM_MS, pick a
	// connected (or any) room deterministically and walk there.
	function dogIdleTick (wc) {
		if (dogState.path.length) return      // already walking somewhere
		if (wc < dogState.nextIdleAt) return  // not time yet
		const segIdx = Math.floor(wc / DOG_IDLE_ROAM_MS)
		const rng = prng32(segIdx * 2654435761)
		const curRoom = getRoomById(dogState.roomId) || ALL_ROOMS[0]
		// 70% pick a connected room, 30% wander inside the current room
		const goToConnected = rng() < 0.7 && (curRoom.connections?.length || 0) > 0
		let targetRoom
		if (goToConnected) {
			const conns = curRoom.connections
			targetRoom = getRoomById(conns[Math.floor(rng() * conns.length)]) || curRoom
		} else {
			targetRoom = curRoom
		}
		const wp = randomRoomXZ(targetRoom, 1.8, rng)
		dogWalkTo(targetRoom.id, wp.x, wp.z)
		dogState.nextIdleAt = (segIdx + 1) * DOG_IDLE_ROAM_MS
	}

	// Command lifecycle
	//   Commands live in any user's AvatarState.dogCmd = { action, issuedAt, byUserId, ... }.
	//   Every client scans presence each frame, picks the newest cmd, and runs it
	//   iff its issuedAt is greater than the dog's executingCmdAt. A cmd older than
	//   90 s is ignored (stale). This way we don't need a central dog server.
	const DOG_CMD_STALE_MS = 90_000
	function dogApplyLatestCommand (wc) {
		let latest = null
		for (const u of presenceStore.users) {
			const cmd = u.avatarState?.dogCmd
			if (!cmd || !cmd.issuedAt) continue
			if (wc - cmd.issuedAt > DOG_CMD_STALE_MS) continue
			if (!latest || cmd.issuedAt > latest.issuedAt) latest = { ...cmd, _byUserId: u.id }
		}
		// Include the local user's own pending dogCmd optimistically — otherwise the
		// commander waits for their heartbeat to round-trip through the backend before
		// seeing their own click take effect (~8 s).
		const localCmd = officeStore.myAvatarState?.dogCmd
		if (localCmd && localCmd.issuedAt && wc - localCmd.issuedAt <= DOG_CMD_STALE_MS) {
			if (!latest || localCmd.issuedAt > latest.issuedAt) {
				latest = { ...localCmd, _byUserId: myUserId || presenceStore.myUserId }
			}
		}
		if (!latest) return
		if (latest.issuedAt <= dogState.executingCmdAt) return   // already handled
		dogState.executingCmdAt = latest.issuedAt
		// Kill any in-flight ball before a mode-changing command (not speak — bark shouldn't cancel fetch)
		if (latest.action !== 'speak' && latest.action !== 'bark') _removeBall()
		if (latest.action === 'sit') {
			dogState.mode = 'sit'
			dogState.path.length = 0
			dogState.modeData = null
		} else if (latest.action === 'roll-over' || latest.action === 'rollover') {
			dogState.mode = 'roll-over'
			dogState.path.length = 0
			dogState.modeData = { startWc: wc, durationMs: DOG_ROLL_DURATION_MS }
		} else if (latest.action === 'goto-user') {
			const tid = String(latest.targetUserId ?? '')
			const target = presenceStore.users.find(u => String(u.id) === tid)
			const myIdStr = String(myUserId ?? presenceStore.myUserId ?? '')
			const isSelfTarget = !!(myIdStr && tid === myIdStr)
			const commanderIsMe = String(latest._byUserId ?? '') === myIdStr
			let tr, tx, tz
			// "Call to you" — commander targets their own id; use live pose, not a lagging self row from the poll.
			if (isSelfTarget && commanderIsMe) {
				tr = getRoomById(officeStore.currentRoomId)
				if (tr) {
					const px = (typeof officeStore.myPosX === 'number') ? officeStore.myPosX : tr.pos[0]
					const pz = (typeof officeStore.myPosZ === 'number') ? officeStore.myPosZ : tr.pos[1]
					// Stop to your right (local +X) so he does not park on your feet; same plane as throw-ball facing.
					const r = officeStore.myRotation || 0
					tx = px + Math.cos(r) * DOG_CALL_STANDOFF_M
					tz = pz - Math.sin(r) * DOG_CALL_STANDOFF_M
				}
			} else if (target && target.roomId) {
				tr = getRoomById(target.roomId)
				if (tr) {
					tx = (typeof target.posX === 'number') ? target.posX : tr.pos[0]
					tz = (typeof target.posZ === 'number') ? target.posZ : tr.pos[1]
				}
			}
			if (tr) {
				dogState.mode = 'goto-user'
				dogState.modeData = { targetUserId: latest.targetUserId }
				dogWalkTo(tr.id, tx, tz)
			}
		} else if (latest.action === 'throw-ball') {
			// Ball lands in the commander's current room at the given spot
			const byUser = presenceStore.users.find(u => String(u.id) === String(latest._byUserId))
			const landRoom = getRoomById(latest.ballRoomId || byUser?.roomId)
			if (landRoom && typeof latest.ballX === 'number' && typeof latest.ballZ === 'number') {
				dogState.mode = 'throw-ball'
				dogState.modeData = {
					phase: 'flying',
					commanderUserId: latest._byUserId,
					landX: latest.ballX,
					landZ: latest.ballZ,
					landRoomId: landRoom.id,
				}
				_spawnBallArc(byUser, latest.ballX, latest.ballZ)
			}
		} else if (latest.action === 'speak' || latest.action === 'bark') {
			const now = performance.now()
			if (dogState.woofLabel?.element) {
				dogState.woofLabel.element.style.opacity = '1'
				dogState.woofHideAt = now + 1200
			}
			dogState.lastBarkAt = now
			audio.playDogBark()
		}
	}

	// Called when the dog's path becomes empty.  Drives the throw-ball state
	// transitions (fly → fetch → return → drop) and clears transient modes.
	function dogOnPathComplete (wcNow) {
		if (dogState.mode === 'throw-ball' && dogState.modeData) {
			const md = dogState.modeData
			if (md.phase === 'fetching') {
				// Arrived at ball — pick it up and carry it to the commander
				if (dogBall) dogBall.userData.followsDog = true
				md.phase = 'returning'
				const commander = presenceStore.users.find(u => String(u.id) === String(md.commanderUserId))
				if (commander && commander.roomId) {
					const cr = getRoomById(commander.roomId)
					const cx = (typeof commander.posX === 'number') ? commander.posX : (cr?.pos[0] ?? dogState.x)
					const cz = (typeof commander.posZ === 'number') ? commander.posZ : (cr?.pos[1] ?? dogState.z)
					dogWalkTo(commander.roomId, cx, cz)
				} else {
					_dropBall()
					dogState.mode = 'idle'
				}
			} else if (md.phase === 'returning') {
				// Arrived at commander — drop the ball and go idle
				_dropBall()
				dogState.mode = 'idle'
				dogState.modeData = null
			}
		} else if (dogState.mode === 'goto-user') {
			// Sit at the target for DOG_POST_GOTO_SIT_MS, then idle roam resumes (see render loop).
			dogState.mode = 'sit'
			dogState.modeData = { resumeIdleAt: wcNow + DOG_POST_GOTO_SIT_MS }
		}
	}

	// Ball lifecycle
	function _spawnBallArc (byUser, destX, destZ) {
		_removeBall()
		const mat = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.5, metalness: 0 })
		mat.userData.shared = false
		const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 12), mat)
		const startX = byUser?.posX ?? destX
		const startZ = byUser?.posZ ?? destZ
		mesh.position.set(startX, 1.0, startZ)
		scene.add(mesh)
		dogBall = mesh
		// Parabolic arc to landing spot — y peaks mid-flight
		const arc = gsap.timeline({
			onComplete: () => {
				if (!dogBall) return
				dogBall.userData.followsDog = false
				// Now the dog walks to the ball
				const landRoom = getRoomById(dogState.modeData?.landRoomId)
				if (landRoom && dogState.mode === 'throw-ball') {
					dogState.modeData.phase = 'fetching'
					dogWalkTo(landRoom.id, destX, destZ)
				}
			},
		})
		arc.to(mesh.position, { x: destX, z: destZ, duration: 0.9, ease: 'none' }, 0)
		arc.to(mesh.position, { y: 2.4, duration: 0.45, ease: 'power2.out' }, 0)
		arc.to(mesh.position, { y: 0.15, duration: 0.45, ease: 'power2.in' }, 0.45)
	}
	function _dropBall () {
		if (!dogBall) return
		dogBall.userData.followsDog = false
		// Leave the ball on the ground for a beat, then remove
		setTimeout(_removeBall, 1500)
	}
	function _removeBall () {
		if (!dogBall) return
		scene.remove(dogBall)
		dogBall.geometry?.dispose()
		dogBall.material?.dispose()
		dogBall = null
	}
	// GLTF load deduplication: maps gltfUrl → sequence number so that if two loads
	// are kicked off for the same avatar URL (re-keying race), only the latest
	// callback does anything — the earlier one silently discards its result.
	const gltfLoadTokens = new Map() // gltfUrl → latest sequence number
	let coffeeExpireTimer = null  // timeout id for the 1-hour coffee expiry
	let waterExpireTimer = null  // timeout id for the 1-hour water glass expiry
	let projectorScreenMesh = null // the conference-room screen mesh (Phase 1 canvas / Phase 3 video)
	const officeScreenMeshes = new Map() // roomId → cloned mesh for office-wall-screen

	// Player state
	let myUserId = null
	// let myAvatarPos = new THREE.Vector3(0, 0, 10)

	// ── Reactive public state ───────────────────────────────────────
	const currentRoom = ref("lobby")
	const isTransitioning = ref(false)

	// ── Fountain ambient audio ──────────────────────────────────────
	// courtyard room pos [24, 0] + fountain furniture local [0, 0] = world (24, 0)
	let _fountainAudio = null
	const _FOUNTAIN_WX = 24
	const _FOUNTAIN_WZ = 0
	const _FOUNTAIN_MAX_DIST = 15

	watch(currentRoom, (roomId) => {
		if (roomId === "courtyard") {
			if (!_fountainAudio) {
				_fountainAudio = new Audio(fountainAudioUrl)
				_fountainAudio.loop = true
				_fountainAudio.volume = 0
				_fountainAudio.play().catch(() => { })
			}
		} else {
			if (_fountainAudio) {
				try { _fountainAudio.pause(); _fountainAudio.currentTime = 0 } catch (e) { console.error(e) }
				_fountainAudio = null
			}
		}
	})

	function _tickFountainAudio () {
		if (!_fountainAudio) return
		if (!hasSoundConsent() || isAllAudioMuted.value) {
			if (!_fountainAudio.paused) _fountainAudio.pause()
			return
		}
		if (_fountainAudio.paused) _fountainAudio.play().catch(() => { })
		const myGroup = myUserId ? avatarGroups.get(myUserId) : null
		if (!myGroup) { _fountainAudio.volume = 0; return }
		const dx = myGroup.position.x - _FOUNTAIN_WX
		const dz = myGroup.position.z - _FOUNTAIN_WZ
		const dist = Math.sqrt(dx * dx + dz * dz)
		const t = Math.max(0, 1 - dist / _FOUNTAIN_MAX_DIST)
		// 0.7 * t² → ~0.25 at benches (5.5 units), 0.7 max at fountain, ~0 at doorway (14 units)
		_fountainAudio.volume = 0.7 * t * t
	}

	// ── Materials (created once, reused) ───────────────────────────
	const M = {}

	function buildMaterials () {
		// Dark floor textures
		M.floor = buildFloorMat("#08101a", "#1e2d45")
		M.floorCarpet = buildFloorMat("#0d1018", "#1a2030")
		M.floorMarble = buildFloorMat("#101820", "#1e2d45", true)
		M.floorRubber = buildFloorMat("#0a1208", "#162010")
		const grassTex = new THREE.TextureLoader().load(grassTexUrl)
		grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping
		grassTex.colorSpace = THREE.SRGBColorSpace
		grassTex.repeat.set(20, 14)
		M.floorGrass = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.97, metalness: 0 })
		M.floorGrassL = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.93, metalness: 0 })
		// Light floor textures (pre-built, swapped on theme toggle)
		M.floorL = buildFloorMat("#c8d4e4", "#b0bfcf")
		M.floorCarpetL = buildFloorMat("#cfc4b0", "#b8aa98")
		M.floorMarbleL = buildFloorMat("#dce8f4", "#c4d4e8", true)
		M.floorRubberL = buildFloorMat("#b4c4b0", "#9eb098")

		M.wall = new THREE.MeshStandardMaterial({
			color: 0x131c2e,
			roughness: 0.9,
			metalness: 0.05,
		})
		M.wallOffice = new THREE.MeshStandardMaterial({
			color: 0x1e2e20,
			roughness: 0.85,
			metalness: 0.05,
		})
		M.wallGlass = new THREE.MeshStandardMaterial({
			color: 0x00b4d8,
			transparent: true,
			opacity: 0.13,
			roughness: 0.05,
			metalness: 0.0,
			side: THREE.DoubleSide,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: 2,
			polygonOffsetUnits: 2,
		})
		// Lobby greenhouse dome — slightly sage, more readable than wall glass.
		M.lobbyDomeGlass = new THREE.MeshStandardMaterial({
			color: 0xa8d4c4,
			transparent: true,
			opacity: 0.22,
			roughness: 0.04,
			metalness: 0.12,
			side: THREE.DoubleSide,
			depthWrite: false,
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		})
		M.lobbyGreenhouseFrame = new THREE.MeshStandardMaterial({
			color: 0x4a5c52,
			roughness: 0.42,
			metalness: 0.72,
		})
		M.ceiling = new THREE.MeshStandardMaterial({
			color: 0x0a1118,
			roughness: 1.0,
		})
		M.desk = new THREE.MeshStandardMaterial({
			color: 0x1a2540,
			roughness: 0.7,
			metalness: 0.15,
		})
		M.chair = new THREE.MeshStandardMaterial({
			color: 0x0f1a28,
			roughness: 0.85,
		})
		M.door = new THREE.MeshStandardMaterial({
			color: 0x6b4020,
			roughness: 0.75,
			metalness: 0.05,
			emissive: new THREE.Color(0x1a0800),
			emissiveIntensity: 0.6,
		})
		M.doorFrame = new THREE.MeshStandardMaterial({
			color: 0x00b4d8,
			roughness: 0.3,
			metalness: 0.7,
			emissive: new THREE.Color(0x00aadd),
			emissiveIntensity: 3.0,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		})
		M.accent = new THREE.MeshStandardMaterial({
			color: 0x00b4d8,
			roughness: 0.3,
			metalness: 0.6,
			emissive: new THREE.Color(0x002233),
			emissiveIntensity: 0.4,
		})
		M.screen = new THREE.MeshStandardMaterial({
			color: 0x050f1a,
			roughness: 0.5,
			emissive: new THREE.Color(0x0a2030),
			emissiveIntensity: 1.5,
		})
		M.plant = new THREE.MeshStandardMaterial({
			color: 0x0a2210,
			roughness: 0.95,
		})
		M.pot = new THREE.MeshStandardMaterial({
			color: 0x1a2535,
			roughness: 0.8,
		})
		M.whiteboard = new THREE.MeshStandardMaterial({
			color: 0xe2eaf5,
			roughness: 0.9,
		})
		M.table = new THREE.MeshStandardMaterial({
			color: 0x0d1e30,
			roughness: 0.6,
			metalness: 0.2,
		})
		M.sofa = new THREE.MeshStandardMaterial({
			color: 0x162030,
			roughness: 0.85,
		})
		M.waterCooler = new THREE.MeshStandardMaterial({
			color: 0xc8d8e8,
			roughness: 0.3,
			metalness: 0.7,
		})
		M.projScreen = new THREE.MeshStandardMaterial({
			color: 0x0a1420,
			emissive: new THREE.Color(0x052030),
			emissiveIntensity: 0.6,
		})
		M.treadmill = new THREE.MeshStandardMaterial({
			color: 0x101820,
			roughness: 0.5,
			metalness: 0.4,
		})
		M.invisible = new THREE.MeshBasicMaterial({ visible: false })
		// Double-sided plant material — used for flat frond planes in the simplified fern
		M.plantDouble = new THREE.MeshStandardMaterial({ color: 0x0a2210, roughness: 0.95, side: THREE.DoubleSide })
	}

	function applyThemeMaterials (dark) {
		// Solid material color swaps
		M.wall.color.set(dark ? 0x131c2e : 0xdde8f5)
		M.wallOffice.color.set(dark ? 0x1e2e20 : 0xd8e8d8)
		M.ceiling.color.set(dark ? 0x0a1118 : 0xf2f6fc)
		if (M.lobbyDomeGlass) {
			M.lobbyDomeGlass.color.set(dark ? 0x7aac98 : 0xc8eadc)
			M.lobbyDomeGlass.opacity = dark ? 0.2 : 0.26
		}
		if (M.lobbyGreenhouseFrame)
			M.lobbyGreenhouseFrame.color.set(dark ? 0x3d4f46 : 0x9aab9f)
		M.desk.color.set(dark ? 0x1a2540 : 0xb89a6a)
		M.chair.color.set(dark ? 0x0f1a28 : 0x6a80a0)
		M.door.color.set(dark ? 0x6b4020 : 0xb87830)
		M.door.emissive.set(dark ? 0x1a0800 : 0x000000)
		M.doorFrame.color.set(dark ? 0x00b4d8 : 0x1a5080)
		M.doorFrame.emissive.set(dark ? 0x00aadd : 0x0a2840)
		M.doorFrame.emissiveIntensity = dark ? 3.0 : 0.8
		M.plant.color.set(dark ? 0x0a2210 : 0x2a6a2a)
		M.plantDouble.color.set(dark ? 0x0a2210 : 0x2a6a2a)
		M.pot.color.set(dark ? 0x1a2535 : 0x7a5a40)
		M.table.color.set(dark ? 0x0d1e30 : 0xb08050)
		M.sofa.color.set(dark ? 0x162030 : 0x6080a0)
		M.treadmill.color.set(dark ? 0x101820 : 0x506070)
		M.projScreen.color.set(dark ? 0x0a1420 : 0x182838)

		// Lava lamp wall structural materials
		if (lavaLampMats.metal) {
			lavaLampMats.metal.color.set(dark ? 0x3a3a44 : 0x8a8898)
			lavaLampMats.plinth.color.set(dark ? 0x14202e : 0xd4dce8)
			lavaLampMats.plinth.metalness = dark ? 0.4 : 0.1
			lavaLampMats.backPanel.color.set(dark ? 0x0a1424 : 0xe0e8f4)
			lavaLampMats.plinthGlow.emissiveIntensity = dark ? 1.2 : 0.3
		}

		// Floor texture swap — traverse scene and replace material references
		const floorPairs = [
			[M.floor, M.floorL],
			[M.floorCarpet, M.floorCarpetL],
			[M.floorMarble, M.floorMarbleL],
			[M.floorRubber, M.floorRubberL],
			[M.floorGrass, M.floorGrassL],
		]
		// Build lookup: current wrong-theme mat → correct-theme mat
		const swap = new Map()
		for (const [darkMat, lightMat] of floorPairs) {
			swap.set(dark ? lightMat : darkMat, dark ? darkMat : lightMat)
		}
		scene.traverse((obj) => {
			if (obj.isMesh && swap.has(obj.material)) {
				obj.material = swap.get(obj.material)
			}
		})
	}

	function buildFloorMat (dark = "#08101a", light = "#1e2d45", shiny = false) {
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 512
		const ctx = canvas.getContext("2d")
		ctx.fillStyle = dark
		ctx.fillRect(0, 0, 512, 512)
		ctx.strokeStyle = light
		ctx.lineWidth = 1
		const gs = 64
		for (let x = 0; x <= 512; x += gs) {
			ctx.beginPath()
			ctx.moveTo(x, 0)
			ctx.lineTo(x, 512)
			ctx.stroke()
		}
		for (let y = 0; y <= 512; y += gs) {
			ctx.beginPath()
			ctx.moveTo(0, y)
			ctx.lineTo(512, y)
			ctx.stroke()
		}

		const tex = new THREE.CanvasTexture(canvas)
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping
		tex.repeat.set(6, 6)
		return new THREE.MeshStandardMaterial({
			map: tex,
			roughness: shiny ? 0.2 : 0.9,
			metalness: shiny ? 0.3 : 0.05,
		})
	}

	// ── Scene setup ─────────────────────────────────────────────────
	// ── Device capability detection ─────────────────────────────────
	// Called before renderer creation so antialias can be toggled at init time.
	// Heuristics: mobile UA + low core count → low-end path.
	// M-chip iPads report 8+ cores; older A-series report 4–6.
	function _applyPerfTier () {
		const { clientStats } = useClientStats()
		const tier = clientStats.perfTier   // 'low' | 'mid' | 'std'
		isLowEnd = tier === 'low'
		isMidRange = tier === 'mid'
		console.log(
			`[quickerSTORM] perf tier: ${tier}` +
				` — cores: ${clientStats.cores ?? '?'}` +
				` — RAM: ${clientStats.ramGb != null ? clientStats.ramGb + ' GB' : '?'}` +
				` — GPU: ${clientStats.gpuRenderer ?? '?'}` +
				` — mobile: ${clientStats.mobile}`,
		)
	}

	function init (containerEl) {
		container = containerEl
		const { width, height } = container.getBoundingClientRect()

		scene = new THREE.Scene()
		const isLight = document.documentElement.classList.contains("light")
		scene.background = new THREE.Color(isLight ? 0xd6eaf8 : 0x0d1f35)
		scene.fog = new THREE.FogExp2(
			isLight ? 0xd6eaf8 : 0x0d1f35,
			isLight ? 0.004 : 0.006,
		)

		camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 300)
		const startRoom = getRoomById("lobby")
		const [cpx, cpy, cpz] = startRoom?.camPos || [0, 1.8, 10]
		const [ctx, cty, ctz] = startRoom?.camTarget || [0, 1.6, -4]
		camera.position.set(cpx, cpy, cpz)
		cameraLookAt.set(ctx, cty, ctz)
		camera.lookAt(cameraLookAt)

		_applyPerfTier()
		if (renderer) {
			renderer.dispose()
			renderer.domElement.remove()
			renderer = null
		}
		renderer = new THREE.WebGLRenderer({
			antialias: !isLowEnd,   // low: off  —  mid/std: on
			powerPreference: 'high-performance',
		})
		renderer.setSize(width, height)
		// DPR scales render target quadratically — cap by tier:
		//   low: 1.0   mid: 1.5   std: 2.0
		const dprCap = isLowEnd ? 1 : isMidRange ? 1.5 : 2
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap))
		renderer.shadowMap.enabled = true
		renderer.shadowMap.type = THREE.PCFShadowMap
		renderer.outputColorSpace = THREE.SRGBColorSpace
		renderer.toneMapping = THREE.LinearToneMapping
		renderer.toneMappingExposure =
			document.documentElement.classList.contains("light") ? 1.2 : 0.9
		container.appendChild(renderer.domElement)

		labelRenderer = new CSS2DRenderer()
		labelRenderer.setSize(width, height)
		labelRenderer.domElement.style.cssText =
			"position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;"
		container.appendChild(labelRenderer.domElement)

		timer = new THREE.Timer()

		buildMaterials()
		setupLighting()
		buildScene()
		spawnDog()
		if (isLight) applyThemeMaterials(false)
		syncLobbySkyMap(!document.documentElement.classList.contains("light"))

		// Keep seat dot colours in sync with live presence. Seat-dot state depends only on
		// (seatId, status) pairs, so key the watch on a derived string instead of deep-watching
		// the whole users array — a deep watch fires on every position heartbeat.
		watch(
			() => presenceStore.users.map(u => `${u.seatId ?? ''}:${u.status ?? ''}`).join('|'),
			refreshSeatDots,
		)

		resizeObserver = new ResizeObserver(([e]) => {
			const { width: w, height: h } = e.contentRect
			camera.aspect = w / h
			camera.updateProjectionMatrix()
			renderer.setSize(w, h)
			labelRenderer.setSize(w, h)
		})
		resizeObserver.observe(container)
		container.dataset.view = "pov"

		renderer.domElement.addEventListener("pointerdown", onDragStart)
		renderer.domElement.addEventListener("pointermove", onDragMove)
		renderer.domElement.addEventListener("pointerup", onDragEnd)
		renderer.domElement.addEventListener("wheel", onCanvasWheel, {
			passive: false,
		})
		document.addEventListener("keydown", onKeyDown)
		document.addEventListener("keyup", onKeyUp)
		window.addEventListener("blur", onWindowBlur)
		window.addEventListener("ava-theme", onThemeChange)

		animate()
		return engine
	}

	// ── Lighting ────────────────────────────────────────────────────
	function setupLighting () {
		const isLight = document.documentElement.classList.contains("light")

		// Ambient is the primary room fill now that per-room PointLights are removed.
		// Slightly warmer/brighter than before so rooms don't look flat.
		ambientLight = new THREE.AmbientLight(
			isLight ? 0xfff8f0 : 0xc8d8f0,
			isLight ? 1.3 : 0.85,
		)
		scene.add(ambientLight)

		sunLight = new THREE.DirectionalLight(
			isLight ? 0xfff5e0 : 0x90c8e8,
			isLight ? 1.6 : 0.9,
		)
		sunLight.position.set(15, 30, 10)
		sunLight.castShadow = true
		sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -80
		sunLight.shadow.camera.right = sunLight.shadow.camera.top = 80
		sunLight.shadow.camera.far = 300
		// Use 2048 only on capable GPUs (maxTextureSize ≥ 4096); fall back to 1024
		const shadowRes = renderer.capabilities.maxTextureSize >= 4096 ? 2048 : 1024
		sunLight.shadow.mapSize.set(shadowRes, shadowRes)
		sunLight.shadow.bias = -0.001
		scene.add(sunLight)

		fillLight = new THREE.DirectionalLight(
			isLight ? 0xd8eeff : 0x304060,
			isLight ? 0.5 : 0.3,
		)
		fillLight.position.set(-10, 15, -20)
		scene.add(fillLight)
	}

	// ── Room visibility culling ─────────────────────────────────────
	// Hides all rooms except the current one and its direct connections.
	// showAll = true is used for overhead view (entire floor plan visible).
	// Special case: the office wing's 16 rooms share walls with the hall,
	// so any office or office-hall visit shows the entire wing.
	function _applyRoomCulling (roomId, showAll = false) {
		if (!roomGroups.size) return
		// Only cull on low-end devices — ceiling PointLights were removed so
		// rendering all rooms every frame is no longer expensive on capable hardware.
		if (!isLowEnd) {
			for (const g of roomGroups.values()) g.visible = true
			return
		}
		const room = getRoomById(roomId)
		const visible = new Set()

		if (showAll) {
			for (const id of roomGroups.keys()) visible.add(id)
		} else {
			visible.add(roomId)
			for (const c of room?.connections || []) visible.add(c)
			// Office wing: offices share wall geometry with the hall —
			// render all of them together to avoid missing wall panels.
			const inOfficeWing = roomId === 'office-hall' || roomId.startsWith('office-')
			if (inOfficeWing) {
				visible.add('office-hall')
				for (const id of roomGroups.keys()) {
					if (id.startsWith('office-')) visible.add(id)
				}
			}
		}

		for (const [id, g] of roomGroups) {
			g.visible = visible.has(id)
		}
	}

	// ── Office dog ───────────────────────────────────────────────────
	function spawnDog () {
		const tan = new THREE.MeshStandardMaterial({ color: 0xd9a45a, roughness: 0.75 })
		const cream = new THREE.MeshStandardMaterial({ color: 0xf4e2bf, roughness: 0.78 })
		const brown = new THREE.MeshStandardMaterial({ color: 0x6e3a1c, roughness: 0.78 })
		const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.55 })
		const pink = new THREE.MeshStandardMaterial({ color: 0xe08080, roughness: 0.6 })

		const g = new THREE.Group()

		// Body
		const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.20), tan)
		body.position.set(0, 0.28, 0)
		g.add(body)

		// Belly stripe
		const belly = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.08, 0.16), cream)
		belly.position.set(0, 0.20, 0)
		g.add(belly)

		// Brown spot on flank
		const spot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), brown)
		spot.scale.set(1, 0.5, 0.6)
		spot.position.set(-0.05, 0.34, 0.11)
		g.add(spot)

		// Head
		const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.17, 0.17), tan)
		head.position.set(0.22, 0.36, 0)
		g.add(head)

		// Snout
		const snout = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.11), cream)
		snout.position.set(0.33, 0.31, 0)
		g.add(snout)

		// Nose
		const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), black)
		nose.position.set(0.388, 0.33, 0)
		g.add(nose)

		// Eyes
		for (const s of [1, -1]) {
			const eye = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), black)
			eye.position.set(0.29, 0.40, 0.055 * s)
			g.add(eye)
		}

		// Ears — floppy flat boxes slanted outward
		for (const s of [1, -1]) {
			const ear = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, 0.08), brown)
			ear.position.set(0.18, 0.46, 0.07 * s)
			ear.rotation.z = -0.3 * s
			ear.rotation.x = 0.2 * s
			g.add(ear)
		}

		// Tongue (peeks out)
		const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.05), pink)
		tongue.position.set(0.365, 0.285, 0)
		g.add(tongue)

		// Tail
		const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.014, 0.18, 8), tan)
		tail.position.set(-0.20, 0.38, 0)
		tail.rotation.z = Math.PI / 2.6
		g.add(tail)
		g.userData.tail = tail

		// Legs
		const legGeo = new THREE.BoxGeometry(0.06, 0.16, 0.06)
		const legMeshes = []
		const legOffsets = [
			[0.13, 0.08], [0.13, -0.08],  // front R/L
			[-0.13, 0.08], [-0.13, -0.08],  // back  R/L
		]
		for (let i = 0; i < 4; i++) {
			const [lx, lz] = legOffsets[i]
			const leg = new THREE.Mesh(legGeo, tan)
			leg.position.set(lx, 0.09, lz)
			leg.userData.legIdx = i
			leg.userData.baseY = 0.09
			g.add(leg)
			legMeshes.push(leg)
		}

		// Permanent name tag (styled like avatar labels, with paw prefix)
		const nameEl = document.createElement('div')
		nameEl.className = 'avatar-label'
		const paw = document.createElement('span')
		paw.textContent = '🐾'
		paw.style.marginRight = '4px'
		nameEl.appendChild(paw)
		nameEl.appendChild(document.createTextNode('Byte'))
		nameEl.addEventListener('click', (e) => {
			e.stopPropagation()
			window.dispatchEvent(
				new CustomEvent('ava-dog-click', {
					detail: { screenX: e.clientX, screenY: e.clientY },
				}),
			)
		})
		const nameLabel = new CSS2DObject(nameEl)
		nameLabel.position.set(0.05, 1.25, 0)
		g.add(nameLabel)

		// "Woof!" label (hidden by default)
		const woofEl = document.createElement('div')
		woofEl.className = 'ava-woof-bubble'
		woofEl.textContent = 'Woof!'
		woofEl.style.cssText = `
			background: #fff;
			color: #c8202a;
			font: 800 12px/1 "Comic Sans MS", "Trebuchet MS", sans-serif;
			padding: 3px 8px;
			border-radius: 10px;
			border: 2px solid #c8202a;
			box-shadow: 0 2px 6px rgba(0,0,0,0.35);
			transform: translateY(-8px);
			pointer-events: none;
			white-space: nowrap;
			opacity: 0;
			transition: opacity 0.12s ease;
		`
		const woofLabel = new CSS2DObject(woofEl)
		woofLabel.position.set(0.22, 0.95, 0)
		g.add(woofLabel)

		dogGroup = g
		dogState.legMeshes = legMeshes
		dogState.woofLabel = woofLabel
		dogState.nameLabel = nameLabel

		// Flag every mesh so the raycaster can identify a dog click without caring which
		// body part was hit. Tail is already tagged via userData.tail; don't overwrite it.
		g.traverse((c) => {
			if (c.isMesh) c.userData.isDog = true
		})
		g.userData.isDog = true

		// Start in the lobby; idle roaming will kick in shortly.
		const startRoom = getRoomById('lobby') || ALL_ROOMS[0]
		const cur = randomRoomXZ(startRoom, 1.8)
		g.position.set(cur.x, 0, cur.z)
		dogState.x = cur.x
		dogState.z = cur.z
		dogState.roomId = startRoom.id
		scene.add(g)
	}

	// ── Room scene build ────────────────────────────────────────────
	function buildScene () {
		for (const room of ALL_ROOMS) {
			const g = buildRoom(room)
			scene.add(g)
			roomGroups.set(room.id, g)
		}
		// Lift any PointLights out of room groups into the scene root.
		// Ceiling PointLights were removed (ambient + sun now carry room fill);
		// this loop now only moves the aquarium's single accent light.
		// Keeping lights as direct scene children means NUM_POINT_LIGHTS never
		// changes when rooms are culled — no shader recompile, no freeze.
		scene.updateMatrixWorld()
		for (const g of roomGroups.values()) {
			const lights = []
			g.traverse(obj => { if (obj.isPointLight) lights.push(obj) })
			for (const light of lights) {
				const wp = new THREE.Vector3()
				light.getWorldPosition(wp)
				light.parent.remove(light)
				light.position.copy(wp)
				scene.add(light)
			}
		}

		// Pair up doors that share the same physical wall plane (inside ↔ outside).
		linkDoorPartners()

		// Start with only lobby visible.  Lights remain at scene root so
		// NUM_POINT_LIGHTS never changes when rooms are hidden — no shader recompile.
		_applyRoomCulling('lobby')
	}

	function floorMat (type) {
		if (type === "marble") return M.floorMarble
		if (type === "carpet") return M.floorCarpet
		if (type === "rubber") return M.floorRubber
		if (type === "grass") return M.floorGrass
		return M.floor
	}

	function createLobbySkyTextures () {
		const W = 1024
		const H = 512
		const dayC = document.createElement("canvas")
		dayC.width = W
		dayC.height = H
		const dctx = dayC.getContext("2d")
		const gDay = dctx.createLinearGradient(0, H, 0, 0)
		// Slightly deeper zenith / horizon so white clouds separate clearly.
		gDay.addColorStop(0, "#4a6282")
		gDay.addColorStop(0.38, "#3a62b0")
		gDay.addColorStop(0.72, "#6ab8f0")
		gDay.addColorStop(1, "#c8e8ff")
		dctx.fillStyle = gDay
		dctx.fillRect(0, 0, W, H)

		const fillRotEllipse = (cx, cy, rx, ry, rot, fillStyle, alpha) => {
			dctx.save()
			dctx.globalAlpha = alpha
			dctx.fillStyle = fillStyle
			dctx.beginPath()
			dctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2)
			dctx.fill()
			dctx.restore()
		}

		// Irregular “wisp” clusters: stacked stretched ellipses (not circles) + faint underbody.
		const drawWispCluster = (ax, ay, seed) => {
			const rnd = prng32(seed)
			const n = 5 + Math.floor(rnd() * 4)
			fillRotEllipse(
				ax + 10 + rnd() * 16,
				ay + 12 + rnd() * 10,
				38 + rnd() * 52,
				11 + rnd() * 14,
				rnd() * Math.PI,
				"#2c4670",
				0.12 + rnd() * 0.08,
			)
			for (let k = 0; k < n; k++) {
				const ox = (rnd() - 0.5) * 95
				const oy = (rnd() - 0.5) * 42
				const rx = 16 + rnd() * 52
				const ry = 5 + rnd() * 24
				const rot = rnd() * Math.PI
				const a = 0.1 + rnd() * 0.22
				const lit = rnd() > 0.42
					? "rgba(252,254,255,0.9)"
					: "rgba(228,238,250,0.72)"
				fillRotEllipse(ax + ox, ay + oy, rx, ry, rot, lit, a)
			}
		}

		const drawCurvedWisp = (seed) => {
			const rnd = prng32(seed)
			const x0 = rnd() * W
			const y0 = rnd() * H * 0.72
			const x1 = x0 + (rnd() - 0.35) * 200
			const y1 = y0 + (rnd() - 0.5) * 70
			const cx = (x0 + x1) / 2 + (rnd() - 0.5) * 95
			const cy = (y0 + y1) / 2 - rnd() * 48
			dctx.save()
			dctx.globalAlpha = 0.08 + rnd() * 0.14
			dctx.strokeStyle = "rgba(248,252,255,0.8)"
			dctx.lineWidth = 1.5 + rnd() * 5
			dctx.lineCap = "round"
			dctx.beginPath()
			dctx.moveTo(x0, y0)
			dctx.quadraticCurveTo(cx, cy, x1, y1)
			dctx.stroke()
			dctx.restore()
		}

		// Overhead: fewer clusters, wider canvas spread so they do not stack on one patch of sky.
		for (let i = 0; i < 9; i++) {
			const rnd = prng32(20_000 + i * 59)
			const cx = (0.05 + rnd() * 0.9) * W
			const cy = (0.04 + rnd() * 0.32) * H
			drawWispCluster(cx, cy, 31_000 + i * 97)
		}
		// East + mid: spaced across more of u / v.
		for (let i = 0; i < 8; i++) {
			const rnd = prng32(40_000 + i * 61)
			const cx = (0.28 + rnd() * 0.68) * W
			const cy = (0.14 + rnd() * 0.56) * H
			drawWispCluster(cx, cy, 51_000 + i * 131)
		}
		for (let i = 0; i < 16; i++)
			drawCurvedWisp(70_000 + i * 17)

		dctx.globalAlpha = 1
		// Sun on texture **east** (right) + mid band so it sits over +X when sphere is rotated (visible from west side).
		const sunX = W * 0.88
		const sunY = H * 0.42
		const sunR = 24
		const sgrad = dctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 1.12)
		sgrad.addColorStop(0, "#fffef8")
		sgrad.addColorStop(0.18, "#fff4b0")
		sgrad.addColorStop(0.45, "#ffdd33")
		sgrad.addColorStop(0.72, "rgba(255,170,40,0.4)")
		sgrad.addColorStop(1, "rgba(255,140,30,0)")
		dctx.fillStyle = sgrad
		dctx.beginPath()
		dctx.arc(sunX, sunY, sunR, 0, Math.PI * 2)
		dctx.fill()

		const nightC = document.createElement("canvas")
		nightC.width = W
		nightC.height = H
		const nctx = nightC.getContext("2d")
		const gNight = nctx.createLinearGradient(0, H, 0, 0)
		gNight.addColorStop(0, "#050a14")
		gNight.addColorStop(0.5, "#0d2040")
		gNight.addColorStop(1, "#1a3560")
		nctx.fillStyle = gNight
		nctx.fillRect(0, 0, W, H)
		// Stars: canvas is 1×1 px — without NearestFilter + mip off, GPU linear+mips blow them up to “blobs”.
		for (let i = 0; i < 360; i++) {
			const br = 0.35 + (i % 13) * 0.05
			nctx.fillStyle = `rgba(255,255,255,${Math.min(0.96, br)})`
			nctx.fillRect((i * 73) % W, (i * 41 * 17) % H, 1, 1)
		}
		// Waxing crescent — same **east / mid-elevation** placement as sun for visibility from -X.
		const mx = W * 0.87
		const my = H * 0.4
		const moonR = 22
		nctx.save()
		nctx.globalAlpha = 0.44
		const moonLit = nctx.createRadialGradient(mx - 6, my - 3, 0, mx, my, moonR)
		moonLit.addColorStop(0, "#f2f8ff")
		moonLit.addColorStop(0.55, "#d0dce8")
		moonLit.addColorStop(1, "rgba(160,180,205,0.2)")
		nctx.fillStyle = moonLit
		nctx.beginPath()
		nctx.arc(mx, my, moonR, 0, Math.PI * 2)
		nctx.fill()
		nctx.globalCompositeOperation = "destination-out"
		nctx.globalAlpha = 0.92
		nctx.fillStyle = "#0a1428"
		nctx.beginPath()
		nctx.arc(mx + moonR * 0.58, my - 2, moonR * 0.98, 0, Math.PI * 2)
		nctx.fill()
		nctx.restore()

		const dayTex = new THREE.CanvasTexture(dayC)
		const nightTex = new THREE.CanvasTexture(nightC)
		const ani = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1
		dayTex.colorSpace = THREE.SRGBColorSpace
		dayTex.generateMipmaps = false
		dayTex.minFilter = THREE.LinearFilter
		dayTex.magFilter = THREE.LinearFilter
		dayTex.anisotropy = Math.min(12, ani)
		dayTex.needsUpdate = true

		nightTex.colorSpace = THREE.SRGBColorSpace
		nightTex.generateMipmaps = false
		nightTex.minFilter = THREE.NearestFilter
		nightTex.magFilter = THREE.NearestFilter
		nightTex.anisotropy = 1
		nightTex.needsUpdate = true
		return { dayTex, nightTex }
	}

	function syncLobbySkyMap (dark) {
		if (!lobbySkyMaterial || !lobbySkyDayTex || !lobbySkyNightTex) return
		lobbySkyMaterial.map = dark ? lobbySkyNightTex : lobbySkyDayTex
		lobbySkyMaterial.needsUpdate = true
	}

	function roofBilinear (u, v, c00, c10, c01, c11) {
		const omu = 1 - u
		const omv = 1 - v
		return new THREE.Vector3(
			omu * omv * c00.x + u * omv * c10.x + omu * v * c01.x + u * v * c11.x,
			omu * omv * c00.y + u * omv * c10.y + omu * v * c01.y + u * v * c11.y,
			omu * omv * c00.z + u * omv * c10.z + omu * v * c01.z + u * v * c11.z,
		)
	}

	function addGreenhouseFrameRod (parent, p0, p1, radius, mat) {
		const a = p0.clone()
		const b = p1.clone()
		const len = a.distanceTo(b)
		if (len < 0.05) return
		const geo = new THREE.CylinderGeometry(radius, radius, len, 5, 1, false)
		const mesh = new THREE.Mesh(geo, mat)
		mesh.position.copy(a.clone().add(b).multiplyScalar(0.5))
		const dir = b.clone().sub(a).normalize()
		mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
		mesh.castShadow = false
		mesh.receiveShadow = false
		parent.add(mesh)
	}

	function addLobbySkyDome (g, h, roofRise, w, d) {
		if (!lobbySkyDayTex || !lobbySkyNightTex) {
			const t = createLobbySkyTextures()
			lobbySkyDayTex = t.dayTex
			lobbySkyNightTex = t.nightTex
		}
		if (!lobbySkyMaterial) {
			const darkNow = !document.documentElement.classList.contains("light")
			lobbySkyMaterial = new THREE.MeshBasicMaterial({
				map: darkNow ? lobbySkyNightTex : lobbySkyDayTex,
				side: THREE.BackSide,
				depthWrite: false,
			})
		}
		const peakY = h + roofRise
		// Smaller radius + lower center = sky surface subtends larger angles through the glass.
		const skyR = Math.max(w, d) * 0.88 + 26
		const seg = isLowEnd ? 28 : 40
		const sky = new THREE.Mesh(new THREE.SphereGeometry(skyR, seg, Math.max(12, Math.floor(seg * 0.65))), lobbySkyMaterial)
		sky.name = "lobby-sky-sphere"
		sky.position.set(0, peakY + skyR * 0.2, 0)
		// Map texture “right / east” (sun & moon drawn at high u) onto world +X (east wall).
		sky.rotation.y = -Math.PI / 2
		sky.renderOrder = -4
		g.add(sky)
	}

	/** Ridge along +X; glass meets all four walls (sealed). Mullion grid + sky above. */
	function addGreenhouseGableCeiling (g, w, d, h, roofRise) {
		const peakY = h + roofRise
		const frameMat = M.lobbyGreenhouseFrame
		const railR = 0.032

		const north = {
			c00: new THREE.Vector3(-w / 2, h, d / 2),
			c10: new THREE.Vector3(w / 2, h, d / 2),
			c01: new THREE.Vector3(-w / 2, peakY, 0),
			c11: new THREE.Vector3(w / 2, peakY, 0),
		}
		const south = {
			c00: new THREE.Vector3(-w / 2, h, -d / 2),
			c10: new THREE.Vector3(w / 2, h, -d / 2),
			c01: new THREE.Vector3(-w / 2, peakY, 0),
			c11: new THREE.Vector3(w / 2, peakY, 0),
		}

		const addSlopeMesh = (corners) => {
			const { c00, c10, c01, c11 } = corners
			const geo = new THREE.BufferGeometry()
			const pos = new Float32Array([
				c00.x, c00.y, c00.z, c10.x, c10.y, c10.z, c11.x, c11.y, c11.z,
				c00.x, c00.y, c00.z, c11.x, c11.y, c11.z, c01.x, c01.y, c01.z,
			])
			geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
			geo.computeVertexNormals()
			geo.setAttribute(
				"uv",
				new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]), 2),
			)
			const mesh = new THREE.Mesh(geo, M.lobbyDomeGlass)
			mesh.castShadow = false
			mesh.receiveShadow = true
			g.add(mesh)
		}
		addSlopeMesh(north)
		addSlopeMesh(south)

		const addTri = (a, b, c) => {
			const geo = new THREE.BufferGeometry()
			const pos = new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z])
			geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
			geo.computeVertexNormals()
			const mesh = new THREE.Mesh(geo, M.lobbyDomeGlass)
			mesh.castShadow = false
			mesh.receiveShadow = true
			g.add(mesh)
		}
		addTri(
			new THREE.Vector3(w / 2, h, -d / 2),
			new THREE.Vector3(w / 2, h, d / 2),
			new THREE.Vector3(w / 2, peakY, 0),
		)
		addTri(
			new THREE.Vector3(-w / 2, h, d / 2),
			new THREE.Vector3(-w / 2, h, -d / 2),
			new THREE.Vector3(-w / 2, peakY, 0),
		)

		const nu = isLowEnd ? 9 : 15
		const nv = isLowEnd ? 4 : 6
		for (const corners of [north, south]) {
			const { c00, c10, c01, c11 } = corners
			for (let i = 0; i <= nu; i++) {
				const u = i / nu
				addGreenhouseFrameRod(
					g,
					roofBilinear(u, 0, c00, c10, c01, c11),
					roofBilinear(u, 1, c00, c10, c01, c11),
					railR,
					frameMat,
				)
			}
			for (let j = 1; j < nv; j++) {
				const v = j / nv
				addGreenhouseFrameRod(
					g,
					roofBilinear(0, v, c00, c10, c01, c11),
					roofBilinear(1, v, c00, c10, c01, c11),
					railR,
					frameMat,
				)
			}
		}

		const ridgeH = 0.15
		const ridge = new THREE.Mesh(
			new THREE.BoxGeometry(w + 0.38, ridgeH, 0.13),
			frameMat,
		)
		ridge.position.set(0, peakY + ridgeH / 2 - 0.02, 0)
		ridge.castShadow = true
		ridge.receiveShadow = true
		g.add(ridge)

		for (const zSign of [-1, 1]) {
			const eave = new THREE.Mesh(
				new THREE.BoxGeometry(w + 0.28, 0.11, 0.1),
				frameMat,
			)
			eave.position.set(0, h + 0.055, zSign * (d / 2 - 0.045))
			eave.castShadow = true
			g.add(eave)
		}
		for (const xSign of [-1, 1]) {
			const cap = new THREE.Mesh(
				new THREE.BoxGeometry(0.1, 0.11, d + 0.1),
				frameMat,
			)
			cap.position.set(xSign * (w / 2 - 0.045), h + 0.055, 0)
			cap.castShadow = true
			g.add(cap)
		}

		const eN = new THREE.Vector3(w / 2, h, -d / 2)
		const eS = new THREE.Vector3(w / 2, h, d / 2)
		const eTop = new THREE.Vector3(w / 2, peakY, 0)
		addGreenhouseFrameRod(g, eN, eTop, railR * 1.08, frameMat)
		addGreenhouseFrameRod(g, eS, eTop, railR * 1.08, frameMat)
		addGreenhouseFrameRod(g, eN, eS, railR * 1.08, frameMat)
		const wN = new THREE.Vector3(-w / 2, h, -d / 2)
		const wS = new THREE.Vector3(-w / 2, h, d / 2)
		const wTop = new THREE.Vector3(-w / 2, peakY, 0)
		addGreenhouseFrameRod(g, wN, wTop, railR * 1.08, frameMat)
		addGreenhouseFrameRod(g, wS, wTop, railR * 1.08, frameMat)
		addGreenhouseFrameRod(g, wN, wS, railR * 1.08, frameMat)

		const plCenter = new THREE.PointLight(0xffe8cc, 0.15, 52, 1.9)
		plCenter.position.set(0, peakY - 0.42, 0)
		g.add(plCenter)
		const edgeY = h + roofRise * 0.5
		for (const zz of [-1, 1]) {
			const pl = new THREE.PointLight(0xffecd8, 0.085, 34, 2)
			pl.position.set(0, edgeY, zz * (d * 0.29))
			g.add(pl)
		}
		for (const xx of [-1, 1]) {
			const pl = new THREE.PointLight(0xffecd8, 0.075, 28, 2)
			pl.position.set(xx * (w * 0.33), edgeY, 0)
			g.add(pl)
		}

		addLobbySkyDome(g, h, roofRise, w, d)
	}

	function buildRoom (room) {
		const g = new THREE.Group()
		g.name = room.id
		g.position.set(room.pos[0], 0, room.pos[1])

		const w = room.size[0],
			d = room.size[1],
			h = room.height || 3.2
		const isGlass = room.wallType === "glass"
		const wallMat = isGlass
			? M.wallGlass
			: room.type === "office"
				? M.wallOffice
				: M.wall

		// Floor
		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(w, d),
			floorMat(room.floorType),
		)
		floor.rotation.x = -Math.PI / 2
		floor.receiveShadow = true
		g.add(floor)
		_floorMeshMap.set(floor, room.id)

		// Ceiling — flat default, greenhouse glass (lobby), or open-sky (courtyard).
		if (room.ceilingKind === "glass-greenhouse") {
			addGreenhouseGableCeiling(g, w, d, h, room.roofRise ?? 4.5)
		} else if (room.ceilingKind !== "none") {
			const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.ceiling)
			ceil.rotation.x = Math.PI / 2
			ceil.position.y = h
			g.add(ceil)
		}

		// Walls
		buildWalls(g, room, w, d, h, wallMat)

		// Accent trim (floor-level LED strip) — skip outdoors
		if (room.ceilingKind !== "none") addFloorTrim(g, w, d)

		// Ceiling light strip
		addCeilingLight(g, room, w, d, h)

		// Outdoor sun light
		if (room.ceilingKind === "none") {
			const sun = new THREE.PointLight(0xfff8e0, 1.6, Math.max(w, d) * 2.4, 1.5)
			sun.position.set(0, 14, 0)
			g.add(sun)
		}

		// Furniture
		buildFurniture(g, room, w, d, h)

		// Invisible seat click targets (shared rooms)
		buildSeats(g, room)

		// Door labels (CSS2D) & nav trigger
		addDoorLabels(g, room, w, d, h)

		// Overhead room-name label (hidden in POV via CSS)
		addRoomNameLabel(g, room)

		return g
	}

	// ── Walls ────────────────────────────────────────────────────────
	function buildWalls (g, room, w, d, h, wallMat) {
		const thick = 0.22
		const skip = new Set(room.skipWalls || [])

		// Collect doors per wall
		const byWall = { north: [], south: [], east: [], west: [] }
		for (const door of room.doors || []) {
			byWall[door.wall]?.push(door)
		}

		if (!skip.has("north")) addWall(g, "north", w, d, h, thick, byWall.north, wallMat, room)
		if (!skip.has("south")) addWall(g, "south", w, d, h, thick, byWall.south, wallMat, room)
		if (!skip.has("east")) addWall(g, "east", w, d, h, thick, byWall.east, wallMat, room)
		if (!skip.has("west")) addWall(g, "west", w, d, h, thick, byWall.west, wallMat, room)
	}

	// doors may be a single door object, an array, or null/empty.
	// Supports multiple openings on one wall (e.g. main-hall south has 4 doors).
	function addWall (g, side, w, d, h, thick, doors, wallMat, room) {
		const isNS = side === "north" || side === "south"
		const wallLen = isNS ? w : d
		const doorH = 2.25

		const makeSeg = (len, segH, segY, posX, posZ) => {
			if (len <= 0.05) return
			const geo = isNS
				? new THREE.BoxGeometry(len, segH, thick)
				: new THREE.BoxGeometry(thick, segH, len)
			const mesh = new THREE.Mesh(geo, wallMat)
			mesh.castShadow = true
			mesh.receiveShadow = true
			mesh.position.set(posX, segY, posZ)
			g.add(mesh)
			return mesh
		}

		const zPos = side === "north" ? d / 2 : side === "south" ? -d / 2 : 0
		const xPos = side === "east" ? w / 2 : side === "west" ? -w / 2 : 0

		// Normalise to sorted array
		const doorArr = !doors || (Array.isArray(doors) && doors.length === 0)
			? []
			: (Array.isArray(doors) ? [...doors] : [doors]).sort(
				(a, b) => (a.offset ?? 0) - (b.offset ?? 0),
			)

		if (doorArr.length === 0) {
			if (isNS) makeSeg(w, h, h / 2, 0, zPos)
			else makeSeg(d, h, h / 2, xPos, 0)
			return
		}

		// Walk along the wall left-to-right, emitting solid segments between each opening
		let cursor = -wallLen / 2
		for (const door of doorArr) {
			const dOff = door.offset ?? 0
			const dW = door.width ?? 0
			const leftEdge = dOff - dW / 2
			const rightEdge = dOff + dW / 2

			// Solid segment before this opening
			const segL = leftEdge - cursor
			if (segL > 0.05) {
				const ctr = cursor + segL / 2
				makeSeg(segL, h, h / 2, isNS ? ctr : xPos, isNS ? zPos : ctr)
			}

			// Lintel above opening
			const lintelH = h - doorH
			if (lintelH > 0.02) {
				makeSeg(dW, lintelH, doorH + lintelH / 2, isNS ? dOff : xPos, isNS ? zPos : dOff)
			}

			addDoorFrame(g, side, dOff, dW, doorH, thick, w, d, room)
			addDoorPivot(g, side, dOff, dW, doorH, thick, w, d, room)

			cursor = rightEdge
		}

		// Solid segment after the last opening
		const tailL = wallLen / 2 - cursor
		if (tailL > 0.05) {
			const ctr = cursor + tailL / 2
			makeSeg(tailL, h, h / 2, isNS ? ctr : xPos, isNS ? zPos : ctr)
		}
	}

	function addDoorFrame (g, side, dOff, dW, dH, thick, w, d, _room) {
		const isNS = side === "north" || side === "south"
		const zPos = side === "north" ? d / 2 : side === "south" ? -d / 2 : 0
		const xPos = side === "east" ? w / 2 : side === "west" ? -w / 2 : 0
		const ft = 0.08

		// Top bar of door frame
		const topGeo = isNS
			? new THREE.BoxGeometry(dW + ft * 2, ft, thick + 0.12)
			: new THREE.BoxGeometry(thick + 0.12, ft, dW + ft * 2)

		const top = new THREE.Mesh(topGeo, M.doorFrame)
		top.position.set(isNS ? dOff : xPos, dH + ft / 2, isNS ? zPos : dOff)
		g.add(top)

		// Side posts
		const postH = dH
		const postGeoNS = new THREE.BoxGeometry(ft, postH, thick + 0.12)
		const postGeoEW = new THREE.BoxGeometry(thick + 0.12, postH, ft)
		const pGeo = isNS ? postGeoNS : postGeoEW

		const leftPost = new THREE.Mesh(pGeo, M.doorFrame)
		leftPost.position.set(
			isNS ? dOff - dW / 2 - ft / 2 : xPos,
			postH / 2,
			isNS ? zPos : dOff - dW / 2 - ft / 2,
		)
		g.add(leftPost)

		const rightPost = leftPost.clone()
		rightPost.position.set(
			isNS ? dOff + dW / 2 + ft / 2 : xPos,
			postH / 2,
			isNS ? zPos : dOff + dW / 2 + ft / 2,
		)
		g.add(rightPost)

	}

	function addDoorPivot (g, side, dOff, dW, dH, thick, w, d, room) {
		// Single doors (< 2.5 m) fill the opening; double-wide passages get a half-width leaf
		const leafW = dW >= 2.5 ? dW / 2 : dW
		const pivot = new THREE.Group()
		const panel = new THREE.Mesh(
			new THREE.BoxGeometry(leafW - 0.06, dH - 0.06, 0.1),
			M.door,
		)
		panel.position.set(leafW / 2 - 0.03, dH / 2, 0)
		pivot.add(panel)
		panel.castShadow = true

		// Glass panel inset
		const glassPart = new THREE.Mesh(
			new THREE.BoxGeometry(leafW * 0.5, dH * 0.35, 0.02),
			M.wallGlass,
		)
		glassPart.position.set(leafW / 2, dH * 0.65, 0)
		pivot.add(glassPart)

		if (side === "north") pivot.position.set(dOff - dW / 2, 0, d / 2)
		else if (side === "south") { pivot.position.set(dOff + dW / 2, 0, -d / 2); pivot.rotation.y = Math.PI }
		else if (side === "east") { pivot.position.set(w / 2, 0, dOff - dW / 2); pivot.rotation.y = -Math.PI / 2 }
		else { pivot.position.set(-w / 2, 0, dOff + dW / 2); pivot.rotation.y = Math.PI / 2 }
		g.add(pivot)

		// World-space centre of the door opening — used by linkDoorPartners() to
		// find the matching door panel on the other side of the same wall.
		const worldCX = side === "east" ? room.pos[0] + w / 2
			: side === "west" ? room.pos[0] - w / 2
				: room.pos[0] + dOff
		const worldCZ = side === "north" ? room.pos[1] + d / 2
			: side === "south" ? room.pos[1] - d / 2
				: room.pos[1] + dOff

		// Use a unique key — multiple doors on the same wall (e.g. main-hall south)
		// would otherwise clobber each other in the map.
		let key = `${room.id}-${side}`
		if (doorPivots.has(key)) {
			let n = 1
			while (doorPivots.has(`${key}-${n}`)) n++
			key = `${key}-${n}`
		}

		const initialRotationY = pivot.rotation.y
		// North/South: counterclockwise (+) swings inward; East/West: clockwise (-)
		const openSign = side === "north" || side === "south" ? 1 : -1
		pivot.rotation.y = initialRotationY + openSign * Math.PI * 0.48 // start open

		const _dm = []
		pivot.traverse(c => { if (c.isMesh) _dm.push(c) })
		doorPivots.set(key, {
			pivot,
			meshes: _dm,
			isOpen: true,
			// WHY: must default false so the door-click handler's `else if (entry.isLocked)`
			// branch does not match `undefined` and silently fall through to the
			// "closed but not locked" path before syncDoorStates has run.
			isLocked: false,
			roomId: room.id,
			wall: side,
			initialRotationY,
			openSign,
			worldCX,
			worldCZ,
			partner: null,   // filled in by linkDoorPartners()
		})
	}

	/**
	 * After the full scene is built, pair up door entries that share the same
	 * physical wall plane (world-space centre within 0.5 units).  Paired doors
	 * animate together when either side is opened or closed.
	 */
	function linkDoorPartners () {
		const entries = [...doorPivots.entries()]
		for (let i = 0; i < entries.length; i++) {
			const [keyA, doorA] = entries[i]
			if (doorA.partner) continue
			for (let j = i + 1; j < entries.length; j++) {
				const [keyB, doorB] = entries[j]
				if (doorB.partner) continue
				if (Math.abs(doorA.worldCX - doorB.worldCX) < 0.5 &&
					Math.abs(doorA.worldCZ - doorB.worldCZ) < 0.5) {
					doorA.partner = keyB
					doorB.partner = keyA
					break
				}
			}
		}
	}

	// ── Room name label (overhead only) ──────────────────────────────
	function addRoomNameLabel (g, room) {
		const div = document.createElement("div")
		div.className = "room-name-label"
		div.dataset.roomId = room.id
		// icon + short name; offices start with just the number, updated later via updateDoorLabel
		const shortName =
			room.type === "office"
				? room.name.replace("Office ", "")
				: room.name
		div.textContent = room.icon ? `${room.icon} ${shortName}` : shortName
		div.addEventListener("click", () => navigateTo(room.id))

		const obj = new CSS2DObject(div)
		obj.position.set(0, 0.6, 0) // floor-level, visible from above
		g.add(obj)
		roomNameLabels.set(room.id, obj)
	}

	function addDoorLabels (g, room, w, d, _h) {
		for (const door of room.doors || []) {
			if (!door.label) continue

			// Find destination room: explicit target, then match by name/id
			const targetRoom = door.target
				? ALL_ROOMS.find((r) => r.id === door.target)
				: ALL_ROOMS.find(
					(r) =>
						r.id !== room.id &&
						(r.id ===
							door.label.toLowerCase().replace(/\s+/g, "-") ||
							r.name.toLowerCase() ===
							door.label.toLowerCase() ||
							door.label
								.toLowerCase()
								.includes(
									r.name.toLowerCase().split(" ")[0],
								)),
				)

			const div = document.createElement("div")
			div.dataset.roomId = room.id
			if (targetRoom) {
				div.className = "door-label door-label--nav"
				div.title = `Go to ${targetRoom.name}`
				div.addEventListener("click", () => {
					if (currentRoom.value === targetRoom.id) {
						officeStore.toggleViewMode()
						setOverhead(officeStore.viewMode === "overhead")
					} else {
						navigateTo(targetRoom.id)
					}
				})
			} else {
				div.className = "door-label"
			}
			div.textContent = door.label

			const obj = new CSS2DObject(div)
			const dH = door.labelY ?? 2.0
			// Labels positioned inside room near the wall — appear inside the
			// room rectangle in overhead view, not floating in corridor gaps.
			if (door.wall === "north")
				obj.position.set(door.offset || 0, dH, d / 2 - 1.5)
			else if (door.wall === "south")
				obj.position.set(door.offset || 0, dH, -d / 2 + 1.5)
			else if (door.wall === "east")
				obj.position.set(w / 2 - 1.5, dH, door.offset || 0)
			else obj.position.set(-w / 2 + 1.5, dH, door.offset || 0)

			g.add(obj)
		}
	}

	/**
	 * Create or update the door label for a room.
	 * Pass an empty string to remove the label entirely.
	 * Used by OfficeView to stamp user names on office doors at runtime.
	 */
	function updateDoorLabel (roomId, text) {
		const room = getRoomById(roomId)
		if (!room) return
		const g = roomGroups.get(roomId)
		if (!g) return
		const door = room.doors?.[0]
		if (!door) return

		const existing = doorLabelObjects.get(roomId)

		// Keep overhead room-name label in sync with the occupant name
		const nameLabel = roomNameLabels.get(roomId)
		if (nameLabel) {
			nameLabel.element.textContent = text
				? `🏠 ${text}`
				: room.name.replace("Office ", "")
		}

		if (!text) {
			if (existing) {
				g.remove(existing)
				doorLabelObjects.delete(roomId)
			}
			return
		}

		if (existing) {
			existing.element.textContent = text
			return
		}

		// Create a fresh navigable label
		const div = document.createElement("div")
		div.className = "door-label door-label--nav"
		div.dataset.roomId = room.id
		div.textContent = `Ofc: ${text}`
		div.title = `Enter ${text}'s office`
		div.addEventListener("click", () => navigateTo(roomId))

		const obj = new CSS2DObject(div)
		const [w, d] = room.size
		const dH = door.labelY ?? 2.0
		if (door.wall === "north")
			obj.position.set(door.offset || 0, dH, d / 2 - 1.5)
		else if (door.wall === "south")
			obj.position.set(door.offset || 0, dH, -d / 2 + 1.5)
		else if (door.wall === "east")
			obj.position.set(w / 2 - 1.5, dH, door.offset || 0)
		else obj.position.set(-w / 2 + 1.5, dH, door.offset || 0)

		g.add(obj)
		doorLabelObjects.set(roomId, obj)
	}

	// ── Accent trim (floor LED strip) ────────────────────────────────
	function addFloorTrim (g, w, d) {
		const t = 0.04
		const trimH = 0.05
		const positions = [
			[new THREE.BoxGeometry(w, trimH, t), 0, trimH / 2, d / 2],
			[new THREE.BoxGeometry(w, trimH, t), 0, trimH / 2, -d / 2],
			[new THREE.BoxGeometry(t, trimH, d), w / 2, trimH / 2, 0],
			[new THREE.BoxGeometry(t, trimH, d), -w / 2, trimH / 2, 0],
		]
		for (const [geo, x, y, z] of positions) {
			const m = new THREE.Mesh(geo, M.accent)
			m.position.set(x, y, z)
			g.add(m)
		}
	}

	// ── Ceiling light panel ──────────────────────────────────────────
	function addCeilingLight (g, room, w, d, h) {
		const warmEm = new THREE.MeshStandardMaterial({
			color: 0xffd8a0,
			emissive: new THREE.Color(0xffd8a0),
			emissiveIntensity: 0.6,
		})
		if (room.ceilingKind === "glass-greenhouse" || room.ceilingKind === "none") return
		const pw = Math.min(w * 0.6, 8)
		const pd = Math.min(d * 0.6, 4)
		const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), warmEm)
		panel.rotation.x = Math.PI / 2
		panel.position.y = h - 0.02
		g.add(panel)
	}

	// ── Furniture builders ───────────────────────────────────────────
	function buildFurniture (g, room, _w, _d, _h) {
		for (const item of room.furniture || []) {
			const mesh = buildFurnitureItem(item, room)
			if (!mesh) continue
			g.add(mesh)
			if (mesh.userData.wallClockUpdate)
				wallClockUpdaters.push(mesh.userData.wallClockUpdate)
			if (mesh.userData.worldClockUpdate)
				worldClockUpdaters.push(mesh.userData.worldClockUpdate)
			if (mesh.userData.worldClockDispose)
				worldClockDisposers.push(mesh.userData.worldClockDispose)
			// Tag all furniture in individual offices for click-to-sit/visit raycasting
			// (exclude decorative items that should not trigger navigation)
			if (room.type === "office" && item.type !== "monitor" && item.type !== "office-wall-screen") {
				mesh.traverse((child) => {
					if (child.isMesh)
						officeFurnitureMeshes.push({
							mesh: child,
							roomId: room.id,
						})
				})
			}
			// Tag coffee machine meshes for the interactive click handler
			if (item.type === "coffee-machine") {
				mesh.traverse((child) => {
					if (child.isMesh)
						coffeeMachineMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag water cooler meshes for the interactive click handler
			if (item.type === "water-cooler") {
				mesh.traverse((child) => {
					if (child.isMesh)
						waterCoolerMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag intercom meshes for click handler
			if (item.type === "intercom") {
				mesh.traverse((child) => {
					if (child.isMesh)
						intercomMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag magazine meshes for click handler
			if (item.type === "magazine") {
				mesh.traverse((child) => {
					if (child.isMesh)
						magazineMeshes.push({ mesh: child, group: mesh, url: item.url })
				})
			}
			// Tag suggestion box meshes for click handler
			if (item.type === "suggestion-box") {
				mesh.traverse((child) => {
					if (child.isMesh)
						suggestionBoxMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag kudos plaque meshes for click handler
			if (item.type === "kudos-plaque") {
				mesh.traverse((child) => {
					if (child.isMesh)
						kudosPlaqueMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag Connect 4 cabinet meshes for click handler
			if (item.type === "connect4-cabinet") {
				mesh.traverse((child) => {
					if (child.isMesh)
						connect4Meshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag arcade cabinet meshes for click handler
			if (item.type === "arcade") {
				mesh.traverse((child) => {
					if (child.isMesh)
						arcadeMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag AVA-Man arcade cabinet meshes for click handler
			if (item.type === "arcade-pacman") {
				mesh.traverse((child) => {
					if (child.isMesh)
						arcadePacmanMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag ticket dispenser meshes for click handler
			if (item.type === "ticket-dispenser") {
				mesh.traverse((child) => {
					if (child.isMesh)
						ticketDispenserMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag Now Serving sign meshes for click handler
			if (item.type === "now-serving-sign") {
				mesh.traverse((child) => {
					if (child.isMesh)
						nowServingMeshes.push({ mesh: child, group: mesh })
				})
			}
			// Tag desk monitor meshes in personal offices for click handler
			if (item.type === "monitor" && room.type === "office") {
				mesh.traverse((child) => {
					if (child.isMesh)
						monitorMeshes.push({ mesh: child, group: mesh, roomId: room.id })
				})
			}
			// Tag whiteboard meshes for collaborative whiteboard click handler
			if (item.type === "whiteboard") {
				mesh.traverse((child) => {
					if (child.isMesh)
						whiteboardMeshes.push({ mesh: child, group: mesh, roomId: room.id })
				})
			}
			// Store the conference-room projector screen so calendar/Jitsi can paint it
			if (item.type === "projector-screen" && room.id === "conference") {
				mesh.traverse((child) => {
					if (child.isMesh && !projectorScreenMesh) {
						child.material = child.material.clone() // own instance — safe to swap map
						projectorScreenMesh = child
					}
				})
			}
			// Store each office wall-screen so the calendar canvas can be applied per-office
			if (item.type === "office-wall-screen") {
				mesh.traverse((child) => {
					if (child.isMesh && child.geometry.parameters?.width < 1.7 && !officeScreenMeshes.has(room.id)) {
						child.material = child.material.clone()
						officeScreenMeshes.set(room.id, child)
					}
				})
			}
		}
	}

	function buildFurnitureItem (item, _room) {
		const g = new THREE.Group()
		// pos can be [x, z] or [x, y, z] — honour Y when all three components are present
		const posY = item.pos[2] != null ? item.pos[1] : 0
		g.position.set(item.pos[0], posY, item.pos[2] ?? item.pos[1])
		if (item.rot) g.rotation.y = item.rot

		switch (item.type) {
			case "desk":
			case "desk-reception": {
				g.add(createOfficeDesk(
					{ desk: M.desk, accent: M.accent },
					{ reception: item.type === "desk-reception" },
				))
				break
			}
			case "monitor": {
				g.add(createOfficeMonitor({ desk: M.desk, screen: M.screen }))
				break
			}
			case "chair-office": {
				g.add(createOfficeChairOffice({ desk: M.desk, chair: M.chair }))
				break
			}
			case "bookshelf": {
				g.add(createOfficeBookshelf({ desk: M.desk }))
				break
			}
			case "sofa": {
				g.add(createOfficeSofa({ sofa: M.sofa }))
				break
			}
			case "lobby-sunken-lounge": {
				g.add(createLobbySunkenLounge(
					{
						sofa: M.sofa,
						accent: M.accent,
						rug: M.floorCarpetL,
					},
					{ ringRx: item.ringRx, ringRz: item.ringRz },
				))
				break
			}
			case "coffee-table": {
				g.add(createOfficeCoffeeTable({ desk: M.desk }))
				break
			}
			case "plant": {
				g.add(createOfficePlant({ pot: M.pot, plant: M.plant, lowEnd: isLowEnd }))
				break
			}
			case "fern": {
				g.add(createOfficeFern({
					pot: M.pot,
					plant: M.plant,
					plantDouble: M.plantDouble,
					lowEnd: isLowEnd,
				}))
				break
			}
			case "sign": {
				g.add(createOfficeBacklitSign({ text: item.text }))
				break
			}
			case "painting-mondrian": {
				g.add(createOfficeMondrianPainting())
				break
			}
			case "intercom": {
				g.add(createOfficeIntercom())
				break
			}
			case "magazine": {
				g.add(createOfficeMagazines())
				break
			}
			case "conference-table": {
				g.add(createOfficeConferenceTable({
					table: M.table,
					desk: M.desk,
					chair: M.chair,
				}))
				break
			}
			case "round-table": {
				g.add(createOfficeRoundTable({
					table: M.table,
					desk: M.desk,
					chair: M.chair,
				}))
				break
			}
			case "whiteboard": {
				g.add(createOfficeWhiteboard({ whiteboard: M.whiteboard, desk: M.desk }))
				break
			}
			case "projector-screen": {
				g.add(createOfficeProjectorScreen({ projScreen: M.projScreen }))
				break
			}
			case "office-wall-screen": {
				g.add(createOfficeWallScreen({ projScreen: M.projScreen }))
				break
			}
			case "tv": {
				g.add(createOfficeTV({ projScreen: M.projScreen }))
				break
			}
			case "counter": {
				g.add(createOfficeCounter({ desk: M.desk }))
				break
			}
			case "water-cooler": {
				const wcBodyMat = new THREE.MeshStandardMaterial({ color: 0xe4eaf2, roughness: 0.55, metalness: 0.08 })
				const wcDarkMat = new THREE.MeshStandardMaterial({ color: 0x252c3a, roughness: 0.65, metalness: 0.12 })
				const wcChromeMat = new THREE.MeshStandardMaterial({ color: 0xbcc8d2, roughness: 0.18, metalness: 0.92 })
				const wcRedMat = new THREE.MeshStandardMaterial({ color: 0xcc1f0e, roughness: 0.35, emissive: new THREE.Color(0x880000), emissiveIntensity: 0.5 })
				const wcBlueMat = new THREE.MeshStandardMaterial({ color: 0x1058c8, roughness: 0.35, emissive: new THREE.Color(0x002888), emissiveIntensity: 0.5 })
				const wcBottleMat = new THREE.MeshStandardMaterial({ color: 0x9ecce8, transparent: true, opacity: 0.52, roughness: 0.04, metalness: 0.0 })

				// Lower storage cabinet
				const wcCabinet = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.42), wcBodyMat)
				wcCabinet.position.y = 0.26
				g.add(wcCabinet)
				// Cabinet door panel
				const wcDoor = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.38, 0.02), wcDarkMat)
				wcDoor.position.set(0, 0.26, 0.22)
				g.add(wcDoor)
				// Door handle
				const wcHandle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.11, 0.022), wcChromeMat)
				wcHandle.position.set(0.12, 0.26, 0.235)
				g.add(wcHandle)
				// Upper dispenser body
				const wcUpper = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.38), wcBodyMat)
				wcUpper.position.y = 0.76
				g.add(wcUpper)
				// Drip tray shelf
				const wcTray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.022, 0.09), wcDarkMat)
				wcTray.position.set(0, 0.535, 0.165)
				g.add(wcTray)
				// Tray grate
				const wcGrate = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.07), wcChromeMat)
				wcGrate.position.set(0, 0.548, 0.165)
				g.add(wcGrate)
				// Cold button (blue, left)
				const wcColdBtn = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.056, 0.042), wcBlueMat)
				wcColdBtn.position.set(-0.082, 0.665, 0.20)
				wcColdBtn.userData.waterCoolerColdBtn = true
				g.add(wcColdBtn)
				// Hot button (red, right)
				const wcHotBtn = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.056, 0.042), wcRedMat)
				wcHotBtn.position.set(0.082, 0.665, 0.20)
				wcHotBtn.userData.waterCoolerHotBtn = true
				g.add(wcHotBtn)
				// Cold spigot
				const wcColdSpigot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.032, 8), wcChromeMat)
				wcColdSpigot.position.set(-0.082, 0.568, 0.212)
				g.add(wcColdSpigot)
				// Hot spigot
				const wcHotSpigot = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.032, 8), wcChromeMat)
				wcHotSpigot.position.set(0.082, 0.568, 0.212)
				g.add(wcHotSpigot)
				// Blue LED (cold indicator)
				const wcBlueLED = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.005, 8),
					new THREE.MeshStandardMaterial({ color: 0x44aaff, emissive: new THREE.Color(0x1166ff), emissiveIntensity: 2.0 }))
				wcBlueLED.rotation.x = Math.PI / 2
				wcBlueLED.position.set(-0.082, 0.696, 0.223)
				g.add(wcBlueLED)
				// Red LED (hot indicator)
				const wcRedLED = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.005, 8),
					new THREE.MeshStandardMaterial({ color: 0xff4422, emissive: new THREE.Color(0xff2200), emissiveIntensity: 2.0 }))
				wcRedLED.rotation.x = Math.PI / 2
				wcRedLED.position.set(0.082, 0.696, 0.223)
				g.add(wcRedLED)
				// Bottle collar
				const wcCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.058, 14), wcDarkMat)
				wcCollar.position.y = 1.009
				g.add(wcCollar)
				// Water bottle (inverted, blue-tinted transparent)
				const wcBottle = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.16, 0.50, 14), wcBottleMat)
				wcBottle.position.y = 1.27
				g.add(wcBottle)
				// Bottle top cap
				const wcCap = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.145, 0.028, 14), wcDarkMat)
				wcCap.position.y = 1.534
				g.add(wcCap)
				break
			}
			case "coffee-machine": {
				const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.75 })
				const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.18, metalness: 0.92 })
				const blackMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.85, metalness: 0.1 })
				const redLedMat = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: new THREE.Color(0xff3300), emissiveIntensity: 1.2 })

				// Base ring — widest part, sits on counter
				const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.07, 20), chromeMat)
				base.position.y = 0.035
				g.add(base)

				// Main body — tall matte cylinder, slightly tapered toward top
				const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.20, 0.70, 20), bodyMat)
				body.position.y = 0.385 + 0.07
				g.add(body)

				// Boiler dome — chrome hemisphere crowning the top
				const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), chromeMat)
				dome.position.y = 0.07 + 0.70 + 0.01
				g.add(dome)

				// Pressure gauge — small disc on front upper body
				const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 14), chromeMat)
				gauge.rotation.x = Math.PI / 2
				gauge.position.set(0, 0.62, 0.165)
				g.add(gauge)
				const gaugeNeedle = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.03, 0.005), redLedMat)
				gaugeNeedle.position.set(0.01, 0.62, 0.182)
				gaugeNeedle.rotation.z = 0.7
				g.add(gaugeNeedle)

				// Group-head arm — horizontal chrome pipe, centred mid-body
				const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.22, 10), chromeMat)
				arm.rotation.x = Math.PI / 2
				arm.position.set(0, 0.50, 0.20)
				g.add(arm)

				// Nozzle — short vertical spout at the tip of the arm
				const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.018, 0.09, 10), blackMat)
				nozzle.position.set(0, 0.455, 0.30)
				nozzle.userData.coffeeMachineNozzle = true
				g.add(nozzle)

				// Drip tray — shallow chrome tray under the spout
				const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.18), chromeMat)
				tray.position.set(0, 0.10, 0.12)
				g.add(tray)
				const trayGrid = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.008, 0.13), blackMat)
				trayGrid.position.set(0, 0.116, 0.12)
				g.add(trayGrid)

				// LED status dot below gauge
				const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), redLedMat)
				led.position.set(0, 0.53, 0.171)
				g.add(led)

				// Screen — small touch display
				const screen2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.065, 0.018), M.screen)
				screen2.position.set(0, 0.42, 0.17)
				g.add(screen2)

				// Steam wand — thin rod angled out to the right
				const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.32, 8), chromeMat)
				wand.rotation.z = -0.55
				wand.position.set(0.20, 0.46, 0.10)
				g.add(wand)
				const wandTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), blackMat)
				wandTip.position.set(0.116, 0.324, 0.10)
				g.add(wandTip)

				// Portafilter handle — angled rod below the group head
				const pfHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.22, 10), blackMat)
				pfHandle.rotation.z = Math.PI / 3.5
				pfHandle.position.set(-0.13, 0.31, 0.16)
				g.add(pfHandle)

				break
			}
			case "treadmill": {
				g.add(createOfficeTreadmill({ treadmill: M.treadmill, desk: M.desk }))
				break
			}
			case "weights": {
				g.add(createOfficeWeights({ desk: M.desk }))
				break
			}
			case "mat": {
				g.add(createOfficeMat({ floorRubber: M.floorRubber }))
				break
			}
			case "wall-sign": {
				g.add(createOfficeWallSign({ text: item.text }))
				break
			}

			case "aquarium": {
				const tankW = 0.65   // X-depth (into room)
				const tankH = 4.8    // height (Y)
				const tankD = 16.0   // length (Z, along east wall)
				const ft = 0.045  // frame-bar thickness

				const glassMat2 = new THREE.MeshStandardMaterial({
					color: 0x88d4f0, transparent: true, opacity: 0.22,
					roughness: 0.02, metalness: 0.05,
				})
				const aqFrameMat = new THREE.MeshStandardMaterial({
					color: 0x1c2a3a, roughness: 0.25, metalness: 0.85,
				})
				const waterVolMat = new THREE.MeshStandardMaterial({
					color: 0x0a3c70, transparent: true, opacity: 0.30,
					roughness: 0.06,
					emissive: new THREE.Color(0x002050), emissiveIntensity: 0.55,
				})
				const gravelMat2 = new THREE.MeshStandardMaterial({ color: 0x1c2818, roughness: 1.0 })
				const coralRedM = new THREE.MeshStandardMaterial({ color: 0xcc4422, roughness: 0.88 })
				const coralOraM = new THREE.MeshStandardMaterial({ color: 0xe08818, roughness: 0.88 })
				const seaweedM = new THREE.MeshStandardMaterial({ color: 0x1a6428, roughness: 0.95 })

				const hW = tankW / 2
				const hD = tankD / 2

				// Vertical corner posts
				for (const [px, pz] of [[-hW, -hD], [hW, -hD], [-hW, hD], [hW, hD]]) {
					const post = new THREE.Mesh(new THREE.BoxGeometry(ft, tankH, ft), aqFrameMat)
					post.position.set(px, tankH / 2, pz)
					g.add(post)
				}
				// Top + bottom rails along Z and X
				for (const fy of [0, tankH]) {
					for (const fx of [-hW, hW]) {
						const r = new THREE.Mesh(new THREE.BoxGeometry(ft, ft, tankD), aqFrameMat)
						r.position.set(fx, fy, 0); g.add(r)
					}
					for (const fz of [-hD, hD]) {
						const r = new THREE.Mesh(new THREE.BoxGeometry(tankW, ft, ft), aqFrameMat)
						r.position.set(0, fy, fz); g.add(r)
					}
				}
				// Mid-height horizontal brace rails (at ~1/3 and ~2/3 height)
				for (const fy of [tankH * 0.33, tankH * 0.66]) {
					for (const fx of [-hW, hW]) {
						const r = new THREE.Mesh(new THREE.BoxGeometry(ft, ft, tankD), aqFrameMat)
						r.position.set(fx, fy, 0); g.add(r)
					}
				}

				// Front glass panel (faces room, -X side) — always present
				const fGlass = new THREE.Mesh(
					new THREE.BoxGeometry(0.016, tankH - ft * 2, tankD - ft * 2), glassMat2,
				)
				fGlass.position.set(-hW, tankH / 2, 0); g.add(fGlass)
				// Back + side + top glass panels — skip on low-end (not visible from typical POV)
				if (!isLowEnd) {
					const bGlass = fGlass.clone()
					bGlass.position.set(hW, tankH / 2, 0); g.add(bGlass)
					for (const fz of [-hD, hD]) {
						const sGlass = new THREE.Mesh(
							new THREE.BoxGeometry(tankW - ft * 2, tankH - ft * 2, 0.016), glassMat2,
						)
						sGlass.position.set(0, tankH / 2, fz); g.add(sGlass)
					}
					const topGlass = new THREE.Mesh(
						new THREE.BoxGeometry(tankW - ft * 2, 0.016, tankD - ft * 2), glassMat2,
					)
					topGlass.position.set(0, tankH, 0); g.add(topGlass)
				}

				// Water volume (fills interior)
				const waterVol = new THREE.Mesh(
					new THREE.BoxGeometry(tankW - 0.055, tankH - 0.04, tankD - 0.055),
					waterVolMat,
				)
				waterVol.position.set(0, tankH / 2, 0); g.add(waterVol)

				// Gravel / sand bed
				const gravelBed = new THREE.Mesh(
					new THREE.BoxGeometry(tankW - 0.08, 0.16, tankD - 0.08), gravelMat2,
				)
				gravelBed.position.set(0, 0.08, 0); g.add(gravelBed)

				// Interior point light — soft cyan-blue underwater glow
				const aqLight = new THREE.PointLight(0x22aaff, 2.8, 16, 1.5)
				aqLight.position.set(0, tankH * 0.6, 0); g.add(aqLight)

				// ── Coral & seaweed decorations (deterministic) ─────────────
				const decorDefs = [
					{ z: -7.0, mat: coralRedM, type: 'coral' },
					{ z: -4.5, mat: seaweedM, type: 'weed' },
					{ z: -1.5, mat: coralOraM, type: 'coral' },
					{ z: 1.5, mat: seaweedM, type: 'weed' },
					{ z: 4.5, mat: coralRedM, type: 'coral' },
					{ z: 7.0, mat: coralOraM, type: 'coral' },
					{ z: -6.0, mat: seaweedM, type: 'weed' },
					{ z: 5.8, mat: seaweedM, type: 'weed' },
				]
				for (const { z, mat, type } of decorDefs) {
					if (type === 'coral') {
						// Three branches at fixed angles
						const branchParams = [
							[0.06, 0.00, 0.42, 0.00],
							[-0.05, 0.05, 0.30, 0.38],
							[0.00, -0.06, 0.44, -0.35],
						]
						for (const [bx, bz2, h, rz] of branchParams) {
							const branch = new THREE.Mesh(
								new THREE.CylinderGeometry(0.024, 0.052, h, 5), mat,
							)
							branch.position.set(bx, 0.18 + h / 2, z + bz2)
							branch.rotation.z = rz
							g.add(branch)
						}
					} else {
						// Two seaweed strands side by side
						for (const [ox, sign] of [[0, 1], [0.07, -1]]) {
							const curve = new THREE.QuadraticBezierCurve3(
								new THREE.Vector3(ox, 0.18, z),
								new THREE.Vector3(ox + sign * 0.11, 0.76, z + 0.07 * sign),
								new THREE.Vector3(ox - sign * 0.05, 1.38, z + 0.04),
							)
							g.add(new THREE.Mesh(
								new THREE.TubeGeometry(curve, 6, 0.022, 5, false), mat,
							))
						}
					}
				}

				// ── Tropical fish ────────────────────────────────────────────
				// Low-end: 4 fish; full: 8 fish
				const maxR = hD - 0.5   // fish stay within tank Z bounds
				const fishSpecs = [
					{ col: 0xff5c1a, acc: 0xffffff, sz: 0.16, sp: 0.40, y: 2.6, ph: 0.0, r: 6.2 },
					{ col: 0xffcc00, acc: 0xff6600, sz: 0.12, sp: 0.58, y: 1.8, ph: 1.2, r: 5.0 },
					{ col: 0x2280ff, acc: 0x88ccff, sz: 0.14, sp: 0.50, y: 3.2, ph: 2.4, r: 6.5 },
					{ col: 0xff3366, acc: 0xffdde6, sz: 0.10, sp: 0.72, y: 1.4, ph: 0.8, r: 4.2 },
					{ col: 0x22cc88, acc: 0x88ffcc, sz: 0.13, sp: 0.46, y: 2.0, ph: 3.1, r: 5.5 },
					{ col: 0xff8800, acc: 0xffcc66, sz: 0.18, sp: 0.34, y: 3.5, ph: 1.7, r: 6.8 },
					{ col: 0xaa44ff, acc: 0xddaaff, sz: 0.11, sp: 0.65, y: 2.8, ph: 4.2, r: 3.8 },
					{ col: 0xf0f8ff, acc: 0x5599cc, sz: 0.09, sp: 0.80, y: 1.2, ph: 5.1, r: 3.2 },
				]
				for (const f of (isLowEnd ? fishSpecs.slice(0, 4) : fishSpecs)) {
					const fg = new THREE.Group()
					const fBodyMat = new THREE.MeshStandardMaterial({ color: f.col, roughness: 0.70 })
					const fAccMat = new THREE.MeshStandardMaterial({
						color: f.acc, roughness: 0.60, transparent: true, opacity: 0.82,
						side: THREE.DoubleSide,
					})
					const fEyeMat = new THREE.MeshStandardMaterial({ color: 0x060606 })
					const s = f.sz

					// Body — sphere elongated along Z (swimming direction)
					const fBody = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), fBodyMat)
					fBody.scale.set(1.0, 0.65, 1.85)
					fg.add(fBody)

					// Tail fin — cone tip points -Z
					const tailGeo = new THREE.ConeGeometry(s * 0.62, s * 1.15, 4)
					tailGeo.rotateX(-Math.PI / 2)
					const fTail = new THREE.Mesh(tailGeo, fAccMat)
					fTail.position.z = -s * 1.55
					fTail.scale.set(1.35, 1, 1)
					fg.add(fTail)

					// Eye (right-side, forward quarter)
					const fEye = new THREE.Mesh(new THREE.SphereGeometry(s * 0.22, 6, 4), fEyeMat)
					fEye.position.set(s * 0.84, s * 0.14, s * 0.85)
					fg.add(fEye)

					// Dorsal fin
					const dorsGeo = new THREE.ConeGeometry(s * 0.38, s * 0.88, 3)
					const fDorsal = new THREE.Mesh(dorsGeo, fAccMat)
					fDorsal.position.set(0, s * 0.94, -s * 0.12)
					fg.add(fDorsal)

					const clampedR = Math.min(f.r, maxR)
					fg.position.set(0, f.y, Math.sin(f.ph) * clampedR)
					fg.userData.fishData = { speed: f.sp, phase: f.ph, radius: clampedR, baseY: f.y }
					g.add(fg)
					aquariumFish.push(fg)
				}
				break
			}

			case "lava-lamp-wall": {
				// A row of retro lava lamps on a lit plinth, flush against the wall.
				// Positioned at x=-21.55 (west wall); extends along Z. Each lamp's
				// blobs are animated in the render loop via lavaLampBlobs.
				const LAMP_COUNT = 7
				const SPAN_Z = 15.5     // total Z span of lamp row
				const plinthH = 0.5
				const plinthDepth = 0.55   // X depth into room
				const lampBaseY = plinthH + 0.02

				// Hex-ish palette of retro lamp colors
				const LAMP_COLORS = [
					{ glass: 0xff3366, blob: 0xff6088, emiss: 0xff2244 },  // hot pink
					{ glass: 0xff8820, blob: 0xffb060, emiss: 0xff6010 },  // orange
					{ glass: 0xf2c43b, blob: 0xffe080, emiss: 0xf0a020 },  // amber
					{ glass: 0x3ad17a, blob: 0x80ffb0, emiss: 0x20c060 },  // green
					{ glass: 0x00b4d8, blob: 0x60e0ff, emiss: 0x00a0e0 },  // cyan
					{ glass: 0x7055a8, blob: 0xa080e0, emiss: 0x5030a0 },  // purple
					{ glass: 0xff5544, blob: 0xff9070, emiss: 0xff3322 },  // red
				]

				const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.25, metalness: 0.92 })
				const plinthMat = new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.6, metalness: 0.4 })
				const plinthGlow = new THREE.MeshStandardMaterial({
					color: 0x00b4d8, roughness: 0.4, metalness: 0.2,
					emissive: new THREE.Color(0x00b4d8), emissiveIntensity: 1.2,
				})
				const backPanelMat = new THREE.MeshStandardMaterial({ color: 0x0a1424, roughness: 0.8, metalness: 0.2 })
				lavaLampMats.metal = metalMat
				lavaLampMats.plinth = plinthMat
				lavaLampMats.plinthGlow = plinthGlow
				lavaLampMats.backPanel = backPanelMat

				// Dark back panel (mounts flush to wall)
				const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.6, SPAN_Z + 1.2), backPanelMat)
				backPanel.position.set(-plinthDepth / 2 - 0.015, 2.35, 0)
				g.add(backPanel)

				// "quickerSTORM" sign above the lamps (painted on the back panel)
				const signCanvas = document.createElement('canvas')
				signCanvas.width = 1024; signCanvas.height = 192
				const sctx = signCanvas.getContext('2d')
				sctx.clearRect(0, 0, 1024, 192)
				// Subtle neon glow behind text
				sctx.textAlign = 'center'
				sctx.textBaseline = 'middle'
				sctx.letterSpacing = '22px'
				sctx.font = '400 82px "Bahnschrift Light", "Century Gothic", "Futura", "Avenir Next", "Segoe UI Light", sans-serif'
				// Outer cyan glow
				sctx.shadowColor = '#00b4d8'
				sctx.shadowBlur = 32
				sctx.fillStyle = '#d8f0ff'
				sctx.fillText('quickerSTORM', 512, 100)
				// Inner bright core
				sctx.shadowBlur = 10
				sctx.fillStyle = '#ffffff'
				sctx.fillText('quickerSTORM', 512, 100)
				// Thin underline accent
				sctx.shadowBlur = 14
				sctx.strokeStyle = '#00b4d8'
				sctx.lineWidth = 2
				sctx.beginPath()
				sctx.moveTo(320, 150)
				sctx.lineTo(704, 150)
				sctx.stroke()
				const signTex = new THREE.CanvasTexture(signCanvas)
				signTex.anisotropy = 8
				const signFace = new THREE.Mesh(
					new THREE.PlaneGeometry(SPAN_Z + 0.6, (SPAN_Z + 0.6) * (192 / 1024)),
					new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
				)
				// Rotate plane so its normal points into the room (+X); sits along Z on the back panel
				signFace.rotation.y = Math.PI / 2
				signFace.position.set(-plinthDepth / 2 + 0.02, 2.95, 0)
				g.add(signFace)

				// Plinth / shelf
				const plinth = new THREE.Mesh(new THREE.BoxGeometry(plinthDepth, plinthH, SPAN_Z + 1.0), plinthMat)
				plinth.position.set(0, plinthH / 2, 0)
				g.add(plinth)

				// Glowing accent strip along plinth front edge
				const accent = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, SPAN_Z + 1.0), plinthGlow)
				accent.position.set(plinthDepth / 2 + 0.01, plinthH - 0.05, 0)
				g.add(accent)

				// Build each lamp
				const startZ = -SPAN_Z / 2
				const stepZ = SPAN_Z / (LAMP_COUNT - 1)

				for (let i = 0; i < LAMP_COUNT; i++) {
					const lz = startZ + stepZ * i
					const palette = LAMP_COLORS[i % LAMP_COLORS.length]

					// Metal base
					const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.14, 16), metalMat)
					base.position.set(0, lampBaseY + 0.07, lz)
					g.add(base)

					// Lower metal collar
					const collarLow = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.05, 16), metalMat)
					collarLow.position.set(0, lampBaseY + 0.16, lz)
					g.add(collarLow)

					// Glass body — tapered cone (wider at bottom, narrower at top)
					const bodyGeo = new THREE.CylinderGeometry(0.055, 0.11, 1.15, 20, 1, true)
					const bodyMat = new THREE.MeshStandardMaterial({
						color: palette.glass,
						transparent: true, opacity: 0.32,
						roughness: 0.05, metalness: 0.05,
						emissive: new THREE.Color(palette.emiss), emissiveIntensity: 0.35,
						side: THREE.DoubleSide,
					})
					const body = new THREE.Mesh(bodyGeo, bodyMat)
					body.position.set(0, lampBaseY + 0.78, lz)
					g.add(body)

					// Inner "liquid" fill — slightly smaller, glowy
					const liquidMat = new THREE.MeshStandardMaterial({
						color: palette.glass,
						transparent: true, opacity: 0.25,
						roughness: 0.1, metalness: 0.0,
						emissive: new THREE.Color(palette.emiss), emissiveIntensity: 0.6,
					})
					const liquid = new THREE.Mesh(
						new THREE.CylinderGeometry(0.048, 0.10, 1.13, 20),
						liquidMat,
					)
					liquid.position.set(0, lampBaseY + 0.78, lz)
					g.add(liquid)

					// Blobs — animated up/down inside the lamp
					const blobMat = new THREE.MeshStandardMaterial({
						color: palette.blob,
						roughness: 0.15, metalness: 0.0,
						emissive: new THREE.Color(palette.blob), emissiveIntensity: 1.2,
					})
					const BLOBS_PER_LAMP = 3
					for (let b = 0; b < BLOBS_PER_LAMP; b++) {
						const r = 0.035 + Math.random() * 0.025
						const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), blobMat)
						// Stash animation params
						blob.userData.lavaBlob = {
							baseY: lampBaseY + 0.78,   // center of lamp body
							ampY: 0.48,                // vertical travel range
							speed: 0.18 + Math.random() * 0.22,
							phase: Math.random() * Math.PI * 2,
							lz,
							squish: 0.6 + Math.random() * 0.4,
						}
						blob.position.set(0, lampBaseY + 0.78, lz)
						g.add(blob)
						lavaLampBlobs.push(blob)
					}

					// Top collar + cap
					const collarTop = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.062, 0.05, 16), metalMat)
					collarTop.position.set(0, lampBaseY + 1.38, lz)
					g.add(collarTop)
					const cap = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.12, 16), metalMat)
					cap.position.set(0, lampBaseY + 1.465, lz)
					g.add(cap)

					// Warm point-ish glow via emissive disk at the base (fake under-lamp bloom)
					const glowDisk = new THREE.Mesh(
						new THREE.CircleGeometry(0.18, 18),
						new THREE.MeshBasicMaterial({ color: palette.emiss, transparent: true, opacity: 0.35 }),
					)
					glowDisk.rotation.x = -Math.PI / 2
					glowDisk.position.set(0, lampBaseY + 0.151, lz)
					g.add(glowDisk)
				}

				break
			}

			case "ticket-dispenser": {
				// Desktop "Take a Number" ticket dispenser — sits on reception desk.
				// Origin at base of unit so furniture pos.y can place it on a surface.
				const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.5, metalness: 0.3 })
				const trimMat = new THREE.MeshStandardMaterial({ color: 0x202028, roughness: 0.45, metalness: 0.6 })
				const ticketMat = new THREE.MeshStandardMaterial({ color: 0xfff8d0, roughness: 0.8 })

				// Feet / base plate
				const baseplate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.015, 0.20), trimMat)
				baseplate.position.set(0, 0.008, 0)
				g.add(baseplate)

				// Main red body — compact desktop unit
				const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.34, 0.16), bodyMat)
				body.position.set(0, 0.015 + 0.17, 0)
				g.add(body)

				// Top label plate "TAKE A NUMBER"
				const labelCanvas = document.createElement('canvas')
				labelCanvas.width = 256; labelCanvas.height = 80
				const lctx = labelCanvas.getContext('2d')
				lctx.fillStyle = '#f5f0d8'
				lctx.fillRect(0, 0, 256, 80)
				lctx.fillStyle = '#c8202a'
				lctx.font = 'bold 22px Impact, "Arial Black", sans-serif'
				lctx.textAlign = 'center'; lctx.textBaseline = 'middle'
				lctx.fillText('TAKE A NUMBER', 128, 28)
				lctx.fillStyle = '#202028'
				lctx.font = '14px Arial, sans-serif'
				lctx.fillText('please', 128, 56)
				const labelTex = new THREE.CanvasTexture(labelCanvas)
				const labelPlate = new THREE.Mesh(
					new THREE.PlaneGeometry(0.21, 0.068),
					new THREE.MeshBasicMaterial({ map: labelTex }),
				)
				labelPlate.position.set(0, 0.29, 0.0805)
				g.add(labelPlate)

				// Dispenser slot (dark opening)
				const slot = new THREE.Mesh(
					new THREE.BoxGeometry(0.16, 0.02, 0.03),
					new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.9 }),
				)
				slot.position.set(0, 0.11, 0.0805)
				g.add(slot)

				// Slot lip
				const slotLip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.014, 0.02), trimMat)
				slotLip.position.set(0, 0.098, 0.088)
				g.add(slotLip)

				// Protruding paper ticket
				const paper = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.002, 0.055), ticketMat)
				paper.position.set(0, 0.111, 0.115)
				g.add(paper)

				// Small spindle post on top (classic dispenser look)
				const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.10, 8), trimMat)
				spindle.position.set(0, 0.395, -0.02)
				g.add(spindle)
				const spindleTop = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), trimMat)
				spindleTop.position.set(0, 0.448, -0.02)
				g.add(spindleTop)

				break
			}

			case "now-serving-sign": {
				// Wall-mounted LED-style "Now Serving" display
				const frameMat = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.4, metalness: 0.7 })
				const screenMat = new THREE.MeshStandardMaterial({
					color: 0x0a0400, roughness: 0.2, metalness: 0.1,
					emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.4,
				})

				// Outer frame
				const frame = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.85, 0.12), frameMat)
				frame.position.set(0, 1.55, 0.06)
				g.add(frame)

				// Inset LED face
				const screen = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.75, 0.03), screenMat)
				screen.position.set(0, 1.55, 0.122)
				g.add(screen)

				// Dynamic canvas for "NOW SERVING   42"
				nowServingCanvas = document.createElement('canvas')
				nowServingCanvas.width = 768; nowServingCanvas.height = 384
				nowServingCtx = nowServingCanvas.getContext('2d')
				paintNowServing(0)   // paint initial
				nowServingTex = new THREE.CanvasTexture(nowServingCanvas)
				nowServingTex.colorSpace      = THREE.SRGBColorSpace
				nowServingTex.generateMipmaps = false
				nowServingTex.minFilter       = THREE.LinearFilter
				const display = new THREE.Mesh(
					new THREE.PlaneGeometry(1.30, 0.70),
					new THREE.MeshBasicMaterial({ map: nowServingTex, transparent: true }),
				)
				display.position.set(0, 1.55, 0.139)
				g.add(display)

				break
			}

			case "arcade": {
				// Classic upright arcade cabinet — sits flush to wall, faces +Z
				const cabMat = new THREE.MeshStandardMaterial({ color: 0x8b1e2a, roughness: 0.55, metalness: 0.15 })
				const trimMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.3 })
				const screenBez = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.8, metalness: 0.2 })
				const screenMat = new THREE.MeshStandardMaterial({ color: 0x001020, roughness: 0.2, metalness: 0.1, emissive: new THREE.Color(0x00b4d8), emissiveIntensity: 0.8 })
				const joyBase = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.5, metalness: 0.6 })
				const joyBall = new THREE.MeshStandardMaterial({ color: 0xd11a2a, roughness: 0.35, metalness: 0.2 })
				const btnYellow = new THREE.MeshStandardMaterial({ color: 0xf2c43b, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(0xf2c43b), emissiveIntensity: 0.3 })
				const btnGreen = new THREE.MeshStandardMaterial({ color: 0x3ad17a, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(0x3ad17a), emissiveIntensity: 0.3 })

				// Main cabinet body — width slightly less than stripe pair (±0.38, 0.02 thick)
				// so side faces are not coplanar with trim; avoids red/black z-fighting.
				const body = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.85, 0.72), cabMat)
				body.position.set(0, 0.925, 0)
				g.add(body)

				// Side trim stripes
				const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.82, 0.74), trimMat)
				stripeL.position.set(-0.38, 0.925, 0)
				g.add(stripeL)
				const stripeR = stripeL.clone()
				stripeR.position.x = 0.38
				g.add(stripeR)

				// Marquee — slightly shorter + shallower than before so its top is below the
				// cabinet shell top (y=1.85) and its +Z face sits in front of the body front
				// (z=0.36), avoiding z-fight without recessing the nameplate plane.
				const marquee = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.208, 0.08), trimMat)
				marquee.position.set(0, 1.74, 0.31)
				g.add(marquee)

				const mqCanvas = document.createElement('canvas')
				mqCanvas.width = 256; mqCanvas.height = 72
				const mctx = mqCanvas.getContext('2d')
				const grad = mctx.createLinearGradient(0, 0, 256, 0)
				grad.addColorStop(0, '#00b4d8'); grad.addColorStop(0.5, '#f2c43b'); grad.addColorStop(1, '#d11a2a')
				mctx.fillStyle = grad; mctx.fillRect(0, 0, 256, 72)
				mctx.fillStyle = '#0a0a12'
				mctx.font = 'bold 30px Impact, sans-serif'
				mctx.textAlign = 'center'; mctx.textBaseline = 'middle'
				mctx.fillText('OBRIEN\'S ARCADE', 128, 38)
				const mqTex = new THREE.CanvasTexture(mqCanvas)
				const mqFace = new THREE.Mesh(
					new THREE.PlaneGeometry(0.72, 0.192),
					new THREE.MeshBasicMaterial({ map: mqTex }),
				)
				mqFace.position.set(0, 1.74, 0.362)
				g.add(mqFace)

				// Screen bezel
				const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.58, 0.06), screenBez)
				bezel.position.set(0, 1.32, 0.35)
				g.add(bezel)

				// Glowing CRT screen
				const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.46), screenMat)
				screen.position.set(0, 1.32, 0.381)
				g.add(screen)

				// Control panel (angled shelf)
				const panel = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.30), trimMat)
				panel.position.set(0, 0.94, 0.34)
				panel.rotation.x = -0.35
				g.add(panel)

				// Joystick — cylinder lies in XZ (radius ~0.05); center z must clear CRT plane 0.381
				const jStick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.10, 12), joyBase)
				jStick.position.set(-0.18, 1.02, 0.4225)
				g.add(jStick)
				const jBall = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), joyBall)
				jBall.position.set(-0.18, 1.09, 0.4225)
				g.add(jBall)

				// Buttons
				const btnA = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14), btnYellow)
				btnA.position.set(0.06, 1.04, 0.34); btnA.rotation.x = -0.35
				g.add(btnA)
				const btnB = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14), btnGreen)
				btnB.position.set(0.16, 1.04, 0.34); btnB.rotation.x = -0.35
				g.add(btnB)
				const btnC = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14), btnYellow)
				btnC.position.set(0.26, 1.04, 0.34); btnC.rotation.x = -0.35
				g.add(btnC)

				// Kick plate / base footprint
				const kick = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.06, 0.74), trimMat)
				kick.position.set(0, 0.03, 0)
				g.add(kick)

				// Coin slot
				const coin = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.04), joyBase)
				coin.position.set(0, 0.72, 0.38)
				g.add(coin)

				break
			}

			case "arcade-pacman": {
				// AVA-Man arcade cabinet — same shape as Snake, different colour & marquee
				const pCabMat = new THREE.MeshStandardMaterial({ color: 0x1a1a5e, roughness: 0.55, metalness: 0.15 })
				const pTrimMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.3 })
				const pScreenBez = new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 0.8, metalness: 0.2 })
				const pScreenMat = new THREE.MeshStandardMaterial({ color: 0x001020, roughness: 0.2, metalness: 0.1, emissive: new THREE.Color(0xffcc00), emissiveIntensity: 0.6 })
				const pJoyBase = new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.5, metalness: 0.6 })
				const pJoyBall = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.35, metalness: 0.2 })
				const pBtnCyan = new THREE.MeshStandardMaterial({ color: 0x00b4d8, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(0x00b4d8), emissiveIntensity: 0.3 })
				const pBtnRed = new THREE.MeshStandardMaterial({ color: 0xd11a2a, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(0xd11a2a), emissiveIntensity: 0.3 })

				const pBody = new THREE.Mesh(new THREE.BoxGeometry(0.76, 1.85, 0.72), pCabMat)
				pBody.position.set(0, 0.925, 0)
				g.add(pBody)

				const pStripeL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.82, 0.74), pTrimMat)
				pStripeL.position.set(-0.38, 0.925, 0)
				g.add(pStripeL)
				const pStripeR = pStripeL.clone()
				pStripeR.position.x = 0.38
				g.add(pStripeR)

				const pMarquee = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.208, 0.08), pTrimMat)
				pMarquee.position.set(0, 1.74, 0.31)
				g.add(pMarquee)

				const pmqCanvas = document.createElement('canvas')
				pmqCanvas.width = 256; pmqCanvas.height = 72
				const pmctx = pmqCanvas.getContext('2d')
				const pGrad = pmctx.createLinearGradient(0, 0, 256, 0)
				pGrad.addColorStop(0, '#ffcc00'); pGrad.addColorStop(0.5, '#00b4d8'); pGrad.addColorStop(1, '#ff4444')
				pmctx.fillStyle = pGrad; pmctx.fillRect(0, 0, 256, 72)
				pmctx.fillStyle = '#0a0a12'
				pmctx.font = 'bold 34px Impact, sans-serif'
				pmctx.textAlign = 'center'; pmctx.textBaseline = 'middle'
				pmctx.fillText('AVA-MAN', 128, 38)
				const pmqTex = new THREE.CanvasTexture(pmqCanvas)
				const pmqFace = new THREE.Mesh(
					new THREE.PlaneGeometry(0.72, 0.192),
					new THREE.MeshBasicMaterial({ map: pmqTex }),
				)
				pmqFace.position.set(0, 1.74, 0.362)
				g.add(pmqFace)

				const pBezel = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.58, 0.06), pScreenBez)
				pBezel.position.set(0, 1.32, 0.35)
				g.add(pBezel)

				const pScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.46), pScreenMat)
				pScreen.position.set(0, 1.32, 0.381)
				g.add(pScreen)

				const pPanel = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.30), pTrimMat)
				pPanel.position.set(0, 0.94, 0.34)
				pPanel.rotation.x = -0.35
				g.add(pPanel)

				const pJStick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.10, 12), pJoyBase)
				pJStick.position.set(-0.18, 1.02, 0.4225)
				g.add(pJStick)
				const pJBall = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), pJoyBall)
				pJBall.position.set(-0.18, 1.09, 0.4225)
				g.add(pJBall)

				const pBtnA = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14), pBtnCyan)
				pBtnA.position.set(0.06, 1.04, 0.34); pBtnA.rotation.x = -0.35
				g.add(pBtnA)
				const pBtnB = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14), pBtnRed)
				pBtnB.position.set(0.16, 1.04, 0.34); pBtnB.rotation.x = -0.35
				g.add(pBtnB)
				const pBtnC = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.022, 14), pBtnCyan)
				pBtnC.position.set(0.26, 1.04, 0.34); pBtnC.rotation.x = -0.35
				g.add(pBtnC)

				const pKick = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.06, 0.74), pTrimMat)
				pKick.position.set(0, 0.03, 0)
				g.add(pKick)

				const pCoin = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.05, 0.04), pJoyBase)
				pCoin.position.set(0, 0.72, 0.38)
				pCoin.userData.coinReturn = true
				g.add(pCoin)

				break
			}

			case "suggestion-box": {
				const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0d1828, roughness: 0.55, metalness: 0.25 })
				const accentMat = new THREE.MeshStandardMaterial({ color: 0x00b4d8, roughness: 0.3, metalness: 0.6, emissive: new THREE.Color(0x00b4d8), emissiveIntensity: 0.4 })
				const slotGlow = new THREE.MeshStandardMaterial({ color: 0x001520, roughness: 0.9, emissive: new THREE.Color(0x00b4d8), emissiveIntensity: 1.5 })

				// Box + lock (scaled 20% up); sign stays separate at 2× size
				const boxRoot = new THREE.Group()
				boxRoot.scale.set(1.2, 1.2, 1.2)

				// Backing plate flush against wall
				const backing = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.54, 0.03), accentMat)
				backing.position.set(0, 1.22, -0.065)
				boxRoot.add(backing)

				// Main box body
				const body = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.13), bodyMat)
				body.position.set(0, 1.22, 0)
				boxRoot.add(body)

				// Slot opening near top
				const slot = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.022, 0.16), slotGlow)
				slot.position.set(0, 1.38, 0)
				boxRoot.add(slot)

				// Slot lip / cover
				const slotLip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.014, 0.15), accentMat)
				slotLip.position.set(0, 1.369, 0.005)
				boxRoot.add(slotLip)

				// Label / sign plate
				const labelPlate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.14), accentMat)
				labelPlate.position.set(0, 1.12, 0.005)
				boxRoot.add(labelPlate)

				// Lock body
				const lockB = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.030, 0.14), bodyMat)
				lockB.position.set(0, 1.02, 0.005)
				boxRoot.add(lockB)

				// Lock shackle (arc)
				const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.013, 0.005, 8, 12, Math.PI), accentMat)
				shackle.rotation.x = Math.PI / 2
				shackle.position.set(0, 1.042, 0)
				boxRoot.add(shackle)

				g.add(boxRoot)

				// Wall sign above the box (2× linear size vs original); Y clears scaled backing top
				const signY = 2.1
				const signBacking = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.30, 0.04), accentMat)
				signBacking.position.set(0, signY, -0.065)
				g.add(signBacking)

				const signCanvas = document.createElement('canvas')
				signCanvas.width = 512
				signCanvas.height = 128
				const ctx = signCanvas.getContext('2d')
				ctx.fillStyle = '#003850'
				ctx.fillRect(0, 0, 512, 128)
				ctx.fillStyle = '#ffffff'
				ctx.font = 'bold 54px Arial, sans-serif'
				ctx.textAlign = 'center'
				ctx.textBaseline = 'middle'
				ctx.letterSpacing = '4px'
				ctx.fillText('SUGGESTIONS', 256, 68)
				const signTex = new THREE.CanvasTexture(signCanvas)
				const signFace = new THREE.Mesh(
					new THREE.PlaneGeometry(1.20, 0.26),
					new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
				)
				signFace.position.set(0, signY, -0.044)
				g.add(signFace)

				break
			}

			case "connect4-cabinet": {
				// Connect 4 standing cabinet: yellow board with 7 columns, on a base.
				// Front face is +Z by default; use `rot` to mount along walls.
				const baseMat   = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.55, metalness: 0.20 })
				const boardMat  = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.50, metalness: 0.15 })
				const trimMat   = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.65, metalness: 0.20 })
				const holeMat   = new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.95, metalness: 0.0 })
				const redMat    = new THREE.MeshStandardMaterial({ color: 0xe24a3a, roughness: 0.45, metalness: 0.20, emissive: new THREE.Color(0xa01818), emissiveIntensity: 0.18 })
				const yellowMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.45, metalness: 0.20, emissive: new THREE.Color(0xc88a08), emissiveIntensity: 0.20 })

				// Invisible front-face hit box covering the whole cabinet front and a
				// generous halo above it. Without this, clicks that miss the tiny hole
				// meshes fall through to the floor and trigger walk-navigation. Use
				// transparent material (not visible:false) so the raycaster still hits it.
				const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
				const hitBox = new THREE.Mesh(new THREE.BoxGeometry(1.10, 2.10, 0.38), hitMat)
				hitBox.position.set(0, 1.05, 0.20)
				hitBox.userData.connect4Hit = true
				g.add(hitBox)

				// Base / pedestal
				const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 0.55), baseMat)
				base.position.set(0, 0.425, 0)
				base.castShadow = true
				g.add(base)

				// Front trim plate on base
				const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.10, 0.04), trimMat)
				baseTrim.position.set(0, 0.55, 0.28)
				g.add(baseTrim)

				// Yellow board
				const board = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.82, 0.10), boardMat)
				board.position.set(0, 1.36, 0)
				board.castShadow = true
				g.add(board)

				// 7 columns × 6 rows of holes (front-face cylinders cut visually)
				const COLS = 7, ROWS = 6
				const cellW = 0.11
				const startX = -((COLS - 1) / 2) * cellW
				const startY = 0.95   // bottom row Y
				for (let c = 0; c < COLS; c++) {
					for (let r = 0; r < ROWS; r++) {
						const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.06, 14), holeMat)
						hole.rotation.x = Math.PI / 2
						hole.position.set(startX + c * cellW, startY + r * cellW, 0.06)
						g.add(hole)
					}
				}

				// A few decorative dropped pieces (bottom row, alternating colors)
				const decoCols = [1, 3, 4]
				for (let i = 0; i < decoCols.length; i++) {
					const c = decoCols[i]
					const piece = new THREE.Mesh(
						new THREE.CylinderGeometry(0.040, 0.040, 0.04, 14),
						i % 2 === 0 ? redMat : yellowMat,
					)
					piece.rotation.x = Math.PI / 2
					piece.position.set(startX + c * cellW, startY, 0.075)
					g.add(piece)
				}

				// Title sign on top
				const signCanvas = document.createElement('canvas')
				signCanvas.width = 256; signCanvas.height = 64
				const sctx = signCanvas.getContext('2d')
				sctx.fillStyle = '#101820'
				sctx.fillRect(0, 0, 256, 64)
				sctx.fillStyle = '#ffd24a'
				sctx.font = 'bold 36px Arial, sans-serif'
				sctx.textAlign = 'center'
				sctx.textBaseline = 'middle'
				sctx.fillText('CONNECT 4', 128, 36)
				const signTex = new THREE.CanvasTexture(signCanvas)
				const sign = new THREE.Mesh(
					new THREE.PlaneGeometry(0.78, 0.18),
					new THREE.MeshBasicMaterial({ map: signTex, transparent: true }),
				)
				sign.position.set(0, 1.88, 0.052)
				g.add(sign)

				break
			}

			case "kudos-plaque": {
				// Warm wood-look plaque with a glowing star accent. Mounts flush to wall.
				const plaqueWood = new THREE.MeshStandardMaterial({ color: 0x6b3a14, roughness: 0.62, metalness: 0.05 })
				const goldMat    = new THREE.MeshStandardMaterial({ color: 0xffc650, roughness: 0.32, metalness: 0.78, emissive: new THREE.Color(0xffa030), emissiveIntensity: 0.55 })
				const cardMat    = new THREE.MeshStandardMaterial({ color: 0xfff2d0, roughness: 0.85, metalness: 0 })

				// Backing plate flush against wall
				const backing = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.04), plaqueWood)
				backing.position.set(0, 1.42, -0.04)
				g.add(backing)

				// Inner card
				const card = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.50, 0.02), cardMat)
				card.position.set(0, 1.42, -0.018)
				g.add(card)

				// Title bar
				const titleCanvas = document.createElement('canvas')
				titleCanvas.width = 512; titleCanvas.height = 128
				const tctx = titleCanvas.getContext('2d')
				tctx.fillStyle = '#fff2d0'
				tctx.fillRect(0, 0, 512, 128)
				tctx.fillStyle = '#6b3a14'
				tctx.font = 'bold 60px Georgia, serif'
				tctx.textAlign = 'center'
				tctx.textBaseline = 'middle'
				tctx.fillText('KUDOS WALL', 256, 50)
				tctx.font = 'italic 24px Georgia, serif'
				tctx.fillStyle = '#9a6a30'
				tctx.fillText('a moment of appreciation', 256, 96)
				const titleTex = new THREE.CanvasTexture(titleCanvas)
				const titleFace = new THREE.Mesh(
					new THREE.PlaneGeometry(0.84, 0.21),
					new THREE.MeshBasicMaterial({ map: titleTex, transparent: true }),
				)
				titleFace.position.set(0, 1.50, -0.005)
				g.add(titleFace)

				// Decorative star (octahedron, gold, glowing)
				const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.10, 0), goldMat)
				star.position.set(0, 1.27, 0.02)
				star.rotation.y = Math.PI / 4
				g.add(star)

				// Frame trim — thin gold edge
				for (const [w, h, x, y] of [
					[1.0, 0.02, 0, 1.72], [1.0, 0.02, 0, 1.12], [0.02, 0.62, -0.49, 1.42], [0.02, 0.62, 0.49, 1.42],
				]) {
					const trim = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.025), goldMat)
					trim.position.set(x, y, -0.022)
					g.add(trim)
				}

				break
			}

			case "wall-clock": {
				const clock = createOfficeWallClock({
					mountY: item.mountY,
					radius: item.radius,
				})
				g.add(clock.root)
				g.userData.wallClockUpdate = clock.update
				break
			}

			case "world-clock": {
				const wc = createConferenceWorldClock({
					width: item.width,
					height: item.height,
				})
				g.add(wc.root)
				g.userData.worldClockUpdate = wc.update
				g.userData.worldClockDispose = wc.dispose
				break
			}

			case "tree-jacaranda":
				g.add(createCourtyardTree())
				break

			case "park-bench":
				g.add(createCourtyardBench())
				break

			case "fountain":
				g.add(createCourtyardFountain())
				break

			case "sidewalk":
				g.add(createCourtyardSidewalk())
				break

			case "hedge":
				g.add(createCourtyardHedge())
				break

			case "solar-panel":
				g.add(createSolarPanel())
				break

			case "recycling-bin":
				g.add(createRecyclingBin())
				break

			case "trashcan":
				g.add(createTrashcan())
				break

			case "vector-robot":
				g.add(createVectorRobot())
				break

			case "refrigerator":
				g.add(createRefrigerator((doorMeshes, allMeshes) => {
					for (const d of doorMeshes) refrigeratorDoorMeshes.push(d)
					for (const m of allMeshes) refrigeratorAllMeshes.push(m)
				}, {
					onOpen:  () => audio.playSoundForRoom('fridge-open.mp3',  0.7),
					onClose: (side) => {
						audio.playSoundForRoom('fridge-close.mp3', 0.3)
						useRealtimeSocket().emit('fridge', { side, action: 'close' })
					},
				}))
				break

			default:
				return null
		}
		return g
	}

	function buildSeats (g, room) {
		if (!room.seats?.length) return
		for (const seat of room.seats) {
			// Hit box sized to the seat type: sofa seats get a wider target
			const isSofa = seat.seatId?.includes("lobby")
			const isPitRing = seat.sitYOffset != null && isSofa
			const geom = isPitRing
				? new THREE.BoxGeometry(0.85, 0.4, 0.75) // low cushion; matches sitting height
				: isSofa
					? new THREE.BoxGeometry(1.2, 1.0, 0.9) // sofa: wide + deeper
					: new THREE.BoxGeometry(0.6, 1.0, 0.6) // chair: standard
			const mesh = new THREE.Mesh(geom, M.invisible)
			// Sunken pit: click target and pad at cushion level (not chair-bench height)
			mesh.position.set(seat.pos[0], isPitRing ? 0.3 : 0.75, seat.pos[2])
			g.add(mesh)

			// Occupancy indicator — small glowing disc on the seat cushion
			const dotMat = new THREE.MeshStandardMaterial({
				color: 0x00b4d8,
				emissive: new THREE.Color(0x004466),
				emissiveIntensity: 0.6,
				transparent: true,
				opacity: 0.55,
				roughness: 0.4,
				// Keep depth on for pit so discs don’t draw through avatars (unlike
				// disabling depth, which was only to fight the couch torus)
				depthTest: true,
				depthWrite: true,
				...(isPitRing
					? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -1 }
					: {}),
			})
			const dotR = isSofa ? 0.28 : 0.16
			const dot = new THREE.Mesh(
				new THREE.CylinderGeometry(dotR, dotR, 0.025, 20),
				dotMat,
			)
			// Pit: disc on cushion near sit height; polygonOffset reduces torus z-fight
			const dotY = isSofa ? (isPitRing ? 0.2 : 0.38) : 0.485
			dot.position.set(seat.pos[0], dotY, seat.pos[2])
			g.add(dot)

			sharedSeatMeshes.push({
				mesh,
				roomId: room.id,
				seatId: seat.seatId,
				dot,
				dotMat,
			})
		}
	}

	function refreshSeatDots () {
		for (const s of sharedSeatMeshes) {
			if (!s.dotMat) continue
			const taken = presenceStore.users.some(
				(u) => u.seatId === s.seatId && u.status !== "offline",
			)
			s.dotMat.color.set(taken ? 0xff6d00 : 0x00b4d8)
			s.dotMat.emissive.set(taken ? 0x662200 : 0x004466)
			s.dotMat.emissiveIntensity = taken ? 1.0 : 0.6
		}
	}

	// ── Avatar system ────────────────────────────────────────────────

	// Parse avatar config stored as JSON in avatarUrl field.
	// Returns custom avatar fields or null for legacy/absent.
	function parseAvatarConfig (avatarUrl) {
		if (!avatarUrl) return null
		try {
			const obj = JSON.parse(avatarUrl)
			if (obj.type === "custom") return obj
		} catch { /* ignore */ }
		return null
	}

	function removeAccessoryCapFromGroup (g) {
		const cap = g.children.find((ch) => ch.userData?.isAccessoryCap)
		if (cap) g.remove(cap)
	}

	/**
	 * Optional baseball cap — pivot aligned with head sphere (same xz as hair cap); crown is
	 * a true upper hemisphere so the front has enough area for the logo texture. Brim is a
	 * brim is a thin **cylindrical sector** (pie slice in XZ, small height on Y): a solid half-disc
	 * from above — no ExtrudePath / Frenet mapping. +Z = face forward.
	 */
	function applyBaseballCapFromConfig (g, cfg, HEAD_Y) {
		removeAccessoryCapFromGroup(g)
		if (!cfg?.capEnabled) return

		const capCol = new THREE.Color(cfg.capColor || "#1e3a5f")
		const capRoot = new THREE.Group()
		capRoot.userData.isAccessoryCap = true
		// Match head / hair anchor (head center xz; hair cap uses z = -0.02)
		capRoot.position.set(0, HEAD_Y - 0.03, -0.02)
		capRoot.rotation.order = "YXZ"
		// Single modest pitch — avoids “floating forward” from stacking position + large tilt
		capRoot.rotation.x = -0.34

		const crownR = 0.204
		const crownMat = new THREE.MeshStandardMaterial({
			color: capCol,
			roughness: 0.62,
			metalness: 0.06,
		})
		// Upper hemisphere (north pole +Y): flat opening at y=0, dome y ∈ [0, R] — reads as a tall cap dome
		const crown = new THREE.Mesh(
			new THREE.SphereGeometry(crownR, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
			crownMat,
		)
		// Raise so the equator band sits on the upper skull (slightly larger R than head 0.2)
		crown.position.set(0, 0.100, 0.01)
		crown.castShadow = true
		capRoot.add(crown)

		const brimMat = new THREE.MeshStandardMaterial({
			color: capCol,
			roughness: 0.68,
			metalness: 0.05,
			side: THREE.DoubleSide,
		})
		// Bill: circular outer edge (not ellipse) keeps front rounded, taper merges sides into crown.
		const brimH = 0.016
		const arc = (110 / 180) * Math.PI
		const innerR = crownR * 0.996
		const thetaStart = Math.PI / 2 - arc * 0.5
		const brimGeo = buildFlatBrimGeometry({
			innerR,
			outerR: innerR + 0.125,
			yTop: 0.100,
			height: brimH,
			thetaStart,
			thetaLength: arc,
		})
		const brim = new THREE.Mesh(brimGeo, brimMat)
		brim.position.set(0, 0.016, 0.01)
		brim.castShadow = true
		capRoot.add(brim)

		const panelMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		})
		const panel = new THREE.Mesh(
			new THREE.PlaneGeometry(0.217, 0.1138),
			panelMat,
		)
		// Place on **front of crown sphere** (not fixed z fraction of crownR — that sat inside / side
		// of the dome after brim + tilt). Plane default normal +Z; align to outward normal from
		// sphere center **crown.position** toward forehead (+Y, +Z in capRoot).
		const crownCenter = new THREE.Vector3(0, crown.position.y, crown.position.z)
		const logoDir = new THREE.Vector3(0, 0.35, 1).normalize()
		const onSurf = crownCenter.clone().addScaledVector(logoDir, crownR * 0.975)
		panel.position.copy(onSurf.addScaledVector(logoDir, 0.006))
		panel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), logoDir)
		panel.renderOrder = 1
		capRoot.add(panel)

		loadCapLogoBaseTexture()
			.then((base) => {
				if (!g.parent) return
				if (!g.children.includes(capRoot)) return
				const map = base.clone()
				map.colorSpace = THREE.SRGBColorSpace
				map.anisotropy = 4
				map.needsUpdate = true
				panelMat.map = map
				panelMat.needsUpdate = true
			})
			.catch(() => { /* logo optional */ })

		g.add(capRoot)
	}

	function spawnAvatar (userData) {
		if (avatarGroups.has(userData.id)) {
			const existing = avatarGroups.get(userData.id)
			// Rebuild if the avatar config or top color changed (e.g. after AvatarMaker save)
			const avatarUrlChanged = userData.avatarUrl && existing.userData.avatarUrl !== userData.avatarUrl
			const colorChanged = userData.color && existing.userData.color !== userData.color
			if (avatarUrlChanged || colorChanged) {
				removeAvatar(userData.id)  // evicts CSS2D DOM node, not just scene graph
				avatarMixers.delete(userData.id)
			} else {
				updateAvatarLabel(userData.id, userData)
				return
			}
		}
		const g = new THREE.Group()
		g.name = `avatar-${userData.id}`

		const cfg = parseAvatarConfig(userData.avatarUrl)
		const topColor = new THREE.Color(cfg?.topColor || userData.color || "#2E65B8")
		const bottomColor = new THREE.Color(cfg?.bottomColor || userData.color || "#1B3A6B")
		const skinColor = new THREE.Color(cfg?.skinTone || "#C68642")
		const hairCol = new THREE.Color(cfg?.hairColor || "#3B2314")
		const hairSt = cfg?.hairStyle || "medium"

		const topMat = new THREE.MeshStandardMaterial({
			color: topColor,
			roughness: 0.7,
			metalness: 0.05,
		})
		const bottomMat = new THREE.MeshStandardMaterial({
			color: bottomColor,
			roughness: 0.7,
			metalness: 0.05,
		})
		const skinMat = new THREE.MeshStandardMaterial({
			color: skinColor,
			roughness: 0.75,
			metalness: 0.0,
		})
		const hairMat = new THREE.MeshStandardMaterial({
			color: hairCol,
			roughness: 0.85,
			metalness: 0.0,
		})

		// Torso / shirt — capsule covering upper body
		// CapsuleGeometry(r, h): total = h + 2r = 0.40 + 0.44 = 0.84; half = 0.42
		// Center y=0.85 → straight section y=0.65–1.05, top hemisphere to y≈1.27
		// Top sphere center at y=1.05 mirrors the old single-body capsule so the
		// hemisphere tapers to the same narrow sliver at the head bottom (y=1.24).
		const torso = new THREE.Mesh(
			new THREE.CapsuleGeometry(0.20, 0.25, 4, 12),
			topMat,
		)
		torso.position.y = 0.96
		torso.castShadow = true
		g.add(torso)

		// Arms — capsule tubes at each side, slight inward splay at the shoulder
		// CapsuleGeometry(r, h): total height = h + 2r = 0.38 + 0.13 = 0.51
		// Center y = 0.925 → top ≈ 1.185 (shoulder), bottom ≈ 0.67 (waist)
		// Wrapped in a pivot group at the shoulder so emote tick can rotate around y≈1.185.
		for (const sx of [-1, 1]) {
			const pivot = new THREE.Group()
			pivot.position.set(sx * 0.26, 1.185, 0) // shoulder
			pivot.userData.isArmPivot = true
			pivot.userData.armSide = sx // -1 = left, +1 = right
			pivot.userData.baseRotZ = sx * 0.15
			pivot.rotation.z = sx * 0.15
			const arm = new THREE.Mesh(
				new THREE.CapsuleGeometry(0.065, 0.38, 4, 8),
				topMat,
			)
			arm.position.y = -0.225 // hang down from shoulder pivot to original center y=0.96
			arm.castShadow = true
			pivot.add(arm)
			g.add(pivot)
		}

		// Legs / pants — two capsules below the torso
		// CapsuleGeometry(r, h): total = h + 2r = 0.48 + 0.21 = 0.69; half = 0.345
		// Center y=0.44 → from y≈0.095 (near floor) to y≈0.785 (hidden under torso)
		// isLeg=true lets the per-frame loop repose them when seatY changes.
		for (const lx of [-1, 1]) {
			const leg = new THREE.Mesh(
				new THREE.CapsuleGeometry(0.105, 0.48, 4, 8),
				bottomMat,
			)
			const LEG_STAND_Y = 0.44
			leg.position.set(lx * 0.1, LEG_STAND_Y, 0)
			leg.userData.isLeg = true
			leg.userData.baseY = LEG_STAND_Y
			leg.castShadow = true
			g.add(leg)
		}

		// Head
		const HEAD_Y = 1.44
		const head = new THREE.Mesh(
			new THREE.SphereGeometry(0.2, 16, 12),
			skinMat,
		)
		head.position.y = HEAD_Y
		head.castShadow = true
		g.add(head)

		// Hair
		if (hairSt !== "none") {
			// Cap — tilted backward (negative X rotation) so the rim's front edge
			// rises above the eyebrow and the back edge dips to cover the lower rear skull.
			// rotation.x = -0.72 rad (~41°): front rim lifts to ~HEAD_Y+0.15, back rim drops to ~HEAD_Y-0.15.
			const cap = new THREE.Mesh(
				new THREE.SphereGeometry(
					0.206,
					16,
					8,
					0,
					Math.PI * 2,
					0,
					Math.PI * 0.5,
				),
				hairMat,
			)
			cap.position.set(0, HEAD_Y + 0.01, -0.02)
			cap.rotation.x = -0.72 // negative = front edge rises above brow, back edge drops
			g.add(cap)

			if (hairSt === "long") {
				// Very Long — wide back panel hanging well below the shoulders
				const backHair = new THREE.Mesh(
					new THREE.SphereGeometry(0.22, 14, 10),
					hairMat,
				)
				backHair.position.set(0, HEAD_Y - 0.22, -0.12)
				backHair.scale.set(1.05, 1.6, 0.58)
				g.add(backHair)
			} else if (hairSt === "medium") {
				// Medium — back panel reaches past the nape toward the shoulders
				const backHair = new THREE.Mesh(
					new THREE.SphereGeometry(0.22, 14, 8),
					hairMat,
				)
				backHair.position.set(0, HEAD_Y - 0.09, -0.11)
				backHair.scale.set(0.82, 0.92, 0.55)
				g.add(backHair)
			}
		}

		// Optional swag: baseball cap (JSON `capEnabled` / `capColor`) — after hair so it layers above
		applyBaseballCapFromConfig(g, cfg, HEAD_Y)

		// Eyes
		const eyeMat = new THREE.MeshStandardMaterial({
			color: 0x050a10,
			roughness: 1,
		})
		for (const ex of [-0.07, 0.07]) {
			const eye = new THREE.Mesh(
				new THREE.SphereGeometry(0.03, 6, 6),
				eyeMat,
			)
			eye.position.set(ex, HEAD_Y + 0.06, 0.17)
			g.add(eye)
		}

		// Mouth — half-torus arc: resting = slight smile (∪), talking = arc stretches open.
		// Three.js TorusGeometry lies in the XY plane by default (already faces viewer).
		// rotation.z = π flips upper-arch (∩) to smile (∪).
		// rotation.x = 0.38 tilts the bottom of the arc back to follow the lower-sphere curvature.
		const mouthMat = new THREE.MeshStandardMaterial({
			color: 0x2a0a0a,
			roughness: 1,
		})
		const mouth = new THREE.Mesh(
			new THREE.TorusGeometry(0.028, 0.007, 4, 10, Math.PI),
			mouthMat,
		)
		mouth.position.set(0, HEAD_Y - 0.074, 0.178)
		mouth.rotation.x = 0.38
		mouth.rotation.z = Math.PI
		g.userData.mouthMesh = mouth
		g.add(mouth)

		// ── Facial hair ──────────────────────────────────────────────────
		// Head sphere: center (0, HEAD_Y, 0), R = 0.2.
		// All facial hair uses hairMat. Shapes must sit OUTSIDE the sphere.
		// Surface-z helper: at (x, y) → z_surface = sqrt(0.04 - x² - (y-HEAD_Y)²).
		// Beard fullness scales with hairStyle.
		// const facialHairStyle = cfg?.facialHair || "none"
		// if (facialHairStyle !== "none") {
		// 	if (facialHairStyle === "mustache" || facialHairStyle === "beard") {
		// 		// Mustache — wide flat ellipsoid sitting on the upper lip.
		// 		// At y = HEAD_Y - 0.05, surface z ≈ 0.187. Center at z = 0.19 so it's proud.
		// 		const stache = new THREE.Mesh(
		// 			new THREE.SphereGeometry(0.028, 8, 6),
		// 			hairMat,
		// 		)
		// 		stache.position.set(0, HEAD_Y - 0.05, 0.19)
		// 		stache.scale.set(2.2, 0.5, 0.45)  // wide, thin, shallow
		// 		g.add(stache)
		// 	}
		// 	if (facialHairStyle === "goatee") {
		// 		// Goatee — small mustache + chin tuft
		// 		const stache = new THREE.Mesh(
		// 			new THREE.SphereGeometry(0.022, 8, 6),
		// 			hairMat,
		// 		)
		// 		stache.position.set(0, HEAD_Y - 0.05, 0.19)
		// 		stache.scale.set(1.8, 0.5, 0.45)
		// 		g.add(stache)
		// 		// Chin: at y = HEAD_Y - 0.16, surface z ≈ 0.12. Push to z = 0.15.
		// 		const chin = new THREE.Mesh(
		// 			new THREE.SphereGeometry(0.045, 8, 6),
		// 			hairMat,
		// 		)
		// 		chin.position.set(0, HEAD_Y - 0.16, 0.15)
		// 		chin.scale.set(0.8, 1.3, 0.6)
		// 		g.add(chin)
		// 	}
		// 	if (facialHairStyle === "beard") {
		// 		// Full beard — solid sphere pushed forward so front wraps outside head.
		// 		// Back half hidden by the head itself.
		// 		const beardScale = hairSt === "long" ? 1.25
		// 			: hairSt === "medium" ? 1.0
		// 				: 0.8

		// 		// Main jaw body
		// 		const jawBeard = new THREE.Mesh(
		// 			new THREE.SphereGeometry(0.15, 12, 10),
		// 			hairMat,
		// 		)
		// 		jawBeard.position.set(0, HEAD_Y - 0.13, 0.1)
		// 		jawBeard.scale.set(1.15 * beardScale, 0.95 * beardScale, 0.75)
		// 		g.add(jawBeard)

		// 		// Chin extension hanging below
		// 		const chinTuft = new THREE.Mesh(
		// 			new THREE.SphereGeometry(0.06, 8, 6),
		// 			hairMat,
		// 		)
		// 		chinTuft.position.set(0, HEAD_Y - 0.22 * beardScale, 0.11)
		// 		chinTuft.scale.set(0.85, 1.1 * beardScale, 0.65)
		// 		g.add(chinTuft)

		// 		// Sideburns
		// 		for (const sx of [-1, 1]) {
		// 			const sideburn = new THREE.Mesh(
		// 				new THREE.CapsuleGeometry(0.03 * beardScale, 0.07, 4, 6),
		// 				hairMat,
		// 			)
		// 			sideburn.position.set(sx * 0.155, HEAD_Y - 0.06, 0.08)
		// 			sideburn.rotation.z = sx * 0.15
		// 			g.add(sideburn)
		// 		}
		// 	}
		// }

		// ── Glasses / Sunglasses ─────────────────────────────────────────
		// Head R=0.2 at (0, HEAD_Y, 0). Eyes at (±0.07, HEAD_Y+0.06, 0.17).
		// Surface z at eyes ≈ 0.177. All geometry z ≥ 0.195.
		// Lenses at x=±0.07, r=0.035 → inner edges at x=±0.035.
		// Bridge spans 0.07 wide to connect inner edges.
		// Temples run outward along X (not backward in Z which clips into head).
		// if (cfg?.glasses) {
		// 	const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.6, metalness: 0.3 })
		// 	const lensMat = new THREE.MeshStandardMaterial({
		// 		color: 0xddeeff, roughness: 0.1, metalness: 0.1,
		// 		transparent: true, opacity: 0.3, side: THREE.DoubleSide,
		// 	})
		// 	const glassesY = HEAD_Y + 0.06
		// 	const lensZ = 0.197
		// 	for (const ex of [-0.07, 0.07]) {
		// 		const frame = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 6, 16), frameMat)
		// 		frame.position.set(ex, glassesY, lensZ)
		// 		g.add(frame)
		// 		const lens = new THREE.Mesh(new THREE.CircleGeometry(0.033, 16), lensMat)
		// 		lens.position.set(ex, glassesY, lensZ + 0.001)
		// 		g.add(lens)
		// 	}
		// 	// Bridge — connects inner edges of lenses (x = ±0.035)
		// 	const bridge = new THREE.Mesh(
		// 		new THREE.BoxGeometry(0.07, 0.005, 0.005),
		// 		frameMat,
		// 	)
		// 	bridge.position.set(0, glassesY + 0.02, lensZ)
		// 	g.add(bridge)
		// 	// Temples — run sideways along X from outer lens edge toward the ears.
		// 	// Stays at lensZ so it never enters the head sphere.
		// 	for (const sx of [-1, 1]) {
		// 		const temple = new THREE.Mesh(
		// 			new THREE.CylinderGeometry(0.003, 0.003, 0.095, 4),
		// 			frameMat,
		// 		)
		// 		temple.position.set(sx * 0.152, glassesY, lensZ - 0.01)
		// 		temple.rotation.z = Math.PI / 2  // orient along X
		// 		g.add(temple)
		// 	}
		// }
		// if (cfg?.sunglasses) {
		// 	const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.5 })
		// 	const lensMat = new THREE.MeshStandardMaterial({
		// 		color: 0x111111, roughness: 0.2, metalness: 0.6,
		// 		transparent: true, opacity: 0.85,
		// 	})
		// 	const glassesY = HEAD_Y + 0.06
		// 	const lensZ = 0.197
		// 	for (const ex of [-0.07, 0.07]) {
		// 		const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.012), frameMat)
		// 		frame.position.set(ex, glassesY, lensZ)
		// 		g.add(frame)
		// 		const lens = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.042, 0.008), lensMat)
		// 		lens.position.set(ex, glassesY, lensZ + 0.003)
		// 		g.add(lens)
		// 	}
		// 	// Bridge — connects inner edges of frames (x = ±0.03)
		// 	const bridge = new THREE.Mesh(
		// 		new THREE.BoxGeometry(0.06, 0.007, 0.007),
		// 		frameMat,
		// 	)
		// 	bridge.position.set(0, glassesY + 0.015, lensZ)
		// 	g.add(bridge)
		// 	// Temples — run sideways along X
		// 	for (const sx of [-1, 1]) {
		// 		const temple = new THREE.Mesh(
		// 			new THREE.CylinderGeometry(0.004, 0.004, 0.095, 4),
		// 			frameMat,
		// 		)
		// 		temple.position.set(sx * 0.157, glassesY, lensZ - 0.01)
		// 		temple.rotation.z = Math.PI / 2
		// 		g.add(temple)
		// 	}
		// }

		// ── Headphones ───────────────────────────────────────────────────
		// Half-torus arc from ear to ear over the top of the head (or cap).
		// Default Three.js torus lies in XY plane → a half-arc (0..PI) naturally
		// goes from (+R, 0) through (0, +R) to (-R, 0) = right-ear → crown → left-ear.
		// No extra rotations needed — that was causing the front/back nose artifact.
		if (cfg?.headphones) {
			const hpMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.4 })
			const padMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7, metalness: 0.2 })
			const wearingCap = !!cfg?.capEnabled
			const bandR = wearingCap ? 0.26 : 0.22
			const cupX = 0.215
			const cupY = HEAD_Y

			// Headband — half-torus in XY plane, no rotation
			const band = new THREE.Mesh(
				new THREE.TorusGeometry(bandR, 0.014, 6, 24, Math.PI),
				hpMat,
			)
			band.position.set(0, cupY, 0)
			// no rotation — arc naturally goes ear-to-ear over the top
			g.add(band)

			// Ear cups — cylinders on the sides of the head
			for (const sx of [-1, 1]) {
				const cup = new THREE.Mesh(
					new THREE.CylinderGeometry(0.065, 0.065, 0.055, 14),
					hpMat,
				)
				cup.position.set(sx * cupX, cupY, 0)
				cup.rotation.z = Math.PI / 2
				g.add(cup)
				const pad = new THREE.Mesh(
					new THREE.CylinderGeometry(0.045, 0.045, 0.018, 12),
					padMat,
				)
				pad.position.set(sx * (cupX - 0.012), cupY, 0)
				pad.rotation.z = Math.PI / 2
				g.add(pad)
			}
		}

		// Status glow ring at feet
		const sc = statusColorForUser(userData)
		const statusMat = new THREE.MeshStandardMaterial({
			color: sc,
			emissive: new THREE.Color(sc),
			emissiveIntensity: 0.7,
			transparent: true,
			opacity: 0.7,
		})
		const ring = new THREE.Mesh(
			new THREE.TorusGeometry(0.3, 0.04, 6, 20),
			statusMat,
		)
		ring.rotation.x = Math.PI / 2
		ring.position.y = 0.04
		ring.userData.isStatusRing = true
		g.add(ring)

		// Name label
		const label = makeAvatarLabel(userData)
		label.position.set(0, 2.0, 0)
		g.add(label)

		// Position in room — honor named seat immediately so other clients
		// always see the avatar in the correct chair rather than a random spot.
		// Derive room from the seatId prefix when available (e.g. 'conference' from
		// 'conference:3') — the DB room_id can be stale (still 'lobby') while the
		// user is seated, causing a lobby-flash during avatar rebuilds.
		const seatRoomId = userData.seatId?.includes(':')
			? userData.seatId.slice(0, userData.seatId.indexOf(':'))
			: (userData.roomId || 'lobby')
		const room = getRoomById(seatRoomId) || getRoomById(userData.roomId || 'lobby')
		let deskSpawnRy = null
		if (userData.seatId) {
			const seat = room?.seats?.find((s) => s.seatId === userData.seatId)
			if (seat) {
				const cam = computeSeatCamera(room, seat)
				g.userData.seatY = namedSeatSitY(seat, userData.seatId)
				g.rotation.y =
					typeof userData.rotation === "number" && !Number.isNaN(userData.rotation)
						? userData.rotation
						: cam.avatarRot
				g.position.set(cam.avatarPos[0], 0, cam.avatarPos[1])
			} else if (userData.seatId === userData.roomId + ":desk" && room?.type === "office") {
				// Generic desk seat — mirrors the moveAvatarToRoom :desk branch so the
				// avatar spawns at the correct position/rotation rather than a random spot.
				// Use persisted `userData.rotation` when present (reload / peers); fall back
				// to door-facing when the row has not written Rotation yet. (Walking
				// heading + `:desk` in the same row is handled by sync passing null until
				// the seat matches — see OfficeCanvas `useDbRotationForSeat`.)
				const [rx, rz] = room.pos
				const backSign = room.row === "north" ? -1 : 1
				g.userData.seatY = -0.2
				gsap.killTweensOf(g.rotation)
				deskSpawnRy =
					typeof userData.rotation === "number" && !Number.isNaN(userData.rotation)
						? userData.rotation
						: occupantDeskFacingY(room)
				g.rotation.y = deskSpawnRy
				g.position.set(rx, 0, rz + backSign * 0.5)
			} else {
				g.position.copy(clearRoomPos(room, userData.id))
			}
		} else {
			g.position.copy(clearRoomPos(room, userData.id))
		}

		g.userData.avatarUrl = userData.avatarUrl || null
		g.userData.color = userData.color || null
		// Seed label cache so updateAvatarLabel skips the first no-op DOM rebuild
		g.userData.labelName = userData.name || ''
		g.userData.labelStatus = userData.status || 'online'
		// Seed movement-guard fields so the first moveAvatarToRoom call after
		// spawn is correctly skipped rather than re-GSAP-ing to the same position.
		// Use the effective room (derived from seatId prefix) so the skip guard
		// matches on the next moveAvatarToRoom call with the corrected roomId.
		g.userData.lastRoomId = seatRoomId
		g.userData.lastSeatId = userData.seatId || null
		// Seed so moveAvatarToRoom's same-seat guard still applies pose deltas; peers
		// often arrive with rotation already on the row (see spawn named-seat above).
		g.userData.lastSpRotation =
			deskSpawnRy != null
				? deskSpawnRy
				: (typeof userData.rotation === "number" && !Number.isNaN(userData.rotation)
					? userData.rotation
					: null)
		scene.add(g)
		avatarGroups.set(userData.id, g)
	}

	/** Pull just the leading emoji from a SlackStatus string (drops the trailing
	 *  text so the floating label stays compact). Returns '' if the first token
	 *  is plain ASCII (i.e. no emoji at the start). */
	function _statusGlyph (slackStatus) {
		if (!slackStatus) return ''
		const display = slackStatusForDisplay(slackStatus)
		if (!display) return ''
		const first = display.split(' ')[0]
		// eslint-disable-next-line no-control-regex
		return /[^\x00-\x7F]/.test(first) ? first : ''
	}

	function makeAvatarLabel (userData) {
		const div = document.createElement("div")
		div.className = "avatar-label"
		const status = userData.status || 'online'
		const dot = document.createElement("span")
		dot.className = `status-dot ${status}`
		div.appendChild(dot)
		div.appendChild(document.createTextNode(userData.name || "User"))
		const glyph = _statusGlyph(userData.slackStatus)
		if (glyph) {
			const em = document.createElement('span')
			em.className = 'status-emoji'
			em.textContent = glyph
			div.appendChild(em)
		}
		// Handle click on the label directly — more reliable than raycasting when
		// labels overlap in POV, and blocks door/room labels behind from firing.
		div.addEventListener("click", (e) => {
			e.stopPropagation()
			// String-compare IDs: local avatar uses authUserId, presence avatars use
			// list item Id — fall back to userData itself so clicking always works.
			const user =
				presenceStore.users.find(
					(u) => String(u.id) === String(userData.id),
				) || userData
			window.dispatchEvent(
				new CustomEvent("ava-user-click", {
					detail: { user, screenX: e.clientX, screenY: e.clientY },
				}),
			)
		})
		return new CSS2DObject(div)
	}

	function updateAvatarLabel (userId, userData) {
		const g = avatarGroups.get(userId)
		if (!g) return
		// Skip DOM rebuild if nothing visible changed — avoids N×DOM thrash on every presence poll
		if (
			g.userData.labelName   === userData.name &&
			g.userData.labelStatus === userData.status &&
			g.userData.labelSlack  === (userData.slackStatus || '')
		) return
		const existing = g.children.find((c) => c instanceof CSS2DObject)
		if (existing) {
			// Explicitly remove the DOM node — CSS2DRenderer only hides lazily
			if (existing.element?.parentNode) existing.element.parentNode.removeChild(existing.element)
			g.remove(existing)
		}
		const label = makeAvatarLabel(userData)
		label.position.set(0, 2.2, 0)
		g.add(label)
		g.userData.labelName   = userData.name || ''
		g.userData.labelStatus = userData.status || 'online'
		g.userData.labelSlack  = userData.slackStatus || ''
	}

	/**
	 * Y rotation for an occupant seated at the office desk, facing the door.
	 * Layout: `generateOffices` uses index i = officeNumber − 1; even i → north row,
	 * odd i → south row — so **odd** office numbers (1,3,5…) face **north** wall door,
	 * **even** (2,4,6…) face **south** wall door.
	 */
	function occupantDeskFacingY (room) {
		if (room?.row === "south") return Math.PI
		return 0
	}

	function moveAvatarToRoom (userId, roomId, seatId = null, pose = null) {
		const g = avatarGroups.get(userId)
		if (!g) return
		const room = getRoomById(roomId)
		if (!room) return

		if (seatId) {
			// Skip if already at this exact seat — presence polls every 15 s and we
			// don't want a GSAP tween re-firing to the same position each time.
			if (
				seatId === g.userData.lastSeatId &&
				roomId === g.userData.lastRoomId
			) {
				if (seatId === roomId + ":desk" && room.type === "office") {
					if (pose?.rotation == null) {
						// Peers with no Rotation yet: face the door. For ourselves, Rotation
						// is often briefly null between seat change and the 3 s pose debounce
						// — re-applying desk default every presence poll wiped user heading.
						if (String(userId) !== String(myUserId)) {
							gsap.killTweensOf(g.rotation)
							g.rotation.y = occupantDeskFacingY(room)
						}
					} else if (
						pose.rotation !== g.userData.lastSpRotation &&
						!(String(userId) === String(myUserId) && officeStore.hasLocalPose)
					) {
						// Stored rotation not yet applied (e.g. first poll after reload) — sync it.
						// Skip for local user once hasLocalPose is true: claimSeat already applied
						// the correct default heading; the DB rotation here is from the previous
						// session and must not override the fresh arrival.
						g.userData.lastSpRotation = pose.rotation
						gsap.killTweensOf(g.rotation)
						g.rotation.y = pose.rotation
					}
				} else if (
					pose?.rotation != null &&
					pose.rotation !== g.userData.lastSpRotation
				) {
					// Conference / lobby / etc.: spawnAvatar seeds lastSeatId so the first
					// moveAvatarToRoom hits this guard — without this branch, persisted
					// Rotation never replaced the default focal facing.
					g.userData.lastSpRotation = pose.rotation
					gsap.killTweensOf(g.rotation)
					g.rotation.y = pose.rotation
				}
				return
			}
			g.userData.lastRoomId = roomId
			g.userData.lastSeatId = seatId

			// Named seat (e.g. conference:3) — if the passed roomId is stale (lobby)
			// and the seat isn't found there, fall back to the room derived from the
			// seatId prefix so the avatar lands in the correct chair.
			let seat = room.seats?.find((s) => s.seatId === seatId)
			let effectiveRoom = room
			if (!seat && seatId?.includes(':')) {
				const prefixRoom = getRoomById(seatId.slice(0, seatId.indexOf(':')))
				const prefixSeat = prefixRoom?.seats?.find((s) => s.seatId === seatId)
				if (prefixSeat) { seat = prefixSeat; effectiveRoom = prefixRoom }
			}
			if (seat) {
				const cam = computeSeatCamera(effectiveRoom, seat)
				// Correct lastRoomId when we fell back to the prefix room
				if (effectiveRoom !== room) g.userData.lastRoomId = effectiveRoom.id
				g.userData.seatY = namedSeatSitY(seat, seatId)
				gsap.killTweensOf(g.rotation)
				g.rotation.y = pose?.rotation ?? cam.avatarRot
				// Keep lastSpRotation aligned with what we actually applied so a later
				// sync with the real `Rotation` from the row can still apply (reload often
				// passes pose.rotation null once, then me.rotation on the next tick).
				g.userData.lastSpRotation = g.rotation.y
				gsap.to(g.position, {
					x: cam.avatarPos[0],
					z: cam.avatarPos[1],
					duration: 0.8,
					ease: "power2.inOut",
				})
				return
			}
			// Generic desk seat for office occupants (seatId = roomId + ':desk')
			if (seatId === roomId + ":desk" && room.type === "office") {
				const [rx, rz] = room.pos
				const backSign = room.row === "north" ? -1 : 1
				g.userData.seatY = -0.2
				gsap.killTweensOf(g.rotation)
				// Don't apply stale DB rotation to local user when claimSeat already
				// established a fresh heading (hasLocalPose = true after navigation).
				// On reload hasLocalPose stays false, so saved rotation is honored.
				const isLocalSeated = String(userId) === String(myUserId) && officeStore.hasLocalPose
				g.rotation.y =
					pose?.rotation != null && !isLocalSeated
						? pose.rotation
						: (isLocalSeated ? officeStore.myRotation : occupantDeskFacingY(room))
				g.userData.lastSpRotation = g.rotation.y
				gsap.to(g.position, {
					x: rx,
					z: rz + backSign * 0.5,
					duration: 0.8,
					ease: "power2.inOut",
				})
				return
			}
		}

		// Standing: apply stored pose (posX/posZ/rotation from SP) when available so
		// peers see the avatar where it actually walked to, not a random room position.
		// Fall back to clearRoomPos for users with no stored pose (first join, etc.).
		g.userData.seatY = 0
		// Same-room pose while presence still had a chair would block hasPose (!lastSeatId);
		// clear the seat guard so duplicate-desk reconciliation / stand-up can tween to coords.
		if (!seatId && pose?.posX != null && roomId === g.userData.lastRoomId && g.userData.lastSeatId) {
			g.userData.lastSeatId = null
		}
		// Pose only applies within the same room — room changes always use random placement
		// so stale world-coords from the previous room aren't projected into the new one.
		const hasPose = pose?.posX != null && roomId === g.userData.lastRoomId && !g.userData.lastSeatId
		if (hasPose) {
			const dx = pose.posX - g.position.x
			const dz = pose.posZ - g.position.z
			const sameRoom = roomId === g.userData.lastRoomId
			const nearSame = sameRoom && Math.hypot(dx, dz) < 0.12
			if (nearSame) {
				// Only apply the stored rotation if it actually changed since we last wrote
				// it.  This prevents greeting / singlechat / visit rotations from being
				// reverted by the same stale presence value on the next poll, while still
				// propagating intentional peer rotations (the peer heartbeats a new
				// value which differs from lastSpRotation, so we apply it).
				if (pose.rotation != null &&
					pose.rotation !== g.userData.lastSpRotation &&
					Math.abs(pose.rotation - g.rotation.y) > 0.08) {
					g.userData.lastSpRotation = pose.rotation
					gsap.to(g.rotation, { y: pose.rotation, duration: 0.4, ease: 'power2.out' })
				}
				return
			}
			g.userData.lastRoomId = roomId
			g.userData.lastSeatId = null
			const isLocal = String(userId) === String(myUserId)
			const [_rpcx, _rpcz] = room.pos
			const tgtPos = isLocal
				? _avoidPeers(pose.posX, pose.posZ, userId, 1.2, { x: _rpcx, z: _rpcz }, roomId)
				: { x: pose.posX, z: pose.posZ }
			g.userData.targetPosX = tgtPos.x
			g.userData.targetPosZ = tgtPos.z
			gsap.to(g.position, {
				x: tgtPos.x, y: 0, z: tgtPos.z, duration: 1.2, ease: 'power2.inOut',
				...(isLocal ? {
					onComplete () {
						const gg = avatarGroups.get(userId)
						if (gg) officeStore.setMyPose(gg.position.x, gg.position.z, gg.rotation.y)
					},
				} : {}),
			})
			if (pose.rotation != null) {
				g.userData.lastSpRotation = pose.rotation
				gsap.to(g.rotation, { y: pose.rotation, duration: 0.5, ease: 'power2.out' })
			}
		} else {
			// No stored pose — only place randomly when room changes (prevents drift on every poll)
			if (roomId === g.userData.lastRoomId && !g.userData.lastSeatId) return
			g.userData.lastRoomId = roomId
			g.userData.lastSeatId = null
			const target = clearRoomPos(room, userId)
			g.userData.targetPosX = target.x
			g.userData.targetPosZ = target.z
			gsap.to(g.position, { x: target.x, y: 0, z: target.z, duration: 0.8, ease: 'power2.inOut' })
		}
	}

	function computeSeatCamera (room, seat) {
		const [rx, rz] = room.pos
		const [sx, , sz] = seat.pos
		const focal = seat.focal || room.focalPoint || [0, 1.0, 0]
		const fwx = rx + focal[0]
		const fwy = focal[1] ?? 1.0
		const fwz = rz + focal[2]
		const swx = rx + sx
		const swz = rz + sz
		const dx = swx - fwx
		const dz = swz - fwz
		const len = Math.sqrt(dx * dx + dz * dz) || 1
		return {
			camPos: [swx + (dx / len) * 1.2, 1.8, swz + (dz / len) * 1.2],
			camTarget: [fwx, fwy, fwz],
			avatarPos: [swx, swz],
			avatarRot: Math.atan2(fwx - swx, fwz - swz),
		}
	}

	/** Y offset while seated; `sitYOffset` on a seat row overrides lobby sofa default. */
	function namedSeatSitY (seat, seatId) {
		if (seat?.sitYOffset != null && Number.isFinite(seat.sitYOffset))
			return seat.sitYOffset
		if (seatId?.includes("lobby") || seat?.seatId?.includes("lobby"))
			return -0.35
		return -0.2
	}

	function playFwoop (direction = "down") {
		if (!hasSoundConsent() || isAllAudioMuted.value) return
		try {
			const ctx = new (
				window.AudioContext || window.webkitAudioContext
			)()
			const osc = ctx.createOscillator()
			const gain = ctx.createGain()
			osc.connect(gain)
			gain.connect(ctx.destination)
			osc.type = "sine"
			const t = ctx.currentTime
			if (direction === "down") {
				// Sit — soft descending sweep
				osc.frequency.setValueAtTime(520, t)
				osc.frequency.exponentialRampToValueAtTime(220, t + 0.18)
			} else {
				// Stand — quick rising sweep
				osc.frequency.setValueAtTime(260, t)
				osc.frequency.exponentialRampToValueAtTime(560, t + 0.18)
			}
			gain.gain.setValueAtTime(0.0, t)
			gain.gain.linearRampToValueAtTime(0.18, t + 0.04)
			gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
			osc.start(t)
			osc.stop(t + 0.22)
			osc.onended = () => ctx.close()
		} catch {
			/* AudioContext not available */
		}
	}

	function playBuzz () {
		if (!hasSoundConsent() || isAllAudioMuted.value) return
		try {
			const ctx = new (
				window.AudioContext || window.webkitAudioContext
			)()
			const osc = ctx.createOscillator()
			const gain = ctx.createGain()
			osc.connect(gain)
			gain.connect(ctx.destination)
			osc.type = "square"
			osc.frequency.setValueAtTime(220, ctx.currentTime)
			osc.frequency.exponentialRampToValueAtTime(
				110,
				ctx.currentTime + 0.15,
			)
			gain.gain.setValueAtTime(0.25, ctx.currentTime)
			gain.gain.exponentialRampToValueAtTime(
				0.001,
				ctx.currentTime + 0.2,
			)
			osc.start(ctx.currentTime)
			osc.stop(ctx.currentTime + 0.2)
			osc.onended = () => ctx.close()
		} catch {
			/* AudioContext not available */
		}
	}

	// ── Coffee machine ────────────────────────────────────────────────

	function playCoffeePour () {
		if (!hasSoundConsent() || isAllAudioMuted.value) return
		try {
			const ctx = new (window.AudioContext || window.webkitAudioContext)()
			// Pink-ish noise via a buffer of random samples
			const bufLen = ctx.sampleRate * 2.2
			const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
			const data = buf.getChannelData(0)
			let b0 = 0, b1 = 0, b2 = 0
			for (let i = 0; i < bufLen; i++) {
				const white = Math.random() * 2 - 1
				b0 = 0.99886 * b0 + white * 0.0555179
				b1 = 0.99332 * b1 + white * 0.0750759
				b2 = 0.96900 * b2 + white * 0.1538520
				data[i] = (b0 + b1 + b2 + white * 0.5362) * 0.11
			}
			const noise = ctx.createBufferSource()
			noise.buffer = buf
			// Band-pass filter centred around the ~800 Hz gurgle range
			const bpf = ctx.createBiquadFilter()
			bpf.type = 'bandpass'
			bpf.frequency.value = 800
			bpf.Q.value = 0.8
			const gain = ctx.createGain()
			const t = ctx.currentTime
			// Fade in, hold, fade out
			gain.gain.setValueAtTime(0, t)
			gain.gain.linearRampToValueAtTime(0.55, t + 0.25)
			gain.gain.setValueAtTime(0.55, t + 1.6)
			gain.gain.exponentialRampToValueAtTime(0.001, t + 2.2)
			noise.connect(bpf)
			bpf.connect(gain)
			gain.connect(ctx.destination)
			noise.start(t)
			noise.stop(t + 2.2)
			noise.onended = () => ctx.close()
		} catch { /* AudioContext not available */ }
	}

	/** Build and attach a coffee cup Group to any avatar group. */
	function attachCoffeeCupTo (g) {
		if (!g) return
		// Remove any existing cup first
		const existing = g.children.find(c => c.userData.isCoffeeCup)
		if (existing) g.remove(existing)
		const cupMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.75 })
		const cupGroup = new THREE.Group()
		cupGroup.userData.isCoffeeCup = true
		cupGroup.userData.heldItemType = 'coffee'
		// Cup body — tapered cylinder (2× scale)
		const body = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.060, 0.144, 12), cupMat)
		body.position.y = 0.072
		cupGroup.add(body)
		// Handle — half-torus (2× scale, tilted to follow cup taper ~6.3°)
		const handle = new THREE.Mesh(
			new THREE.TorusGeometry(0.044, 0.012, 5, 10, Math.PI),
			cupMat,
		)
		handle.rotation.z = -Math.PI / 2 - 0.11
		handle.position.set(0.065, 0.067, 0)
		cupGroup.add(handle)
		// Coffee surface disc on top
		const surface = new THREE.Mesh(new THREE.CircleGeometry(0.060, 12), new THREE.MeshStandardMaterial({ color: 0x3b1f0a, roughness: 1 }))
		surface.rotation.x = -Math.PI / 2
		surface.position.y = 0.146
		cupGroup.add(surface)
		cupGroup.rotation.y = Math.PI - 1.33
		cupGroup.position.set(0.31, 0.70, 0.17)
		g.add(cupGroup)
	}

	function attachCoffeeCup () {
		if (!myUserId) return
		const g = avatarGroups.get(myUserId)
		attachCoffeeCupTo(g)
	}

	/** Build and attach a water glass Group to any avatar group (same slot as coffee cup). */
	function attachWaterGlassTo (g) {
		if (!g) return
		const existing = g.children.find(c => c.userData.isCoffeeCup)
		if (existing) g.remove(existing)
		const glassMat = new THREE.MeshStandardMaterial({ color: 0xb0d8f0, transparent: true, opacity: 0.60, roughness: 0.04, metalness: 0.0 })
		const waterMat = new THREE.MeshStandardMaterial({ color: 0x2888cc, transparent: true, opacity: 0.72, roughness: 0.08 })
		const glassGroup = new THREE.Group()
		glassGroup.userData.isCoffeeCup = true
		glassGroup.userData.heldItemType = 'water'
		// Glass body — tapered tumbler, slightly taller than the coffee cup
		const body = new THREE.Mesh(new THREE.CylinderGeometry(0.070, 0.050, 0.155, 12), glassMat)
		body.position.y = 0.0775
		glassGroup.add(body)
		// Water surface disc
		const surface = new THREE.Mesh(new THREE.CircleGeometry(0.058, 12), waterMat)
		surface.rotation.x = -Math.PI / 2
		surface.position.y = 0.140
		glassGroup.add(surface)
		// Same position/rotation as coffee cup so the hand looks right
		glassGroup.rotation.y = Math.PI - 1.33
		glassGroup.position.set(0.31, 0.70, 0.17)
		g.add(glassGroup)
	}

	/** Load tea-mug-AVA.glb and attach to avatar hand slot, replacing coffee/water geometry. */
	function attachYetiMugTo (g, holdingType) {
		if (!g) return
		const existing = g.children.find(c => c.userData.isCoffeeCup)
		if (existing) g.remove(existing)
		const holder = new THREE.Group()
		holder.userData.isCoffeeCup = true
		holder.userData.heldItemType = holdingType
		holder.rotation.y = Math.PI / 2 - 2.6
		holder.position.set(0.31, 0.80, 0.13)
		g.add(holder)
		loadTeaMugGltf()
			.then((scene) => {
				if (!holder.parent) return
				const clone = scene.clone(true)
				clone.scale.setScalar(1.20)
				holder.add(clone)
			})
			.catch(err => console.warn('[yetiMug] load failed:', err))
	}

	function removeCoffeeCup () {
		if (!myUserId) return
		const g = avatarGroups.get(myUserId)
		if (!g) return
		const cup = g.children.find(c => c.userData.isCoffeeCup)
		if (cup) g.remove(cup)
		clearTimeout(coffeeExpireTimer)
		coffeeExpireTimer = null
	}

	function removeWaterGlass () {
		if (!myUserId) return
		const g = avatarGroups.get(myUserId)
		if (!g) return
		const glass = g.children.find(c => c.userData.isCoffeeCup)
		if (glass) g.remove(glass)
		clearTimeout(waterExpireTimer)
		waterExpireTimer = null
	}

	/** Apply avatarState to a peer's avatar group (called on each presence poll).
	 *  When restoring the LOCAL user's held item (e.g. page reload), also restarts the
	 *  1-hour expiry timer for the time remaining since heldAt was recorded. */
	function applyAvatarState (userId, state = {}) {
		const g = avatarGroups.get(userId)
		if (!g) return

		// Jump: trigger peer animation on rising edge only; let it play to completion locally.
		if (state.jump && !g.userData.peerJumpStart) g.userData.peerJumpStart = performance.now()
		g.userData.peerCrouch = !!state.crouch

		// Emote — only sync for peers (local user drives _activeEmote directly via triggerEmote).
		if (String(userId) !== String(myUserId)) {
			const want = state.emote || null
			const cur  = g.userData.peerEmote || null
			if (!want) {
				g.userData.peerEmote = null
			} else if (!cur || cur.name !== want || cur.startedAt !== state.emoteStartedAt) {
				g.userData.peerEmote = {
					name: want,
					startedAt: state.emoteStartedAt || performance.now(),
					variant: state.emoteVariant || null,
				}
			}
		}

		const held = g.children.find(c => c.userData.isCoffeeCup)
		const wantCoffee = state?.holding === 'coffee'
		const wantWater = state?.holding === 'water'
		const wantAny = wantCoffee || wantWater

		// Remove if unwanted or if the wrong type is currently shown
		if (held && (!wantAny || held.userData.heldItemType !== state.holding)) {
			g.remove(held)
		}

		// Check if this user has yetiMug enabled — local user reads avatarStore directly
		// (presenceStore lags on reload and immediately after avatar save)
		const _yetiUrl = String(userId) === String(myUserId)
			? avatarStore.avatarUrl
			: presenceStore.users.find(u => String(u.id) === String(userId))?.avatarUrl
		const useYeti = !!parseAvatarConfig(_yetiUrl)?.yetiMug

		// Attach if nothing held now but something wanted
		if (!g.children.find(c => c.userData.isCoffeeCup)) {
			if (wantCoffee) {
				if (useYeti) attachYetiMugTo(g, 'coffee')
				else attachCoffeeCupTo(g)
				if (String(userId) === String(myUserId) && state.heldAt) {
					const remaining = Math.max(0, 60 * 60 * 1000 - (Date.now() - state.heldAt))
					clearTimeout(coffeeExpireTimer)
					coffeeExpireTimer = setTimeout(() => {
						removeCoffeeCup()
						officeStore.setMyAvatarState({ holding: null, heldAt: null })
						window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: '☕ Coffee finished!', type: 'info' } }))
					}, remaining)
				}
			} else if (wantWater) {
				if (useYeti) attachYetiMugTo(g, 'water')
				else attachWaterGlassTo(g)
				if (String(userId) === String(myUserId) && state.heldAt) {
					const remaining = Math.max(0, 60 * 60 * 1000 - (Date.now() - state.heldAt))
					clearTimeout(waterExpireTimer)
					waterExpireTimer = setTimeout(() => {
						removeWaterGlass()
						officeStore.setMyAvatarState({ holding: null, heldAt: null })
						window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: '💧 Water finished!', type: 'info' } }))
					}, remaining)
				}
			}
		}
	}

	/** Start an emote on the local user. Broadcasts via avatarState so peers animate too. */
	function triggerEmote (name) {
		if (!EMOTES[name]) return
		if (!myUserId) return
		if (officeStore.currentSeatId && (name === 'dance')) return // sit-friendly check: dance needs body
		const startedAt = performance.now()
		// Dance picks a random sub-variant each trigger; broadcast it so peers match.
		const variant = name === 'dance'
			? DANCE_KEYS[Math.floor(Math.random() * DANCE_KEYS.length)]
			: null
		_activeEmote = { name, startedAt, variant }
		officeStore.setMyAvatarState({ emote: name, emoteStartedAt: startedAt, emoteVariant: variant })
	}

	function clearEmote () {
		if (!_activeEmote) return
		_activeEmote = null
		officeStore.setMyAvatarState({ emote: null, emoteStartedAt: null, emoteVariant: null })
	}

	/** Apply absolute pivot rotations from an emote tick to a single avatar group's arms. */
	function _applyEmoteToArms (g, tickResult) {
		let leftPivot = null, rightPivot = null
		for (const c of g.children) {
			if (c.userData.isArmPivot) {
				if (c.userData.armSide < 0) leftPivot = c
				else rightPivot = c
			}
		}
		if (leftPivot) {
			const baseZ = leftPivot.userData.baseRotZ ?? 0
			leftPivot.rotation.z = tickResult.leftRotZ ?? baseZ
			leftPivot.rotation.x = tickResult.leftRotX ?? 0
		}
		if (rightPivot) {
			const baseZ = rightPivot.userData.baseRotZ ?? 0
			rightPivot.rotation.z = tickResult.rightRotZ ?? baseZ
			rightPivot.rotation.x = tickResult.rightRotX ?? 0
		}
		return tickResult.bodyBob ?? 0
	}

	/** Reset arms to base pose (called when emote ends). */
	function _resetArms (g) {
		for (const c of g.children) {
			if (!c.userData.isArmPivot) continue
			c.rotation.z = c.userData.baseRotZ ?? 0
			c.rotation.x = 0
		}
	}

	function getCoffee (machineGroup) {
		const myGroup = myUserId ? avatarGroups.get(myUserId) : null
		const isRefill = !!myGroup?.children.find(c => c.userData.isCoffeeCup)
		// Animate the nozzle — brief downward drip then return
		// const nozzle = machineGroup.getObjectByProperty('userData', undefined)
		let nozzleRef = null
		machineGroup.traverse(c => { if (c.userData.coffeeMachineNozzle) nozzleRef = c })
		if (nozzleRef) {
			const origY = nozzleRef.position.y
			gsap.to(nozzleRef.position, {
				y: origY - 0.04, duration: 0.18, ease: 'power1.in',
				onComplete: () => gsap.to(nozzleRef.position, { y: origY, duration: 0.35, ease: 'power1.out' }),
			})
		}
		playCoffeePour()
		const _coffeeCfg = parseAvatarConfig(avatarStore.avatarUrl)
		if (_coffeeCfg?.yetiMug) attachYetiMugTo(avatarGroups.get(myUserId), 'coffee')
		else attachCoffeeCup()
		officeStore.setMyAvatarState({ holding: 'coffee', heldAt: Date.now() })
		// Clear water timer if replacing a water glass
		clearTimeout(waterExpireTimer); waterExpireTimer = null
		// 1-hour expiry — resets on refill
		clearTimeout(coffeeExpireTimer)
		coffeeExpireTimer = setTimeout(() => {
			removeCoffeeCup()
			officeStore.setMyAvatarState({ holding: null })
			window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: '☕ Coffee finished!', type: 'info' } }))
		}, 60 * 60 * 1000)
		const msg = isRefill ? '☕ Coffee refilled!' : '☕ Enjoy your coffee!'
		window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: msg, type: 'success' } }))
	}

	function playWaterDispense () {
		if (!hasSoundConsent() || isAllAudioMuted.value) return
		try {
			const ctx = new (window.AudioContext || window.webkitAudioContext)()
			const bufLen = ctx.sampleRate * 0.65
			const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
			const data = buf.getChannelData(0)
			for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * 0.28
			const noise = ctx.createBufferSource()
			noise.buffer = buf
			const hpf = ctx.createBiquadFilter()
			hpf.type = 'highpass'; hpf.frequency.value = 1400
			const bpf = ctx.createBiquadFilter()
			bpf.type = 'bandpass'; bpf.frequency.value = 2400; bpf.Q.value = 0.55
			const gain = ctx.createGain()
			const t = ctx.currentTime
			gain.gain.setValueAtTime(0, t)
			gain.gain.linearRampToValueAtTime(0.38, t + 0.06)
			gain.gain.setValueAtTime(0.38, t + 0.42)
			gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65)
			noise.connect(hpf); hpf.connect(bpf); bpf.connect(gain); gain.connect(ctx.destination)
			noise.start(t); noise.stop(t + 0.65)
			noise.onended = () => ctx.close()
		} catch { /* ignore */ }
	}

	function getWater (coolerGroup) {
		if (!myUserId) return
		const g = avatarGroups.get(myUserId)
		const isRefill = !!g?.children.find(c => c.userData.isCoffeeCup)
		// Animate the cold button — brief press inward then return
		let coldBtnRef = null
		coolerGroup.traverse(c => { if (c.userData.waterCoolerColdBtn) coldBtnRef = c })
		if (coldBtnRef) {
			const origZ = coldBtnRef.position.z
			gsap.to(coldBtnRef.position, {
				z: origZ - 0.018, duration: 0.12, ease: 'power1.in',
				onComplete: () => gsap.to(coldBtnRef.position, { z: origZ, duration: 0.25, ease: 'power1.out' }),
			})
		}
		playWaterDispense()
		const _waterCfg = parseAvatarConfig(avatarStore.avatarUrl)
		if (_waterCfg?.yetiMug) attachYetiMugTo(g, 'water')
		else attachWaterGlassTo(g)
		officeStore.setMyAvatarState({ holding: 'water', heldAt: Date.now() })
		// Clear coffee timer if replacing coffee with water
		clearTimeout(coffeeExpireTimer); coffeeExpireTimer = null
		// 1-hour expiry
		clearTimeout(waterExpireTimer)
		waterExpireTimer = setTimeout(() => {
			removeWaterGlass()
			officeStore.setMyAvatarState({ holding: null, heldAt: null })
			window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: '💧 Water finished!', type: 'info' } }))
		}, 60 * 60 * 1000)
		const msg = isRefill ? '💧 Water refilled!' : '💧 Enjoy your water!'
		window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message: msg, type: 'success' } }))
	}

	function claimSeat (roomId, seatId) {
		const room = getRoomById(roomId)
		if (!room) return
		const isOfficeDesk =
			room.type === "office" && seatId === `${roomId}:desk`

		// Reject if taken by someone else who is still online (named seats + office desk)
		const takenBy = presenceStore.users.find(
			(u) =>
				u.seatId === seatId &&
				String(u.id) !== String(presenceStore.myUserId) &&
				u.status !== "offline",
		)
		if (takenBy) {
			playBuzz()
			window.dispatchEvent(
				new CustomEvent("ava-toast", {
					detail: {
						message: `${takenBy.name || "Someone"} is sitting there`,
						type: "warn",
					},
				}),
			)
			// Clear stale seat state so syncLocalAvatarFromPresence stops re-seating
			// the local avatar here, and so the avatar stands up visually.
			officeStore.setCurrentSeat(null)
			presenceStore.setMySeatId(null)
			try { sessionStorage.removeItem('ava_last_seat') } catch { /* ignore */ }
			if (myUserId) {
				const g = avatarGroups.get(myUserId)
				if (g) { g.userData.seatY = 0; g.userData.lastSeatId = null }
			}
			return
		}

		// Office desk is not in `room.seats` — handle here so reload / deep-link cannot
		// bypass the occupancy check (claimSeat used to return early with no takenBy test).
		if (isOfficeDesk) {
			playFwoop("down")
			officeStore.setCurrentSeat(seatId)
			presenceStore.setMySeatId(seatId)
			if (myUserId) {
				const g = avatarGroups.get(myUserId)
				if (g) {
					const [rx, rz] = room.pos
					const backSign = room.row === "north" ? -1 : 1
					g.userData.seatY = -0.2
					gsap.killTweensOf(g.rotation)
					g.rotation.y = occupantDeskFacingY(room)
					// Sync store now so presence reconciliation does not re-apply stale
					// `me.rotation` before this tween's onComplete (lobby / seat lag).
					officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
					gsap.to(g.position, {
						x: rx,
						z: rz + backSign * 0.5,
						duration: 0.6,
						ease: "power2.inOut",
						onComplete: () => {
							const gg = avatarGroups.get(myUserId)
							if (gg) {
								officeStore.setMyPose(
									gg.position.x,
									gg.position.z,
									gg.rotation.y,
								)
							}
						},
					})
				}
			}
			camTween?.kill()
			const occPos = new THREE.Vector3(...room.camPos)
			const occLook = new THREE.Vector3(...room.camTarget)
			const tl = gsap.timeline()
			tl.to(
				camera.position,
				{
					x: occPos.x,
					y: occPos.y,
					z: occPos.z,
					duration: 0.8,
					ease: "power2.inOut",
				},
				0,
			)
			tl.to(
				cameraLookAt,
				{
					x: occLook.x,
					y: occLook.y,
					z: occLook.z,
					duration: 0.8,
					ease: "power2.inOut",
					onUpdate: () => camera.lookAt(cameraLookAt),
				},
				0,
			)
			camTween = tl
			return
		}

		const seat = room.seats?.find((s) => s.seatId === seatId)
		if (!seat) return

		const cam = computeSeatCamera(room, seat)
		playFwoop("down")
		officeStore.setCurrentSeat(seatId)
		presenceStore.setMySeatId(seatId)

		if (myUserId) {
			const g = avatarGroups.get(myUserId)
			if (g) {
				g.userData.seatY = namedSeatSitY(seat, seatId)
				gsap.killTweensOf(g.rotation)
				g.rotation.y = cam.avatarRot
				officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
				gsap.to(g.position, {
					x: cam.avatarPos[0],
					z: cam.avatarPos[1],
					duration: 0.6,
					ease: "power2.inOut",
					onComplete: () => {
						const gg = avatarGroups.get(myUserId)
						if (gg) {
							officeStore.setMyPose(
								gg.position.x,
								gg.position.z,
								gg.rotation.y,
							)
						}
					},
				})
			}
		}

		camTween?.kill()
		const tl = gsap.timeline()
		tl.to(
			camera.position,
			{
				x: cam.camPos[0],
				y: cam.camPos[1],
				z: cam.camPos[2],
				duration: 0.8,
				ease: "power2.inOut",
			},
			0,
		)
		tl.to(
			cameraLookAt,
			{
				x: cam.camTarget[0],
				y: cam.camTarget[1],
				z: cam.camTarget[2],
				duration: 0.8,
				ease: "power2.inOut",
				onUpdate: () => camera.lookAt(cameraLookAt),
			},
			0,
		)
		camTween = tl
	}

	/**
	 * When presence shows two users on the same `office-N:desk` after reload, the loser
	 * (see `shouldYieldDuplicateOfficeDesk`) stands up as a visitor and clears the seat
	 * so heartbeats stop fighting over one chair.
	 */
	function yieldDuplicateOfficeDeskToVisitor () {
		const rid = officeStore.currentRoomId
		if (!/^office-\d+$/.test(rid || "")) return
		const deskSeat = `${rid}:desk`
		if (officeStore.currentSeatId !== deskSeat) return
		const myId = presenceStore.myUserId
		if (!myId) return
		if (!shouldYieldDuplicateOfficeDesk(String(myId), presenceStore.users)) return

		const room = getRoomById(rid)
		if (!room) return

		playFwoop("up")
		officeStore.setCurrentSeat(null)
		presenceStore.setMySeatId(null)
		officeStore.setIsVisitingOffice(true)
		try {
			sessionStorage.removeItem("ava_last_seat")
		} catch { /* ignore */ }

		const g = avatarGroups.get(myUserId)
		if (g) {
			g.userData.seatY = 0
			g.userData.lastSeatId = null
			const [rx, rz] = room.pos
			const doorSign = room.row === "north" ? 1 : -1
			g.rotation.y = room.row === "north" ? Math.PI : 0
			gsap.to(g.position, {
				x: rx,
				y: 0,
				z: rz + doorSign * 2.0,
				duration: 0.8,
				ease: "power2.inOut",
			})
		}

		const targetPos = new THREE.Vector3(
			...(room.visitCamPos || room.camPos),
		)
		const targetLookAt = new THREE.Vector3(
			...(room.visitCamTarget || room.camTarget),
		)
		camTween?.kill()
		const tl = gsap.timeline({
			onComplete: () => {
				const g2 = avatarGroups.get(myUserId)
				if (g2) {
					officeStore.setMyPose(
						g2.position.x,
						g2.position.z,
						g2.rotation.y,
					)
				}
			},
		})
		tl.to(
			camera.position,
			{
				x: targetPos.x,
				y: targetPos.y,
				z: targetPos.z,
				duration: 1.0,
				ease: "power2.inOut",
			},
			0,
		)
		tl.to(
			cameraLookAt,
			{
				x: targetLookAt.x,
				y: targetLookAt.y,
				z: targetLookAt.z,
				duration: 1.0,
				ease: "power2.inOut",
				onUpdate: () => camera.lookAt(cameraLookAt),
			},
			0,
		)
		camTween = tl

		window.dispatchEvent(
			new CustomEvent("ava-toast", {
				detail: {
					message: "Someone else is already at this desk — visiting instead.",
					type: "info",
				},
			}),
		)
	}

	function removeAvatar (userId) {
		const g = avatarGroups.get(userId)
		if (g) {
			// Explicitly evict CSS2D label DOM nodes — CSS2DRenderer only hides them lazily
			// (display:none), so a stale node lingers when a new avatar with the same name
			// is added in the same frame, causing duplicate visible labels.
			g.traverse((child) => {
				if (
					child.element instanceof HTMLElement &&
					child.element.parentNode
				) {
					child.element.parentNode.removeChild(child.element)
				}
				// Release GPU memory — otherwise VRAM leaks as avatars come and go.
				// Skip shared materials flagged as such in userData.
				if (child.isMesh) {
					child.geometry?.dispose()
					const mat = child.material
					if (mat && !mat.userData?.shared) {
						if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
						else mat.dispose()
					}
				}
			})
			scene.remove(g)
			avatarGroups.delete(userId)
		}
		avatarMixers.delete(userId)
		talkingRings.delete(userId)
	}

	// ── Talking ring (driven by talkingPeers from useProximityVoice) ─
	const talkingRings = new Map() // userId → ring mesh

	function setAvatarTalking (userId, active) {
		const g = avatarGroups.get(userId)
		if (!g) return
		let ring = null
		g.traverse((c) => {
			if (c.isMesh && c.userData.isStatusRing) ring = c
		})
		if (!ring) return
		if (active) {
			if (ring.userData._origEmissive === undefined) {
				ring.userData._origEmissive = ring.material.emissive.getHex()
				ring.userData._origIntensity = ring.material.emissiveIntensity
			}
			ring.material.emissive.set(0x00e676)
			ring.material.emissiveIntensity = 2.5
			talkingRings.set(userId, ring)
		} else {
			if (ring.userData._origEmissive !== undefined) {
				ring.material.emissive.setHex(ring.userData._origEmissive)
				ring.material.emissiveIntensity = ring.userData._origIntensity
			}
			ring.scale.set(1, 1, 1)
			talkingRings.delete(userId)
		}
	}

	// Deterministic arrival spot when no explicit click point is provided
	// (sidebar nav, room-name / door label clicks, programmatic navigateTo).
	// Prefers just inside the door that connects back to `fromRoomId` — matches
	// the auto-door-cross arrival on the other side — so navigation always lands
	// near a visible entry rather than a random seat.  Falls back to room center.
	function _entryArrivalPos (destRoom, fromRoomId) {
		if (!destRoom) return null
		const insetFor = (door) => {
			const tw = door.triggerSide || door.wall
			const rdp = doorWorldXZ(destRoom, { ...door, wall: tw })
			const inset = 3.2  // ≥ camera back-dist (2.8) + padding so camera stays inside room
			if (tw === 'north') return { x: rdp.x, z: rdp.z + inset }
			if (tw === 'south') return { x: rdp.x, z: rdp.z - inset }
			if (tw === 'west') return { x: rdp.x + inset, z: rdp.z }
			if (tw === 'east') return { x: rdp.x - inset, z: rdp.z }
			return null
		}
		const direct = destRoom.doors?.find((d) => d.toRoom === fromRoomId)
		if (direct) {
			const p = insetFor(direct)
			if (p) return p
		}
		const anyNav = destRoom.doors?.find((d) => d.toRoom)
		if (anyNav) {
			const p = insetFor(anyNav)
			if (p) return p
		}
		const [rx, rz] = destRoom.pos
		return { x: rx, z: rz }
	}

	// Returns a standing position that is at least minDist units from every
	// existing avatar (excluding the one being placed).  Tries up to MAX_TRIES
	// random candidates; if none are clear it returns the last candidate anyway
	// so a crowded room degrades gracefully rather than locking up.
	function clearRoomPos (room, excludeId, minDist = 1.0) {
		const MAX_TRIES = 14
		let candidate
		for (let i = 0; i < MAX_TRIES; i++) {
			candidate = randomRoomPos(room)
			let clear = true
			for (const [id, g] of avatarGroups) {
				if (id === excludeId) continue
				const dx = g.position.x - candidate.x
				const dz = g.position.z - candidate.z
				if (dx * dx + dz * dz < minDist * minDist) { clear = false; break }
			}
			if (clear) return candidate
		}
		return candidate // crowded room — best effort
	}

	// Nudge (x, z) away from any peer avatar closer than minDist.
	// roomCenter biases tries toward the room interior so a sideways nudge
	// pushes deeper into the room rather than alongside the door wall.
	// Checks both rendered g.position AND presenceStore saved posX/posZ so that
	// peers mid-tween (or not yet tweened) on reload are still detected.
	function _avoidPeers (x, z, excludeId, minDist = 1.2, roomCenter = null, roomId = null) {
		const isClear = (cx, cz) => {
			for (const [id, g] of avatarGroups) {
				if (id === excludeId) continue
				// Prefer tween destination over current render position —
				// on reload peers are mid-tween and g.position is pre-tween.
				const px = g.userData.targetPosX ?? g.position.x
				const pz = g.userData.targetPosZ ?? g.position.z
				const dx = px - cx
				const dz = pz - cz
				if (dx * dx + dz * dz < minDist * minDist) return false
			}
			// Also check saved DB positions — covers peers not yet spawned in the engine
			for (const u of presenceStore.users) {
				if (String(u.id) === String(excludeId)) continue
				if (roomId && u.roomId !== roomId) continue
				if (u.posX == null || u.posZ == null) continue
				const dx = u.posX - cx
				const dz = u.posZ - cz
				if (dx * dx + dz * dz < minDist * minDist) return false
			}
			return true
		}
		if (isClear(x, z)) return { x, z }
		const baseAngle = roomCenter
			? Math.atan2(roomCenter.z - z, roomCenter.x - x)
			: 0
		for (let t = 0; t < 8; t++) {
			const angle = baseAngle + (t / 8) * Math.PI * 2
			const nx = x + Math.cos(angle) * minDist
			const nz = z + Math.sin(angle) * minDist
			if (isClear(nx, nz)) return { x: nx, z: nz }
		}
		const fallback = baseAngle + (Math.random() - 0.5) * Math.PI
		return { x: x + Math.cos(fallback) * minDist * 1.5, z: z + Math.sin(fallback) * minDist * 1.5 }
	}

	function _walkAvatarTo (g, x, z, afterWalk = null) {
		if (officeStore.currentSeatId) {
			playFwoop('up')
			officeStore.setCurrentSeat(null)
			presenceStore.setMySeatId(null)
			g.userData.seatY = 0
		}
		g.userData.lastSeatId = null
		const dest = { x, z }
		for (const [pid, peer] of avatarGroups) {
			if (pid === myUserId) continue
			const ddx = dest.x - peer.position.x
			const ddz = dest.z - peer.position.z
			const ddist = Math.hypot(ddx, ddz)
			if (ddist > 0 && ddist < 1.0) {
				const scale = 1.0 / ddist
				dest.x = peer.position.x + ddx * scale
				dest.z = peer.position.z + ddz * scale
			}
		}
		const dx = dest.x - g.position.x
		const dz = dest.z - g.position.z
		if (Math.hypot(dx, dz) > 0.05) g.rotation.y = Math.atan2(dx, dz)

		// Soft camera follow — only for the local avatar, and only when a room transition
		// isn't in progress (navigateTo has its own camera tween and we mustn't fight it).
		// Translate camera + lookAt by the same xz delta as the walk so framing is
		// preserved; avatar stays in the same spot on-screen instead of drifting off.
		const isLocal = !!(myUserId && avatarGroups.get(myUserId) === g)
		const followCam = isLocal && !isTransitioning.value
		if (followCam) {
			// Aim camera to behind-avatar at the destination (using the avatar's new
			// heading) so WASD starting after the walk sees zero discrepancy.
			const _rot = g.rotation.y
			const _sin = Math.sin(_rot), _cos = Math.cos(_rot)
			const behindX = dest.x - _sin * 2.8
			const behindZ = dest.z - _cos * 2.8
			camTween?.kill()
			camTween = gsap.timeline()
			camTween.to(camera.position, {
				x: behindX, y: 1.8, z: behindZ,
				duration: 0.5, ease: 'power2.inOut',
			}, 0)
			camTween.to(cameraLookAt, {
				x: dest.x + _sin * 2.0, y: 1.55, z: dest.z + _cos * 2.0,
				duration: 0.5, ease: 'power2.inOut',
				onUpdate: () => camera.lookAt(cameraLookAt),
			}, 0)
		}

		gsap.to(g.position, {
			x: dest.x, y: 0, z: dest.z,
			duration: 0.5, ease: 'power2.inOut',
			onComplete: () => {
				_localMoveEndedAt = Date.now()
				officeStore.setMyPose(dest.x, dest.z, g.rotation.y)
				afterWalk?.()
			},
		})
	}

	function randomRoomPos (room) {
		if (!room) return new THREE.Vector3(0, 0, 5)
		const [rx, rz] = room.pos

		// Keep spawns far enough from every wall that the follow camera
		// (_aimCameraAtPos places it ~2.8 m behind the avatar) stays inside the room.
		const CAM_DEPTH = 2.8
		const WALL_PAD = 0.3
		const maxX = room.size[0] / 2 - CAM_DEPTH - WALL_PAD
		const maxZ = room.size[1] / 2 - CAM_DEPTH - WALL_PAD

		if (room.seats?.length) {
			// Pick a random seat, then push 1.5–2 m further away from its focal point
			// (the table / opposing sofa) so standing avatars land behind the chairs,
			// not on top of them.
			const seat =
				room.seats[Math.floor(Math.random() * room.seats.length)]
			const [sx, , sz] = seat.pos
			const focal = seat.focal || room.focalPoint || [0, 0, 0]
			const dx = sx - focal[0]
			const dz = sz - focal[2]
			const len = Math.sqrt(dx * dx + dz * dz) || 1
			const push = 1.5 + Math.random() * 0.5
			const rawX = sx + (dx / len) * push + (Math.random() - 0.5) * 0.4
			const rawZ = sz + (dz / len) * push + (Math.random() - 0.5) * 0.4
			return new THREE.Vector3(
				rx + Math.max(-maxX, Math.min(maxX, rawX)),
				0,
				rz + Math.max(-maxZ, Math.min(maxZ, rawZ)),
			)
		}

		const w = Math.min(room.size[0] * 0.3, maxX * 2)
		const d = Math.min(room.size[1] * 0.3, maxZ * 2)
		return new THREE.Vector3(
			rx + (Math.random() - 0.5) * w,
			0,
			rz + (Math.random() - 0.5) * d,
		)
	}

	function statusColorForUser (u) {
		const map = {
			online: "#00c853",
			away: "#ff6d00",
			busy: "#f44336",
			offline: "#4d6080",
		}
		return map[u.status] || map.offline
	}

	// ── Load RPM GLTF avatar ─────────────────────────────────────────
	function loadGLTFAvatar (userId, gltfUrl) {
		// Stamp a sequence token for this URL so that if a second loadGLTFAvatar
		// call fires for the SAME URL (re-keying race: called once with authUserId,
		// once with listItemId) only the latest callback is honoured — the stale
		// first one discards its result instead of adding a duplicate to the scene.
		const token = (gltfLoadTokens.get(gltfUrl) || 0) + 1
		gltfLoadTokens.set(gltfUrl, token)

		gltfLoader.load(
			gltfUrl,
			(gltf) => {
				// Discard if a newer load for the same URL has since been requested.
				if (gltfLoadTokens.get(gltfUrl) !== token) return

				// The avatar may have been re-keyed (authUserId → listItemId) while
				// the async load was in flight.  Scan by group name so we find and
				// replace the blocky placeholder regardless of its current Map key,
				// avoiding a ghost duplicate when the two IDs differ.
				let resolvedKey = userId
				for (const [key, grp] of avatarGroups) {
					if (grp.name === `avatar-${userId}`) {
						resolvedKey = key
						break
					}
				}
				// Second fallback: if the name scan didn't match (a concurrent load
				// already replaced the group's name) and this looks like a local-user
				// load that was started under the old authUserId, use the current
				// engine myUserId as the authoritative key.
				if (resolvedKey === userId && myUserId && myUserId !== userId && avatarGroups.has(myUserId)) {
					resolvedKey = myUserId
				}

				// Remove stale entries: the resolved key and the original userId key
				// (may differ when re-keying happened mid-load).
				if (avatarGroups.has(resolvedKey)) removeAvatar(resolvedKey)
				if (resolvedKey !== userId && avatarGroups.has(userId)) removeAvatar(userId)

				const model = gltf.scene
				model.traverse((c) => {
					if (c.isMesh) {
						c.castShadow = true
						c.receiveShadow = true
					}
				})
				model.scale.set(1, 1, 1)

				const g = new THREE.Group()
				g.name = `avatar-${resolvedKey}`
				g.add(model)

				const room =
					presenceStore.users.find((u) => u.id === resolvedKey)?.roomId ||
					presenceStore.users.find((u) => u.id === userId)?.roomId ||
					"lobby"
				g.position.copy(randomRoomPos(getRoomById(room)))
				scene.add(g)
				avatarGroups.set(resolvedKey, g)

				// Animate
				if (gltf.animations?.length) {
					const mixer = new THREE.AnimationMixer(model)
					avatarMixers.set(resolvedKey, mixer)
					const idle =
						gltf.animations.find((a) => /idle/i.test(a.name)) ||
						gltf.animations[0]
					if (idle) mixer.clipAction(idle).play()
				}
			},
			undefined,
			(err) => console.warn("[avatar] GLTF load failed:", err),
		)
	}

	// ── Door control ─────────────────────────────────────────────────
	function _animateDoorPivot (door, open) {
		door.isOpen = open
		const targetY = open
			? door.initialRotationY + door.openSign * Math.PI * 0.48
			: door.initialRotationY
		gsap.to(door.pivot.rotation, { y: targetY, duration: 0.55, ease: 'power2.out' })
	}

	/**
	 * Check whether a room has any LOCKED door (must knock to enter).
	 * Reads from the authoritative Supabase door_states via usePresence.
	 */
	// Set by ava-knock-admitted to allow one navigateTo past the lock check.
	let _bypassLockRoom = null
	window.addEventListener('ava-knock-admitted', (e) => {
		_bypassLockRoom = e.detail.roomId
		navigateTo(e.detail.roomId)
	})

	function _isDestRoomLocked (roomId) {
		return isRoomLocked(roomId)
	}

	function setDoorOpen (roomId, wall, open, { silent = false } = {}) {
		setDoorOpenByKey(`${roomId}-${wall}`, open, { silent })
	}

	// WHY: addDoor disambiguates multiple doors on the same wall with a `-N`
	// suffix (e.g. `main-hall-south`, `main-hall-south-1`, ...). Callers that
	// already know the exact pivot they want (e.g. the door-click handler that
	// just iterated doorPivots) must pass the full key here, not roomId+wall —
	// otherwise they would silently target the first door on that wall, which
	// for main-hall meant clicking meeting-a's panel toggled the conference door.
	function setDoorOpenByKey (key, open, { silent = false } = {}) {
		const door = doorPivots.get(key)
		if (!door || door.isOpen === open) return

		_animateDoorPivot(door, open)

		// Animate the matching panel on the other side of the same physical doorway
		if (door.partner) {
			const partnerDoor = doorPivots.get(door.partner)
			if (partnerDoor && partnerDoor.isOpen !== open) _animateDoorPivot(partnerDoor, open)
		}

		if (!silent) {
			if (open) audio.playDoorOpen()
			else audio.playDoorClose()
		}
	}

	/**
	 * Reconcile all door pivots to match the authoritative door_states Map.
	 * Called by usePresence after each Supabase realtime push.
	 * If a door has no state row but its partner does, inherit the partner's state
	 * (both sides of a shared wall are the same physical door).
	 * @param {Map<string, { isOpen: boolean, isLocked: boolean }>} statesMap
	 */
	function syncDoorStates (statesMap) {
		for (const [key, door] of doorPivots) {
			const state = statesMap.get(key)
				|| (door.partner ? statesMap.get(door.partner) : null)
			const shouldBeOpen = state ? state.isOpen : true
			door.isLocked = state ? state.isLocked : false
			if (door.isOpen === shouldBeOpen) continue
			_animateDoorPivot(door, shouldBeOpen)
		}
	}

	/** Write a door state AND its partner (if any) to Supabase, then broadcast via WS. */
	function _writeDoorState (doorKey, isOpen, isLocked) {
		const rtSocket = useRealtimeSocket()
		// Write to Supabase with user's auth context (RPCs need auth.uid())
		DoorStateRepo.setDoorState(doorKey, isOpen, isLocked).then(() => {
			// Broadcast to peers via WS (replaces Supabase Realtime subscription)
			rtSocket.emit('door', { doorId: doorKey, isOpen, isLocked })
		}).catch(e => console.warn('[engine] setDoorState failed:', e.message))
		const door = doorPivots.get(doorKey)
		if (door?.partner) {
			DoorStateRepo.setDoorState(door.partner, isOpen, isLocked).then(() => {
				rtSocket.emit('door', { doorId: door.partner, isOpen, isLocked })
			}).catch(e => console.warn('[engine] setDoorState (partner) failed:', e.message))
		}
	}

	// ── Camera navigation ────────────────────────────────────────────
	// ── Singlechat camera ────────────────────────────────────────────
	// Positions camera over my avatar's shoulder looking toward the target's face.
	// Called after navigation completes (or immediately if already same room).
	function applySinglechatCamera (targetUser) {
		if (!myUserId) return
		const myGroup = avatarGroups.get(myUserId)
		const targetGroup = avatarGroups.get(String(targetUser.id))
		if (!myGroup || !targetGroup) return

		const myPos = new THREE.Vector3(
			myGroup.position.x,
			0,
			myGroup.position.z,
		)
		const targetFacePos = new THREE.Vector3(
			targetGroup.position.x,
			1.6,
			targetGroup.position.z,
		)

		// Horizontal direction from me toward target
		const dir = new THREE.Vector3(
			targetFacePos.x - myPos.x,
			0,
			targetFacePos.z - myPos.z,
		).normalize()
		// Perpendicular right hand
		const right = new THREE.Vector3(-dir.z, 0, dir.x)

		// Turn my avatar to face them, and their avatar to face me
		myGroup.rotation.y = Math.atan2(dir.x, dir.z)
		targetGroup.rotation.y = Math.atan2(-dir.x, -dir.z)

		// Camera: step back behind my avatar, offset slightly right, high enough
		// to clear both avatar heads and frame the conversation as a two-shot.
		const camPos = new THREE.Vector3(
			myPos.x - dir.x * 3.2 + right.x * 0.3,
			2.2,
			myPos.z - dir.z * 3.2 + right.z * 0.3,
		)

		// Look at the midpoint between both faces so both are framed in shot.
		const myFacePos = new THREE.Vector3(myPos.x, 1.6, myPos.z)
		const lookTarget = new THREE.Vector3(
			(myFacePos.x + targetFacePos.x) * 0.5,
			(myFacePos.y + targetFacePos.y) * 0.5,
			(myFacePos.z + targetFacePos.z) * 0.5,
		)

		camTween?.kill()
		const tl = gsap.timeline()
		tl.to(
			camera.position,
			{
				x: camPos.x,
				y: camPos.y,
				z: camPos.z,
				duration: 0.7,
				ease: "power2.inOut",
			},
			0,
		)
		tl.to(
			cameraLookAt,
			{
				x: lookTarget.x,
				y: lookTarget.y,
				z: lookTarget.z,
				duration: 0.7,
				ease: "power2.inOut",
				onUpdate: () => camera.lookAt(cameraLookAt),
			},
			0,
		)
		camTween = tl
	}

	// Navigate to target user's room (as visitor) then apply shoulder camera.
	// If already in the same room, just orient immediately.
	function visitUser (targetUser) {
		if (!targetUser?.id) return
		const targetRoomId = targetUser.roomId || "lobby"
		officeStore.startSinglechat(String(targetUser.id))

		if (targetRoomId === currentRoom.value) {
			applySinglechatCamera(targetUser)
		} else {
			navigateTo(targetRoomId, {
				forceVisit: true,
				singlechatTarget: targetUser,
			})
		}
	}

	async function navigateTo (
		roomId,
		{ forceVisit = false, seatId = null, singlechatTarget = null, arrivalPos = null, arrivalRot = null, bypassLock = false, skipLandingPoseSave = false } = {},
	) {
		if (isTransitioning.value) return
		if (roomId === currentRoom.value) return
		const room = getRoomById(roomId)
		if (!room) return

		// ── Block entry to locked (all-doors-closed) rooms ──────────
		if (_isDestRoomLocked(roomId) && _bypassLockRoom !== roomId && !bypassLock) {
			window.dispatchEvent(new CustomEvent('ava-room-blocked', { detail: { roomId } }))
			return
		}
		_bypassLockRoom = null

		// Warn before leaving with live mic; mute them if they confirm
		if (localMicActive.value) {
			const go = await avaConfirm({
				title: 'Leave room?',
				message: 'Your voice is active - you will be muted if you leave.',
				confirmLabel: 'Leave / mute',
				cancelLabel: 'Stay / talk',
			})
			if (!go) return
			muteLocal()
		}

		// Clear seat when leaving the seated room
		if (officeStore.currentSeatId) {
			const seatedRoomId = officeStore.currentSeatId.split(":")[0]
			if (seatedRoomId !== roomId) {
				officeStore.setCurrentSeat(null)
				presenceStore.setMySeatId(null)
				if (myUserId) {
					const g = avatarGroups.get(myUserId)
					if (g) g.userData.seatY = 0
				}
			}
		}

		// If navigating from overhead, sync store to POV immediately.
		// The camera tween below already moves to the POV position, so we only
		// need to update the store — no need to call setOverhead(false).
		if (officeStore.viewMode === "overhead") officeStore.toggleViewMode()

		isTransitioning.value = true
		// Reveal destination room (and its connections) immediately so it appears
		// during the fly-over; source room stays visible until onComplete.
		const destRoomDef = getRoomById(roomId)
		for (const id of [roomId, ...(destRoomDef?.connections || [])]) {
			const g = roomGroups.get(id)
			if (g) g.visible = true
		}
		officeStore.setPendingRoom(roomId)
		officeStore.setTransitioning(true)
		audio.playTransition()

		// Open relevant doors — but NOT if the destination room is fully closed
		// (private). The voice composable will handle the knock flow.
		const destClosed = _isDestRoomLocked(roomId)

		const prevRoom = getRoomById(currentRoom.value)
		if (prevRoom && !destClosed) {
			const connectingWall = findConnectingWall(prevRoom, room)
			if (connectingWall) setDoorOpen(prevRoom.id, connectingWall, true)
		}

		// Also open the destination door (unless locked)
		if (room.doors?.[0] && !destClosed) {
			setDoorOpen(room.id, room.doors[0].wall, true)
		}

		// Use visitor camera when someone is physically present in an office (not just assigned)
		const isPhysicallyOccupied =
			room.type === "office" &&
			presenceStore.users.some(
				(u) =>
					u.roomId === roomId &&
					String(u.id) !== String(myUserId) &&
					u.status !== "offline",
			)
		let isVisit = forceVisit || isPhysicallyOccupied
		// Desk already claimed in presence (e.g. peer reloaded first) — arrive as visitor
		// instead of briefly sitting then fighting heartbeats.
		const deskSeat = `${roomId}:desk`
		if (
			room.type === "office" &&
			seatId === deskSeat &&
			presenceStore.users.some(
				(u) =>
					u.seatId === deskSeat &&
					String(u.id) !== String(myUserId) &&
					u.status !== "offline",
			)
		) {
			isVisit = true
		}

		// For non-office rooms, pre-compute where the avatar will land so the camera
		// can fly directly there — guarantees the user is always in frame on arrival.
		let targetPos, targetLookAt
		const useArrival = arrivalPos && myUserId && !isVisit && room.type !== 'office'
		let landingPos = null   // pre-computed for standard (non-arrivalPos) nav

		const _aimCameraAtPos = (px, pz) => {
			const [rx, rz] = room.pos
			const rot = Math.atan2(rx - px, rz - pz)
			targetPos = new THREE.Vector3(px - Math.sin(rot) * 2.8, 1.8, pz - Math.cos(rot) * 2.8)
			targetLookAt = new THREE.Vector3(px + Math.sin(rot) * 2.0, 1.55, pz + Math.cos(rot) * 2.0)
			return rot
		}

		if (useArrival) {
			if (arrivalRot !== null) {
				// WASD arrival: keep the avatar's walking heading; aim camera directly behind it
				targetPos = new THREE.Vector3(arrivalPos.x - Math.sin(arrivalRot) * 2.8, 1.8, arrivalPos.z - Math.cos(arrivalRot) * 2.8)
				targetLookAt = new THREE.Vector3(arrivalPos.x + Math.sin(arrivalRot) * 2.0, 1.55, arrivalPos.z + Math.cos(arrivalRot) * 2.0)
			} else {
				_aimCameraAtPos(arrivalPos.x, arrivalPos.z)
			}
			const g = avatarGroups.get(myUserId)
			if (g) {
				g.userData.seatY = 0
				if (arrivalRot !== null) g.rotation.y = arrivalRot
				gsap.to(g.position, { x: arrivalPos.x, y: 0, z: arrivalPos.z, duration: 0.8, ease: 'power2.inOut' })
			}
		} else if (myUserId && !isVisit && room.type !== 'office') {
			// Standard nav (sidebar, room-name / door label click, etc.) — no explicit
			// click point, so land just inside the door that connects back to the
			// previous room.  Avoids the old random-seat placement that made the
			// avatar appear to teleport to a different spot than what was clicked.
			landingPos = _entryArrivalPos(room, currentRoom.value) || clearRoomPos(room, myUserId)
			const [_rcx, _rcz] = room.pos
			landingPos = _avoidPeers(landingPos.x, landingPos.z, myUserId, 1.2, { x: _rcx, z: _rcz }, room.id)
			const rot = _aimCameraAtPos(landingPos.x, landingPos.z)
			const g = avatarGroups.get(myUserId)
			if (g) {
				g.userData.seatY = 0
				g.rotation.y = rot
				g.userData.lastRoomId = roomId
				g.userData.lastSeatId = null
				gsap.to(g.position, { x: landingPos.x, y: 0, z: landingPos.z, duration: 0.8, ease: 'power2.inOut' })
			}
		} else {
			targetPos = new THREE.Vector3(
				...(isVisit && room.visitCamPos ? room.visitCamPos : room.camPos),
			)
			targetLookAt = new THREE.Vector3(
				...(isVisit && room.visitCamTarget ? room.visitCamTarget : room.camTarget),
			)
		}
		camTween?.kill()
		const tl = gsap.timeline({
			onComplete: () => {
				_localMoveEndedAt = Date.now()
				currentRoom.value = roomId
				isTransitioning.value = false
				officeStore.setCurrentRoom(roomId)
				officeStore.setPendingRoom(null)
				officeStore.setTransitioning(false)
				// Track whether current user is an occupant or visitor in this office
				officeStore.setIsVisitingOffice(
					room.type === "office" ? isVisit : false,
				)
				// Immediately reflect new room in presenceStore so office labels update without waiting for heartbeat
				presenceStore.updateMyRoom(roomId)
				// Office visitors must not claim the occupant desk (session can still carry :desk).
				if (seatId && !(room.type === "office" && isVisit))
					claimSeat(roomId, seatId)
				// Avatar was pre-positioned before the camera tween — persist final coords.
				// skipLandingPoseSave: reload nav must not overwrite the user's walked position.
				if ((useArrival || landingPos) && myUserId && !seatId && !skipLandingPoseSave) {
					const g = avatarGroups.get(myUserId)
					if (g) officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
				}
				// Own-office navigation: avatar rotation was set in pre-tween (occupantDeskFacingY)
				// but setCurrentRoom above resets hasLocalPose. Re-establish it so DB reconciliation
				// doesn't overwrite the fresh heading with a stale saved rotation.
				if (room.type === "office" && !isVisit && !seatId && myUserId) {
					const g = avatarGroups.get(myUserId)
					if (g) officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
				}
				// Singlechat: apply shoulder camera after we've arrived
				if (singlechatTarget) applySinglechatCamera(singlechatTarget)
				// Cull rooms now out of view
				_applyRoomCulling(roomId)
			},
		})

		tl.to(
			camera.position,
			{
				x: targetPos.x,
				y: targetPos.y,
				z: targetPos.z,
				duration: 1.8,
				ease: "power3.inOut",
			},
			0,
		)
		tl.to(
			cameraLookAt,
			{
				x: targetLookAt.x,
				y: targetLookAt.y,
				z: targetLookAt.z,
				duration: 1.8,
				ease: "power3.inOut",
				onUpdate: () => camera.lookAt(cameraLookAt),
			},
			0,
		)
		camTween = tl

		// Move my avatar — sit at desk for office rooms, random otherwise
		if (myUserId) {
			const g = avatarGroups.get(myUserId)
			if (g) {
				if (room.type === "office") {
					const [rx, rz] = room.pos
					if (isVisit) {
						// Visiting: stand near the door facing the occupant
						const doorSign = room.row === "north" ? 1 : -1
						g.rotation.y = room.row === "north" ? Math.PI : 0
						gsap.to(g.position, {
							x: rx,
							y: 0,
							z: rz + doorSign * 2.0,
							duration: 0.8,
							ease: "power2.inOut",
						})
					} else {
						// Own office: sit behind chair at desk, facing the door
						const backSign = room.row === "north" ? -1 : 1
						gsap.killTweensOf(g.rotation)
						g.rotation.y = occupantDeskFacingY(room)
						g.userData.seatY = -0.2
						officeStore.setCurrentSeat(roomId + ":desk")
						presenceStore.setMySeatId(roomId + ":desk")
						// Establish hasLocalPose immediately so DB reconciliation during the
						// 1.8s camera tween doesn't overwrite the fresh desk heading.
						officeStore.setMyPose(rx, rz + backSign * 0.5, g.rotation.y)
						gsap.to(g.position, {
							x: rx,
							z: rz + backSign * 0.5,
							duration: 0.8,
							ease: "power2.inOut",
						})
					}
				} else if (!useArrival && !landingPos) {
					g.userData.seatY = 0
					g.rotation.y = 0
					moveAvatarToRoom(myUserId, roomId)
				}
			}
		}
	}

	function findConnectingWall (fromRoom, toRoom) {
		for (const door of fromRoom.doors || []) {
			if (fromRoom.connections?.includes(toRoom.id)) return door.wall
		}
		return null
	}

	// ── Focus camera on own avatar ───────────────────────────────────
	// Shared logic for reset and overhead→POV exit.
	// • Named seat  (conference chair, sofa, etc.) → restore seat camera
	// • Standing or office desk (:desk)            → panCameraToAvatar
	// • Fallback (no avatar yet)                   → room default
	function _focusCameraOnSelf () {
		const seatId = officeStore.currentSeatId
		if (seatId && !seatId.endsWith(":desk")) {
			const room = getRoomById(currentRoom.value)
			const seat = room?.seats?.find((s) => s.seatId === seatId)
			if (seat) {
				const cam = computeSeatCamera(room, seat)
				camTween?.kill()
				const tl = gsap.timeline()
				tl.to(camera.position, { x: cam.camPos[0], y: cam.camPos[1], z: cam.camPos[2], duration: 1.0, ease: "power2.inOut" }, 0)
				tl.to(cameraLookAt, { x: cam.camTarget[0], y: cam.camTarget[1], z: cam.camTarget[2], duration: 1.0, ease: "power2.inOut", onUpdate: () => camera.lookAt(cameraLookAt) }, 0)
				camTween = tl
				return
			}
		}
		if (myUserId && avatarGroups.has(myUserId)) {
			panCameraToAvatar(myUserId)
			return
		}
		// Fallback — room default camera
		const room = getRoomById(currentRoom.value)
		if (!room) return
		camTween?.kill()
		const tl = gsap.timeline()
		tl.to(camera.position, { x: room.camPos[0], y: room.camPos[1], z: room.camPos[2], duration: 1.0, ease: "power2.inOut" }, 0)
		tl.to(cameraLookAt, { x: room.camTarget[0], y: room.camTarget[1], z: room.camTarget[2], duration: 1.0, ease: "power2.inOut", onUpdate: () => camera.lookAt(cameraLookAt) }, 0)
		camTween = tl
	}

	// ── Overhead view toggle ─────────────────────────────────────────
	function setOverhead (enable) {
		camTween?.kill()
		container.dataset.view = enable ? "overhead" : "pov"
		if (enable) {
			// Show entire floor plan for the overhead bird's-eye view
			_applyRoomCulling(currentRoom.value, true)
			const cx = (FLOOR_BOUNDS.minX + FLOOR_BOUNDS.maxX) / 2
			const cz = (FLOOR_BOUNDS.minZ + FLOOR_BOUNDS.maxZ) / 2
			const tl = gsap.timeline()
			tl.to(
				camera.position,
				{
					x: cx,
					y: 77,
					z: cz + 25,
					duration: 1.4,
					ease: "power2.inOut",
				},
				0,
			)
			tl.to(
				cameraLookAt,
				{
					x: cx,
					y: 0,
					z: cz + 7,
					duration: 1.4,
					ease: "power2.inOut",
					onUpdate: () => camera.lookAt(cameraLookAt),
				},
				0,
			)
		} else {
			// Restore culling for the current room, then return camera to player
			_applyRoomCulling(currentRoom.value)
			_focusCameraOnSelf()
		}
	}

	// ── Camera reset (pan to own avatar, or seat/room if applicable) ─
	function resetCamera () {
		if (officeStore.viewMode === "overhead") officeStore.toggleViewMode()
		container.dataset.view = "pov"
		_focusCameraOnSelf()
	}

	// ── Pan camera to a specific avatar ─────────────────────────────
	// Smoothly repositions the camera behind and above the given avatar,
	// looking in the direction the avatar faces. Used after page-reload to
	// ensure the user can always see themselves after position is restored.
	function panCameraToAvatar (userId) {
		const g = avatarGroups.get(userId)
		if (!g || isTransitioning.value) return
		const ax = g.position.x
		const az = g.position.z
		const rot = g.rotation.y

		const backDist = 2.8
		const camX = ax - Math.sin(rot) * backDist
		const camZ = az - Math.cos(rot) * backDist

		const lookDist = 2.0
		const lookX = ax + Math.sin(rot) * lookDist
		const lookZ = az + Math.cos(rot) * lookDist

		camTween?.kill()
		const tl = gsap.timeline()
		tl.to(camera.position, {
			x: camX, y: 1.8, z: camZ,
			duration: 1.0, ease: "power2.inOut",
		}, 0)
		tl.to(cameraLookAt, {
			x: lookX, y: 1.55, z: lookZ,
			duration: 1.0, ease: "power2.inOut",
			onUpdate: () => camera.lookAt(cameraLookAt),
		}, 0)
		camTween = tl
	}

	// Place the local user at (x, z, rot), nudging away from any overlapping peer,
	// save the final pose, then pan the camera to follow. Called by restorePoseAndFocus
	// after nav settles so collision detection runs against fully-placed peer avatars.
	function restoreMyPose (x, z, rot) {
		const g = myUserId ? avatarGroups.get(myUserId) : null
		if (!g) return
		const room = getRoomById(currentRoom.value)
		const [rcx, rcz] = room?.pos || [0, 0]
		const safe = _avoidPeers(x, z, myUserId, 1.2, { x: rcx, z: rcz }, currentRoom.value)
		gsap.killTweensOf(g.position)
		g.position.x = safe.x
		g.position.z = safe.z
		if (typeof rot === 'number' && !Number.isNaN(rot)) g.rotation.y = rot
		officeStore.setMyPose(safe.x, safe.z, g.rotation.y)
		panCameraToAvatar(myUserId)
	}

	// ── Raycasting / click nav ───────────────────────────────────────
	const raycaster = new THREE.Raycaster()
	const mouseNDC = new THREE.Vector2()

	async function onCanvasClick (e) {
		if (isTransitioning.value) return
		const rect = renderer.domElement.getBoundingClientRect()
		mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
		mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
		raycaster.setFromCamera(mouseNDC, camera)

		// ── Alt/Option+click → focus camera on clicked point ─────────
		if (e.altKey) {
			// In overhead: raycast all rooms so any visible surface works.
			// In POV: raycast current room only.
			const meshes = []
			if (officeStore.viewMode === 'overhead') {
				for (const group of roomGroups.values()) {
					group.traverse((c) => { if (c.isMesh) meshes.push(c) })
				}
			} else {
				const currentGroup = roomGroups.get(currentRoom.value)
				if (currentGroup) currentGroup.traverse((c) => { if (c.isMesh) meshes.push(c) })
			}
			if (meshes.length) {
				const hits = raycaster.intersectObjects(meshes)
				if (hits.length > 0) {
					const pt = hits[0].point
					gsap.to(cameraLookAt, {
						x: pt.x, y: pt.y, z: pt.z,
						duration: 0.45,
						ease: 'power2.out',
						onUpdate: () => camera.lookAt(cameraLookAt),
					})
				}
			}
			return
		}

		// ── Dog click → open DogPopup ─────────────────────────────────
		if (dogGroup) {
			const dogMeshes = []
			dogGroup.traverse((c) => { if (c.isMesh) dogMeshes.push(c) })
			const dogHits = raycaster.intersectObjects(dogMeshes)
			if (dogHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-dog-click', {
					detail: { screenX: e.clientX, screenY: e.clientY },
				}))
				return
			}
		}

		// ── My held item click (coffee cup / water glass) → sip ────
		if (myUserId) {
			const myGroup = avatarGroups.get(myUserId)
			const heldItem = myGroup?.children.find(c => c.userData.isCoffeeCup)
			if (heldItem) {
				const heldMeshes = []
				heldItem.traverse(c => { if (c.isMesh) heldMeshes.push(c) })
				if (raycaster.intersectObjects(heldMeshes).length > 0) {
					audio.playSoundForRoom('sip.mp3')
					return
				}
			}
		}

		// ── Avatar click (checked first) ────────────────────────────
		const avatarMeshes = []
		for (const [userId, group] of avatarGroups) {
			group.traverse((obj) => {
				if (obj.isMesh) avatarMeshes.push({ mesh: obj, userId })
			})
		}
		const avatarHits = raycaster.intersectObjects(
			avatarMeshes.map((a) => a.mesh),
		)
		if (avatarHits.length > 0) {
			const hit = avatarMeshes.find(
				(a) => a.mesh === avatarHits[0].object,
			)
			if (hit) {
				const user = presenceStore.users.find(
					(u) => u.id === hit.userId,
				)
				if (user) {
					window.dispatchEvent(
						new CustomEvent("ava-user-click", {
							detail: {
								user,
								screenX: e.clientX,
								screenY: e.clientY,
							},
						}),
					)
					return
				}
			}
		}

		// ── Shared-room seat click → sit ────────────────────────────
		if (sharedSeatMeshes.length) {
			const seatHits = raycaster.intersectObjects(
				sharedSeatMeshes.map((s) => s.mesh),
			)
			if (seatHits.length > 0) {
				const hit = sharedSeatMeshes.find(
					(s) => s.mesh === seatHits[0].object,
				)
				if (hit) {
					if (hit.roomId === currentRoom.value) {
						claimSeat(hit.roomId, hit.seatId)
					} else {
						navigateTo(hit.roomId, { seatId: hit.seatId })
					}
					return
				}
			}
		}

		// ── Desk / chair click → sit or visit ───────────────────────
		if (officeFurnitureMeshes.length) {
			const furnitureHits = raycaster.intersectObjects(
				officeFurnitureMeshes.map((f) => f.mesh),
			)
			if (furnitureHits.length > 0) {
				const hit = officeFurnitureMeshes.find(
					(f) => f.mesh === furnitureHits[0].object,
				)
				if (hit && hit.roomId !== currentRoom.value) {
					const isOccupied = presenceStore.users.some(
						(u) =>
							u.roomId === hit.roomId &&
							String(u.id) !== String(presenceStore.myUserId) &&
							u.status !== "offline",
					)
					navigateTo(hit.roomId, { forceVisit: isOccupied })
					return
				}
				// Clicked desk/chair in current (own) office while standing — re-sit.
				// Use claimSeat (not a hand-rolled tween): the old path never called
				// setMyPose, so myRotation stayed at the corner walk heading and the next
				// presence sync re-applied it over the desk-forward mesh rotation.
				if (
					hit &&
					hit.roomId === currentRoom.value &&
					!officeStore.currentSeatId &&
					!officeStore.isVisitingOffice
				) {
					claimSeat(hit.roomId, `${hit.roomId}:desk`)
					return
				}
			}
		}

		// ── Coffee machine click ─────────────────────────────────────
		if (coffeeMachineMeshes.length) {
			const coffeeHits = raycaster.intersectObjects(coffeeMachineMeshes.map(c => c.mesh))
			if (coffeeHits.length > 0) {
				const hit = coffeeMachineMeshes.find(c => c.mesh === coffeeHits[0].object)
				if (hit) { getCoffee(hit.group); return }
			}
		}

		// ── Water cooler click ───────────────────────────────────────
		if (waterCoolerMeshes.length) {
			const waterHits = raycaster.intersectObjects(waterCoolerMeshes.map(c => c.mesh))
			if (waterHits.length > 0) {
				const hit = waterCoolerMeshes.find(c => c.mesh === waterHits[0].object)
				if (hit) { getWater(hit.group); return }
			}
		}

		// ── Intercom click ───────────────────────────────────────────
		if (intercomMeshes.length) {
			const intercomHits = raycaster.intersectObjects(intercomMeshes.map(c => c.mesh))
			if (intercomHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-intercom-click'))
				return
			}
		}

		// ── Whiteboard click ─────────────────────────────────────────
		if (whiteboardMeshes.length) {
			const wbHits = raycaster.intersectObjects(whiteboardMeshes.map(c => c.mesh))
			if (wbHits.length > 0) {
				const hit = whiteboardMeshes.find(c => c.mesh === wbHits[0].object)
				if (hit) {
					window.dispatchEvent(new CustomEvent('ava-whiteboard-click', {
						detail: { roomId: hit.roomId },
					}))
					return
				}
			}
		}

		// ── Magazine click ───────────────────────────────────────────
		if (magazineMeshes.length) {
			const magHits = raycaster.intersectObjects(magazineMeshes.map(c => c.mesh))
			if (magHits.length > 0) {
				const hit = magazineMeshes.find(c => c.mesh === magHits[0].object)
				if (hit?.url) {
					window.dispatchEvent(new CustomEvent('ava-magazine-click', { detail: { url: hit.url } }))
					return
				}
			}
		}

		// ── Suggestion box click ────────────────────────────────────
		if (suggestionBoxMeshes.length) {
			const sbHits = raycaster.intersectObjects(suggestionBoxMeshes.map(c => c.mesh))
			if (sbHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-suggestion-box-click'))
				return
			}
		}

		// ── Kudos plaque click ──────────────────────────────────────
		if (kudosPlaqueMeshes.length) {
			const kpHits = raycaster.intersectObjects(kudosPlaqueMeshes.map(c => c.mesh))
			if (kpHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-kudos-wall-click'))
				return
			}
		}

		// ── Connect 4 cabinet click ─────────────────────────────────
		if (connect4Meshes.length) {
			const c4Hits = raycaster.intersectObjects(connect4Meshes.map(c => c.mesh))
			if (c4Hits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-c4-click'))
				return
			}
		}

		// ── Arcade cabinet click ────────────────────────────────────
		if (arcadeMeshes.length) {
			const arcHits = raycaster.intersectObjects(arcadeMeshes.map(c => c.mesh))
			if (arcHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-arcade-click'))
				return
			}
		}

		// ── AVA-Man arcade cabinet click ────────────────────────────
		if (arcadePacmanMeshes.length) {
			const pacHits = raycaster.intersectObjects(arcadePacmanMeshes.map(c => c.mesh))
			if (pacHits.length > 0) {
				if (pacHits[0].object.userData.coinReturn) {
					window.dispatchEvent(new CustomEvent('ava-arcade-centipede-click'))
				} else {
					window.dispatchEvent(new CustomEvent('ava-arcade-pacman-click'))
				}
				return
			}
		}

		// ── Ticket dispenser click ──────────────────────────────────
		if (ticketDispenserMeshes.length) {
			const tdHits = raycaster.intersectObjects(ticketDispenserMeshes.map(c => c.mesh))
			if (tdHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-ticket-pull'))
				return
			}
		}

		// ── Now Serving sign click ──────────────────────────────────
		if (nowServingMeshes.length) {
			const nsHits = raycaster.intersectObjects(nowServingMeshes.map(c => c.mesh))
			if (nsHits.length > 0) {
				window.dispatchEvent(new CustomEvent('ava-now-serving-click'))
				return
			}
		}

		// ── Desk monitor click (personal offices) ────────────────────
		if (monitorMeshes.length) {
			const monHits = raycaster.intersectObjects(monitorMeshes.map(c => c.mesh))
			if (monHits.length > 0) {
				const hit = monitorMeshes.find(c => c.mesh === monHits[0].object)
				if (hit) {
					window.dispatchEvent(new CustomEvent('ava-monitor-click', {
						detail: { roomId: hit.roomId },
					}))
					return
				}
			}
		}

		// ── Refrigerator click ───────────────────────────────────────
		// Check all fridge meshes first so body/frame clicks don't fall through to floor nav.
		// Search all hits (not just [0]) — hitbox may be closer than a door mesh.
		if (refrigeratorAllMeshes.length) {
			const rfHits = raycaster.intersectObjects(refrigeratorAllMeshes)
			if (rfHits.length > 0) {
				const hitObjects = new Set(rfHits.map(h => h.object))
				const doorHit = refrigeratorDoorMeshes.find(d => hitObjects.has(d.mesh))
				if (doorHit) {
					const opening = !doorHit.door.isOpen()
					doorHit.door.toggle()
					if (opening) useRealtimeSocket().emit('fridge', { side: doorHit.side, action: 'open' })
				}
				return
			}
		}

		// ── Door click ───────────────────────────────────────────────
		// States: open | closed (not locked) | locked
		// Inside room: toggle between open ↔ closed+locked
		// Outside room: closed → open; locked → knock dialog
		// WHY: capture the actual map key (with any `-N` suffix) instead of
		// rebuilding it from roomId+wall. main-hall has multiple south doors
		// keyed `main-hall-south`, `main-hall-south-1`, etc., and rebuilding
		// would silently target the first one (conference's panel) when the
		// user clicked any other south door.
		for (const [doorKey, entry] of doorPivots) {
			const doorHits = raycaster.intersectObjects(entry.meshes)
			if (doorHits.length > 0) {
				const clickerInRoom = officeStore.currentRoomId === entry.roomId

				if (entry.isOpen) {
					if (clickerInRoom) {
						// Inside + open → close + lock
						const ok = await avaConfirm({
							title: 'Close & Lock?',
							message: 'Close this door and lock the room for privacy. Others will need to knock to enter.',
							confirmLabel: 'Close & Lock',
							cancelLabel: 'Cancel',
						})
						if (ok) {
							setDoorOpenByKey(doorKey, false)
							_writeDoorState(doorKey, false, true)
						}
					}
					// Outside + open → no action (door is already open)
				} else if (entry.isLocked) {
					if (clickerInRoom) {
						// Inside + locked → open + unlock
						setDoorOpenByKey(doorKey, true)
						_writeDoorState(doorKey, true, false)
					} else {
						// Outside + locked → knock dialog
						window.dispatchEvent(new CustomEvent('ava-room-blocked', { detail: { roomId: entry.roomId } }))
					}
				} else {
					// Closed but not locked — anyone can open
					setDoorOpenByKey(doorKey, true)
					_writeDoorState(doorKey, true, false)
				}
				return
			}
		}

		// ── Custom entity click (packages, bots, etc.) ──────────────────
		// Swallow clicks on hoverable meshes so they don't fall through to floor nav.
		if (_customEntities.size) {
			const customHoverables = []
			for (const [, e] of _customEntities) for (const m of e.hoverables) customHoverables.push(m)
			if (customHoverables.length && raycaster.intersectObjects(customHoverables).length > 0) return
		}

		// ── Floor click → walk or navigate ─────────────────────────────
		// Overhead: click same-room floor to walk there; click another room to navigate there.
		// POV: click current-room floor to walk there (or stand up if seated);
		//      click another room's visible floor to navigate there.
		// Floor clicks never toggle overhead/POV view mode.
		if (officeStore.viewMode === 'overhead') {
			for (const [roomId, group] of roomGroups) {
				const floor = group.children.find(
					(c) => c.isMesh && c.geometry.type === 'PlaneGeometry',
				)
				if (!floor) continue
				const hits = raycaster.intersectObject(floor)
				if (hits.length > 0) {
					if (roomId === currentRoom.value) {
						officeStore.toggleViewMode()
						container.dataset.view = 'pov'
						_applyRoomCulling(currentRoom.value)
						if (myUserId) {
							const g = avatarGroups.get(myUserId)
							if (g) {
								const hx = hits[0].point.x
								const hz = hits[0].point.z
								const dx = hx - g.position.x
								const dz = hz - g.position.z
								const rot = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : g.rotation.y
								const camX = hx - Math.sin(rot) * 2.8
								const camZ = hz - Math.cos(rot) * 2.8
								camTween?.kill()
								const tw = gsap.timeline()
								tw.to(camera.position, { x: camX, y: 1.8, z: camZ, duration: 0.7, ease: 'power2.inOut' }, 0)
								tw.to(cameraLookAt, { x: hx + Math.sin(rot) * 2, y: 1.55, z: hz + Math.cos(rot) * 2, duration: 0.7, ease: 'power2.inOut', onUpdate: () => camera.lookAt(cameraLookAt) }, 0)
								camTween = tw
								audio.playSound('woosh.mp3')
								_walkAvatarTo(g, hx, hz)
							}
						}
					} else {
						navigateTo(roomId, { arrivalPos: hits[0].point })
					}
					break
				}
			}
		} else {
			// POV: test current room floor first
			const currentGroup = roomGroups.get(currentRoom.value)
			if (currentGroup) {
				const floor = currentGroup.children.find(
					(c) => c.isMesh && c.geometry.type === 'PlaneGeometry',
				)
				if (floor) {
					const hits = raycaster.intersectObject(floor)
					if (hits.length > 0) {
						if (officeStore.currentSeatId) {
							// Stand up — clear seat state, walk avatar and pan camera simultaneously
							playFwoop('up')
							officeStore.setCurrentSeat(null)
							presenceStore.setMySeatId(null)
							if (myUserId) {
								const g = avatarGroups.get(myUserId)
								if (g) {
									g.userData.seatY = 0
									const hx = hits[0].point.x
									const hz = hits[0].point.z
									const dx = hx - g.position.x
									const dz = hz - g.position.z
									const rot = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : g.rotation.y
									const camX = hx - Math.sin(rot) * 2.8
									const camZ = hz - Math.cos(rot) * 2.8
									camTween?.kill()
									const tw = gsap.timeline()
									tw.to(camera.position, { x: camX, y: 1.8, z: camZ, duration: 0.6, ease: 'power2.inOut' }, 0)
									tw.to(cameraLookAt, { x: hx + Math.sin(rot) * 2, y: 1.55, z: hz + Math.cos(rot) * 2, duration: 0.6, ease: 'power2.inOut', onUpdate: () => camera.lookAt(cameraLookAt) }, 0)
									camTween = tw
									_walkAvatarTo(g, hx, hz)
								}
							}
							return
						}
						// Walk to clicked position
						if (myUserId) {
							const g = avatarGroups.get(myUserId)
							if (g) {
								audio.playSound('woosh.mp3')
								_walkAvatarTo(g, hits[0].point.x, hits[0].point.z)
							}
						}
						return
					}
				}
			}
			// Click another room's visible floor → navigate there.  Pick the CLOSEST
			// floor hit across all rooms — not the first one the iterator finds.
			// A ray from POV can pass through an open door and hit both the near
			// room's floor and a farther room's floor (glass walls, long hallways);
			// selecting by iteration order would teleport the avatar past the spot
			// the user actually clicked.
			let closest = null
			for (const [roomId, group] of roomGroups) {
				if (roomId === currentRoom.value) continue
				if (!group.visible) continue
				const floor = group.children.find(
					(c) => c.isMesh && c.geometry.type === 'PlaneGeometry',
				)
				if (!floor) continue
				const hits = raycaster.intersectObject(floor)
				if (hits.length > 0 && (!closest || hits[0].distance < closest.distance)) {
					closest = { roomId, distance: hits[0].distance, point: hits[0].point }
				}
			}
			if (closest) {
				navigateTo(closest.roomId, { arrivalPos: closest.point })
			}
		}
	}

	// ── Drag-to-orbit ────────────────────────────────────────────────
	const DRAG_THRESHOLD = 5     // px — below this it's treated as a click
	const ORBIT_SPEED = 0.005 // rad/px for camera orbit
	const AVATAR_ROT_SPEED = 0.010 // rad/px for alt-drag avatar rotation
	// Polar angle from +Y (look-at → camera). 0 = above subject; π/2 = horizontal ring;
	// >π/2 lets the camera sit slightly below the look-at height so you can pitch up (sky / lobby glass).
	const PHI_MIN = 0.1
	const PHI_MAX = 1.82

	/** Spherical orbit around `cameraLookAt`; `dTheta`/`dPhi` match drag (see onDragMove). */
	function applyCameraOrbitRad (dTheta, dPhi) {
		if (!camera || isTransitioning.value) return
		const offset = new THREE.Vector3().subVectors(camera.position, cameraLookAt)
		const r = offset.length()
		if (r < 1e-4) return
		let theta = Math.atan2(offset.x, offset.z)
		let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / r)))
		theta += dTheta
		phi = Math.max(PHI_MIN, Math.min(PHI_MAX, phi + dPhi))
		camera.position.set(
			cameraLookAt.x + r * Math.sin(phi) * Math.sin(theta),
			cameraLookAt.y + r * Math.cos(phi),
			cameraLookAt.z + r * Math.sin(phi) * Math.cos(theta),
		)
		camera.lookAt(cameraLookAt)
	}

	let dragActive = false
	let dragStart = { x: 0, y: 0 }
	let dragMoved = false
	let dragWasAltRotate = false

	function onDragStart (e) {
		if (e.button !== 0) return // left button only
		dragActive = true
		dragMoved = false
		dragWasAltRotate = false
		dragStart = { x: e.clientX, y: e.clientY }
		renderer.domElement.setPointerCapture(e.pointerId)
	}

	function updateCursor (e) {
		if (!camera) return
		if (dragActive) {
			renderer.domElement.style.cursor = dragMoved ? 'grabbing' : ''
			hoverLabel.value = ''
			return
		}
		if (isTransitioning.value) {
			renderer.domElement.style.cursor = ''
			hoverLabel.value = ''
			return
		}

		const rect = renderer.domElement.getBoundingClientRect()
		mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
		mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
		raycaster.setFromCamera(mouseNDC, camera)

		// Static furniture + async-loaded meshes + avatars + dog
		const hoverables = _staticHoverables()
		for (const m of refrigeratorAllMeshes) hoverables.push(m)
		for (const { mesh } of monitorMeshes) hoverables.push(mesh)
		for (const { mesh } of whiteboardMeshes) hoverables.push(mesh)
		for (const [, g] of avatarGroups) g.traverse(c => { if (c.isMesh) hoverables.push(c) })
		if (dogGroup) dogGroup.traverse(c => { if (c.isMesh) hoverables.push(c) })

		const customHoverableSet = new Set()
		for (const [, e] of _customEntities) for (const m of e.hoverables) {
			hoverables.push(m)
			customHoverableSet.add(m)
		}

		const furnitureHits = raycaster.intersectObjects(hoverables)
		if (furnitureHits.length > 0) {
			renderer.domElement.style.cursor = customHoverableSet.has(furnitureHits[0].object) ? 'help' : 'pointer'
			hoverLabel.value = _hoverLabelFor(furnitureHits[0].object)
			return
		}

		// Fallback: check navigatable floors
		const floorMeshes = [..._floorMeshMap.keys()]
		const floorHits = floorMeshes.length ? raycaster.intersectObjects(floorMeshes) : []
		if (floorHits.length > 0) {
			const roomId = _floorMeshMap.get(floorHits[0].object)
			renderer.domElement.style.cursor = 'pointer'
			if (roomId === currentRoom.value) {
				hoverLabel.value = 'Walk here'
			} else {
				const room = getRoomById(roomId)
				hoverLabel.value = room ? `Go to ${room.name}` : ''
			}
			return
		}

		renderer.domElement.style.cursor = ''
		hoverLabel.value = ''
	}

	function _hoverLabelFor (mesh) {
		for (const [, e] of _customEntities) {
			if (!e.getLabel) continue
			if (e.hoverables.includes(mesh)) return e.getLabel(mesh) || ''
		}
		// Fridge
		if (refrigeratorAllMeshes.includes(mesh)) {
			const d = refrigeratorDoorMeshes.find(e => e.mesh === mesh)
			if (d) return d.door.isOpen() ? 'Close refrigerator' : 'Open refrigerator'
			return 'Refrigerator'
		}
		// Room doors
		for (const [, entry] of doorPivots) {
			if (!entry.meshes.includes(mesh)) continue
			const inside = officeStore.currentRoomId === entry.roomId
			if (entry.isLocked) return inside ? 'Unlock & open' : 'Knock to enter'
			if (entry.isOpen) return inside ? 'Close & lock' : ''
			return 'Open door'
		}
		// Seats
		if (sharedSeatMeshes.some(s => s.mesh === mesh)) return 'Sit here'
		if (officeFurnitureMeshes.some(s => s.mesh === mesh)) return 'Sit here'
		// Furniture / interactables
		if (coffeeMachineMeshes.some(s => s.mesh === mesh)) return 'Coffee machine'
		if (waterCoolerMeshes.some(s => s.mesh === mesh)) return 'Water cooler'
		if (intercomMeshes.some(s => s.mesh === mesh)) return 'Intercom'
		if (magazineMeshes.some(s => s.mesh === mesh)) return 'Read magazine'
		if (suggestionBoxMeshes.some(s => s.mesh === mesh)) return 'Suggestion box'
		if (kudosPlaqueMeshes.some(s => s.mesh === mesh)) return 'Kudos wall'
		if (connect4Meshes.some(s => s.mesh === mesh)) return 'Play Connect 4'
		if (arcadeMeshes.some(s => s.mesh === mesh)) return 'Arcade game'
		if (arcadePacmanMeshes.some(s => s.mesh === mesh)) return 'AVA-Man'
		if (ticketDispenserMeshes.some(s => s.mesh === mesh)) return 'Take a number'
		if (nowServingMeshes.some(s => s.mesh === mesh)) return 'Now Serving'
		if (monitorMeshes.some(s => s.mesh === mesh)) return 'Office screen'
		if (whiteboardMeshes.some(s => s.mesh === mesh)) return 'Whiteboard'
		// Avatar
		for (const [userId, g] of avatarGroups) {
			let found = false
			g.traverse(c => { if (c === mesh) found = true })
			if (found) {
				const user = presenceStore.users.find(u => String(u.id) === String(userId))
				return user?.displayName || user?.name || user?.email?.split('@')[0] || ''
			}
		}
		// Dog
		if (dogGroup) {
			let found = false
			dogGroup.traverse(c => { if (c === mesh) found = true })
			if (found) return 'Byte'
		}
		return ''
	}

	// Cached hoverable static furniture — invalidated by mesh-list mutations.
	// Avatars are NOT cached here (their set changes too often); see updateCursor.
	let _staticHoverablesCache = null
	function _staticHoverables () {
		if (_staticHoverablesCache) return _staticHoverablesCache.slice()
		const out = []
		for (const { mesh } of sharedSeatMeshes) out.push(mesh)
		for (const { mesh } of officeFurnitureMeshes) out.push(mesh)
		for (const { mesh } of coffeeMachineMeshes) out.push(mesh)
		for (const { mesh } of waterCoolerMeshes) out.push(mesh)
		for (const { mesh } of intercomMeshes) out.push(mesh)
		for (const { mesh } of magazineMeshes) out.push(mesh)
		for (const { mesh } of suggestionBoxMeshes) out.push(mesh)
		for (const { mesh } of kudosPlaqueMeshes) out.push(mesh)
		for (const { mesh } of connect4Meshes) out.push(mesh)
		for (const { mesh } of arcadeMeshes) out.push(mesh)
		for (const { mesh } of arcadePacmanMeshes) out.push(mesh)
		for (const { mesh } of ticketDispenserMeshes) out.push(mesh)
		for (const { mesh } of nowServingMeshes) out.push(mesh)
		for (const [, entry] of doorPivots) out.push(...entry.meshes)
		_staticHoverablesCache = out
		return out.slice()
	}

	function onDragMove (e) {
		updateCursor(e)
		if (!dragActive || !camera || isTransitioning.value) return

		const dx = e.clientX - dragStart.x
		const dy = e.clientY - dragStart.y

		if (!dragMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
		dragMoved = true

		// Alt/Option held → rotate local avatar in place instead of orbiting camera
		if (e.altKey && myUserId) {
			const g = avatarGroups.get(myUserId)
			if (g) g.rotation.y += dx * AVATAR_ROT_SPEED
			dragStart = { x: e.clientX, y: e.clientY }
			dragWasAltRotate = true
			return
		}

		// Normal drag → orbit in spherical coords. +dx matches +dy so both axes
		// feel like the view follows the cursor; −dx alone is the usual
		// “turntable / grab-the-scene” horizontal style (e.g. Three.OrbitControls).
		applyCameraOrbitRad(dx * ORBIT_SPEED, dy * ORBIT_SPEED)

		dragStart = { x: e.clientX, y: e.clientY }
	}

	function onDragEnd (e) {
		if (!dragActive) return
		dragActive = false
		renderer.domElement.releasePointerCapture(e.pointerId)
		if (dragWasAltRotate && myUserId) {
			// Persist final rotation so peers see the new facing direction
			const g = avatarGroups.get(myUserId)
			if (g) officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
			dragWasAltRotate = false
		}
		if (!dragMoved) onCanvasClick(e) // short tap → treat as click
	}

	// ── Scroll wheel: zoom, or Ctrl/Cmd+scroll pan (slide view + look-at) ─
	function onCanvasWheel (e) {
		e.preventDefault()
		if (!camera || isTransitioning.value) return
		const currentDist = camera.position.distanceTo(cameraLookAt)

		// Alt + scroll → translate camera and look-at together (screen-space pan)
		// (Ctrl/Cmd is intentionally avoided — it triggers browser page zoom)
		if (e.altKey) {
			const right = new THREE.Vector3(1, 0, 0)
				.applyQuaternion(camera.quaternion)
				.normalize()
			const up = new THREE.Vector3(0, 1, 0)
				.applyQuaternion(camera.quaternion)
				.normalize()
			const pan =
				officeStore.viewMode === "overhead"
					? currentDist * 0.0004
					: 0.003
			const deltaPan = new THREE.Vector3()
				.addScaledVector(right, -e.deltaX * pan)
				.addScaledVector(up, -e.deltaY * pan)
			camera.position.add(deltaPan)
			cameraLookAt.add(deltaPan)
			return
		}

		// ── Zoom-to-cursor ─────────────────────────────────────────────
		// Raycast from the mouse into the scene and pivot the zoom around that world
		// point, so the thing under the cursor stays put while the camera closes in —
		// matches Google Maps / Figma / Blender conventions.
		const rect = renderer.domElement.getBoundingClientRect()
		mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
		mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
		raycaster.setFromCamera(mouseNDC, camera)
		const isOverhead = officeStore.viewMode === "overhead"

		// Prefer an actual scene hit for the pivot; fall back to the ground plane.
		// In POV, the closest ray hit is often the wall you are backed against (or a
		// corner trim). Zooming around that point traps you: zoom-in hits minDist and
		// zoom-out shoves the camera into the wall behind. Skip “too near” hits and
		// use the first hit farther along the ray; if the ray only grazes nearby
		// geometry, fall back to ground / a forward dolly point instead of lookAt.
		let pivot = null
		const currentGroup = roomGroups.get(currentRoom.value)
		if (currentGroup) {
			const zoomHits = raycaster.intersectObject(currentGroup, true)
			if (zoomHits.length > 0) {
				if (isOverhead) {
					pivot = zoomHits[0].point
				} else {
					// Slightly above wheel minDist (0.5): skip pivots on the surface you are
					// pressed against without stealing zoom-to-cursor on nearby furniture.
					const POV_MIN_RAY = 0.78
					if (zoomHits[0].distance >= POV_MIN_RAY) {
						pivot = zoomHits[0].point
					} else {
						const deeper = zoomHits.find(h => h.distance >= POV_MIN_RAY)
						if (deeper) pivot = deeper.point
					}
				}
			}
		}
		if (!pivot) {
			const rayDir = raycaster.ray.direction
			if (Math.abs(rayDir.y) > 1e-4) {
				const t = -raycaster.ray.origin.y / rayDir.y
				if (t > 0) pivot = raycaster.ray.origin.clone().addScaledVector(rayDir, t)
			}
		}
		if (!pivot && !isOverhead) {
			const fwd = new THREE.Vector3()
			camera.getWorldDirection(fwd)
			pivot = camera.position.clone().addScaledVector(fwd, 6)
			pivot.y = cameraLookAt.y
		}
		if (!pivot) pivot = cameraLookAt.clone()   // last-resort fallback

		// Scroll magnitude scaled so one notch moves ~5% of distance-to-pivot (overhead)
		// or a fixed step in POV. Clamp the normalised deltaY so trackpad kinetic scroll
		// doesn't fly past the target in one frame.
		const pivotDist = camera.position.distanceTo(pivot)
		const step = Math.max(-1, Math.min(1, -e.deltaY / 120))   // ±1 per notch
		let zoomFactor = isOverhead ? step * 0.12 : step * 0.10  // fraction of distance

		const dirToPivot = new THREE.Vector3().subVectors(pivot, camera.position)
		const minDist = 0.5
		const maxDist = isOverhead ? 200 : 100
		// Clamp zoom step to bounds instead of rejecting the whole wheel event.
		// A hard return here left users stuck when the raycast pivot sat on the
		// wall behind the camera (tiny pivotDist): every “zoom in” notch computed
		// newDist < minDist and did nothing, so the view could not recover.
		const unclamped = pivotDist * (1 - zoomFactor)
		if (unclamped < minDist && zoomFactor > 0 && pivotDist > minDist) {
			zoomFactor = 1 - minDist / pivotDist
		} else if (unclamped > maxDist && zoomFactor < 0 && pivotDist < maxDist) {
			zoomFactor = 1 - maxDist / pivotDist
		} else if (pivotDist <= minDist && zoomFactor > 0) return
		else if (pivotDist >= maxDist && zoomFactor < 0) return

		// Shift camera + lookAt by the same translation so framing is preserved,
		// then let the camera close in on the pivot point.
		const moveDelta = dirToPivot.multiplyScalar(zoomFactor)
		camera.position.add(moveDelta)
		cameraLookAt.add(moveDelta)
		camera.lookAt(cameraLookAt)
	}

	// ── Keyboard: space-to-talk etc. ─────────────────────────────────
	function isTypingTarget (el) {
		if (!el) return false
		const tag = el.tagName
		return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable
	}

	/** Escape also closes popovers; skip reset when focus is inside those layers. Home always resets (when allowed). */
	function escWouldHitFloatingUiBeforeReset (e) {
		if (!(e.target instanceof Element)) return false
		return !!e.target.closest(
			".ava-panel, .help-overlay, .wn-backdrop, .console-panel, .appgrid-panel, [role=\"dialog\"][aria-modal=\"true\"]",
		)
	}

	function onKeyDown (e) {
		if (e.code === "Escape" || e.code === "Home") {
			if (isTypingTarget(e.target)) return
			if (anyModalOpen()) return
			if (e.code === "Escape" && escWouldHitFloatingUiBeforeReset(e)) return
			e.preventDefault()
			resetCamera()
			return
		}
		if (e.code === "AltLeft" || e.code === "AltRight") keyboardAltHeld = true
		if (MOVE_CODES.has(e.code)) {
			if (!isTypingTarget(e.target) && !anyModalOpen()) {
				e.preventDefault()
				if (e.altKey) keyboardAltHeld = true
				heldKeys.add(e.code)
				// Cancel looping emotes on move; one-shots finish on their own.
				if (_activeEmote && EMOTES[_activeEmote.name]?.loop) clearEmote()
			}
			return
		}
		if (e.code === "Space") {
			if (isTypingTarget(e.target) || anyModalOpen()) return
			e.preventDefault()
			window.dispatchEvent(new CustomEvent("ava-ptt-start"))
		}
		if (e.code === 'KeyE') {
			if (isTypingTarget(e.target) || anyModalOpen()) return
			e.preventDefault()
			const g = myUserId ? avatarGroups.get(myUserId) : null
			if (g && !_jumpActive && !isTransitioning.value && !officeStore.currentSeatId) {
				_jumpActive = true
				_jumpStartTime = performance.now()
				officeStore.setMyAvatarState({ jump: true })
			}
		}
		if (e.code === 'KeyQ') {
			if (isTypingTarget(e.target) || anyModalOpen()) return
			if (e.repeat) return
			e.preventDefault()
			// Hold Q (>= 250 ms) to open the emote radial. Selection is emitted
			// by EmoteRadialMenu on release. Tap Q does nothing.
			if (_emoteMenuHoldTimer) return
			_emoteMenuHoldTimer = setTimeout(() => {
				_emoteMenuHoldTimer = null
				_emoteMenuOpen = true
				window.dispatchEvent(new CustomEvent('ava-emote-menu-open'))
			}, 250)
		}
		if (e.code === 'KeyC') {
			if (isTypingTarget(e.target) || anyModalOpen()) return
			e.preventDefault()
			_crouchHeld = true
			officeStore.setMyAvatarState({ crouch: true })
		}
		// Number-key emote hotkeys (Digit1..Digit4)
		if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3' || e.code === 'Digit4') {
			if (isTypingTarget(e.target) || anyModalOpen()) return
			e.preventDefault()
			const idx = Number(e.code.slice(-1)) - 1
			const name = Object.keys(EMOTES)[idx]
			if (name) triggerEmote(name)
		}
	}
	function onKeyUp (e) {
		if (e.code === "AltLeft" || e.code === "AltRight") keyboardAltHeld = false
		heldKeys.delete(e.code)
		if (e.code === "Space") {
			if (isTypingTarget(e.target)) return
			window.dispatchEvent(new CustomEvent("ava-ptt-stop"))
		}
		if (MOVE_CODES.has(e.code) && _wasdMoved) {
			const stillMoving = [...MOVE_CODES].some(k => heldKeys.has(k))
			if (!stillMoving) {
				_wasdMoved = false
				_localMoveEndedAt = Date.now()
				if (_walkSoundActive) { _walkSoundActive = false; audio.stopLooping() }
				const g = myUserId ? avatarGroups.get(myUserId) : null
				if (g) officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
			}
		}
		if (e.code === 'KeyC') { _crouchHeld = false; officeStore.setMyAvatarState({ crouch: false }) }
		if (e.code === 'KeyQ') {
			if (_emoteMenuHoldTimer) {
				clearTimeout(_emoteMenuHoldTimer)
				_emoteMenuHoldTimer = null
			}
			if (_emoteMenuOpen) {
				_emoteMenuOpen = false
				window.dispatchEvent(new CustomEvent('ava-emote-menu-close'))
			}
		}
	}
	function onWindowBlur () {
		heldKeys.clear()
		keyboardAltHeld = false
		if (_crouchHeld) officeStore.setMyAvatarState({ crouch: false })
		_crouchHeld = false
		if (_walkSoundActive) { _walkSoundActive = false; audio.stopLooping() }
		if (_emoteMenuHoldTimer) { clearTimeout(_emoteMenuHoldTimer); _emoteMenuHoldTimer = null }
		if (_emoteMenuOpen) {
			_emoteMenuOpen = false
			window.dispatchEvent(new CustomEvent('ava-emote-menu-close'))
		}
	}

	// ── Animation loop ───────────────────────────────────────────────
	function animate (time = 0) {
		// Skip rendering entirely when the tab is hidden — avoids burning CPU/GPU
		// on offscreen mouth/dog/lava/fish animation on slow devices.
		if (document.hidden) {
			animFrameId = requestAnimationFrame(animate)
			return
		}
		animFrameId = requestAnimationFrame(animate)
		// Frame limiter by tier: low ≈ 30 fps (33 ms), mid ≈ 45 fps (22 ms), std = unlimited
		const fpsFloor = isLowEnd ? 33 : isMidRange ? 22 : 0
		if (fpsFloor && time - lastFrameTime < fpsFloor) return
		lastFrameTime = time
		timer.update()
		const delta = timer.getDelta()

		if (wallClockUpdaters.length || worldClockUpdaters.length) {
			const now = new Date()
			for (let i = 0; i < wallClockUpdaters.length; i++)
				wallClockUpdaters[i](now)
			for (let i = 0; i < worldClockUpdaters.length; i++)
				worldClockUpdaters[i](now)
		}

		tickFountainWater(delta)
		tickVectorRobots(delta)
		_tickFountainAudio()

		// Idle bob — bob around seatY so seated avatars stay lowered.
		// On seatY transitions also repose leg capsules: standing = vertical,
		// seated = rotated 90° forward so legs extend in front of the chair.
		const t = performance.now() / 1000
		for (const [uid, av] of avatarGroups) {
			const seatY = av.userData.seatY ?? 0
			const seated = seatY < 0
			let yExtra = 0
			if (uid === myUserId && !seated) {
				if (_jumpActive) {
					const elapsed = (performance.now() - _jumpStartTime) / _JUMP_DURATION
					if (elapsed >= 1) { _jumpActive = false; av.scale.y = 1.0; officeStore.setMyAvatarState({ jump: false }) }
					else yExtra = Math.sin(elapsed * Math.PI) * _JUMP_HEIGHT
				} else if (_crouchHeld) {
					yExtra = -0.28
				}
				if (!_jumpActive) av.scale.y = _crouchHeld ? 0.72 : 1.0
			} else if (!seated) {
				if (av.userData.peerJumpStart) {
					const elapsed = (performance.now() - av.userData.peerJumpStart) / _JUMP_DURATION
					if (elapsed >= 1) { av.userData.peerJumpStart = null; av.scale.y = 1.0 }
					else yExtra = Math.sin(elapsed * Math.PI) * _JUMP_HEIGHT
				} else if (av.userData.peerCrouch) {
					yExtra = -0.28
				}
				if (!av.userData.peerJumpStart) av.scale.y = av.userData.peerCrouch ? 0.72 : 1.0
			}
			// ── Emote tick ─────────────────────────────────────────────
			let emoteBob = 0
			if (uid === myUserId) {
				if (_activeEmote) {
					const def = EMOTES[_activeEmote.name]
					const tt = (performance.now() - _activeEmote.startedAt) / 1000
					if (def && (def.loop || tt * 1000 < def.duration)) {
						emoteBob = _applyEmoteToArms(av, def.tick(tt, _activeEmote.variant))
						av.userData._emoteActive = true
					} else {
						_activeEmote = null
						officeStore.setMyAvatarState({ emote: null, emoteStartedAt: null, emoteVariant: null })
						_resetArms(av)
						av.userData._emoteActive = false
					}
				} else if (av.userData._emoteActive) {
					_resetArms(av)
					av.userData._emoteActive = false
				}
			} else {
				const pe = av.userData.peerEmote
				if (pe) {
					const def = EMOTES[pe.name]
					const tt = (performance.now() - pe.startedAt) / 1000
					if (def && (def.loop || tt * 1000 < def.duration)) {
						emoteBob = _applyEmoteToArms(av, def.tick(tt, pe.variant))
						av.userData._emoteActive = true
					} else {
						av.userData.peerEmote = null
						_resetArms(av)
						av.userData._emoteActive = false
					}
				} else if (av.userData._emoteActive) {
					_resetArms(av)
					av.userData._emoteActive = false
				}
			}

			av.position.y = seatY + Math.sin(t * 1.2 + av.position.x) * 0.015 + yExtra + emoteBob

			if (av.userData._prevSeatY !== seatY) {
				av.userData._prevSeatY = seatY
				const seated = seatY < 0
				for (const child of av.children) {
					if (!child.userData.isLeg) continue
					if (seated) {
						// Pivot around the hip (top of leg, y≈0.785):
						// rotate -90° around X so the capsule lies along local +Z,
						// then shift the center to z=0.345 so the hip end is at z=0.
						child.rotation.x = -Math.PI / 2 + 0.35
						child.position.set(child.position.x, 0.705, 0.255)
					} else {
						child.rotation.x = 0
						const by = child.userData.baseY ?? 0.44
						child.position.set(child.position.x, by, 0)
					}
				}
			}
		}

		// Talking ring pulse — scale + emissive intensity breathe together
		for (const [, ring] of talkingRings) {
			const beat = Math.abs(Math.sin(t * 6))
			ring.scale.set(1 + 0.35 * beat, 1, 1 + 0.35 * beat)
			ring.material.emissiveIntensity = 1.8 + 1.2 * beat
		}

		// Mouth animation — gated by talkingRings so it never fires while muted.
		// When talking, peer analysers provide frame-accurate amplitude; own avatar
		// uses a sin oscillation as fallback (VAD doesn't expose an analyser here).
		// Sample VAD every other frame to halve the analyser cost at 60 fps (mouths animate
		// slowly enough that 30 Hz sampling is visually identical).
		if (talkingRings.size && (_mouthTick++ & 1) === 0) {
			// Build uid → analyser entry lookup once per frame instead of scanning peerAnalysers
			// for every avatar (O(avatars × peers) → O(peers) + O(avatars)).
			_mouthAmpByUid.clear()
			for (const [sigId, entry] of peerAnalysers) {
				const uscore = sigId.indexOf('_')
				const uid = uscore === -1 ? sigId : sigId.slice(0, uscore)
				if (!talkingRings.has(uid)) continue
				if (entry.analyser.context.state !== 'running') continue
				entry.analyser.getByteFrequencyData(entry.buf)
				const buf = entry.buf
				let sum = 0
				for (let i = 0; i < buf.length; i++) sum += buf[i]
				_mouthAmpByUid.set(uid, sum / buf.length)
			}
		}
		for (const [uid, av] of avatarGroups) {
			const mouth = av.userData.mouthMesh
			if (!mouth) continue
			let amplitude = 0
			if (talkingRings.has(uid)) {
				amplitude = _mouthAmpByUid.get(uid) || (30 + 20 * Math.abs(Math.sin(t * 9)))
			}
			const target = 1 + Math.max(0, (amplitude - 8) / 25) * 0.8
			mouth.scale.y += (target - mouth.scale.y) * 0.35
		}

		// ── Office dog — command-driven state machine ──────────────────
		if (dogGroup) {
			const wc = Date.now()
			const now = performance.now()

			dogGroup.visible = true

			// Pull latest dogCmd from presence (all users' AvatarState.dogCmd).
			// See dogApplyLatestCommand — newer commands preempt whatever the dog is doing.
			dogApplyLatestCommand(wc)

			// Timed sit after arriving from goto-user — explicit user "Sit" leaves modeData null (indefinite).
			if (dogState.mode === 'sit' && dogState.modeData?.resumeIdleAt != null && wc >= dogState.modeData.resumeIdleAt) {
				dogState.mode = 'idle'
				dogState.modeData = null
			}

			// Sit mode freezes position and plays a static pose; everything else
			// (idle roam, goto-user, throw-ball) walks along dogState.path.
			let moving = false
			if (dogState.mode === 'sit') {
				// Head-down tilt; no path; no leg wiggle
				dogGroup.position.x = dogState.x
				dogGroup.position.z = dogState.z
				dogState.path.length = 0
			} else if (dogState.mode === 'roll-over' && dogState.modeData?.startWc != null) {
				dogGroup.position.x = dogState.x
				dogGroup.position.z = dogState.z
				dogState.path.length = 0
				const md = dogState.modeData
				const u = Math.min(1, (wc - md.startWc) / (md.durationMs || DOG_ROLL_DURATION_MS))
				const e = u * u * (3 - 2 * u)
				dogGroup.rotation.z = e * Math.PI * 2
				dogGroup.rotation.x = -Math.sin(e * Math.PI) * 0.42
				dogGroup.position.y = Math.sin(e * Math.PI) * 0.16
				dogState.legPhase += delta * 20
				for (let i = 0; i < dogState.legMeshes.length; i++) {
					const leg = dogState.legMeshes[i]
					const alt = (i === 0 || i === 3) ? 0 : Math.PI
					leg.position.y = leg.userData.baseY + Math.abs(Math.sin(dogState.legPhase + alt)) * 0.02
					leg.rotation.x = Math.sin(dogState.legPhase + alt) * 0.95
				}
				if (u >= 1) {
					dogGroup.rotation.z = 0
					dogGroup.rotation.x = 0
					dogGroup.position.y = 0
					for (const leg of dogState.legMeshes) {
						leg.position.y = leg.userData.baseY
						leg.rotation.x = 0
					}
					dogState.mode = 'idle'
					dogState.modeData = null
				}
			} else {
				// Idle roam picks a new path when the current one is empty
				if (!dogState.path.length && dogState.mode === 'idle') dogIdleTick(wc)
				// Walk along the path at constant speed
				if (dogState.path.length) {
					const next = dogState.path[0]
					const dx = next.x - dogState.x
					const dz = next.z - dogState.z
					const dist = Math.hypot(dx, dz)
					const step = DOG_WALK_SPEED * delta
					if (dist <= step || dist < 0.02) {
						// Reached this waypoint
						dogState.x = next.x
						dogState.z = next.z
						dogState.roomId = next.roomId || dogState.roomId
						dogState.path.shift()
						// Path finished → mode-specific completion hook
						if (!dogState.path.length) dogOnPathComplete(wc)
					} else {
						dogState.x += (dx / dist) * step
						dogState.z += (dz / dist) * step
						dogGroup.rotation.y = Math.atan2(dx, dz) - Math.PI / 2
						moving = true
					}
					dogGroup.position.x = dogState.x
					dogGroup.position.z = dogState.z
				}
			}

			// Periodic bark while idle-roaming
			if (dogState.mode === 'idle' && moving && now - dogState.lastBarkAt > 6000) {
				dogState.lastBarkAt = now
				if (dogState.woofLabel) {
					dogState.woofLabel.element.style.opacity = '1'
					dogState.woofHideAt = now + 1200
				}
			}

			// Leg wiggle + bob when moving, tail wag always (roll-over sets pose in its own branch)
			if (moving) {
				dogState.legPhase += delta * 12
				for (let i = 0; i < dogState.legMeshes.length; i++) {
					const leg = dogState.legMeshes[i]
					const alt = (i === 0 || i === 3) ? 0 : Math.PI
					leg.position.y = leg.userData.baseY + Math.abs(Math.sin(dogState.legPhase + alt)) * 0.03
					leg.rotation.x = Math.sin(dogState.legPhase + alt) * 0.45
				}
				dogGroup.position.y = Math.abs(Math.sin(dogState.legPhase * 0.5)) * 0.012
			} else if (dogState.mode !== 'roll-over') {
				for (const leg of dogState.legMeshes) {
					leg.position.y = leg.userData.baseY
					leg.rotation.x = 0
				}
				// Sit: body tilts forward + slightly lower
				dogGroup.position.y = dogState.mode === 'sit' ? -0.05 : 0
				dogGroup.rotation.x = dogState.mode === 'sit' ? -0.15 : 0
			}
			if (dogGroup.userData.tail)
				dogGroup.userData.tail.rotation.y = Math.sin(t * (moving ? 9 : 6)) * (moving ? 0.45 : 0.3)

			if (dogState.woofHideAt && now >= dogState.woofHideAt && dogState.woofLabel) {
				dogState.woofLabel.element.style.opacity = '0'
				dogState.woofHideAt = 0
			}

			// Update ball (if thrown): arc tween handles its y; we just keep it around
			if (dogBall && dogBall.userData.followsDog) {
				// Dog is carrying the ball home — attach to the dog's mouth
				dogBall.position.set(dogState.x + Math.cos(dogGroup.rotation.y) * 0.38, 0.32, dogState.z - Math.sin(dogGroup.rotation.y) * 0.38)
			}
		}

		// ── Lava lamp blob animation (lobby only) ───────────────────
		if (currentRoom.value === 'lobby')
			for (const blob of lavaLampBlobs) {
				const d = blob.userData.lavaBlob
				const s = Math.sin(t * d.speed + d.phase)
				blob.position.y = d.baseY + s * d.ampY
				// Slight squish at the ends of the travel
				const squishT = Math.abs(s)
				blob.scale.y = 1 - squishT * 0.25 * d.squish
				blob.scale.x = 1 + squishT * 0.12 * d.squish
				blob.scale.z = blob.scale.x
			}

		// ── Aquarium fish swim animation (lobby only) ────────────────
		if (currentRoom.value === 'lobby')
			for (const fish of aquariumFish) {
				const { speed, phase, radius, baseY } = fish.userData.fishData
				const prevZ = fish.position.z
				fish.position.z = Math.sin(t * speed + phase) * radius
				fish.position.y = baseY + Math.sin(t * 0.38 + phase * 1.7) * 0.13
				// Face direction of travel; flip only when velocity direction changes
				const dz = fish.position.z - prevZ
				if (Math.abs(dz) > 1e-5) fish.rotation.y = dz > 0 ? 0 : Math.PI
				// Gentle tail-wag tilt
				fish.rotation.z = Math.sin(t * speed * 3.2 + phase) * 0.11
			}

		// Advance GLTF mixers
		for (const [, mixer] of avatarMixers) mixer.update(delta)

		// ── Alt+WASD / arrows: orbit camera (same spherical math as drag, not avatar move) ──
		if (keyboardAltHeld && heldKeys.size && camera && !isTransitioning.value) {
			if (!anyModalOpen() && !isTypingTarget(document.activeElement)) {
				const KEY_ORBIT_RAD_PER_SEC = 1.75
				let dTheta = 0
				let dPhi = 0
				if (heldKeys.has("KeyA") || heldKeys.has("ArrowLeft")) dTheta -= KEY_ORBIT_RAD_PER_SEC * delta
				if (heldKeys.has("KeyD") || heldKeys.has("ArrowRight")) dTheta += KEY_ORBIT_RAD_PER_SEC * delta
				if (heldKeys.has("KeyS") || heldKeys.has("ArrowDown")) dPhi += KEY_ORBIT_RAD_PER_SEC * delta
				if (heldKeys.has("KeyW") || heldKeys.has("ArrowUp")) dPhi -= KEY_ORBIT_RAD_PER_SEC * delta
				if (dTheta !== 0 || dPhi !== 0) applyCameraOrbitRad(dTheta, dPhi)
			}
		}

		// ── WASD / arrow-key movement (avatar-relative, camera follows behind) ──
		if (heldKeys.size && myUserId && !isTransitioning.value && !officeStore.currentSeatId && !keyboardAltHeld) {
			const g = avatarGroups.get(myUserId)
			if (g && !anyModalOpen() && !isTypingTarget(document.activeElement)) {
				const MOVE_SPEED = 5.0        // units/s
				const ROT_SPEED = 2.5        // rad/s — ~143 deg/s; brief tap ≈ 30–45 deg

				let didSomething = false

				// A / D — rotate avatar in place (also applies when combined with W)
				if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) { g.rotation.y += ROT_SPEED * delta; didSomething = true }
				if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) { g.rotation.y -= ROT_SPEED * delta; didSomething = true }

				// W / S — move forward / back along avatar's facing direction
				const fwdSin = Math.sin(g.rotation.y)
				const fwdCos = Math.cos(g.rotation.y)
				let fwdStep = 0
				if (heldKeys.has('KeyW') || heldKeys.has('ArrowUp')) fwdStep = MOVE_SPEED * delta
				if (heldKeys.has('KeyS') || heldKeys.has('ArrowDown')) fwdStep = -MOVE_SPEED * delta
				if (fwdStep !== 0) {
					g.position.x += fwdSin * fwdStep
					g.position.z += fwdCos * fwdStep
					didSomething = true
				}

				if (didSomething) {
					// Exit overhead on first key move using the same smooth tween as the button.
					// _overheadExiting guards the camera lerp below from killing the tween.
					if (officeStore.viewMode === 'overhead') {
						officeStore.toggleViewMode()
						container.dataset.view = 'pov'
						_applyRoomCulling(currentRoom.value)
						_overheadExiting = true
						_focusCameraOnSelf()
						if (camTween) camTween.eventCallback('onComplete', () => { _overheadExiting = false })
						else _overheadExiting = false
					}
					const _room = getRoomById(currentRoom.value)
					let doorTriggered = false
					if (_room?.pos && _room?.size) {
						const [cx, cz] = _room.pos
						const hw = _room.size[0] / 2
						const hd = _room.size[1] / 2
						// Only check doorways when actually moving forward/back, not rotating.
						// M > clamp margin (0.5) so detection fires while avatar presses the wall.
						// triggerSide (when set) overrides door.wall for trigger position so that
						// the intuitive walking direction matches the connected room's location,
						// independently of where the visual door cutout was placed.
						if (fwdStep !== 0) {
							const M = 0.6
							const movingN = fwdCos * fwdStep < 0   // moving in -z (north)
							const movingS = fwdCos * fwdStep > 0   // moving in +z (south)
							const movingW = fwdSin * fwdStep < 0   // moving in -x (west)
							const movingE = fwdSin * fwdStep > 0   // moving in +x (east)
							for (const door of (_room.doors || [])) {
								if (!door.toRoom) continue
								const tw = door.triggerSide || door.wall
								const dp = doorWorldXZ(_room, { ...door, wall: tw })
								const half = (door.width || 3) / 2 + 0.8
								let triggered = false
								if (tw === 'north' && movingN && g.position.z < dp.z + M && Math.abs(g.position.x - dp.x) <= half) triggered = true
								else if (tw === 'south' && movingS && g.position.z > dp.z - M && Math.abs(g.position.x - dp.x) <= half) triggered = true
								else if (tw === 'west' && movingW && g.position.x < dp.x + M && Math.abs(g.position.z - dp.z) <= half) triggered = true
								else if (tw === 'east' && movingE && g.position.x > dp.x - M && Math.abs(g.position.z - dp.z) <= half) triggered = true
								if (triggered) {
									// Land just inside the return door of the destination room
									// so the user can keep walking without an abrupt teleport.
									const destRoom = getRoomById(door.toRoom)
									let arrivalPos = null
									if (destRoom) {
										const ret = destRoom.doors?.find(d => d.toRoom === currentRoom.value)
										if (ret) {
											const retTW = ret.triggerSide || ret.wall
											const rdp = doorWorldXZ(destRoom, { ...ret, wall: retTW })
											const inset = 1.0
											if (retTW === 'north') arrivalPos = { x: rdp.x, z: rdp.z + inset }
											else if (retTW === 'south') arrivalPos = { x: rdp.x, z: rdp.z - inset }
											else if (retTW === 'west') arrivalPos = { x: rdp.x + inset, z: rdp.z }
											else if (retTW === 'east') arrivalPos = { x: rdp.x - inset, z: rdp.z }
										}
									}
									navigateTo(door.toRoom, { arrivalPos, arrivalRot: g.rotation.y })
									if (_walkSoundActive) { _walkSoundActive = false; audio.stopLooping() }
									doorTriggered = true; break
								}
							}
						}
						if (!doorTriggered) {
							g.position.x = Math.max(cx - hw + 0.5, Math.min(cx + hw - 0.5, g.position.x))
							g.position.z = Math.max(cz - hd + 0.5, Math.min(cz + hd - 0.5, g.position.z))
						}
					}

					if (!doorTriggered) {
						if (!_overheadExiting) {
							camTween?.kill()
							camTween = null
							gsap.killTweensOf(g.position)
							gsap.killTweensOf(cameraLookAt)

							// Camera behind avatar: lerp at delta*20 (~0.18 s to close a 4 m gap
							// from a rotated click-walk), capped at 8 m/s so a large orbit offset
							// (e.g. camera moved to avatar's front) eases in instead of snapping.
							// Small gaps (continuous following) stay below the cap — no added lag.
							const s = Math.sin(g.rotation.y)
							const c = Math.cos(g.rotation.y)
							const tCamX = g.position.x - s * 2.8
							const tCamY = 1.8
							const tCamZ = g.position.z - c * 2.8
							const dCamX = tCamX - camera.position.x
							const dCamZ = tCamZ - camera.position.z
							const dist2 = dCamX * dCamX + dCamZ * dCamZ
							if (dist2 > 0.0025) {
								const a = Math.min(1, delta * 20)
								const dist = Math.sqrt(dist2)
								const step = Math.min(dist * a, 8.0 * delta)
								const t = step / dist
								camera.position.x += dCamX * t
								camera.position.y += (tCamY - camera.position.y) * a
								camera.position.z += dCamZ * t
							} else {
								camera.position.x = tCamX
								camera.position.y = tCamY
								camera.position.z = tCamZ
							}
							cameraLookAt.x = g.position.x + s * 2.0
							cameraLookAt.y = 1.55
							cameraLookAt.z = g.position.z + c * 2.0
							camera.lookAt(cameraLookAt)
						}

						_wasdMoved = true
						if (fwdStep !== 0 && !_walkSoundActive) {
							_walkSoundActive = true
							audio.playLooping('walking-loop.mp3')
						} else if (fwdStep === 0 && _walkSoundActive) {
							_walkSoundActive = false
							audio.stopLooping()
						}
						const now = performance.now()
						if (now - _wasdLastSync > 300) {
							_wasdLastSync = now
							officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
						}
					}
				}
			}
		}

		// Seated: A / D (or arrows) rotate in place; same rate as standing. Sync pose
		// for heartbeat / pose relay; keep camera over-shoulder behind the avatar.
		if (heldKeys.size && myUserId && !isTransitioning.value && officeStore.currentSeatId && !keyboardAltHeld) {
			const g = avatarGroups.get(myUserId)
			if (g && !anyModalOpen() && !isTypingTarget(document.activeElement)) {
				const ROT_SPEED = 2.5
				const wantRot =
					heldKeys.has('KeyA') ||
					heldKeys.has('KeyD') ||
					heldKeys.has('ArrowLeft') ||
					heldKeys.has('ArrowRight')
				if (wantRot) {
					if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) g.rotation.y += ROT_SPEED * delta
					if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) g.rotation.y -= ROT_SPEED * delta
					camTween?.kill()
					camTween = null
					const s = Math.sin(g.rotation.y)
					const c = Math.cos(g.rotation.y)
					const tCamX = g.position.x - s * 2.8
					const tCamY = 1.8
					const tCamZ = g.position.z - c * 2.8
					const dCamX = tCamX - camera.position.x
					const dCamZ = tCamZ - camera.position.z
					const dist2 = dCamX * dCamX + dCamZ * dCamZ
					if (dist2 > 0.0025) {
						const a = Math.min(1, delta * 20)
						const dist = Math.sqrt(dist2)
						const step = Math.min(dist * a, 8.0 * delta)
						const t = step / dist
						camera.position.x += dCamX * t
						camera.position.y += (tCamY - camera.position.y) * a
						camera.position.z += dCamZ * t
					} else {
						camera.position.x = tCamX
						camera.position.y = tCamY
						camera.position.z = tCamZ
					}
					cameraLookAt.x = g.position.x + s * 2.0
					cameraLookAt.y = 1.55
					cameraLookAt.z = g.position.z + c * 2.0
					camera.lookAt(cameraLookAt)
					_wasdMoved = true
					const now = performance.now()
					if (now - _wasdLastSync > 300) {
						_wasdLastSync = now
						officeStore.setMyPose(g.position.x, g.position.z, g.rotation.y)
					}
				}
			}
		}

		// Procedural avatar: subtle alternating leg lift whenever moving forward/back,
		// including curves (e.g. W+A, S+D). Pure rotation (A/D only) does not trigger it.
		{
			const g = myUserId ? avatarGroups.get(myUserId) : null
			const legs = []
			if (g) {
				for (const ch of g.children) {
					if (ch.userData?.isLeg) legs.push(ch)
				}
				legs.sort((a, b) => a.position.x - b.position.x)
			}
			const wantFwdBack = heldKeys.has('KeyW') || heldKeys.has('KeyS') || heldKeys.has('ArrowUp') || heldKeys.has('ArrowDown')
			const standing = g && ((g.userData.seatY ?? 0) >= -0.001)
			const canWalkLegs = g && legs.length
				&& wantFwdBack
				&& standing
				&& !keyboardAltHeld
				&& !isTransitioning.value
				&& !officeStore.currentSeatId
				&& !anyModalOpen()
				&& !isTypingTarget(document.activeElement)
			if (canWalkLegs) {
				_wasdLegPhase += delta * Math.PI * 2 * 2.35
				const bump = 0.032
				for (let i = 0; i < legs.length; i++) {
					const leg = legs[i]
					const baseY = leg.userData.baseY ?? 0.44
					leg.position.y = baseY + bump * Math.max(0, Math.sin(_wasdLegPhase + i * Math.PI))
				}
			} else {
				_wasdLegPhase *= Math.exp(-delta * 8)
				if (standing && legs.length) {
					for (const leg of legs) {
						const baseY = leg.userData.baseY ?? 0.44
						leg.position.y += (baseY - leg.position.y) * Math.min(1, delta * 16)
					}
				}
			}
		}

		// Peer avatar leg animation — velocity-based (no keyboard access for remote users).
		// Tracks frame-to-frame XZ delta; GSAP tweens update g.position each frame so
		// speed is non-zero whenever the avatar is in motion.
		{
			const WALK_THRESHOLD = 0.1 // m/s; below this legs settle to rest
			const bump = 0.032
			for (const [uid, g] of avatarGroups) {
				if (uid === myUserId) continue
				const standing = (g.userData.seatY ?? 0) >= -0.001
				if (!standing) continue
				const legs = []
				for (const ch of g.children) {
					if (ch.userData?.isLeg) legs.push(ch)
				}
				if (!legs.length) continue
				legs.sort((a, b) => a.position.x - b.position.x)

				const prevX = g.userData._prevRenderX ?? g.position.x
				const prevZ = g.userData._prevRenderZ ?? g.position.z
				g.userData._prevRenderX = g.position.x
				g.userData._prevRenderZ = g.position.z
				const safeDelta = Math.max(delta, 0.001)
				const dx = g.position.x - prevX
				const dz = g.position.z - prevZ
				const speed = Math.sqrt(dx * dx + dz * dz) / safeDelta

				if (speed > WALK_THRESHOLD) {
					g.userData._peerLegPhase = ((g.userData._peerLegPhase ?? 0) + safeDelta * Math.PI * 2 * 2.35)
					for (let i = 0; i < legs.length; i++) {
						const leg = legs[i]
						const baseY = leg.userData.baseY ?? 0.44
						leg.position.y = baseY + bump * Math.max(0, Math.sin(g.userData._peerLegPhase + i * Math.PI))
					}
				} else {
					g.userData._peerLegPhase = (g.userData._peerLegPhase ?? 0) * Math.exp(-safeDelta * 8)
					for (const leg of legs) {
						const baseY = leg.userData.baseY ?? 0.44
						leg.position.y += (baseY - leg.position.y) * Math.min(1, safeDelta * 16)
					}
				}
			}
		}

		renderer.render(scene, camera)
		labelRenderer.render(scene, camera)
	}

	// ── Theme change ─────────────────────────────────────────────────
	function onThemeChange (e) {
		const dark = e.detail?.dark ?? true

		scene.background = new THREE.Color(dark ? 0x0d1f35 : 0xd6eaf8)
		scene.fog = new THREE.FogExp2(
			dark ? 0x0d1f35 : 0xd6eaf8,
			dark ? 0.006 : 0.004,
		)

		ambientLight.color.set(dark ? 0xc8d8f0 : 0xfff8f0)
		ambientLight.intensity = dark ? 0.85 : 1.3

		sunLight.color.set(dark ? 0x90c8e8 : 0xfff5e0)
		sunLight.intensity = dark ? 0.9 : 1.6

		fillLight.color.set(dark ? 0x304060 : 0xd8eeff)
		fillLight.intensity = dark ? 0.3 : 0.5

		renderer.toneMappingExposure = dark ? 0.9 : 1.2

		applyThemeMaterials(dark)
		syncLobbySkyMap(dark)
	}

	// ── External entity API ──────────────────────────────────────────
	// Lets composables outside the engine attach decorative/animated objects
	// (delivery bots, packages, etc.) to the scene with optional hover labels,
	// without growing this file's switch statements.
	function addEntity ({ id, group, hoverables = [], getLabel = null }) {
		if (_customEntities.has(id)) removeEntity(id)
		scene.add(group)
		_customEntities.set(id, { group, hoverables, getLabel })
	}

	function removeEntity (id) {
		const e = _customEntities.get(id)
		if (!e) return
		scene.remove(e.group)
		e.group.traverse((c) => {
			if (c.geometry) c.geometry.dispose()
			if (c.material) {
				const mats = Array.isArray(c.material) ? c.material : [c.material]
				for (const m of mats) {
					if (m.map) m.map.dispose()
					m.dispose()
				}
			}
			if (c instanceof CSS2DObject && c.element?.parentNode) {
				c.element.parentNode.removeChild(c.element)
			}
		})
		_customEntities.delete(id)
	}

	// ── Cleanup ──────────────────────────────────────────────────────
	function dispose () {
		for (const id of [..._customEntities.keys()]) removeEntity(id)
		if (_walkSoundActive) { _walkSoundActive = false; audio.stopLooping() }
		cancelAnimationFrame(animFrameId)
		resizeObserver?.disconnect()
		renderer.domElement.removeEventListener("pointerdown", onDragStart)
		renderer.domElement.removeEventListener("pointermove", onDragMove)
		renderer.domElement.removeEventListener("pointerup", onDragEnd)
		renderer.domElement.removeEventListener("wheel", onCanvasWheel)
		document.removeEventListener("keydown", onKeyDown)
		document.removeEventListener("keyup", onKeyUp)
		window.removeEventListener("blur", onWindowBlur)
		window.removeEventListener("ava-theme", onThemeChange)
		renderer.dispose()

		// CSS2DRenderer has no dispose(); just detach the DOM container so the labels
		// it manages don't linger after HMR teardown / view unmount.
		if (labelRenderer?.domElement?.parentNode) {
			labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement)
		}
		lobbySkyDayTex?.dispose(); lobbySkyDayTex = null
		lobbySkyNightTex?.dispose(); lobbySkyNightTex = null
		lobbySkyMaterial?.dispose(); lobbySkyMaterial = null
		for (const fn of worldClockDisposers) fn()
		worldClockDisposers.length = 0
		if (nowServingTex) { nowServingTex.dispose(); nowServingTex = null }
		nowServingCanvas = null
		nowServingCtx = null
		aquariumFish.length = 0
		lavaLampBlobs.length = 0
		wallClockUpdaters.length = 0
		worldClockUpdaters.length = 0
		if (dogState.woofLabel?.element?.parentNode)
			dogState.woofLabel.element.parentNode.removeChild(dogState.woofLabel.element)
		if (dogState.nameLabel?.element?.parentNode)
			dogState.nameLabel.element.parentNode.removeChild(dogState.nameLabel.element)
		dogGroup = null
		dogState.legMeshes = []
		dogState.woofLabel = null
		dogState.nameLabel = null
		// Clean Three.js objects
		scene.traverse((obj) => {
			if (obj.geometry) obj.geometry.dispose()
			if (obj.material) {
				if (Array.isArray(obj.material))
					obj.material.forEach((m) => m.dispose())
				else obj.material.dispose()
			}
		})
		renderer = null
		labelRenderer = null
		scene = null
		camera = null
	}

	// ── Public API ───────────────────────────────────────────────────
	const engine = {
		currentRoom,
		isTransitioning,
		init,
		navigateTo,
		setOverhead,
		resetCamera,
		panCameraToAvatar,
		restoreMyPose,
		setDoorOpen,
		syncDoorStates,
		spawnAvatar,
		updateAvatarLabel,
		moveAvatarToRoom,
		applyAvatarState,
		triggerEmote,
		clearEmote,
		emoteNames: Object.keys(EMOTES),
		removeAvatar,
		loadGLTFAvatar,
		updateDoorLabel,
		setAvatarTalking,
		claimSeat,
		yieldDuplicateOfficeDeskToVisitor,
		visitUser,
		dispose,
		avatarGroups,
		addEntity,
		removeEntity,
		get projectorScreenMesh () { return projectorScreenMesh },
		get officeScreenMeshes () { return officeScreenMeshes },
		setMyUserId: (id) => {
			myUserId = id
		},
		/** True during any local movement or within 3 s of completion — prevents presence spring-back. */
		isLocalMovementActive: () => _wasdMoved || !!camTween?.isActive() || (Date.now() - _localMoveEndedAt < 3000),
		setNowServingNumber: (n) => paintNowServing(n),
		/** Room id where Byte currently is (for DogPopup location / visit). */
		getDogRoomId: () => (dogGroup ? dogState.roomId : 'lobby'),
		/** Apply a remote fridge door action silently (no sound, no re-broadcast). */
		applyFridgeDoor (side, action) {
			const entry = refrigeratorDoorMeshes.find(d => d.side === side)
			if (!entry) return
			if (action === 'open') entry.door.openSilent()
			else entry.door.closeSilent()
		},
		hoverLabel,
	}

	return engine
}
