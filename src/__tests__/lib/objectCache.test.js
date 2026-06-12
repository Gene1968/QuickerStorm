import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import {
	planRegionEvictions, objCachePut, objCacheFlush, objCacheGetAll,
	objCacheCrcMap, objCacheClearRegion, objCacheEvict,
} from '@/lib/objectCache.js'

describe('planRegionEvictions (region LRU)', () => {
	it('keeps all when at or under the cap', () => {
		const regions = [
			{ regionKey: 'a', newestSavedAt: 1 },
			{ regionKey: 'b', newestSavedAt: 2 },
		]
		expect(planRegionEvictions(regions, 2)).toEqual([])
		expect(planRegionEvictions(regions, 5)).toEqual([])
	})

	it('drops the oldest regions (by newestSavedAt) beyond the cap', () => {
		const regions = [
			{ regionKey: 'new', newestSavedAt: 30 },
			{ regionKey: 'old', newestSavedAt: 10 },
			{ regionKey: 'mid', newestSavedAt: 20 },
		]
		// cap 1 → keep only 'new'; drop the two oldest, oldest-first
		expect(planRegionEvictions(regions, 1)).toEqual(['old', 'mid'])
	})
})

const obj = (localId, crc, extra = {}) => ({ localId, fullId: `f-${localId}`, crc, pos: [1, 2, 3], ...extra })

describe('put → crcMap roundtrip', () => {
	it('stores per-object crc and serves it in the probe map', async () => {
		const R = 'crc_rt'
		objCachePut(R, obj(101, 7001))
		objCachePut(R, obj(102, 7002))
		objCachePut(R, obj(103, undefined))   // update without crc → null record, excluded from map
		await objCacheFlush()
		const map = await objCacheCrcMap(R)
		expect(map.get(101)).toBe(7001)
		expect(map.get(102)).toBe(7002)
		expect(map.has(103)).toBe(false)
		const all = await objCacheGetAll(R)
		expect(all.length).toBe(3)            // record without crc is still pre-seedable
	})

	it('accumulates across saves — re-seeing fewer objects cannot shrink the set', async () => {
		const R = 'crc_acc'
		objCachePut(R, obj(1, 11)); objCachePut(R, obj(2, 22))
		await objCacheFlush()
		objCachePut(R, obj(2, 23))            // second "session" sees only object 2
		await objCacheFlush()
		const all = await objCacheGetAll(R)
		expect(all.length).toBe(2)
		expect((await objCacheCrcMap(R)).get(2)).toBe(23)
	})
})

describe('objCacheClearRegion (region-run purge)', () => {
	it('removes exactly the region’s records, returns the count, leaves other regions intact', async () => {
		const A = 'clear_a', B = 'clear_b'
		for (let i = 0; i < 500; i++) objCachePut(A, obj(i, i))
		objCachePut(B, obj(9000, 1))
		await objCacheFlush()
		const n = await objCacheClearRegion(A)
		expect(n).toBe(500)
		expect((await objCacheGetAll(A)).length).toBe(0)
		expect((await objCacheGetAll(B)).length).toBe(1)
	})

	it('drops buffered (unflushed) puts so they cannot resurrect after the purge', async () => {
		const R = 'clear_buf'
		objCachePut(R, obj(1, 1))
		await objCacheFlush()
		objCachePut(R, obj(2, 2))             // still in the write buffer
		const n = await objCacheClearRegion(R)
		expect(n).toBe(1)
		await objCacheFlush()                 // a later flush must not bring id 2 back
		expect((await objCacheGetAll(R)).length).toBe(0)
	})

	it('waits out an in-flight flush — a racing batch cannot land after the purge', async () => {
		const R = 'clear_race'
		for (let i = 0; i < 50; i++) objCachePut(R, obj(i, i))
		const flushing = objCacheFlush()      // in flight, not awaited
		const n = await objCacheClearRegion(R)
		await flushing
		await objCacheFlush()
		expect((await objCacheGetAll(R)).length).toBe(0)
		expect(n).toBeGreaterThanOrEqual(0)
	})
})

describe('objCacheEvict (KillObject)', () => {
	it('removes one record and drops any buffered put for it', async () => {
		const R = 'evict_r'
		objCachePut(R, obj(5, 55))
		await objCacheFlush()
		objCachePut(R, obj(5, 56))            // buffered re-put must not resurrect it
		await objCacheEvict(R, 5)
		await objCacheFlush()
		expect((await objCacheGetAll(R)).length).toBe(0)
	})
})
