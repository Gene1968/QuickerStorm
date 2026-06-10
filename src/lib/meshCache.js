// src/lib/meshCache.js — IndexedDB cache of decoded mesh geometry by asset UUID (immutable assets).
// Stores the submeshes JSON so re-entry/relogin skips the fetch + server decode.
// v2: adds 'meta' store for totalBytes tracking (mirrors textureCache pattern), eliminates O(n)
// cursor walk in getMeshCacheStats so count/size queries are instant even under write pressure.
const DB_NAME = 'qs-mesh', DB_VERSION = 2, STORE = 'mesh', META = 'meta'
export const meshDbConfig = { store: STORE, keyPath: 'uuid' }

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
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'uuid' })
			if (!db.objectStoreNames.contains(META))  db.createObjectStore(META,  { keyPath: 'k' })
		}
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
		req.onerror = () => reject(req.error)
	})
}

export async function meshCacheGet(uuid) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(uuid)
			req.onsuccess = () => resolve(req.result ? req.result.submeshes : null)
			req.onerror = () => reject(req.error)
		})
	} catch { return null }
}

export async function meshCachePut(uuid, submeshes) {
	try {
		const db = await openDb()
		const bytes = submeshes.reduce((sum, s) =>
			sum + s.positions.byteLength + s.normals.byteLength +
			      s.uvs.byteLength + s.indices.byteLength, 0)
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).put({ uuid, submeshes, bytes })
			let pending = null
			const mreq = tx.objectStore(META).get('stats')
			mreq.onsuccess = () => {
				const total = (mreq.result?.totalBytes ?? 0) + bytes
				const cReq = tx.objectStore(STORE).count()
				cReq.onsuccess = () => {
					tx.objectStore(META).put({ k: 'stats', totalBytes: total, count: cReq.result })
					pending = { count: cReq.result, bytes: total }
				}
			}
			tx.oncomplete = () => { if (pending) _lastStats = pending; resolve() }
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}

/** Returns { count, bytes }. Served from memory once any put (or one successful read) has run
 * this session — see `_lastStats`. */
export async function getMeshCacheStats() {
	if (_lastStats) return { ..._lastStats }
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq  = tx.objectStore(META).get('stats')
			let count = 0, bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess  = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => { _lastStats = { count, bytes }; resolve({ count, bytes }) }
			tx.onerror = () => reject(tx.error)
		})
	} catch { return { count: 0, bytes: 0 } }
}

/** Clears all mesh cache entries and resets the totalBytes counter. */
export async function clearMeshCache() {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).clear()
			tx.objectStore(META).put({ k: 'stats', totalBytes: 0, count: 0 })
			tx.oncomplete = () => { _lastStats = { count: 0, bytes: 0 }; resolve() }
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
