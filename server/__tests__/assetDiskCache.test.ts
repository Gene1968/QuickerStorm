import { describe, it, expect, afterEach } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, writeFileSync } from 'fs'
import { createAssetDiskCache, createDisabledAssetDiskCache, openAssetDiskCacheSafe } from '../lib/assetDiskCache'

const paths: string[] = []
function tmpPath() {
	const p = join(tmpdir(), `qs-adc-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`)
	paths.push(p)
	return p
}
afterEach(() => {
	for (const p of paths.splice(0)) {
		for (const f of [p, `${p}-wal`, `${p}-shm`]) { try { rmSync(f) } catch { /* ignore */ } }
	}
})

describe('assetDiskCache — roundtrip', () => {
	it('stores and returns a texture payload exactly (incl. hasAlpha)', () => {
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 1 << 20, negTtlMs: 1000 })
		const payload = { dataB64: Buffer.from([1, 2, 3, 4, 5]).toString('base64'), mime: 'image/webp', hasAlpha: true }
		c.put('texture:abc', payload)
		expect(c.get('texture:abc')).toEqual(payload)
		c.close()
	})

	it('stores a mesh payload with no hasAlpha field', () => {
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 1 << 20, negTtlMs: 1000 })
		const payload = { dataB64: Buffer.from([9, 8, 7]).toString('base64'), mime: 'application/vnd.ll.mesh' }
		c.put('mesh:xyz', payload)
		expect(c.get('mesh:xyz')).toEqual(payload)   // no hasAlpha key
		c.close()
	})

	it('returns null for a missing key', () => {
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 1 << 20, negTtlMs: 1000 })
		expect(c.get('texture:nope')).toBeNull()
		c.close()
	})
})

describe('assetDiskCache — LRU eviction', () => {
	const mk = (n: number) => ({ dataB64: Buffer.alloc(n, 7).toString('base64'), mime: 'image/webp', hasAlpha: false })

	it('evicts oldest-accessed entries when over the byte cap', () => {
		let t = 1000
		const clock = () => t++
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 250, negTtlMs: 1000, now: clock })
		c.put('a', mk(100))   // total 100
		c.put('b', mk(100))   // total 200
		c.put('c', mk(100))   // total 300 > 250 → evict oldest ('a')
		expect(c.get('a')).toBeNull()
		expect(c.get('b')).not.toBeNull()
		expect(c.get('c')).not.toBeNull()
		expect(c.stats().bytes).toBeLessThanOrEqual(250)
		expect(c.stats().evictions).toBeGreaterThan(0)
		c.close()
	})

	it('a recent get protects an entry from the next eviction', () => {
		let t = 1000
		const clock = () => t++
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 250, negTtlMs: 1000, now: clock })
		c.put('a', mk(100))
		c.put('b', mk(100))
		c.get('a')            // bump 'a' recency → now 'b' is oldest
		c.put('c', mk(100))   // over cap → evict oldest ('b'), not 'a'
		expect(c.get('a')).not.toBeNull()
		expect(c.get('b')).toBeNull()
		c.close()
	})
})

describe('assetDiskCache — negative cache', () => {
	it('remembers a 404 then forgets it after the TTL', () => {
		let t = 1000
		const clock = () => t
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 1 << 20, negTtlMs: 500, now: clock })
		c.putNegative('texture:gone')
		expect(c.isNegative('texture:gone')).toBe(true)
		t += 499
		expect(c.isNegative('texture:gone')).toBe(true)    // still within TTL
		t += 2
		expect(c.isNegative('texture:gone')).toBe(false)   // expired (501ms > 500)
		expect(c.isNegative('texture:never')).toBe(false)  // unknown key
		c.close()
	})
})

describe('assetDiskCache — persistence + resilience', () => {
	it('survives close + reopen at the same path', () => {
		const p = tmpPath()
		const c1 = createAssetDiskCache({ path: p, capBytes: 1 << 20, negTtlMs: 1000 })
		c1.put('texture:keep', { dataB64: Buffer.from([4, 2]).toString('base64'), mime: 'image/webp', hasAlpha: false })
		c1.close()
		const c2 = createAssetDiskCache({ path: p, capBytes: 1 << 20, negTtlMs: 1000 })
		expect(c2.get('texture:keep')).not.toBeNull()
		expect(c2.stats().bytes).toBe(2)   // totalBytes re-seeded from SUM at open
		c2.close()
	})

	it('disabled cache is a safe no-op', () => {
		const c = createDisabledAssetDiskCache()
		expect(() => c.put('x', { dataB64: 'AA==', mime: 'image/webp' })).not.toThrow()
		expect(c.get('x')).toBeNull()
		expect(c.isNegative('x')).toBe(false)
		expect(c.stats().bytes).toBe(0)
		c.close()
	})

	it('openAssetDiskCacheSafe recovers from a corrupt db file', () => {
		const p = tmpPath()
		writeFileSync(p, 'this is not a sqlite database')
		const c = openAssetDiskCacheSafe({ path: p, capBytes: 1 << 20, negTtlMs: 1000 })
		// must not throw; must be usable (either recreated real cache or disabled no-op)
		expect(() => c.put('texture:ok', { dataB64: 'AQID', mime: 'image/webp', hasAlpha: false })).not.toThrow()
		c.close()
	})

	it('a runtime DB failure degrades silently (never breaks serving)', () => {
		// Simulate a runtime failure mid-session by closing the underlying DB, then exercising every
		// public op. None may throw — reads must miss, writes drop, so asset serving continues uncached.
		const c = createAssetDiskCache({ path: tmpPath(), capBytes: 1 << 20, negTtlMs: 1000 })
		c.put('texture:a', { dataB64: 'AQID', mime: 'image/webp', hasAlpha: false })
		c.close()   // every subsequent prepared-statement call now throws internally
		expect(() => c.put('texture:b', { dataB64: 'BAUG', mime: 'image/webp', hasAlpha: true })).not.toThrow()
		expect(c.get('texture:a')).toBeNull()        // read failure → miss
		expect(c.isNegative('texture:a')).toBe(false) // failure → not-negative (safe to attempt fetch)
		expect(() => c.putNegative('texture:a')).not.toThrow()
		expect(() => c.stats()).not.toThrow()
	})
})
