// src/stores/worldStore.js — object map driven by ObjectUpdate LLUDP messages
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const PCODE_PRIM   = 9
export const PCODE_AVATAR = 47

export const useWorldStore = defineStore('world', () => {
	// Map<localId (number), object>
	const objects = ref(new Map())

	// WHY incremental indexes: the `avatars`/`prims` computeds used to filter ALL objects
	// (`[...objects.values()].filter(...)`) and re-ran on EVERY ObjectUpdate, since they depended on
	// the whole `objects` map. On a dense region (~10k objects) the reactive UI (AvatarList, Minimap,
	// MapFloater) re-read them thousands of times during load → O(n²), measured ~1.1s of frame time
	// in a live profile (FEATURE-GAPS #11). These indexes track avatars/prims by localId so the
	// computeds depend only on the small per-kind set; prim updates no longer invalidate `avatars`.
	const _avatars = ref(new Map())   // localId → object (pcode === PCODE_AVATAR)
	const _prims   = ref(new Map())   // localId → object (pcode === PCODE_PRIM)
	// Keep the per-kind index in sync with a record. Holds the SAME merged reference stored in
	// `objects`, so consumers see live data; reconciles if an object's pcode ever changes kind.
	function _index(localId, rec) {
		if (rec.pcode === PCODE_AVATAR) { _avatars.value.set(localId, rec); _prims.value.delete(localId) }
		else if (rec.pcode === PCODE_PRIM) { _prims.value.set(localId, rec); _avatars.value.delete(localId) }
		else { _avatars.value.delete(localId); _prims.value.delete(localId) }
	}
	function _unindex(localId) { _avatars.value.delete(localId); _prims.value.delete(localId) }

	// Culling telemetry for the % -loaded badge + Prefs. resident/known are non-avatar mesh counts
	// WITHIN the current draw distance; atTarget = at the full target radius (badge says "complete"
	// vs "nearby"); massive = this load has run long enough (duration, not count) to be slow → badge
	// prepends the "Major new scenery to cache" preface; effNear = current draw distance (m).
	const cullStats = ref({ resident: 0, known: 0, evicted: 0, pct: 100, atTarget: true, massive: false, effNear: 0, texPending: 0, texFailed: 0, objPending: 0, objFailed: 0 })
	function setCullStats(s) { cullStats.value = s }

	const sceneLoading = ref(true)   // region assets still draining? published from useWorldEngine.cullTick
	function setSceneLoading(v) { sceneLoading.value = !!v }

	// Monotonic count of completed asset fetches (textures + meshes), published from cullTick. The
	// inventory bulk-walk gate watches this for FORWARD PROGRESS: a heavy region keeps sceneLoading
	// true for many minutes, so the gate can't use a wall-clock ceiling (it would release inventory
	// into a still-active load). Deferring while this counter advances — and only releasing on a real
	// no-progress stall — keeps inventory out of the way for the whole load. See shouldDeferInventoryWalk.
	const assetProgress = ref(0)
	function setAssetProgress(v) { assetProgress.value = v | 0 }

	// WHY: ObjectUpdate nameValue is the raw SL NameValue string, e.g.:
	//   "FirstName STRING RW SV John\nLastName STRING RW SV Doe\n"
	// AvatarList reads .name; parse it here so all consumers get a display name.
	function parseNameValue(nv) {
		if (!nv) return ''
		const first = nv.match(/FirstName\s+\S+\s+\S+\s+\S+\s+(\S+)/)?.[1] ?? ''
		const last  = nv.match(/LastName\s+\S+\s+\S+\s+\S+\s+(\S+)/)?.[1]  ?? ''
		return [first, last].filter(Boolean).join(' ')
	}

	function upsertObject(obj) {
		// obj: { localId, fullId, pcode, pos, rot, scale, nameValue, clickAction }
		const existing = objects.value.get(obj.localId) ?? {}
		const name = obj.nameValue ? parseNameValue(obj.nameValue) : (existing.name ?? '')
		const rec = { ...existing, ...obj, name }
		rec.clickAction = obj.clickAction ?? existing.clickAction ?? 0
		objects.value.set(obj.localId, rec)
		_index(obj.localId, rec)
	}

	function updateObjectPos(localId, pos) {
		const existing = objects.value.get(localId)
		if (existing) {
			const rec = { ...existing, pos }
			objects.value.set(localId, rec)
			_index(localId, rec)
		}
	}

	function removeObject(localId) { objects.value.delete(localId); _unindex(localId) }

	// WHY: ObjectProperties arrives keyed by fullId (UUID), not localId. Walk values to match.
	// Merges name/description/creator/owner/perms into the object so Edit floater + Inspect
	// menus get real metadata without re-fetching.
	function applyObjectProperties(props) {
		for (const [id, obj] of objects.value) {
			if (obj.fullId?.toLowerCase() === props.fullId?.toLowerCase()) {
				const rec = { ...obj, ...props, name: props.name || obj.name }
				objects.value.set(id, rec)
				_index(id, rec)
				return true
			}
		}
		return false
	}

	function clearAll() { objects.value.clear(); _avatars.value.clear(); _prims.value.clear() }

	// Derived from the small per-kind indexes (NOT the full objects map), so they invalidate only
	// when an avatar/prim is added/removed/updated — prim churn no longer re-runs the avatar list.
	const avatars = computed(() => [..._avatars.value.values()])
	const prims   = computed(() => [..._prims.value.values()])

	// WHY: Sim-authoritative avatar position in SL coords (X=east, Y=north, Z=height).
	// Updated from ObjectUpdate and TerseUpdate for own avatar in useWorldEngine.
	// LocationBar reads this instead of camera position so scroll/explore don't affect display.
	// WHY no 256 clamp: var regions up to 512×512 are valid; useWorldEngine applies its own
	// region-size-aware clamps for dead-reckoning. Coord display handles any positive value.
	const avatarPos = ref({ x: 128, y: 128, z: 25 })
	function setAvatarPos(slX, slY, slZ) {
		avatarPos.value = {
			x: Math.max(0, slX),
			y: Math.max(0, slY),
			z: Math.max(0, slZ),
		}
	}

	// WHY: spawnPos = raw unclamped AgentMovementComplete position, stored at app-root level
	// so it survives the race between AGENT_SPAWN_POS arriving and WorldCanvas mounting.
	// App.vue registers the handler (always-live); useWorldEngine consumes on mount.
	const spawnPos = ref(null)  // null | [slX, slY, slZ]
	function setSpawnPos(x, y, z) { spawnPos.value = [x, y, z] }

	// WHY: Terrain heights survive remount (HMR, navigation away/back).
	// 513×513 = 263,169 floats — supports var regions up to 512×512m as well as standard 256×256.
	// Heights stored with stride=513; useWorldEngine reads only regionSizeX+1 × regionSizeY+1
	// vertices when rebuilding geometry from this array.
	const TERRAIN_STRIDE = 513
	const terrainHeights = ref(new Float32Array(TERRAIN_STRIDE * TERRAIN_STRIDE))
	// WHY: Float32Array element mutations don't trigger Vue reactivity. Increment this
	// counter on every patch write so consumers (e.g. ResyncBanner) can react to terrain
	// data arriving without resorting to polling. Also useful as a diagnostic.
	const terrainPatchCount = ref(0)
	// WHY: Track which patch keys ("px,py") have arrived from server for diagnostic
	// missing-patch detection (see [[terrain-decoder-missing-patches]]). Compared to
	// expected 16×16 grid (or 32×32 for var-region) post-RegionHandshake to find holes.
	const patchReceived = ref(new Set())

	// WHY: Per-patch update instead of full-grid replace — patches arrive incrementally (one per
	// TERRAIN_PATCH message). Stores raw 16×16 patch data; seam-fill handled in useWorldEngine.
	// stride=TERRAIN_STRIDE supports up to 512m wide region.
	function setTerrainPatch(px, py, heights, patchSize = 16) {
		for (let j = 0; j < patchSize; j++) {
			for (let i = 0; i < patchSize; i++) {
				const slX = px * patchSize + i  // SL X coord (column)
				const slY = py * patchSize + j  // SL Y coord (row)
				if (slX >= 512 || slY >= 512) continue  // max var-region bound
				terrainHeights.value[slY * TERRAIN_STRIDE + slX] = heights[j * patchSize + i]
			}
		}
		patchReceived.value.add(`${px},${py}`)
		terrainPatchCount.value++
	}

	function clearTerrain() {
		terrainHeights.value.fill(0)
		terrainPatchCount.value = 0
		patchReceived.value = new Set()
	}

	// WHY: Diagnostic — compare expected 16×16 (or 32×32 var-region) patch grid against
	// arrivals. Used by useWorldEngine debounced timer to surface decoder holes.
	// regionSize = 256 → 16 patches per axis. 512 → 32 per axis.
	function getMissingPatches(regionSizeX = 256, regionSizeY = 256, patchSize = 16) {
		const cols = Math.ceil(regionSizeX / patchSize)
		const rows = Math.ceil(regionSizeY / patchSize)
		const missing = []
		for (let py = 0; py < rows; py++) {
			for (let px = 0; px < cols; px++) {
				if (!patchReceived.value.has(`${px},${py}`)) missing.push(`${px},${py}`)
			}
		}
		return missing
	}

	return {
		objects, avatars, prims, cullStats, setCullStats, sceneLoading, setSceneLoading,
		assetProgress, setAssetProgress,
		upsertObject, updateObjectPos, removeObject, applyObjectProperties, clearAll,
		avatarPos, setAvatarPos,
		spawnPos, setSpawnPos,
		terrainHeights, TERRAIN_STRIDE, terrainPatchCount, setTerrainPatch, clearTerrain,
		patchReceived, getMissingPatches,
	}
})
