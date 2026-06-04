// src/lib/meshCache.js — IndexedDB cache of decoded mesh geometry by asset UUID (immutable assets).
// Stores the submeshes JSON so re-entry/relogin skips the fetch + server decode.
const DB_NAME = 'qs-mesh', DB_VERSION = 1, STORE = 'mesh'
export const meshDbConfig = { store: STORE, keyPath: 'uuid' }

let _db = null
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE, { keyPath: 'uuid' })
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
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).put({ uuid, submeshes })
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
