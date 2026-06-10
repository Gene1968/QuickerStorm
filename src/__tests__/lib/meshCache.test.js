import { describe, it, expect } from 'bun:test'
import { meshDbConfig, getMeshCacheStats, clearMeshCache } from '@/lib/meshCache.js'

describe('meshCache', () => {
	it('exposes a stable store name + key path', () => {
		expect(meshDbConfig.store).toBe('mesh')
		expect(meshDbConfig.keyPath).toBe('uuid')
	})

	it('exports getMeshCacheStats function', () => {
		expect(typeof getMeshCacheStats).toBe('function')
	})

	it('exports clearMeshCache function', () => {
		expect(typeof clearMeshCache).toBe('function')
	})
})
