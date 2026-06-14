// src/__tests__/lib/geomCache.test.js
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import {
	resolveGeomCap, geomCacheStore, geomMemGet, geomCacheGetMany, bytesOfArrays,
	getGeomCacheStats, clearGeomCache, geomMemClear, getGeomMemBytes,
	setGeomCapBytes, __flushGeomWritesNow, __flushGeomTouchesNow, geomCacheEvict,
	setGeomCacheLoading, setGeomDeferLimits, setGeomMemBudget, getGeomMemBudget,
	geomManifestRecord, geomManifestPrefetch, computeAutoGeomCacheMb,
} from '@/lib/geomCache.js'

const GB = 1024 ** 3
const mkArrays = (fill = 1, verts = 12) => ({
	position: new Float32Array(verts * 3).fill(fill),
	normal:   new Float32Array(verts * 3).fill(fill),
	uv:       new Float32Array(verts * 2).fill(fill),
	index:    new Uint32Array(verts).fill(fill),
	groups:   [{ start: 0, count: verts, materialIndex: 0 }],
})

describe('resolveGeomCap', () => {
	it('caps at 30% of quota, hard max 4GB, 1GB fallback', () => {
		expect(resolveGeomCap({ quota: 5 * GB })).toBe(1.5 * GB)
		expect(resolveGeomCap({ quota: 100 * GB })).toBe(4 * GB)   // 30% would be 30GB → clamp
		expect(resolveGeomCap({})).toBe(1 * GB)
		expect(resolveGeomCap(undefined)).toBe(1 * GB)
	})
})

describe('bytesOfArrays', () => {
	it('sums the four typed-array byteLengths', () => {
		const a = mkArrays(1, 10)
		expect(bytesOfArrays(a)).toBe(120 + 120 + 80 + 40)
	})
	it('tolerates missing arrays (uv-less geometry)', () => {
		expect(bytesOfArrays({ position: new Float32Array(3) })).toBe(12)
	})
})

describe('memory tier — clone-on-hand-out invariant', () => {
	it('store returns a copy; mutating it does not corrupt the cached entry', async () => {
		geomMemClear(); await clearGeomCache()
		const handed = geomCacheStore('k1', mkArrays(7))
		handed.position[0] = 999                       // simulate in-place ratio rescale
		expect(geomMemGet('k1').position[0]).toBe(7)   // entry unharmed
	})
	it('geomMemGet returns a fresh copy each time', () => {
		geomMemClear()
		geomCacheStore('k2', mkArrays(3))
		const a = geomMemGet('k2'), b = geomMemGet('k2')
		expect(a.position).not.toBe(b.position)
		a.position[0] = 42
		expect(b.position[0]).toBe(3)
	})
	it('miss returns null; bytes are tracked', () => {
		geomMemClear()
		expect(geomMemGet('nope')).toBeNull()
		geomCacheStore('k3', mkArrays())
		expect(getGeomMemBytes()).toBe(bytesOfArrays(mkArrays()))
	})
})

describe('IDB tier', () => {
	it('roundtrips arrays through the write buffer and getMany, preserving types + groups', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r1', mkArrays(5))
		await __flushGeomWritesNow()
		geomMemClear()                                  // force the IDB path
		const m = await geomCacheGetMany(['r1', 'missing'])
		expect(m.size).toBe(1)
		const a = m.get('r1')
		expect(a.position).toBeInstanceOf(Float32Array)
		expect(a.index).toBeInstanceOf(Uint32Array)
		expect(a.position[0]).toBe(5)
		expect(a.groups).toEqual([{ start: 0, count: 12, materialIndex: 0 }])
	})
	it('getMany promotes hits into the memory tier', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r2', mkArrays(9))
		await __flushGeomWritesNow()
		geomMemClear()
		await geomCacheGetMany(['r2'])
		expect(geomMemGet('r2').position[0]).toBe(9)    // now a sync hit
	})
	it('promotion does not alias the returned arrays', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r3', mkArrays(4))
		await __flushGeomWritesNow()
		geomMemClear()
		const m = await geomCacheGetMany(['r3'])
		m.get('r3').position[0] = 777
		expect(geomMemGet('r3').position[0]).toBe(4)
	})
	it('latest-wins coalescing in the write buffer', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r4', mkArrays(1))
		geomCacheStore('r4', mkArrays(2))
		await __flushGeomWritesNow()
		geomMemClear()
		const m = await geomCacheGetMany(['r4'])
		expect(m.get('r4').position[0]).toBe(2)
	})
	it('stats reflect flushed entries; clear resets', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('s1', mkArrays())
		await __flushGeomWritesNow()
		const st = await getGeomCacheStats()
		expect(st.count).toBe(1)
		expect(st.bytes).toBe(bytesOfArrays(mkArrays()))
		expect(st.capBytes).toBeGreaterThan(0)
		await clearGeomCache()
		expect((await getGeomCacheStats()).count).toBe(0)
	})
	it('evicts oldest-lastUsed entries when over cap', async () => {
		geomMemClear(); await clearGeomCache()
		const one = bytesOfArrays(mkArrays())
		setGeomCapBytes(Math.floor(one * 2.5))          // room for 2 of 3
		geomCacheStore('old', mkArrays(), 1000)
		await __flushGeomWritesNow()
		geomCacheStore('mid', mkArrays(), 2000)
		await __flushGeomWritesNow()
		geomCacheStore('new', mkArrays(), 3000)
		await __flushGeomWritesNow()
		geomMemClear()
		const m = await geomCacheGetMany(['old', 'mid', 'new'])
		expect(m.has('old')).toBe(false)                // oldest evicted
		expect(m.has('mid')).toBe(true)
		expect(m.has('new')).toBe(true)
		setGeomCapBytes(1 * GB)                          // restore for later tests
	})

	it('totalBytes does not drift on same-key overwrite', async () => {
		geomMemClear(); await clearGeomCache()
		const one = bytesOfArrays(mkArrays())
		// Store the same key twice across two flush windows.
		geomCacheStore('dup', mkArrays(), 1000)
		await __flushGeomWritesNow()
		geomCacheStore('dup', mkArrays(), 2000)   // same key = byte-identical content
		await __flushGeomWritesNow()
		const st = await getGeomCacheStats()
		// totalBytes must equal one record's bytes, not two.
		expect(st.bytes).toBe(one)
		expect(st.count).toBe(1)
	})

	it('touch via __flushGeomTouchesNow updates lastUsed; touched record outlives untouched in eviction', async () => {
		geomMemClear(); await clearGeomCache()
		const one = bytesOfArrays(mkArrays())
		setGeomCapBytes(Math.floor(one * 2.5))    // room for 2 of 3

		// Write two old records at the same timestamp.
		geomCacheStore('touch-a', mkArrays(), 1000)
		geomCacheStore('touch-b', mkArrays(), 1000)
		await __flushGeomWritesNow()
		geomMemClear()

		// Read 'touch-a' — this schedules a touch at a later timestamp.
		await geomCacheGetMany(['touch-a'], 5000)
		await __flushGeomTouchesNow()             // flush touches to IDB immediately

		// Now store a third, newest record that pushes us over cap.
		geomCacheStore('touch-c', mkArrays(), 6000)
		await __flushGeomWritesNow()

		// 'touch-b' (lastUsed=1000) is the oldest → evicted; 'touch-a' (lastUsed=5000) survives.
		geomMemClear()
		const m = await geomCacheGetMany(['touch-a', 'touch-b', 'touch-c'])
		expect(m.has('touch-b')).toBe(false)      // untouched old record evicted
		expect(m.has('touch-a')).toBe(true)       // touched record survived
		expect(m.has('touch-c')).toBe(true)       // newest survived
		setGeomCapBytes(1 * GB)
	})

	it('FLUSH_MAX hard-flush: 200 stores trigger flush without explicit __flushGeomWritesNow', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		const small = () => ({
			position: new Float32Array(3).fill(1),
			normal:   new Float32Array(3).fill(1),
			uv:       new Float32Array(2).fill(1),
			index:    new Uint32Array(1).fill(1),
			groups:   [],
		})
		for (let i = 0; i < 200; i++) {
			geomCacheStore(`hf${i}`, small())
		}
		// The 200th store triggers a synchronous _flushNow() call, which kicks off an async
		// IDB write. Give the microtask/Promise queue a moment to settle.
		await new Promise(r => setTimeout(r, 50))
		const st = await getGeomCacheStats()
		expect(st.count).toBe(200)
	})
})

describe('corrupt-record degrade (spec: corrupt entry on hit → miss + evict)', () => {
	// Overwrite a record via a SECOND raw IDB connection (same fake-indexeddb namespace), so the
	// module's own connection sees disk-level corruption it never wrote itself. The store already
	// exists (module openDb ran), so opening at v1 needs no upgrade handler.
	const rawPut = (record) => new Promise((resolve, reject) => {
		const req = indexedDB.open('qs-geom', 1)
		req.onsuccess = () => {
			const db = req.result
			const tx = db.transaction('geom', 'readwrite')
			tx.objectStore('geom').put(record)
			tx.oncomplete = () => { db.close(); resolve() }
			tx.onerror = () => { db.close(); reject(tx.error) }
		}
		req.onerror = () => reject(req.error)
	})

	it('serves a corrupt record as a miss, never promotes it, and evicts it', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('cor1', mkArrays(6))
		await __flushGeomWritesNow()
		await rawPut({ key: 'cor1', position: 'not-an-array', bytes: 5, savedAt: 1, lastUsed: 1 })
		geomMemClear()
		const m = await geomCacheGetMany(['cor1'])
		expect(m.has('cor1')).toBe(false)               // miss, not a throw
		expect(geomMemGet('cor1')).toBeNull()           // never entered the memory tier
		// Evict is fire-and-forget from inside the readonly txn — give it a beat to commit.
		await new Promise(r => setTimeout(r, 50))
		const m2 = await geomCacheGetMany(['cor1'])
		expect(m2.has('cor1')).toBe(false)              // gone from IDB too
	})

	it('a corrupt record does not abort the batch txn — later keys still hit', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('cor2', mkArrays(1))
		geomCacheStore('good2', mkArrays(8))
		await __flushGeomWritesNow()
		await rawPut({ key: 'cor2', position: 'nope', bytes: 5, savedAt: 1, lastUsed: 1 })
		geomMemClear()
		const m = await geomCacheGetMany(['cor2', 'good2'])
		expect(m.has('cor2')).toBe(false)
		expect(m.get('good2').position[0]).toBe(8)      // batch survived the corrupt key
	})
})

describe('geomCacheEvict', () => {
	it('removes a healthy entry from both tiers and decrements stats', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('ev1', mkArrays(2))
		await __flushGeomWritesNow()
		expect((await getGeomCacheStats()).count).toBe(1)
		expect(geomMemGet('ev1')).not.toBeNull()
		await geomCacheEvict('ev1')
		expect(geomMemGet('ev1')).toBeNull()            // memory tier cleared
		const st = await getGeomCacheStats()
		expect(st.count).toBe(0)                        // stats decremented
		expect(st.bytes).toBe(0)
		const m = await geomCacheGetMany(['ev1'])
		expect(m.has('ev1')).toBe(false)                // IDB tier cleared
	})

	it('is a no-op on a missing key', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('keep', mkArrays(3))
		await __flushGeomWritesNow()
		await geomCacheEvict('not-there')
		expect((await getGeomCacheStats()).count).toBe(1)
		expect(geomMemGet('keep').position[0]).toBe(3)
	})
})

describe('write-deferral (warm-read decouple)', () => {
	const small = () => ({
		position: new Float32Array(3).fill(1), normal: new Float32Array(3).fill(1),
		uv: new Float32Array(2).fill(1), index: new Uint32Array(1).fill(1), groups: [],
	})

	it('while loading, exceeding FLUSH_MAX does NOT flush to IDB', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		setGeomDeferLimits({ ceilingBytes: 1 * GB, maxDeferMs: 60000 })   // ceilings won't fire
		setGeomCacheLoading(true)
		for (let i = 0; i < 250; i++) geomCacheStore(`d${i}`, small())     // > FLUSH_MAX (200)
		await new Promise(r => setTimeout(r, 400))                         // past FLUSH_MS
		expect((await getGeomCacheStats()).count).toBe(0)                  // nothing persisted
		setGeomCacheLoading(false)                                         // debounced exit flushes
		await new Promise(r => setTimeout(r, 900))                         // past exit debounce (750ms)
		expect((await getGeomCacheStats()).count).toBe(250)
		setGeomDeferLimits({ ceilingBytes: 256 * 1024 * 1024, maxDeferMs: 30000 })
	})

	it('byte ceiling forces a flush even while loading', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		const oneBytes = bytesOfArrays(small())
		setGeomDeferLimits({ ceilingBytes: oneBytes * 3, maxDeferMs: 60000 })  // flush after ~3 stores
		setGeomCacheLoading(true)
		for (let i = 0; i < 10; i++) geomCacheStore(`b${i}`, small())
		await new Promise(r => setTimeout(r, 100))
		expect((await getGeomCacheStats()).count).toBeGreaterThan(0)           // ceiling flushed mid-load
		setGeomCacheLoading(false)
		await new Promise(r => setTimeout(r, 900))
		setGeomDeferLimits({ ceilingBytes: 256 * 1024 * 1024, maxDeferMs: 30000 })
	})

	it('time ceiling forces a flush even while loading', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		setGeomDeferLimits({ ceilingBytes: 1 * GB, maxDeferMs: 0 })            // time ceiling fires asap
		setGeomCacheLoading(true)
		geomCacheStore('t1', small())
		await new Promise(r => setTimeout(r, 400))                            // past FLUSH_MS check tick
		expect((await getGeomCacheStats()).count).toBe(1)
		setGeomCacheLoading(false)
		await new Promise(r => setTimeout(r, 900))
		setGeomDeferLimits({ ceilingBytes: 256 * 1024 * 1024, maxDeferMs: 30000 })
	})
})

describe('mem-tier budget setter', () => {
	it('round-trips a realistic budget and applies the 16MB floor', () => {
		setGeomMemBudget(200 * 1024 * 1024)
		expect(getGeomMemBudget()).toBe(200 * 1024 * 1024)        // honored as-is
		setGeomMemBudget(1080)                                    // below the floor
		expect(getGeomMemBudget()).toBe(16 * 1024 * 1024)         // clamped up to 16MB
		setGeomMemBudget(0)                                       // falsy → default
		expect(getGeomMemBudget()).toBe(128 * 1024 * 1024)        // GEOM_MEM_BUDGET fallback
		setGeomMemBudget(128 * 1024 * 1024)                       // restore default for later tests
	})
	it('propagates the budget to the byteLRU mem tier (no error on resize)', () => {
		geomMemClear()
		for (let i = 0; i < 5; i++) geomCacheStore(`mb${i}`, mkArrays())
		setGeomMemBudget(64 * 1024 * 1024)                        // ample → nothing evicted
		expect(getGeomMemBytes()).toBe(5 * bytesOfArrays(mkArrays()))
		setGeomMemBudget(128 * 1024 * 1024)
	})
})

describe('computeAutoGeomCacheMb (RAM mem-tier auto default)', () => {
	const MB = 1024 * 1024
	it('takes 30% of heap headroom above the 1536MB resident budget, clamped 128..1024', () => {
		expect(computeAutoGeomCacheMb({ heapLimitBytes: 4096 * MB })).toBe(768)    // (4096-1536)*0.30
		expect(computeAutoGeomCacheMb({ heapLimitBytes: 16384 * MB })).toBe(1024)  // clamps at ceiling
		expect(computeAutoGeomCacheMb({ heapLimitBytes: 1600 * MB })).toBe(128)    // clamps at floor
	})
	it('falls back to conservative device-RAM tiers when no heap API is available', () => {
		expect(computeAutoGeomCacheMb({ deviceMemory: undefined })).toBe(256)
		expect(computeAutoGeomCacheMb({ deviceMemory: 2 })).toBe(256)
		expect(computeAutoGeomCacheMb({ deviceMemory: 8 })).toBe(384)
	})
})

describe('per-region manifest prefetch', () => {
	it('records keys for a region and prefetches them into the mem tier on re-entry', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('mk1', mkArrays(3)); geomCacheStore('mk2', mkArrays(4))
		await __flushGeomWritesNow()
		await geomManifestRecord('region-A', ['mk1', 'mk2'])
		geomMemClear()                                          // simulate fresh region entry
		expect(geomMemGet('mk1')).toBeNull()                   // cold mem tier
		await geomManifestPrefetch('region-A')                 // warms the mem tier from IDB
		expect(geomMemGet('mk1').position[0]).toBe(3)          // now a sync hit
		expect(geomMemGet('mk2').position[0]).toBe(4)
	})
	it('prefetch on an unknown region is a no-op (no throw)', async () => {
		geomMemClear(); await clearGeomCache()
		await geomManifestPrefetch('never-visited')            // must resolve, not throw
		expect(geomMemGet('anything')).toBeNull()
	})

	// WHY: re-recording on every settle edge (engine drops its one-shot guard) means a fresh
	// re-entry whose working set hasn't fully reloaded would otherwise OVERWRITE a larger persisted
	// manifest with its smaller early slice — shrinking warm coverage. The manifest must only grow.
	it('does not shrink an existing manifest when re-recorded with fewer keys', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('shrk1', mkArrays(1)); geomCacheStore('shrk2', mkArrays(2)); geomCacheStore('shrk3', mkArrays(3))
		await __flushGeomWritesNow()
		await geomManifestRecord('region-shrink', ['shrk1', 'shrk2', 'shrk3'])  // 3 keys
		await geomManifestRecord('region-shrink', ['shrk1'])                    // fewer → must NOT overwrite
		geomMemClear()
		await geomManifestPrefetch('region-shrink')
		expect(geomMemGet('shrk1')).not.toBeNull()
		expect(geomMemGet('shrk2')).not.toBeNull()   // still present → manifest was not shrunk
		expect(geomMemGet('shrk3')).not.toBeNull()
	})

	it('grows an existing manifest when re-recorded with more keys', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('grw1', mkArrays(1)); geomCacheStore('grw2', mkArrays(2))
		await __flushGeomWritesNow()
		await geomManifestRecord('region-grow', ['grw1'])          // 1 key
		await geomManifestRecord('region-grow', ['grw1', 'grw2'])  // grew → overwrite with the larger set
		geomMemClear()
		await geomManifestPrefetch('region-grow')
		expect(geomMemGet('grw1')).not.toBeNull()
		expect(geomMemGet('grw2')).not.toBeNull()   // the grown key is now prefetched
	})
})
