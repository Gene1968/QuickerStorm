// server/lib/assetDiskCache.ts — Tier-2 (disk) asset cache: a size-bounded LRU blob store + short-TTL
// negative (404) cache, backed by bun:sqlite. Sits BEHIND the in-memory assetMemo (server/handlers/
// assets.ts): on a RAM miss we read disk before hitting the grid, and persist successful fetches so
// the grid fetch + J2C→WebP transcode happens once EVER — across clients, visits, and server restarts
// (assetMemo is RAM-only and lost on restart). Assets are immutable by UUID, so key = "assetType:uuid"
// never needs invalidation. Storing raw bytes (not base64) avoids 33% disk bloat; the payload's
// dataB64 is rebuilt on read (cheap vs. the 2–3s grid fetch a disk hit replaces).

import { Database } from 'bun:sqlite'
import { rmSync } from 'fs'

export interface AssetPayload { dataB64: string; mime: string; hasAlpha?: boolean }

export interface AssetDiskCacheOpts {
	path: string
	capBytes: number
	negTtlMs: number
	now?: () => number   // injectable clock for tests
}

export interface AssetDiskCache {
	get(key: string): AssetPayload | null
	put(key: string, payload: AssetPayload): void
	isNegative(key: string): boolean
	putNegative(key: string): void
	stats(): { size: number; bytes: number; hits: number; misses: number; evictions: number; negSize: number }
	close(): void
}

export function createAssetDiskCache(opts: AssetDiskCacheOpts): AssetDiskCache {
	const now = opts.now ?? Date.now
	const db = new Database(opts.path, { create: true })
	db.run('PRAGMA journal_mode = WAL')
	db.run('PRAGMA synchronous = NORMAL')
	db.run(`CREATE TABLE IF NOT EXISTS assets (
		key TEXT PRIMARY KEY, data BLOB NOT NULL, mime TEXT NOT NULL,
		hasAlpha INTEGER, bytes INTEGER NOT NULL, accessed INTEGER NOT NULL)`)
	db.run('CREATE INDEX IF NOT EXISTS idx_assets_accessed ON assets(accessed)')
	db.run('CREATE TABLE IF NOT EXISTS negatives (key TEXT PRIMARY KEY, at INTEGER NOT NULL)')

	let totalBytes = (db.query('SELECT COALESCE(SUM(bytes),0) AS b FROM assets').get() as { b: number }).b
	let hits = 0, misses = 0, evictions = 0
	let errLogged = 0

	// The cache is a pure optimization — a runtime failure (disk full, locked/corrupt DB) must NEVER
	// break asset serving. Every public method swallows its own errors (read → miss, write → drop) and
	// logs rate-limited so a degraded cache is still visible. Open failures are handled separately by
	// openAssetDiskCacheSafe; this guards per-op throws on an already-open DB.
	function onErr(op: string, e: unknown): void {
		if (errLogged < 3 || errLogged % 100 === 0) {
			console.warn(`[AssetDiskCache] ${op} failed (cache degraded, serving continues): ${(e as Error)?.message ?? e}`)
		}
		errLogged++
	}

	const qGet      = db.query('SELECT data, mime, hasAlpha FROM assets WHERE key = ?')
	const qTouch    = db.query('UPDATE assets SET accessed = ? WHERE key = ?')
	const qPut      = db.query('INSERT OR REPLACE INTO assets (key, data, mime, hasAlpha, bytes, accessed) VALUES (?, ?, ?, ?, ?, ?)')
	const qOldBytes = db.query('SELECT bytes FROM assets WHERE key = ?')
	const qEvictPick = db.query('SELECT key, bytes FROM assets ORDER BY accessed ASC LIMIT ?')
	const qDelKey   = db.query('DELETE FROM assets WHERE key = ?')
	const qNegGet   = db.query('SELECT at FROM negatives WHERE key = ?')
	const qNegPut   = db.query('INSERT OR REPLACE INTO negatives (key, at) VALUES (?, ?)')
	const qNegDel   = db.query('DELETE FROM negatives WHERE key = ?')

	function get(key: string): AssetPayload | null {
		try {
			const row = qGet.get(key) as { data: Uint8Array; mime: string; hasAlpha: number | null } | null
			if (!row) { misses++; return null }
			hits++
			qTouch.run(now(), key)
			const payload: AssetPayload = { dataB64: Buffer.from(row.data).toString('base64'), mime: row.mime }
			if (row.hasAlpha != null) payload.hasAlpha = !!row.hasAlpha
			return payload
		} catch (e) { onErr('get', e); return null }   // read failure → treat as a miss (fall through to grid)
	}

	function evictIfOver(): void {
		// Delete oldest-accessed rows (LRU) in small batches until back under the cap. Batching keeps
		// each DELETE bounded; the accessed index makes the ORDER BY cheap.
		while (totalBytes > opts.capBytes) {
			const victims = qEvictPick.all(16) as { key: string; bytes: number }[]
			if (victims.length === 0) break
			for (const v of victims) {
				qDelKey.run(v.key)
				totalBytes -= v.bytes
				evictions++
				if (totalBytes <= opts.capBytes) break
			}
		}
	}

	function put(key: string, payload: AssetPayload): void {
		try {
			const data = Buffer.from(payload.dataB64, 'base64')
			const prev = qOldBytes.get(key) as { bytes: number } | null
			if (prev) totalBytes -= prev.bytes
			qPut.run(key, data, payload.mime, payload.hasAlpha == null ? null : (payload.hasAlpha ? 1 : 0), data.length, now())
			totalBytes += data.length
			evictIfOver()
		} catch (e) { onErr('put', e) }   // write failure → drop silently; the asset was already served
	}

	function isNegative(key: string): boolean {
		try {
			const row = qNegGet.get(key) as { at: number } | null
			if (!row) return false
			if (now() - row.at > opts.negTtlMs) { qNegDel.run(key); return false }   // expired → purge
			return true
		} catch (e) { onErr('isNegative', e); return false }   // failure → not-negative (attempt fetch is safe)
	}

	function putNegative(key: string): void {
		try { qNegPut.run(key, now()) } catch (e) { onErr('putNegative', e) }
	}

	return {
		get, put,
		isNegative, putNegative,
		stats: () => {
			try {
				return {
					size: (db.query('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n,
					bytes: totalBytes, hits, misses, evictions,
					negSize: (db.query('SELECT COUNT(*) AS n FROM negatives').get() as { n: number }).n,
				}
			} catch (e) { onErr('stats', e); return { size: 0, bytes: totalBytes, hits, misses, evictions, negSize: 0 } }
		},
		close: () => { try { db.close() } catch { /* already closed */ } },
	}
}

/** A no-op cache: every read misses, every write is dropped. Used when disabled or after open fails. */
export function createDisabledAssetDiskCache(): AssetDiskCache {
	return {
		get: () => null,
		put: () => {},
		isNegative: () => false,
		putNegative: () => {},
		stats: () => ({ size: 0, bytes: 0, hits: 0, misses: 0, evictions: 0, negSize: 0 }),
		close: () => {},
	}
}

/**
 * Open a disk cache that can never crash the server. On any open/schema error, delete the file and
 * retry once; if that also fails, fall back to a disabled no-op. The cache is a pure optimization.
 */
export function openAssetDiskCacheSafe(opts: AssetDiskCacheOpts): AssetDiskCache {
	try {
		return createAssetDiskCache(opts)
	} catch {
		try { for (const f of [opts.path, `${opts.path}-wal`, `${opts.path}-shm`]) { try { rmSync(f) } catch { /* ignore */ } } } catch { /* ignore */ }
		try { return createAssetDiskCache(opts) } catch { return createDisabledAssetDiskCache() }
	}
}
