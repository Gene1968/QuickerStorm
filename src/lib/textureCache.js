// src/lib/textureCache.js — persistent (IndexedDB) cache of decoded textures, keyed by asset UUID.
// WHY: textures are immutable by UUID and a region pulls hundreds-to-thousands of them. Without
// persistence every reload/relogin re-fetches + re-transcodes the whole scene (slow + hammers the
// sim). This is our portable equivalent of Firestorm's on-disk texture cache: store the PNG data
// URL by UUID, survive reloads, evict least-recently-fetched once a configurable size cap is hit.
// (A second, server-side tier can come later once self-hosted on VPS/NAS.)
const DB_NAME    = 'qs-tex'
const DB_VERSION = 2
const STORE      = 'tex'      // { uuid, url, bytes, lastUsed }
const META       = 'meta'     // { k:'stats', totalBytes }
const FAILED     = 'failed'   // { uuid, ts } — permanent decode/404 failures with TTL

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
			if (!db.objectStoreNames.contains(STORE)) {
				const s = db.createObjectStore(STORE, { keyPath: 'uuid' })
				s.createIndex('lastUsed', 'lastUsed')
			}
			if (!db.objectStoreNames.contains(META))   db.createObjectStore(META,   { keyPath: 'k' })
			if (!db.objectStoreNames.contains(FAILED)) db.createObjectStore(FAILED, { keyPath: 'uuid' })
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
			// WHY readonly: a region replay fires 1000s of texCacheGet at once. A readwrite tx (to
			// touch lastUsed) takes a store write-lock, so IndexedDB SERIALIZES them all one-at-a-time
			// → textures trickle in (white scene). readonly tx run concurrently. LRU instead tracks
			// lastUsed at put-time (age-since-cached); a cache hit defers a batched touch (see below).
			const tx  = db.transaction(STORE, 'readonly')
			const req = tx.objectStore(STORE).get(uuid)
			req.onsuccess = () => {
				const rec = req.result
				if (rec) _touchLater(uuid, now)
				resolve(rec ? { url: rec.url, hasAlpha: !!rec.hasAlpha } : null)
			}
			req.onerror = () => reject(req.error)
		})
	} catch (e) {
		console.warn('[TexCache] get failed:', e)
		return null
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
		})
	} catch { /* best-effort LRU */ }
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
			const req = db.transaction(FAILED, 'readonly').objectStore(FAILED).getAll()
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
		})
	} catch { /* best-effort */ }
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
