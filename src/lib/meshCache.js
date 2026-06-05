// src/lib/meshCache.js — IndexedDB cache of decoded mesh geometry by asset UUID (immutable assets).
// Stores the submeshes JSON so re-entry/relogin skips the fetch + server decode.
// v2: adds 'meta' store for totalBytes tracking (mirrors textureCache pattern), eliminates O(n)
// cursor walk in getMeshCacheStats so count/size queries are instant even under write pressure.
const DB_NAME = 'qs-mesh', DB_VERSION = 2, STORE = 'mesh', META = 'meta'
export const meshDbConfig = { store: STORE, keyPath: 'uuid' }

let _db = null
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
			const mreq = tx.objectStore(META).get('stats')
			mreq.onsuccess = () => {
				const total = (mreq.result?.totalBytes ?? 0) + bytes
				tx.objectStore(META).put({ k: 'stats', totalBytes: total })
			}
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}

/** Returns { count, bytes } — instant: count() + single meta get(), no cursor walk. */
export async function getMeshCacheStats() {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq  = tx.objectStore(META).get('stats')
			let count = 0, bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess  = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => resolve({ count, bytes })
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
			tx.objectStore(META).put({ k: 'stats', totalBytes: 0 })
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
