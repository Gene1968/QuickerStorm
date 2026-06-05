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
	const texStats  = ref({ count: 0, bytes: 0, capBytes: 512 * 1024 * 1024, loading: false })
	const meshStats = ref({ count: 0, bytes: 0, loading: false })
	const objStats  = ref({ regions: 0, objects: 0, loading: false })
	const timedOut  = ref(false)

	async function refresh() {
		timedOut.value  = false
		texStats.value  = { ...texStats.value,  loading: true }
		meshStats.value = { ...meshStats.value, loading: true }
		objStats.value  = { ...objStats.value,  loading: true }
		try {
			const [tex, mesh, obj] = await withTimeout(
				Promise.all([getTextureCacheStats(), getMeshCacheStats(), getObjectCacheStats()]),
				STATS_TIMEOUT_MS,
			)
			texStats.value  = { ...tex,  loading: false }
			meshStats.value = { ...mesh, loading: false }
			objStats.value  = { ...obj,  loading: false }
		} catch (e) {
			if (e.message === 'stats-timeout') timedOut.value = true
			texStats.value  = { ...texStats.value,  loading: false }
			meshStats.value = { ...meshStats.value, loading: false }
			objStats.value  = { ...objStats.value,  loading: false }
		}
	}

	async function clearTex() {
		texStats.value = { ...texStats.value, loading: true }
		try {
			await clearTextureCache()
			const tex = await withTimeout(getTextureCacheStats(), STATS_TIMEOUT_MS)
			texStats.value = { ...tex, loading: false }
		} catch {
			texStats.value = { ...texStats.value, loading: false }
		}
	}

	async function clearMesh() {
		meshStats.value = { ...meshStats.value, loading: true }
		try {
			await clearMeshCache()
			const mesh = await withTimeout(getMeshCacheStats(), STATS_TIMEOUT_MS)
			meshStats.value = { ...mesh, loading: false }
		} catch {
			meshStats.value = { ...meshStats.value, loading: false }
		}
	}

	async function clearObj() {
		objStats.value = { ...objStats.value, loading: true }
		try {
			await objCacheClearAll()
			const obj = await withTimeout(getObjectCacheStats(), STATS_TIMEOUT_MS)
			objStats.value = { ...obj, loading: false }
		} catch {
			objStats.value = { ...objStats.value, loading: false }
		}
	}

	return { texStats, meshStats, objStats, timedOut, refresh, clearTex, clearMesh, clearObj }
}
