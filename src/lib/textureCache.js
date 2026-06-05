// src/lib/textureCache.js — persistent (IndexedDB) cache of decoded textures, keyed by asset UUID.
// WHY: textures are immutable by UUID and a region pulls hundreds-to-thousands of them. Without
// persistence every reload/relogin re-fetches + re-transcodes the whole scene (slow + hammers the
// sim). This is our portable equivalent of Firestorm's on-disk texture cache: store the PNG data
// URL by UUID, survive reloads, evict least-recently-fetched once a configurable size cap is hit.
// (A second, server-side tier can come later once self-hosted on VPS/NAS.)
const DB_NAME    = 'qs-tex'
const DB_VERSION = 1
const STORE      = 'tex'      // { uuid, url, bytes, lastUsed }
const META       = 'meta'     // { k:'stats', totalBytes }

// Default cap for cached PNG data URLs. 512 MB was an arbitrary early guess; with server-side
// downscaling to ≤512px each texture is far smaller, so we can hold a whole region (and more) for
// fast re-logins. 4 GB here (FS desktop caches use ~15 GB, but IndexedDB is bounded by the browser's
// per-origin quota — typically a fraction of free disk — so the browser may evict below this anyway).
// A real preference can drive this later.
export const TEX_CACHE_CAP_BYTES = 8 * 1024 * 1024 * 1024

let _db = null

function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			const s = db.createObjectStore(STORE, { keyPath: 'uuid' })
			s.createIndex('lastUsed', 'lastUsed')
			db.createObjectStore(META, { keyPath: 'k' })
		}
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
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
 * Look up a cached texture by UUID. Touches lastUsed (LRU). Returns `{ url, hasAlpha }` or null on
 * miss. `hasAlpha` (whether the PNG carries real transparency) rides along so the client can pick
 * blend-vs-opaque without re-fetching; old records pre-dating the field read as `false`.
 */
export async function texCacheGet(uuid, now = Date.now()) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx  = db.transaction(STORE, 'readwrite')
			const st  = tx.objectStore(STORE)
			const req = st.get(uuid)
			req.onsuccess = () => {
				const rec = req.result
				if (rec) { rec.lastUsed = now; st.put(rec) }
				resolve(rec ? { url: rec.url, hasAlpha: !!rec.hasAlpha } : null)
			}
			req.onerror = () => reject(req.error)
		})
	} catch (e) {
		console.warn('[TexCache] get failed:', e)
		return null
	}
}

/** Persist a texture data URL by UUID, then evict LRU entries if over the size cap. */
export async function texCachePut(uuid, url, hasAlpha = false, now = Date.now()) {
	try {
		const db = await openDb()
		const bytes = url.length
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			const st = tx.objectStore(STORE)
			const mt = tx.objectStore(META)
			st.put({ uuid, url, bytes, hasAlpha, lastUsed: now })
			const mreq = mt.get('stats')
			mreq.onsuccess = () => {
				let total = (mreq.result?.totalBytes ?? 0) + bytes
				if (total <= TEX_CACHE_CAP_BYTES) {
					mt.put({ k: 'stats', totalBytes: total })
					return
				}
				// Over cap → walk the lastUsed index oldest-first, deleting until under cap. Skip the
				// row we just inserted (newest) so a single oversized put can't evict itself.
				const cur = st.index('lastUsed').openCursor()
				cur.onsuccess = () => {
					const c = cur.result
					if (!c || total <= TEX_CACHE_CAP_BYTES) { mt.put({ k: 'stats', totalBytes: total }); return }
					if (c.value.uuid !== uuid) { total -= c.value.bytes; c.delete() }
					c.continue()
				}
			}
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[TexCache] put failed:', e)
	}
}

/** Returns { count, bytes, capBytes } for the texture cache. */
export async function getTextureCacheStats() {
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
			tx.oncomplete = () => resolve({ count, bytes, capBytes: TEX_CACHE_CAP_BYTES })
			tx.onerror = () => reject(tx.error)
		})
	} catch { return { count: 0, bytes: 0, capBytes: TEX_CACHE_CAP_BYTES } }
}

/** Clears all texture cache entries and resets the totalBytes counter. */
export async function clearTextureCache() {
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
