// src/stores/inventoryStore.js — agent + library inventory tree.
// WHY: the folder skeleton arrives free in the LOGIN_OK payload (parsed from the XML-RPC login
// response). Folder CONTENTS (items) are fetched lazily per-folder via the FetchInventoryDescendents2
// cap (Phase 3 slice 2) and dropped into `items` by folderId.
import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef, computed } from 'vue'

export const useInventoryStore = defineStore('inventory', () => {
	// folders: Map<folderId, { folderId, parentId, name, typeDefault, version, source }>
	const folders   = ref(new Map())
	const rootId    = ref('')   // agent root ("My Inventory")
	const libRootId = ref('')   // shared Library root
	const items     = shallowRef(new Map())  // Map<folderId, Item[]> — filled by cap fetch
	// WHY per-floater: up to 6 inventory windows can be open at once and each must expand/collapse
	// folders independently (FS behavior). A single shared Set leaked collapses across windows.
	// Map<floaterId, Set<folderId>>; the global InventoryContextMenu + createFolder act on the
	// FOCUSED floater's set (resolved via ui.floaterStack), tree nodes on their own injected id.
	const expandedByFloater = ref(new Map())
	// WHY: while a filter is active, folders auto-open to reveal matches (the `open` computed forces
	// open). FS still lets you collapse an individual matching folder by clicking it; this per-floater
	// overlay records those explicit collapses so a click takes effect WITHOUT touching the normal
	// expand set. Cleared when the filter clears, so the next filter session starts all-revealed.
	const filterCollapsedByFloater = ref(new Map())
	const fetched   = shallowRef(new Set())  // folderIds whose contents have been fetched
	const fetching  = shallowRef(new Set())  // folderIds with an in-flight fetch

	// WHY: batch Vue reactivity triggers — many WS messages arrive per tick (40+ folder responses).
	// Instead of triggering N full re-renders, mutate in-place and flush once per microtask.
	let _trigPending = false
	function _schedTrigger() {
		if (_trigPending) return
		_trigPending = true
		Promise.resolve().then(() => { _trigPending = false; triggerRef(items); triggerRef(fetched); triggerRef(fetching) })
	}
	const caps      = ref(new Set())  // HTTP cap names the sim offered (after seed-cap fetch)
	// WHY: grids name the descendents cap differently (modern vs legacy). Accept either.
	const capsReady = computed(() => caps.value.has('FetchInventoryDescendents2') || caps.value.has('WebFetchInventoryDescendents'))
	const cacheLoaded = ref(false)    // true once IndexedDB cache was applied this session
	const selectedId = ref('')        // selected folder/item id (drives footer + highlight)
	const sortMode   = ref('name')    // item sort within a folder: 'name' | 'date' | 'type'
	const contextMenu = ref(null)     // { x, y, kind:'item'|'folder', obj } | null
	const propsTarget = ref(null)     // { kind, obj } shown in the Properties popover | null
	// Active inventory drag, shared across ALL tree nodes + floaters. WHY shared state instead of
	// relying on dataTransfer: getData() is unreadable during dragover and custom-type/types quirks
	// vary by browser — a singleton ref is always readable and makes cross-floater drags reliable.
	// WHY: { id } is the drag anchor (back-compat for single-item/folder readers); { ids } lists
	// every id being moved (anchor first) for multi-select drags. count is ids.length for hints.
	const dragPayload = ref(null)     // { id, ids:[...], kind:'item'|'folder', count } | null

	function loadFromLogin(d) {
		const m = new Map()
		for (const f of (d?.inventorySkeleton    || [])) m.set(f.folderId, { ...f, source: 'agent' })
		for (const f of (d?.inventorySkeletonLib || [])) m.set(f.folderId, { ...f, source: 'library' })
		folders.value   = m
		rootId.value    = d?.inventoryRoot    || ''
		libRootId.value = d?.inventoryLibRoot || ''
		items.value     = new Map()
		// WHY: re-seed every currently-open window's expand set to the freshly-loaded root (auto-expanded)
		// so a re-login starts each window clean; new windows seed lazily via ensureExpand.
		const seeded = new Map()
		for (const fid of expandedByFloater.value.keys()) seeded.set(fid, new Set(rootId.value ? [rootId.value] : []))
		expandedByFloater.value = seeded
		filterCollapsedByFloater.value = new Map()
		fetched.value   = new Set()
		fetching.value  = new Set()
		// WHY: caps belong to the session — re-armed by the CAPS_READY message after each login.
		caps.value       = new Set()
		cacheLoaded.value = false
		selectedId.value = ''
		sortMode.value   = 'name'
		contextMenu.value = null
		propsTarget.value = null
	}

	// Direct child folders of a folder, sorted to match Firestorm's default inventory order
	// (InventorySortOrder 6 = SO_FOLDERS_BY_NAME | SO_SYSTEM_FOLDERS_TO_TOP):
	//   1. system folders (a real preferred AssetType, typeDefault >= 0) above user folders
	//   2. alphabetical (case-insensitive) within each group
	// So e.g. Objects/Textures/Trash sit above user-created folders, Trash among the system block.
	function childFolders(parentId) {
		const out = []
		folders.value.forEach(f => { if (f.parentId === parentId) out.push(f) })
		const isSystem = (f) => Number(f.typeDefault) >= 0
		out.sort((a, b) => {
			const sa = isSystem(a), sb = isSystem(b)
			if (sa !== sb) return sa ? -1 : 1
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
		})
		return out
	}

	function folderItems(folderId) { return items.value.get(folderId) || [] }
	function isExpanded(floaterId, id) { const s = expandedByFloater.value.get(floaterId); return s ? s.has(id) : false }
	function isFetched(id)         { return fetched.value.has(id) }
	function isFetching(id)        { return fetching.value.has(id) }

	function markFetching(id) { fetching.value.add(id); _schedTrigger() }
	function setCaps(names) { caps.value = new Set(names || []) }

	// Pre-populate items from IndexedDB cache WITHOUT marking folders as fetched.
	// WHY: background cap fetch still runs for all folders and overwrites stale entries.
	// This gives instant display of last-known inventory while the real sync happens.
	function applyCachedItems(pairs) {
		for (const [folderId, list] of (pairs || [])) {
			if (!fetched.value.has(folderId)) items.value.set(folderId, list || [])
		}
		cacheLoaded.value = true
		_schedTrigger()
	}

	// Pre-populate FOLDERS from the IndexedDB cache. Mirrors applyBulkUpdate's folder-upsert: an
	// existing skeleton folder wins (it's already authoritative from login), but a cached folder
	// NOT in the skeleton is restored. WHY: a folder created last session whose grid write-back
	// lagged is absent from this login's skeleton — restoring it from cache makes it survive the
	// reload instead of vanishing; the server's later confirm (or a fresh fetch) reconciles by the
	// same folderId, so no duplicate is created.
	function applyFolderCache(pairs) {
		if (!Array.isArray(pairs) || !pairs.length) return
		const m = new Map(folders.value)
		for (const [folderId, f] of pairs) {
			if (!folderId || !f || m.has(folderId)) continue
			m.set(folderId, { typeDefault: -1, version: 0, ...f, folderId, source: 'agent' })
		}
		folders.value = m
	}

	// All expand mutators are keyed by floaterId and reassign the outer Map so every reader
	// (the tree's `open` computed) re-evaluates. A floater's set is seeded with the root expanded.
	function _rootSeed() { return new Set(rootId.value ? [rootId.value] : []) }

	function toggle(floaterId, id) {
		if (!floaterId || !id) return
		const m = new Map(expandedByFloater.value)
		const s = new Set(m.get(floaterId) || _rootSeed())
		if (s.has(id)) s.delete(id); else s.add(id)
		m.set(floaterId, s)
		expandedByFloater.value = m
	}

	function expandAll(floaterId) {
		if (!floaterId) return
		const s = new Set()
		folders.value.forEach(f => s.add(f.folderId))
		const m = new Map(expandedByFloater.value)
		m.set(floaterId, s)
		expandedByFloater.value = m
	}
	function collapseAll(floaterId) {
		if (!floaterId) return
		const m = new Map(expandedByFloater.value)
		m.set(floaterId, _rootSeed())
		expandedByFloater.value = m
	}
	// Seed a window's expand set (root auto-expanded) when it opens — idempotent.
	function ensureExpand(floaterId) {
		if (!floaterId || expandedByFloater.value.has(floaterId)) return
		const m = new Map(expandedByFloater.value)
		m.set(floaterId, _rootSeed())
		expandedByFloater.value = m
	}
	// Drop a window's expand set when it closes, so it doesn't leak across re-opens.
	function dropExpand(floaterId) {
		if (floaterId) clearFilterCollapse(floaterId)
		if (!floaterId || !expandedByFloater.value.has(floaterId)) return
		const m = new Map(expandedByFloater.value)
		m.delete(floaterId)
		expandedByFloater.value = m
	}

	// ── Filter-collapse overlay (explicit collapses while a filter is active) ──
	function isFilterCollapsed(floaterId, id) {
		const s = filterCollapsedByFloater.value.get(floaterId)
		return s ? s.has(id) : false
	}
	function toggleFilterCollapse(floaterId, id) {
		if (!floaterId || !id) return
		const m = new Map(filterCollapsedByFloater.value)
		const s = new Set(m.get(floaterId) || [])
		if (s.has(id)) s.delete(id); else s.add(id)
		m.set(floaterId, s)
		filterCollapsedByFloater.value = m
	}
	// Clear a window's overlay when its filter clears (next filter starts fully revealed).
	function clearFilterCollapse(floaterId) {
		if (!floaterId || !filterCollapsedByFloater.value.has(floaterId)) return
		const m = new Map(filterCollapsedByFloater.value)
		m.delete(floaterId)
		filterCollapsedByFloater.value = m
	}
	// Union of all windows' expanded folders (+ root) — for the caps-ready backfill fetch, since
	// folder CONTENTS are shared across windows even though expand state isn't.
	function expandedUnion() {
		const s = new Set()
		expandedByFloater.value.forEach(set => set.forEach(id => s.add(id)))
		if (rootId.value) s.add(rootId.value)
		return s
	}

	// First folder with the given preferred type (e.g. Favorites=23, Current Outfit=46).
	// WHY: prefer the copy that is a direct child of the agent root. OpenSim's GetRootFolder (and
	// every HG suitcase) creates a full system-folder set under "My Suitcase" (type 100), so two
	// folders can match a type — the real /Favorites and /My Suitcase/Favorites. The real system
	// folders sit directly under root, so anchor on that and ignore skeleton insertion order.
	// Fall back to any match for HG-outbound sessions where root IS the suitcase.
	function findSystemFolder(typeDefault) {
		let found = '', fallback = ''
		folders.value.forEach(f => {
			if (Number(f.typeDefault) !== typeDefault) return
			if (!fallback) fallback = f.folderId
			if (!found && f.parentId === rootId.value) found = f.folderId
		})
		return found || fallback
	}

	function select(id) { selectedId.value = id }

	// ── Sort (folders stay system-then-name; items sort by the chosen mode) ──
	function setSort(m) { sortMode.value = m }
	function sortItems(list) {
		const arr = [...list]
		if (sortMode.value === 'date')      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
		else if (sortMode.value === 'type') arr.sort((a, b) => (a.assetType - b.assetType) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
		else                                arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
		return arr
	}

	// ── Context menu + Properties popover ──
	function openContextMenu(x, y, kind, obj) { contextMenu.value = { x, y, kind, obj } }
	function closeContextMenu() { contextMenu.value = null }
	function showProperties(kind, obj) { propsTarget.value = { kind, obj }; contextMenu.value = null }
	function closeProperties() { propsTarget.value = null }

	// Local-only: insert item into the Favorites folder's in-memory list (no server cap yet).
	function addToFavorites(item) {
		const favId = findSystemFolder(23)
		if (!favId) return
		const list = items.value.get(favId) || []
		if (list.some(i => i.itemId === item.itemId)) return
		items.value.set(favId, [...list, { ...item, parentId: favId }])
		fetched.value.add(favId)
		_schedTrigger()
	}

	// Recursive descendant counts (items + subfolders) for the FS "(items/folders)" badge + footer.
	function descendantCounts(folderId) {
		let items = folderItems(folderId).length
		let foldersN = 0
		for (const c of childFolders(folderId)) {
			foldersN++
			const d = descendantCounts(c.folderId)
			items += d.items
			foldersN += d.folders
		}
		return { items, folders: foldersN }
	}

	// Store fetched folder contents (from FetchInventoryDescendents2).
	// WHY: mutate in-place + deferred trigger — avoids O(n) Map copy per response and collapses
	// 40+ concurrent WS messages into one Vue re-render per microtask tick.
	function setItems(folderId, list) {
		items.value.set(folderId, list || [])
		fetched.value.add(folderId)
		fetching.value.delete(folderId)
		_schedTrigger()
	}

	const folderCount = computed(() => folders.value.size)
	const itemCount   = computed(() => {
		let n = 0
		items.value.forEach(list => { n += list.length })
		return n
	})

	// ── Agent-scoped totals (exclude the shared Library, like Firestorm's "My Inventory" count) ──
	const agentFolderIds = computed(() => {
		const out = []
		folders.value.forEach(f => { if (f.source === 'agent') out.push(f.folderId) })
		return out
	})
	const agentFolderCount  = computed(() => agentFolderIds.value.length)
	const agentItemCount    = computed(() => {
		let n = 0
		for (const id of agentFolderIds.value) { const l = items.value.get(id); if (l) n += l.length }
		return n
	})
	const agentFetchedCount = computed(() => {
		let n = 0
		for (const id of agentFolderIds.value) if (fetched.value.has(id)) n++
		return n
	})
	// True once every agent folder's items have been fetched → grand total is exact (FS-style).
	const allAgentFetched = computed(() => agentFolderCount.value > 0 && agentFetchedCount.value >= agentFolderCount.value)

	// Agent folders still needing a fetch (for the background bulk loader).
	function pendingAgentFolders() {
		return agentFolderIds.value.filter(id => !fetched.value.has(id) && !fetching.value.has(id))
	}

	// Insert newly-created items (from UpdateCreateInventoryItem) into their parent folder's list,
	// so a fresh landmark shows up immediately without a re-fetch. De-dupes by itemId.
	function addCreatedItems(list) {
		if (!Array.isArray(list) || !list.length) return
		for (const it of list) {
			if (!it?.parentId) continue
			const cur = items.value.get(it.parentId) || []
			if (cur.some(x => x.itemId === it.itemId)) continue
			items.value.set(it.parentId, [...cur, it])
		}
		_schedTrigger()
	}

	// Optimistically add a folder the client just asked the sim to create (CreateInventoryFolder
	// has no reply message — the viewer owns the new FolderID). source:'agent' so totals count it.
	function addFolderOptimistic({ folderId, parentId, name, typeDefault = -1 }) {
		if (!folderId || folders.value.has(folderId)) return
		const m = new Map(folders.value)
		m.set(folderId, { folderId, parentId, name, typeDefault, version: 0, source: 'agent' })
		folders.value = m
	}

	// Reconcile a server-confirmed folder (CreateInventoryCategory cap → S.INV_FOLDER_CREATED).
	// UPSERT by folderId: the client owns the UUID and reuses it for the optimistic add AND the
	// create request, so the confirm carries the SAME folderId — merging here collapses the two
	// into one row (no duplicate) and lets the authoritative server fields (e.g. a truncated name)
	// win once the grid write-back lands. Creates the row if the optimistic add was lost on reload.
	function confirmFolder({ folderId, parentId, name, typeDefault }) {
		if (!folderId) return
		const m = new Map(folders.value)
		const prev = m.get(folderId)
		const next = { ...prev, folderId, source: 'agent' }
		if (parentId != null)    next.parentId    = parentId
		if (name != null)        next.name        = name
		if (typeDefault != null) next.typeDefault = typeDefault
		// WHY: in the lost-on-reload path `prev` is absent; if the server confirm omits typeDefault,
		// a null/NaN would misclassify this as a non-system folder. Default to -1 (user folder).
		if (next.typeDefault == null) next.typeDefault = -1
		if (next.version == null) next.version = 0
		m.set(folderId, next)
		folders.value = m
	}

	// ── Optimistic mutations (mirror the server's MoveInventoryItem/UpdateInventoryItem/
	//    UpdateInventoryFolder/RemoveInventoryItem before the sim's BulkUpdateInventory ack lands).
	//    All resilient: a missing item/folder is a no-op, never a throw. ──

	// Find which folder list an item currently lives in. Returns the folderId or '' if not found.
	function _findItemFolder(itemId) {
		let where = ''
		items.value.forEach((list, folderId) => {
			if (!where && list.some(i => i.itemId === itemId)) where = folderId
		})
		return where
	}

	function renameItemLocal(itemId, name) {
		if (!itemId) return
		const folderId = _findItemFolder(itemId)
		if (!folderId) return
		const list = items.value.get(folderId) || []
		items.value.set(folderId, list.map(i => (i.itemId === itemId ? { ...i, name } : i)))
		_schedTrigger()
	}

	function renameFolderLocal(folderId, name) {
		if (!folderId) return
		const f = folders.value.get(folderId)
		if (!f) return
		const m = new Map(folders.value)
		m.set(folderId, { ...f, name })
		folders.value = m
	}

	// Move an item between folder lists, updating its parentId. No-op if the item isn't found
	// or it's already in the destination folder.
	function moveItemLocal(itemId, toFolderId) {
		if (!itemId || !toFolderId) return
		const fromFolderId = _findItemFolder(itemId)
		if (!fromFolderId || fromFolderId === toFolderId) return
		const fromList = items.value.get(fromFolderId) || []
		const moving = fromList.find(i => i.itemId === itemId)
		if (!moving) return
		items.value.set(fromFolderId, fromList.filter(i => i.itemId !== itemId))
		const toList = items.value.get(toFolderId) || []
		if (!toList.some(i => i.itemId === itemId)) {
			items.value.set(toFolderId, [...toList, { ...moving, parentId: toFolderId }])
		}
		_schedTrigger()
	}

	function moveFolderLocal(folderId, toParentId) {
		if (!folderId || !toParentId || folderId === toParentId) return
		const f = folders.value.get(folderId)
		if (!f || f.parentId === toParentId) return
		const m = new Map(folders.value)
		m.set(folderId, { ...f, parentId: toParentId })
		folders.value = m
	}

	// Drop an item from whatever folder list it's in (purge / sim-driven removal).
	function removeItemLocal(itemId) {
		if (!itemId) return
		const folderId = _findItemFolder(itemId)
		if (!folderId) return
		const list = items.value.get(folderId) || []
		items.value.set(folderId, list.filter(i => i.itemId !== itemId))
		_schedTrigger()
	}

	// Drop a folder from the tree. Its item list is dropped too; descendant folders are left for
	// the sim's authoritative reconcile (BulkUpdateInventory) — we don't speculatively recurse.
	function removeFolderLocal(folderId) {
		if (!folderId || !folders.value.has(folderId)) return
		const m = new Map(folders.value)
		m.delete(folderId)
		folders.value = m
		if (items.value.has(folderId)) { items.value.delete(folderId); _schedTrigger() }
	}

	// Recompute the cached canCopy/canModify/canTransfer convenience flags from the owner mask bits.
	function _permFlags(ownerMask) {
		const m = ownerMask | 0
		return {
			canCopy:     (m & 0x8000) !== 0,
			canModify:   (m & 0x4000) !== 0,
			canTransfer: (m & 0x2000) !== 0,
		}
	}

	// Apply a permission change to an item in place, recomputing the convenience flags from ownerMask.
	function updateItemPermsLocal(itemId, masks = {}) {
		if (!itemId) return
		const folderId = _findItemFolder(itemId)
		if (!folderId) return
		const list = items.value.get(folderId) || []
		items.value.set(folderId, list.map(i => {
			if (i.itemId !== itemId) return i
			const next = { ...i }
			if (masks.ownerMask     != null) next.ownerMask     = masks.ownerMask
			if (masks.everyoneMask  != null) next.everyoneMask  = masks.everyoneMask
			if (masks.groupMask     != null) next.groupMask     = masks.groupMask
			if (masks.nextOwnerMask != null) next.nextOwnerMask = masks.nextOwnerMask
			Object.assign(next, _permFlags(next.ownerMask))
			return next
		}))
		_schedTrigger()
	}

	// Reconcile authoritative rows from the sim (BulkUpdateInventory) into the maps. Upserts folders
	// (preserving source) and items (placed into / migrated to their authoritative parentId folder).
	function applyBulkUpdate({ folders: fol, items: its } = {}) {
		if (Array.isArray(fol) && fol.length) {
			const m = new Map(folders.value)
			for (const f of fol) {
				if (!f?.folderId) continue
				const prev = m.get(f.folderId)
				m.set(f.folderId, { source: 'agent', ...prev, ...f })
			}
			folders.value = m
		}
		if (Array.isArray(its) && its.length) {
			for (const it of its) {
				if (!it?.itemId || !it?.parentId) continue
				// Remove any stale copy from its previous folder (move/rename reconciliation).
				const oldFolder = _findItemFolder(it.itemId)
				if (oldFolder && oldFolder !== it.parentId) {
					const ol = items.value.get(oldFolder) || []
					items.value.set(oldFolder, ol.filter(x => x.itemId !== it.itemId))
				}
				const list = items.value.get(it.parentId) || []
				const idx = list.findIndex(x => x.itemId === it.itemId)
				// WHY: recompute the canCopy/canModify/canTransfer flags whenever the ack carries an
				// ownerMask — otherwise a perms change reconciled here (now live via the EventQueue path)
				// updates the raw mask but leaves the cached flags (and rendered perm tags) stale.
				if (idx >= 0) {
					const merged = { ...list[idx], ...it }
					if (it.ownerMask != null) Object.assign(merged, _permFlags(it.ownerMask))
					list[idx] = merged
				} else {
					const ins = { ...it }
					if (it.ownerMask != null) Object.assign(ins, _permFlags(it.ownerMask))
					items.value.set(it.parentId, [...list, ins])
				}
			}
			_schedTrigger()
		}
	}

	// Folders a landmark can be saved into, FS-style: Favorites (type 23) first, then the
	// Landmarks system folder (type 3) and all its descendant folders (indented by depth).
	function landmarkTargetFolders() {
		const out = []
		const favId = findSystemFolder(23)
		if (favId) out.push({ folderId: favId, name: 'Favorites', depth: 0, favorite: true })
		const lmId = findSystemFolder(3)
		if (lmId) {
			const walk = (id, depth) => {
				const f = folders.value.get(id)
				out.push({ folderId: id, name: f ? f.name : 'Landmarks', depth })
				for (const c of childFolders(id)) walk(c.folderId, depth + 1)
			}
			walk(lmId, 0)
		}
		return out
	}

	function clear() { loadFromLogin(null) }

	// WHY: accept either a single id or an array of ids. Normalize to { id (anchor), ids, kind, count }
	// so single-id readers (id) and multi-id readers (ids) both work off one payload shape.
	function setDrag(idOrIds, kind) {
		const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter(Boolean)
		dragPayload.value = ids.length ? { id: ids[0], ids, kind, count: ids.length } : null
	}
	function clearDrag()       { dragPayload.value = null }

	return {
		folders, rootId, libRootId, items, fetched, fetching, caps, capsReady, cacheLoaded,
		selectedId, sortMode, contextMenu, propsTarget, dragPayload, setDrag, clearDrag,
		loadFromLogin, childFolders, folderItems, isExpanded, isFetched, isFetching,
		markFetching, setCaps, applyCachedItems, applyFolderCache, toggle, expandAll, collapseAll,
		ensureExpand, dropExpand, expandedUnion, isFilterCollapsed, toggleFilterCollapse, clearFilterCollapse, findSystemFolder,
		select, descendantCounts,
		setSort, sortItems, openContextMenu, closeContextMenu, showProperties, closeProperties, addToFavorites,
		setItems, folderCount, itemCount, clear,
		agentFolderIds, agentFolderCount, agentItemCount, agentFetchedCount, allAgentFetched,
		pendingAgentFolders, addCreatedItems, addFolderOptimistic, confirmFolder, landmarkTargetFolders,
		renameItemLocal, renameFolderLocal, moveItemLocal, moveFolderLocal,
		removeItemLocal, removeFolderLocal, updateItemPermsLocal, applyBulkUpdate,
	}
})
