// src/lib/textureCache.js — persistent (IndexedDB) cache of decoded textures, keyed by asset UUID.
// WHY: textures are immutable by UUID and a region pulls hundreds-to-thousands of them. Without
// persistence every reload/relogin re-fetches + re-transcodes the whole scene (slow + hammers the
// sim). This is our portable equivalent of Firestorm's on-disk texture cache: store the WebP Blob
// by UUID, survive reloads, evict least-recently-fetched once a configurable size cap is hit.
// (A second, server-side tier can come later once self-hosted on VPS/NAS.)
const DB_NAME    = 'qs-tex'
const DB_VERSION = 5          // v2 added 'failed'; v3 purges all stores once — PNGs cached before
                              // the server J2C decoder swap (cornerstone-openjpeg → magick-wasm)
                              // can be poisoned (mis-decoded RGBA Kakadu streams: alpha cutouts
                              // rendered as opaque white). 'failed' is cleared too so cornerstone-
                              // specific hard-fails get one retry under the new decoder. See
                              // server/__tests__/j2c-rgba-kakadu.test.ts.
                              // v4 purges all stores again — PNG data-URLs cached before the
                              // server switched its transcode output to WebP are stale (the WS
                              // now sends mime:'image/webp'; old entries can't be reused).
                              // v5 = data-URL string → Blob (record shape change; v4 entries hold strings).
const STORE      = 'tex'      // { uuid, blob, bytes, hasAlpha, lastUsed }
const META       = 'meta'     // { k:'stats', totalBytes }
const FAILED     = 'failed'   // { uuid, ts } — permanent decode/404 failures with TTL

// Fallback cap when the browser won't report a quota. Real cap is derived from navigator.storage
// .estimate() at init (see initCacheCap) so the cache scales to the machine instead of guessing.
export const TEX_CACHE_FALLBACK_BYTES = 8 * 1024 * 1024 * 1024
const CAP_FRACTION = 0.6   // fraction of the origin's quota we're willing to hold
let _capBytes = TEX_CACHE_FALLBACK_BYTES

// Pure: choose a cap from a StorageEstimate-like object. Exported for unit tests (no navigator dep).
export function resolveCacheCap(estimate, fraction = CAP_FRACTION, fallback = TEX_CACHE_FALLBACK_BYTES) {
	const quota = estimate && typeof estimate.quota === 'number' ? estimate.quota : 0
	return quota > 0 ? Math.floor(quota * fraction) : fallback
}

// Derive the cap from the real quota, then fire-and-forget persist(). Best-effort: any failure
// leaves the fallback cap in place. Safe to call repeatedly; the first call does the work.
let _capInit = null
export function initCacheCap() {
	if (_capInit) return _capInit
	_capInit = (async () => {
		try {
			if (navigator.storage?.estimate) _capBytes = resolveCacheCap(await navigator.storage.estimate())
		} catch { /* keep fallback */ }
		// WHY fire-and-forget: Firefox may show a permission doorhanger for persist(); don't let an
		// unanswered prompt (or a rejection) block or discard the quota-derived cap above.
		try { navigator.storage?.persist?.()?.catch?.(() => {}) } catch { /* unsupported */ }
		console.debug('[TexCache] cap', Math.round(_capBytes / 1048576) + 'MB')
		return _capBytes
	})()
	return _capInit
}

let _db = null
let _lastStats = null  // last known { count, bytes } — served to Prefs from memory. WHY: the
                       // stats readonly txn starves >4s behind put/touch write txns during a
                       // load (measured live >9s), which is exactly when the panel is watched.
                       // Every put refreshes this; IDB is only read when no put has run yet
                       // this session (quiet DB — the case the read can't starve).

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

function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			// One-time purge: drop every store so nothing from a superseded transcode pipeline survives.
			// v3 = post-cornerstone→magick J2C swap; v4 = PNG→WebP cutover (old PNG data-URLs are dead);
			// v5 = data-URL string → Blob (v4 entries hold strings, incompatible with new record shape).
			// Stores are recreated empty below.
			if (e.oldVersion > 0 && e.oldVersion < 5) {
				for (const name of [STORE, META, FAILED]) {
					if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name)
				}
			}
			if (!db.objectStoreNames.contains(STORE)) {
				const s = db.createObjectStore(STORE, { keyPath: 'uuid' })
				s.createIndex('lastUsed', 'lastUsed')
			}
			if (!db.objectStoreNames.contains(META))   db.createObjectStore(META,   { keyPath: 'k' })
			if (!db.objectStoreNames.contains(FAILED)) db.createObjectStore(FAILED, { keyPath: 'uuid' })
		}
		req.onsuccess = (e) => { _db = e.target.result; initCacheCap(); resolve(_db) }
		req.onerror   = () => reject(req.error)
	})
}

/**
 * Pure LRU selection: given cache entries and a cap, return the uuids to evict (oldest first)
 * until the total fits. Exported so the policy is unit-testable without IndexedDB.
 */
export function planEvictions(entries, capBytes) {
	let total = entries.reduce((s, e) => s + e.bytes, 0)
	if (total <= capBytes) return []
	const evict = []
	for (const e of [...entries].sort((a, b) => a.lastUsed - b.lastUsed)) {
		if (total <= capBytes) break
		evict.push(e.uuid)
		total -= e.bytes
	}
	return evict
}

/**
 * Look up a cached texture by UUID. Touches lastUsed (LRU). Returns `{ blob, hasAlpha }` or null
 * on miss. `hasAlpha` (whether the WebP carries real transparency) rides along so the client can
 * pick blend-vs-opaque without re-fetching; old records pre-dating the field read as `false`.
 */
// WHY watchdog: a get that never settles (aborted txn with no onabort route, or a read starved
// minutes behind a write convoy — measured live 38s avg / 178s max during session degradation)
// freezes the caller's blobInflight promise FOREVER; every later request for that uuid joins the
// frozen promise and the whole texture queue wedges. Past the watchdog we declare a miss — the
// caller re-fetches from the network (server memoizes), which is slow-but-alive instead of stuck.
// #11: raised 10s → 30s. The watchdog exists only to break a read that NEVER settles (frozen txn).
// At 10s it also fired for merely-SLOW reads — under main-thread saturation a read's onsuccess
// callback queues behind long tasks, so the read completes but its callback is delayed seconds. That
// false "miss" sent the caller to the network → refetch storm that fed the saturation spiral. At 30s
// a slow-but-completing read resolves the real blob (no network); only a genuinely-stuck read trips.
const GET_WATCHDOG_MS = 30_000
let _watchdogTrips = 0

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

// Batched LRU touch: accumulate hit uuids and flush lastUsed in ONE readwrite tx every few seconds,
// so the hot read path never takes a write-lock. Best-effort — drops on error.
const _touchQueue = new Map()
let _touchTimer = null
function _touchLater(uuid, now) {
	_touchQueue.set(uuid, now)
	if (_touchTimer) return
	_touchTimer = setTimeout(flushTouches, 4000)
}
async function flushTouches() {
	_touchTimer = null
	if (!_touchQueue.size) return
	const batch = [..._touchQueue]; _touchQueue.clear()
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE)
			for (const [uuid, now] of batch) {
				const g = st.get(uuid)
				g.onsuccess = () => { const r = g.result; if (r) { r.lastUsed = now; st.put(r) } }
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve   // an abort must not strand the touch flush (best-effort anyway)
		})
	} catch { /* best-effort LRU */ }
}

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

/** Returns { count, bytes, capBytes } for the texture cache. Served from memory once any put
 * (or one successful read) has run this session — see `_lastStats`. */
export async function getTextureCacheStats() {
	if (_lastStats) return { ..._lastStats, capBytes: _capBytes }
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq  = tx.objectStore(META).get('stats')
			let count = 0
			let bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess  = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => { _lastStats = { count, bytes }; resolve({ count, bytes, capBytes: _capBytes }) }
			tx.onerror = () => reject(tx.error)
			tx.onabort = () => reject(tx.error ?? new Error('stats txn aborted'))
		})
	} catch { return { count: 0, bytes: 0, capBytes: _capBytes } }
}

/**
 * Pure helper: given raw {uuid, ts} rows from the FAILED store, return the UUIDs whose ts falls
 * within ttlMs of now. Rows older than ttlMs are treated as expired (asset may have been fixed on
 * the grid). Exported for unit tests — no IDB dependency.
 */
export function selectLiveFailed(rows, now, ttlMs) {
	return rows.filter(r => r && typeof r.ts === 'number' && (now - r.ts) < ttlMs).map(r => r.uuid)
}

/** TTL for persisted hard-fail records: 7 days. After this the UUID will be retried in case the
 *  grid asset was re-uploaded or corrected. */
export const TEX_FAILED_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Load the set of UUIDs the server permanently failed on within the TTL window.
 * Returns an array of UUID strings; empty on IDB error.
 */
export async function texFailedLoad(now = Date.now()) {
	try {
		const db = await openDb()
		const rows = await new Promise((resolve, reject) => {
			const tx = db.transaction(FAILED, 'readonly')
			tx.onabort = () => reject(tx.error ?? new Error('failed-load txn aborted'))
			const req = tx.objectStore(FAILED).getAll()
			req.onsuccess = () => resolve(req.result || [])
			req.onerror   = () => reject(req.error)
		})
		return selectLiveFailed(rows, now, TEX_FAILED_TTL_MS)
	} catch (e) { console.warn('[TexCache] failed-load failed:', e); return [] }
}

/**
 * Persist a permanent decode/404 failure for a UUID (best-effort).
 * Does not throw — failures here are non-fatal; the in-memory Set is always the source of truth
 * for the current session.
 */
export async function texFailedMark(uuid, now = Date.now()) {
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(FAILED, 'readwrite')
			tx.objectStore(FAILED).put({ uuid, ts: now })
			tx.oncomplete = resolve
			tx.onerror    = resolve  // best-effort — swallow
			tx.onabort    = resolve
		})
	} catch { /* best-effort */ }
}

/**
 * Drop the persisted permanent-failure mark for a UUID (best-effort) — the manual "Texture refresh"
 * escape hatch: a previously server-errored texture should get a clean re-fetch (and persist if it now
 * succeeds) instead of being skipped forever from the IDB negative-cache. In-memory state is cleared
 * separately by useTextureFetch.refreshTextures().
 */
export async function texFailedClear(uuid, _now = Date.now()) {
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(FAILED, 'readwrite')
			tx.objectStore(FAILED).delete(uuid)
			tx.oncomplete = resolve
			tx.onerror    = resolve  // best-effort — swallow
			tx.onabort    = resolve
		})
	} catch { /* best-effort */ }
}

/** Clears all texture cache entries and resets the totalBytes counter. */
export async function clearTextureCache() {
	// WHY cancel timer + await in-flight flush first: a committed-after-clear batch could otherwise
	// resurrect records into a freshly cleared store (e.g. "Texture refresh" clicked mid-load).
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	if (_flushing) await _flushing
	_writeBuf.clear(); _writeBufBytes = 0; _deferStartedAt = 0
	if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null }
	_loading = false
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).clear()
			tx.objectStore(META).put({ k: 'stats', totalBytes: 0, count: 0 })
			tx.oncomplete = () => { _lastStats = { count: 0, bytes: 0 }; resolve() }
			tx.onerror = () => reject(tx.error)
			tx.onabort = () => reject(tx.error ?? new Error('clear txn aborted'))
		})
	} catch { /* ignore */ }
}

// Flush any buffered writes on tab close so a deferred batch still persists (mirrors geomCache).
if (typeof window !== 'undefined' && window.addEventListener) {
	window.addEventListener('pagehide', () => { _flushNow(true) })
}
