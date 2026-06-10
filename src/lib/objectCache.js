// src/lib/objectCache.js — persistent (IndexedDB) per-object cache, per region.
// WHY: replicate Firestorm's llvocache — accumulate one record PER OBJECT (keyed by
// region + localId) with its PseudoCRC, instead of one whole-region snapshot that gets
// overwritten. On reload we pre-seed the scene from these records (instant paint) and the
// sim's ObjectUpdateCached probes tell us, per object, whether our cached CRC is still
// valid (hit → keep) or stale/missing (miss → re-fetch). Per-object writes mean a session
// that re-sees fewer objects can no longer shrink the persisted set. See probePartition.js.
const DB_NAME    = 'qs-objects'
const DB_VERSION = 6                 // v1 snapshot→v2 per-object; v3 META stats; v4/v5 purged records
                                     // poisoned by raw-update persistence; v6 purges once more after
                                     // the REAL root cause was fixed (full-ObjectUpdate tail read
                                     // `Data` as Variable1 instead of Variable2 → ExtraParams desync
                                     // → meshId/sculptId silently dropped, then cached; CRC probe-hits
                                     // replay poisoned records forever without a purge). See
                                     // server/__tests__/objupdate-data-var2.test.ts.
const STORE      = 'objects'         // { regionKey, localId, fullId, crc, data, savedAt }
const META       = 'meta'            // { key:'stats', regions, objects } — read for Prefs WITHOUT
                                     // touching the hot STORE (so stats never starve behind writes)

// Keep at most this many regions cached (LRU by most-recent savedAt per region).
const MAX_REGIONS = 12

let _db = null
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			// Drop the legacy v1 'regions' snapshot store; v4 also drops 'objects' + 'meta' once to
			// purge records poisoned by the raw-update persistence bug (see DB_VERSION note).
			if (db.objectStoreNames.contains('regions')) db.deleteObjectStore('regions')
			if (e.oldVersion > 0 && e.oldVersion < 6) {
				if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
				if (db.objectStoreNames.contains(META))  db.deleteObjectStore(META)
			}
			if (!db.objectStoreNames.contains(STORE)) {
				const s = db.createObjectStore(STORE, { keyPath: ['regionKey', 'localId'] })
				s.createIndex('regionKey', 'regionKey')
				s.createIndex('savedAt', 'savedAt')
			}
			if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
		}
		// WHY onblocked: another open tab holding an older version blocks the v2→v3 upgrade. Fail
		// fast (callers degrade gracefully) instead of hanging the Prefs panel forever.
		req.onblocked = () => reject(new Error('objCache upgrade blocked by another open tab'))
		req.onsuccess = (e) => {
			_db = e.target.result
			// Close on a version bump from another tab so we don't block ITS upgrade.
			_db.onversionchange = () => { _db.close(); _db = null }
			resolve(_db)
		}
		req.onerror   = () => reject(req.error)
	})
}

// WHY pure + exported: the region-LRU policy is the only non-I/O logic worth unit-testing
// (mirrors textureCache.planEvictions). Given [{regionKey, newestSavedAt}], return the
// regionKeys to drop, oldest-first, so that at most maxRegions remain.
export function planRegionEvictions(regions, maxRegions = MAX_REGIONS) {
	const ordered = [...regions].sort((a, b) => a.newestSavedAt - b.newestSavedAt)
	const dropCount = Math.max(0, ordered.length - maxRegions)
	return ordered.slice(0, dropCount).map(r => r.regionKey)
}

// WHY batched writes: a busy region streams thousands of ObjectUpdates. One readwrite txn
// per object saturated IndexedDB's serialized txn queue, so the Prefs stats readonly txn
// starved and timed out ("Loading/Unavailable"). We coalesce puts (latest-wins per object)
// into a buffer and flush them in ONE txn on a short timer / size cap, leaving slots for
// reads. The buffer also dedupes repeat-updates of the same prim during load.
const FLUSH_MS       = 300   // coalesce window
const FLUSH_MAX      = 400   // hard flush when buffer grows past this (bound latency + memory)
const _writeBuf = new Map()  // `${regionKey} ${localId}` → record
let _flushTimer = null
let _flushing = null         // in-flight flush promise (so concurrent flushes serialize)
let _metaDirty = false       // STORE changed (put/evict/prune) → recompute META stats next flush
let _lastStats = null        // last flushed { regions, objects } — served to Prefs from memory.
                             // WHY: even a META-ONLY readonly txn starves >4s behind the flush
                             // stream (its readwrite scope includes META), measured live. The
                             // flush already computes exact counts, so keep them here.

async function _flushNow() {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	if (_flushing) await _flushing            // serialize: let any prior flush finish first
	if (!_writeBuf.size && !_metaDirty) return
	const batch = [..._writeBuf.values()]
	_writeBuf.clear()
	_metaDirty = false
	_flushing = (async () => {
		try {
			const db = await openDb()
			await new Promise((resolve, reject) => {
				// One txn over STORE + META: write the batch, then recompute the stat counters and
				// stash them in META. Prefs reads META alone, so its readonly txn never shares scope
				// with the hot STORE and can't be starved by the write stream.
				const tx = db.transaction([STORE, META], 'readwrite')
				const st = tx.objectStore(STORE)
				for (const rec of batch) st.put(rec)
				let objects = 0, regions = 0, counted = false, cursored = false
				const writeMeta = () => {
					if (!counted || !cursored) return
					_lastStats = { regions, objects }
					tx.objectStore(META).put({ key: 'stats', regions, objects })
				}
				const cReq = st.count()
				cReq.onsuccess = () => { objects = cReq.result; counted = true; writeMeta() }
				const curReq = st.index('regionKey').openKeyCursor(null, 'nextunique')
				curReq.onsuccess = () => {
					const c = curReq.result
					if (c) { regions++; c.continue() } else { cursored = true; writeMeta() }
				}
				tx.oncomplete = resolve
				tx.onerror = () => reject(tx.error)
			})
		} catch (e) { console.warn('[ObjCache] flush failed:', e) }
	})()
	await _flushing
	_flushing = null
}

function _scheduleFlush() {
	if (_writeBuf.size >= FLUSH_MAX) { _flushNow(); return }
	if (_flushTimer) return
	_flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
}

/** Upsert one object for a region (buffered; flushed in batches). localId required. */
export function objCachePut(regionKey, obj, now = Date.now()) {
	if (!regionKey || typeof obj?.localId !== 'number') return
	try {
		// JSON round-trip → plain, structured-cloneable snapshot (obj may be a Vue proxy).
		const data = JSON.parse(JSON.stringify(obj))
		_writeBuf.set(`${regionKey} ${obj.localId}`, {
			regionKey, localId: obj.localId, fullId: obj.fullId ?? null,
			crc: typeof obj.crc === 'number' ? obj.crc : null, data, savedAt: now,
		})
		_scheduleFlush()
	} catch (e) { console.warn('[ObjCache] put failed:', e) }
}

/** Force-write any buffered objects now (call on teleport/unmount; also runs on pagehide). */
export async function objCacheFlush() { await _flushNow() }

// Persist the tail of the buffer when the tab is hidden/closed so a reload keeps recent prims.
if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => { _flushNow() })
	document.addEventListener('visibilitychange', () => { if (document.hidden) _flushNow() })
}

/** All cached object `data` records for a region (for pre-seed). */
export async function objCacheGetAll(regionKey) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE)
				.index('regionKey').getAll(IDBKeyRange.only(regionKey))
			req.onsuccess = () => resolve((req.result || []).map(r => r.data))
			req.onerror   = () => reject(req.error)
		})
	} catch (e) { console.warn('[ObjCache] getAll failed:', e); return [] }
}

/** Map<localId, crc> for a region (for probe partitioning). Skips entries with null crc. */
export async function objCacheCrcMap(regionKey) {
	const map = new Map()
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE)
				.index('regionKey').openCursor(IDBKeyRange.only(regionKey))
			req.onsuccess = () => {
				const c = req.result
				if (!c) return resolve()
				if (typeof c.value.crc === 'number') map.set(c.value.localId, c.value.crc)
				c.continue()
			}
			req.onerror = () => reject(req.error)
		})
	} catch (e) { console.warn('[ObjCache] crcMap failed:', e) }
	return map
}

/** Drop ALL cached objects for one region. WHY: localIds are only valid for one region run
 * (RegionHandshake CacheID changes on restart) — after a restart every cached record carries a
 * dead localId, which paints ghost duplicates and bricks ObjectSelect/edit on click. */
export async function objCacheClearRegion(regionKey) {
	if (!regionKey) return 0
	for (const k of [..._writeBuf.keys()]) if (k.startsWith(`${regionKey} `)) _writeBuf.delete(k)
	let n = 0
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			const req = tx.objectStore(STORE).index('regionKey').openCursor(IDBKeyRange.only(regionKey))
			req.onsuccess = () => {
				const c = req.result
				if (!c) return
				c.delete(); n++
				c.continue()
			}
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
		_metaDirty = true; _scheduleFlush()
	} catch (e) { console.warn('[ObjCache] clearRegion failed:', e) }
	return n
}

/** Remove one object (KillObject / genuine delete). */
export async function objCacheEvict(regionKey, localId) {
	_writeBuf.delete(`${regionKey} ${localId}`)  // don't let a buffered put resurrect it
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).delete([regionKey, localId])
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
		_metaDirty = true; _scheduleFlush()  // STORE shrank → recompute stat counters
	} catch { /* ignore */ }
}

/** Stats for Preferences UI: { regions, objects }. Served from the in-memory `_lastStats` the
 * flush maintains; falls back to a META read only when no flush has run this session (cold,
 * quiet DB — the one case the read can't starve). WHY not read IDB here: measured live, even a
 * META-only readonly txn waits >9s behind the 300ms readwrite flush stream (whose scope includes
 * META), so the panel timed out to "Unavailable" exactly when the cache was busiest. Returns
 * counts accurate to the last flush (≤300 ms + one coalesce window); the nudge below means a
 * second Refresh converges. */
export async function getObjectCacheStats() {
	_metaDirty = true; _scheduleFlush()  // nudge a recompute (coalesced); read returns last value
	if (_lastStats) return { ..._lastStats }
	try {
		const db = await openDb()
		return await new Promise((resolve) => {
			const req = db.transaction(META, 'readonly').objectStore(META).get('stats')
			req.onsuccess = () => resolve(req.result
				? { regions: req.result.regions || 0, objects: req.result.objects || 0 }
				: { regions: 0, objects: 0 })
			req.onerror = () => resolve({ regions: 0, objects: 0 })
		})
	} catch { return { regions: 0, objects: 0 } }
}

/** Evict whole regions beyond MAX_REGIONS, oldest first (fire-and-forget housekeeping). */
export async function objCachePruneRegions() {
	try {
		const db = await openDb()
		const rows = await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
			req.onsuccess = () => resolve(req.result || [])
			req.onerror = () => reject(req.error)
		})
		const newest = new Map() // regionKey → max savedAt
		for (const r of rows) newest.set(r.regionKey, Math.max(newest.get(r.regionKey) ?? 0, r.savedAt))
		const regions = [...newest.entries()].map(([regionKey, newestSavedAt]) => ({ regionKey, newestSavedAt }))
		const toDrop = planRegionEvictions(regions, MAX_REGIONS)
		if (!toDrop.length) return
		const drop = new Set(toDrop)
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE)
			for (const r of rows) if (drop.has(r.regionKey)) st.delete([r.regionKey, r.localId])
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
		_metaDirty = true; _scheduleFlush()  // STORE shrank → recompute stat counters
	} catch (e) { console.warn('[ObjCache] prune failed:', e) }
}

/** Clear everything. */
export async function objCacheClearAll() {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	_writeBuf.clear()  // drop pending writes so they don't repopulate after the clear
	_metaDirty = false
	_lastStats = { regions: 0, objects: 0 }
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).clear()
			tx.objectStore(META).put({ key: 'stats', regions: 0, objects: 0 })
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
