// src/stores/worldStore.js — object map driven by ObjectUpdate LLUDP messages
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const PCODE_PRIM   = 9
export const PCODE_AVATAR = 47

export const useWorldStore = defineStore('world', () => {
	// Map<localId (number), object>
	const objects = ref(new Map())

	function upsertObject(obj) {
		// obj: { localId, fullId, pcode, pos, rot, scale, name }
		objects.value.set(obj.localId, { ...objects.value.get(obj.localId), ...obj })
	}

	function removeObject(localId) { objects.value.delete(localId) }

	function clearAll() { objects.value.clear() }

	const avatars = computed(() =>
		[...objects.value.values()].filter(o => o.pcode === PCODE_AVATAR)
	)
	const prims = computed(() =>
		[...objects.value.values()].filter(o => o.pcode === PCODE_PRIM)
	)

	return { objects, avatars, prims, upsertObject, removeObject, clearAll }
})
