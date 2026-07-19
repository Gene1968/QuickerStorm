// src/lib/meshCache.js — IndexedDB cache of decoded mesh geometry by asset UUID (immutable assets).
// Stores the submeshes JSON so re-entry/relogin skips the fetch + server decode.
// v2: adds 'meta' store for totalBytes tracking (mirrors textureCache pattern), eliminates O(n)
// cursor walk in getMeshCacheStats so count/size queries are instant even under write pressure.
// v3: byte cap + LRU (lastUsed index, batched touches, put-time eviction — the textureCache
// pattern). The store was UNBOUNDED before; measured ~1GB after a handful of regions. Upgrade
// drops v2 records (they lack lastUsed so the index would never see them) — rebuildable cache;
// warm regions barely notice because qs-geom baked-geometry hits skip the qs-mesh read entirely.
const DB_NAME = 'qs-mesh', DB_VERSION = 3, STORE = 'mesh', META = 'meta'
export const meshDbConfig = { store: STORE, keyPath: 'uuid' }

// ── Cap (initCacheCap pattern from textureCache.js / geomCache.js) ──────────
export const MESH_CACHE_MAX_BYTES      = 1 * 1024 * 1024 * 1024   // hard ceiling (~1GB target)
export const MESH_CACHE_FALLBACK_BYTES = 512 * 1024 * 1024        // no storage.estimate → 512MB
const CAP_FRACTION = 0.1   // share of origin quota (qs-tex 0.6, qs-geom 0.3 — raw mesh is the
                           // smallest tier: geom-cache hits bypass it on warm loads)
let _capBytes = MESH_CACHE_FALLBACK_BYTES
let _capExplicit = false

export function resolveMeshCap(estimate, fraction = CAP_FRACTION,
	max = MESH_CACHE_MAX_BYTES, fallback = MESH_CACHE_FALLBACK_BYTES) {
	const quota = estimate && typeof estimate.quota === 'number' ? estimate.quota : 0
	return quota > 0 ? Math.min(Math.floor(quota * fraction), max) : fallback
}

/** Test hook / governor escape hatch — wins over initMeshCacheCap's estimate. */
export function setMeshCapBytes(bytes) { _capBytes = bytes; _capExplicit = true }

let _capInit = null
export function initMeshCacheCap() {
	if (_capInit) return _capInit
	_capInit = (async () => {
		try {
			if (navigator.storage?.estimate) {
				const est = resolveMeshCap(await navigator.storage.estimate())
				if (!_capExplicit) _capBytes = est
			}
		} catch { /* keep fallback */ }
	})()
	return _capInit
}

let _db = null
let _lastStats = null  // last known { count, bytes } — served to Prefs from memory; the readonly
                       // stats txn starves behind put txns during mesh-heavy loads (same failure
                       // measured live on tex/obj caches). Puts keep this fresh; IDB read is the
                       // cold-start fallback only (quiet DB — the case that can't starve).
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			// v3 drops v2 records: they predate lastUsed, so the LRU index would never include
			// them and they'd be unevictable forever. Cache is rebuildable (cold re-fetch only).
			if (e.oldVersion > 0 && e.oldVersion < 3) {
				if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE)
				if (db.objectStoreNames.contains(META))  db.deleteObjectStore(META)
			}
			if (!db.objectStoreNames.contains(STORE)) {
				const s = db.createObjectStore(STORE, { keyPath: 'uuid' })
				s.createIndex('lastUsed', 'lastUsed')
			}
			if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' })
		}
		// Multi-tab safety (objectCache pattern): fail fast instead of hanging the upgrade.
		req.onblocked = () => reject(new Error('meshCache upgrade blocked by another open tab'))
		req.onsuccess = (e) => {
			_db = e.target.result
			_db.onversionchange = () => { _db.close(); _db = null }
			initMeshCacheCap()
			resolve(_db)
		}
		req.onerror = () => reject(req.error)
	})
}

// WHY onabort everywhere: an aborted txn settles NEITHER oncomplete nor onerror — awaiting
// callers hang forever (bit us on qs-objects: a hung purge silently starved the whole scene).
function txDone(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = resolve
		tx.onerror = () => reject(tx.error ?? new Error('meshCache txn error'))
		tx.onabort = () => reject(tx.error ?? new Error('meshCache txn aborted'))
	})
}

// WHY watchdog: a readonly get that NEVER settles — a silently-stuck txn fires NEITHER
// onsuccess/onerror NOR onabort (observed live 2026-06-19: 12 mesh reads frozen indefinitely on a
// warm region after a heavy load + circuit swap) — hangs the awaiting caller forever. useMeshFetch
// awaits this read INSIDE its in-flight slot (active++ before the 30s network timer is armed), so a
// hung read permanently consumes a slot with NO timeout (diag ⏱0) and never emits MESH_FETCH → all
// MAX_INFLIGHT slots leak → the whole mesh queue wedges and objects stay placeholder cubes. Past the
// watchdog we declare a MISS; the caller falls through to a network fetch (slow-but-alive instead of
// stuck). 30s matches texCacheGet (#11): only a genuinely-frozen txn trips it, not a merely-slow read
// whose onsuccess callback is queued behind main-thread long tasks.
const GET_WATCHDOG_MS = 30_000
let _watchdogTrips = 0
/** Count of get-watchdog trips this session (frozen-txn misses). For telemetry / tests. */
export function getMeshWatchdogTrips() { return _watchdogTrips }

export async function meshCacheGet(uuid, now = Date.now()) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			// readonly so 1000s of concurrent gets don't serialize behind a write-lock; the LRU
			// touch is deferred and batched (textureCache pattern).
			const timer = setTimeout(() => { _watchdogTrips++; resolve(null) }, GET_WATCHDOG_MS)
			const settle = (fn, v) => { clearTimeout(timer); fn(v) }
			const tx = db.transaction(STORE, 'readonly')
			tx.onabort = () => settle(reject, tx.error ?? new Error('get txn aborted'))
			const req = tx.objectStore(STORE).get(uuid)
			req.onsuccess = () => {
				const rec = req.result
				if (rec) _touchLater(uuid, now)
				const subs = rec ? rec.submeshes : null
				// 7·D: re-attach the rig block so a warm relog still runtime-skins worn attachments.
				// Rides as a non-indexed prop on the subs array (structured-clone drops array expando
				// props), so it's stored/read as its own record field. (rec.skinned was the AV-1 baked
				// flag — those records live under the retired `:skin2` key lane and are never read.)
				if (rec && subs && rec.skin) subs.skin = rec.skin
				settle(resolve, subs)
			}
			req.onerror = () => settle(reject, req.error)
		})
	} catch { return null }
}

// Batched LRU touch: accumulate hit uuids and flush lastUsed in ONE readwrite tx every few
// seconds, so the hot read path never takes a write-lock. Best-effort — drops on error.
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
			tx.onabort = resolve
		})
	} catch { /* best-effort LRU */ }
}

/** Persist decoded submeshes by UUID, then evict LRU entries if over the byte cap. */
export async function meshCachePut(uuid, submeshes, now = Date.now()) {
	try {
		const db = await openDb()
		const bytes = submeshes.reduce((sum, s) =>
			sum + s.positions.byteLength + s.normals.byteLength +
			      s.uvs.byteLength + s.indices.byteLength +
			      (s.jointIndices?.byteLength || 0) + (s.jointWeights?.byteLength || 0), 0)
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			const st = tx.objectStore(STORE)
			const mt = tx.objectStore(META)
			const rec = { uuid, submeshes, bytes, lastUsed: now }
			if (submeshes.skin) rec.skin = submeshes.skin   // 7·D: rig block (see meshCacheGet re-attach)
			st.put(rec)
			let pending = null
			const finishStats = (total) => {
				const cReq = st.count()
				cReq.onsuccess = () => {
					mt.put({ k: 'stats', totalBytes: total, count: cReq.result })
					pending = { count: cReq.result, bytes: total }
				}
			}
			const mreq = mt.get('stats')
			mreq.onsuccess = () => {
				let total = (mreq.result?.totalBytes ?? 0) + bytes
				if (total <= _capBytes) {
					finishStats(total)
					return
				}
				// Over cap → walk the lastUsed index oldest-first, deleting until under cap. Skip
				// the row we just inserted (newest) so a single oversized put can't evict itself.
				const cur = st.index('lastUsed').openCursor()
				cur.onsuccess = () => {
					const c = cur.result
					if (!c || total <= _capBytes) { finishStats(total); return }
					if (c.value.uuid !== uuid) { total -= c.value.bytes; c.delete() }
					c.continue()
				}
			}
			tx.oncomplete = () => { if (pending) _lastStats = pending; resolve() }
			tx.onerror    = () => reject(tx.error ?? new Error('put txn error'))
			tx.onabort    = () => reject(tx.error ?? new Error('put txn aborted'))
		})
	} catch { /* ignore */ }
}

/** Returns { count, bytes, capBytes }. Served from memory once any put (or one successful read)
 * has run this session — see `_lastStats`. */
export async function getMeshCacheStats() {
	if (_lastStats) return { ..._lastStats, capBytes: _capBytes }
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq  = tx.objectStore(META).get('stats')
			let count = 0, bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess  = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => { _lastStats = { count, bytes }; resolve({ count, bytes, capBytes: _capBytes }) }
			tx.onerror = () => reject(tx.error)
			tx.onabort = () => reject(tx.error ?? new Error('stats txn aborted'))
		})
	} catch { return { count: 0, bytes: 0, capBytes: _capBytes } }
}

/** Clears all mesh cache entries and resets the totalBytes counter. */
export async function clearMeshCache() {
	try {
		const db = await openDb()
		const tx = db.transaction([STORE, META], 'readwrite')
		const done = txDone(tx)
		tx.objectStore(STORE).clear()
		tx.objectStore(META).put({ k: 'stats', totalBytes: 0, count: 0 })
		await done
		_lastStats = { count: 0, bytes: 0 }
	} catch { /* ignore */ }
}
