import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import {
	meshDbConfig, getMeshCacheStats, clearMeshCache, resolveMeshCap,
	setMeshCapBytes, meshCachePut, meshCacheGet,
	MESH_CACHE_MAX_BYTES, MESH_CACHE_FALLBACK_BYTES,
} from '@/lib/meshCache.js'

const GB = 1024 ** 3
// One submesh of ~`bytes` total typed-array payload (split across the four arrays).
const mkSubs = (bytes) => [{
	positions: new Float32Array(Math.ceil(bytes / 16)),
	normals:   new Float32Array(Math.ceil(bytes / 16)),
	uvs:       new Float32Array(Math.ceil(bytes / 16)),
	indices:   new Uint32Array(Math.ceil(bytes / 16)),
}]

describe('meshCache', () => {
	it('exposes a stable store name + key path', () => {
		expect(meshDbConfig.store).toBe('mesh')
		expect(meshDbConfig.keyPath).toBe('uuid')
	})

	it('resolveMeshCap: 10% of quota, hard max 1GB, 512MB fallback', () => {
		expect(resolveMeshCap({ quota: 5 * GB })).toBe(0.5 * GB)
		expect(resolveMeshCap({ quota: 100 * GB })).toBe(MESH_CACHE_MAX_BYTES)  // 10% = 10GB → clamp
		expect(resolveMeshCap({})).toBe(MESH_CACHE_FALLBACK_BYTES)
		expect(resolveMeshCap(undefined)).toBe(MESH_CACHE_FALLBACK_BYTES)
	})

	it('put → get roundtrip', async () => {
		await clearMeshCache()
		setMeshCapBytes(10 * 1024 * 1024)
		await meshCachePut('aaaa', mkSubs(1024), 1000)
		const subs = await meshCacheGet('aaaa')
		expect(subs?.length).toBe(1)
		expect(await meshCacheGet('missing')).toBe(null)
	})

	it('evicts oldest-by-lastUsed when a put pushes past the cap, never the fresh row', async () => {
		await clearMeshCache()
		const ENTRY = 64 * 1024   // ~4×16KB arrays per entry
		setMeshCapBytes(Math.floor(ENTRY * 4 * 2.5))  // fits ~2.5 entries
		await meshCachePut('old',  mkSubs(ENTRY * 4), 1000)
		await meshCachePut('mid',  mkSubs(ENTRY * 4), 2000)
		await meshCachePut('new',  mkSubs(ENTRY * 4), 3000)   // over cap → evict 'old'
		expect(await meshCacheGet('old')).toBe(null)
		expect((await meshCacheGet('mid'))?.length).toBe(1)
		expect((await meshCacheGet('new'))?.length).toBe(1)
		const stats = await getMeshCacheStats()
		expect(stats.count).toBe(2)
	})
})
