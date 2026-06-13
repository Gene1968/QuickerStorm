// src/lib/geomCache.js — persistent (IndexedDB qs-geom) + in-memory cache of BAKED geometry
// arrays, keyed by shape+scale hash (see geomKey.js). WHY: every session re-baked all region
// geometry (~10-24k prims) — pure waste, since bake output is a deterministic function of the
// key. Re-entry now rebuilds from cache; identical shape+scale prims bake once per session.
// WHY own DB: IDB locking is per-database — qs-tex write storms can never starve these reads
// (texCacheGet measured 3.3-3.7s avg behind texCachePut locks on the shared-DB pattern).
//
// INVARIANT (correctness-critical): a cache entry's arrays are NEVER aliased by any mesh.
// geometryFromArrays wraps without copying and the engine ratio-rescales geometry IN PLACE on
// scale change, so every hand-out is a fresh copy. IDB reads deserialize fresh arrays already;
// the memory tier slices explicitly. See the spec's "Array ownership" section.
import { createByteLRU } from '@/lib/byteLRU.js'

const DB_NAME = 'qs-geom', DB_VERSION = 1, STORE = 'geom', META = 'meta'

// TODO: add onblocked/onversionchange handlers before the first DB_VERSION bump (multi-tab
// upgrade hangs otherwise — see objectCache.js for the pattern).

// ── Cap (initCacheCap pattern from textureCache.js) ─────────────────────────
// 0.2/2GB filled to 97% after just two regions (15.9k entries, 11.7k of them per-scale mesh
// copies) — interim bump to 0.3/4GB until unscaled-bake dedup lands. Origin quota ~11.6GB;
// qs-tex holds ~60%, so 0.3 keeps geom under the texture share.
export const GEOM_CACHE_MAX_BYTES      = 4 * 1024 * 1024 * 1024
export const GEOM_CACHE_FALLBACK_BYTES = 1 * 1024 * 1024 * 1024
const CAP_FRACTION = 0.3
let _capBytes = GEOM_CACHE_FALLBACK_BYTES
// WHY _capExplicit: setGeomCapBytes (test hook / governor escape hatch) must win over
// initGeomCacheCap's storage estimate, even if initGeomCacheCap runs first or runs again.
let _capExplicit = false

export function resolveGeomCap(estimate, fraction = CAP_FRACTION,
	max = GEOM_CACHE_MAX_BYTES, fallback = GEOM_CACHE_FALLBACK_BYTES) {
	const quota = estimate && typeof estimate.quota === 'number' ? estimate.quota : 0
	return quota > 0 ? Math.min(Math.floor(quota * fraction), max) : fallback
}

/**
 * Override the IDB cap used for eviction. Sets _capExplicit so initGeomCacheCap's storage
 * estimate cannot silently clobber a test-set or governor-set value after an await.
 */
export function setGeomCapBytes(n) { _capBytes = n; _capExplicit = true }

let _capInit = null
export function initGeomCacheCap() {
	if (_capInit) return _capInit
	_capInit = (async () => {
		try {
			if (navigator.storage?.estimate) {
				const est = resolveGeomCap(await navigator.storage.estimate())
				// WHY guard: if setGeomCapBytes was called (explicit override) we must not overwrite it.
				if (!_capExplicit) _capBytes = est
			}
		} catch { /* keep fallback */ }
		console.debug('[GeomCache] cap', Math.round(_capBytes / 1048576) + 'MB')
		return _capBytes
	})()
	return _capInit
}

// ── Shared helpers ───────────────────────────────────────────────────────────
export function bytesOfArrays(a) {
	return (a.position?.byteLength || 0) + (a.normal?.byteLength || 0) +
	       (a.uv?.byteLength || 0) + (a.index?.byteLength || 0)
}

function cloneArrays(a) {
	return {
		position: a.position ? a.position.slice() : undefined,
		normal:   a.normal   ? a.normal.slice()   : undefined,
		uv:       a.uv       ? a.uv.slice()       : undefined,
		index:    a.index    ? a.index.slice()     : undefined,
		groups:   a.groups ? a.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })) : [],
	}
}

// A record is servable only if every present array is a real TypedArray of the right kind and
// groups (when present) is an Array. Anything else (disk corruption, foreign writes) is evicted
// and treated as a miss — the engine then re-bakes normally (spec: corrupt entry → miss + evict).
function validArrays(a) {
	if (!a || !(a.position instanceof Float32Array)) return false
	if (a.normal !== undefined && !(a.normal instanceof Float32Array)) return false
	if (a.uv !== undefined && !(a.uv instanceof Float32Array)) return false
	if (a.index !== undefined && !(a.index instanceof Uint32Array)) return false
	if (a.groups !== undefined && !Array.isArray(a.groups)) return false
	return true
}

// ── Tier 1: in-memory dedup map (byteLRU, cache owns its arrays) ─────────────
const GEOM_MEM_BUDGET = 128 * 1024 * 1024
const _mem = createByteLRU({ budgetBytes: GEOM_MEM_BUDGET, sizeOf: bytesOfArrays })

/** Sync lookup. Returns a fresh COPY of the arrays, or null. */
export function geomMemGet(key) {
	const e = _mem.get(key)
	return e ? cloneArrays(e) : null
}
export function getGeomMemBytes() { return _mem.bytes() }
export function geomMemClear() { _mem.clear() }

// ── Tier 2: IndexedDB ────────────────────────────────────────────────────────
let _db = null
let _lastStats = null  // { count, bytes } served from memory (Prefs-starvation lesson)
// Read-priority gate: count of in-flight geomCacheGetMany lookups. A readwrite flush txn queued
// ahead of these readonly lookups blocks them at the IDB level (overlapping [STORE,META] scope),
// which starved warm cache reads during region load (measured: idb hits → 0, the engine's lookup
// watchdog firing 600×, everything re-baked). _flushNow defers while this is > 0. See _flushNow.
let _readsInFlight = 0

function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			if (!db.objectStoreNames.contains(STORE)) {
				const s = db.createObjectStore(STORE, { keyPath: 'key' })
				s.createIndex('lastUsed', 'lastUsed')
			}
			if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' })
		}
		req.onsuccess = (e) => { _db = e.target.result; initGeomCacheCap(); resolve(_db) }
		req.onerror = () => reject(req.error)
	})
}

// Buffered writes (objectCache writeBuf pattern): one txn per flush window, latest-wins.
// WHY: a cold first visit bakes thousands of geometries in minutes; one readwrite txn each
// would serialize IDB and starve every reader (measured on tex/obj caches).
const FLUSH_MS = 300
const FLUSH_MAX = 200       // geometry records are bigger than object records → lower cap
const _writeBuf = new Map() // key → { key, …arrays, bytes, savedAt, lastUsed }
let _flushTimer = null
let _flushing = null

/**
 * Store baked arrays under `key`. The cache TAKES OWNERSHIP of `arrays`; the caller gets a
 * fresh copy back and must use only that copy (worker-transferred buffers come straight here).
 */
export function geomCacheStore(key, arrays, now = Date.now()) {
	const owned = { position: arrays.position, normal: arrays.normal, uv: arrays.uv, index: arrays.index, groups: arrays.groups || [] }
	_mem.set(key, owned)
	try {
		_writeBuf.set(key, { key, ...owned, bytes: bytesOfArrays(owned), savedAt: now, lastUsed: now })
		_scheduleFlush()
	} catch { /* best-effort persistence; memory tier still works */ }
	return cloneArrays(owned)
}

function _scheduleFlush() {
	if (_writeBuf.size >= FLUSH_MAX) { _flushNow(); return }
	if (_flushTimer) return
	_flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
}

async function _flushNow(force = false) {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	// Read-priority: defer the readwrite flush while a getMany lookup is in flight so cache reads
	// aren't starved during load. Writes are re-derivable and cheap to delay. The hard cap
	// (_writeBuf.size >= FLUSH_MAX) and `force` (pagehide / explicit flush) both bypass this, so
	// buffered geometry can never grow unbounded and shutdown persistence still works.
	if (!force && _readsInFlight > 0 && _writeBuf.size < FLUSH_MAX) {
		if (!_flushTimer) _flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
		return
	}
	if (_flushing) await _flushing
	if (!_writeBuf.size) return
	const batch = [..._writeBuf.values()]
	_writeBuf.clear()
	_flushing = (async () => {
		try {
			const db = await openDb()
			await new Promise((resolve, reject) => {
				const tx = db.transaction([STORE, META], 'readwrite')
				const st = tx.objectStore(STORE)
				const mt = tx.objectStore(META)
				const batchKeys = new Set(batch.map(b => b.key))
				// WHY getKey-before-put: keys are content hashes (shape+scale+GEOM_VERSION), so a
				// duplicate key means byte-identical content. We always put (refreshes lastUsed) but
				// only count added bytes for genuinely NEW keys. Without this guard, a whole-region
				// re-bake after a degraded getMany inflates totalBytes by the full region size on every
				// flush window that contains a duplicate, compounding until the cap triggers spurious
				// evictions (totalBytes drifts far above the real IDB footprint).
				let added = 0
				let pending = batch.length
				const afterAllKeys = () => {
					const mreq = mt.get('stats')
					mreq.onsuccess = () => {
						let total = (mreq.result?.totalBytes ?? 0) + added
						if (total <= _capBytes) { finishStats(total); return }
						// Over cap → lastUsed cursor oldest-first; never evict a key just written.
						const cur = st.index('lastUsed').openCursor()
						cur.onsuccess = () => {
							const c = cur.result
							if (!c || total <= _capBytes) { finishStats(total); return }
							if (!batchKeys.has(c.value.key)) { total -= c.value.bytes; c.delete() }
							c.continue()
						}
					}
				}
				let statsResult = null
				const finishStats = (total) => {
					const cReq = st.count()
					cReq.onsuccess = () => {
						mt.put({ k: 'stats', totalBytes: total, count: cReq.result })
						statsResult = { count: cReq.result, bytes: total }
					}
				}
				for (const rec of batch) {
					const gkReq = st.getKey(rec.key)
					gkReq.onsuccess = () => {
						// Always put (refresh lastUsed); only add bytes when key is new.
						st.put(rec)
						if (gkReq.result === undefined) added += rec.bytes
						if (--pending === 0) afterAllKeys()
					}
				}
				tx.oncomplete = () => { if (statsResult) _lastStats = statsResult; resolve() }
				// onabort too: an aborted txn settles NEITHER oncomplete nor onerror — the awaiting
				// flush chain (and everything queued behind _flushing) would hang forever.
				tx.onerror = () => reject(tx.error ?? new Error('flush txn error'))
				tx.onabort = () => reject(tx.error ?? new Error('flush txn aborted'))
			})
		} catch (e) { console.warn('[GeomCache] flush failed:', e) }
	})()
	await _flushing
	_flushing = null
}

/** Test hook: force the write buffer to disk now (bypasses the read-priority gate). */
export async function __flushGeomWritesNow() { await _flushNow(true) }

// Batched LRU touches (textureCache flushTouches pattern, 10s cadence — reads stay readonly).
const _touchQueue = new Map()
let _touchTimer = null
function _touchLater(key, now) {
	_touchQueue.set(key, now)
	if (_touchTimer) return
	_touchTimer = setTimeout(_flushTouches, 10000)
}
async function _flushTouches() {
	_touchTimer = null
	if (!_touchQueue.size) return
	const batch = [..._touchQueue]; _touchQueue.clear()
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE)
			for (const [key, now] of batch) {
				const g = st.get(key)
				g.onsuccess = () => { const r = g.result; if (r) { r.lastUsed = now; st.put(r) } }
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve
		})
	} catch { /* best-effort LRU */ }
}

/** Test hook: force pending LRU touches to IDB now. */
export async function __flushGeomTouchesNow() { await _flushTouches() }

/**
 * Batch lookup — ONE readonly txn for the whole key list (the drain-tick read). Returns
 * Map<key, arrays>; missing keys are simply absent. Hits are promoted into the memory tier
 * (un-aliased) and LRU-touched. NEVER rejects — IDB failure degrades to an empty Map (all-miss).
 */
export async function geomCacheGetMany(keys, now = Date.now()) {
	const out = new Map()
	if (!keys.length) return out
	_readsInFlight++   // read-priority gate (see _flushNow); always paired with the finally below
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(STORE, 'readonly')
			const st = tx.objectStore(STORE)
			for (const key of keys) {
				const g = st.get(key)
				g.onsuccess = () => {
					const r = g.result
					if (!r) return
					const arrays = { position: r.position, normal: r.normal, uv: r.uv, index: r.index, groups: r.groups || [] }
					// WHY validate before promoting: spec "Error handling / degrade" — a corrupt or
					// unwrappable entry on hit is treated as a MISS and evicted; the engine re-bakes
					// normally. Without this, a corrupt record would enter the memory tier and throw in
					// cloneArrays (aborting this txn, dropping later keys) and again in geomMemGet.
					// Fire-and-forget evict: the readonly txn must not wait on a readwrite txn; the key
					// simply stays absent from the result Map (= miss).
					if (!validArrays(arrays)) { geomCacheEvict(key); return }
					// IDB deserialization already produced fresh arrays → safe for the mem tier to own;
					// hand the CALLER a clone so promotion and hand-out never alias.
					// WHY safe to clobber a newer _mem entry: keys are content hashes (incl. GEOM_VERSION)
					// — same key ⇒ byte-identical arrays.
					_mem.set(key, arrays)
					out.set(key, cloneArrays(arrays))
					_touchLater(key, now)
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve   // degrade: whatever resolved before the error still counts
			tx.onabort = resolve   // aborted read = all-miss for unresolved keys; never hang the drain
		})
	} catch (e) { console.warn('[GeomCache] getMany failed:', e) }
	finally { _readsInFlight-- }
	return out
}

/** Remove one entry from both tiers (corrupt record, or external invalidation). Best-effort. */
export async function geomCacheEvict(key) {
	_mem.delete(key)
	_writeBuf.delete(key)
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			const st = tx.objectStore(STORE)
			const g = st.get(key)
			g.onsuccess = () => {
				const r = g.result
				if (!r) return
				st.delete(key)
				const mreq = tx.objectStore(META).get('stats')
				mreq.onsuccess = () => {
					const total = Math.max(0, (mreq.result?.totalBytes ?? 0) - (r.bytes || 0))
					const cReq = st.count()
					cReq.onsuccess = () => {
						tx.objectStore(META).put({ k: 'stats', totalBytes: total, count: cReq.result })
						_lastStats = { count: cReq.result, bytes: total }
					}
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve
		})
	} catch { /* best-effort */ }
}

/** { count, bytes, capBytes } — memory-served after first flush (Prefs pattern). */
export async function getGeomCacheStats() {
	if (_lastStats) return { ..._lastStats, capBytes: _capBytes }
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq = tx.objectStore(META).get('stats')
			let count = 0, bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => { _lastStats = { count, bytes }; resolve({ count, bytes, capBytes: _capBytes }) }
			tx.onerror = () => reject(tx.error)
			tx.onabort = () => reject(tx.error ?? new Error('stats txn aborted'))
		})
	} catch { return { count: 0, bytes: 0, capBytes: _capBytes } }
}

export async function clearGeomCache() {
	// WHY cancel timer + await in-flight flush first: a committed-after-clear batch could
	// otherwise resurrect records into a freshly cleared store.
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	if (_flushing) await _flushing
	_writeBuf.clear()
	_lastStats = null
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

// Flush pending writes when the tab is hidden/closed (parity with objectCache) — bakes from
// the last ≤300ms window would otherwise be lost; cheap insurance for re-derivable data.
if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => { _flushNow(true) })
}
