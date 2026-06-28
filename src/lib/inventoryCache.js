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

/**
 * Persist item pairs for this agent. itemPairs: [[folderId, Item[]]...].
 * Preserves any previously-cached folderPairs so a full item-save doesn't drop folders the
 * micro-save persisted (write-back-lag survivors). Pass folderPairs to overwrite them too.
 */
export async function saveCachedInventory(agentId, itemPairs, folderPairs = null) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx    = db.transaction(STORE, 'readwrite')
			const store = tx.objectStore(STORE)
			const getReq = store.get(agentId)
			getReq.onsuccess = () => {
				const prev = getReq.result
				store.put({
					agentId,
					savedAt:     Date.now(),
					itemPairs,
					// WHY: keep last-known folderPairs unless this save explicitly supplies them.
					folderPairs: folderPairs ?? prev?.folderPairs ?? [],
				})
			}
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[InvCache] save failed:', e)
	}
}

/**
 * Persist ONLY the folder skeleton for this agent, leaving cached itemPairs untouched.
 * WHY: a freshly created folder's cap returns 200 from the region cache, but the grid Robust
 * write-back lags — a hard reload minutes later can re-fetch before the write lands and the folder
 * vanishes. Micro-saving folders on optimistic-create keeps them in the IDB snapshot so they
 * survive a reload and quietly sync out once the grid catches up. folderPairs: [[folderId, Folder]...]
 */
export async function saveCachedFolders(agentId, folderPairs) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx    = db.transaction(STORE, 'readwrite')
			const store = tx.objectStore(STORE)
			const getReq = store.get(agentId)
			getReq.onsuccess = () => {
				const prev = getReq.result
				store.put({
					agentId,
					savedAt:     Date.now(),
					itemPairs:   prev?.itemPairs ?? [],
					folderPairs: folderPairs || [],
				})
			}
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[InvCache] folder save failed:', e)
	}
}

/** Remove the cached snapshot for this agent (e.g. on logout or account switch). */
export async function clearCachedInventory(agentId) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx  = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).delete(agentId)
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[InvCache] clear failed:', e)
	}
}

/**
 * Build the [[folderId, Item[]]...] pairs array from the store's items Map,
 * skipping empty folders so the snapshot stays compact.
 * WHY: extracted so useInventory.js and any future save path share one conversion.
 * @param {Map<string, object[]>} itemsMap — inventoryStore.items.value
 * @returns {Array<[string, object[]]>}
 */
export function makeInvSavePairs(itemsMap) {
	const pairs = []
	itemsMap.forEach((list, folderId) => {
		if (list.length > 0) pairs.push([folderId, list])
	})
	return pairs
}

/**
 * Build [[folderId, Folder]...] pairs from the store's folders Map, keeping only AGENT-source
 * folders (the shared Library is server-owned and re-arrives free in the login skeleton, so it
 * needn't be cached). WHY: this is what survives write-back lag — a created folder must reappear
 * from the snapshot on reload even before the grid Robust write lands.
 * @param {Map<string, object>} foldersMap — inventoryStore.folders.value
 * @returns {Array<[string, object]>}
 */
export function foldersToPairs(foldersMap) {
	const pairs = []
	foldersMap.forEach((f, folderId) => {
		// WHY: spread into a plain object — store rows are Vue reactive Proxies, and IndexedDB's
		// structured-clone can't serialize a Proxy (the put hangs/errors). A shallow copy of the flat
		// folder fields is plain and clonable.
		if (f && f.source !== 'library') pairs.push([folderId, { ...f }])
	})
	return pairs
}
