import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import { planEvictions, TEX_CACHE_FALLBACK_BYTES, resolveCacheCap, getTextureCacheStats, clearTextureCache, texCacheGet, texCachePut, setTexCacheLoading, getTextureWriteBufStats, setTexDeferLimits, __flushTexWritesNow } from '@/lib/textureCache.js'

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
		texCachePut('11111111-1111-1111-1111-111111111111', blob, true)
		await __flushTexWritesNow()
		const got = await texCacheGet('11111111-1111-1111-1111-111111111111')
		expect(got.blob).toBeInstanceOf(Blob)
		expect(got.blob.size).toBe(5)
		expect(got.hasAlpha).toBe(true)
	})
})

describe('write-deferral (qs-tex)', () => {
	const mkBlob = (n) => new Blob([new Uint8Array(n)], { type: 'image/webp' })

	it('serves a buffered put before any flush (no IDB round-trip needed)', async () => {
		await clearTextureCache()
		setTexCacheLoading(false)
		setTexDeferLimits({ hardCapBytes: 64 * 1024 * 1024 })
		texCachePut('aaaaaaaa-0000-0000-0000-000000000001', mkBlob(5), true)
		expect(getTextureWriteBufStats().bytes).toBe(5)
		const got = await texCacheGet('aaaaaaaa-0000-0000-0000-000000000001')
		expect(got.blob).toBeInstanceOf(Blob)
		expect(got.blob.size).toBe(5)
		expect(got.hasAlpha).toBe(true)
	})

	it('force-flush persists the batch to IDB and empties the buffer', async () => {
		await clearTextureCache()
		setTexCacheLoading(false)
		texCachePut('bbbbbbbb-0000-0000-0000-000000000001', mkBlob(7), false)
		texCachePut('bbbbbbbb-0000-0000-0000-000000000002', mkBlob(9), false)
		await __flushTexWritesNow()
		expect(getTextureWriteBufStats().bytes).toBe(0)
		const got = await texCacheGet('bbbbbbbb-0000-0000-0000-000000000002')
		expect(got.blob.size).toBe(9)
		const stats = await getTextureCacheStats()
		expect(stats.count).toBe(2)
		expect(stats.bytes).toBe(16)
	})

	it('while loading, a put stays buffered (auto-flush suspended) until forced', async () => {
		await clearTextureCache()
		setTexCacheLoading(true)
		texCachePut('cccccccc-0000-0000-0000-000000000001', mkBlob(11), false)
		expect(getTextureWriteBufStats().bytes).toBe(11)   // buffered, not flushed
		await __flushTexWritesNow()
		expect(getTextureWriteBufStats().bytes).toBe(0)
		setTexCacheLoading(false)
		const got = await texCacheGet('cccccccc-0000-0000-0000-000000000001')
		expect(got.blob.size).toBe(11)
	})

	it('drops NEW uuids past the buffer hard cap (telemetry counts the drop)', async () => {
		await clearTextureCache()
		setTexCacheLoading(true)            // stay buffered so the cap is exercised
		setTexDeferLimits({ hardCapBytes: 20 })
		const before = getTextureWriteBufStats().dropped
		texCachePut('dddddddd-0000-0000-0000-000000000001', mkBlob(25), false)  // fills past cap
		texCachePut('dddddddd-0000-0000-0000-000000000002', mkBlob(5), false)   // NEW uuid → dropped
		expect(getTextureWriteBufStats().dropped).toBe(before + 1)
		setTexDeferLimits({ hardCapBytes: 128 * 1024 * 1024 })   // restore for other tests
		await __flushTexWritesNow()
		setTexCacheLoading(false)
	})
})
