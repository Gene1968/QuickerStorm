// src/composables/usePlaces.js — built-in landmarks + user-saved favorites for the Places floater.
// Favorites persist in localStorage per logged-in agent. TP via useTeleport.
import { ref, computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useTeleport } from './useTeleport'

const FAV_KEY = (agentId) => `qs_places_${agentId || 'anon'}`

const favorites = ref([])  // [{ name, regionName, x, y, z }]

function loadFor(agentId) {
	try {
		const raw = localStorage.getItem(FAV_KEY(agentId))
		favorites.value = raw ? JSON.parse(raw) : []
	} catch { favorites.value = [] }
}

function persistFor(agentId) {
	try { localStorage.setItem(FAV_KEY(agentId), JSON.stringify(favorites.value)) } catch {}
}

export function usePlaces() {
	const world   = useWorldStore()
	const session = useSessionStore()
	const { requestTeleport } = useTeleport()

	if (session.agentId && favorites.value.length === 0) loadFor(session.agentId)

	const builtIns = computed(() => {
		const items = []
		if (world.spawnPos) items.push({ name: 'Spawn', regionName: session.regionName, x: world.spawnPos[0], y: world.spawnPos[1], z: world.spawnPos[2], builtin: true })
		const cx = session.regionSizeX / 2
		const cy = session.regionSizeY / 2
		items.push({ name: 'Region centre', regionName: session.regionName, x: cx, y: cy, z: 25, builtin: true })
		items.push({ name: 'Last position', regionName: session.regionName, x: world.avatarPos.x, y: world.avatarPos.y, z: world.avatarPos.z, builtin: true })
		return items
	})

	function teleportTo(place) {
		requestTeleport({ x: place.x, y: place.y, z: place.z })
	}

	function addFavorite(name) {
		favorites.value.push({
			name: name || `Place ${favorites.value.length + 1}`,
			regionName: session.regionName,
			x: world.avatarPos.x,
			y: world.avatarPos.y,
			z: world.avatarPos.z,
		})
		persistFor(session.agentId)
	}

	function removeFavorite(idx) {
		favorites.value.splice(idx, 1)
		persistFor(session.agentId)
	}

	function renameFavorite(idx, name) {
		if (favorites.value[idx]) {
			favorites.value[idx].name = name
			persistFor(session.agentId)
		}
	}

	return {
		builtIns, favorites,
		teleportTo, addFavorite, removeFavorite, renameFavorite,
	}
}
