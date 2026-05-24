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

	return { objects, avatars, prims, upsertObject, updateObjectPos, removeObject, clearAll, avatarPos, setAvatarPos }
})
