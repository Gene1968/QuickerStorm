import { ref } from 'vue'
import { getTextureCacheStats, clearTextureCache } from '@/lib/textureCache.js'
import { getMeshCacheStats, clearMeshCache } from '@/lib/meshCache.js'

export function useCacheStats() {
	const texStats  = ref({ count: 0, bytes: 0, capBytes: 512 * 1024 * 1024, loading: false })
	const meshStats = ref({ count: 0, bytes: 0, loading: false })

	async function refresh() {
		texStats.value  = { ...texStats.value,  loading: true }
		meshStats.value = { ...meshStats.value, loading: true }
		const [tex, mesh] = await Promise.all([getTextureCacheStats(), getMeshCacheStats()])
		texStats.value  = { ...tex,  loading: false }
		meshStats.value = { ...mesh, loading: false }
	}

	async function clearTex() {
		texStats.value = { ...texStats.value, loading: true }
		await clearTextureCache()
		const tex = await getTextureCacheStats()
		texStats.value = { ...tex, loading: false }
	}

	async function clearMesh() {
		meshStats.value = { ...meshStats.value, loading: true }
		await clearMeshCache()
		const mesh = await getMeshCacheStats()
		meshStats.value = { ...mesh, loading: false }
	}

	return { texStats, meshStats, refresh, clearTex, clearMesh }
}
