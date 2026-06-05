import { describe, it, expect } from 'bun:test'
import { planEvictions, TEX_CACHE_CAP_BYTES, getTextureCacheStats, clearTextureCache } from '@/lib/textureCache.js'

describe('planEvictions (LRU policy)', () => {
	it('evicts nothing when under cap', () => {
		const entries = [
			{ uuid: 'a', bytes: 10, lastUsed: 1 },
			{ uuid: 'b', bytes: 10, lastUsed: 2 },
		]
		expect(planEvictions(entries, 100)).toEqual([])
	})

	it('evicts oldest-first until total fits the cap', () => {
		const entries = [
			{ uuid: 'old',  bytes: 40, lastUsed: 1 },
			{ uuid: 'mid',  bytes: 40, lastUsed: 2 },
			{ uuid: 'new',  bytes: 40, lastUsed: 3 },
		]
		// total 120, cap 100 → drop just the oldest (40 → total 80)
		expect(planEvictions(entries, 100)).toEqual(['old'])
	})

	it('evicts multiple oldest entries when needed', () => {
		const entries = [
			{ uuid: 'a', bytes: 50, lastUsed: 1 },
			{ uuid: 'b', bytes: 50, lastUsed: 2 },
			{ uuid: 'c', bytes: 50, lastUsed: 3 },
		]
		// total 150, cap 60 → drop a then b (→ 50)
		expect(planEvictions(entries, 60)).toEqual(['a', 'b'])
	})
})

describe('textureCache exports', () => {
	it('exports TEX_CACHE_CAP_BYTES as 512 MB', () => {
		expect(TEX_CACHE_CAP_BYTES).toBe(512 * 1024 * 1024)
	})

	it('exports getTextureCacheStats function', () => {
		expect(typeof getTextureCacheStats).toBe('function')
	})

	it('exports clearTextureCache function', () => {
		expect(typeof clearTextureCache).toBe('function')
	})
})
