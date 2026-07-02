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
 *
 * @param isFetched  optional (folderId)=>boolean. When supplied, the save MERGES itemPairs with the
 *   previously-cached itemPairs at the FOLDER level (mergeItemPairs): a folder actually FETCHED this
 *   session is authoritative (its current list wins, even if empty = genuinely empty), but a folder
 *   NOT fetched keeps its previously-cached list. WHY: a premature allAgentFetched save or a debounced
 *   mutation-save must never persist a snapshot SMALLER than last-known for a folder that simply hasn't
 *   been re-fetched yet — that is the PERMANENT DATA LOSS this fix prevents. Omit for a blind overwrite
 *   (e.g. tests / a full authoritative snapshot).
 */
export async function saveCachedInventory(agentId, itemPairs, isFetched = null, folderPairs = null) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx    = db.transaction(STORE, 'readwrite')
			const store = tx.objectStore(STORE)
			const getReq = store.get(agentId)
			getReq.onsuccess = () => {
				const prev = getReq.result
				const nextItemPairs = isFetched
					? mergeItemPairs(prev?.itemPairs, itemPairs, isFetched)
					: itemPairs
				store.put({
					agentId,
					savedAt:     Date.now(),
					itemPairs:   nextItemPairs,
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
					// WHY union, not overwrite: the in-memory folders Map can transiently DROP a folder
					// (mid-fetch reconcile, a killObject race, an unfinished login skeleton) — mirroring it
					// wholesale would SHRINK the cache and permanently lose a write-back-lag survivor. Union
					// by folderId preferring the current in-memory copy keeps the newest edit while never
					// letting a transient drop erase a folder the cache already knew about.
					folderPairs: mergeFolderPairs(prev?.folderPairs, folderPairs),
				})
			}
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[InvCache] folder save failed:', e)
	}
}

/**
 * Union two [[folderId, Folder]...] lists by folderId, preferring `next` (the current in-memory copy)
 * over `prev` (the previously-cached copy). WHY: a save must never SHRINK the folder cache — a folder
 * present in prev but transiently missing from next survives.
 */
function mergeFolderPairs(prev, next) {
	const m = new Map()
	for (const p of (prev || [])) { if (Array.isArray(p) && p[0]) m.set(p[0], p[1]) }
	for (const p of (next || [])) { if (Array.isArray(p) && p[0]) m.set(p[0], p[1]) }
	return [...m.entries()]
}

/**
 * Merge two [[folderId, Item[]]...] lists so an item-cache save can NEVER SHRINK a folder that
 * simply hasn't been re-fetched this session. For each folderId known to prev or next:
 *   • FETCHED this session (isFetched(folderId) === true): the `next` list is authoritative — use it
 *     (even shrunk, or absent = genuinely empty → drop the folder for compactness). This is how a real
 *     purge/trash from a fetched folder persists.
 *   • NOT fetched: keep the previously-cached `prev` list (a transient empty in-memory list, or a
 *     folder not yet loaded, must not erase last-known items).
 * `next` typically comes from makeInvSavePairs (empty fetched folders already skipped for compactness);
 * this helper only ever ADDS BACK unfetched folders' cached items, never re-injects into a fetched one.
 *
 * @param prev       previously-cached itemPairs (or null)
 * @param next       current-session itemPairs to persist
 * @param isFetched  (folderId)=>boolean — was this folder actually fetched this session?
 * @returns {Array<[string, object[]]>}
 */
export function mergeItemPairs(prev, next, isFetched) {
	const fetchedCheck = typeof isFetched === 'function' ? isFetched : () => true
	const nextMap = new Map()
	for (const p of (next || [])) { if (Array.isArray(p) && p[0]) nextMap.set(p[0], p[1]) }
	const out = new Map(nextMap)
	for (const p of (prev || [])) {
		if (!Array.isArray(p) || !p[0]) continue
		const folderId = p[0]
		// A fetched folder is authoritative — never resurrect its previously-cached list.
		if (fetchedCheck(folderId)) continue
		// Unfetched: only keep the cached list if this session didn't already supply one.
		if (!nextMap.has(folderId)) out.set(folderId, p[1])
	}
	return [...out.entries()]
}

/**
 * Remove a single folder (by folderId) from this agent's cached folderPairs, leaving itemPairs and all
 * other folders untouched. WHY: saveCachedFolders UNIONS prev+next (never shrinks) so it can't drop a
 * folder — but a rejected optimistic create (INV_FOLDER_CREATE_FAILED) must be dropped from the IDB
 * snapshot, else applyFolderCache resurrects the (dirty) folder on the next reload.
 */
export async function removeCachedFolder(agentId, folderId) {
	if (!agentId || !folderId) return
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx    = db.transaction(STORE, 'readwrite')
			const store = tx.objectStore(STORE)
			const getReq = store.get(agentId)
			getReq.onsuccess = () => {
				const prev = getReq.result
				if (!prev) { resolve(); return }
				const folderPairs = (prev.folderPairs || []).filter(p => !(Array.isArray(p) && p[0] === folderId))
				store.put({ ...prev, savedAt: Date.now(), folderPairs })
			}
			tx.oncomplete = resolve
			tx.onerror    = () => reject(tx.error)
		})
	} catch (e) {
		console.warn('[InvCache] folder remove failed:', e)
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
