// src/lib/inventoryCache.js — IndexedDB persistence for inventory items.
// WHY: FetchInventoryDescendents2 takes 5-10 min for large inventories and the HTTP cap is
// unreliable (hanging requests, grid restarts). Cache gives instant display of last-known
// inventory and makes the session-start experience independent of grid cap latency.
// Cache is keyed by agentId so multiple accounts on the same browser stay separate.
const DB_NAME    = 'qs-inv'
const DB_VERSION = 1
const STORE      = 'snapshots'

let _db = null

function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			e.target.result.createObjectStore(STORE, { keyPath: 'agentId' })
		}
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
		req.onerror   = () => reject(req.error)
	})
}

/** Load cached item pairs for this agent. Returns null if nothing cached. */
export async function loadCachedInventory(agentId) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx  = db.transaction(STORE, 'readonly')
			const req = tx.objectStore(STORE).get(agentId)
			req.onsuccess = () => resolve(req.result ?? null)
			req.onerror   = () => reject(req.error)
		})
	} catch (e) {
		console.warn('[InvCache] load failed:', e)
		return null
	}
}

/** Persist item pairs for this agent. itemPairs: [[folderId, Item[]]...] */
export async function saveCachedInventory(agentId, itemPairs) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx  = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).put({ agentId, savedAt: Date.now(), itemPairs })
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[InvCache] save failed:', e)
	}
}
