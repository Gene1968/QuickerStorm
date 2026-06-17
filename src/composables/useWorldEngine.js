// src/composables/useWorldEngine.js — Three.js scene driven by LLUDP ObjectUpdate data
import { onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import gsap from 'gsap'
import { useWorldStore, PCODE_AVATAR } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useMapStore } from '@/stores/mapStore'
import { useUiStore } from '@/stores/uiStore'
import { useDebugStore } from '@/stores/debugStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useRealtimeSocket, takeWsStats, takeWsBytes } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useAudio } from './useAudio.js'
import { useTeleport } from './useTeleport.js'
import { getTexture, clearTextureCache } from './useTextureFetch.js'
import { getPbrMaterial, getLegacyMaterial } from './useMaterialFetch.js'
import { gltfToDescriptor } from '@/lib/gltfMaterial.js'
import { getMesh, getMeshStats, getMeshBytes } from './useMeshFetch.js'
import { getSculpt } from './useSculptFetch.js'
import { getTextureStats, getTextureBytes, pumpTextures, pruneTexturesLRU, pumpTextureBuilds, setTextureRenderer, refreshTextures } from './useTextureFetch.js'
import { memStats, memUnderPressure, memRatio, setAppBytes, appRatio, appBudgetBytes, emergencyHeap, setAppBudgetOverride, setResidentCount, heapThrottled } from '@/lib/memGovernor.js'
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility } from '@/lib/cullPolicy.js'
import { objCachePut, objCacheGetAll, objCacheCrcMap, objCacheEvict, objCachePruneRegions, objCacheFlush, objCacheClearRegion } from '@/lib/objectCache.js'
import { drainWithinBudget } from '@/lib/budgetedDrain.js'
import { partitionProbes } from '@/lib/probePartition.js'
import { correctionBlend } from '@/lib/movementCorrection.js'
import { primFaceMap, slFaceForGroup, primFacesDiffer } from '@/lib/primFaceMap.js'
import { planarUVFromThree } from '@/lib/planarUV.js'
import { buildTerrainMaterial, setTerrainSlot } from '@/lib/terrainMaterial.js'
import { resolveTerrainSlot } from '@/lib/terrainTextures.js'
import { C, S } from '@shared/protocol.js'
import {
	bakePrimScale,            // bakes prim scale into the placeholder cube
	geometryHasFiniteVerts,   // NaN-vertex guard on baked geometry
	geometryFromArrays,       // worker-baked/cached arrays → BufferGeometry (applySwap + tier-1 sync cache hits)
} from '@/lib/primGeometry.js'
import { geomMemGet, geomCacheGetMany, geomCacheStore, getGeomMemBytes, initGeomCacheCap, setGeomMemBudget, getGeomMemBudget, setGeomMemPressureCap, setGeomCacheLoading, geomManifestRecord, geomManifestPrefetch, getGeomWriteBufStats } from '@/lib/geomCache.js'
import { setTexCacheLoading, getTextureWriteBufStats } from '@/lib/textureCache.js'
import { primGeomKey, meshGeomKey, sculptGeomKey } from '@/lib/geomKey.js'
import { useMeshBaker } from '@/composables/useMeshBaker.js'
import { createInstancePool } from '@/lib/instancePool.js'
import { splitParts } from '@/lib/geomParts.js'
import { materialKey } from '@/lib/instanceKey.js'

// SL uses Z-up; Three.js uses Y-up. Convert: THREE.Vector3(sl.x, sl.z, -sl.y)
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }

const ZERO_TEX_UUID = '00000000-0000-0000-0000-000000000000'
const BLANK_TEX_UUID = '5748decc-f629-461c-9a36-a35a221fe21f'  // SL built-in "Blank" (pure white)
const isRealTex = (t) => !!t && t !== ZERO_TEX_UUID && t !== BLANK_TEX_UUID
// WHY: We render one diffuse map per prim (no multi-material yet), but SL prims often leave the TE
// DEFAULT texture = Blank and texture each FACE individually. Applying only the default → white
// building. Until per-face multi-material lands, pick the best single texture: the real default if
// it has one, else the most common real per-face override. Kills the white-building case.
function pickPrimTexture(obj) {
	if (isRealTex(obj.defaultTexture)) return obj.defaultTexture
	if (Array.isArray(obj.faceTextures)) {
		const counts = new Map()
		for (const f of obj.faceTextures) if (isRealTex(f)) counts.set(f, (counts.get(f) || 0) + 1)
		let best = null, bc = 0
		for (const [id, c] of counts) if (c > bc) { bc = c; best = id }
		if (best) return best
	}
	return null
}

// WHY: a MESH asset's submeshes ARE its SL faces (each material face = one submesh → one geometry
// group, materialIndex = face index). When such a mesh carries ≥2 distinct real textures across its
// default + per-face entries, the single dominant-texture pick (pickPrimTexture) flattens a multi-
// textured surface (wall/window/trim) to one texture. Multi-material rendering needs the per-face
// data; gate on meshId only (prim box/cyl face→group mapping is unreliable — see design note).
function hasMultiFaceMesh(obj) {
	if (!obj.meshId || !Array.isArray(obj.faceTextures)) return false
	const set = new Set()
	if (isRealTex(obj.defaultTexture)) set.add(obj.defaultTexture)
	for (const f of obj.faceTextures) if (isRealTex(f)) set.add(f)
	return set.size >= 2
}

// WHY: a square box / cylinder whose faces genuinely differ → render per-face (one material per
// geometry group, remapped to SL face order via primFaceMap). Excludes meshes, placeholders, and
// any prim whose face layout we can't map exactly (primFaceMap === null). The ≥2-distinct gate
// (primFacesDiffer) keeps uniform prims on the cheap single-material path.
// Per-face PRIM materials: re-enabled 2026-06-09 — the stash-test proved per-face was NOT the
// cold-load OOM cause (memory budget now governed by memGovernor + cull/prune). If heap regresses
// on heavy regions, suspect texture fan-out here first and flip back off to confirm. (The MESH
// per-face path is independent — it was already live before this work.)
const PERFACE_PRIMS = true
function hasMultiFacePrim(obj) {
	if (!PERFACE_PRIMS) return false
	if (obj.meshId || obj._placeholder) return false
	if (!primFaceMap(obj.shape)) return false
	return primFacesDiffer(obj)
}

// Build a UV transform from TE repeat/offset/rotation, or null for identity.
// NO repeat clamp — FS parity (LLTextureEntry::setScale stores raw F32, no min/max). Huge repeats
// are legitimate content: billboard-forest sculpts phase-align grid-multiple repeats (live-verified
// palm 1f22d8ad…: RepeatV=-256 on a 32-side sculpt grid = exactly -8.0 periods per row). The old
// ±100 clamp broke that alignment; the "garbage 8215" it guarded against came from the misaligned
// full-ObjectUpdate tail decode fixed by the Data-Var2 fix (objupdate-data-var2.test.ts).
function uvXform(rep, ofs, rot) {
	if (!rep && !ofs && rot == null) return null
	const fin = (v) => (Number.isFinite(v) ? v : 1)
	const r = rep ?? [1, 1]
	return {
		repeat:   [fin(r[0]) || 1, fin(r[1]) || 1],
		offset:   ofs ?? [0, 0],
		rotation: Number.isFinite(rot) ? rot : 0,
	}
}

// #17b: module-level bridge so UI (ObjectEditFloater's Alpha-mode select) can poke the live engine
// instance without threading props through WorldView. Set on engine mount, nulled on unmount.
let _liveEngine = null
/**
 * Override how the selected object's textures treat alpha. mode: '' | null = auto (blend when the
 * texture has alpha), 'none', 'blend', 'mask', 'emissive' (renders as none — no emissive support
 * on unlit prim materials). Persists on the worldStore object so later texture re-applies keep it.
 */
export function setObjectAlphaMode(localId, mode) {
	return _liveEngine?.setObjectAlphaMode(localId, mode) ?? false
}

// Dev diagnostic: client-only render warnings (e.g. Three.js "Computed radius is NaN") never reach
// the server log. Patch console.warn/error to forward any message mentioning NaN/radius (deduped, with
// a short stack) to the server via C.CLIENT_LOG so we can locate the source. Safe no-op if already on.
const _fwdSeen = new Set()
let _origWarn = null, _origError = null
function installConsoleForwarder(emit) {
	if (_origWarn) return
	_origWarn = console.warn; _origError = console.error
	const wrap = (orig, level) => (...args) => {
		try {
			const msg = args.map(a => (typeof a === 'string' ? a : (a && a.message) || '')).join(' ')
			if (/NaN|Computed radius/i.test(msg) && !_fwdSeen.has(msg)) {
				_fwdSeen.add(msg)
				const stack = (new Error().stack || '').split('\n').slice(2, 7).join(' | ')
				emit(C.CLIENT_LOG, { level, msg: msg.slice(0, 400), stack })
			}
		} catch { /* never let logging break logging */ }
		orig.apply(console, args)
	}
	console.warn = wrap(_origWarn, 'warn')
	console.error = wrap(_origError, 'error')
}
function uninstallConsoleForwarder() {
	if (_origWarn) console.warn = _origWarn
	if (_origError) console.error = _origError
	_origWarn = _origError = null
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

const FOLLOW_DIST   = 2.75  // meters behind avatar (third-person)
const FOLLOW_HEIGHT = 2.35  // meters above avatar feet
const LOOKAT_Y      = 1.85  // meters above avatar feet for camera lookAt (lower = avatar lower in frame)

export function useWorldEngine(canvasRef) {
	const worldStore        = useWorldStore()
	const sessionStore      = useSessionStore()
	const mapStore          = useMapStore()
	const uiStore           = useUiStore()
	const debugStore        = useDebugStore()
	const notificationStore = useNotificationStore()
	const { on, off, emit: wsEmit }  = useRealtimeSocket()
	const { sendMove, sendSelect, sendDeselect, sendSetAlwaysRun, sendMapQuery } = useLLUDP()
	const meshBaker = useMeshBaker()

	// WHY: SL/OpenSim track always-run as a sticky agent flag set via SetAlwaysRun packet
	// (Low #21), NOT via AgentUpdate ControlFlags. Send once on each toggle.
	const stopAlwaysRunWatch = watch(() => uiStore.alwaysRun, (v) => sendSetAlwaysRun(v))
	const stopLitShadingWatch = watch(() => uiStore.litShading, (on) => relightScene(on))
	// MenuBar "Rebuild Scene" → full client-side recovery (clear evictions, requeue, resync).
	const stopSceneRebuildWatch = watch(() => uiStore.sceneRebuildTick, () => rebuildScene('user'))
	// ObjectContextMenu "Refresh textures" → clear one object's texture failure/cache state + re-apply.
	const stopTexRefreshWatch = watch(() => uiStore.textureRefreshReq, (req) => { if (req) refreshObjectTextures(req.localId) })
	// WHY: RegionHandshake (water level + terrain textures) usually lands after the scene is
	// built — water plane starts at the default 20m and terrain is coloured against it. When the
	// real sea level arrives, reposition the water plane and recolour terrain to match.
	const stopWaterHeightWatch = watch(() => sessionStore.waterHeight, (h) => {
		if (waterMesh) waterMesh.position.y = h
		rebuildTerrainFromStore()
	})
	// WHY no deep: App.vue's onRegionInfo replaces session.terrainTextures by reference on every
	// RegionHandshake, so a shallow ref-compare watch fires exactly when it should.
	// WHY not immediate: an immediate fire runs synchronously during setup, before `let terrainMesh`
	// (declared far below) is initialized → TDZ ReferenceError. The populated-on-setup and remount
	// cases are covered by initScene() calling loadTerrainTextures() directly; this watch only needs
	// to catch textures that arrive AFTER setup, by which point terrainMesh exists.
	const stopTerrainTexWatch = watch(
		() => sessionStore.terrainTextures,
		() => loadTerrainTextures(),
	)
	// WHY: rebuild the terrain plane when regionSize changes (var-region TP backfill arrives after
	// the geometry was built). Fires only on a real change; terrainMesh guard covers pre-initScene.
	const stopRegionSizeWatch = watch(
		() => `${sessionStore.regionSizeX}x${sessionStore.regionSizeY}`,
		() => rebuildTerrainGeometry(),
	)
	const stopGizmoSelWatch  = watch(() => uiStore.editObjectId,    () => refreshGizmo())
	// WHY: LandContextMenu "Walk To" — snap own avatar + camera to chosen terrain point.
	// Same snap logic as onAgentSpawnPos but triggered client-side via uiStore.requestWarp().
	const stopWarpWatch = watch(() => uiStore.pendingWarpPos, (pos) => {
		if (!pos) return
		const [x, y, z] = pos
		avatarSLPos = [x, y, z]
		worldStore.setAvatarPos(x, y, z)
		cameraSnapRequested = true
		if (ownAvatarLocalId) {
			const m = meshMap.get(ownAvatarLocalId)
			if (m) { const t = slToThree(x, y, z); m.position.set(t.x, t.y, t.z) }
		}
		uiStore.clearWarp()
	})
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
	let stopGeomCacheRamWatch = null
	let stopVramBudgetWatch = null
	const { playSound } = useAudio()
	const { requestTeleport } = useTeleport()

	let renderer, labelRenderer, scene, camera, animId, ro
	const meshMap = new Map()  // localId → THREE.Mesh
	// ── FEATURE-GAPS #6 draw-call instancing (gated on uiStore.instancing) ──
	const _lastMoveAt = new Map()   // localId → performance.now() of last upsert/move (settle clock)
	const _partsCache = new Map()   // geomKey → splitParts() templates (multi-material only)
	let _instancePool = null        // createInstancePool(scene), created lazily on first use
	const SETTLE_MS = 3000          // no-update dwell before an object may be instanced (tunable)
	const INSTANCE_MIGRATE_PER_TICK = 64       // max migrations per cull tick (trickle, don't hitch)
	const INSTANCE_MIGRATE_BACKLOG_MAX = 256   // skip migration while a build backlog this large drains

	function ensureInstancePool() {
		if (!_instancePool) _instancePool = createInstancePool(scene)
		return _instancePool
	}
	function disposeInstancing() {
		if (_instancePool) { _instancePool.dispose(); _instancePool = null }
		_partsCache.clear()
		_lastMoveAt.clear()
	}
	const hoverTextMeshes = new Set()  // meshes that currently have hover text
	const _htVec3 = new THREE.Vector3()  // reused for hover-text distance calc
	// WHY (perf): prim mesh builds are deferred off the WS message handler into a paced per-frame
	// drain. Region entry delivers thousands of ObjectUpdates; building all their Three.js geometry
	// synchronously inside onmessage blocked the main thread (multi-second 'message handler took Nms'
	// violations). pendingMeshIds holds prim localIds awaiting a mesh; drainMeshQueue() builds them
	// under a per-frame time budget. Dedupe is automatic (Set + fetch latest obj from worldStore).
	const pendingMeshIds = new Set()  // localId → awaiting mesh build (prims only; avatars build inline)
	// Region entry / TP floods ObjectUpdates faster than the main thread can upsert+persist them
	// synchronously (FEATURE-GAPS #11 / TP-into-heavy wedge). Raw prim objects land here and are
	// drained by pumpIngest() on the paced drain interval so the WS handler never blocks rAF.
	const _ingestQueue = []  // { o, persist } — persist:false for preseed (already cached)
	// Orphan index: parentLocalId → Set(childLocalId) waiting for that root to build. Replaces an
	// O(n) meshMap scan per build (was O(n²) overall — the dominant mesh-build cost on big regions).
	const orphansByParent = new Map()
	let _didPrecompile = false  // C1 perf: one-shot renderer.compileAsync after the initial prim drain
	let _assetStatsTimer = null  // setInterval handle for asset-loading telemetry
	let _meshDrainTimer = null   // mesh build/reparent driver — focus-independent (see onMounted)
	let _texBackfillTimer = null // re-applies textures to still-white meshes + drives fetch retries
	let _cullTimer = null        // memory-budget distance-culling tick (~1s)
	let _visTimer = null         // render-distance visibility cull tick (~200ms) — FEATURE-GAPS #13
	let _longTaskObs = null      // PerformanceObserver for main-thread long tasks (telemetry)
	const evicted = new Set()    // localIds dropped for memory (kept in worldStore + IDB; rebuilt on approach)
	// Cull thresholds are fractions of the SELF-ACCOUNTED asset budget (memGovernor appRatio:
	// tex + mesh-cache + geometry bytes vs appBudgetBytes), NOT process heap. Process heap counts
	// uncollected garbage and can be inherited from a previous page in the same renderer process —
	// both lied hard during busy-region cold loads (heap read 87-95% forever → the culler evicted
	// the entire scene to zero while 1.1GB sat in an unbounded mesh cache). appRatio is truthful and
	// immediate, so eviction stops exactly when enough far geometry has actually been released.
	// R_NEAR < (implicit evict radius): far objects evict first under pressure; only objects within
	// R_NEAR rebuild — hysteresis prevents thrash at the boundary. Per-tick caps spread the
	// dispose/build work so the frame doesn't hitch.
	const CULL_TARGET = 1.0      // evict while resident assets exceed the budget
	const CULL_RESUME = 0.85     // below this, stream evicted objects back at ANY distance (nearest first).
	// WHY: a transient over-budget spike can trip CULL_TARGET for a few ticks and evict thousands of
	// roots; with reload capped to _effNear the scene would stay gutted once pressure clears.
	// With real headroom, distance is no reason to keep anything evicted.
	//
	// DYNAMIC draw distance (was a fixed R_NEAR=96): the effective residency/stream radius the culler
	// protects + rebuilds within. WHY dynamic — a FIXED never-evict radius WEDGES on dense regions:
	// when geometry WITHIN the radius alone exceeds the budget, eviction (which only touches objects
	// BEYOND the radius) runs out of candidates while still over budget → permanent ⚠THROTTLING with
	// textures pruned to zero (measured 2026-06-13: app 131%, geomMB 1630, texMB 0, scene wedged).
	// Fix: the governor STEPS _effNear DOWN when over budget and nothing is evictable (so eviction
	// always regains candidates), and STEPS it UP toward the user target with headroom (FS progressive-
	// stepping equivalent; FS shrinks mDrawDistance the same way off frame-time/VRAM — a browser has
	// no VRAM query, so we drive it off the self-accounted byte budget). Light regions never hit
	// pressure → _effNear stays at target = the old fixed-96 behavior, no regression.
	const DRAW_DIST_DEFAULT = 96 // fallback target when uiStore is unset
	const DRAW_DIST_MIN = 32     // metres — emergency floor; immediate surroundings always stay resident
	const DRAW_DIST_STEP = 16    // metres per governor step (down under pressure / up with headroom)
	// Render-distance visibility cull (FEATURE-GAPS #13, render ceiling): hysteresis band (m) for the
	// show/hide boundary at _effNear. Hidden beyond _effNear, shown within (_effNear - this) → no flicker
	// for objects parked at the edge. Runs ~5×/s (own timer) — far cheaper than the per-frame traversal
	// it removes. Hides only (keeps meshes resident for instant re-show); eviction stays VRAM-driven.
	const VIS_CULL_HYSTERESIS = 16
	// Geom RAM-cache heap-pressure cap (FEATURE-GAPS #13) — see cullTick. The mem tier shares the tab
	// heap, so clamp it when the process heap is tight. Hysteresis (cap above CAP_AT, release below
	// RELEASE_AT) avoids thrashing; FLOOR is both the shrink target and the "worth shedding" gate.
	const GEOM_MEM_HEAP_CAP_AT     = 0.82            // process-heap ratio that triggers the cap
	const GEOM_MEM_HEAP_RELEASE_AT = 0.68            // ...and the ratio that releases it
	const GEOM_MEM_CAP_FLOOR       = 96 * 1024 * 1024 // bytes: shrink the mem tier to this under pressure
	let _effNear = DRAW_DIST_DEFAULT   // governor-managed effective radius (replaces the old fixed R_NEAR)
	// "Major load" badge preface is triggered by DURATION, not object count — a dense but already-cached
	// area reloads in 1-2s as you move and must NOT warn. Only a load still streaming after this long
	// (a genuinely big/uncached scene) prepends "Major new scenery to cache". Tunable.
	const MAJOR_LOAD_MS = 6000
	let _loadEpisodeStart = 0    // ms timestamp the current continuous load (pct<100) began; 0 = idle
	// WHY small caps: evicting/freeing hundreds of meshes in one tick caused a GC + main-thread stall
	// that delayed the 10Hz AgentUpdate + PacketAcks → the sim's view of the agent lagged → position
	// snap-backs and stalled ObjectSelect→ObjectProperties. Small per-tick work keeps the churn smooth
	// so movement + the circuit stay healthy; the scene still converges over a few seconds.
	const MAX_EVICT_PER_TICK = 32
	const MAX_RELOAD_PER_TICK = 48
	const EVICT_AFTER_TICKS = 3  // require N consecutive over-target ticks before evicting (spike debounce)
	let _overTicks = 0
	let _lastGeomB = 0           // live-geometry bytes, refreshed by the 3s telemetry scan (O(n))
	let _lastDrainTickAt = 0     // last 30ms-interval drain tick — animate() drains only when this starves
	let _cullStatTick = 0        // throttle the O(n) stats scan (every Nth cull tick)
	let _drainBuilt = 0, _drainMs = 0, _drainMaxMs = 0  // upsertMesh throughput probe (reset each 5s report)
	let _applyN = 0, _applyMs = 0, _applyMaxMs = 0      // applySwap (bake-result → THREE geometry) probe
	// Geometry-cache telemetry (reported + reset by the 5s [Bake] line)
	let _geomHitMem = 0, _geomHitIdb = 0, _geomMiss = 0
	// Deferred-lookup backpressure: requestGeometry entries whose async IDB lookup hasn't settled
	// yet. Each is a potential future bake the drain loop's inflight cap must see (see
	// drainMeshQueue) — otherwise a cold load floods thousands of misses past the cap before
	// meshBaker.outstanding() rises. Every entry decrements exactly once: when it's served from
	// cache, applied bad/null, dropped post-unmount, or its jobThunk is invoked (at which point
	// outstanding() takes over the accounting).
	let _geomPending = 0
	// WHY: set on unmount so in-flight lookup batches are dropped — applying them would sync-bake
	// on the disposed baker and mutate orphaned meshes.
	let _engineDead = false

	// Per-region geomKey set for the manifest (warm-read front-load, FEATURE-GAPS #10). cullTick
	// detects region changes (login / TP / cross-region) by sessionStore region coords, resets the
	// set + prefetches that region's manifest, and records the set when the load settles.
	let _regionGeomKeys = new Set()
	let _currentRegionKey = null
	let _wasLoading = false   // settle-edge detector: re-record the manifest on each loading true→false

	// WHY microtask batching: every requestGeometry() call within one synchronous burst (one
	// drainMeshQueue tick, one evict re-stream pass…) coalesces into ONE qs-geom readonly txn —
	// the per-prim-transaction storm is the exact pattern that starved texCacheGet. Same trick
	// as useMeshBaker's flush.
	let _geomLookupBatch = []
	// WHY watchdog: geomCacheGetMany resolves on tx.oncomplete, but during a heavy region-load write
	// storm the readonly lookup txn can be starved for many seconds and effectively never settle — so
	// its .then never runs and _geomPending never decrements for that batch. Once the leak pushes
	// _geomPending past BAKE_INFLIGHT_CAP (300), drainMeshQueue's backpressure breaks EVERY tick and
	// mesh building halts (measured live: scene wedged at ~609/13,338 meshes ≈ 3%, pend frozen at
	// 301). Racing a timeout that degrades the batch to an all-miss bake guarantees _geomPending
	// always drains, so a slow/starved cache read can never brick the drain. Mirrors the texCacheGet
	// watchdog (commit 4b9155c). Healthy warm reads resolve in well under 1s; only genuinely starved
	// batches trip this.
	const GEOM_LOOKUP_WATCHDOG_MS = 4000
	let _geomLookupWatchdogN = 0   // lookup batches that timed out → degraded to bake (telemetry)
	function requestGeometry(key, jobThunk, applySwap) {
		_regionGeomKeys.add(key)
		_geomPending++
		_geomLookupBatch.push({ key, jobThunk, applySwap })
		if (_geomLookupBatch.length === 1) queueMicrotask(_flushGeomLookups)
	}
	function _flushGeomLookups() {
		if (!_geomLookupBatch.length) return
		const batch = _geomLookupBatch
		_geomLookupBatch = []
		// WHY by-key grouping + per-entry clones: applySwap ratio-rescales positions and regenerates
		// UVs IN PLACE, so every mesh must own its arrays outright. geomCacheGetMany returns ONE clone
		// per unique key — duplicate keys in a batch (identical prims) sharing that clone would
		// cross-contaminate each other's geometry. Each sibling therefore pulls its own fresh clone
		// from the memory tier (geomMemGet clones per call), never a shared or cache-owned buffer.
		const byKey = new Map()
		for (const b of batch) {
			const list = byKey.get(b.key)
			if (list) list.push(b)
			else byKey.set(b.key, [b])
		}
		// settled guard: the watchdog and the real getMany race; whichever lands first processes the
		// batch, the loser is ignored. A late getMany resolve after a watchdog bake is harmless — its
		// keys are already baking and its mem-tier promotion is idempotent (keys are content hashes).
		let settled = false
		const processHits = (hits) => {
			if (settled) return
			settled = true
			// WHY: post-unmount batches would sync-bake on the disposed baker + mutate orphaned meshes.
			if (_engineDead) { _geomPending -= batch.length; return }
			for (const [key, entries] of byKey) {
				const arrays = hits.get(key)
				if (!arrays) { _bakeGeomGroup(key, entries); continue }
				// IDB hit: getMany promoted the key into the memory tier and returned one clone — it
				// serves the first entry; every additional entry gets its own fresh clone via geomMemGet.
				_geomHitIdb++; _geomPending--
				entries[0].applySwap(arrays)
				let evictedSiblings = null
				for (let i = 1; i < entries.length; i++) {
					const clone = geomMemGet(key)
					if (clone) { _geomHitIdb++; _geomPending--; entries[i].applySwap(clone) }
					// Mem tier evicted the key between promote and read (rare) → real miss path.
					else (evictedSiblings ??= []).push(entries[i])
				}
				if (evictedSiblings) _bakeGeomGroup(key, evictedSiblings)
			}
		}
		const wd = setTimeout(() => {
			if (settled) return
			_geomLookupWatchdogN++
			processHits(new Map())   // degrade to all-miss: bake everything so _geomPending drains
		}, GEOM_LOOKUP_WATCHDOG_MS)
		geomCacheGetMany([...byKey.keys()]).then(hits => { clearTimeout(wd); processHits(hits) })
	}
	// Miss path for one key's entries: ONE real bake (entries[0]'s thunk), siblings served as fresh
	// clones from the just-stored memory-tier entry. Siblings must NEVER receive the raw worker
	// `out` — geomCacheStore takes ownership of those buffers, so handing them out would alias
	// cache-owned arrays into a mesh that mutates them in place.
	//
	// LEAK-PROOF accounting: release the WHOLE group from _geomPending up front (here), not inside the
	// bake's .then. WHY: _geomPending feeds drainMeshQueue's backpressure cap; the old code decremented
	// the siblings only after the bake resolved, so a worker job that never reported back (region churn,
	// localId removed mid-flight) stranded those entries in _geomPending forever — a slow creep that
	// kept the counter stuck (measured ~162 at idle) and risked re-tripping BAKE_INFLIGHT_CAP on dense
	// regions. Once released, the single real bake is tracked by meshBaker.outstanding(); the siblings
	// are cheap mem-tier clones, not worker load, so the cap shouldn't count them anyway.
	function _bakeGeomGroup(key, entries) {
		_geomPending -= entries.length
		_dispatchBake(key, entries)
	}
	// Dispatches the worker bake and serves the group. Pending is ALREADY released by the caller —
	// this function never touches _geomPending (so the recursive evicted-sibling re-bake below can't
	// double-count). Safe to call directly only when the entries' pending has been accounted.
	function _dispatchBake(key, entries) {
		_geomMiss++
		entries[0].jobThunk().then(out => {
			// WHY: engine unmounted while the bake was in flight — drop the remaining entries.
			if (_engineDead) return
			if (!out || out.bad) {
				// Bad/null bake: every entry keeps its placeholder (applySwap bails on bad input).
				for (const e of entries) e.applySwap(out)
				return
			}
			// Store FIRST (cache takes ownership of the worker-transferred buffers), swap the
			// returned copy — applySwap may ratio-rescale in place, which must never touch the entry.
			entries[0].applySwap(geomCacheStore(key, out))
			for (let i = 1; i < entries.length; i++) {
				const clone = geomMemGet(key)
				// Siblings ARE memory-tier serves (the store just populated tier 1) — count them as
				// mem hits so the hit/miss telemetry stays meaningful (one real bake per key).
				if (clone) { _geomHitMem++; entries[i].applySwap(clone) }
				// Store entry already evicted (rare) → this sibling runs its OWN bake (never raw `out`).
				else _dispatchBake(key, [entries[i]])
			}
		})
	}
	// Drain-loop exit accounting: why does each tick stop? (ticks that ran / skipped-empty /
	// governor-paused / broke on bake-cap / broke on time budget). Reset each 5s report.
	let _dtTicks = 0, _dtEmpty = 0, _dtGov = 0, _dtBrkCap = 0, _dtBrkBudget = 0
	let _frN = 0, _frMs = 0, _frMaxMs = 0               // rAF frame-work gauge (reset each 5s report)
	let _ltN = 0, _ltMs = 0, _ltMaxMs = 0               // PerformanceObserver longtask totals
	let _ltTotalMs = 0                                  // never-reset longtask accumulator (lit-gate reads deltas)
	const _phaseMs = {}   // #11 attribution (DEV): timed() phase → accumulated main-thread ms this window
	let _lastTexReq = 0, _lastMeshReq = 0  // last logged request counts (skip log when idle + unchanged)
		// Persistent object cache: repaint the scene instantly on reload from IndexedDB, then let live
		// ObjectUpdates correct it. Region key = global X/Y coords; live data wins (replay never
		// clobbers an already-arrived localId). See lib/objectCache.js.
		let _objCacheLoadedKey = null
		const regionCacheKey = () => {
			// Global region coords only — set at login, so identical at save AND load. (regionName
			// arrives via RegionHandshake which can land AFTER the first ObjectUpdate, so including it
			// made the load key miss the saved record.)
			const rx = sessionStore.regionX, ry = sessionStore.regionY
			return (!rx && !ry) ? null : `${rx}_${ry}`
		}
		async function preseedRegionCache() {
			const key = regionCacheKey()
			if (!key || key === _objCacheLoadedKey) return
			// Region-run gate: localIds die with the region run. WHY wait for the CacheID: replaying
			// before validation paints objects whose localIds the sim may no longer know — ghost
			// duplicates that render but silently brick ObjectSelect/edit ("Loading properties…"
			// forever) and double the scene's memory. RegionHandshake lands within ~1s of the circuit,
			// so deferring the instant-paint until then is imperceptible. (preseed is re-invoked on
			// every ObjectUpdate, so this retries until the CacheID is known.)
			const runId = sessionStore.regionCacheId
			if (!runId) return
			_objCacheLoadedKey = key
			const runKey = `qs-objrun:${key}`
			let storedRun = null
			try { storedRun = localStorage.getItem(runKey) } catch { /* private mode etc. */ }
			if (storedRun !== runId) {
				// Run changed — or unknown (records cached before run-tracking existed): either way the
				// records can't be trusted, so drop them and let this session rebuild the cache fresh.
				// WHY try/catch + always-resync: this await once hung FOREVER (cursor-walk purge wedged,
				// txn aborted with no onabort route) — preseed died silently, the probe resync below
				// never fired, and the scene starved at 47/5,572 prims. A failed purge must never block
				// the probe pipeline: skip the run-marker write (next session retries the purge) and let
				// probes reconcile — stale records only cost harmless re-requests via the crcMap reset.
				let n = 0, purged = true
				try { n = await objCacheClearRegion(key) }
				catch (e) {
					purged = false
					debugStore.push('warn', `[ObjCache] region purge FAILED (${e?.message ?? e}) — degrading to request-all`)
				}
				if (n) debugStore.push('warn', `[ObjCache] region run ${storedRun ? 'changed' : 'unknown'} (CacheID ${(storedRun ?? '????????').slice(0, 8)}→${runId.slice(0, 8)}) — dropped ${n} stale cached objects, skipping replay`)
				if (purged) { try { localStorage.setItem(runKey, runId) } catch { /* ignore */ } }
				// Probes arriving DURING the purge may have memoized a pre-purge crcMap — those CRCs
				// belong to the dead region run. Reset so the next batch rebuilds from the purged store.
				_crcMapKey = null
				requestProbeResync()
				return
			}
			const cached = await objCacheGetAll(key)
			let n = 0
			for (const o of (cached ?? [])) {
				if (o.pcode === PCODE_AVATAR || typeof o.localId !== 'number') continue
				if (worldStore.objects.has(o.localId)) continue
				// Paced through pumpIngest like live updates — a warm region's full cache (~28k) must
				// not upsert in one synchronous loop. persist:false: these came FROM the cache.
				_ingestQueue.push({ o, persist: false })
				n++
			}
			// Seed the probe crcMap from this read — it already holds every record, so the partition
			// never needs its own IDB walk racing the persist write stream (the 3s-timeout → empty-map
			// path that silently turned warm sessions into request-all re-feeds).
			const seeded = new Map()
			for (const o of (cached ?? [])) {
				if (typeof o?.localId === 'number' && typeof o?.crc === 'number') seeded.set(o.localId, o.crc)
			}
			_crcMapKey = key
			_crcMapP = Promise.resolve(seeded)
			if (n) debugStore.push('info', `[ObjCache] pre-seeded ${n} cached objects for ${key} (run ${runId.slice(0, 8)}, crcMap=${seeded.size})`)
			objCachePruneRegions()  // LRU housekeeping (fire-and-forget)
			requestProbeResync()
		}
		// WHY: the sim floods ObjectUpdateCached probes in the first seconds after login — before this
		// engine registered its WS handlers — so the initial forwards dispatched into the void (seen
		// live: sim probed 23.8k ids, client requested 2.2k, scene stuck at ~3k objects). The server
		// buffers every probe; this asks for a full replay. Called from preseedRegionCache AFTER the
		// cache-run validation/purge so replayed probes are never CRC-matched against records the
		// purge is about to delete (that race silently marked everything "hit" and requested nothing).
		function requestProbeResync() {
			try { wsEmit(C.OBJ_PROBE_RESYNC, {}) } catch { /* not connected yet — live probes still flow */ }
			debugStore.push('info', '[ObjCache] requested probe-backlog resync (engine ready)')
		}
		// WHY: sim's ObjectUpdateCached, forwarded by the server. CRC-match against our
		// persistent cache → hit (already pre-seeded/rendered, no request). Miss → ask the
		// server to request a full update (C.OBJ_CACHE_MISS → cacheMissPending drain).
		let _probeStats = { batches: 0, hits: 0, misses: 0 }
		let _probeRx = 0
		// Memoized per-region crcMap. WHY: the probe-backlog replay delivers ~120 chunks in seconds;
		// reading the crcMap PER CHUNK is ~120 full-region IDB cursor walks racing the object-cache
		// WRITE stream (readwrite txns lock out readers) — observed live as every read timing out and
		// the whole region load silently dying. One walk per region, shared by all chunks. Slightly
		// stale entries (objects re-cached this session) just mark extra misses → harmless re-requests.
		let _crcMapKey = null, _crcMapP = null
		function getRegionCrcMap(key) {
			if (key !== _crcMapKey) {
				_crcMapKey = key
				let p
				p = Promise.race([
					objCacheCrcMap(key),
					new Promise((_, rej) => setTimeout(() => rej(new Error('crcMap timeout (3s)')), 3000)),
				]).catch(e => {
					try { wsEmit(C.CLIENT_LOG, { level: 'warn', msg: `[Probe] crcMap failed (${e.message}) — this batch degrades to request-all`, stack: '' }) } catch { /* ignore */ }
					// WHY un-memoize: caching this empty map poisoned the WHOLE session — one transient
					// IDB starvation (read queued behind the persist flush stream) turned every later
					// probe batch into request-all, re-feeding ~20k objects despite a valid cache. Fail
					// only the batches in flight; the next batch retries the read (or gets the preseed-
					// seeded map). Promise-identity guard: preseed may have installed its seeded map
					// while this race was still pending — never clobber that.
					if (_crcMapP === p) { _crcMapKey = null; _crcMapP = null }
					return new Map()   // empty map → these probes partition as misses (request-all)
				})
				_crcMapP = p
			}
			return _crcMapP
		}
		async function onObjCacheProbe(payload) {
			let probes = payload?.probes ?? []
			if (!probes.length) return
			// SYNC entry log (before any await): distinguishes "frames never arrived" from "handler
			// died awaiting IDB" — an async handler that hangs on objCacheCrcMap fails silently.
			_probeRx++
			if (_probeRx % 25 === 1) {
				try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: `[Probe] rx batch #${_probeRx} (${probes.length} ids)`, stack: '' }) } catch { /* ignore */ }
			}
			// Already live in worldStore (received this session) → nothing to request or paint.
			probes = probes.filter(p => !worldStore.objects.has(p.localId))
			if (!probes.length) return
			const key = regionCacheKey()
			if (!key) { wsEmit(C.OBJ_CACHE_MISS, { ids: probes.map(p => p.localId) }); return }
			const crcMap = await getRegionCrcMap(key)
			const { hits, misses } = partitionProbes(probes, crcMap)
			if (misses.length) wsEmit(C.OBJ_CACHE_MISS, { ids: misses })
			if (hits.length) debugStore.push('info', `[ObjCache] ${hits.length} probe hits (cached), ${misses.length} misses requested`)
			// Probe-flow diagnostic → server log: asked=0 all day in PrimDiag while distinct≈24k says
			// the miss path is silently dead somewhere between this partition and the server drain.
			_probeStats.batches++; _probeStats.hits += hits.length; _probeStats.misses += misses.length
			if (_probeStats.batches % 50 === 1) {
				const line = `[ObjCache] probe flow: ${_probeStats.batches} batches, hits=${_probeStats.hits} misses=${_probeStats.misses} (crcMap=${crcMap.size})`
				try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: line, stack: '' }) } catch { /* ignore */ }
			}
		}
	let _tpSceneCleared = false  // true after onTeleportFinish clears scene; cleared by first AgentSpawnPos
	// Arriving-overlay gate: the avatar is placed on the first AgentSpawnPos, but the overlay
	// historically waited for a 2nd packet that can be starved (flood) or never sent (some grids).
	// _tpSettleTimer clears the overlay shortly after the avatar is placed; _tpArrivalTimer is the
	// hard failsafe so it can never hang. Region membership is unchanged (TeleportFinish = committed).
	let _tpSpawnApplied = false   // a non-zero destination spawn pos applied since TeleportFinish
	let _tpSettleTimer = null
	let _tpArrivalTimer = null
	const TP_SETTLE_MS = 2500
	const TP_ARRIVAL_MS = 12000
	function clearTpTimers() {
		if (_tpSettleTimer) { clearTimeout(_tpSettleTimer); _tpSettleTimer = null }
		if (_tpArrivalTimer) { clearTimeout(_tpArrivalTimer); _tpArrivalTimer = null }
	}
	function onTpArrivalTimeout() {
		_tpArrivalTimer = null
		if (uiStore.teleportStatus !== 'arriving') return
		clearTpTimers()
		uiStore.teleportStatus = ''
		if (_tpSpawnApplied) {
			debugStore.push('warn', '[3D] TP arrival: spawn applied but no confirming AgentSpawnPos within 12s — clearing overlay')
		} else {
			// Option (b): committed to the destination (TeleportFinish swapped the socket) but it
			// never spoke. Tell the user why the screen cleared into a sparse scene; we can't undo it.
			notificationStore.notify({ title: 'Teleport', body: 'Teleport is taking longer than expected…', icon: '⏳', toast: true })
			debugStore.push('warn', '[3D] TP arrival timeout: no destination spawn pos within 12s — clearing overlay')
		}
	}
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
	// WHY: after landing, the sim still has the avatar in-air for ~RTT ms. TerseUpdates during
	// that window can have d > 5m (arc height + any XY drift), triggering a Z snap that causes a
	// single post-landing bounce. Grace period keeps airborne suppression active until those
	// stale packets flush, even though vertVel just became 0.
	let landingGraceTimer = 0
	const LANDING_GRACE = 0.4  // seconds — covers ~200ms RTT with margin
	const GRAVITY       = 9.8   // m/s²
	const TERMINAL_VEL  = 50    // m/s downward cap
	const FOOT_CLEAR    = 1.0   // m — capsule centre above terrain surface when grounded
	// WHY: SL jump impulse — peak height = JUMP_VEL² / (2·GRAVITY). 9.0 m/s → ~4.1m peak,
	// ~1.84s total duration. Matches Firestorm's observed ~4m jump height. Edge-triggered:
	// applied once on E keydown.
	const JUMP_VEL      = 9.0
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
	// WHY: horizontal dead-reckoning velocity (SL m/s). Ramped toward the desired velocity each
	// frame so the avatar accelerates on key press and SKIDS to a stop on release — mirroring the
	// sim's own deceleration. Instant stop left avatarSLPos behind the still-coasting sim, and the
	// TerseUpdate correction then rubber-banded across that gap.
	let drVelX = 0, drVelY = 0
	const DR_ACCEL_RATE = 25  // velocity ramp-up on press (1/s) — reaches speed in ~0.12s
	const DR_DECEL_RATE = 4   // skid-to-stop decay on release (1/s) — ~0.4s glide, matches sim feel
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
	const CAM_RETURN_RATE = 4 // gentle glide-back when exiting alt-orbit far away (~0.8s)
	const CAM_LOOK_RATE = 8   // ~0.09s half-life — slower glide on rotation
	// WHY: tight rate for both position and lookAt while airborne. The normal distToTarget
	// boost is designed for horizontal orbit-exit, not vertical jumps — applying it during
	// a parabola desynchronises position and lookAt rates and creates the post-landing bounce.
	// A single tight rate keeps camera and view angle in lockstep through the arc.
	const CAM_AIR_RATE  = 25  // snappy airborne tracking, ~0.028s half-life

	// Alt-orbit (third-person camera): alt+drag orbits around a pivot
	let isAltOrbit  = false
	let orbitPivot  = new THREE.Vector3(128, 0, -128)  // SL center in Three.js coords
	let orbitRadius = 8   // metres from pivot
	let orbitYaw    = 0   // orbit horizontal angle
	let orbitPitch  = 0.3 // orbit vertical angle (radians)
	let focusTween  = null // GSAP tween gliding orbitPivot to a clicked focal point
	let focusGliding = false // true while the focal-point glide holds the camera fixed
	const orbitGlideCamPos = new THREE.Vector3() // camera pos held still during the glide
	let camReturning = false // true while gliding the follow-cam back after exiting alt-orbit

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
			camReturning = true // glide the follow-cam home rather than snapping
			endFocusGlide()
			// WHY: if orbit entered NaN state (asin clamp was missing in prior sessions or
			// some other corruption), camera.position is NaN and the follow-camera lerp
			// can never recover (lerp(NaN, valid, f) = NaN). Hard-snap here clears it.
			if (camera && !isFinite(camera.position.x)) {
				const ap = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
				camera.up.set(0, 1, 0)
				camera.position.set(ap.x + Math.sin(yaw) * followDist, ap.y + FOLLOW_HEIGHT, ap.z + Math.cos(yaw) * followDist)
				camera.lookAt(ap.x, ap.y + LOOKAT_Y, ap.z)
				camLookInit = false
			}
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
			const ap = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			orbitPivot.set(ap.x, ap.y + LOOKAT_Y, ap.z)
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
		// WHY: clamp to ±0.99 to prevent Math.asin(>1) → NaN when camera is >radius above
		// the pivot (e.g. avatar at ground, camera high up); also avoids ±π/2 gimbal lock.
		orbitPitch  = Math.asin(Math.max(-0.99, Math.min(0.99, dy / orbitRadius)))
		orbitYaw    = Math.atan2(dx, dz)
		isAltOrbit  = true
		camReturning = false // entering orbit cancels any in-progress glide-back
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

	// WHY: Derive spherical orbit params (radius/pitch/yaw) from the camera's CURRENT
	// position relative to orbitPivot. Used to hand off from a focal-point glide to manual
	// orbit-drag/zoom without a jump — the reconstructed pose equals where the camera is.
	// ±0.99 guard: ocean surface at y=0 with camera high up gives dy/clamped-radius > 1 →
	// NaN pitch → NaN camera pos → unrecoverable.
	function recomputeOrbitFromCamera() {
		const dx = camera.position.x - orbitPivot.x
		const dy = camera.position.y - orbitPivot.y
		const dz = camera.position.z - orbitPivot.z
		const r  = Math.hypot(dx, dy, dz)
		orbitRadius = Math.max(2, Math.min(128, r))
		orbitPitch  = Math.asin(Math.max(-0.99, Math.min(0.99, dy / orbitRadius)))
		orbitYaw    = Math.atan2(dx, dz)
	}

	// WHY: End an in-progress focal-point glide. Lock spherical params from the now-fixed
	// camera so whatever happens next (orbit-drag, zoom, another click) continues seamlessly.
	function endFocusGlide() {
		if (focusTween) { focusTween.kill(); focusTween = null }
		if (focusGliding) {
			focusGliding = false
			if (isAltOrbit && camera) recomputeOrbitFromCamera()
		}
	}

	// WHY: Alt+click camera focal-point pick — raycast against terrain + objects, then GLIDE
	// the focus to the hit point. The camera is held perfectly still (orbit, never zoom):
	// only the look target eases over. Matches SL/Firestorm (Alt-LMB sets focus, Alt-drag
	// orbits around it). Seeding orbitPivot from the current look target before the tween
	// avoids a one-frame snap to a stale orbit pose (the "jumps below ground" glitch).
	function enterOrbitAt(pivot) {
		if (focusTween) focusTween.kill()
		// Seed the glide's START at where the camera currently looks (avatar when entering
		// fresh from follow-cam; the existing pivot when already orbiting).
		if (!isAltOrbit && avatarSLPos) {
			const ap = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			orbitPivot.set(ap.x, ap.y + LOOKAT_Y, ap.z)
		}
		isAltOrbit = true
		focusGliding = true
		camReturning = false // a new focus pick cancels any in-progress glide-back
		orbitGlideCamPos.copy(camera.position) // freeze the camera here for the whole glide
		focusTween = gsap.to(orbitPivot, {
			x: pivot.x, y: pivot.y, z: pivot.z,
			duration: 0.8,
			ease: 'power2.out',
			overwrite: true,
			onComplete: () => {
				focusTween = null
				focusGliding = false
				recomputeOrbitFromCamera()
			},
		})
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
			if (_instancePool) for (const im of _instancePool.meshes()) primTargets.push(im)
			const hits = _raycaster.intersectObjects(primTargets, true)
			if (hits.length > 0) {
				let clicked = null
				const hit = hits[0]
				if (hit.object?.userData?.qsInstanced) {
					clicked = _instancePool.pick(hit.object, hit.instanceId)
				} else {
					let m = hit.object
					while (m && m.userData?.localId === undefined) m = m.parent
					if (m?.userData?.localId != null) clicked = m.userData.localId
				}
				if (clicked != null) {
					// WHY: FS parity — unless "Edit linked" is on, a click selects the whole linkset
					// (walk up to the root prim). positionGizmo() bboxes the root mesh, which contains
					// all linked children, so the gizmo centers on the entire object. stopSelSyncWatch
					// reacts to editObjectId and emits the ObjectSelect.
					uiStore.editObjectId = uiStore.editLinked ? clicked : resolveRootLocalId(clicked)
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
		// WHY: Manual orbit-drag takes over from any in-progress focus glide.
		endFocusGlide()
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
			followDist = Math.max(2.0, Math.min(20, followDist - delta))
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
			endFocusGlide() // keyboard orbit/zoom takes over from any in-progress glide
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
			// WHY: During a focal-point glide the camera is pinned in place — only the look
			// target eases over to the clicked point. No spherical math = no zoom, ever.
			if (focusGliding) {
				camera.position.copy(orbitGlideCamPos)
				camera.lookAt(orbitPivot)
				return 0
			}
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
			// 512m (was 256): on a 512m region ~half stayed out of interest (live unfulfilled=7673/15591).
				// 512 reaches the whole standard region from any spawn so the sim satisfies region-wide
				// cache-miss requests. Sim caps draw distance server-side, so over-asking is safe.
				far:       512,
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
		else if (d <=   0) rgb = lerpRgb(TAN, SAND,                              (d + 1) / 1)     // tan → sand at shoreline (d=-1..0)
		else if (d <=   1) rgb = lerpRgb(SAND, GRASS,                            (d - 0) / 1)     // sand → grass, done at d=1 (avatar at 22m = terrain 21m = d=1)
		else if (d <=  30) rgb = lerpRgb(GRASS, [0.45, 0.42, 0.35],             (d - 1) / 29)     // grass → earthy
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
				// Sanitize: a partial/failed terrain decode (log: "buf-exhausted") can leave NaN
				// heights → NaN vertex → Three.js "Computed radius is NaN" + the patch goes invisible.
				const raw  = worldStore.terrainHeights[hIdx]
				const h    = Number.isFinite(raw) ? raw : 0
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

	let terrainShaderMaterial = null   // built lazily once textures arrive
	let _terrainVtxMaterial   = null   // the original MeshBasicMaterial, kept for region resets

	// WHY: the bundled default WebP tiles are decoded ONCE and shared across every slot, region
	// cross, and remount. TextureLoader.load allocates a fresh THREE.Texture each call and
	// Material.dispose() doesn't free uniform textures — without this memo, loadTerrainTextures
	// would orphan ~4 MB of GPU texture per run (deep watch + region cross + remount = unbounded).
	// These shared textures are app-lifetime (≤4 tiles) and intentionally never disposed; custom
	// slots come from getTexture() which owns its own LRU. _bundledPending dedups concurrent loads.
	const _bundledTerrainTex     = new Map()  // url -> shared THREE.Texture
	const _bundledTerrainPending = new Map()  // url -> Array<cb> while a load is in flight
	function loadBundledTerrainTex(url, onReady) {
		const cached = _bundledTerrainTex.get(url)
		if (cached) { onReady(cached); return }
		const pending = _bundledTerrainPending.get(url)
		if (pending) { pending.push(onReady); return }
		_bundledTerrainPending.set(url, [onReady])
		new THREE.TextureLoader().load(url, (tex) => {
			_bundledTerrainTex.set(url, tex)
			const cbs = _bundledTerrainPending.get(url) || []
			_bundledTerrainPending.delete(url)
			for (const cb of cbs) cb(tex)
		})
	}

	// WHY: RegionHandshake gives 4 detail-texture UUIDs + per-corner start/range. Known
	// default UUIDs paint instantly from bundled WebP (no grid fetch / no J2C decode);
	// custom UUIDs stream through the normal texture pipeline and swap in when decoded.
	function loadTerrainTextures() {
		if (!terrainMesh) return
		const tt = sessionStore.terrainTextures
		if (!tt || !Array.isArray(tt.detail)) return

		if (!terrainShaderMaterial) {
			terrainShaderMaterial = buildTerrainMaterial({
				startHeight: tt.startHeight,
				heightRange: tt.heightRange,
				regionSizeX: sessionStore.regionSizeX,
				regionSizeY: sessionStore.regionSizeY,
			})
		} else {
			terrainShaderMaterial.uniforms.uStartHeight.value.set(...tt.startHeight)
			terrainShaderMaterial.uniforms.uHeightRange.value.set(...tt.heightRange)
		}

		// Max anisotropy kills the grazing-angle "grain" on terrain (renderer exists — created in
		// initScene before terrainMesh, which gated us above). Falls back to 1 if caps unavailable.
		const aniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1

		for (let slot = 0; slot < 4; slot++) {
			const r = resolveTerrainSlot(tt.detail[slot])
			if (r.kind === 'default') {
				loadBundledTerrainTex(r.url, (tex) => setTerrainSlot(terrainShaderMaterial, slot, tex, aniso))
			} else {
				// bundled fallback while the custom texture decodes, then swap the real one in
				const fb = resolveTerrainSlot('')
				loadBundledTerrainTex(fb.url, (tex) => setTerrainSlot(terrainShaderMaterial, slot, tex, aniso))
				getTexture(r.uuid).then((tex) => { if (tex) setTerrainSlot(terrainShaderMaterial, slot, tex, aniso) })
			}
		}

		// Swap the mesh onto the shader material (keep the vertex-color one for region resets).
		if (terrainMesh.material !== terrainShaderMaterial) {
			_terrainVtxMaterial = terrainMesh.material
			terrainMesh.material = terrainShaderMaterial
		}
	}

	// WHY: the terrain PlaneGeometry is sized to regionSize at initScene (login). Cross-region TP
	// to a DIFFERENT-sized region only updates the regionSize numbers (onTeleportFinish backfill /
	// onEngineMapBlocks) — the geometry was never rebuilt, so terrain stayed the login size (e.g. a
	// 256 plane in a 512 var-region → no surface past 256m). Rebuild the plane when the size changes,
	// preserving the current material (vtx or shader) and re-syncing the shader's uRegionSize.
	function rebuildTerrainGeometry() {
		if (!terrainMesh) return
		const rx = sessionStore.regionSizeX
		const ry = sessionStore.regionSizeY
		const old = terrainMesh.geometry
		const geo = new THREE.PlaneGeometry(rx, ry, rx, ry)
		geo.rotateX(-Math.PI / 2)
		geo.translate(rx / 2, 0, -ry / 2)
		const vtxColors = new Float32Array(geo.attributes.position.count * 3)
		const [ir, ig, ib] = heightColor(22)
		for (let i = 0; i < vtxColors.length; i += 3) {
			vtxColors[i] = ir; vtxColors[i + 1] = ig; vtxColors[i + 2] = ib
		}
		geo.setAttribute('color', new THREE.BufferAttribute(vtxColors, 3))
		terrainMesh.geometry = geo
		old.dispose()
		if (terrainShaderMaterial) terrainShaderMaterial.uniforms.uRegionSize.value.set(rx, ry)
		rebuildTerrainFromStore()
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
		// Give the texture build pump the renderer so it can upload deterministically (initTexture),
		// keeping GPU uploads off the render() critical path (FEATURE-GAPS #11).
		setTextureRenderer(renderer)
		// WHY: Shadow maps disabled for Phase 1 (see prior WHY on shadow frustum mismatch).
		renderer.shadowMap.enabled = false
		// WHY NoToneMapping (was ACESFilmic): ACES darkens mid-tones and desaturates/hue-shifts
		// saturated colors — measured against Firestorm as "everything darker and less red", on
		// unlit textures too (the filmic curve applies to every fragment, lit or not). Firestorm's
		// legacy (non-PBR) pipeline applies NO filmic curve — linear lighting straight to gamma.
		// NoToneMapping + SRGBColorSpace = sRGB-faithful unlit textures (decode→encode round-trip)
		// and FS-style lighting in lit mode. SL content is LDR; sun-facing white clipping to full
		// white is the authentic SL look, not an artifact.
		renderer.toneMapping = THREE.NoToneMapping
		// WHY: Explicit SRGBColorSpace — older Three.js defaulted to LinearEncoding which skips
		// gamma correction. Without this, linear output hits an sRGB monitor raw → colours
		// appear darker than expected, and prim shadow faces show as an unintended dark brown.
		renderer.outputColorSpace = THREE.SRGBColorSpace
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

		labelRenderer = new CSS2DRenderer()
		labelRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;'
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
		// Initial fill: heightColor(22) = grass (d=2 above default water=20); stored in LINEAR
		// space so the sRGB renderer pipeline outputs the intended hue.
		const vtxColors = new Float32Array(terrainGeo.attributes.position.count * 3)
		const [ir, ig, ib] = heightColor(22)
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
		// Intensities calibrated for NoToneMapping (ACES used to compress these): sun 1.0 + ambient
		// 0.45 ≈ SL's legacy sun/ambient balance — a sun-facing white surface reaches full white
		// (authentic), shadow sides stay readable via ambient + sky fill.
		const sun = new THREE.DirectionalLight(0xfff4e6, 1.0)
		sun.position.set(50, 80, 50)
		scene.add(sun)
		// WHY: Fill light from opposite side of sun. Prevents avatar shadow faces going near-zero
		// (which after any outputColorSpace quirk produces the dark-face artefact).
		// ~30% sun intensity keeps shadow side visible without flattening the 3D form.
		const fill = new THREE.DirectionalLight(0xaad4f5, 0.3)
		fill.position.set(-60, -20, -80)
		scene.add(fill)
		scene.add(new THREE.AmbientLight(0xfff4e6, 0.45))

		// Resize observer
		ro = new ResizeObserver(onResize)
		ro.observe(canvasRef.value.parentElement)
		onResize()

		rebuildTerrainFromStore()
		// WHY: terrainTextures (like terrainHeights) persists across HMR/navigate-away remounts,
		// but terrainMesh was just recreated. The immediate watch already fired with terrainMesh
		// null, so re-texture here to close the remount gap — mirrors rebuildTerrainFromStore.
		loadTerrainTextures()
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
				hoverTextMeshes.delete(mesh)
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
		hoverTextMeshes.add(mesh)
		if (div.textContent !== text) div.textContent = text
		const c = obj.textColor
		div.style.color = c
			? `rgba(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)},${c[3].toFixed(2)})`
			: '#ffffff'
		// WHY: Orphaned child prims sit at scene root with local-relative pos ≈ origin —
		// their label would float at SL(0,0,0) until parent arrives. Hide CSS2DObject
		// (CSS2DRenderer checks its own .visible, not the mesh's) until reparented.
		const isOrphan = (obj.parentId ?? 0) !== 0 && mesh.parent === scene
		mesh.userData.hoverLabel.visible = !isOrphan
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

	// SL axis colors (X=red, Y=green, Z=blue); applied to Three.js axes with Y↔Z swap below.
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
		// WHY: Three.js Y=up maps to SL Z; Three.js Z maps to SL Y. Swap colors so
		// gizmo RGB matches floater RGB (X=red, Y=green, Z=blue) not Three.js axes.
		if (mode === 'rotate') {
			root.add(_buildRing(_GIZMO_X, 'x'))
			root.add(_buildRing(_GIZMO_Z, 'y'))  // Three.js Y = SL Z → blue
			root.add(_buildRing(_GIZMO_Y, 'z'))  // Three.js Z = SL Y → green
		} else if (mode === 'scale') {
			root.add(_buildHandle(_GIZMO_X, X)); root.add(_buildHandle(_GIZMO_X, X.clone().negate()))
			root.add(_buildHandle(_GIZMO_Z, Y)); root.add(_buildHandle(_GIZMO_Z, Y.clone().negate()))
			root.add(_buildHandle(_GIZMO_Y, Z)); root.add(_buildHandle(_GIZMO_Y, Z.clone().negate()))
		} else {
			// 'move' arrows — both directions per axis so prim handles read like FS.
			root.add(_buildArrow(_GIZMO_X, X)); root.add(_buildArrow(_GIZMO_X, X.clone().negate()))
			root.add(_buildArrow(_GIZMO_Z, Y)); root.add(_buildArrow(_GIZMO_Z, Y.clone().negate()))
			root.add(_buildArrow(_GIZMO_Y, Z)); root.add(_buildArrow(_GIZMO_Y, Z.clone().negate()))
		}
		return root
	}

	// WHY: Walk the parentId chain (child → root) so a click selects the whole linkset, FS-style.
	// SL linksets are normally one level deep, but follow the chain in case of nested parents.
	// Stops if the parent mesh isn't loaded yet (selects the highest loaded ancestor). Guarded
	// against cycles via the seen set.
	function resolveRootLocalId(localId) {
		let id = localId
		const seen = new Set()
		while (id != null && !seen.has(id)) {
			seen.add(id)
			const pid = meshMap.get(id)?.userData?.parentId ?? 0
			if (!pid || !meshMap.has(pid)) break
			id = pid
		}
		return id
	}

	function refreshGizmo() {
		if (!scene) return
		const id = uiStore.editObjectId
		if (!uiStore.showObjectEdit || !id) { clearGizmo(); return }
		if (uiStore.instancing) promoteOut(id)   // ensure an individual mesh exists for the gizmo
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
	let geoNaNCount      = 0    // built geometry had NaN verts → shown as placeholder instead of culled
	// DIAG probes (P2 texture-apply): why cached textures don't reach materials.
	let texCalls = 0, texNull = 0, texApplied = 0, texDropNoParent = 0, texDropMatSwap = 0
	// P1: linkset-root backfill. ~380 missing roots orphan ~4000 children (hidden + mispositioned).
	// RequestMultipleObjects can't surface them, but ObjectSelect makes the sim send
	// ObjectProperties+ObjectUpdate even for prims it otherwise withholds. Ask each root once,
	// paced, then deselect. Reparenting of waiting orphans is automatic (see upsertMesh parent scan).
	const askedRoots = new Set()
	const ROOT_BACKFILL_BATCH = 40   // roots per diag tick (~every 20 ObjectUpdates)
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
		if (uiStore.instancing) _lastMoveAt.set(obj.localId, performance.now())
		// Guard: skip prims with non-finite pos/scale — they'd produce NaN geometry (Three.js
		// "Computed radius is NaN" spam) and can't be placed. Bad decode or bad sim data.
		const finite3 = (a) => Array.isArray(a) && a.length >= 3 && a.every(Number.isFinite)
		if (!finite3(obj.pos) || !finite3(obj.scale)) return
		const safety = classifySafety(obj)
		if (safety.placeholder) {
			// Shallow-copy so worldStore's original record stays intact. Clamp scale to 1m,
			// drop shape so no real geometry is baked (the unit-cube placeholder stays), drop
			// defaultColor so placeholder color applies. clampPos (if present) parks the marker at region
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
			// Prim shape: show a cheap unit cube immediately (instant, non-blocking); the real geometry
			// is baked off-thread (useMeshBaker) and hot-swapped in via applySwap below. Box prims swap
			// cube→box invisibly. Mesh/sculpt prims fetch their asset first, then bake its submeshes.
			// Geometry cache: a tier-1 (memory) hit means the FINAL baked geometry is available
			// synchronously — build with it directly, no placeholder cube, no bake dispatch.
			// bakeScale snapshot moved up here: the cache key needs it before geometry creation.
			// Mesh/sculpt assets bake + cache UNSCALED (submesh bakes are linear in scale): one
			// entry per asset regardless of in-world scale. bakeScale=[1,1,1] makes applySwap's
			// cur/bakeScale ratio re-apply the prim's full scale on every serve; sync hits scale
			// via bakePrimScale below. Plain prims keep per-scale bakes (shape deform math is not
			// scale-linear).
			const isAsset = !isAvatar && !obj._placeholder && !!(obj.meshId || obj.sculptId)
			const bakeScale = isAsset ? [1, 1, 1] : (obj.scale ? obj.scale.slice() : [1, 1, 1])
			const geomKey = (isAvatar || obj._placeholder) ? null
				: obj.meshId   ? meshGeomKey(obj.meshId)
				: obj.sculptId ? sculptGeomKey(obj.sculptId, obj.sculptType ?? 1)
				: primGeomKey(obj.shape, bakeScale)
			const cachedArrays = geomKey ? geomMemGet(geomKey) : null
			if (cachedArrays) _geomHitMem++
			let geo = isAvatar
				? new THREE.CapsuleGeometry(0.33, 0.96, 4, 8)
				: cachedArrays
					? bakePrimScale(geometryFromArrays(cachedArrays), isAsset ? obj.scale : null)
					: bakePrimScale(new THREE.BoxGeometry(1, 1, 1), obj.scale)
			// NaN-vertex guard (#D): a prim whose built geometry has non-finite verts would be
			// frustum-culled = invisible. Swap in a 0.5m cube + placeholder color so it's findable.
			let geoBad = false
			if (!isAvatar && !geometryHasFiniteVerts(geo)) {
				geo.dispose?.()
				geo = new THREE.BoxGeometry(0.5, 0.5, 0.5)
				geoBad = true
				geoNaNCount++
				if (geoNaNCount <= 10 || geoNaNCount % 50 === 0)
					debugStore.push('warn', `[3D] NaN geometry localId=${obj.localId} pcode=${obj.pcode} → placeholder (#${geoNaNCount})`)
			}
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
			const primColor = (obj._placeholder || geoBad) ? PLACEHOLDER_COLOR : (teColor ?? hashedColor)
			// ── Slice 2: hybrid lit materials ───────────────────────────────────
			// Only prims that carry a material (legacy material_id / PBR ExtraParam 0x80) switch to a
			// lit MeshStandardMaterial; plain prims + avatars keep the fast unlit MeshBasicMaterial
			// (avoids the historical rotation-flicker on the bulk of the scene).
			const hasMaterial = !isAvatar && !obj._placeholder && !!(obj.defaultPbrMaterial || obj.defaultMaterialId)
			// Lit-shading A/B (QuickPrefs ▸ Graphics): material-less prims switch to MeshLambert so
			// untextured/blank-white surfaces show form through sun/ambient shading like FS, instead of
			// rendering flat. Fullbright stays unlit — MeshBasic IS fullbright, exactly SL semantics.
			const wantLit = !isAvatar && !obj._placeholder && uiStore.litShading && !obj.defaultFullbright
			const mat = hasMaterial
				? new THREE.MeshStandardMaterial({ color: primColor, metalness: 0, roughness: 1 })
				: wantLit
					? new THREE.MeshLambertMaterial({ color: primColor })
					: new THREE.MeshBasicMaterial({ color: isAvatar ? 0x00b4d8 : primColor })
			if ((hasMaterial || wantLit) && !geo.attributes.normal) geo.computeVertexNormals()   // flicker fix: lit shading needs normals
			mesh = new THREE.Mesh(geo, mat)
			mesh.onBeforeRender = _noteDraw   // render-exception forensics: see the quarantine catch in animate()

			// ── Slice 2: alpha (#17) — TE color alpha < 1 → translucent prim (even untextured) ──
			// WHY: defaultColor is RGBA; we previously used only RGB, so a prim the sim sent as
			// semi-transparent rendered fully opaque. Keep depthWrite ON: disabling it made overlapping
			// prims see-through to the white background, washing the whole scene white. With depthWrite
			// on, a translucent prim still occludes what's behind it (tinted-glass look) — correct enough
			// without a full back-to-front transparent sort, and no white-out.
			if (!isAvatar && !obj._placeholder && obj.defaultColor && obj.defaultColor[3] < 0.99) {
				mat.transparent = true
				mat.opacity = obj.defaultColor[3]
			}

			// ── Mesh / sculpt / prim geometry: bake off-thread, replace the placeholder cube ──────
			// WHY: prim shapes, decoded mesh submeshes, and decoded sculpt submeshes all route through
			// the worker baker (useMeshBaker), which returns the geometryFromArrays input shape. Mesh
			// (ExtraParam type 5) and legacy sculpt (types 1-4) fetch their asset first (server decodes
			// it to SL-space submesh arrays) then bake those submeshes; plain prims bake the shape.
			// Hot-swap baked geometry (from the worker, or sync fallback) onto the live mesh. `out` is the
			// geometryFromArrays input shape, or { bad:true } if the bake produced non-finite verts.
			// bakeScale (snapshotted above, before key derivation) is the scale the bakes are dispatched
			// with. The update path (existing-mesh branch) may rescale the placeholder + advance
			// mesh.userData.primScale while a bake is in flight; applySwap reconciles the worker
			// geometry (baked at bakeScale) to the current primScale.
			// Mesh per-face multi-material: a mesh carrying ≥2 distinct textures gets one material per
			// submesh/face (built in applySwap once the grouped geometry exists), instead of the single
			// dominant-texture pick below.
			const meshMulti = hasMultiFaceMesh(obj)
			const primMulti = hasMultiFacePrim(obj)
			// Post-geometry finishing shared by the hot-swap path and the sync cache-hit path:
			// planar-face UV regen + per-face material array (both need the final grouped geometry).
			const finishGeom = () => {
				const faceMap = obj.meshId ? null : primFaceMap(obj.shape)
				applyPlanarUVs(mesh, obj, faceMap)
				if (meshMulti) buildFaceMaterials(mesh, obj)
				else if (primMulti) buildFaceMaterials(mesh, obj, faceMap)
			}
			const applySwap = (out) => {
				const _t0 = performance.now()
				// userData.relit: the lit-shading toggle swapped this mesh's material while the bake was
				// in flight — the mesh is NOT stale, accept the geometry (a real re-material/removal
				// still bails via mesh.parent / the rebuilt-mesh path).
				if (!out || out.bad || !mesh.parent || (mesh.material !== mat && !mesh.userData.relit)) {
					if (out && out.bad) geoNaNCount++   // keep the placeholder cube
					return
				}
				const baked = geometryFromArrays(out)
				if (!geometryHasFiniteVerts(baked)) { baked.dispose?.(); geoNaNCount++; return }
				if ((hasMaterial || uiStore.litShading) && !baked.attributes.normal) baked.computeVertexNormals()   // lit shading needs normals
				// WHY: an in-flight update may have rescaled the placeholder + advanced primScale since
				// dispatch. Re-apply the bakeScale→primScale ratio so the swapped geometry matches the
				// current scale (same axis map as bakePrimScale / the update path). Divisor 0/non-finite → 1.
				const cur = mesh.userData.primScale
				if (cur) {
					const ratio = (n, p) => (Number.isFinite(n) && Number.isFinite(p) && p !== 0) ? n / p : 1
					const rx = ratio(cur[0], bakeScale[0])
					const ry = ratio(cur[2], bakeScale[2])
					const rz = ratio(cur[1], bakeScale[1])
					if (rx !== 1 || ry !== 1 || rz !== 1) baked.scale(rx, ry, rz)
				}
				const old = mesh.geometry
				mesh.geometry = baked
				old.dispose()
				finishGeom()
				const _dt = performance.now() - _t0
				_applyN++; _applyMs += _dt; if (_dt > _applyMaxMs) _applyMaxMs = _dt
			}

			// WHY: the worker's postMessage structured-clones its payload, and Vue/Pinia reactive
			// Proxies (obj.shape from worldStore, decoded subs) are NOT cloneable → DataCloneError.
			// Send PLAIN snapshots: the 6 scalar shape fields buildPrimGeometry/applyShapeDeformation
			// read, and a plain {positions,normals,uvs,indices} per submesh (inner arrays are plain
			// typed arrays from the decode cache, so they clone fine once the proxy wrapper is dropped).
			const plainSubs = (subs) => subs.map(s => ({
				positions: s.positions, normals: s.normals, uvs: s.uvs, indices: s.indices,
			}))
			const plainShape = obj.shape ? {
				pathCurve:      obj.shape.pathCurve,
				profileCurve:   obj.shape.profileCurve,
				pathTwist:      obj.shape.pathTwist,
				pathTwistBegin: obj.shape.pathTwistBegin,
				pathTaperX:     obj.shape.pathTaperX,
				pathTaperY:     obj.shape.pathTaperY,
			} : undefined

			if (!isAvatar && !obj._placeholder) {
				if (cachedArrays) {
					// Tier-1 hit: geometry is already final (created above) — run only the
					// post-swap finishing. Mesh/sculpt hits never even fetch the raw asset.
					finishGeom()
				} else {
					// Miss path, deferred behind one batched qs-geom lookup (an IDB hit swaps like a
					// worker result; a true miss runs this thunk → bake → persist).
					// WHY thunk: a mesh/sculpt cache hit must skip getMesh/getSculpt entirely — the
					// raw-submesh fetch only happens when the baked cache truly misses.
					const jobThunk = obj.meshId
						? () => getMesh(obj.meshId, nearRefDist(obj)).then(subs =>
							(subs && subs.length) ? meshBaker.bake({ kind: 'submesh', subs: plainSubs(subs), scale: bakeScale }) : null)
						: obj.sculptId
							? () => getSculpt(obj.sculptId, obj.sculptType ?? 1, nearRefDist(obj)).then(subs =>
								(subs && subs.length) ? meshBaker.bake({ kind: 'submesh', subs: plainSubs(subs), scale: bakeScale }) : null)
							: () => meshBaker.bake({ kind: 'prim', shape: plainShape, scale: bakeScale })
					requestGeometry(geomKey, jobThunk, applySwap)
				}
			}

			// Glow / fullbright → emissive (only meaningful on the lit material; plain unlit prims are
			// already full-bright). Glow adds emissive bloom-ish lift; fullbright ignores lighting.
			if (hasMaterial && (obj.defaultFullbright || (obj.defaultGlow ?? 0) > 0)) {
				mat.emissive = new THREE.Color(primColor)
				mat.emissiveIntensity = obj.defaultFullbright ? 1.0 : Math.min(1, (obj.defaultGlow ?? 0) * 2)
			}

			// ── Slice 1: real prim texture ──────────────────────────────────────
			// WHY: TE default texture UUID (decoded server-side) → fetch via asset cap (server
			// transcodes J2C→WebP) → set material.map. Color goes white so the texture shows its
			// own colors rather than being tinted by the default-color fallback. Per-face textures
			// (faceTextures) + UV repeat/offset come in a later slice; MVP applies the default face.
			const primTexId = (!isAvatar && !obj._placeholder && !meshMulti && !primMulti) ? pickPrimTexture(obj) : null
			// Near-aware build (FEATURE-GAPS #13): only fetch the diffuse texture for objects within the
			// draw distance. Fetching for far objects the cull will immediately hide just floods the grid
			// queue + main-thread decode (live: queued climbs, fps→8). A far single-material mesh builds
			// white and gets its texture from backfillTextures (visible-gated) when the cull shows it on
			// approach. NOT applied to per-face meshes (handled below) — backfill skips multi-material, so
			// gating them would strand them white when shown (extending per-face backfill is a follow-up).
			if (primTexId && camDistToObj(obj) <= renderRadius()) {
				// UV transform from TE; absent → SL defaults (repeat 1,1 / offset 0,0 / rot 0 = identity)
				const xform = uvXform(obj.defaultRepeats, obj.defaultOffset, obj.defaultRotation)
				texCalls++
				getTexture(primTexId, xform, nearRefDist(obj)).then(tex => {
					// DIAG (P2): classify apply outcome to pin the white-scene cause.
					if (!tex) texNull++
					else if (!mesh.parent) texDropNoParent++
					else if (mesh.material !== mat) texDropMatSwap++
					else texApplied++
					// Guard: region teardown may have disposed this mesh before the texture arrives.
					if (tex && mesh.parent && mesh.material === mat) {
						mat.map = tex
						// SL renders texture × color tint. Keep the TE tint if present (else white) so a
						// tinted prim with a plain texture isn't forced white.
						if (obj.defaultColor) mat.color.setRGB(obj.defaultColor[0], obj.defaultColor[1], obj.defaultColor[2])
						else mat.color.set(0xffffff)
						applyTexAlpha(mat, tex, obj)   // #17b: blend gradient alphas, see helper
						mat.needsUpdate = true
					}
				})
			}

			// ── Slice 2: PBR (GLTF) — overrides the diffuse map above when present ───
			// Skip for multi-face meshes: those swap to a per-face material array in applySwap, which
			// would discard (and leak) any PBR-mutated single material. Per-face + PBR is a rare combo;
			// see docs/tech-debt.md (perface-pbr-skip). Per-face textures win for these meshes.
			// WHY !obj._placeholder on BOTH material blocks: placeholders skip `hasMaterial` (line
			// above), so their creation material is MeshBasic/Lambert — but these blocks used to run
			// anyway and the async callbacks then assigned normalMap onto a BASIC material. Basic's
			// program has no normalMap uniforms → three's refreshUniformsCommon throws EVERY FRAME
			// ("Cannot set properties of undefined") — measured live as 89 poisoned meshes wedging
			// the whole render. Initial-load-only (placeholders come from the cache-paint path).
			if (obj.defaultPbrMaterial && !obj._placeholder && !meshMulti && !primMulti) {
				getPbrMaterial(obj.defaultPbrMaterial).then(gltf => {
					if (!gltf || !mesh.parent || mesh.material !== mat) return
					const d = gltfToDescriptor(gltf)
					mat.metalness = d.metallic
					mat.roughness = d.roughness
					mat.color.setRGB(d.baseColorFactor[0], d.baseColorFactor[1], d.baseColorFactor[2])
					mat.emissive = new THREE.Color(d.emissiveFactor[0], d.emissiveFactor[1], d.emissiveFactor[2])
					if (d.doubleSided) mat.side = THREE.DoubleSide
					if (d.alphaMode === 'BLEND') mat.transparent = true
					else if (d.alphaMode === 'MASK') mat.alphaTest = d.alphaCutoff
					const setMap = (uuid, slot, srgb) => uuid && getTexture(uuid, null, nearRefDist(obj)).then(t => {
						if (t && mesh.material === mat) { if (srgb) t.colorSpace = THREE.SRGBColorSpace; mat[slot] = t; mat.needsUpdate = true }
					})
					setMap(d.baseColorTex, 'map', true)
					setMap(d.normalTex, 'normalMap')
					setMap(d.metallicRoughnessTex, 'metalnessMap')   // ORM-packed: same texture
					setMap(d.metallicRoughnessTex, 'roughnessMap')
					setMap(d.emissiveTex, 'emissiveMap', true)
					mat.needsUpdate = true
				})
			} else if (obj.defaultMaterialId && !obj._placeholder && !primMulti) {
				// ── Slice 2: legacy RenderMaterials — normal + (specular→roughness approx) ──
				getLegacyMaterial(obj.defaultMaterialId).then(m => {
					if (!m || !mesh.parent || mesh.material !== mat) return
					// isMeshStandardMaterial guard: normalMap on a Basic/Lambert-from-relight material
					// poisons its program (see the placeholder WHY above) — only Standard takes it.
					if (m.normMap) getTexture(m.normMap, null, nearRefDist(obj)).then(t => { if (t && mesh.material === mat && mat.isMeshStandardMaterial) { mat.normalMap = t; mat.needsUpdate = true } })
					// MeshStandard has no spec map; approximate shininess via roughness (higher exp = smoother).
					if (m.specExp) mat.roughness = Math.max(0.1, 1 - m.specExp / 255)
					// Persist the material's alpha mode on the object — authoritative for every later
					// texture (re)apply regardless of which .then resolves first (see alphaPolicyStamp).
					obj.materialAlphaMode = m.alphaMode ?? null
					obj.materialAlphaCutoff = m.alphaCutoff
					alphaPolicyStamp(mat, !!mat.map?.userData?.hasAlpha, obj)
					mat.needsUpdate = true
				})
			}
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
			// WHY: Prim scale is baked into the geometry (bakePrimScale above), NOT the mesh node —
			// node scale stays (1,1,1) so linked children don't inherit it. Track the baked scale so
			// a later full update can re-bake by ratio. Avatars: capsule is fixed geometry, no scale.
			if (obj.pcode !== PCODE_AVATAR) mesh.userData.primScale = obj.scale ? obj.scale.slice() : [1, 1, 1]
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
			// If parent mesh hasn't arrived yet, attach to scene as orphan hidden — reparent on
			// parent spawn. WHY hidden: local child coords (e.g. X=-0.5 Y=-0.1 Z=6) interpreted
			// as world coords land near region origin (underwater). Invisible until parented.
			const parentLocalId = obj.parentId ?? 0
			const parentMesh = parentLocalId ? meshMap.get(parentLocalId) : null
			if (parentMesh) {
				parentMesh.add(mesh)
			} else {
				if (parentLocalId) {
					mesh.visible = false  // orphan child — hide until parent arrives
					let set = orphansByParent.get(parentLocalId)
					if (!set) { set = new Set(); orphansByParent.set(parentLocalId, set) }
					set.add(obj.localId)
				}
				scene.add(mesh)
			}
			normalizeChildTransform(mesh)
			meshMap.set(obj.localId, mesh)
			// Near-aware (FEATURE-GAPS #13): a ROOT born beyond the draw distance is hidden IMMEDIATELY so
			// it never flashes for the ~200ms until visibilityTick runs. During load, far objects stream in
			// AND the governor evicts/reloads them — each rebuild would otherwise show for one cull interval
			// (the live "far objects flicker for a couple minutes" at 388m). Children ride their root's
			// visibility; avatars are never hidden. visibilityTick maintains it with hysteresis as you move.
			if (parentLocalId === 0 && obj.pcode !== PCODE_AVATAR && camDistToObj(obj) > renderRadius()) {
				mesh.visible = false
			}

			// WHY: O(1) reparent of orphans that were waiting on THIS mesh's localId. Replaces a
			// per-build full meshMap scan (O(n²) overall — the dominant big-region build cost).
			// Stale index entries (child removed/already parented) are skipped safely.
			const waiting = orphansByParent.get(obj.localId)
			if (waiting) {
				for (const childId of waiting) {
					const other = meshMap.get(childId)
					if (!other || other.parent === mesh) continue
					other.parent?.remove(other)
					mesh.add(other)
					normalizeChildTransform(other)
					other.visible = true
					if (other.userData.hoverLabel) other.userData.hoverLabel.visible = true
				}
				orphansByParent.delete(obj.localId)
			}
		} else {
			// Existing mesh: scale update + animated position
			// WHY: scale lives in the geometry (node scale stays 1,1,1 so children don't inherit it).
			// Re-bake by the ratio of new/previous baked scale — preserves the prim's shape geometry
			// without a rebuild, and is a no-op when the scale is unchanged (the common resync case).
			if (obj.scale && obj.pcode !== PCODE_AVATAR) {
				const prev = mesh.userData.primScale || [1, 1, 1]
				// Guard: a prim can arrive with a 0 scale component (finite, so it passes classifySafety
				// and bakes to a 0-width geometry). On the next update prev[i]=0 → new/0 = Inf, or 0/0 =
				// NaN → NaN verts → Three.js "Computed radius is NaN" red. Fall back to ratio 1 (leave the
				// axis as-is) when the divisor is 0 or either value is non-finite.
				const ratio = (n, p) => (Number.isFinite(n) && Number.isFinite(p) && p !== 0) ? n / p : 1
				const rx = ratio(obj.scale[0], prev[0])
				const ry = ratio(obj.scale[2], prev[2])
				const rz = ratio(obj.scale[1], prev[1])
				if (rx !== 1 || ry !== 1 || rz !== 1) mesh.geometry.scale(rx, ry, rz)
				mesh.userData.primScale = obj.scale.slice()
			}
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
				// WHY: If this was an orphan (parent arrived after child was created), try to
				// reparent now. parent === scene means still orphaned; check if parent is in meshMap.
				const pid = mesh.userData.parentId ?? 0
				if (pid && mesh.parent === scene) {
					const pm = meshMap.get(pid)
					if (pm) {
						scene.remove(mesh)
						pm.add(mesh)
						mesh.visible = true
						if (mesh.userData.hoverLabel) mesh.userData.hoverLabel.visible = true
					}
				}
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
		// WHY: a sim KillObject (object deleted) routes through removeMesh, but the object may now be
		// instanced (not in meshMap). Drop the instance so it doesn't linger as a pool ghost.
		if (_instancePool && _instancePool.has(localId)) { _instancePool.remove(localId); return }
		const mesh = meshMap.get(localId)
		if (mesh) {
			// WHY: Traverse to dispose child geometry/materials (arm indicator etc.) not just root
			mesh.traverse(child => {
				if (child.isMesh) {
					child.geometry.dispose()
					// material may be a per-face array (mesh multi-material) — dispose each
					if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.())
					else child.material.dispose()
				}
			})
			// WHY: Linked-set children sit under parent mesh, not scene. Detach from actual parent.
			mesh.parent?.remove(mesh)
			// WHY: CSS2DRenderer does NOT remove a label's DOM node when its object leaves the scene
			// graph — the <div> leaks, frozen at its last screen position (stale avatar/hover labels
			// that don't track the scene). Remove the element explicitly. Covers avatar (label2D) and
			// prim hovertext (hoverLabel) labels.
			for (const lbl of [mesh.userData?.label2D, mesh.userData?.hoverLabel]) {
				if (lbl?.element?.parentNode) lbl.element.remove()
				lbl?.parent?.remove(lbl)
			}
			meshMap.delete(localId)
			hoverTextMeshes.delete(mesh)
		}
	}

	// ── Incoming messages ─────────────────────────────────────────────────────
	let objUpdateCount = 0
	// Prim-dropout diagnostic: receive-side counters and 5s periodic summary so we can
	// compare server-relayed prim count vs client-rendered mesh count. Failures in
	// upsertMesh that previously crashed the loop are now caught + counted.
	let objsReceivedTotal = 0
	let upsertMeshFailures = 0
	let lastPrimDiagAt = 0
	function onObjectUpdate(payload) {
		// WHY: useRealtimeSocket dispatches msg.d (unwrapped) to handlers, not the full {t,d} envelope.
		// So payload = { objects: [...] } — access as payload.objects, not payload.d.objects.
		const objs = payload?.objects ?? []
		objUpdateCount++
		objsReceivedTotal += objs.length
		preseedRegionCache()   // once per region (guarded): instant repaint from IndexedDB before live fills
		if (objUpdateCount === 1 || objUpdateCount % 20 === 0) {
			const avCount = objs.filter(o => o.pcode === PCODE_AVATAR).length
			debugStore.push('info', `[3D] ObjectUpdate #${objUpdateCount}: ${objs.length} objects (${avCount} av) agentId=${sessionStore.agentId?.slice(0,8)}`)
		}
		const now = Date.now()
		if (now - lastPrimDiagAt >= 5000) {
			lastPrimDiagAt = now
			const primCount = worldStore.prims.length
			const avCount = worldStore.avatars.length
			// DIAG: distinguish "prim has a texture but it wasn't fetched" (fetch gap) from "prim has
			// no texture at all" (decoder gap). withTex = prims carrying a non-zero defaultTexture;
			// mapped = meshes that actually have material.map applied.
			let withTex = 0, mapped = 0
			for (const o of worldStore.prims) if (o.defaultTexture && o.defaultTexture !== ZERO_TEX_UUID) withTex++
			// WHY !Array.isArray: a per-face mesh's material is an array, whose `.map` is Array.prototype.map
			// (truthy) — without this guard every multi-face mesh counts as mapped, skewing the probe.
			for (const m of meshMap.values()) if (!Array.isArray(m.material) && m.material?.map) mapped++
			// FaceTex probe: how much white is "default=Blank but real per-face textures exist" (we only
			// apply the default face) vs "genuinely blank". Decides whether per-face apply is worth it.
			const BLANK_TEX = '5748decc-f629-461c-9a36-a35a221fe21f'
			const isReal = (t) => t && t !== ZERO_TEX_UUID && t !== BLANK_TEX
			let blankDef = 0, blankDefRealFaces = 0, realDef = 0, anyRealFaces = 0
			for (const o of worldStore.prims) {
				const realFaces = Array.isArray(o.faceTextures) && o.faceTextures.some(isReal)
				if (realFaces) anyRealFaces++
				if (isReal(o.defaultTexture)) realDef++
				else { blankDef++; if (realFaces) blankDefRealFaces++ }
			}
			debugStore.push('info', `[FaceTex] realDefault=${realDef} blankDefault=${blankDef} blankButRealFaceTex=${blankDefRealFaces} anyRealFaceTex=${anyRealFaces}`)
			// P1 probe: children whose root prim is missing → orphaned (mispositioned + label hidden +
			// whole linkset can be invisible). missingRoots = distinct root ids never delivered.
			let children = 0, orphanLive = 0
			const missingRoots = new Set()
			for (const o of worldStore.prims) {
				const pid = o.parentId ?? 0
				if (pid === 0) continue
				children++
				if (!worldStore.objects.has(pid)) { orphanLive++; missingRoots.add(pid) }
			}
			let orphanMesh = 0
			for (const m of meshMap.values()) if ((m.userData?.parentId ?? 0) !== 0 && m.parent === scene) orphanMesh++
			debugStore.push('info', `[PrimDiag] received=${objsReceivedTotal} stored=${worldStore.objects.size} (prims=${primCount} av=${avCount}) meshes=${meshMap.size} withTex=${withTex} mapped=${mapped} upsertFails=${upsertMeshFailures} placeholders=${placeholderCount} geoNaN=${geoNaNCount} skippedNoPos=${skippedNoPos}`)
			debugStore.push('info', `[Orphan] children=${children} orphanByMissingRoot=${orphanLive} distinctMissingRoots=${missingRoots.size} orphanMeshAtScene=${orphanMesh}`)
			// P1 backfill: ObjectSelect a batch of not-yet-asked missing roots → sim sends their
			// ObjectUpdate → orphaned children reparent automatically. Deselect shortly after.
			const newRoots = []
			for (const rid of missingRoots) {
				if (askedRoots.has(rid)) continue
				askedRoots.add(rid); newRoots.push(rid)
				if (newRoots.length >= ROOT_BACKFILL_BATCH) break
			}
			if (newRoots.length) {
				wsEmit(C.OBJECT_SELECT, { localIds: newRoots })
				setTimeout(() => wsEmit(C.OBJECT_DESELECT, { localIds: newRoots }), 1500)
				debugStore.push('info', `[RootBackfill] ObjectSelect ${newRoots.length} root(s) (asked=${askedRoots.size}/${missingRoots.size})`)
			}
			debugStore.push('info', `[TexApply] withTex=${withTex} mapped=${mapped} calls=${texCalls} null=${texNull} applied=${texApplied} dropNoParent=${texDropNoParent} dropMatSwap=${texDropMatSwap}`)
			// Mirror to server-log via WS so server-log.txt has full client+server picture.
			wsEmit(C.CLIENT_DIAG, {
				received:     objsReceivedTotal,
				stored:       worldStore.objects.size,
				prims:        primCount,
				av:           avCount,
				meshes:       meshMap.size,
				withTex,
				mapped,
				upsertFails:  upsertMeshFailures,
				skippedNoPos,
				placeholders: placeholderCount,
				geoNaN:       geoNaNCount,
				tex:          getTextureStats(),
				mesh:         getMeshStats(),
				orphan:       { children, orphanByMissingRoot: orphanLive, distinctMissingRoots: missingRoots.size, orphanMeshAtScene: orphanMesh },
				texApply:     { calls: texCalls, null: texNull, applied: texApplied, dropNoParent: texDropNoParent, dropMatSwap: texDropMatSwap },
				faceTex:      { realDefault: realDef, blankDefault: blankDef, blankButRealFaceTex: blankDefRealFaces, anyRealFaceTex: anyRealFaces },
			})
		}
		for (const obj of objs) {
			// WHY (perf): prims are deferred to the paced ingest pump so a big ObjectUpdate batch
			// can't block the WS handler / rAF (FEATURE-GAPS #11 / TP-into-heavy wedge). The pump
			// does upsertObject + persist + mesh-queue-add. Avatars stay inline — own-avatar
			// attribution + the follow camera below depend on the object existing immediately.
			if (obj.pcode !== PCODE_AVATAR) {
				_ingestQueue.push({ o: obj, persist: true })
				continue
			}
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
			if (uiStore.instancing && obj.localId !== ownAvatarLocalId) {
				_lastMoveAt.set(obj.localId, performance.now())
				if (_instancePool && _instancePool.has(obj.localId)) promoteOut(obj.localId)
			}
			// Move the mesh
			const mesh = meshMap.get(obj.localId)
			// WHY: Skip own avatar mesh entirely here. It is driven by the local dead-reckoning
			// + gravity loop in animate() via direct position.set() every frame. A competing GSAP
			// tween toward the 10Hz sim pos ran on GSAP's own ticker and fought those per-frame
			// sets — each overwrote the other mid-flight, producing the local walking jitter.
			// (Remote FS viewers saw smooth motion because the SENT position is clean.) Own pos
			// is still corrected softly via the avatarSLPos blend below.
			if (mesh && obj.localId !== ownAvatarLocalId) {
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
					// WHY: while actively moving, trust dead reckoning and do NOT correct toward the
					// sim's TerseUpdate. The relayed pos lags our prediction by ~round-trip latency, so
					// blending toward it every 100ms yanked the avatar backward → visible spring-back
					// (the avatar pulled toward the camera mid-stride). Remote viewers see smooth motion
					// because the SENT path is clean, so DR is correct — no correction needed in flight.
					// When idle, ease gently toward the sim to settle out any accumulated drift. Big
					// deltas (>5m = teleport / hard physics correction) always snap.
					// Suppress correction while moving OR still skidding (residual DR velocity) —
					// otherwise the ease toward the lagged sim pos re-introduces a pull the instant
					// the key is released, mid-coast. Once fully stopped, settle gently.
					const movingNow = MOVE_KEYS.some(k => keys[k]) || drVelX !== 0 || drVelY !== 0
					// WHY: while airborne (vertVel !== 0) local physics owns the full arc — the sim's
					// TerseUpdate position lags by ~RTT. XY corrections during flight cause horizontal
					// shake; Z corrections cause the post-landing re-bounce (sim still shows avatar
					// in-air → d can exceed 5m → snap to mid-air position → gravity pulls back down →
					// next TerseUpdate snaps again, 2-4 times). Suppress all corrections while airborne;
					// only hard-snap for genuine teleport-level distances (> 15m).
					// landingGraceTimer extends the suppression for ~0.4s after touchdown so stale
					// in-flight TerseUpdates from the jump arc can't trigger the single post-landing bounce.
					// WHY: flight is the same situation as a jump arc — local DR owns the path while
					// the sim's pos lags by ~RTT and climbs/coasts on a different accel profile, so
					// transient gaps of 5-30m are normal. Lumping flight into the grounded regime made
					// the >5m hard-snap fire mid-flight and yank the avatar back to the lagging sim Z
					// ("spring to startpoint"). correctionBlend() gives flight its own regime.
					const airborne = !isFlying && (vertVel !== 0 || landingGraceTimer > 0)
					const blend = correctionBlend({ d, isFlying, airborne, movingNow })
					avatarSLPos[0] += (p[0] - avatarSLPos[0]) * blend
					avatarSLPos[1] += (p[1] - avatarSLPos[1]) * blend
					// WHY: on the ground, gravity owns Z — it clamps to terrain every frame. Blending
					// the sim's Z here too created a 10Hz vertical stair-step that gravity immediately
					// re-clamped = micro-bob. Only pull Z from the sim while flying (no ground clamp)
					// or on a large correction.
					if (isFlying || d > 5) avatarSLPos[2] += (p[2] - avatarSLPos[2]) * blend
				}
				worldStore.setAvatarPos(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
				if (firstUpdate) {
					debugStore.push('info', `[3D] First TerseUpdate own avatar → ${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}`)
				}
			}
		}
	}

	function onAgentSpawnPos(payload) {
		// WHY: Two AgentSpawnPos arrive after a cross-region TP attempt:
		//   1. Source sim responds to our proactive CompleteAgentMovement (~100ms) — scene not arrived
		//   2. Destination sim confirms arrival (only if TP succeeds)
		// _tpSceneCleared=true while waiting for first. Consume on first (don't clear overlay yet).
		// On second SpawnPos with status still 'arriving' → destination confirmed → clear overlay.
		// TeleportFailed also clears overlay on failure path.
		if (_tpSceneCleared) {
			_tpSceneCleared = false   // consumed: source sim responded, still waiting for destination
		} else if (uiStore.teleportStatus === 'arriving') {
			uiStore.teleportStatus = ''  // second SpawnPos = destination confirmed
			clearTpTimers()
		} else {
			uiStore.teleportStatus = ''
			clearTpTimers()
		}
		// WHY: AgentMovementComplete fires once after login — sim's authoritative spawn position.
		// Also fires on TeleportLocal (same-region TP). Arrives before ObjectUpdate/TerseUpdate
		// for the new location, so we snap avatarSLPos, camera, AND own avatar mesh ourselves.
		const p = payload?.pos
		if (!p || p.length < 3) return
		const [x, y, z] = p
		if (x === 0 && y === 0 && z === 0) return
		// WHY: OpenSim periodically re-sends AgentMovementComplete mid-walk (physics refresh /
		// session re-anchor). It arrives with the original spawn position, not the current one.
		// Snapping while moving jumps the avatar 10–15m back to where it started.
		// Suppress if we already have a position and are actively moving — TeleportLocal is safe
		// because the user isn't holding movement keys when they click a landmark/map pin.
		const movingNow = avatarSLPos && (MOVE_KEYS.some(k => keys[k]) || drVelX !== 0 || drVelY !== 0)
		if (movingNow) {
			debugStore.push('info', `[3D] AgentMovementComplete ignored mid-walk — suppressing rubber-band snap`)
			return
		}
		avatarSLPos = [...p]  // WHY: own copy — dead reckoning mutates in-place
		worldStore.setAvatarPos(x, y, z)
		worldStore.setSpawnPos(x, y, z)  // also update persistent store for future remounts
		// Overlay: the avatar is now placed in the destination. Clear shortly even if the confirming
		// 2nd AgentSpawnPos never arrives (single-spawn-pos grids). Only engages during a cross-region
		// TP (onTeleportFinish set 'arriving' + the hard timer); same-region/local TP is untouched.
		if (uiStore.teleportStatus === 'arriving') {
			_tpSpawnApplied = true
			if (_tpSettleTimer) clearTimeout(_tpSettleTimer)
			_tpSettleTimer = setTimeout(() => {
				_tpSettleTimer = null
				if (uiStore.teleportStatus === 'arriving') { clearTpTimers(); uiStore.teleportStatus = '' }
			}, TP_SETTLE_MS)
		}
		// WHY: Exit alt-orbit on teleport — otherwise animate() short-circuits the avatar-follow
		// camera update and the view stays stuck at the pre-TP orbit position.
		isAltOrbit = false
		endFocusGlide()
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
	// Set when a cross-region TP lands in a cell missing from the map cache — the
	// MapBlockReply for the lookup query then applies the destination's true size.
	let _pendingRegionSizeLookup = false
	function onEngineMapBlocks(d) {
		const blocks = d?.blocks ?? []
		if (!blocks.length) return
		mapStore.setRegions(blocks)
		if (!_pendingRegionSizeLookup) return
		const blk = mapStore.getRegion(
			Math.floor((sessionStore.regionX ?? 0) / 256),
			Math.floor((sessionStore.regionY ?? 0) / 256),
		)
		if (!blk) return
		_pendingRegionSizeLookup = false
		sessionStore.regionSizeX = blk.sizeX || 256
		sessionStore.regionSizeY = blk.sizeY || 256
		debugStore.push('info', `[3D] Region size backfilled from map block: ${sessionStore.regionSizeX}×${sessionStore.regionSizeY}`)
	}

	function onTeleportFinish(d) {
		uiStore.teleportStatus = 'arriving'
		_tpSceneCleared = true
		_tpSpawnApplied = false
		clearTpTimers()
		_tpArrivalTimer = setTimeout(onTpArrivalTimeout, TP_ARRIVAL_MS)
		_objCacheLoadedKey = null  // let the destination region's cache load fresh
		debugStore.push('info', `[3D] Cross-region TP → ${d?.simIp}:${d?.simPort} (regionHandle=${d?.regionHandle}) — clearing scene`)
		meshMap.forEach((mesh) => {
			mesh.traverse(child => {
				if (child.isMesh) {
					child.geometry.dispose()
					// material may be a per-face array (mesh multi-material) — dispose each
					if (Array.isArray(child.material)) child.material.forEach(m => m.dispose?.())
					else child.material.dispose()
				}
			})
			mesh.parent?.remove(mesh)
		})
		meshMap.clear()
		disposeInstancing()  // drop pooled InstancedMeshes/caches so they don't leak across regions
		hoverTextMeshes.clear()
		pendingMeshIds.clear()  // perf: drop queued mesh builds on region change
		_ingestQueue.length = 0  // drop the old region's un-ingested prim backlog
		evicted.clear()
		orphansByParent.clear()
		_didPrecompile = false  // C1: re-precompile shaders for the new region's materials
		worldStore.clearAll()
		worldStore.clearTerrain()
		// New region: revert the mesh to the vertex-color material (never blank) and drop the
		// shader so the next RegionHandshake rebuilds it fresh for the new region's textures.
		if (terrainMesh && _terrainVtxMaterial && terrainMesh.material === terrainShaderMaterial) {
			terrainMesh.material = _terrainVtxMaterial
		}
		terrainShaderMaterial?.dispose()
		terrainShaderMaterial = null
		avatarSLPos = null
		ownAvatarLocalId = null
		vertVel = 0
		landingGraceTimer = 0
		cameraSnapRequested = true
		// WHY: Handle format is (X_meters << 32) | Y_meters — upper 32 = X, lower 32 = Y.
		// JSON serialised as string from server (bigint) — convert via BigInt for U32 splits.
		if (d?.simIp)  sessionStore.simIp  = d.simIp
		if (d?.simPort) sessionStore.simPort = d.simPort
		if (d?.seedCap) sessionStore.seedCap = d.seedCap
		if (d?.regionHandle) {
			try {
				const h = BigInt(d.regionHandle)
				sessionStore.regionX = Number(h >> 32n)
				sessionStore.regionY = Number(h & 0xFFFFFFFFn)
				// WHY: UDP TeleportFinish carries no region size (only the EventQueue variant
				// does, which we don't have). Backfill from the map-block cache so var-region
				// destinations don't inherit the previous region's dimensions — wrong size
				// breaks movement clamping, terrain build, and the map's region outline.
				// Cache miss → query the destination cell; onMapBlocks applies the size.
				const cellX = Math.floor(sessionStore.regionX / 256)
				const cellY = Math.floor(sessionStore.regionY / 256)
				const blk = mapStore.getRegion(cellX, cellY)
				if (blk) {
					sessionStore.regionSizeX = blk.sizeX || 256
					sessionStore.regionSizeY = blk.sizeY || 256
				} else {
					_pendingRegionSizeLookup = true
					sendMapQuery(cellX, cellX, cellY, cellY)
				}
			} catch { /* ignore parse error — non-blocking */ }
		}
		sessionStore.regionName = ''  // new RegionHandshake will set it
	}

	function onTeleportStarted() {
		uiStore.teleportStatus = 'requesting'
	}

	function onTeleportProgress(d) {
		const status = d?.status || 'contacting'
		uiStore.teleportStatus = status
	}

	function onTeleportFailed(d) {
		uiStore.teleportStatus = ''
		_tpSceneCleared = false
		_tpSpawnApplied = false
		clearTpTimers()
		const reason = d?.reason || 'Teleport failed.'
		notificationStore.notify({ title: 'Teleport Failed', body: reason, icon: '✗', toast: true })
		debugStore.push('warn', `[3D] TeleportFailed: ${reason}`)
	}

	// WHY: ObjectProperties reply — merge into worldStore so right-click Inspect / Edit floater
	// see real name/description/creator/owner instead of placeholder fields.
	function onObjectProps(payload) {
		const items = payload?.items ?? []
		let ok = 0
		const miss = []
		for (const p of items) {
			if (worldStore.applyObjectProperties(p)) ok++
			else miss.push(p.fullId)
		}
		if (items.length > 0) {
			// Diagnostic for the "Loading properties from sim…" stall: props ARRIVE (server relays
			// them) but the floater stays empty → the fullId match in applyObjectProperties must be
			// failing. Report match rate + how many store objects even carry a fullId.
			let withFullId = 0
			worldStore.objects.forEach(o => { if (o.fullId) withFullId++ })
			const line = `[3D] ObjectProperties: ${ok}/${items.length} matched | store withFullId=${withFullId}/${worldStore.objects.size}` +
				(miss.length ? ` | missed: ${miss.slice(0, 3).join(', ')}` : '')
			debugStore.push(ok === items.length ? 'info' : 'warn', line)
			try { wsEmit(C.CLIENT_LOG, { level: ok === items.length ? 'info' : 'warn', msg: line, stack: '' }) } catch { /* ignore */ }
		}
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
		const key = regionCacheKey()
		const keepOnKill = import.meta.env.VITE_KEEP_CACHE_ON_KILL === 'true'
		for (const id of all) {
			pendingMeshIds.delete(id)  // perf: drop a queued-but-unbuilt mesh
			evicted.delete(id)
			removeMesh(id)
			worldStore.removeObject(id)
			// WHY: stock OpenSim has ObjectsCullingByDistance=false, so KillObject = genuine
			// delete → evict the cached entry. Grids that enable culling can set
			// VITE_KEEP_CACHE_ON_KILL=true so a cull-kill does not drop the cached object.
			if (key && !keepOnKill) objCacheEvict(key, id)
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
		const { layerType, patchSize = 16, patches } = payload
		if (layerType === 'WATER') return  // water plane height fixed at 20 for Phase 1

		// WHY: always store + count patches regardless of whether the Three.js scene is ready.
		// Terrain packets arrive during the login sequence, before Vue has mounted the canvas and
		// initScene() has created terrainMesh. The old guard `if (!terrainMesh) return` dropped
		// those patches from worldStore entirely — they never landed in terrainHeights or
		// patchReceived, so rebuildTerrainFromStore() (called at end of initScene) applied zeros
		// for the missing coords and the diagnostic reported 491/1024 on fresh login even though
		// the server cache held all 1024. Store always; skip Three.js vertex writes when not ready.
		for (const { x: px, y: py, heights } of patches) {
			worldStore.setTerrainPatch(px, py, heights, patchSize)
		}
		_scheduleMissingPatchDump()

		if (!terrainMesh) return  // Three.js scene not ready — rebuildTerrainFromStore() picks these up on initScene

		const pos     = terrainMesh.geometry.attributes.position
		const col     = terrainMesh.geometry.attributes.color
		const rx      = sessionStore.regionSizeX
		const ry      = sessionStore.regionSizeY
		// WHY: vStride=rx+1 matches terrain geometry vertex layout (rx segments → rx+1 verts/row).
		const vStride = rx + 1

		for (const { x: px, y: py, heights } of patches) {
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
					const raw = heights[hIdx]
					const h = Number.isFinite(raw) ? raw : 0   // NaN-guard: partial decode → flat, not invisible
					pos.setY(vi, h)
					applyHeightColor(col, vi, h)
				}
			}
		}

		pos.needsUpdate = true
		col.needsUpdate = true
		// WHY (perf): defer the full-geometry normal recompute — see _scheduleTerrainNormals.
		_scheduleTerrainNormals()
	}

	// WHY (perf): computeVertexNormals() over the full region geometry (~260k verts on a 512²
	// region) costs ~40-50ms. Running it per TERRAIN_PATCH message blocked the WS handler ~1.3s
	// during region entry (one full recompute per patch message). Vertex positions/colors update
	// live above; coalesce the normal recompute to once, ~150ms after the patch burst settles —
	// terrain shape is immediate, shading settles a beat later.
	let _terrainNormalsTimer = null
	function _scheduleTerrainNormals() {
		if (_terrainNormalsTimer) clearTimeout(_terrainNormalsTimer)
		_terrainNormalsTimer = setTimeout(() => {
			_terrainNormalsTimer = null
			if (terrainMesh) terrainMesh.geometry.computeVertexNormals()
		}, 150)
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
					uiStore.closeLandMenu()
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
		if (_instancePool) for (const im of _instancePool.meshes()) primTargets.push(im)
		const primHits = _raycaster.intersectObjects(primTargets, true)
		if (primHits.length === 0) {
			// Prim miss — try terrain
			if (terrainMesh) {
				const terrHits = _raycaster.intersectObject(terrainMesh, false)
				if (terrHits.length > 0) {
					const hp = terrHits[0].point
					const slX = hp.x, slY = -hp.z, slZ = hp.y
					uiStore.closeAvatarMenu()
					uiStore.closeObjectMenu()
					uiStore.openLandMenu({ pos: [slX, slY, slZ], x: e.clientX, y: e.clientY })
					return
				}
			}
			uiStore.closeAvatarMenu()
			uiStore.closeObjectMenu()
			uiStore.closeLandMenu()
			return
		}
		const primHit = primHits[0]
		let pickedId = null
		if (primHit.object?.userData?.qsInstanced) {
			pickedId = _instancePool.pick(primHit.object, primHit.instanceId)
		} else {
			let hitMesh = primHit.object
			while (hitMesh && hitMesh.userData?.localId === undefined) hitMesh = hitMesh.parent
			if (hitMesh) pickedId = hitMesh.userData.localId
		}
		if (pickedId == null) return
		const obj = worldStore.objects.get(pickedId)
		if (!obj) return
		uiStore.closeAvatarMenu()
		uiStore.closeLandMenu()
		uiStore.openObjectMenu({
			localId: pickedId,
			fullId:  obj.fullId,
			name:    obj.name || obj.text || `Object ${pickedId}`,
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
	// WHY (perf): build queued prim meshes a few at a time, bounded by a per-frame time budget,
	// instead of all-at-once inside the WS message handler. Iterating a Set while deleting the
	// current entry is safe per spec. Fetch the latest obj from worldStore so coalesced updates
	// (multiple ObjectUpdates before the mesh existed) build at the newest state.
	const MESH_DRAIN_BUDGET_MS = 8
	// WHY: per-prim drain work is now cheap (geometry baking moved to the worker), so the drain can
	// blow through thousands of pendingMeshIds per tick — each dispatching a bake. The single worker
	// can't keep up, so in-flight job payloads (queued + posted clones + copied submesh arrays) pile
	// up unbounded → OOM. Stop pulling new prims once the baker is saturated; the leftover ids stay in
	// pendingMeshIds and the next interval tick resumes after the worker has drained below the cap.
	const BAKE_INFLIGHT_CAP = 300
	// Distance from the camera (THREE space) to an object's SL position. Infinity if unknown so a
	// position-less object sorts as "farthest" (evicted first / never reloaded).
	function camDistToObj(obj) {
		if (!obj?.pos || !camera) return Infinity
		const t = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
		return camera.position.distanceTo(t)
	}

	// Near-first reference distance (FEATURE-GAPS: near-first load). "Nearby" means near the AVATAR,
	// not the camera: the orbit/zoom camera can sit far from the avatar, and on a fresh load the camera
	// holds its (128,25,-128) init default until the avatar is placed — so camDistToObj (camera-based,
	// used by culling) would rank by region-center, not the viewer. We use the avatar's own SL position
	// (authoritative, dead-reckoned), falling back to the region spawn while the avatar isn't placed
	// yet. SL-space distance (obj.pos is SL); no THREE conversion needed. Used ONLY for near-first
	// ordering of the build/fetch queues — culling stays on camDistToObj.
	function nearRefDist(obj) {
		if (!obj) return Infinity
		const ref = avatarSLPos || worldStore.spawnPos
		if (!ref) return Infinity
		// Linkset children store PARENT-RELATIVE positions (small offsets, not region coords), so
		// ranking them on obj.pos gives garbage. Resolve to the ROOT's region position so the whole
		// linkset ranks by its real location — mirrors the culler, which operates on roots only.
		let pos = obj.pos
		const pid = obj.parentId ?? 0
		if (pid !== 0) { const root = worldStore.objects.get(pid); if (root?.pos) pos = root.pos }
		if (!pos) return Infinity
		const dx = pos[0] - ref[0], dy = pos[1] - ref[1], dz = pos[2] - ref[2]
		return Math.sqrt(dx * dx + dy * dy + dz * dz)
	}

	// Recompute scene-load telemetry → worldStore for the badge/Prefs. WHY %-within-_effNear: with the
	// dynamic draw distance the culler deliberately won't load past _effNear, so measuring against a
	// fixed 192m span would peg the badge below 100% forever (nothing beyond _effNear will ever build).
	// Instead measure "of the non-avatar roots within the CURRENT draw distance, how many are built" —
	// reaches 100% when the current radius is fully streamed, dips→recovers as _effNear grows or you
	// move. `rangeKnown` (within the full 192m span) is the scene-size signal for the "massive" warning;
	// `atTarget` (_effNear at the user's target) flips the badge from "nearby" to "complete". `evicted`
	// is the total culled-for-memory count.
	function updateCullStats() {
		const ddTarget = Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT)
		let known = 0, resident = 0
		for (const [id, o] of worldStore.objects) {
			if (o.pcode === PCODE_AVATAR) continue
			// Roots only: child pos is PARENT-RELATIVE, so camDistToObj on a child is garbage — and
			// children evict/reload with their root anyway, so root counts represent the linkset.
			if ((o.parentId ?? 0) !== 0) continue
			if (camDistToObj(o) > _effNear) continue   // % is relative to the CURRENT (dynamic) draw distance
			known++
			// A root counts as resident whether it's an individual mesh OR folded into an instance
			// pool — otherwise instancing (which drains meshMap into pools) makes pct stall below 100
			// on a fully-loaded scene.
			if (meshMap.has(id) || (_instancePool && _instancePool.has(id))) resident++
		}
		const pct = known > 0 ? Math.round((resident / known) * 100) : 100
		// "Major" preface = this load has been continuously streaming long enough to be a big/slow one.
		// A quick cull-reload from moving a few metres finishes well under MAJOR_LOAD_MS and never trips
		// it; pct reaching 100 resets the episode so the next short reload starts fresh.
		const now = Date.now()
		if (pct < 100 && known > 0) { if (!_loadEpisodeStart) _loadEpisodeStart = now }
		else _loadEpisodeStart = 0
		// Texture readiness for the badge (FEATURE-GAPS #4): geometry pct can hit 100 while textures are
		// still streaming (the "100% but cubes/bare" report). texPending = anything still queued/in-flight/
		// awaiting GPU build (region-global, not near-set-only — good enough for "is anything still
		// loading?"); texFailed surfaces hard-errored assets so the badge can hint at the Refresh action.
		const tx = getTextureStats()
		worldStore.setCullStats({
			resident, known, evicted: evicted.size, pct,
			atTarget: _effNear >= ddTarget,            // at full target radius → "complete scene", else "nearby"
			massive: _loadEpisodeStart > 0 && (now - _loadEpisodeStart) >= MAJOR_LOAD_MS,
			effNear: Math.round(_effNear),
			texPending: tx.queued + tx.inflight + tx.buildQueued,
			texFailed: tx.hardFail,
		})
		// Dead-scene backstop: hundreds known in range but NOTHING resident for several consecutive
		// scans = the culler death-spiral end state (should be unreachable since the app-budget +
		// R_NEAR-guard fixes; this recovers users anyway instead of asking them to hard-reload).
		_deadScans = (known > 200 && resident === 0) ? _deadScans + 1 : 0
		if (_deadScans >= 3 && Date.now() - _lastAutoRebuild > 120_000) {
			_lastAutoRebuild = Date.now()
			_deadScans = 0
			rebuildScene('auto: dead scene detected')
		}
	}

	// Recovery: clear cull state and rebuild everything we know about. Heavier than Resync World —
	// the resync replay alone can't recover a culled-empty scene because inbound updates for
	// memory-evicted roots are deliberately ignored (see the evicted-gate in onObjectUpdate).
	// Idempotent: re-queuing already-resident objects is a no-op, and cullTick re-evicts (far-first,
	// R_NEAR-guarded) if the rebuild genuinely re-exceeds the budget.
	let _lastAutoRebuild = 0
	let _deadScans = 0
	function rebuildScene(reason) {
		const line = `[3D] Rebuild Scene (${reason}): evicted=${evicted.size} resident=${meshMap.size} known=${worldStore.objects.size} buildQ=${pendingMeshIds.size}`
		debugStore.push('warn', line)
		try { wsEmit(C.CLIENT_LOG, { level: 'warn', msg: line, stack: '' }) } catch { /* ignore */ }
		evicted.clear()
		_overTicks = 0
		for (const [id] of worldStore.objects) {
			if (!meshMap.has(id)) pendingMeshIds.add(id)
		}
		// Server replay refreshes worldStore (objects + terrain) underneath the rebuild.
		try { wsEmit(C.RESYNC_WORLD, {}) } catch { /* not connected */ }
	}

	// Memory-budget distance culling. WHY both passes EVERY tick (not evict-XOR-reload): on a dense
	// region assets stay above target, so an "else if reload" never runs → objects ahead never rebuild
	// as you walk (you walk into emptiness). Instead, ALWAYS reload the nearest evicted within R_NEAR
	// (stream-in), and SEPARATELY evict the farthest when over budget (fund it). Net: the resident set
	// tracks proximity, bounded by the budget. selectEvictions takes farthest-first so a just-reloaded
	// near object is never the one evicted. Works on all browsers (self-accounted bytes, not
	// performance.memory); the process-heap emergency brake still applies where measurable.
	// ── FEATURE-GAPS #6 draw-call instancing: migrate/promote helpers ──
	// Re-derive the geomKey exactly as upsertMesh does (the prim path bakes scale into geometry).
	function geomKeyFor(obj) {
		const bakeScale = (obj.meshId || obj.sculptId) ? [1, 1, 1] : (obj.scale || [1, 1, 1])
		return obj.meshId ? meshGeomKey(obj.meshId)
			: obj.sculptId ? sculptGeomKey(obj.sculptId, obj.sculptType ?? 1)
			: primGeomKey(obj.shape, bakeScale)
	}

	function splitPartsCached(gk, geom) {
		let p = _partsCache.get(gk)
		if (!p) { p = splitParts(geom); _partsCache.set(gk, p) }
		return p
	}

	// Describe an object's instance pools, or null if it is not yet instanceable
	// (placeholder, geometry not baked, or texture not applied yet → retry a later tick).
	// WHY clone the LIVE material (not a fresh MeshBasic): the individual mesh's material has
	// already been through applyTexAlpha + colour + lit/PBR + UV-transform in upsertMesh. Cloning
	// it carries transparency/blend/alphaTest/lit/PBR/side and the exact texture+UV — a bare
	// MeshBasic dropped all that (alpha textures rendered black where transparent). Per-object tint
	// rides InstancedMesh.instanceColor (= the live material's colour), so the pool material's base
	// colour is whited out and same-geometry/same-material objects pool across tints.
	function describeForPool(localId, mesh, obj) {
		if (obj._placeholder) return null
		const geom = mesh.geometry
		if (!geom) return null
		const gk = geomKeyFor(obj)
		if (!geomMemGet(gk)) return null   // geometry not baked into the RAM cache yet → wait
		const multi = hasMultiFaceMesh(obj) || hasMultiFacePrim(obj)
		const matArr = Array.isArray(mesh.material) ? mesh.material : null
		if (multi && !matArr) return null   // per-face material swap not applied yet → wait
		// Only decompose genuinely multi-material objects. A single-textured box prim can
		// carry 6 geometry groups (one per face) — those must stay ONE pool, not six.
		const parts = multi ? splitPartsCached(gk, geom) : [{ materialIndex: 0, geometry: geom }]
		const out = []
		for (const part of parts) {
			const srcMat = matArr ? matArr[part.materialIndex] : mesh.material
			if (!srcMat) return null
			const faceTex = multi
				? ((obj.faceTextures && obj.faceTextures[part.materialIndex]) || obj.defaultTexture)
				: pickPrimTexture(obj)
			const texId = isRealTex(faceTex) ? faceTex : (isRealTex(obj.defaultTexture) ? obj.defaultTexture : null)
			// Readiness: an object that SHOULD be textured but whose LIVE material has no map yet
			// hasn't finished texturing — wait (avoids baking a bare/black instance into the pool).
			if (texId && !srcMat.map) return null
			const map = srcMat.map
			const uvk = map ? `${map.repeat.x},${map.repeat.y},${map.offset.x},${map.offset.y},${map.rotation}` : ''
			const mk = materialKey({
				texId, uvKey: uvk,
				alpha: !!srcMat.transparent,
				blend: srcMat.blending !== THREE.NormalBlending,
				fullbright: !!obj.defaultFullbright,
				lit: !!(srcMat.isMeshLambertMaterial || srcMat.isMeshStandardMaterial),
				pbr: !!srcMat.isMeshStandardMaterial,
			})
			// side + alphaTest also gate interchangeability; append them so they don't wrongly pool.
			const poolKey = `${gk}::${part.materialIndex}::${mk}::${srcMat.side}:${srcMat.alphaTest || 0}`
			out.push({ poolKey, part, srcMat })
		}
		return out
	}

	// Fold a settled individual mesh into the instance pool, then drop the individual mesh.
	function migrateIn(localId, mesh, obj) {
		const desc = describeForPool(localId, mesh, obj)
		if (!desc) return false
		mesh.updateWorldMatrix(true, false)
		const matrix = mesh.matrixWorld.clone()
		// Remove the individual mesh BEFORE adding to the pool, so the pool-aware removeMesh
		// branch (which short-circuits on pooled ids) does normal individual removal here.
		// Cloning in the factory still works after dispose(): dispose frees GPU buffers, not the
		// JS-side attribute arrays / material props that .clone() copies (the map texture is
		// cache-owned and not disposed by material.dispose()).
		removeMesh(localId)
		const pool = ensureInstancePool()
		for (const d of desc) {
			// instanceColor = the live material's actual colour (TE tint, hashed fallback, etc.) so
			// the pooled white-based material × instanceColor reproduces the individual mesh exactly.
			const color = d.srcMat.color ? d.srcMat.color.clone() : new THREE.Color(1, 1, 1)
			const factory = () => {
				const mat = d.srcMat.clone()
				mat.color.set(0xffffff)   // tint rides instanceColor; keeps pooling across tints
				mat.needsUpdate = true
				return { geometry: d.part.geometry.clone(), material: mat }
			}
			pool.add(d.poolKey, factory, matrix, color, localId)
		}
		return true
	}

	// Pull an object back out of the pool to an individual mesh (went dynamic / edit-selected).
	function promoteOut(localId) {
		if (!_instancePool || !_instancePool.has(localId)) return
		_instancePool.remove(localId)
		const obj = worldStore.objects.get(localId)
		if (obj) upsertMesh(obj)   // rebuild through the normal path
	}

	// ── #11 main-thread-saturation probe (DEV; DISPOSABLE) ── time a synchronous callback and relay
	// to the server log when it blocks the main thread > threshold, so we can attribute the multi-second
	// longtasks (which [Main]'s WS-only breakdown can't see) to a specific function. Remove once #11 is
	// root-caused. WHY direct timing not the PerformanceObserver: the observer fires in a LATER task, by
	// which point any "current op" marker is already cleared — synchronous timing attributes correctly.
	function timed(name, fn) {
		const t0 = performance.now()
		try { return fn() }
		finally {
			const dt = performance.now() - t0
			_phaseMs[name] = (_phaseMs[name] || 0) + dt   // #11 attribution: accumulate per-phase main-thread ms
			if (dt > 250) {
				try { wsEmit(C.CLIENT_LOG, { level: 'warn', msg: `[Slow] ${name} ${Math.round(dt)}ms (objs=${worldStore.objects.size} meshMap=${meshMap.size} buildQ=${pendingMeshIds.size} inst=${_instancePool?.count() ?? 0})`, stack: '' }) } catch { /* not connected */ }
			}
		}
	}

	function cullTick() {
		if (!camera) return
		// Push the truthful resident-asset total to the governor: texture bitmaps (O(cache)) +
		// decoded mesh cache (O(1) running total) + live geometry (3s telemetry's last O(n) scan).
		// WHY no getGeomMemBytes(): the geom mem cache tier is CPU-RAM-only (never uploaded to the GPU),
		// so it does not belong in the VRAM budget. Counting it here stole ~128MB+ from live geometry
		// and worsened the cull-spiral (FEATURE-GAPS #13). It has its own RAM budget (setGeomMemBudget).
		// Must match the 3s stats-timer sum or the governor signal oscillates between the two sites.
		setAppBytes(getTextureBytes() + getMeshBytes() + _lastGeomB)
		// Corroborates the soft-heap brake (memGovernor.heapThrottled): a real resident scene means a
		// high heap is OUR load (throttle), not a hard-reload inheriting the prior page's garbage (build).
		setResidentCount(meshMap.size)
		// Warm-read decouple (FEATURE-GAPS #10): detect region entry (login/TP/walk) by coords, reset
		// per-region key tracking, and prefetch that region's manifest into the mem tier before its
		// ObjectUpdate storm. Uniform across all entry paths — no per-handler wiring needed.
		const regionKey = `${sessionStore.regionX}-${sessionStore.regionY}`
		if (regionKey !== _currentRegionKey) {
			_currentRegionKey = regionKey
			_regionGeomKeys = new Set()
			_wasLoading = true   // entering a region = loading; the next loading→false is its first settle edge
			geomManifestPrefetch(regionKey)   // fire-and-forget; warms the mem tier
		}
		// Drive geomCache write-deferral from the same load signal the lit/badge logic uses. While
		// loading, geomCache suspends IDB flushes so warm getMany reads aren't starved.
		const tStat = getTextureStats(), mStat = getMeshStats()
		const loading = pendingMeshIds.size > 50 || tStat.queued > 0 || tStat.inflight > 0 || mStat.queued > 0 || _geomPending > 25
		setGeomCacheLoading(loading)
		setTexCacheLoading(loading)   // same load signal: suspend qs-tex flushes so reads aren't starved
		// Re-record this region's key manifest on every settle EDGE (loading true→false). geomManifestRecord
		// no-ops unless the key set grew, so the manifest converges UP to the full working set across the
		// settle dips of a heavy load and across revisits — fixing the early, draw-distance-limited snapshot
		// that froze warm coverage at a small slice (the partial-manifest cause of warm idb=0 re-bakes).
		if (_wasLoading && !loading && _currentRegionKey && _regionGeomKeys.size) {
			geomManifestRecord(_currentRegionKey, [..._regionGeomKeys])
		}
		_wasLoading = loading
		const r = appRatio()
		const heapR = memRatio()
		// Heap-pressure cap on the geom RAM cache (FEATURE-GAPS #13): the mem tier is plain tab-heap
		// ArrayBuffers, so on a dense region it can push the process heap to OOM and crash the tab
		// (observed: heap 107%, ~800MB geom cache on top of resident geometry). Clamp it HARD when the
		// heap is genuinely tight AND the cache is actually holding enough to be worth shedding — guard
		// against over-reacting to GC-able garbage (memGovernor's lesson). Hysteresis band 0.68–0.82.
		if (heapR != null && heapR > GEOM_MEM_HEAP_CAP_AT && getGeomMemBytes() > GEOM_MEM_CAP_FLOOR) {
			setGeomMemPressureCap(GEOM_MEM_CAP_FLOOR)   // shrink to the floor; survival over warm-cache speed
		} else if (heapR == null || heapR < GEOM_MEM_HEAP_RELEASE_AT) {
			setGeomMemPressureCap(null)                 // clear: restore the configured RAM budget
		}
		// EVICTION + texture-prune trigger = VRAM/app budget exceeded, or a genuine heap CRISIS
		// (emergencyHeap, ~0.95). WHY NOT moderate heap (>0.82): evicting resident assets does NOT
		// relieve heap (it's held by transient bake/decode garbage, not the resident scene) — it just
		// churns the visible world to cubes and prunes near textures away for no benefit (live: eviction
		// firing every tick at app=43% heap=84%, textures vanishing). Moderate heap pressure is handled
		// by PAUSING intake (memUnderPressure/the critical brake), not by evicting. See FEATURE-GAPS #13.
		const over = r > CULL_TARGET || emergencyHeap()
		// Linkset unit-handling: the culler only ranks ROOTS (child pos is parent-relative → its
		// distance is meaningless) and moves each root's children with it via this per-tick index.
		// Built once per tick, only when there is cull work to do.
		const kids = (evicted.size || over) ? groupChildrenByRoot(worldStore.objects) : null
		// 1) Stream-in: rebuild nearest evicted objects within R_NEAR, regardless of current pressure.
		if (evicted.size) {
			const cands = []
			for (const id of evicted) {
				const obj = worldStore.objects.get(id)
				if (!obj) { evicted.delete(id); continue }   // object gone (KillObject) → forget it
				cands.push({ id, dist: camDistToObj(obj) })
			}
			// Plenty of headroom → recover everything nearest-first; otherwise only within _effNear.
			const ids = selectReloads(cands, r < CULL_RESUME ? Infinity : _effNear, MAX_RELOAD_PER_TICK)
			for (const id of ids) {
				evicted.delete(id)
				pendingMeshIds.add(id)
				// Re-queue the root's children too — they were swept out of meshMap at eviction and
				// nothing else rebuilds them (the sim won't resend; culling is client-side only).
				// Build order doesn't matter: a child built before its root parks in orphansByParent.
				for (const cid of kids.get(id) ?? []) {
					if (!meshMap.has(cid) && worldStore.objects.has(cid)) pendingMeshIds.add(cid)
				}
			}
		}
		// 2) Stream-out: if over budget, evict the farthest resident ROOT meshes (whole linksets).
		// Debounced: a single spiky sample must not trigger eviction — only sustained pressure
		// (EVICT_AFTER_TICKS consecutive over-target ticks) does.
		_overTicks = over ? _overTicks + 1 : 0
		if (_overTicks >= EVICT_AFTER_TICKS) {
			const editId = uiStore.editObjectId
			const cands = []
			for (const [id] of meshMap) {
				const obj = worldStore.objects.get(id)
				if (!obj) continue
				if (obj.pcode === PCODE_AVATAR) continue   // never evict avatars
				if ((obj.parentId ?? 0) !== 0) continue    // children ride with their root
				if (id === ownAvatarLocalId || id === editId) continue
				cands.push({ id, dist: camDistToObj(obj) })
			}
			// Draw-distance guard: never evict the player's immediate surroundings — eviction stops once
			// only objects within _effNear remain (see selectEvictions). When even that can't free
			// enough, the step-down below shrinks _effNear so eviction regains candidates next tick.
			const ids = selectEvictions(cands, MAX_EVICT_PER_TICK, _effNear)
			let _evRoots = 0, _evKids = 0
			for (const id of ids) {
				const childIds = kids.get(id) ?? []
				// Never evict a linkset somebody is sitting on — a seated avatar parents to a prim, and
				// removeMesh would dispose the avatar with the subtree. Same if a CHILD is being edited
				// (the root-level editId check above can't see that).
				if (childIds.some(cid => cid === editId || worldStore.objects.get(cid)?.pcode === PCODE_AVATAR)) continue
				// Children FIRST via removeMesh so each gets full cleanup (meshMap/labels/hoverText) —
				// the old subtree-dispose left children in meshMap as disposed zombies that upsertMesh
				// treated as alive, permanently breaking linksets (the "lost objects" bug).
				for (const cid of childIds) { removeMesh(cid); pendingMeshIds.delete(cid) }
				removeMesh(id)
				pendingMeshIds.delete(id)
				evicted.add(id)   // root only — reload re-queues children from the index
				_evRoots++; _evKids += childIds.length
			}
			// Forensics for the mass-disappearance bug: cull evictions were previously silent, making
			// them indistinguishable from sim KillObject in the logs. One line per evicting tick.
			if (_evRoots) {
				const eline = `[Cull] evicted ${_evRoots} roots (+${_evKids} children) app=${(r * 100).toFixed(0)}% heap=${heapR != null ? (heapR * 100).toFixed(0) + '%' : 'n/a'} overTicks=${_overTicks} evictedTotal=${evicted.size} resident=${meshMap.size}`
				debugStore.push('warn', eline)
				try { wsEmit(C.CLIENT_LOG, { level: 'warn', msg: eline, stack: '' }) } catch { /* ignore */ }
			}
			// Also bound the in-memory texture cache (the larger, mesh-independent hog). Prunes only
			// textures not applied in the last 20s, so near faces are unaffected; blanks self-heal via
			// backfillTextures. Only runs here (over budget), so the steady state never churns.
			pruneTexturesLRU(96)
			// Draw-distance down-step (controller): we've been over budget for EVICT_AFTER_TICKS+ ticks.
			// Shrink _effNear so eviction can reach the heavy geometry sitting WITHIN the current radius.
			// WHY NOT gated on "evicted nothing" (the original bug, caught 2026-06-13 pre-commit): eviction
			// usually makes PARTIAL progress (a few far roots/tick) yet never catches up when the bulk of
			// geomMB is inside _effNear — measured live with app pinned ~100% ⚠THROTTLING, dd frozen at 96m,
			// drain paused by the governor (gov=403), and warm IDB reads timing out → everything re-baked
			// (idb=0, wdog climbing). Stepping down on sustained pressure shrinks the resident set until it
			// fits; the headroom up-step below grows it back. Throttled to every other over-tick so the
			// 32-root/tick eviction can catch up between steps (limits draw-distance overshoot). Floors at
			// DRAW_DIST_MIN so the immediate surroundings always stay resident.
			if (_effNear > DRAW_DIST_MIN && (_overTicks % 2) === 0) {
				_effNear = Math.max(DRAW_DIST_MIN, _effNear - DRAW_DIST_STEP)
				const dline = `[Cull] over budget (${(r * 100).toFixed(0)}%) for ${_overTicks} ticks → draw distance ↓ ${_effNear}m (was ${_effNear + DRAW_DIST_STEP}m)`
				debugStore.push('warn', dline)
				try { wsEmit(C.CLIENT_LOG, { level: 'warn', msg: dline, stack: '' }) } catch { /* ignore */ }
			}
		}
		// Draw-distance recovery (FS progressive-stepping equivalent): grow _effNear back toward the
		// user's target when there's real headroom; snap down at once if the user lowered the target.
		// Hysteresis (shrink at >CULL_TARGET, grow at <CULL_RESUME) prevents boundary oscillation.
		const ddTarget = Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT)
		if (_effNear > ddTarget) _effNear = ddTarget
		// Grow back ONLY when app AND heap both have headroom. The prior app-only gate grew dd every tick
		// under pure heap pressure (app low, heap pinned), canceling the step-down → dd never shrank.
		else if (drawDistanceMayGrow(r, heapR, CULL_RESUME, GEOM_MEM_HEAP_RELEASE_AT) && _effNear < ddTarget) _effNear = Math.min(ddTarget, _effNear + DRAW_DIST_STEP)
		uiStore.setEffectiveDrawDistance?.(_effNear)
		// Throttle the O(n) stats scan (iterates all objects) to ~every 3s, off the hot path.
		if ((_cullStatTick++ % 3) === 0) updateCullStats()
		// FEATURE-GAPS #6: fold settled meshes into the instance pool (gated; no-op when OFF).
		// WHY throttled + backlog-gated: each migrateIn clones geometry+material on the main thread.
		// Running it hard DURING a heavy cold load competes with the build/drain + texture pipeline
		// (already main-thread-bound, see #11) and worsens the load. So skip migration while a large
		// build backlog is still draining, and cap it low so it trickles in once the scene calms.
		if (uiStore.instancing && pendingMeshIds.size <= INSTANCE_MIGRATE_BACKLOG_MAX) {
			const now = performance.now()
			let budget = INSTANCE_MIGRATE_PER_TICK   // cap migrations per tick to avoid a hitch
			const ids = [...meshMap.keys()]   // snapshot — migrateIn mutates meshMap
			for (const id of ids) {
				if (budget <= 0) break
				const mesh = meshMap.get(id)
				if (!mesh) continue
				const obj = worldStore.objects.get(id)
				if (!obj || obj.pcode === PCODE_AVATAR) continue
				const last = _lastMoveAt.get(id) ?? 0
				if (now - last < SETTLE_MS) continue
				if (migrateIn(id, mesh, obj)) budget--
			}
		}
	}

	// The render/draw-distance horizon (m) — what the user wants to SEE. The visibility cull hides roots
	// beyond it, and the build path skips fetching diffuse textures beyond it (near-aware, FEATURE-GAPS
	// #13). STABLE (user slider), distinct from the oscillating memory-eviction radius _effNear.
	function renderRadius() { return Math.max(DRAW_DIST_MIN, uiStore.drawDistance ?? DRAW_DIST_DEFAULT) }

	// Render-distance visibility cull (FEATURE-GAPS #13, render ceiling). Hide ROOT meshes beyond the
	// draw-distance target so WebGLRenderer.render stops traversing them every frame; show them again
	// within the hysteresis band. Decoupled from memory eviction (cullTick): eviction only fires over
	// budget, so on a region that fits the heap nothing far is otherwise removed → it all gets traversed
	// (the 3–6fps "300m+ drawn at dd=192m" cost). Roots only — projectObject early-returns on an invisible
	// parent and skips the whole subtree, so one .visible flag collapses a linkset's traversal. Hide, don't
	// evict: meshes stay resident in meshMap (instant re-show, no rebuild).
	// WHY the STABLE ddTarget, not _effNear: _effNear is the memory governor's radius and it OSCILLATES
	// (steps ±DRAW_DIST_STEP each tick under load pressure). Hiding on it made objects near the boundary
	// FLICKER hidden/shown as _effNear swung past them — the 16m hysteresis is measured against the current
	// radius, so a moving radius defeats it (live: "far objects flicker on/off for the first couple
	// minutes"). The render horizon is what the USER wants to see (a fixed target), not the governor's
	// internal pressure radius. Under pressure _effNear < ddTarget and cullTick EVICTS beyond _effNear
	// (removes from meshMap → not a candidate here), so the resident set the cull shows is still bounded;
	// this just stops the boundary churn. Cheap: a distance compare + boolean write per root, no allocation
	// in the hot loop. ~5Hz is enough for snappy pop-in. Protected ids (avatars/own/edited) never hidden.
	function visibilityTick() {
		if (!camera) return
		const ddTarget = renderRadius()
		const editId = uiStore.editObjectId
		const cands = []
		for (const [id, mesh] of meshMap) {
			const obj = worldStore.objects.get(id)
			if (!obj) continue                          // KillObject race — leave for cullTick/removeMesh
			if (mesh.userData._rescueN >= 2) continue   // render-quarantined (strike 2 hid it) — don't re-show
			if ((obj.parentId ?? 0) !== 0) continue     // children ride their root's visibility
			if (obj.pcode === PCODE_AVATAR) continue    // never hide avatars
			if (id === ownAvatarLocalId || id === editId) continue  // never hide own/edited
			cands.push({ id, dist: camDistToObj(obj), visible: mesh.visible })
		}
		const { show, hide } = selectVisibility(cands, ddTarget, VIS_CULL_HYSTERESIS)
		for (const id of show) { const m = meshMap.get(id); if (m) m.visible = true }
		for (const id of hide) { const m = meshMap.get(id); if (m) m.visible = false }
	}

	// Frame-budgeted ingestion: pull prim objects off _ingestQueue and do the upsert + (optional)
	// persist + mesh-queue-add that onObjectUpdate used to do synchronously. Runs on the 30ms drain
	// interval (CPU work, focus-independent). Builds are still gated separately in drainMeshQueue.
	const INGEST_BUDGET_MS = 6
	const INGEST_MAX = 512
	function pumpIngest() {
		if (!_ingestQueue.length) return
		// Memory governor: pause pulling prims off the ingest queue under pressure (heap soft-brake,
		// VRAM budget, or the 0.95 OOM brake). Each ingest does upsertObject + queues a mesh build, so
		// continuing would feed buildQ + worldStore while the heap is already tight (the cold-load churn:
		// buildQ ran away to 42k). The queue retains its items and drains once pressure clears.
		if (memUnderPressure()) return
		const hidden = (typeof document !== 'undefined' && document.hidden)
		drainWithinBudget({
			queue: _ingestQueue,
			maxItems: hidden ? 4096 : INGEST_MAX,
			budgetMs: hidden ? 250 : INGEST_BUDGET_MS,
			processOne: ({ o, persist }) => {
				worldStore.upsertObject(o)
				if (persist) {
					// Persist the MERGED record (never the raw update) — same semantics as the old
					// persistObjects: a partial update must not overwrite a complete cached record.
					const key = regionCacheKey()
					if (key) objCachePut(key, { ...(worldStore.objects.get(o.localId) ?? {}), ...o })
				}
				// Evicted linksets stay evicted on inbound updates (data persisted, mesh not queued —
				// cullTick reloads the whole linkset when near). Same guard as the old inline path.
				if (!(evicted.has(o.localId) || evicted.has(o.parentId ?? 0))) {
					pendingMeshIds.add(o.localId)
				}
			},
			onError: (e, item) => {
				upsertMeshFailures++
				if (upsertMeshFailures <= 5 || upsertMeshFailures % 25 === 0) {
					debugStore.push('warn', `[3D] ingest fail #${upsertMeshFailures} localId=${item?.o?.localId}: ${e.message}`)
				}
			},
		})
	}

	// Near-first drain order (FEATURE-GAPS: near-first load). pendingMeshIds (a Set) stays the
	// source of truth for membership; _drainOrder is a throttled distance-sorted view of it that
	// drainMeshQueue walks so the player's surroundings build BEFORE far objects. Rebuilt only when
	// stale (TTL elapsed, fully drained, or the camera moved enough that "nearest" changed) so the
	// O(n log n) sort runs ~1×/s, never per frame. Stale ids left in the array are skipped on walk.
	let _drainOrder = []
	let _drainCursor = 0
	let _drainOrderAt = 0
	let _drainOrderRef = null   // [x,y,z] viewer ref (avatar/spawn) at last rebuild — re-sort on move
	const DRAIN_ORDER_TTL_MS = 2000   // #11: re-sort the near-first order at most ~2×/window (was 750ms);
	const DRAIN_ORDER_MOVE_M = 8      // a huge queue makes each rebuild non-trivial even after the O(n) fix
	// — movement still forces a fresh sort so "nearest from where you stand" stays correct.

	function rebuildDrainOrder() {
		_drainOrder = orderByDistance([...pendingMeshIds], (id) => {
			const o = worldStore.objects.get(id)
			return o ? nearRefDist(o) : Infinity   // unknown/killed → sort last (skipped on walk)
		})
		_drainCursor = 0
		_drainOrderAt = performance.now()
		const ref = avatarSLPos || worldStore.spawnPos
		_drainOrderRef = ref ? [ref[0], ref[1], ref[2]] : null
	}

	function drainMeshQueue() {
		if (!pendingMeshIds.size) { _dtEmpty++; return }
		// Memory governor: stop baking new geometry while the JS heap is near its limit (each bake adds
		// a BufferGeometry + material). Queued ids stay; the next tick resumes once pressure clears.
		if (memUnderPressure()) { _dtGov++; return }
		_dtTicks++
		const start = performance.now()
		// Hidden tab: Chrome clamps setInterval to ~1Hz, so the 8ms/30ms pacing collapses to 8ms/s and
		// the load crawls exactly while the user is away. No frames to protect when hidden → spend a
		// big budget per (rare) tick instead. Visible tab keeps the small per-frame budget.
		const budget = (typeof document !== 'undefined' && document.hidden) ? 250 : MESH_DRAIN_BUDGET_MS
		// Rebuild the near-first order when stale: exhausted, TTL elapsed, or the avatar moved far
		// enough that the existing ordering no longer reflects "nearest from where the player stands".
		const ref = avatarSLPos || worldStore.spawnPos
		let refMoved = 0
		if (ref && _drainOrderRef) {
			const dx = ref[0] - _drainOrderRef[0], dy = ref[1] - _drainOrderRef[1], dz = ref[2] - _drainOrderRef[2]
			refMoved = Math.sqrt(dx * dx + dy * dy + dz * dz)
		}
		if (_drainCursor >= _drainOrder.length ||
			performance.now() - _drainOrderAt > DRAIN_ORDER_TTL_MS ||
			refMoved > DRAIN_ORDER_MOVE_M) {
			rebuildDrainOrder()
		}
		while (_drainCursor < _drainOrder.length) {
			// WHY + _geomPending: bake dispatch is deferred behind the async IDB lookup, so deferred
			// entries are future bakes the cap must see — outstanding() alone rises too late on cold load.
			if (meshBaker.outstanding() + _geomPending > BAKE_INFLIGHT_CAP) { _dtBrkCap++; break }   // backpressure: let the worker catch up
			const localId = _drainOrder[_drainCursor++]
			if (!pendingMeshIds.has(localId)) continue   // killed / evicted / already built since the sort
			pendingMeshIds.delete(localId)
			const obj = worldStore.objects.get(localId)
			if (!obj) continue  // killed before its mesh was built
			const t0 = performance.now()
			try {
				upsertMesh(obj)
			} catch (e) {
				upsertMeshFailures++
				if (upsertMeshFailures <= 5 || upsertMeshFailures % 25 === 0) {
					debugStore.push('warn', `[3D] upsertMesh(drain) fail #${upsertMeshFailures} localId=${localId} pcode=${obj.pcode}: ${e.message}`)
				}
			}
			// Throughput probe: per-call upsertMesh cost is the cold-load bottleneck (~30 builds/s on a
			// 31k-prim region). Accumulated here, reported+reset by the 5s asset-stats tick as [Drain].
			const dt = performance.now() - t0
			_drainBuilt++; _drainMs += dt; if (dt > _drainMaxMs) _drainMaxMs = dt
			if (performance.now() - start > budget) { _dtBrkBudget++; break }
		}
		// C1 (perf): once the initial flood has fully drained, precompile shaders off the render
		// path (async, non-blocking where the GPU supports KHR_parallel_shader_compile) so the
		// first camera move doesn't hit a lazy synchronous shader-compile stall (~271ms observed).
		if (pendingMeshIds.size === 0 && !_didPrecompile && meshMap.size > 50 && renderer) {
			_didPrecompile = true
			renderer.compileAsync?.(scene, camera)
		}
	}

	// WHY: A child built before its root's MESH exists is added to scene at parent-LOCAL coords
	// (mispositioned + label hidden), and the root's one-shot reparent scan already ran — so it's
	// never reattached. Slow mesh-build makes this common. Periodic sweep: any scene-orphan whose
	// parent mesh now exists gets moved under it (its local pos/rot then resolve correctly).
	function reparentOrphans() {
		for (const mesh of meshMap.values()) {
			const pid = mesh.userData?.parentId ?? 0
			if (pid === 0 || mesh.parent !== scene) continue
			const parentMesh = meshMap.get(pid)
			if (!parentMesh) continue
			scene.remove(mesh)
			parentMesh.add(mesh)
			if (mesh.userData.hoverLabel) mesh.userData.hoverLabel.visible = true
		}
	}

	// Re-apply a prim's diffuse texture to an already-built mesh that still lacks a map. Used by the
	// backfill pass: applies textures that arrived AFTER the mesh built, and drives retries of timed-
	// out fetches (getTexture re-queues soft-failed UUIDs until the fetcher's retry budget). Success
	// also persists to IDB, so each reload starts fuller — the "textures don't stick" fix.
	// Mesh per-face multi-material: replace the mesh's single material with one MeshBasicMaterial per
	// submesh/geometry-group (group.materialIndex = SL face index). Each face gets its faceTextures[i]
	// (else defaultTexture) + faceColors[i] tint (else defaultColor) + its per-face UV (faceRepeats/
	// faceOffset/faceRotation, falling back to the default UV). Textures fill in async; the array is
	// assigned immediately so the mesh renders (tinted) while they load.
	// Planar texgen (TE TexGen = 1): SL ignores the authored UVs and projects the texture from each
	// vertex's scaled volume position along its normal's dominant axis (lib/planarUV.js, ported from
	// FS planarProjection). Without this, planar faces sample a degenerate authored atlas → stripes/
	// moire. Recomputes the uv attribute in place for every face group whose effective TexGen is
	// planar — safe because each bake produces per-object buffers (nothing shared). Must run AFTER
	// the final geometry swap/rescale (positions carry the baked scale, which planar mapping needs:
	// repeats are per-meter). The TE repeat/offset/rotation transform still applies on top via the
	// texture matrix, same as non-planar. NOTE: a later pure-rescale update desyncs these UVs
	// slightly until the next full rebuild — accepted (rescale of planar-mapped objects is rare).
	function applyPlanarUVs(mesh, obj, faceMap = null) {
		const tg = (slFace) => obj.faceTexGen?.[slFace] ?? obj.defaultTexGen
		const geo = mesh.geometry
		const pos = geo?.attributes?.position
		if (!pos) return
		const groups = (geo.groups && geo.groups.length)
			? geo.groups
			: [{ start: 0, count: geo.index ? geo.index.count : pos.count, materialIndex: 0 }]
		if (!groups.some((g) => tg(slFaceForGroup(faceMap, g.materialIndex ?? 0)) === 1)) return
		if (!geo.attributes.normal) geo.computeVertexNormals()
		const nrm = geo.attributes.normal
		let uv = geo.attributes.uv
		if (!uv || uv.count !== pos.count) {
			uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2)
			geo.setAttribute('uv', uv)
		}
		const idx = geo.index
		for (const g of groups) {
			if (tg(slFaceForGroup(faceMap, g.materialIndex ?? 0)) !== 1) continue
			const end = g.start + g.count
			for (let i = g.start; i < end; i++) {
				const v = idx ? idx.getX(i) : i
				const [u, w] = planarUVFromThree(
					pos.getX(v), pos.getY(v), pos.getZ(v),
					nrm.getX(v), nrm.getY(v), nrm.getZ(v),
				)
				uv.setXY(v, u, w)
			}
		}
		uv.needsUpdate = true
	}

	function buildFaceMaterials(mesh, obj, faceMap = null) {
		const groups = mesh.geometry?.groups
		if (!groups || !groups.length) return   // no groups → can't split; leave the single material
		const maxIdx = groups.reduce((m, g) => Math.max(m, g.materialIndex ?? 0), 0)
		// Group materialIndex → SL TextureEntry face index. Identity for meshes (no map).
		const sf = (i) => slFaceForGroup(faceMap, i)
		// Per-face UV transform: face override if present, else the prim default; identity → null.
		const faceXform = (i) => uvXform(
			obj.faceRepeats?.[sf(i)] ?? obj.defaultRepeats,
			obj.faceOffset?.[sf(i)] ?? obj.defaultOffset,
			obj.faceRotation?.[sf(i)] ?? obj.defaultRotation,
		)
		const mats = []
		// Lit-shading A/B: same class choice as the single-material path (fullbright → stays unlit).
		const FaceMat = (uiStore.litShading && !obj.defaultFullbright) ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial
		for (let i = 0; i <= maxIdx; i++) {
			const fc = obj.faceColors?.[sf(i)] ?? obj.defaultColor
			const m = new FaceMat({ color: fc ? new THREE.Color(fc[0], fc[1], fc[2]) : new THREE.Color(0xffffff) })
			if (fc && fc[3] < 0.99) { m.transparent = true; m.opacity = fc[3] }
			mats.push(m)
		}
		const oldMat = mesh.material
		mesh.material = mats
		if (!Array.isArray(oldMat)) oldMat.dispose?.()   // single placeholder material no longer used
		for (let i = 0; i < mats.length; i++) {
			const faceTex = isRealTex(obj.faceTextures?.[sf(i)]) ? obj.faceTextures[sf(i)]
				: (isRealTex(obj.defaultTexture) ? obj.defaultTexture : null)
			if (!faceTex) continue
			const m = mats[i]
			getTexture(faceTex, faceXform(i), nearRefDist(obj)).then(tex => {
				if (!tex || !mesh.parent || mesh.material !== mats) return   // stale (removed/re-materialed)
				m.map = tex
				if (!(obj.faceColors?.[sf(i)] ?? obj.defaultColor)) m.color.set(0xffffff)   // no tint → show true texture colors
				applyTexAlpha(m, tex, obj)
				m.needsUpdate = true
			})
		}
	}

	// Alpha (#17b): a texture with real transparency (server-reported hasAlpha) renders alpha-BLENDED,
	// matching the SL legacy default (DIFFUSE_ALPHA_MODE_BLEND) — gradient alphas (sky domes, fades,
	// soft foliage edges) stay smooth. The previous alphaTest=0.5 cutout quantized gradients into hard
	// opaque/invisible bands (striping). depthWrite STAYS ON — the earlier white-wash regression came
	// from depthWrite=false, not from blending. The small alphaTest discards near-zero fragments so a
	// texture's fully-transparent regions don't write depth and hide what's behind them.
	// 'mask' restores the old hard cutout; '' / null = auto (blend when the texture has alpha).
	function stampAlphaMode(mat, hasAlpha, mode) {
		const m = mode || (hasAlpha ? 'blend' : 'none')
		if (m === 'blend')     { mat.transparent = true;  mat.alphaTest = 0.05; mat.depthWrite = true }
		else if (m === 'mask') { mat.transparent = false; mat.opacity = 1; mat.alphaTest = 0.5; mat.depthWrite = true }
		else                   { mat.transparent = false; mat.opacity = 1; mat.alphaTest = 0 }   // none/emissive
	}

	// Alpha precedence (FS parity): floater override > legacy-material DiffuseAlphaMode (FS greys the
	// edit controls out when a material drives them) > auto (blend when the texture has alpha).
	// materialAlphaMode: 0 none, 1 blend, 2 mask (AlphaMaskCutoff/255), 3 emissive (no emissive on
	// unlit prim materials → renders as none).
	function alphaPolicyStamp(mat, hasAlpha, obj) {
		const override = obj?.alphaModeOverride
		if (override) return stampAlphaMode(mat, hasAlpha, override)
		const dm = obj?.materialAlphaMode
		if (dm === 1) return stampAlphaMode(mat, hasAlpha, 'blend')
		if (dm === 2) {
			mat.transparent = false; mat.opacity = 1; mat.depthWrite = true
			mat.alphaTest = (obj.materialAlphaCutoff ?? 128) / 255
			return
		}
		if (dm === 0 || dm === 3) return stampAlphaMode(mat, hasAlpha, 'none')
		if (hasAlpha) stampAlphaMode(mat, hasAlpha, 'blend')
	}

	function applyTexAlpha(mat, tex, obj) {
		const hasAlpha = !!tex.userData?.hasAlpha
		// Nothing to say → leave the material untouched so TE-color translucency (set at build) survives.
		if (!hasAlpha && !obj?.alphaModeOverride && obj?.materialAlphaMode == null) return
		alphaPolicyStamp(mat, hasAlpha, obj)
	}

	// #17b: manual Alpha-mode override from the Edit floater. Persisted on the store object (so the
	// backfill sweep and later ObjectUpdates keep honoring it via applyTexAlpha), then re-stamped onto
	// the live material(s) immediately. Returning to auto/none re-applies TE-color translucency.
	function setObjectAlphaModeLive(localId, mode) {
		const obj = worldStore.objects.get(localId)
		if (obj) obj.alphaModeOverride = mode || null
		const mesh = meshMap.get(localId)
		if (!mesh || !mesh.material) return false
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
		for (const m of mats) {
			const hasAlpha = !!m.map?.userData?.hasAlpha
			if (mode) stampAlphaMode(m, hasAlpha, mode)
			else if (obj?.materialAlphaMode != null || hasAlpha) alphaPolicyStamp(m, hasAlpha, obj)
			else stampAlphaMode(m, hasAlpha, 'none')   // Auto on a plain texture → explicit opaque reset
			if ((!mode || mode === 'none') && obj?.defaultColor && obj.defaultColor[3] < 0.99 && !m.transparent) {
				m.transparent = true
				m.opacity = obj.defaultColor[3]
			}
			m.needsUpdate = true
		}
		return true
	}

	function reapplyDiffuse(mesh, obj) {
		const mat = mesh.material
		if (Array.isArray(mat)) return   // per-face multi-material mesh — backfill not applicable
		if (!mat || mat.map || obj._placeholder || obj.pcode === PCODE_AVATAR) return
		const texId = pickPrimTexture(obj)
		if (!texId) return
		const xform = uvXform(obj.defaultRepeats, obj.defaultOffset, obj.defaultRotation)
		getTexture(texId, xform, nearRefDist(obj)).then(tex => {
			if (!tex || !mesh.parent || mesh.material !== mat || mat.map) return
			mat.map = tex
			if (obj.defaultColor) mat.color.setRGB(obj.defaultColor[0], obj.defaultColor[1], obj.defaultColor[2])
			else mat.color.set(0xffffff)
			applyTexAlpha(mat, tex, obj)
			mat.needsUpdate = true
		})
	}

	// Periodic sweep: every still-white prim mesh re-requests its texture. getTexture short-circuits
	// to cache hits (instant apply) and the fetcher caps/dedupes/retry-budgets network fetches, so the
	// pass converges and tapers as the scene fills. Cheap relative to the removed O(n²) build scan.
	function backfillTextures() {
		for (const [localId, mesh] of meshMap) {
			// Near-aware (FEATURE-GAPS #13): skip cull-hidden meshes — fetching textures for objects beyond
			// the draw distance (which we aren't even rendering) floods the fetch queue and starves the
			// visible near set (live: queued=4472, the bare-near-objects symptom). They re-request via this
			// same sweep once the visibility cull shows them on approach.
			if (!mesh.visible) continue
			if (Array.isArray(mesh.material) || mesh.material?.map) continue
			const obj = worldStore.objects.get(localId)
			if (obj) reapplyDiffuse(mesh, obj)
		}
	}

	// Manual "Refresh textures" (ObjectContextMenu) for an object stuck bare. Clears the object's texture
	// failure/cache state (refreshTextures) so the next fetch re-pulls IDB→network, then forces a re-apply:
	// per-face meshes rebuild their material array (buildFaceMaterials re-resolves every face), single-
	// material meshes get map=null so reapplyDiffuse (which short-circuits when a map is already set) will
	// re-fetch and re-apply. Cache hits land instantly; true misses fill in as the fetch completes.
	function refreshObjectTextures(localId) {
		const obj = worldStore.objects.get(localId)
		if (!obj) return
		const set = new Set()
		if (isRealTex(obj.defaultTexture)) set.add(obj.defaultTexture)
		if (Array.isArray(obj.faceTextures)) for (const f of obj.faceTextures) if (isRealTex(f)) set.add(f)
		if (!set.size) return
		refreshTextures([...set])
		const mesh = meshMap.get(localId)
		if (mesh) {
			if (Array.isArray(mesh.material)) {
				buildFaceMaterials(mesh, obj, obj.meshId ? null : primFaceMap(obj.shape))
			} else if (mesh.material) {
				mesh.material.map = null
				mesh.material.needsUpdate = true
				reapplyDiffuse(mesh, obj)
			}
		}
		debugStore.push('info', `[Tex] manual refresh localId=${localId} (${set.size} textures)`)
	}

	// ── Lit-shading A/B toggle (QuickPrefs ▸ Graphics ▸ Lit Shading) ────────────────────────────
	// Swap a single prim material between unlit MeshBasic and lit MeshLambert, preserving its
	// already-applied texture/tint/alpha state. MeshStandard (legacy/PBR material path) is always
	// lit and left alone; fullbright prims stay MeshBasic (unlit IS fullbright).
	function relightMaterial(m, lit, obj) {
		if (!m || m.isMeshStandardMaterial) return m
		const wantLit = lit && !obj?.defaultFullbright
		if (wantLit === !!m.isMeshLambertMaterial) return m
		const next = wantLit
			? new THREE.MeshLambertMaterial({ color: m.color.clone() })
			: new THREE.MeshBasicMaterial({ color: m.color.clone() })
		next.map = m.map
		next.transparent = m.transparent
		next.opacity = m.opacity
		next.alphaTest = m.alphaTest
		next.depthWrite = m.depthWrite
		next.side = m.side
		m.dispose()   // frees the old shader program only — textures are shared/cached, untouched
		return next
	}

	// Re-materialize the whole scene when the toggle flips. Single materials swap in place (texture
	// carries over instantly). Per-face arrays rebuild via buildFaceMaterials, which re-resolves each
	// face texture through getTexture — cache hits apply instantly, misses fill in async. In-flight
	// texture fetches guarded by `mesh.material !== mat` drop on swap; the 3s backfill sweep
	// re-applies those, so the scene converges. Avatars/placeholders keep their current materials.
	function relightScene(on) {
		disposeInstancing()
		let swapped = 0
		for (const [localId, mesh] of meshMap) {
			const obj = worldStore.objects.get(localId)
			if (!obj || obj.pcode === PCODE_AVATAR || obj._placeholder) continue
			if (on && !mesh.geometry?.attributes?.normal) mesh.geometry?.computeVertexNormals?.()
			if (Array.isArray(mesh.material)) {
				const old = mesh.material
				buildFaceMaterials(mesh, obj, obj.meshId ? null : primFaceMap(obj.shape))
				old.forEach(m => m.dispose())
				mesh.userData.relit = true   // in-flight bake applySwap: not stale, accept geometry
				swapped++
				continue
			}
			const next = relightMaterial(mesh.material, on, obj)
			if (next !== mesh.material) {
				mesh.material = next
				mesh.userData.relit = true   // in-flight bake applySwap: not stale, accept geometry
				swapped++
			}
		}
		debugStore.push('info', `[Lit] shading ${on ? 'ON (lambert)' : 'OFF (unlit)'} — ${swapped} meshes re-materialized`)
	}

	// ── FPS meter + weak-GPU mitigation ─────────────────────────────────────────────────────────
	// Counts rendered frames over ~1s windows and publishes to uiStore.fps (TopRightTray readout).
	// Windows spanning a focus-gap (rAF parked while unfocused) are discarded, not computed — they
	// would read as a false FPS collapse. Mitigation: lit shading is the only render feature with a
	// real per-frame cost knob, so if FPS stays under LIT_MIN_FPS for LIT_LOW_MS while lit shading is
	// on, drop back to unlit ONCE per session (the one-shot stops a re-enable→re-disable fight if the
	// user insists) and tell the user via notification toast.
	// WHY load-gate (and not just low thresholds): cold/warm region loads legitimately pin FPS to
	// ~5 for minutes even on a top-tier rig — thousands of geometry builds + asset fetches own the
	// main thread. Judging lit-shading cost during that window auto-disabled it on every big load
	// (observed as "dark/striped trees on soft load, fixed by hard reload"). The FPS verdict only
	// counts once the build/fetch pipeline has been quiet for LIT_SETTLE_MS — so the thresholds can
	// stay at their designed weak-GPU values instead of being detuned to dodge transients.
	const LIT_MIN_FPS   = 20
	const LIT_LOW_MS    = 10000
	const LIT_SETTLE_MS = 5000     // pipeline must be quiet this long before low-FPS accumulates
	let _fpsFrames = 0, _fpsWindowStart = 0, _lowFpsSince = 0, _litAutoDropped = false
	let _loadBusyUntil = 0, _lastLtTotalMs = 0
	// Render-exception quarantine state (see the try/catch around renderer.render).
	let _lastDrawMesh = null, _renderFailN = 0
	function _noteDraw() { _lastDrawMesh = this }
	function updateFps(time) {
		_fpsFrames++
		if (!_fpsWindowStart) { _fpsWindowStart = time; return }
		const elapsed = time - _fpsWindowStart
		if (elapsed < 1000) return
		const gapWindow = elapsed > 2500   // focus gap inside this window → sample invalid
		const fps = gapWindow ? null : Math.round((_fpsFrames * 1000) / elapsed)
		_fpsFrames = 0
		_fpsWindowStart = time
		// Bandwidth meter: WS bytes accumulated this window → kbps. Always take (resets the counter
		// so a focus gap doesn't dump its backlog into the next valid window as a false spike).
		const kbps = Math.round((takeWsBytes() * 8) / elapsed)   // bytes·8 bits / elapsed ms = kbps
		if (fps == null) { _lowFpsSince = 0; return }
		uiStore.setFps(fps)
		uiStore.setNetKbps(kbps)
		if (!uiStore.litShading || _litAutoDropped) { _lowFpsSince = 0; return }
		// Load-transient gate (cheap counter reads, 1Hz): any meaningful build/fetch activity
		// resets the settle clock; low-FPS windows inside the busy+settle span don't count.
		const t = getTextureStats(), m = getMeshStats()
		const loading = pendingMeshIds.size > 50 || t.queued > 0 || t.inflight > 0 || m.queued > 0 || _geomPending > 25
		if (loading) _loadBusyUntil = time + LIT_SETTLE_MS
		// Main-thread-bound discriminator: lit shading only adds GPU/fragment cost, so disabling it
		// can only help when low FPS is RENDER-bound. If long tasks ate >30% of this window (texture
		// createImageBitmap/upload tail, geometry deserialize, GC — none visible in the fetch
		// queues), the frame rate is main-thread-bound and unlit would not recover it: don't count.
		const ltDelta = _ltTotalMs - _lastLtTotalMs
		_lastLtTotalMs = _ltTotalMs
		const mainThreadBound = ltDelta / elapsed > 0.3
		if (time < _loadBusyUntil || mainThreadBound) { _lowFpsSince = 0; return }
		if (fps >= LIT_MIN_FPS) { _lowFpsSince = 0; return }
		if (!_lowFpsSince) { _lowFpsSince = time; return }
		if (time - _lowFpsSince >= LIT_LOW_MS) {
			_litAutoDropped = true
			uiStore.litShading = false   // persists; user can re-enable in Preferences ▸ Graphics
			debugStore.push('warn', `[Lit] auto-disabled: FPS < ${LIT_MIN_FPS} for ${LIT_LOW_MS / 1000}s`)
			notificationStore.notify({
				title: 'Lit shading disabled',
				body: `Frame rate stayed under ${LIT_MIN_FPS} FPS, so lit shading was turned off to keep things smooth. Re-enable it any time in Preferences ▸ Graphics.`,
				icon: '🖥️',
				toast: true,
			})
		}
	}

	function animate(time) {
		animId = requestAnimationFrame(animate)
		// WHY (perf): when the page is unfocused (mouse on taskbar, another window, or devtools)
		// Chrome deprioritizes this window's GPU, so each renderer.render of the heavy scene balloons
		// to 50-106ms and trips '[Violation] requestAnimationFrame handler took Nms' ~10×/sec while
		// wasting GPU/battery. document.hasFocus() is false in exactly those states (verified). Skip
		// the frame's work while unfocused — the rAF loop stays alive so we resume instantly on focus.
		// Advance lastTime so dt doesn't spike on the first frame back.
		if (!document.hasFocus()) { lastTime = time; return }
		const _frT0 = performance.now()
		updateFps(time)
		// Starvation-proof drain: ~125ms long tasks (see [Main] telemetry) starve the 30ms interval to
		// ~0.5Hz, so also drain here — rAF keeps firing even when intervals don't. ONLY when actually
		// starved (>100ms since the last interval tick): unconditionally draining added up to 8ms to
		// EVERY frame on top of the render cost, tripping rAF-violation floods on dense regions.
		if (_frT0 - _lastDrainTickAt > 100) drainMeshQueue()
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
			camReturning = true // WASD after camming far → glide home, don't snap
			endFocusGlide()
		}
		if (avatarSLPos && !isAltOrbit) {
			const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
			const target = new THREE.Vector3(
				t.x + Math.sin(yaw) * followDist,
				t.y + FOLLOW_HEIGHT,
				t.z + Math.cos(yaw) * followDist,
			)
			// WHY: lerp(NaN, valid, f) = NaN forever; hard-snap here so a prior bad orbit
			// (NaN camera pos) self-heals the first time the follow camera runs.
			if (!isFinite(camera.position.x)) {
				camera.up.set(0, 1, 0)
				camera.position.copy(target)
				camLookInit = false
			}
			const distToTarget = camera.position.distanceTo(target)
			// WHY: Hard-snap ONLY when explicitly flagged (teleport/spawn). Distance
			// heuristic removed — Esc-from-orbit can put camera >50m from follow target
			// (especially zoomed-out alt-orbit), and snapping then jumps the view instead
			// of gliding back smoothly.
			// Variable lerp: movement key held → faster glide (up to 0.35); idle or Esc exit →
			// smooth 0.15 glide (~0.25s).
			const snap = cameraSnapRequested
			cameraSnapRequested = false
			// WHY: A snap or getting close ends an orbit-exit glide-back; hand control to the
			// normal follow rate so a walking avatar stays glued without a rate seam.
			if (camReturning && (snap || distToTarget < 2)) camReturning = false
			// WHY: frame-rate-independent lerp — 1 - exp(-rate*dt) gives the same smoothing
			// at 30 or 144 fps. The old fixed 0.15/frame factor under-smoothed at low fps
			// (visible stutter) and over-smoothed at high fps. Movement bumps the rate up a
			// bit so the camera keeps pace with a walking avatar — BUT during an orbit-exit
			// glide-back that boost is suppressed (a 50m gap × 1.5 → instant snap) in favour
			// of the gentle CAM_RETURN_RATE so the camera eases home over ~0.8s.
			// WHY isAirborne: when the avatar is mid-jump, use CAM_AIR_RATE for BOTH position
			// and lookAt so they stay in lockstep. The distToTarget boost is designed for
			// horizontal orbit-exit; applying it vertically desyncs position from lookAt and
			// produces the post-landing camera bounce.
			const isAirborne = vertVel !== 0
			const posRate = isAirborne
				? CAM_AIR_RATE
				: camReturning
					? CAM_RETURN_RATE
					: (isMoving ? CAM_POS_RATE + distToTarget * 1.5 : CAM_POS_RATE)
			const posF = snap ? 1.0 : 1 - Math.exp(-posRate * dt)
			camera.position.lerp(target, posF)
			// WHY: lookAt at LOOKAT_Y above avatar feet. Camera at FOLLOW_HEIGHT looking
			// down at this lower point pushes avatar into lower portion of frame.
			// Smooth the focus point separately so jitter in avatarSLPos doesn't snap the
			// view angle every frame (the main cause of the scene bobbing up/down).
			const lookTarget = _v3a.set(t.x, t.y + LOOKAT_Y, t.z)
			if (snap || !camLookInit) { camLook.copy(lookTarget); camLookInit = true }
			else camLook.lerp(lookTarget, 1 - Math.exp(-(isAirborne ? CAM_AIR_RATE : camReturning ? CAM_RETURN_RATE : CAM_LOOK_RATE) * dt))
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
		// WHY: run whenever a control flag is held OR residual skid velocity remains, so the
		// glide-to-stop keeps integrating after the key is released. Skipped fully at rest to
		// avoid 60fps store writes while idle.
		if (avatarSLPos && ownAvatarLocalId && (cf || drVelX !== 0 || drVelY !== 0)) {
			const runSticky = uiStore.alwaysRun
			// WHY: while flying, horizontal motion is at fly speed, not walk/run. The old code
			// dead-reckoned forward/strafe fly at SL_WALK_SPEED (3.2) while the sim flies far
			// faster, so the gap blew past the snap threshold → mid-flight yank. Match the sim.
			const spd  = isFlying ? SL_FLY_SPEED : (((cf & CTRL_FAST_AT)   || runSticky) ? SL_RUN_SPEED : SL_WALK_SPEED)
			const lspd = isFlying ? SL_FLY_SPEED : (((cf & CTRL_FAST_LEFT) || runSticky) ? SL_RUN_SPEED : SL_WALK_SPEED)
			// SL space vectors (Z-up): forward = (-sin(yaw), cos(yaw)), right = (cos(yaw), sin(yaw))
			const fX = -Math.sin(yaw), fY = Math.cos(yaw)
			const rX =  Math.cos(yaw), rY = Math.sin(yaw)
			// Desired horizontal velocity from the control flags currently held (0 = no move keys).
			let desX = 0, desY = 0
			if (cf & CTRL_AT_POS)   { desX += fX * spd;  desY += fY * spd }
			if (cf & CTRL_AT_NEG)   { desX -= fX * spd;  desY -= fY * spd }
			if (cf & CTRL_LEFT_POS) { desX -= rX * lspd; desY -= rY * lspd }
			if (cf & CTRL_LEFT_NEG) { desX += rX * lspd; desY += rY * lspd }
			const wantMove = desX !== 0 || desY !== 0
			// WHY: ramp velocity toward the desired vector — fast on press, slow decay on release
			// (skid). Frame-rate-independent (1 - exp(-rate*dt)). This is what removes the rubber-band:
			// the avatar coasts to a halt on roughly the same curve the sim uses, so the gap the
			// TerseUpdate has to correct stays small and the correction no longer snaps.
			const k = 1 - Math.exp(-(wantMove ? DR_ACCEL_RATE : DR_DECEL_RATE) * dt)
			drVelX += (desX - drVelX) * k
			drVelY += (desY - drVelY) * k
			const vMag = Math.hypot(drVelX, drVelY)
			if (vMag > 0.02) {
				// WHY: raycast before stepping. If blocked, kill velocity (sim already has us stuck)
				// so DR doesn't march coords through walls and diverge from where peers see us.
				if (checkCollision(drVelX / vMag, drVelY / vMag)) {
					drVelX = 0; drVelY = 0
				} else {
					avatarSLPos[0] += drVelX * dt
					avatarSLPos[1] += drVelY * dt
				}
			} else {
				drVelX = 0; drVelY = 0  // snap to rest below threshold so the idle gate trips
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
			// Move own avatar mesh to predicted position directly (no GSAP tween — camera lerp
			// already provides visual smoothing; a 60fps tween would just add stutter).
			const ownMesh = meshMap.get(ownAvatarLocalId)
			if (ownMesh) {
				const t = slToThree(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
				ownMesh.position.set(t.x, t.y, t.z)
			}
			// Update store so LocationBar stays current
			worldStore.setAvatarPos(avatarSLPos[0], avatarSLPos[1], avatarSLPos[2])
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
				if (avatarSLPos[2] < groundZ) {
					avatarSLPos[2] = groundZ
					if (vertVel < 0) landingGraceTimer = LANDING_GRACE  // just touched down
					vertVel = 0
				}
				landingGraceTimer = Math.max(0, landingGraceTimer - dt)
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

		// NOTE: mesh building moved off the rAF path to a focus-independent timer (see onMounted).
		// The rAF loop returns early when unfocused (line above), which previously froze ALL mesh
		// building whenever the window lost focus — so heavy regions only ever built ~30-50%.

		// WHY: CSS2DRenderer owns element.style.display — do not touch it.
		// Fade by camera distance: zoom in → labels appear, zoom out → labels hide.
		// Full at <15m, fade 15–20m, hidden beyond 20m.
		if (hoverTextMeshes.size) {
			const camPos = camera.position
			for (const m of hoverTextMeshes) {
				const div = m.userData.hoverDiv
				if (!div) continue
				m.getWorldPosition(_htVec3)
				const dist = camPos.distanceTo(_htVec3)
				if (dist > 20) {
					div.style.visibility = 'hidden'
				} else {
					div.style.visibility = ''
					div.style.opacity = dist < 15 ? '1' : ((20 - dist) / 5).toFixed(3)
				}
			}
		}

		// Spread texture build+upload across frames (FEATURE-GAPS #11): drain a budgeted slice of
		// the build queue here so freshly-uploaded textures are GPU-resident before render() and
		// the per-frame upload count is bounded (no burst spike).
		timed('texbuild', pumpTextureBuilds)   // #11 attribution: texture decode (createImageBitmap) + GPU upload

		// WHY try/catch + quarantine: ONE mesh with a poisoned material (e.g. a uniforms/program
		// mismatch — "Cannot set properties of undefined (setting 'value')" in three's
		// refreshUniformsCommon) makes renderer.render THROW EVERY FRAME. Measured live 2026-06-12:
		// a single multi-face mesh wedged two full sessions — partial black render, 4,625 exceptions,
		// each ~250ms attempt starving the drain timers, scene stuck at 13%. The thrower is the last
		// mesh whose onBeforeRender fired (_noteDraw). First strike: swap in a fresh placeholder
		// material (a new program usually clears it). Second strike: hide the mesh. Either way the
		// NEXT frame renders past it and the session self-heals.
		try {
			timed('render', () => { renderer.render(scene, camera); labelRenderer.render(scene, camera) })
		} catch (err) {
			const bad = _lastDrawMesh
			_renderFailN++
			if (bad?.isMesh) {
				const strikes = (bad.userData._rescueN = (bad.userData._rescueN ?? 0) + 1)
				// Forensics: which material state poisoned the program (uniforms/feature mismatch)?
				const _mats = Array.isArray(bad.material) ? bad.material : [bad.material]
				const _diag = _mats.map(m => m ? `${m.type.replace('Mesh', '').replace('Material', '')}v${m.version}${m.map ? '+map' : ''}${m.normalMap ? '+nrm' : ''}${m.alphaTest ? '+at' : ''}${m.transparent ? '+tr' : ''}` : 'null').join(',')
				if (strikes === 1) {
					const old = bad.material
					bad.material = new THREE.MeshBasicMaterial({ color: PLACEHOLDER_COLOR })
					;(Array.isArray(old) ? old : [old]).forEach(m => m?.dispose?.())
				} else {
					bad.visible = false
				}
				debugStore.push('warn', `[3D] render exception — quarantined localId=${bad.userData?.localId} (strike ${strikes}) mats=[${_diag}]: ${err?.message}`)
			} else if (_renderFailN <= 3 || _renderFailN % 300 === 0) {
				debugStore.push('warn', `[3D] render exception #${_renderFailN} (no culprit mesh): ${err?.message}`)
			}
		}
		// Frame-work gauge: total main-thread ms this frame consumed (camera + scene walk + render).
		// At 31k objects frames can run 100s of ms — a continuous rAF loop then starves every
		// setInterval (drain ticks observed at ~0.5Hz in a visible tab). Reported via [Main] each 5s.
		const _frDt = performance.now() - _frT0
		_frN++; _frMs += _frDt; if (_frDt > _frMaxMs) _frMaxMs = _frDt
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

		installConsoleForwarder(wsEmit)   // dev: forward NaN/radius console warnings to server-log
		initScene()
		// Long-task observer: counts main-thread blocks >50ms (render frames, WS handler floods, GC)
		// so the 5s [Main] line shows how starved timers actually are. Chrome-only entryType; no-op
		// elsewhere.
		try {
			_longTaskObs = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) { _ltN++; _ltMs += e.duration; _ltTotalMs += e.duration; if (e.duration > _ltMaxMs) _ltMaxMs = e.duration }
			})
			_longTaskObs.observe({ entryTypes: ['longtask'] })
		} catch { _longTaskObs = null }
		requestAnimationFrame(t => { lastTime = t; animate(t) })
		// WHY: Mesh building runs here (not in the rAF loop) so it keeps progressing while the window
		// is unfocused — building is CPU/geometry work, not rendering, so it has no reason to be
		// focus-gated. 12ms budget × ~33Hz ≈ 400ms/s of build time vs the old focus-gated rAF path.
		// Reparent sweep is cheaper; run it every 4th tick.
		let _drainTick = 0
		initGeomCacheCap()   // size the qs-geom IDB cap from the storage estimate before bakes start persisting
		// Apply the persisted geom-cache RAM budget and keep it live as the user adjusts the Prefs slider.
		setGeomMemBudget(uiStore.geomCacheRamMb * 1024 * 1024)
		stopGeomCacheRamWatch = watch(() => uiStore.geomCacheRamMb, (mbVal) => setGeomMemBudget(mbVal * 1024 * 1024))
		// Apply the persisted VRAM/resident budget override (0 = auto heap-scaled default) + keep it live.
		const applyVram = (mb) => setAppBudgetOverride(mb > 0 ? mb * 1024 * 1024 : null)
		applyVram(uiStore.vramBudgetMb)
		stopVramBudgetWatch = watch(() => uiStore.vramBudgetMb, applyVram)
		_meshDrainTimer = setInterval(() => {
			_lastDrainTickAt = performance.now()   // animate()'s starvation detector reads this
			timed('ingest', pumpIngest)   // paced upsert/persist/queue (TP-flood backpressure, #11)
			timed('drain', drainMeshQueue)
			timed('pumpTex', pumpTextures)   // resume governor-paused texture fetches once heap pressure clears
			// Drive the texture decode/upload pump here too WHEN UNFOCUSED: animate()'s !hasFocus
			// early-return (and rAF being paused in a hidden tab) otherwise stalls pumpTextureBuilds, so
			// decode/upload halts and buildQueue piles up until refocus (the "stuck until I click back"
			// symptom — visible-but-unfocused, e.g. DevTools focused, hits it too). This interval runs
			// regardless of focus; gate on !hasFocus so it's mutually exclusive with animate()'s call
			// (no double-pump). Hidden tabs clamp this interval to ~1Hz so fill is slow but never stalls.
			if (typeof document !== 'undefined' && !document.hasFocus()) timed('texbuild', pumpTextureBuilds)
			if ((_drainTick++ & 3) === 0) timed('reparent', reparentOrphans)
		}, 30)
		_cullTimer = setInterval(() => timed('cull', cullTick), 1000)
		_visTimer = setInterval(() => timed('vis', visibilityTick), 200)
		// ── DEV-only draw-call census (FEATURE-GAPS #6 instrumentation; DISPOSABLE, uncommitted) ──
		// Run `qsCensus()` in the console on a heavy region AFTER it settles (objs/buildQ stable) to
		// size the instancing vs merge-by-texture opportunity. Reads worldStore.objects (data model)
		// + meshMap (what's actually rendered). Remove this block once #6's approach is chosen.
		if (import.meta.env.DEV) {
			globalThis.qsCensus = () => {
				const objs = worldStore.objects
				const all = [...objs.values()]
				const inScene = (o) => meshMap.has(o.localId)
				const rendered = all.filter(inScene)
				const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n)
				const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
				const coverage = (m, min) => { let groups = 0, covered = 0; for (const [, c] of m) if (c >= min) { groups++; covered += c } return { groups, covered } }
				const top = (m, n) => sorted(m).slice(0, n).map(([k, c]) => `    ${c}× ${String(k).slice(0, 46)}`).join('\n')

				// actual draw calls — a per-face material array issues one call per group
				let drawCalls = 0, multiMat = 0
				for (const id of meshMap.keys()) { const mat = meshMap.get(id)?.material; const n = Array.isArray(mat) ? mat.length : 1; drawCalls += n; if (n > 1) multiMat++ }
				// Pooled objects LEFT meshMap — the loop above misses their InstancedMesh draw calls.
				// Count one call per pool, and read Three's real GL counter for ground truth.
				const poolMeshes = _instancePool ? _instancePool.meshes().length : 0
				const poolObjs = _instancePool ? _instancePool.count() : 0
				const sceneDrawCalls = drawCalls + poolMeshes
				const glCalls = renderer?.info?.render?.calls ?? -1

				const byType = new Map(), keyMul = new Map(), keyMulNS = new Map(), texMul = new Map(), linkSize = new Map()
				let perFaceBlockers = 0
				for (const o of rendered) {
					bump(byType, o.meshId ? 'mesh' : o.sculptId ? 'sculpt' : 'prim')
					const bakeScale = (o.meshId || o.sculptId) ? [1, 1, 1] : (o.scale || [1, 1, 1])
					bump(keyMul, o.meshId ? meshGeomKey(o.meshId) : o.sculptId ? sculptGeomKey(o.sculptId, o.sculptType ?? 1) : primGeomKey(o.shape, bakeScale))
					bump(keyMulNS, o.meshId ? meshGeomKey(o.meshId) : o.sculptId ? sculptGeomKey(o.sculptId, o.sculptType ?? 1) : primGeomKey(o.shape, [1, 1, 1]))
					bump(texMul, pickPrimTexture(o) || (isRealTex(o.defaultTexture) ? o.defaultTexture : 'none'))
					bump(linkSize, (o.parentId && o.parentId !== 0) ? o.parentId : o.localId)
					if (hasMultiFaceMesh(o) || hasMultiFacePrim(o)) perFaceBlockers++
				}
				const i2 = coverage(keyMul, 2), i4 = coverage(keyMul, 4), ns2 = coverage(keyMulNS, 2), ns4 = coverage(keyMulNS, 4)
				const t2 = coverage(texMul, 2), l2 = coverage(linkSize, 2)
				const linkSizes = [...linkSize.values()].sort((a, b) => b - a)

				// ── HEAP ATTRIBUTION (DEV, FEATURE-GAPS #13/#11): hunt the ~3GB retained heap that wedges a
				// full cold 48k load at 97% (accounted ~975MB, worldStore ~23MB → ~3GB unexplained). The key
				// tell is a GPU-resource disposal leak: glGeometries/glTextures >> what's actually rendered.
				const rinfo = renderer?.info
				const tS = getTextureStats?.() || {}, mS = getMeshStats?.() || {}
				const pm = (typeof performance !== 'undefined' && performance.memory) || null
				const wbs = getGeomWriteBufStats()
				const heapAttr = {
					glGeometries: rinfo?.memory?.geometries ?? -1,   // ⚠ >> rendered ⇒ BufferGeometry disposal leak
					glTextures:   rinfo?.memory?.textures   ?? -1,   // ⚠ >> distinctTextures ⇒ texture disposal leak
					glPrograms:   rinfo?.programs?.length    ?? -1,
					ingestQ: _ingestQueue.length, orphanRoots: orphansByParent.size,
					geomPending: _geomPending, buildQ: pendingMeshIds.size, evicted: evicted.size, meshMap: meshMap.size,
					texQ: tS.queued, texInflight: tS.inflight, texCache: tS.cached,
					meshQ: mS.queued, meshInflight: mS.inflight, meshCache: mS.cached,
					geomMemMB: Math.round(getGeomMemBytes() / 1048576), wBufMB: Math.round(wbs.bytes / 1048576), wBufDrop: wbs.dropped,
					heapUsedMB: pm ? Math.round(pm.usedJSHeapSize / 1048576) : -1, heapLimitMB: pm ? Math.round(pm.jsHeapSizeLimit / 1048576) : -1,
				}

				// ── POOL-KEY FRAGMENTATION (why instancing dedups poorly) — run with the flag OFF so all
				// objects are individual meshes carrying their real materials. Shows what splits pools:
				// geom-only (best case) → +texId → +material flags → +UV (the current pool key). If the
				// full count >> the +flags count, per-object UV transform is the fragmenter and moving UV
				// to a per-instance shader attribute will recover the dedup. Mirrors describeForPool's key.
				const fGeom = new Set(), fTex = new Set(), fFlags = new Set(), fFull = new Set()
				for (const [id, mesh] of meshMap) {
					const o = objs.get(id)
					if (!o || o.pcode === PCODE_AVATAR || o._placeholder) continue
					const gk = geomKeyFor(o)
					const multi = hasMultiFaceMesh(o) || hasMultiFacePrim(o)
					const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
					mats.forEach((m, idx) => {
						if (!m) return
						const faceTex = multi ? ((o.faceTextures && o.faceTextures[idx]) || o.defaultTexture) : pickPrimTexture(o)
						const texId = isRealTex(faceTex) ? faceTex : (isRealTex(o.defaultTexture) ? o.defaultTexture : 'none')
						const map = m.map
						const uvk = map ? `${map.repeat.x},${map.repeat.y},${map.offset.x},${map.offset.y},${map.rotation}` : ''
						const flags = `${!!m.transparent}|${m.blending !== THREE.NormalBlending}|${m.alphaTest || 0}|${m.side}|${!!(m.isMeshLambertMaterial || m.isMeshStandardMaterial)}|${!!m.isMeshStandardMaterial}|${!!o.defaultFullbright}`
						const base = `${gk}::${idx}`
						fGeom.add(base)
						fTex.add(`${base}::${texId}`)
						fFlags.add(`${base}::${texId}::${flags}`)
						fFull.add(`${base}::${texId}::${flags}::${uvk}`)
					})
				}
				const text = [
					`── QS DRAW-CALL CENSUS ──`,
					`objects(worldStore): ${all.length}   rendered(meshMap): ${rendered.length}   effNear: ${_effNear}m`,
					`DRAW CALLS — meshMap individual: ${drawCalls} (multi-material: ${multiMat})`,
					`POOLS: ${poolMeshes} instanced draw calls for ${poolObjs} pooled objs`,
					`SCENE TOTAL ≈ ${sceneDrawCalls} (individual ${drawCalls} + pools ${poolMeshes})   |   renderer.info GL calls (last frame, incl terrain/water/etc): ${glCalls}`,
					`rendered type split: ${[...byType].map(([k, c]) => `${k}=${c}`).join('  ')}`,
					``,
					`── HEAP ATTRIBUTION (hunt the ~3GB; heap ${heapAttr.heapUsedMB}/${heapAttr.heapLimitMB}MB) ──`,
					`GL geometries: ${heapAttr.glGeometries}  (rendered ${rendered.length})  ⚠leak if ≫    GL textures: ${heapAttr.glTextures}  (distinct ${texMul.size})    programs: ${heapAttr.glPrograms}`,
					`queues: ingest=${heapAttr.ingestQ}  buildQ=${heapAttr.buildQ}  geomPending=${heapAttr.geomPending}  evicted=${heapAttr.evicted}  orphanRoots=${heapAttr.orphanRoots}`,
					`tex: q=${heapAttr.texQ} inflight=${heapAttr.texInflight} cache=${heapAttr.texCache}    mesh: q=${heapAttr.meshQ} inflight=${heapAttr.meshInflight} cache=${heapAttr.meshCache}`,
					`pools: geomMem=${heapAttr.geomMemMB}MB  wBuf=${heapAttr.wBufMB}MB(drop ${heapAttr.wBufDrop})`,
					`per-face blockers (material array → not directly batchable): ${perFaceBlockers}`,
					``,
					`INSTANCING — shape+scale (current keying):`,
					`  distinct keys: ${keyMul.size}   ≥2: ${i2.groups} keys / ${i2.covered} objs   ≥4: ${i4.groups} keys / ${i4.covered} objs`,
					top(keyMul, 15),
					``,
					`INSTANCING — shape only (if scale moved to instance matrix):`,
					`  distinct keys: ${keyMulNS.size}   ≥2: ${ns2.groups} keys / ${ns2.covered} objs   ≥4: ${ns4.groups} keys / ${ns4.covered} objs`,
					top(keyMulNS, 15),
					``,
					`MERGE-BY-TEXTURE:`,
					`  distinct textures: ${texMul.size}   ≥2: ${t2.groups} textures / ${t2.covered} objs`,
					top(texMul, 15),
					``,
					`LINKSETS:`,
					`  roots: ${linkSize.size}   ≥2 prims: ${l2.groups} linksets / ${l2.covered} objs`,
					`  largest: ${linkSizes.slice(0, 15).join(', ')}`,
					``,
					`POOL FRAGMENTATION (distinct pool keys — run with flag OFF):`,
					`  geom-only: ${fGeom.size}  →  +texId: ${fTex.size}  →  +flags: ${fFlags.size}  →  +UV (current key): ${fFull.size}`,
					`  UV split: ${fFlags.size} → ${fFull.size}  (per-instance UV collapses this back to +flags)`,
				].join('\n')
				console.log(text)
				// Relay to the Bun server log ([ClientLog]) so it's readable without the browser console.
				try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: text.slice(0, 4000), stack: '' }) } catch { /* not connected */ }
				return { drawCalls, multiMat, poolMeshes, poolObjs, sceneDrawCalls, glCalls, objects: all.length, rendered: rendered.length, byType: Object.fromEntries(byType), distinctGeomKeys: keyMul.size, distinctGeomKeysNoScale: keyMulNS.size, distinctTextures: texMul.size, i2, i4, ns2, ns4, t2, l2, heapAttr, _text: text }
			}
			dev.log('[Census] qsCensus() ready — run it in the console on a heavy region once it settles')
		}
		// Texture backfill: re-apply textures to still-white meshes + retry timed-out fetches so the
		// scene keeps filling and the IDB cache completes (persists across reloads). 3s cadence.
		_texBackfillTimer = setInterval(() => timed('backfill', backfillTextures), 3000)
		// Asset-loading telemetry: log tex+mesh fetch progress every 3s so we can watch the queues
		// drain steadily (vs flooding) and spot stuck/timed-out assets. Quiet once fully idle.
		let _relayTick = 0
		_assetStatsTimer = setInterval(() => {
			// Server-log relay cadence: every 3rd tick (~9s). The 3s full rate stays in the client
			// debug panel; relaying every tick made [Mem]/[Main] the server log's biggest flood.
			const _relay = (_relayTick++ % 3) === 0
			const t = getTextureStats(), m = getMeshStats()
			// Memory telemetry: always report heap pressure to the server log (C.CLIENT_LOG → [ClientLog])
			// so it can be watched live while tuning the governor. Quiet on non-Chrome (memStats null).
			// Resident-byte breakdown: where OUR bytes actually live. geomMB sums each meshMap entry's
			// own BufferGeometry attributes (children are their own entries — no double count). This
			// scan feeds the governor's self-accounted budget, so it runs on every browser (the
			// process-heap segment of the log line stays Chrome-only).
			let geomB = 0
			for (const mm of meshMap.values()) {
				const g = mm.geometry
				if (!g) continue
				for (const a of Object.values(g.attributes || {})) geomB += a.array?.byteLength || 0
				geomB += g.index?.array?.byteLength || 0
			}
			if (_instancePool) geomB += _instancePool.bytes()
			_lastGeomB = geomB
			const texB = getTextureBytes(), meshB = getMeshBytes(), geomCacheB = getGeomMemBytes()
			// WHY no geomCacheB: CPU-RAM-only tier, excluded from VRAM budget (see cull-tick comment).
			setAppBytes(texB + meshB + geomB)
			{
				const mg = memStats()
				const pressure = memUnderPressure()
				// Distinguish the NEW soft-heap brake (0.85–0.95 band) from the existing app-budget/0.95
				// throttles so a heavy cold load can be live-verified as actually firing it (#11 churn).
				const throttleSeg = pressure ? (heapThrottled() ? ' ⚠THROTTLE(soft-heap)' : ' ⚠THROTTLING') : ''
				const mb = (b) => (b / 1048576).toFixed(0)
				const heapSeg = mg ? `heap ${mg.usedMB}/${mg.limitMB}MB (${(mg.ratio * 100).toFixed(0)}%)` : 'heap n/a'
				const wb = getGeomWriteBufStats()
				const line = `[Mem] app ${mb(texB + meshB + geomB)}/${mb(appBudgetBytes())}MB (${(appRatio() * 100).toFixed(0)}%) ${heapSeg}` +
					`${throttleSeg} | texMB=${mb(texB)} meshCacheMB=${mb(meshB)} geomMB=${mb(geomB)} geomCacheMB=${mb(geomCacheB)}/${mb(getGeomMemBudget())} wBuf=${mb(wb.bytes)}MB${wb.dropped ? ` drop=${wb.dropped}` : ''}` +
					` | tex q=${t.queued} cache=${t.cached} | mesh q=${m.queued} cache=${m.cached} | objs=${meshMap.size + (_instancePool?.count() ?? 0)} inst=${_instancePool?.count() ?? 0} evicted=${evicted.size} buildQ=${pendingMeshIds.size} dd=${_effNear}m`
				debugStore.push(pressure ? 'warn' : 'info', line)
				if (_relay || pressure) {
					try { wsEmit(C.CLIENT_LOG, { level: pressure ? 'warn' : 'info', msg: line, stack: '' }) } catch { /* ignore */ }
				}
			}
			// upsertMesh throughput (the cold-load bottleneck): builds + avg/max per-call ms since last report
			if (_drainBuilt) {
				const dline = `[Drain] built=${_drainBuilt} (${(_drainBuilt / 5).toFixed(0)}/s) avg=${(_drainMs / _drainBuilt).toFixed(1)}ms max=${_drainMaxMs.toFixed(1)}ms queued=${pendingMeshIds.size} hidden=${typeof document !== 'undefined' && document.hidden ? 1 : 0}` +
					` | ticks=${_dtTicks} empty=${_dtEmpty} gov=${_dtGov} brkCap=${_dtBrkCap} brkBudget=${_dtBrkBudget}` +
					(() => { const _ts = getTextureStats(), _wb = getTextureWriteBufStats(); return ` texBuildQ=${_ts.buildQueued} texUpQ=${_ts.uploadQueued} texDec=${_ts.decodeOutstanding} texWB=${Math.round(_wb.bytes / 1048576)}MB texWBdrop=${_wb.dropped}` })()
				debugStore.push('info', dline)
				try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: dline, stack: '' }) } catch { /* ignore */ }
				_drainBuilt = 0; _drainMs = 0; _drainMaxMs = 0
				_dtTicks = 0; _dtEmpty = 0; _dtGov = 0; _dtBrkCap = 0; _dtBrkBudget = 0
			}
			// Main-thread health: frame work (rAF) + long tasks. This is what starves the drain timer.
			if (_frN || _ltN) {
				const ws = takeWsStats()
				// #11 attribution: per-phase main-thread ms this window (which phase eats the frame).
				const phases = Object.entries(_phaseMs).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1])
					.map(([k, v]) => `${k}=${Math.round(v)}`).join(' ')
				const mline = `[Main] frames=${_frN} avg=${(_frN ? _frMs / _frN : 0).toFixed(0)}ms max=${_frMaxMs.toFixed(0)}ms` +
					` | longtasks=${_ltN} total=${_ltMs.toFixed(0)}ms max=${_ltMaxMs.toFixed(0)}ms` +
					` | phases: ${phases || '-'}` +
					` | ws parse=${ws.parseMs.toFixed(0)}ms top: ${ws.top || '-'}`
				debugStore.push('info', mline)
				if (_relay) {
					try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: mline, stack: '' }) } catch { /* ignore */ }
				}
				_frN = 0; _frMs = 0; _frMaxMs = 0; _ltN = 0; _ltMs = 0; _ltMaxMs = 0
				for (const k in _phaseMs) delete _phaseMs[k]
			}
			// Where bake time actually goes: worker-side geometry ms vs main-thread applySwap ms,
			// plus how much baking the geometry cache AVOIDED (hit=mem+idb vs miss=real bakes).
			const bs = meshBaker.takeStats()
			if (bs.jobs || _applyN || _geomHitMem || _geomHitIdb || _geomMiss) {
				const bline = `[Bake] worker jobs=${bs.jobs} batches=${bs.batches} bakeMs=${bs.bakeMs.toFixed(0)} (avg ${(bs.jobs ? bs.bakeMs / bs.jobs : 0).toFixed(1)}ms/job) | apply n=${_applyN} avg=${(_applyN ? _applyMs / _applyN : 0).toFixed(1)}ms max=${_applyMaxMs.toFixed(1)}ms | outstanding=${meshBaker.outstanding()}` +
					` | geomCache hit=${_geomHitMem + _geomHitIdb} (mem=${_geomHitMem} idb=${_geomHitIdb}) miss=${_geomMiss} pend=${_geomPending} wdog=${_geomLookupWatchdogN}`
				debugStore.push('info', bline)
				try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: bline, stack: '' }) } catch { /* ignore */ }
				_applyN = 0; _applyMs = 0; _applyMaxMs = 0
				_geomHitMem = 0; _geomHitIdb = 0; _geomMiss = 0
			}
			const busy = t.inflight || t.queued || m.inflight || m.queued
			if (!busy && t.requested === _lastTexReq && m.requested === _lastMeshReq) return  // idle, nothing new
			_lastTexReq = t.requested; _lastMeshReq = m.requested
			debugStore.push('info',
				`[Assets] tex ✓${t.done} ✗${t.failed} ⏱${t.timeout} late=${t.late} inflight=${t.inflight} q=${t.queued} cache=${t.cached} | ` +
				`mesh ✓${m.done} ✗${m.failed} ⏱${m.timeout} inflight=${m.inflight} q=${m.queued} cache=${m.cached}`)
		}, 3000)
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
		on(S.OBJ_CACHE_PROBE,  onObjCacheProbe)
		on(S.TERRAIN_PATCH,    onTerrainPatch)
		on(S.TELEPORT_STARTED,  onTeleportStarted)
		on(S.TELEPORT_PROGRESS, onTeleportProgress)
		on(S.TELEPORT_FINISH,   onTeleportFinish)
		on(S.TELEPORT_FAILED,   onTeleportFailed)
		on(S.OBJECT_PROPS,      onObjectProps)
		on(S.MAP_BLOCKS,        onEngineMapBlocks)
	})

	onUnmounted(() => {
		// WHY first: in-flight geometry-lookup batches check this flag — applying them after
		// unmount would sync-bake on the disposed baker and mutate orphaned meshes.
		_engineDead = true
		_liveEngine = null
		stopAlwaysRunWatch()
		stopLitShadingWatch()
		stopSceneRebuildWatch()
		stopTexRefreshWatch()
		stopGizmoSelWatch()
		stopGizmoModeWatch()
		stopGizmoVisWatch()
		stopSelSyncWatch()
		stopWaterHeightWatch()
		stopTerrainTexWatch()
		stopRegionSizeWatch()
		stopGeomCacheRamWatch?.()
		stopVramBudgetWatch?.()
		terrainShaderMaterial?.dispose()
		terrainShaderMaterial = null
		// WHY: drop any lingering sim-side selection so we don't leave the prim flagged after unmount.
		if (simSelectedId != null) { sendDeselect([simSelectedId]); simSelectedId = null }
		clearGizmo()
		endFocusGlide()
		cancelAnimationFrame(animId)
		uninstallConsoleForwarder()
		if (_assetStatsTimer) { clearInterval(_assetStatsTimer); _assetStatsTimer = null }
		if (_meshDrainTimer) { clearInterval(_meshDrainTimer); _meshDrainTimer = null }
		if (_cullTimer) { clearInterval(_cullTimer); _cullTimer = null }
		if (_visTimer) { clearInterval(_visTimer); _visTimer = null }
		if (_longTaskObs) { try { _longTaskObs.disconnect() } catch { /* ignore */ } _longTaskObs = null }
		evicted.clear()
		if (_texBackfillTimer) { clearInterval(_texBackfillTimer); _texBackfillTimer = null }
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
		off(S.OBJ_CACHE_PROBE, onObjCacheProbe)
		off(S.TERRAIN_PATCH,   onTerrainPatch)
		off(S.TELEPORT_STARTED,  onTeleportStarted)
		off(S.TELEPORT_PROGRESS, onTeleportProgress)
		off(S.TELEPORT_FINISH,   onTeleportFinish)
		off(S.TELEPORT_FAILED,   onTeleportFailed)
		off(S.OBJECT_PROPS,      onObjectProps)
		off(S.MAP_BLOCKS,        onEngineMapBlocks)
		ro?.disconnect()
		renderer?.dispose()
		labelRenderer?.domElement.remove()
		for (const mesh of meshMap.values()) mesh.geometry.dispose()
		meshMap.clear()
		disposeInstancing()  // tear down pooled InstancedMeshes/caches on unmount
		hoverTextMeshes.clear()
		pendingMeshIds.clear()  // perf: drop queued mesh builds on unmount
		_ingestQueue.length = 0
		clearTpTimers()
		evicted.clear()
		orphansByParent.clear()
		meshBaker.dispose()     // terminate the off-thread geometry-bake worker
		objCacheFlush()         // persist any buffered object writes before teardown
		clearTextureCache()     // dispose cached GPU textures (slice 1 asset fetch)
		worldStore.clearTerrain()
		worldStore.clearAll()
	})

	_liveEngine = { setObjectAlphaMode: setObjectAlphaModeLive }

	return { scene, camera }
}
