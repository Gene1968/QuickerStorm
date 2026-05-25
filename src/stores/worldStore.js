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
	const avatarPos = ref({ x: 128, y: 128, z: 25 })
	function setAvatarPos(slX, slY, slZ) {
		avatarPos.value = {
			x: Math.max(0, Math.min(256, slX)),
			y: Math.max(0, Math.min(256, slY)),
			z: Math.max(0, slZ),
		}
	}

	// WHY: Terrain heights survive remount (HMR, navigation away/back).
	// 257×257 = 66,049 vertices: 256×256 metre region, 1 vertex per metre, +1 for overlap.
	// useWorldEngine rebuilds geometry from this on mount without needing a new LoginLayerData burst.
	const terrainHeights = ref(new Float32Array(66049))

	// WHY: Per-patch update instead of full-grid replace — patches arrive incrementally (one per
	// TERRAIN_PATCH message). Update only the 17×17 vertices affected by this patch.
	function setTerrainPatch(px, py, heights, patchSize = 16) {
		const stride = 257  // vertices per row (255 segments + 1)
		for (let j = 0; j < patchSize; j++) {
			for (let i = 0; i < patchSize; i++) {
				const slX = px * patchSize + i  // SL X coord (column)
				const slY = py * patchSize + j  // SL Y coord (row)
				if (slX > 256 || slY > 256) continue
				terrainHeights.value[slY * stride + slX] = heights[j * patchSize + i]
			}
		}
	}

	function clearTerrain() { terrainHeights.value.fill(0) }

	return {
		objects, avatars, prims,
		upsertObject, updateObjectPos, removeObject, clearAll,
		avatarPos, setAvatarPos,
		terrainHeights, setTerrainPatch, clearTerrain,
	}
})
