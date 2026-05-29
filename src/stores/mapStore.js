// src/stores/mapStore.js — world-map region cache + viewport state
// Populated by MAP_BLOCKS messages from server (response to MapBlockRequest/MapNameRequest).
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useMapStore = defineStore('map', () => {
	// keyed "regionX,regionY" (grid indices, not meters)
	const regions = ref(new Map())
	// Track which 16×16 chunks we've already queried this session — keyed "cx,cy"
	// where cx = floor(regionX / 16). Lets doQuery skip recently-fetched chunks.
	const queriedChunks = ref(new Map())   // "cx,cy" → timestamp ms
	const CHUNK_TTL_MS = 60_000             // refetch after a minute

	// View centre in grid indices (decimals OK for sub-region pan)
	const viewCenterX = ref(0)
	const viewCenterY = ref(0)
	// 1 = zoomed-in (region fills view), 5 = continent-wide
	const viewZoom = ref(2)

	function setRegions(blocks) {
		for (const b of blocks) {
			regions.value.set(`${b.regionX},${b.regionY}`, b)
		}
	}

	function getRegion(rx, ry) {
		return regions.value.get(`${rx},${ry}`) ?? null
	}

	function setCenter(rx, ry) {
		viewCenterX.value = rx
		viewCenterY.value = ry
	}

	function setZoom(z) {
		viewZoom.value = Math.max(1, Math.min(8, z))
	}

	function clear() {
		regions.value.clear()
		queriedChunks.value.clear()
	}

	function markChunkQueried(cx, cy) {
		queriedChunks.value.set(`${cx},${cy}`, Date.now())
	}

	function chunkFresh(cx, cy) {
		const t = queriedChunks.value.get(`${cx},${cy}`)
		return t && (Date.now() - t) < CHUNK_TTL_MS
	}

	return { regions, viewCenterX, viewCenterY, viewZoom,
		setRegions, getRegion, setCenter, setZoom, clear,
		markChunkQueried, chunkFresh }
})
