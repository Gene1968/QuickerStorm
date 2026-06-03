// src/composables/usePlaces.js — built-in landmarks + user-saved favorites for the Places floater.
// Favorites are inventory landmarks in the Favorites folder (typeDefault=23), backed by IndexedDB.
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useTeleport } from './useTeleport'
import { useTeleportHistory } from './useTeleportHistory'

const AT_LANDMARK = 3   // SL AssetType for landmark inventory items

export function usePlaces() {
	const world   = useWorldStore()
	const session = useSessionStore()
	const inventory = useInventoryStore()
	const { requestTeleport, requestRegionTeleport, requestLandmarkTeleport } = useTeleport()
	// WHY: TP history lives in its own module so useTeleport (the writer for ALL teleport sources)
	// can record without a circular import back through usePlaces. Here we only read + clear it.
	const { history, clear: clearHistory } = useTeleportHistory()

	// Landmarks in the Inventory Favorites folder (typeDefault=23). IndexedDB-backed so available
	// immediately after first login. Updates live as folders load or new landmarks are created.
	const invFavorites = computed(() => {
		const favId = inventory.findSystemFolder(23)
		if (!favId) return []
		return (inventory.items.get(favId) || [])
			.filter(it => it.assetType === AT_LANDMARK && it.assetId)
			.map(it => ({ name: it.name || '(landmark)', landmarkId: it.assetId, itemId: it.itemId }))
			.sort((a, b) => a.name.localeCompare(b.name))
	})

	const builtIns = computed(() => {
		const items = []
		if (world.spawnPos) items.push({ name: 'Spawn', regionName: session.regionName, x: world.spawnPos[0], y: world.spawnPos[1], z: world.spawnPos[2], builtin: true })
		const cx = session.regionSizeX / 2
		const cy = session.regionSizeY / 2
		items.push({ name: 'Region centre', regionName: session.regionName, x: cx, y: cy, z: 25, builtin: true })
		items.push({ name: 'Last position', regionName: session.regionName, x: world.avatarPos.x, y: world.avatarPos.y, z: world.avatarPos.z, builtin: true })
		return items
	})

	// Inventory landmark assets (assetType 3). Gathered across every fetched folder — the
	// background inventory loader (useInventory.fetchAll) walks all folders after caps land, so
	// this fills in as folders load. Each carries the LM asset id used by TeleportLandmarkRequest.
	const landmarks = computed(() => {
		const out = []
		inventory.items.forEach(list => {
			for (const it of list) {
				if (it.assetType === AT_LANDMARK && it.assetId) {
					out.push({ name: it.name || '(landmark)', landmarkId: it.assetId, itemId: it.itemId })
				}
			}
		})
		// dedup by asset id (a landmark may be linked into multiple folders) + sort by name
		const seen = new Set()
		return out
			.filter(l => (seen.has(l.landmarkId) ? false : seen.add(l.landmarkId)))
			.sort((a, b) => a.name.localeCompare(b.name))
	})

	// WHY: requestTeleport records history itself (single source of truth). Pass the place's
	// friendly name/region so the History entry is labelled, not just bare coordinates.
	// Cross-region entries (history, built-ins) use requestRegionTeleport when region differs.
	function teleportTo(place) {
		const sameRegion = !place.regionName || place.regionName.toLowerCase() === session.regionName.toLowerCase()
		if (sameRegion) {
			requestTeleport({ x: place.x, y: place.y, z: place.z, name: place.name, regionName: place.regionName })
		} else {
			requestRegionTeleport({ regionName: place.regionName, x: place.x, y: place.y, z: place.z })
		}
	}

	/** Teleport to a saved inventory landmark — sim resolves its stored location. */
	function teleportToLandmark(lm) { requestLandmarkTeleport({ landmarkId: lm.landmarkId }) }

	return {
		builtIns, invFavorites, history, landmarks,
		teleportTo, teleportToLandmark, clearHistory,
	}
}
