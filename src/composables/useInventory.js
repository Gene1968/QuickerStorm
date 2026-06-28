// src/composables/useInventory.js — drives lazy + bulk folder-content fetches over the cap layer.
// Folder TREE comes from the login skeleton (inventoryStore.loadFromLogin). Folder ITEMS are
// fetched here: expanding a folder (or the background loader) → C.INV_FETCH_FOLDER →
// server FetchInventoryDescendents2 → S.INV_FOLDER → inventoryStore.setItems.
// IndexedDB cache: items are pre-populated from last session so inventory is instant, then
// the cap fetch runs in the background and overwrites with current grid data.
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useWorldStore } from '@/stores/worldStore'
import { loadCachedInventory, saveCachedInventory, makeInvSavePairs } from '@/lib/inventoryCache'
import { C, S } from '@shared/protocol.js'

const BATCH        = 40   // folders per cap POST (server batches them into one request)
const MAX_INFLIGHT = 80   // cap on folders awaiting reply during the background bulk load
const PUMP_MS      = 150

// Defer the background full-inventory walk while the region is still loading assets, so it doesn't peg
// the client main thread and starve region texture/mesh load on a cold load (FEATURE-GAPS cold-pipeline
// #2). The earlier wall-clock ceiling (240s) was WRONG for heavy regions: a ~10k-object region is still
// actively loading at 4 min, so the ceiling released inventory INTO the live load and the stall returned,
// just delayed (live-confirmed 2026-06-18 — tex q plateaued ~1100 for ~10 min the instant the ceiling
// fired). Gate on FORWARD PROGRESS instead: keep deferring while assets keep completing; release only on
// genuine idle (drained), a real no-progress stall (region wedged — never-starve inventory), a region
// that never showed load (prepopulate timeout), or a generous absolute ceiling (final safety).
export const FETCHALL_STALL_MS         = 30_000    // no asset completions for this long while loading → release
export const FETCHALL_PREPOPULATE_MS   = 20_000    // region never showed load within this of caps-ready → release
export const FETCHALL_DEFER_CEILING_MS = 900_000   // absolute safety cap; the stall backstop is the real release

/**
 * Decide whether to HOLD the background inventory walk this tick.
 * @param sawLoading       have we ever observed the region loading (populated at least once)?
 * @param sceneLoading     is the region loading assets right now?
 * @param msSinceProgress  ms since the asset-completion counter last advanced
 * @param msSinceCapsReady ms since caps became ready (prepopulate window + absolute ceiling measured here)
 */
export function shouldDeferInventoryWalk(sawLoading, sceneLoading, msSinceProgress, msSinceCapsReady,
	{ stallMs = FETCHALL_STALL_MS, prepopulateMs = FETCHALL_PREPOPULATE_MS, ceilingMs = FETCHALL_DEFER_CEILING_MS } = {}) {
	if (msSinceCapsReady >= ceilingMs) return false        // absolute last-ditch: never defer forever
	if (!sawLoading) return msSinceCapsReady < prepopulateMs   // wait (bounded) for the region to start loading
	if (!sceneLoading) return false                        // region drained/idle → walk now
	return msSinceProgress < stallMs                       // loading + progressing → defer; stalled → walk
}

let registered = false
let pump = null
let capsReadyAt = 0    // performance.now() at caps-ready; prepopulate window + absolute ceiling measured from here
// Bulk-walk gate progress tracking (reset per login in onCapsReady):
let _sawLoading = false       // region has shown load activity at least once (guards the premature-open race)
let _lastProgress = -1        // last seen worldStore.assetProgress value
let _lastProgressAt = 0       // performance.now() when assetProgress last advanced
// WHY: mutation-save watcher stopper; module-level so re-login can cancel the previous login's watcher.
let _stopMutationSave = null

export function useInventory() {
	const { on, off, emit } = useRealtimeSocket()
	const inv     = useInventoryStore()
	const session = useSessionStore()
	const world   = useWorldStore()

	// Fetch one or more folders' items in a single batched cap request.
	function fetchFolders(ids) {
		const todo = (ids || []).filter(id => id && !inv.isFetched(id) && !inv.isFetching(id))
		if (todo.length === 0) return
		// WHY: caps arrive ~3s after login. If not ready, skip — CAPS_READY refetches expanded
		// folders and (re)starts the background loader once caps land.
		if (!inv.capsReady) return
		for (const id of todo) inv.markFetching(id)
		for (let i = 0; i < todo.length; i += BATCH) {
			emit(C.INV_FETCH_FOLDER, { folderIds: todo.slice(i, i + BATCH) })
		}
	}

	function fetchFolder(folderId) { if (folderId) fetchFolders([folderId]) }

	// Background bulk loader: walk every agent folder so the grand total becomes exact (FS-style).
	// Paced + in-flight-capped so we don't flood the sim's cap endpoint.
	function fetchAll() {
		if (pump) return
		pump = setInterval(() => {
			if (!inv.capsReady) return
			// Hold the full walk while the region is still actively loading assets — see
			// shouldDeferInventoryWalk. Track region activity (latch) + asset forward-progress so a heavy
			// region keeps inventory deferred for its WHOLE load (not just a fixed wall-clock window).
			const now = performance.now()
			const prog = world.assetProgress | 0
			if (world.sceneLoading || prog > _lastProgress) _sawLoading = true   // region has shown activity
			if (prog > _lastProgress) { _lastProgress = prog; _lastProgressAt = now }   // assets advanced → reset stall timer
			if (shouldDeferInventoryWalk(_sawLoading, world.sceneLoading, now - _lastProgressAt, now - capsReadyAt)) return
			const slots = MAX_INFLIGHT - inv.fetching.size
			const pending = inv.pendingAgentFolders()
			if (pending.length === 0 && inv.fetching.size === 0) { stopFetchAll(); return }
			if (slots > 0 && pending.length > 0) fetchFolders(pending.slice(0, slots))
		}, PUMP_MS)
	}
	function stopFetchAll() { if (pump) { clearInterval(pump); pump = null } }

	function onInvFolder(d) {
		if (!d?.folderId) return
		if (d.error === 'cap_unavailable') {
			// WHY: mark as fetched (empty) so the pump doesn't retry this folder forever.
			// cap_unavailable only arrives when capsReady=true (fetchFolders guards on it),
			// so if the server still can't find the cap URL it's a session inconsistency —
			// retrying won't help and causes an infinite hot loop.
			console.warn('[INV] cap_unavailable for folder', d.folderId, '— marking fetched to stop retry')
			inv.setItems(d.folderId, [])
			return
		}
		inv.setItems(d.folderId, d.items || [])
		// Ingest subfolders the sim reports under this folder. addFolderOptimistic no-ops if the
		// folder already exists (skeleton), so this only surfaces folders created since login
		// (e.g. via the CreateInventoryCategory cap) — the tree self-heals from live fetches.
		for (const sf of (d.subfolders || [])) {
			if (sf?.folderId) inv.addFolderOptimistic({ folderId: sf.folderId, parentId: sf.parentId, name: sf.name, typeDefault: sf.typeDefault ?? -1 })
		}
	}

	// Load IndexedDB cache for this agent, pre-populating items without marking folders fetched.
	// WHY: the cap fetch still runs normally and overwrites stale data; this just makes the
	// inventory appear instantly instead of spinning for minutes.
	async function loadCache() {
		const agentId = session.agentId
		if (!agentId || inv.cacheLoaded) return
		try {
			const cached = await loadCachedInventory(agentId)
			if (cached?.itemPairs?.length) {
				inv.applyCachedItems(cached.itemPairs)
			} else {
				// No cache yet — mark loaded so we don't attempt again this session.
				inv.applyCachedItems([])
			}
		} catch (e) {
			console.warn('[InvCache] load error:', e)
			inv.applyCachedItems([])
		}
	}

	async function onCapsReady(d) {
		inv.setCaps(d?.caps || [])
		// Reset the bulk-walk gate's per-login state so a fresh login/region starts clean (module-level
		// state survives SPA re-login). _lastProgressAt seeds from now so the stall timer isn't pre-tripped.
		capsReadyAt = performance.now()
		_sawLoading = false
		_lastProgress = -1
		_lastProgressAt = capsReadyAt
		// Load cache BEFORE starting fetches so items appear immediately.
		await loadCache()
		// WHY: one-shot save watcher registered here (not at module level) so it is fresh for
		// every login, including SPA re-logins where module-level flags would stay true after the
		// previous WorldView unmounted. Calls stopSave() on first fire so it doesn't re-run.
		const stopSave = watch(() => inv.allAgentFetched, async (done) => {
			if (!done || !session.agentId) return
			stopSave()
			await saveCachedInventory(session.agentId, makeInvSavePairs(inv.items))
		})
		// WHY: debounced mutation-save so rename/move/trash/perm changes are reflected in the
		// next-login snapshot. Fires on itemCount changes ONLY after the initial cache hydration
		// is complete (cacheLoaded=true) so we don't thrash IDB during the bulk fetch storm.
		// 1.5 s debounce collapses bursts (BulkUpdateInventory can deliver 20+ items at once).
		let _mutateSaveTimer = null
		const stopMutationSave = watch(() => inv.itemCount, () => {
			if (!inv.cacheLoaded || !session.agentId) return
			clearTimeout(_mutateSaveTimer)
			_mutateSaveTimer = setTimeout(async () => {
				if (!session.agentId) return
				await saveCachedInventory(session.agentId, makeInvSavePairs(inv.items))
			}, 1500)
		})
		// Clean up the mutation watcher on the next login so a re-login starts fresh.
		// WHY: the outer onCapsReady is called again on re-login; each call registers a fresh pair
		// of watchers. Stop the previous login's mutation watcher to avoid double-writes.
		// Module-level ref so each onCapsReady can stop its predecessor.
		if (_stopMutationSave) _stopMutationSave()
		_stopMutationSave = stopMutationSave
		// Backfill folders the user expanded before caps were ready (root auto-expands on load).
		for (const id of inv.expanded) if (!inv.isFetched(id)) fetchFolder(id)
		// Kick off the background full load so totals reach the exact count.
		fetchAll()
	}

	// UpdateCreateInventoryItem reply → drop the new item(s) into their folder list immediately.
	function onItemCreated(d) { inv.addCreatedItems(d?.items || []) }

	// Ask the sim to create a landmark of the current location in `folderId`. The reply
	// (S.INV_ITEM_CREATED) lands the item in the store. desc = the user's "My notes".
	function createLandmark({ name, desc, folderId }) {
		if (!folderId) return
		emit(C.CREATE_LANDMARK, { name: name || 'Landmark', desc: desc || '', folderId })
	}

	// Create a new folder. The client owns the FolderID, so we generate it, tell the server (which
	// creates it via the CreateInventoryCategory cap), and optimistically add it to the tree.
	// Returns the id. rename=true (default) drops the new folder straight into inline-rename so the
	// user types its name immediately — matches Firestorm, and the cap persists whatever name lands.
	function createFolder({ name, parentId, typeDefault = -1, rename = true }) {
		if (!parentId) return ''
		const folderId = crypto.randomUUID()
		emit(C.CREATE_INV_FOLDER, { folderId, parentId, name: name || 'New Folder' })
		inv.addFolderOptimistic({ folderId, parentId, name: name || 'New Folder', typeDefault })
		if (rename) {
			// Ensure the parent is open so the new row renders, then enter inline-rename once its
			// TreeNode has mounted (nextTick = after the DOM update + child onMounted listener).
			if (!inv.isExpanded(parentId)) inv.toggle(parentId)
			nextTick(() => window.dispatchEvent(new CustomEvent('inv:begin-rename', { detail: { id: folderId, kind: 'folder' } })))
		}
		return folderId
	}

	// ── Inventory mutation (rename/move/trash/purge/perms/wear) ──
	// Each wrapper applies the optimistic store mutation first (instant UI), then emits the cap
	// request. The sim's authoritative reply (S.INV_BULK_UPDATE / S.INV_ITEM_REMOVED) reconciles.

	// Pull the full current item row so the server can rebuild UpdateInventoryItem with the
	// unchanged fields preserved (the sim requires a complete InventoryData block).
	function currentItem(itemId, folderId) {
		const list = inv.folderItems(folderId) || []
		return list.find(i => i.itemId === itemId) || null
	}

	// Map a fetched item row → the field names encodeUpdateInventoryItem expects, so the sim
	// rebuilds a complete InventoryData block (preserving unchanged fields + a valid CRC).
	// WHY the explicit mapping: the row uses `desc`, and a naive `...cur` spread both (a) leaks
	// the OLD `name` over a rename and (b) drops the description (row.desc ≠ encoder.description).
	function itemServerFields(cur) {
		if (!cur) return {}
		return {
			name:        cur.name,
			description: cur.desc,
			assetType:   cur.assetType,
			invType:     cur.invType,
			flags:       cur.flags,
			ownerMask:   cur.ownerMask,
			createdAt:   cur.createdAt,
		}
	}

	function renameItem(itemId, folderId, name) {
		if (!itemId || !name) return
		const cur = currentItem(itemId, folderId)
		inv.renameItemLocal(itemId, name)
		// Spread cur fields FIRST, then override `name` — else the old name clobbers the new one.
		emit(C.INV_RENAME_ITEM, { ...itemServerFields(cur), itemId, folderId, name })
	}

	function renameFolder(folderId, name) {
		if (!folderId || !name) return
		inv.renameFolderLocal(folderId, name)
		emit(C.INV_RENAME_FOLDER, { folderId, name })
	}

	function moveItem(itemId, toFolderId) {
		if (!itemId || !toFolderId) return
		inv.moveItemLocal(itemId, toFolderId)
		emit(C.INV_MOVE_ITEM, { itemId, toFolderId })
	}

	function moveFolder(folderId, toParentId) {
		if (!folderId || !toParentId) return
		inv.moveFolderLocal(folderId, toParentId)
		emit(C.INV_MOVE_FOLDER, { folderId, toParentId })
	}

	function trashItem(itemId) {
		if (!itemId) return
		const trashFolderId = inv.findSystemFolder(14)
		inv.moveItemLocal(itemId, trashFolderId)
		emit(C.INV_TRASH_ITEM, { itemId, trashFolderId })
	}

	function trashFolder(folderId) {
		if (!folderId) return
		const trashFolderId = inv.findSystemFolder(14)
		inv.moveFolderLocal(folderId, trashFolderId)
		emit(C.INV_TRASH_FOLDER, { folderId, trashFolderId })
	}

	function purgeItem(itemId) {
		if (!itemId) return
		inv.removeItemLocal(itemId)
		emit(C.INV_PURGE_ITEM, { itemId })
	}

	function updatePerms(itemId, folderId, masks = {}) {
		if (!itemId) return
		const cur = currentItem(itemId, folderId)
		inv.updateItemPermsLocal(itemId, masks)
		// itemServerFields preserves name+description; masks override the permission fields last.
		emit(C.INV_UPDATE_PERMS, { ...itemServerFields(cur), itemId, folderId, ...masks })
	}

	function wearAttachment(itemId, attachPoint = 0) {
		if (!itemId) return
		emit(C.INV_WEAR_ATTACHMENT, { itemId, attachPoint })
	}

	function detach(itemId) {
		if (!itemId) return
		emit(C.INV_DETACH, { itemId })
	}

	onMounted(() => {
		if (!registered) {
			on(S.INV_FOLDER,       onInvFolder)
			on(S.CAPS_READY,       onCapsReady)
			on(S.INV_ITEM_CREATED, onItemCreated)
			on(S.INV_BULK_UPDATE,  d => inv.applyBulkUpdate(d || {}))
			on(S.INV_ITEM_REMOVED, d => (d?.itemIds || []).forEach(id => inv.removeItemLocal(id)))
			// CreateInventoryCategory cap confirmed the folder persisted — re-affirm it in the store
			// (server may have truncated the name); the optimistic add already used the same folderId.
			on(S.INV_FOLDER_CREATED, d => { if (d?.folderId) inv.addFolderOptimistic({ folderId: d.folderId, parentId: d.parentId, name: d.name, typeDefault: d.typeDefault ?? -1 }) })
			// Cap rejected the create — revert the optimistic folder so the tree matches the server.
			on(S.INV_FOLDER_CREATE_FAILED, d => { if (d?.folderId) inv.removeFolderLocal(d.folderId) })
			registered = true
		}
		// WHY: Safety net — if CAPS_READY arrived before this component mounted (edge case on fast
		// resume), inv.capsReady is already true but onCapsReady was never called. Kick off fetching.
		if (inv.capsReady) {
			loadCache().then(() => {
				for (const id of inv.expanded) if (!inv.isFetched(id)) fetchFolder(id)
				fetchAll()
			})
		}
	})
	// Keep handlers registered for the session — module-level state survives component unmount.
	onUnmounted(() => {})

	return {
		fetchFolder, fetchFolders, fetchAll, stopFetchAll, createLandmark, createFolder,
		renameItem, renameFolder, moveItem, moveFolder, trashItem, trashFolder,
		purgeItem, updatePerms, wearAttachment, detach,
	}
}
