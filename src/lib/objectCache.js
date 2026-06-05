// src/lib/objectCache.js — persistent (IndexedDB) cache of decoded scene objects, per region.
// WHY: textures/meshes are cached by UUID, but the OBJECT data (prim shape, pos, rot, scale, which
// texture, linkset parent) is re-streamed from the sim on every login via the slow cache-miss flow
// — so reload goes white until thousands of ObjectUpdates re-arrive (and ~half never do). Persisting
// the decoded objects lets us repaint the whole scene INSTANTLY on reload, then let live updates
// correct it. This is our portable equivalent of Firestorm's on-disk object cache.
//
// Keyed by region (global X/Y coords — stable across sessions, unique per region on the grid). The
// whole object set for a region is stored as one record; we overwrite it when the scene settles.
const DB_NAME    = 'qs-objects'
const DB_VERSION = 1
const STORE      = 'regions'    // { key, objects:[], savedAt, count }

// Keep at most this many regions cached (LRU by savedAt) so the DB can't grow without bound.
const MAX_REGIONS = 12

let _db = null
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			const s = db.createObjectStore(STORE, { keyPath: 'key' })
			s.createIndex('savedAt', 'savedAt')
		}
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
		req.onerror   = () => reject(req.error)
	})
}

/** Load the cached object array for a region key (or null on miss). */
export async function objCacheLoad(key) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
			req.onsuccess = () => resolve(req.result ? req.result.objects : null)
			req.onerror   = () => reject(req.error)
		})
	} catch (e) { console.warn('[ObjCache] load failed:', e); return null }
}

/** Overwrite the cached objects for a region key, then evict oldest regions beyond MAX_REGIONS. */
export async function objCacheSave(key, objects, now = Date.now()) {
	try {
		// WHY: worldStore objects are Vue reactive proxies; IndexedDB's structured-clone throws
		// DataCloneError on those (and on any stray function/undefined). A JSON round-trip yields a
		// plain, fully-cloneable snapshot — the decoded object fields are all JSON-safe (numbers,
		// strings, arrays, plain shape objects).
		const plain = JSON.parse(JSON.stringify(objects))
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE)
			st.put({ key, objects: plain, savedAt: now, count: plain.length })
			// LRU evict: walk savedAt oldest-first, deleting until count ≤ MAX_REGIONS.
			const countReq = st.count()
			countReq.onsuccess = () => {
				let over = countReq.result - MAX_REGIONS
				if (over <= 0) return
				const cur = st.index('savedAt').openCursor()
				cur.onsuccess = () => {
					const c = cur.result
					if (!c || over <= 0) return
					if (c.value.key !== key) { c.delete(); over-- }
					c.continue()
				}
			}
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) { console.warn('[ObjCache] save failed:', e) }
}

/** Stats for the Preferences UI: { regions, objects } across all cached regions. */
export async function getObjectCacheStats() {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
			req.onsuccess = () => {
				const rows = req.result || []
				resolve({ regions: rows.length, objects: rows.reduce((s, r) => s + (r.count || 0), 0) })
			}
			req.onerror = () => reject(req.error)
		})
	} catch { return { regions: 0, objects: 0 } }
}

/** Clear one region's cache. */
export async function objCacheClearRegion(key) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).delete(key)
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}

/** Clear all cached regions. */
export async function objCacheClearAll() {
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
