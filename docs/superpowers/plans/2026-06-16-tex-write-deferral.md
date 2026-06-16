# qs-tex Write-Deferral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `texCachePut` from opening a `readwrite` IDB txn per call (which serializes the `readonly` `texCacheGet` reads behind it, causing ~7.4s reads) by buffering puts and flushing the whole buffer in one txn per window — a faithful port of the committed `geomCache.js` write-deferral (#10) to `textureCache.js`.

**Architecture:** In-memory `_writeBuf` (coalesce, latest-wins) + batched `_flushNow` (one txn, count+evict once) + `setTexCacheLoading()` gate (suspend flushes during the fill burst) + `_readsInFlight` read-priority gate + `texCacheGet` reads `_writeBuf` first. No `DB_VERSION` bump (record shape unchanged → no cache wipe).

**Tech Stack:** IndexedDB, `bun test` + `fake-indexeddb` (the lib tests run under bun, NOT vitest), Vite build.

**Reference:** spec `docs/superpowers/specs/2026-06-16-tex-write-deferral-design.md`; mirror `src/lib/geomCache.js` (the proven pattern — read lines ~150–390 for the original).

**Style:** TABS not spaces (.editorconfig). `src/lib/textureCache.js` and its test use **tabs**.

---

## File Structure
- **Modify** `src/lib/textureCache.js` — add write-deferral state + machinery; refactor `texCachePut` (buffer), `texCacheGet` (buffer-check + read gate), `clearTextureCache` (clear buffer); new exports `setTexCacheLoading`, `getTextureWriteBufStats`, `setTexDeferLimits`, `__flushTexWritesNow`; pagehide flush.
- **Modify** `src/__tests__/lib/textureCache.test.js` — add a `describe('write-deferral')` block (bun:test).
- **Modify** `src/composables/useWorldEngine.js` — import + call `setTexCacheLoading(loading)` beside `setGeomCacheLoading` (line ~3426); add tex write-buf to `[Drain]`.

---

## Task 1: Failing tests for the write-deferral (TDD)

**Files:**
- Test: `src/__tests__/lib/textureCache.test.js`

- [ ] **Step 1: Add the new test block**

Append this `describe` block to `src/__tests__/lib/textureCache.test.js` and add the new symbols to the existing top `import` from `@/lib/textureCache.js` (`setTexCacheLoading, getTextureWriteBufStats, setTexDeferLimits, __flushTexWritesNow`):

```js
import { setTexCacheLoading, getTextureWriteBufStats, setTexDeferLimits, __flushTexWritesNow } from '@/lib/textureCache.js'

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
```

- [ ] **Step 2: Run the tests to confirm they FAIL**

Run: `bun test src/__tests__/lib/textureCache.test.js`
Expected: FAIL — the new exports (`setTexCacheLoading`, `getTextureWriteBufStats`, `setTexDeferLimits`, `__flushTexWritesNow`) don't exist yet.

---

## Task 2: Implement the write-deferral in `textureCache.js`

**Files:**
- Modify: `src/lib/textureCache.js`

- [ ] **Step 1: Add write-deferral state + control exports**

Insert the following block immediately AFTER the `_lastStats` declaration block (after the comment ending `// (quiet DB — the case the read can't starve).`, currently ~line 57) and BEFORE `function openDb()`:

```js
// ── Write-deferral (warm-read decouple — port of geomCache #10 to qs-tex) ──────────────────────────
// WHY: texCachePut used to open a readwrite [STORE,META] txn PER call (put + stats-get + count, plus an
// eviction cursor-walk when over cap). A region fill is ~1-2k such write txns; because they share the
// STORE scope with the readonly texCacheGet reads, IndexedDB SERIALIZES every read behind the write
// convoy → reads measured ~7.4s (network slots wedged, queue climbing). Buffer puts in memory and flush
// the whole buffer in ONE txn per window so reads interleave; suspend flushes during the load burst;
// defer a flush while a read is in flight. Direct port of the committed geomCache deferral.
const _writeBuf = new Map()      // uuid → { uuid, blob, bytes, hasAlpha, lastUsed }  (latest-wins)
let _writeBufBytes = 0           // running sum of buffered blob bytes (byte ceiling, O(1))
let _writeBufDropped = 0         // puts skipped at the hard cap (telemetry — no silent caps)
let _readsInFlight = 0           // in-flight texCacheGet count; _flushNow defers while > 0 (read-priority)
let _loading = false             // engine load-burst signal (suspend flushes); see setTexCacheLoading
let _deferStartedAt = 0          // wall-clock of first deferred write since last flush (time ceiling)
let _exitTimer = null            // trailing debounce so brief load dips don't thrash flush mode
let _flushTimer = null
let _flushing = null
const FLUSH_MS = 300
const FLUSH_MAX = 256            // texture records are small WebP blobs → batch more than geom (200)
const LOADING_EXIT_DEBOUNCE_MS = 750
let _ceilingBytes = 64 * 1024 * 1024     // force a flush past this much buffered (textures are small)
let _maxDeferMs = 30000                  // never defer a flush longer than this
let _writeBufHardCap = 128 * 1024 * 1024 // past this, stop buffering NEW uuids (overwrites still proceed)
let _lastForcedLogAt = 0
function _logForcedFlush(reason) {
	const t = Date.now()
	if (t - _lastForcedLogAt < 1000) return
	_lastForcedLogAt = t
	console.debug('[TexCache] deferred flush forced:', reason, Math.round(_writeBufBytes / 1048576) + 'MB buffered')
}

/** Engine signal: true during a region-load burst (suspend flushes), false when the build settles. */
export function setTexCacheLoading(v) {
	if (v) {
		if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null }
		_loading = true
	} else if (_loading && !_exitTimer) {
		_exitTimer = setTimeout(() => {
			_exitTimer = null; _loading = false; _deferStartedAt = 0; _flushNow(true)
		}, LOADING_EXIT_DEBOUNCE_MS)
	}
}

/** Write-buffer telemetry: { bytes, dropped } — surfaced on the engine [Drain] line. */
export function getTextureWriteBufStats() { return { bytes: _writeBufBytes, dropped: _writeBufDropped } }

/** Test/governor hook: tune the deferral safety ceilings. */
export function setTexDeferLimits({ ceilingBytes, maxDeferMs, hardCapBytes } = {}) {
	if (typeof ceilingBytes === 'number') _ceilingBytes = ceilingBytes
	if (typeof maxDeferMs === 'number') _maxDeferMs = maxDeferMs
	if (typeof hardCapBytes === 'number') _writeBufHardCap = hardCapBytes
}

/** Test hook: force the write buffer to disk now (bypasses the loading + read-priority gates). */
export async function __flushTexWritesNow() { await _flushNow(true) }
```

- [ ] **Step 2: Add the flush machinery**

Insert the following block immediately AFTER the new control exports from Step 1 (still before `function openDb()`). This is ported from `geomCache.js` (`_scheduleFlush`/`_checkDeferCeilings`/`_flushNow`), adapted to the tex record shape (`{uuid, blob, bytes, hasAlpha, lastUsed}`):

```js
function _scheduleFlush() {
	if (_loading) {
		if (!_deferStartedAt) _deferStartedAt = Date.now()
		if (_writeBufBytes >= _ceilingBytes) { _logForcedFlush('byte-ceiling'); _deferStartedAt = 0; _flushNow(true); return }
		if (!_flushTimer) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
		return
	}
	if (_writeBuf.size >= FLUSH_MAX) { _flushNow(); return }
	if (_flushTimer) return
	_flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
}

function _checkDeferCeilings() {
	_flushTimer = null
	if (!_loading) { _flushNow(); return }
	const overBytes = _writeBufBytes >= _ceilingBytes
	const overTime = _deferStartedAt && (Date.now() - _deferStartedAt) >= _maxDeferMs
	if (overBytes || overTime) { _logForcedFlush(overBytes ? 'byte-ceiling' : 'time-ceiling'); _deferStartedAt = 0; _flushNow(true); return }
	if (_writeBuf.size) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
}

async function _flushNow(force = false) {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	// While loading, only forced flushes (ceilings / settle-exit / pagehide) proceed.
	if (!force && _loading) {
		if (!_flushTimer) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
		return
	}
	// Read-priority: defer the readwrite flush while a texCacheGet is in flight so reads aren't starved.
	if (!force && _readsInFlight > 0 && _writeBuf.size < FLUSH_MAX) {
		if (!_flushTimer) _flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
		return
	}
	if (_flushing) await _flushing
	if (!_writeBuf.size) return
	const batch = [..._writeBuf.values()]
	_writeBuf.clear()
	_writeBufBytes = 0
	_deferStartedAt = 0
	_flushing = (async () => {
		try {
			const db = await openDb()
			await new Promise((resolve, reject) => {
				const tx = db.transaction([STORE, META], 'readwrite')
				const st = tx.objectStore(STORE)
				const mt = tx.objectStore(META)
				const batchKeys = new Set(batch.map(b => b.uuid))
				let added = 0
				let pending = batch.length
				let statsResult = null
				const finishStats = (total) => {
					const cReq = st.count()
					cReq.onsuccess = () => {
						mt.put({ k: 'stats', totalBytes: total, count: cReq.result })
						statsResult = { count: cReq.result, bytes: total }
					}
				}
				const afterAllKeys = () => {
					const mreq = mt.get('stats')
					mreq.onsuccess = () => {
						let total = (mreq.result?.totalBytes ?? 0) + added
						if (total <= _capBytes) { finishStats(total); return }
						// Over cap → lastUsed cursor oldest-first; never evict a uuid just written this batch.
						const cur = st.index('lastUsed').openCursor()
						cur.onsuccess = () => {
							const c = cur.result
							if (!c || total <= _capBytes) { finishStats(total); return }
							if (!batchKeys.has(c.value.uuid)) { total -= c.value.bytes; c.delete() }
							c.continue()
						}
					}
				}
				for (const rec of batch) {
					// getKey-before-put: textures are immutable by UUID, so a duplicate uuid = identical
					// content. Always put (refreshes lastUsed); only count bytes for genuinely NEW uuids so
					// totalBytes can't drift upward on re-persist and trigger spurious evictions.
					const gkReq = st.getKey(rec.uuid)
					gkReq.onsuccess = () => {
						st.put({ uuid: rec.uuid, blob: rec.blob, bytes: rec.bytes, hasAlpha: rec.hasAlpha, lastUsed: rec.lastUsed })
						if (gkReq.result === undefined) added += rec.bytes
						if (--pending === 0) afterAllKeys()
					}
				}
				tx.oncomplete = () => { if (statsResult) _lastStats = statsResult; resolve() }
				tx.onerror = () => reject(tx.error ?? new Error('tex flush txn error'))
				tx.onabort = () => reject(tx.error ?? new Error('tex flush txn aborted'))
			})
		} catch (e) { console.warn('[TexCache] flush failed:', e) }
	})()
	await _flushing
	_flushing = null
}
```

- [ ] **Step 3: Refactor `texCacheGet` — buffer-check first + read-priority counter**

Replace the existing `export async function texCacheGet(uuid, now = Date.now()) { ... }` (currently ~lines 120–150) with:

```js
export async function texCacheGet(uuid, now = Date.now()) {
	// Buffered-but-unflushed write: serve it directly so a just-put texture is readable without a
	// spurious network refetch while it waits for the next flush window.
	const buf = _writeBuf.get(uuid)
	if (buf) { buf.lastUsed = now; return { blob: buf.blob, hasAlpha: buf.hasAlpha } }
	_readsInFlight++   // read-priority gate (see _flushNow); always paired with the finally below
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			// WHY readonly: a region replay fires 1000s of texCacheGet at once. A readwrite tx (to
			// touch lastUsed) takes a store write-lock, so IndexedDB SERIALIZES them all one-at-a-time
			// → textures trickle in (white scene). readonly tx run concurrently. LRU instead tracks
			// lastUsed at put-time (age-since-cached); a cache hit defers a batched touch (see below).
			const timer = setTimeout(() => {
				_watchdogTrips++
				if (_watchdogTrips <= 5 || _watchdogTrips % 100 === 0) {
					console.warn(`[TexCache] get watchdog (${GET_WATCHDOG_MS}ms) → miss for ${uuid} (trip #${_watchdogTrips})`)
				}
				resolve(null)
			}, GET_WATCHDOG_MS)
			const settle = (fn, v) => { clearTimeout(timer); fn(v) }
			const tx  = db.transaction(STORE, 'readonly')
			tx.onabort = () => settle(reject, tx.error ?? new Error('get txn aborted'))
			const req = tx.objectStore(STORE).get(uuid)
			req.onsuccess = () => {
				const rec = req.result
				if (rec) _touchLater(uuid, now)
				settle(resolve, rec ? { blob: rec.blob, hasAlpha: !!rec.hasAlpha } : null)
			}
			req.onerror = () => settle(reject, req.error)
		})
	} catch (e) {
		console.warn('[TexCache] get failed:', e)
		return null
	} finally {
		_readsInFlight--
	}
}
```

- [ ] **Step 4: Refactor `texCachePut` — buffer instead of per-call txn**

Replace the existing `export async function texCachePut(uuid, blob, hasAlpha = false, now = Date.now()) { ... }` (currently ~lines 182–225, the whole function) with:

```js
/** Persist a texture Blob by UUID. Buffers into _writeBuf (coalesced, latest-wins); the batched
 *  _flushNow writes the whole buffer in one txn per window so reads aren't serialized behind per-put
 *  writes. Synchronous (fire-and-forget): callers don't await it. */
export function texCachePut(uuid, blob, hasAlpha = false, now = Date.now()) {
	try {
		const bytes = blob.size
		const prev = _writeBuf.get(uuid)
		// Hard bound: once over the buffer cap, skip buffering NEW uuids (overwrites of already-buffered
		// uuids still proceed — they don't grow the net buffer) so the buffer can never OOM the tab.
		if (prev || _writeBufBytes < _writeBufHardCap) {
			if (prev) _writeBufBytes -= prev.bytes        // overwrite: drop the stale record's bytes
			_writeBuf.set(uuid, { uuid, blob, bytes, hasAlpha, lastUsed: now })
			_writeBufBytes += bytes
			_scheduleFlush()
		} else {
			_writeBufDropped++
		}
	} catch { /* best-effort persistence */ }
}
```

- [ ] **Step 5: Clear the buffer in `clearTextureCache` + add a pagehide flush**

In `clearTextureCache` (currently ~line 317), add buffer-clearing as the FIRST statements inside the function (before `const db = await openDb()`):

```js
		_writeBuf.clear(); _writeBufBytes = 0; _deferStartedAt = 0
```

Then, at the very END of the file (after the `clearTextureCache` function), add the pagehide flush (guarded for non-browser test envs):

```js
// Flush any buffered writes on tab close so a deferred batch still persists (mirrors geomCache).
if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('pagehide', () => { _flushNow(true) })
}
```

- [ ] **Step 6: Run the new tests to verify they PASS**

Run: `bun test src/__tests__/lib/textureCache.test.js`
Expected: PASS — all existing tests plus the 4 new write-deferral tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/textureCache.js src/__tests__/lib/textureCache.test.js
git commit -m "perf(tex): defer+batch qs-tex writes (warm-read)"
```

---

## Task 3: Wire the engine loading signal + telemetry

**Files:**
- Modify: `src/composables/useWorldEngine.js` (import line ~16–21 area; line ~3426; `[Drain]` line ~4583)

- [ ] **Step 1: Import the new functions**

Find the existing import from `./useTextureFetch.js` is separate; the texture CACHE import is from `@/lib/textureCache.js`. Search for how `clearTextureCache`/texture cache is imported. The texture build/stats funcs come from `./useTextureFetch.js` (line ~21). The cache loading signal lives in `@/lib/textureCache.js`. Add an import near the geomCache import (line ~38):

```js
import { setTexCacheLoading, getTextureWriteBufStats } from '@/lib/textureCache.js'
```

(If `@/lib/textureCache.js` is already imported elsewhere in the file, add these two names to that existing import instead of adding a duplicate import line. Grep first: `grep -n "lib/textureCache" src/composables/useWorldEngine.js`.)

- [ ] **Step 2: Call `setTexCacheLoading` beside `setGeomCacheLoading`**

Find line ~3426:

```js
		setGeomCacheLoading(loading)
```

Add immediately after it:

```js
		setTexCacheLoading(loading)   // same load signal: suspend qs-tex flushes so reads aren't starved
```

- [ ] **Step 3: Add tex write-buf to the `[Drain]` telemetry line**

Find the `[Drain]` line that now ends with the texture-stats IIFE (line ~4583, added by the prior decode-worker work):

```js
				(() => { const _ts = getTextureStats(); return ` texBuildQ=${_ts.buildQueued} texUpQ=${_ts.uploadQueued} texDec=${_ts.decodeOutstanding}` })()
```

Replace it with:

```js
				(() => { const _ts = getTextureStats(), _wb = getTextureWriteBufStats(); return ` texBuildQ=${_ts.buildQueued} texUpQ=${_ts.uploadQueued} texDec=${_ts.decodeOutstanding} texWB=${Math.round(_wb.bytes / 1048576)}MB texWBdrop=${_wb.dropped}` })()
```

- [ ] **Step 4: Verify build**

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(tex): drive qs-tex deferral from load signal"
```

---

## Task 4: Final verification

- [ ] **Step 1: Texture cache tests (bun)**

Run: `bun test src/__tests__/lib/textureCache.test.js`
Expected: all green (existing + 4 new).

- [ ] **Step 2: Broader bun lib tests**

Run: `bun test src/__tests__/lib/`
Expected: no NEW failures vs baseline (geomCache/meshCache/objectCache/textureCache should pass under bun).

- [ ] **Step 3: Vitest suite (confirm no vitest-side regression)**

Run: `npx vitest run`
Expected: same known baseline (~20 failed / 20+ passed); the bun-only files still show as bundling failures under vitest (pre-existing) — only flag NEW failures from this change. The decode-worker vitest tests stay green.

- [ ] **Step 4: Production build**

Run: `npm run build:prod`
Expected: succeeds.

- [ ] **Step 5: Live-verify handoff (Gene)**

On the same heavy region, hard reload (Vite restart not needed — no worker/import-graph change, but a hard reload is) and watch `__texStats()` / `[Main]`:
- `timing.idb.avg` collapses from ~7.4s to ~ms.
- `queued` drains instead of climbing; `qWait.avg` drops from ~20 min.
- `[Drain]` shows `texWB=…MB` rising during the burst then flushing to ~0 on settle; `texWBdrop` stays 0 on a normal region.
- Textures still persist (reload is warm); no flipped/missing textures.

---

## Notes for the implementer
- **TABS not spaces.**
- The lib tests run under **`bun test`**, not vitest — use the bun command shown. Do not "fix" the bun:test imports.
- **No `DB_VERSION` bump** — record shape is unchanged.
- `texCachePut` becomes **synchronous** (was async). All in-repo callers fire-and-forget it; `await texCachePut(...)` still works (awaiting a non-promise resolves immediately). Do not add `await` to its body.
- Do not touch the `_touchLater`/`flushTouches` LRU-touch batching (it already runs readonly-safe) or the `failed`/`meta` paths.
- The committed reference is `src/lib/geomCache.js` — when in doubt about the flush/eviction shape, match it.
