# Tier-2 Disk Asset Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist fetched + transcoded server assets to a SQLite disk cache so the expensive grid-fetch + J2C→WebP transcode happens once ever (across clients, visits, and server restarts) instead of on every cold load.

**Architecture:** A new `server/lib/assetDiskCache.ts` module wraps `bun:sqlite` (built into Bun) as a size-bounded LRU blob store + short-TTL negative (404) cache. It slots **inside** the existing in-memory `assetMemo.memo()` work() closure in `server/handlers/assets.ts` as a read-through layer: on a RAM miss, check disk → check negative → only then grid-fetch+transcode → persist to disk. Assets are immutable by UUID, so the key `assetType:uuid` never needs invalidation.

**Tech Stack:** Bun runtime, `bun:sqlite` (built-in, no dependency), TypeScript, bun test.

---

## Context the engineer needs

- **Runtime is Bun.** `import { Database } from 'bun:sqlite'` is built in — no package to add. `bun:sqlite`
  is **synchronous** (better-sqlite3 style): `db.query(sql).get()/all()/run()`, `db.run(sql)`,
  prepared statements via `db.query()`. Blob columns accept/return `Uint8Array`.
- **The existing cache** is `server/lib/assetMemo.ts` — a generic RAM LRU + in-flight coalescer.
  Do NOT change it. The disk cache goes *behind* it.
- **The handler** is `server/handlers/assets.ts` (108 lines). The relevant block is the
  `assetMemo.memo(\`${assetType}:${uuid}\`, async () => { ... })` call (around lines 68–96). The
  work() closure: `fetch(url)` → `if (!res.ok) throw new Error(\`http_${res.status}\`)` → optional
  `decodeInPool(raw)` transcode → returns `{ mime, dataB64, ...(transcode ? { hasAlpha } : {}) }`.
  A 404 throws `Error('http_404')` specifically (line 73). On any throw the outer catch (line 104)
  sends `{ error }` to the client. `null` payloads are NOT cached by the RAM memo.
- **AssetPayload shape** (what the client receives, what we cache): `{ dataB64: string, mime: string,
  hasAlpha?: boolean }`. `dataB64` is base64 of the asset bytes (transcoded WebP for textures, raw
  for mesh/sound/anim). We store **raw bytes** on disk (not base64) and re-encode on read.
- **bun test** is the runner. ESLint is broken repo-wide — do NOT run lint; tests + the server
  starting are the gate.
- **Do NOT commit** — the repo owner commits. Implementers leave changes in the working tree. The
  `git commit` blocks below document the intended message (≤50-char subject) only.
- Server tests live in `server/__tests__/`. Use `os.tmpdir()` + a unique filename for any on-disk
  test DB and clean up in `afterEach`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `server/lib/assetDiskCache.ts` | SQLite-backed Tier-2 store: blob LRU + negative cache (only SQLite touch point) | CREATE |
| `server/__tests__/assetDiskCache.test.ts` | unit tests | CREATE |
| `server/handlers/assets.ts` | wire read-through + 404 negative caching + disk stats in log | MODIFY |
| `.gitignore` | ignore `.cache/` | MODIFY |

---

### Task 1: `assetDiskCache` module — schema, put/get roundtrip (TDD)

**Files:**
- Create: `server/lib/assetDiskCache.ts`
- Test: `server/__tests__/assetDiskCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/assetDiskCache.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import { createAssetDiskCache } from '../lib/assetDiskCache'

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: FAIL — `createAssetDiskCache` is not exported (module/file does not exist).

- [ ] **Step 3: Implement the module (roundtrip slice)**

Create `server/lib/assetDiskCache.ts`:

```ts
// server/lib/assetDiskCache.ts — Tier-2 (disk) asset cache: a size-bounded LRU blob store + short-TTL
// negative (404) cache, backed by bun:sqlite. Sits BEHIND the in-memory assetMemo (server/handlers/
// assets.ts): on a RAM miss we read disk before hitting the grid, and persist successful fetches so
// the grid fetch + J2C→WebP transcode happens once EVER — across clients, visits, and server restarts
// (assetMemo is RAM-only and lost on restart). Assets are immutable by UUID, so key = "assetType:uuid"
// never needs invalidation. Storing raw bytes (not base64) avoids 33% disk bloat; the payload's
// dataB64 is rebuilt on read (cheap vs. the 2–3s grid fetch a disk hit replaces).

import { Database } from 'bun:sqlite'

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

	const qGet     = db.query('SELECT data, mime, hasAlpha FROM assets WHERE key = ?')
	const qTouch   = db.query('UPDATE assets SET accessed = ? WHERE key = ?')
	const qPut     = db.query('INSERT OR REPLACE INTO assets (key, data, mime, hasAlpha, bytes, accessed) VALUES (?, ?, ?, ?, ?, ?)')
	const qOldBytes= db.query('SELECT bytes FROM assets WHERE key = ?')

	function get(key: string): AssetPayload | null {
		const row = qGet.get(key) as { data: Uint8Array; mime: string; hasAlpha: number | null } | null
		if (!row) { misses++; return null }
		hits++
		qTouch.run(now(), key)
		const payload: AssetPayload = { dataB64: Buffer.from(row.data).toString('base64'), mime: row.mime }
		if (row.hasAlpha != null) payload.hasAlpha = !!row.hasAlpha
		return payload
	}

	function put(key: string, payload: AssetPayload): void {
		const data = Buffer.from(payload.dataB64, 'base64')
		const prev = qOldBytes.get(key) as { bytes: number } | null
		if (prev) totalBytes -= prev.bytes
		qPut.run(key, data, payload.mime, payload.hasAlpha == null ? null : (payload.hasAlpha ? 1 : 0), data.length, now())
		totalBytes += data.length
		// eviction added in Task 2
	}

	return {
		get, put,
		isNegative: () => false,     // implemented in Task 3
		putNegative: () => {},       // implemented in Task 3
		stats: () => ({ size: (db.query('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n, bytes: totalBytes, hits, misses, evictions, negSize: 0 }),
		close: () => db.close(),
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: PASS (3 roundtrip tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/assetDiskCache.ts server/__tests__/assetDiskCache.test.ts
git commit -m "feat(srv): disk asset cache store + roundtrip"
```

---

### Task 2: LRU eviction over the byte cap (TDD)

**Files:**
- Modify: `server/lib/assetDiskCache.ts` (the `put` function + a new evict helper)
- Test: `server/__tests__/assetDiskCache.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/assetDiskCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: FAIL — `c.get('a')` is not null (no eviction yet) and `evictions` is 0.

- [ ] **Step 3: Add eviction to `put`**

In `server/lib/assetDiskCache.ts`, add these prepared statements next to the others:

```ts
	const qEvictPick = db.query('SELECT key, bytes FROM assets ORDER BY accessed ASC LIMIT ?')
	const qDelKey    = db.query('DELETE FROM assets WHERE key = ?')
```

Add an `evictIfOver` helper above `put`:

```ts
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
```

Call it at the end of `put` (replace the `// eviction added in Task 2` comment):

```ts
		totalBytes += data.length
		evictIfOver()
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: PASS (roundtrip + both eviction tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/assetDiskCache.ts server/__tests__/assetDiskCache.test.ts
git commit -m "feat(srv): disk cache LRU eviction"
```

---

### Task 3: Negative (404) cache with TTL (TDD)

**Files:**
- Modify: `server/lib/assetDiskCache.ts` (`isNegative` / `putNegative` / `stats.negSize`)
- Test: `server/__tests__/assetDiskCache.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Append to `server/__tests__/assetDiskCache.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: FAIL — `isNegative` always returns false (stub).

- [ ] **Step 3: Implement the negative cache**

In `server/lib/assetDiskCache.ts`, add prepared statements:

```ts
	const qNegGet = db.query('SELECT at FROM negatives WHERE key = ?')
	const qNegPut = db.query('INSERT OR REPLACE INTO negatives (key, at) VALUES (?, ?)')
	const qNegDel = db.query('DELETE FROM negatives WHERE key = ?')
```

Replace the `isNegative` / `putNegative` stubs in the returned object with real implementations
(define them as named functions above the return, mirroring `get`/`put`):

```ts
	function isNegative(key: string): boolean {
		const row = qNegGet.get(key) as { at: number } | null
		if (!row) return false
		if (now() - row.at > opts.negTtlMs) { qNegDel.run(key); return false }   // expired → purge
		return true
	}
	function putNegative(key: string): void { qNegPut.run(key, now()) }
```

And in the returned object use them + a real `negSize`:

```ts
		isNegative, putNegative,
		stats: () => ({
			size: (db.query('SELECT COUNT(*) AS n FROM assets').get() as { n: number }).n,
			bytes: totalBytes, hits, misses, evictions,
			negSize: (db.query('SELECT COUNT(*) AS n FROM negatives').get() as { n: number }).n,
		}),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: PASS (all roundtrip + eviction + negative tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/assetDiskCache.ts server/__tests__/assetDiskCache.test.ts
git commit -m "feat(srv): disk cache negative (404) TTL"
```

---

### Task 4: Persistence across reopen + disabled/corrupt resilience (TDD)

**Files:**
- Modify: `server/lib/assetDiskCache.ts` (add `createAssetDiskCacheFromEnv` factory + null-object + safe-open)
- Test: `server/__tests__/assetDiskCache.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

First, extend the existing top-of-file imports so the new names + `writeFileSync` are available. Change
the import line `import { rmSync } from 'fs'` to `import { rmSync, writeFileSync } from 'fs'`, and the
`import { createAssetDiskCache } from '../lib/assetDiskCache'` line to:

```ts
import { createAssetDiskCache, createDisabledAssetDiskCache, openAssetDiskCacheSafe } from '../lib/assetDiskCache'
```

Then append this describe block to `server/__tests__/assetDiskCache.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: FAIL — `createDisabledAssetDiskCache` / `openAssetDiskCacheSafe` are not exported.

- [ ] **Step 3: Add the disabled no-op + safe-open factory**

In `server/lib/assetDiskCache.ts`, append these exports (the persistence test already passes via the
existing `createAssetDiskCache` — `totalBytes` is seeded from `SUM(bytes)` at open):

```ts
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
```

Add the `rmSync` import at the top of the file:

```ts
import { rmSync } from 'fs'
```

NOTE on the corrupt-file test: `new Database(path)` may not throw until first query. To make
`openAssetDiskCacheSafe` catch corruption deterministically, ensure `createAssetDiskCache` runs a
query during construction — the existing `SELECT COALESCE(SUM(bytes),0)` totalBytes seed already does
this (it executes against the schema right after `CREATE TABLE`). If a corrupt file makes
`CREATE TABLE`/`SELECT` throw, `openAssetDiskCacheSafe` catches it, deletes, and recreates clean.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test server/__tests__/assetDiskCache.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add server/lib/assetDiskCache.ts server/__tests__/assetDiskCache.test.ts
git commit -m "feat(srv): disk cache persistence + safe open"
```

---

### Task 5: Wire the read-through into the asset handler

**Files:**
- Modify: `server/handlers/assets.ts` (construct cache from env; read-through in work(); negative on 404; disk stats in log)
- Modify: `.gitignore` (ignore `.cache/`)

- [ ] **Step 1: Add `.cache/` to `.gitignore`**

In `.gitignore`, under the "Logs + diagnostic dumps" section (or near it), add:

```
# Server disk asset cache (Tier-2)
.cache/
```

- [ ] **Step 2: Construct the disk cache from env in `assets.ts`**

In `server/handlers/assets.ts`, add the import near the existing `import { createAssetMemo } from '../lib/assetMemo'`:

```ts
import { openAssetDiskCacheSafe, createDisabledAssetDiskCache, type AssetDiskCache } from '../lib/assetDiskCache'
```

Below the existing `assetMemo` construction (after line 16), add:

```ts
// Tier-2 DISK cache (survives restart; shared across clients). Env-tunable; disabled → no-op.
// Defaults: .cache/assets.sqlite, 8 GB cap, 6 h negative-TTL. The grid fetch + WebP transcode then
// happens once EVER for an immutable-by-UUID asset, instead of every cold load / restart.
const ASSET_DISK_CACHE_ON    = process.env.ASSET_DISK_CACHE !== '0'
const ASSET_DISK_CACHE_PATH  = process.env.ASSET_DISK_CACHE_PATH  || '.cache/assets.sqlite'
const ASSET_DISK_CACHE_BYTES = Number(process.env.ASSET_DISK_CACHE_BYTES) || 8 * 1024 * 1024 * 1024
const ASSET_DISK_NEG_TTL_MS  = Number(process.env.ASSET_DISK_NEG_TTL_MS) || 6 * 3600 * 1000
const assetDisk: AssetDiskCache = ASSET_DISK_CACHE_ON
	? openAssetDiskCacheSafe({ path: ASSET_DISK_CACHE_PATH, capBytes: ASSET_DISK_CACHE_BYTES, negTtlMs: ASSET_DISK_NEG_TTL_MS })
	: createDisabledAssetDiskCache()
let _diskHits = 0, _diskMiss = 0   // handler-level counters for the [AssetMemo] log line
```

NOTE: `.cache/` may not exist on first run. Before opening, ensure the directory exists. Add at the
top imports `import { mkdirSync } from 'fs'` and `import { dirname } from 'path'`, and just before the
`openAssetDiskCacheSafe` call wrap the dir creation:

```ts
try { mkdirSync(dirname(ASSET_DISK_CACHE_PATH), { recursive: true }) } catch { /* ignore */ }
```

(Place the `mkdirSync` line above the `const assetDisk = ...` line so the directory exists when the DB
opens. Keep it guarded — a failure here must not crash startup; `openAssetDiskCacheSafe` will then
fall back to a no-op if the open fails.)

- [ ] **Step 3: Implement the read-through inside the memo work() closure**

In `server/handlers/assets.ts`, replace the body of the `assetMemo.memo(...)` work() closure so it
checks disk + negative before fetching, and persists after. The existing closure (lines ~68–96)
becomes:

```ts
		const payload = await assetMemo.memo(`${assetType}:${uuid}`, async () => {
			const key = `${assetType}:${uuid}`
			// Tier-2: a previously fetched+transcoded asset answers from disk — no grid fetch, no decode.
			const cached = assetDisk.get(key)
			if (cached) { _diskHits++; return cached }
			_diskMiss++
			// A recently-confirmed 404 short-circuits without re-spending a 2–3s grid fetch + pool slot.
			if (assetDisk.isNegative(key)) throw new Error('http_404')

			const tFetch0 = performance.now()
			const res = await fetch(url, { headers: { Accept: spec.accept }, signal: AbortSignal.timeout(25_000) })
			// WHY: OpenSim returns 404 (not 416) when a speculative range overshoots; here we make no
			// range request, so a 404 is a genuine missing asset → remember it (TTL'd). Other failures
			// (timeout / 5xx) are transient and must NOT be negative-cached.
			if (!res.ok) {
				if (res.status === 404) assetDisk.putNegative(key)
				throw new Error(`http_${res.status}`)
			}
			const raw = Buffer.from(await res.arrayBuffer())
			const fetchMs = Math.round(performance.now() - tFetch0)

			let out: Buffer, hasAlpha = false, dims = '', decodeMs = 0
			if (spec.transcode) {
				const tDec0 = performance.now()
				const r = await decodeInPool(raw); out = r.image; hasAlpha = r.hasAlpha
				decodeMs = Math.round(performance.now() - tDec0)
				dims = ` ${r.srcWidth}×${r.srcHeight}→${r.width}×${r.height}`
			}
			else out = raw
			if (++_assetLogN <= 10 || _assetLogN % 25 === 0) {
				const ps = getPoolStats()
				slog.info(s.ws, `[Asset] #${_assetLogN} ${assetType} ${uuid.slice(0, 8)}… via ${capName} (${raw.length}B${spec.transcode ? ` → ${out.length}B webp${dims}` : ''}) fetch=${fetchMs}ms decode=${decodeMs}ms | pool w=${ps.workers} degraded=${ps.degraded} inflight=${ps.inflight}`)
			}
			const result = {
				mime: spec.transcode ? spec.mime : (res.headers.get('content-type') || spec.mime),
				dataB64: out.toString('base64'),
				...(spec.transcode ? { hasAlpha } : {}),
			}
			assetDisk.put(key, result)   // persist for every later client / visit / restart
			return result
		})
```

(Every `assetDisk.*` call is internally try/safe at the module level via `openAssetDiskCacheSafe`'s
no-op fallback; an individual prepared-statement throw is not expected, but if hardening is wanted the
module's get/put can be wrapped — keep that out of scope unless a test shows a need.)

- [ ] **Step 4: Add disk stats to the periodic `[AssetMemo]` log line**

In `server/handlers/assets.ts`, extend the existing stats log (around line 100–102):

```ts
			if ((++_memoStatTick % 200) === 0) {
				const m = assetMemo.stats(), d = assetDisk.stats()
				slog.info(s.ws, `[AssetMemo] size=${m.size} MB=${(m.bytes / 1048576).toFixed(0)} hits=${m.hits} misses=${m.misses} evict=${m.evictions} inflight=${m.inflight} | disk hits=${_diskHits} miss=${_diskMiss} MB=${(d.bytes / 1048576).toFixed(0)} size=${d.size} evict=${d.evictions} neg=${d.negSize}`)
			}
```

- [ ] **Step 5: Verify the server starts (enabled + disabled) and the suite is green**

Run (start with cache on, then off; each should boot and pass the UDP self-test, then Ctrl-C):
```bash
bun run server/index.ts   # expect: "quickerSTORM server listening on http://localhost:8787" + udp-self-test PASS
ASSET_DISK_CACHE=0 bun run server/index.ts   # same, with the cache disabled
```
Then the full server suite:
```bash
bun test server/
```
Expected: server boots both ways (no crash, `.cache/assets.sqlite` created when enabled); `bun test server/` at baseline — the new `assetDiskCache.test.ts` passes, nothing else regresses.

NOTE: if port 8787 is already in use by the live dev server during this check, run the boot test on a
throwaway port via `PORT=8788 bun run server/index.ts` if the server honors `PORT`, or just rely on
`bun test server/` + a syntax check (`bun build server/index.ts --target=bun > /dev/null`) and let the
controller live-verify the running server separately.

- [ ] **Step 6: Commit**

```bash
git add server/handlers/assets.ts .gitignore
git commit -m "feat(srv): wire Tier-2 disk cache read-through"
```

---

### Task 6: Final verification + docs

**Files:**
- Modify: `docs/FEATURE-GAPS.md` (mark cold-pipeline #1 implemented, NEEDS live-verify)

- [ ] **Step 1: Full server suite + syntax build**

Run:
```bash
bun test server/
bun build server/index.ts --target=bun > /dev/null && echo "server bundles OK"
```
Expected: suite at baseline (new tests pass, no new failures); server bundles with no errors.

- [ ] **Step 2: Update FEATURE-GAPS cold-pipeline #1**

In `docs/FEATURE-GAPS.md`, on the cold-asset-pipeline list item **1** (Server-side persistent disk
asset cache), append:

```markdown
   **→ IMPLEMENTED 2026-06-17 (NEEDS LIVE-VERIFY):** `server/lib/assetDiskCache.ts` (bun:sqlite blob
   LRU + short-TTL negative cache) wired read-through behind `assetMemo` in `server/handlers/assets.ts`
   (disk get → negative check → grid fetch+transcode → disk put / putNegative-on-404). Env:
   `ASSET_DISK_CACHE`(=0 to disable), `ASSET_DISK_CACHE_PATH` (.cache/assets.sqlite), `ASSET_DISK_CACHE_BYTES`
   (8GB), `ASSET_DISK_NEG_TTL_MS` (6h). `[AssetMemo]` log now carries disk hits/miss/MB/evict/neg.
   Spec/plan under docs/superpowers/. LIVE-VERIFY: cold-load a region (disk miss climbs, .cache grows),
   RESTART server, revisit same region → disk hits dominate, grid [Asset] lines drop, load time collapses.
```

- [ ] **Step 3: Commit**

```bash
git add docs/FEATURE-GAPS.md
git commit -m "docs: Tier-2 disk asset cache landed"
```

- [ ] **Step 4: Hand off for live-verify**

Report: implemented + unit-tested + server boots (enabled & disabled). NEEDS live-verify — the
controller (who owns the running server) should: cold-load a fresh region (watch `[AssetMemo] disk
miss=` climb + `.cache/assets.sqlite` grow), **restart the server**, revisit the SAME region, and
confirm `disk hits=` now dominates, `[Asset]` grid lines drop sharply, and the load is dramatically
faster than the ~13 min cold baseline. Gene commits (he commits).

---

## Notes for the implementer

- **Line numbers are approximate** — anchor on the quoted surrounding code.
- **`bun:sqlite` is synchronous** — no `await` on cache ops. Don't introduce async there.
- **Do NOT commit** (the repo owner commits). The `git commit` blocks document intended ≤50-char
  subjects only; if running interactively, propose them and let Gene run them.
- **The disk cache is a pure optimization** — never let it crash the server. `openAssetDiskCacheSafe`
  is the guard; do not bypass it in the handler.
- **No cache-version bump** — server-side disk store, immutable-by-UUID keys, independent of the
  client GEOM/DB versions.
