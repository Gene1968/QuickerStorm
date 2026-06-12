import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import { planEvictions, TEX_CACHE_FALLBACK_BYTES, resolveCacheCap, getTextureCacheStats, clearTextureCache, texCacheGet, texCachePut } from '@/lib/textureCache.js'

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

describe('resolveCacheCap', () => {
	const FALLBACK = 8 * 1024 * 1024 * 1024
	it('takes a fraction of the reported quota', () => {
		expect(resolveCacheCap({ quota: 100 * 1024 * 1024 * 1024 }, 0.6, FALLBACK)).toBe(60 * 1024 * 1024 * 1024)
	})
	it('falls back when quota is missing or zero', () => {
		expect(resolveCacheCap({}, 0.6, FALLBACK)).toBe(FALLBACK)
		expect(resolveCacheCap({ quota: 0 }, 0.6, FALLBACK)).toBe(FALLBACK)
		expect(resolveCacheCap(undefined, 0.6, FALLBACK)).toBe(FALLBACK)
	})
})

describe('textureCache exports', () => {
	it('exports TEX_CACHE_FALLBACK_BYTES as 8 GB', () => {
		expect(TEX_CACHE_FALLBACK_BYTES).toBe(1024 * 1024 * 1024 * 8)
	})
	it('exports getTextureCacheStats function', () => {
		expect(typeof getTextureCacheStats).toBe('function')
	})

	it('exports clearTextureCache function', () => {
		expect(typeof clearTextureCache).toBe('function')
	})
})

describe('texCachePut / texCacheGet — Blob record shape', () => {
	it('stores and returns a Blob, sizing bytes by blob.size', async () => {
		const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'image/webp' })
		await texCachePut('11111111-1111-1111-1111-111111111111', blob, true)
		const got = await texCacheGet('11111111-1111-1111-1111-111111111111')
		expect(got.blob).toBeInstanceOf(Blob)
		expect(got.blob.size).toBe(5)
		expect(got.hasAlpha).toBe(true)
	})
})
