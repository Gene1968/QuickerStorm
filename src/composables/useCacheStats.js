import { ref } from 'vue'
import { getTextureCacheStats, clearTextureCache } from '@/lib/textureCache.js'
import { getMeshCacheStats, clearMeshCache } from '@/lib/meshCache.js'
import { getObjectCacheStats, objCacheClearAll } from '@/lib/objectCache.js'

// IDB readonly txns are blocked by concurrent readwrite puts during world loading.
// Race with a timeout so the panel never hangs; user can retry once loading settles.
const STATS_TIMEOUT_MS = 4000

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error('stats-timeout')), ms)),
	])
}

export function useCacheStats() {
	const texStats  = ref({ count: 0, bytes: 0, capBytes: 512 * 1024 * 1024, loading: false, unavailable: false })
	const meshStats = ref({ count: 0, bytes: 0, loading: false, unavailable: false })
	const objStats  = ref({ regions: 0, objects: 0, loading: false, unavailable: false })

	// WHY independent loads: a single Promise.all([...]) with one shared timeout meant ONE slow
	// cache (e.g. texture/mesh readonly count() starving behind a write storm during world load)
	// blanked ALL three cards as "Unavailable". Each cache now loads + times out on its own and
	// carries its own `unavailable` flag, so a healthy cache always shows even if another is busy.
	async function load(fn, target) {
		target.value = { ...target.value, loading: true, unavailable: false }
		try {
			const v = await withTimeout(fn(), STATS_TIMEOUT_MS)
			target.value = { ...target.value, ...v, loading: false, unavailable: false }
		} catch {
			target.value = { ...target.value, loading: false, unavailable: true }
		}
	}

	function refresh() {
		// Fire all three concurrently but independently — do NOT await as a group.
		load(getTextureCacheStats, texStats)
		load(getMeshCacheStats, meshStats)
		load(getObjectCacheStats, objStats)
	}

	async function clearTex() { await clearTextureCache(); await load(getTextureCacheStats, texStats) }
	async function clearMesh() { await clearMeshCache(); await load(getMeshCacheStats, meshStats) }
	async function clearObj() { await objCacheClearAll(); await load(getObjectCacheStats, objStats) }

	return { texStats, meshStats, objStats, refresh, clearTex, clearMesh, clearObj }
}
