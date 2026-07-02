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
import { useUiStore } from '@/stores/uiStore'
import { loadCachedInventory, saveCachedInventory, saveCachedFolders, removeCachedFolder, makeInvSavePairs, foldersToPairs } from '@/lib/inventoryCache'
import { useNotifications } from '@/composables/useNotifications'
import { playSound } from '@/composables/useAudio'
import { assetTypeName } from '@/utils/inventoryIcons'
import { C, S } from '@shared/protocol.js'

// SL AssetType — the dispatch keys openInventoryItem switches on. (Confirmed against
// src/utils/inventoryIcons.js ASSET_TYPE_NAMES.) Only TEXTURE has a full viewer pipeline;
// the rest get a graceful "coming soon" toast (see docs/FEATURE-GAPS.md 2026-06-30).
const ASSET_TYPE_TEXTURE = 0

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

// SL AssetType for an OBJECT (rezzable) = 6; InvType for an OBJECT = 6 too. Only OBJECT items
// can be rezzed into the world (matches the InventoryContextMenu isObject test + FS behaviour).
export const ASSET_TYPE_OBJECT = 6

// PERM_COPY bit (matches server RezObject handler): a copyable object stays in inventory when rezzed;
// a no-copy object is consumed (the sim removes it — expected FS behaviour, still allowed to rez).
const PERM_COPY = 0x00008000

/**
 * Compute a rez drop point ~`distance` metres in FRONT of the avatar, at avatar height.
 * Pure so it is unit-testable without the world engine.
 *
 * @param avatarPos  sim-authoritative avatar position {x,y,z} in SL coords (worldStore.avatarPos)
 * @param cameraYaw  Three.js yaw radians (uiStore.cameraYaw); 0 = facing North (SL +Y)
 * @param distance   metres in front (default 2)
 * @returns {{x:number,y:number,z:number}} drop point in SL region coords
 *
 * WHY the vector: useWorldEngine sends camAt (SL-space forward) as [-sin(yaw), cos(yaw), 0]
 * for a given Three.js yaw — the same forward basis is used here so the object lands where the
 * avatar is looking. Z is kept at avatar height (the sim settles it onto whatever is below).
 */
export function rezPositionInFront(avatarPos, cameraYaw = 0, distance = 2) {
	const a = avatarPos || { x: 128, y: 128, z: 25 }
	const fx = -Math.sin(cameraYaw)
	const fy = Math.cos(cameraYaw)
	return {
		x: Math.max(0, (a.x || 0) + fx * distance),
		y: Math.max(0, (a.y || 0) + fy * distance),
		z: Math.max(0, a.z || 0),
	}
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
	const ui      = useUiStore()
	const { notifyInfo } = useNotifications()

	// Double-click / "Open" dispatch for an inventory ITEM, switched once by asset type.
	// TEXTURE → the texture-preview floater (full pipeline exists). Everything else has no
	// client viewer yet, so it shows a graceful toast (deferred floaters logged in
	// docs/FEATURE-GAPS.md 2026-06-30) instead of a dead-end no-op.
	function openInventoryItem(item) {
		if (!item) return
		switch (item.assetType) {
			case ASSET_TYPE_TEXTURE:
				// WHY: item carries assetId (the J2C UUID) — getTextureUrl resolves it on demand.
				// Pass itemId as the multi-instance KEY so double-clicking two different inventory items
				// opens two floaters, while re-opening the SAME item just focuses its existing floater.
				if (item.assetId) ui.openTexturePreview(item.assetId, item.name, item.desc, item.itemId)
				else notifyInfo('No preview', 'This texture has no asset to show yet.')
				break
			default: {
				// Sound / animation / gesture / landmark / calling-card / other: no viewer pipeline yet.
				const label = assetTypeName(item.assetType)
				notifyInfo('Preview coming soon', `${label} preview isn't supported yet.`)
			}
		}
	}

	// Persist the current folder skeleton to IDB. WHY: created/renamed/moved folders must survive a
	// reload while the grid Robust write-back lags — otherwise a hard reload re-fetches a skeleton
	// without the change (e.g. a renamed folder reverts to "New Folder"). Reconciled by folderId.
	function persistFolders() {
		if (session.agentId) saveCachedFolders(session.agentId, foldersToPairs(inv.folders))
	}

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
			if (cached) {
				// Restore created-but-not-yet-persisted folders FIRST so their item lists have a home
				// when applyCachedItems runs — survives the grid write-back lag (option c).
				if (cached.folderPairs?.length) inv.applyFolderCache(cached.folderPairs)
			}
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
			// WHY isFetched predicate: allAgentFetched can fire at a DIPPED count (a fetch returned empty
			// mid-move) — merging at the folder level keeps last-known items for any folder not actually
			// fetched, so this "done" save can never persist a snapshot smaller than last-known. See
			// mergeItemPairs. Prevents PERMANENT DATA LOSS of a just-moved/created item.
			await saveCachedInventory(session.agentId, makeInvSavePairs(inv.items), id => inv.isFetched(id))
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
				// Same folder-level merge as the one-shot save: a mutation-save must not drop items from a
				// folder that hasn't been re-fetched (transiently empty in-memory) — see mergeItemPairs.
				await saveCachedInventory(session.agentId, makeInvSavePairs(inv.items), id => inv.isFetched(id))
			}, 1500)
		})
		// Clean up the mutation watcher on the next login so a re-login starts fresh.
		// WHY: the outer onCapsReady is called again on re-login; each call registers a fresh pair
		// of watchers. Stop the previous login's mutation watcher to avoid double-writes.
		// Module-level ref so each onCapsReady can stop its predecessor.
		if (_stopMutationSave) _stopMutationSave()
		_stopMutationSave = stopMutationSave
		// Backfill folders any window expanded before caps were ready (root auto-expands on load).
		for (const id of inv.expandedUnion()) if (!inv.isFetched(id)) fetchFolder(id)
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
		// WHY: micro-save the folder skeleton to IDB the instant it's created. The cap returns 200
		// from the region cache but the grid Robust write-back lags; a hard reload before that lands
		// would re-fetch a skeleton WITHOUT this folder and it would vanish. Persisting it here makes
		// it reappear from the snapshot on reload; it syncs out quietly once the write-back catches up.
		persistFolders()
		if (rename) {
			// Ensure the parent is open in the FOCUSED window so the new row renders, then enter
			// inline-rename once its TreeNode has mounted (nextTick = after DOM update + onMounted).
			const fid = ui.floaterStack.at(-1)
			if (fid && !inv.isExpanded(fid, parentId)) inv.toggle(fid, parentId)
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
			// WHY: carry ALL FIVE perm masks, not just ownerMask. encodeUpdateInventoryItem DEFAULTS any
			// absent mask (base/next-owner→FULL, group/everyone→0), so a rename or single-checkbox perms
			// edit that omitted them would silently RELAX a gift item's next-owner/group/everyone perms.
			// The store populates all masks on every row (cap decode + receive-path enrich), so round-trip them.
			baseMask:      cur.baseMask,
			ownerMask:     cur.ownerMask,
			groupMask:     cur.groupMask,
			everyoneMask:  cur.everyoneMask,
			nextOwnerMask: cur.nextOwnerMask,
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
		persistFolders()   // so the new name survives a reload during grid write-back lag
		emit(C.INV_RENAME_FOLDER, { folderId, name })
	}

	function moveItem(itemId, toFolderId) {
		if (!itemId || !toFolderId) return
		inv.moveItemLocal(itemId, toFolderId)
		emit(C.INV_MOVE_ITEM, { itemId, toFolderId })
	}

	// Walk upward from toParentId; reject the move if folderId is encountered (target is the folder
	// itself or one of its descendants) — moving a folder into its own subtree would create a cycle.
	// WHY: guard at this choke point so every caller (drag-drop, clipboard cut→paste, context menu) is
	// protected, not just the drag path that had its own hit-test guard.
	function wouldCycleFolderMove(folderId, toParentId) {
		let cur = toParentId
		const seen = new Set()
		while (cur) {
			if (cur === folderId) return true
			if (seen.has(cur)) break
			seen.add(cur)
			cur = inv.folders.get(cur)?.parentId ?? ''
		}
		return false
	}

	function moveFolder(folderId, toParentId) {
		if (!folderId || !toParentId) return
		if (wouldCycleFolderMove(folderId, toParentId)) return   // no-op: self / own-descendant target
		inv.moveFolderLocal(folderId, toParentId)
		persistFolders()
		emit(C.INV_MOVE_FOLDER, { folderId, toParentId })
	}

	// Duplicate an item into a folder (clipboard COPY→PASTE). The sim mints a fresh ItemID and acks via
	// BulkUpdateInventory (→ S.INV_BULK_UPDATE), which drops the copy into the target list — so there is
	// no optimistic add here (we don't own the new ItemID, unlike createFolder). newName omitted = the
	// sim keeps the source item's name (FS behavior).
	function copyItem(oldItemId, newFolderId, newName) {
		if (!oldItemId || !newFolderId) return
		emit(C.COPY_INV_ITEM, { oldItemId, newFolderId, ...(newName ? { newName } : {}) })
	}

	/**
	 * PASTE the clipboard into `targetFolderId`. CUT → MOVE every id (items via moveItem, folders via
	 * moveFolder) then clear; COPY → DUPLICATE every COPYABLE item via copyItem (folders are skipped —
	 * folder-copy is deferred, see docs/FEATURE-GAPS.md 2026-06-30). Returns a small summary for the caller.
	 * The clip object is { mode, ids, sourceFolderId } from useInventoryClipboard.
	 */
	function pasteInto(clip, targetFolderId, clearClipboard) {
		if (!clip?.ids?.length || !targetFolderId) return { moved: 0, copied: 0, skipped: 0 }
		let moved = 0, copied = 0, skipped = 0
		if (clip.mode === 'cut') {
			for (const id of clip.ids) {
				if (inv.folders.has(id)) { moveFolder(id, targetFolderId); moved++ }
				else if (inv.findItem(id)) { moveItem(id, targetFolderId); moved++ }
				else skipped++
			}
			if (clearClipboard) clearClipboard()   // CUT clipboard is single-use
		} else if (clip.mode === 'copy') {
			for (const id of clip.ids) {
				if (inv.folders.has(id)) { skipped++; continue }   // folder-copy deferred
				const found = inv.findItem(id)
				// Respect perms: only duplicate copyable items (canCopy from the corrected ownerMask).
				if (found?.item && found.item.canCopy !== false) { copyItem(id, targetFolderId); copied++ }
				else skipped++
			}
			// COPY clipboard is KEPT (FS pastes the same copy repeatedly) — no clear here.
		}
		return { moved, copied, skipped }
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
		persistFolders()
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

	/**
	 * Give (offer) one or more inventory ITEMS to another agent. Mirrors FS LLGiveInventory:
	 * one ImprovedInstantMessage (dialog 4, IM_INVENTORY_OFFERED) per item; the server builds the
	 * bucket = [assetType byte][item UUID] and owns a fresh transaction id. Folder-give is out of scope.
	 *
	 * @param itemIds  a single itemId or an array (multi-select)
	 * @param toAgentId  recipient avatar UUID
	 * @param toName  recipient display name (for the confirmation toast); optional
	 */
	function giveInventory(itemIds, toAgentId, toName) {
		if (!toAgentId) return
		const ids = Array.isArray(itemIds) ? itemIds : [itemIds]
		const recipient = toName || 'recipient'
		// WHY: remember the recipient's name keyed by agentId so the dialog-5 "received" ACK (which
		// arrives with the giver's name, not the recipient's — OpenSim quirk) can render the right name.
		inv.noteGiveRecipient(toAgentId, recipient)
		const gave = []
		let blocked = 0
		for (const itemId of ids) {
			if (!itemId) continue
			const found = inv.findItem(itemId)
			const it = found?.item
			if (!it) continue
			// WHY: respect perms — only offer transferable items (canTransfer from the corrected
			// ownerMask, W1). canTransfer === false means the grid will reject the give; skip + notify.
			if (it.canTransfer === false) { blocked++; continue }
			emit(C.GIVE_INVENTORY, { toAgentId, itemId, assetType: it.assetType, name: it.name })
			gave.push(it.name)
		}
		// FS parity (ItemsShared): a single "Items successfully shared." on send. The per-recipient
		// "[name] received your inventory offer." follows when OpenSim's dialog-5 ACK lands (useInstantMessage).
		if (gave.length) {
			notifyInfo('Inventory', 'Items successfully shared.')
		}
		if (blocked) {
			notifyInfo('Not transferable', `${blocked} item${blocked === 1 ? '' : 's'} could not be given (no-transfer)`)
		}
	}

	// Ensure a folder's DIRECT contents are loaded before a folder-give. Resolves immediately if the
	// folder is already fetched; otherwise kicks a fetch and polls until it lands (or times out). WHY:
	// the offer bucket must list the top folder's direct items (OpenSim gates them), so we can't build
	// it until folderItems(folderId) is authoritative. Subfolders are copied server-side, so a deep
	// recursive walk is NOT needed — only the one top folder.
	function ensureFolderFetched(folderId, timeoutMs = 4000) {
		return new Promise((resolve) => {
			if (inv.isFetched(folderId)) { resolve(true); return }
			fetchFolder(folderId)
			const t0 = performance.now()
			const tick = () => {
				if (inv.isFetched(folderId)) { resolve(true); return }
				if (performance.now() - t0 > timeoutMs) { resolve(false); return }
				setTimeout(tick, 120)
			}
			setTimeout(tick, 120)
		})
	}

	/**
	 * Give (offer) an inventory FOLDER to another agent. Mirrors FS LLGiveInventory::commitGiveInventoryCategory:
	 * one ImprovedInstantMessage (dialog 4) whose bucket is [AT_FOLDER][folderUUID] + [assetType][itemUUID]
	 * per DIRECT item. OpenSim copies subfolders + their contents server-side; the top folder's direct items
	 * must be listed or the sim drops them — so we ensure the folder is fetched, then send its direct items.
	 */
	async function giveInventoryFolder(folderId, toAgentId, toName) {
		if (!folderId || !toAgentId) return
		const folder = inv.folders.get(folderId)
		if (!folder) return
		// Remember recipient so the dialog-5 "received" ACK (carries giver's name) resolves the right name.
		inv.noteGiveRecipient(toAgentId, toName || 'recipient')
		await ensureFolderFetched(folderId)
		const items = inv.folderItems(folderId).map(it => ({ itemId: it.itemId, assetType: it.assetType }))
		emit(C.GIVE_INVENTORY_FOLDER, { toAgentId, folderId, name: folder.name, items })
		notifyInfo('Inventory', 'Items successfully shared.')
	}

	/**
	 * Share a drag/selection (items and/or folders) to an agent — the single entry point drop zones use.
	 * Routes item ids → giveInventory (perm-gated, batched toast) and folder ids → giveInventoryFolder.
	 */
	function shareToAgent(ids, toAgentId, toName) {
		const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
		const itemIds   = list.filter(id => !inv.folders.has(id))
		const folderIds = list.filter(id =>  inv.folders.has(id))
		if (itemIds.length) giveInventory(itemIds, toAgentId, toName)
		for (const fid of folderIds) giveInventoryFolder(fid, toAgentId, toName)
	}

	/**
	 * REZ an inventory OBJECT into the world (FS: LLToolDragAndDrop::dropObject → RezObject).
	 * The server holds no inventory, so we send the full InventoryData row (same fields as
	 * updatePerms via itemServerFields) plus perm masks + a drop position; the sim rezzes the
	 * object AT that position and streams it back as an ObjectUpdate the render pipeline shows.
	 *
	 * @param itemId    the inventory item to rez
	 * @param position  optional {x,y,z} SL drop point (e.g. a raycast hit from drag-to-canvas);
	 *                  omitted → ~2m in front of the avatar at avatar height (rezPositionInFront)
	 *
	 * Perms: rez is allowed for copyable OR the object itself. A no-copy object is consumed from
	 * inventory when rezzed (server defaults removeItem = !copyable) — expected FS behaviour, so we
	 * still allow it. We do NOT block on transfer/modify.
	 */
	function rezObject(itemId, position) {
		if (!itemId) return
		const found = inv.findItem(itemId)
		const it = found?.item
		if (!it) return
		// Guard: only OBJECT-type items are rezzable (assetType 6). Anything else is a no-op + toast.
		if (it.assetType !== ASSET_TYPE_OBJECT) {
			notifyInfo('Not rezzable', `${it.name || 'This item'} is not an object.`)
			return
		}
		const pos = position || rezPositionInFront(world.avatarPos, ui.cameraYaw)
		// removeItem = !copyable so the caller/UI can reflect the consume; server also derives this,
		// but computing it here keeps the two in sync and documents the perms contract at the call site.
		const removeItem = ((it.ownerMask ?? PERM_COPY) & PERM_COPY) === 0
		emit(C.REZ_OBJECT, {
			...itemServerFields(it),
			itemId,
			folderId: found.folderId,
			position: { x: pos.x, y: pos.y, z: pos.z },
			// Full perm masks so the sim rebuilds a complete InventoryData block + valid CRC.
			baseMask:      it.baseMask,
			ownerMask:     it.ownerMask,
			groupMask:     it.groupMask,
			everyoneMask:  it.everyoneMask,
			nextOwnerMask: it.nextOwnerMask,
			removeItem,
		})
		playSound('rezz.mp3', 0.3)   // FS-style rez cue (both context-menu + drag-to-canvas rez funnel here)
		notifyInfo('Rezzing', `Rezzing ${it.name || 'object'}…`)
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
			// UPSERT by folderId (same UUID the client minted) so the optimistic row + this confirm
			// collapse to one — no duplicate — and the authoritative server name/parent wins once the
			// grid write-back lands. Re-persist the skeleton so the now-confirmed folder is durable.
			on(S.INV_FOLDER_CREATED, d => {
				if (!d?.folderId) return
				inv.confirmFolder({ folderId: d.folderId, parentId: d.parentId, name: d.name, typeDefault: d.typeDefault })
				persistFolders()
			})
			// Cap rejected the create — revert the optimistic folder so the tree matches the server.
			// WHY removeCachedFolder (not persistFolders): removeFolderLocal only drops the folder from the
			// in-memory Map, and saveCachedFolders UNIONS prev+next so it can NEVER drop a folder from IDB.
			// The optimistic-create path micro-saved the (dirty) folder to IDB; without a targeted cache-
			// remove, a hard reload restores the rejected folder from the stale snapshot (applyFolderCache
			// lets a dirty cached folder win) — resurrecting a folder the grid refused.
			on(S.INV_FOLDER_CREATE_FAILED, d => {
				if (!d?.folderId) return
				inv.removeFolderLocal(d.folderId)
				if (session.agentId) removeCachedFolder(session.agentId, d.folderId)
			})
			registered = true
		}
		// WHY: Safety net — if CAPS_READY arrived before this component mounted (edge case on fast
		// resume), inv.capsReady is already true but onCapsReady was never called. Kick off fetching.
		if (inv.capsReady) {
			loadCache().then(() => {
				for (const id of inv.expandedUnion()) if (!inv.isFetched(id)) fetchFolder(id)
				fetchAll()
			})
		}
	})
	// Keep handlers registered for the session — module-level state survives component unmount.
	onUnmounted(() => {})

	return {
		fetchFolder, fetchFolders, fetchAll, stopFetchAll, createLandmark, createFolder,
		openInventoryItem,
		renameItem, renameFolder, moveItem, moveFolder, copyItem, pasteInto, trashItem, trashFolder,
		purgeItem, updatePerms, wearAttachment, detach, giveInventory, giveInventoryFolder, shareToAgent, rezObject,
	}
}
