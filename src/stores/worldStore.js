// src/stores/worldStore.js — object map driven by ObjectUpdate LLUDP messages
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const PCODE_PRIM   = 9
export const PCODE_AVATAR = 47

export const useWorldStore = defineStore('world', () => {
	// Map<localId (number), object>
	const objects = ref(new Map())

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
		// obj: { localId, fullId, pcode, pos, rot, scale, nameValue }
		const existing = objects.value.get(obj.localId) ?? {}
		const name = obj.nameValue ? parseNameValue(obj.nameValue) : (existing.name ?? '')
		objects.value.set(obj.localId, { ...existing, ...obj, name })
	}

	function updateObjectPos(localId, pos) {
		const existing = objects.value.get(localId)
		if (existing) objects.value.set(localId, { ...existing, pos })
	}

	function removeObject(localId) { objects.value.delete(localId) }

	function clearAll() { objects.value.clear() }

	const avatars = computed(() =>
		[...objects.value.values()].filter(o => o.pcode === PCODE_AVATAR)
	)
	const prims = computed(() =>
		[...objects.value.values()].filter(o => o.pcode === PCODE_PRIM)
	)

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
		terrainPatchCount.value++
	}

	function clearTerrain() {
		terrainHeights.value.fill(0)
		terrainPatchCount.value = 0
	}

	return {
		objects, avatars, prims,
		upsertObject, updateObjectPos, removeObject, clearAll,
		avatarPos, setAvatarPos,
		spawnPos, setSpawnPos,
		terrainHeights, TERRAIN_STRIDE, terrainPatchCount, setTerrainPatch, clearTerrain,
	}
})
