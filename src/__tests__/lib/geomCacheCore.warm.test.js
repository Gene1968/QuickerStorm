// src/__tests__/lib/geomCacheCore.warm.test.js
// Approach A keystone: geomCacheGetMany must serve the in-memory tier (_mem) BEFORE IndexedDB, so a
// warm working set (prefetch / promotion) is returned from RAM and the starvation-prone IDB read is
// only used for genuine mem misses. Tests hit the core module directly to bypass the client L1.
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import {
	geomCacheStore, geomCacheGetMany, geomMemClear, geomMemGet,
	clearGeomCache, __flushGeomWritesNow, setGeomCapBytes,
	geomManifestRecord, geomManifestPrefetch,
} from '@/lib/geomCacheCore.js'

const mkArrays = (fill = 1, verts = 12) => ({
	position: new Float32Array(verts * 3).fill(fill),
	normal:   new Float32Array(verts * 3).fill(fill),
	uv:       new Float32Array(verts * 2).fill(fill),
	index:    new Uint32Array(verts).fill(fill),
	groups:   [{ start: 0, count: verts, materialIndex: 0 }],
})

describe('geomCacheGetMany serves the mem tier before IDB (Approach A keystone)', () => {
	it('returns a mem-tier entry that was NEVER flushed to IDB', async () => {
		geomMemClear(); await clearGeomCache(); setGeomCapBytes(1024 ** 3)
		geomCacheStore('warm1', mkArrays(7))     // populates _mem AND the write buffer — but we do NOT flush
		// IDB has no 'warm1' yet. Before the fix this MISSES (empty Map); after the fix it hits from _mem.
		const m = await geomCacheGetMany(['warm1'])
		expect(m.has('warm1')).toBe(true)
		expect(m.get('warm1').position[0]).toBe(7)
	})

	it('mem hit does not alias the cached entry (clone-on-hand-out invariant)', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('warm2', mkArrays(4))
		const m = await geomCacheGetMany(['warm2'])
		m.get('warm2').position[0] = 999
		expect(geomMemGet('warm2').position[0]).toBe(4)   // entry unharmed
	})

	it('mixed batch: one mem hit + one IDB-only hit both returned', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('idbOnly', mkArrays(5))
		await __flushGeomWritesNow()      // 'idbOnly' is now in IDB
		geomMemClear()                    // drop it from _mem → it must come from IDB
		geomCacheStore('memOnly', mkArrays(8))   // in _mem only (unflushed)
		const m = await geomCacheGetMany(['memOnly', 'idbOnly'])
		expect(m.get('memOnly').position[0]).toBe(8)   // from mem
		expect(m.get('idbOnly').position[0]).toBe(5)   // from IDB
	})
})

describe('geomManifestPrefetch reports how many keys it warmed', () => {
	it('returns the warmed key count for a known region', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('wm1', mkArrays(1)); geomCacheStore('wm2', mkArrays(2))
		await __flushGeomWritesNow()
		await geomManifestRecord('warm-region', ['wm1', 'wm2'])
		geomMemClear()
		const n = await geomManifestPrefetch('warm-region')
		expect(n).toBe(2)
	})
	it('returns 0 for an unknown (cold) region', async () => {
		geomMemClear(); await clearGeomCache()
		const n = await geomManifestPrefetch('never-seen')
		expect(n).toBe(0)
	})
})
