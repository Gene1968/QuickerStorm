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
		const bytes = submeshes.reduce((sum, s) =>
			sum + s.positions.byteLength + s.normals.byteLength +
			      s.uvs.byteLength + s.indices.byteLength, 0)
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).put({ uuid, submeshes, bytes })
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}

/** Returns { count, bytes } for the mesh cache. Old records without `bytes` field count as 0. */
export async function getMeshCacheStats() {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readonly')
			const st = tx.objectStore(STORE)
			const countReq = st.count()
			let count = 0
			let bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			const cursor = st.openCursor()
			cursor.onsuccess = () => {
				const c = cursor.result
				if (c) { bytes += c.value.bytes ?? 0; c.continue() }
			}
			tx.oncomplete = () => resolve({ count, bytes })
			tx.onerror = () => reject(tx.error)
		})
	} catch { return { count: 0, bytes: 0 } }
}

/** Removes all entries from the mesh cache. */
export async function clearMeshCache() {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).clear()
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
