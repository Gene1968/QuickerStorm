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
	// ── MOVE-RECONCILIATION STATE MACHINE ─────────────────────────────────────────────────────────
	// WHY: an optimistic move (moveItemLocal) / create (addCreatedItems) places an item at toFolderId
	// before the grid confirms. A NAÏVE per-item dirty boolean cleared on the first authoritative fetch
	// that saw the item is WRONG in two ways: (BUG A) a DST fetch that includes X clears the marker, then
	// a LAGGING SRC fetch that still lists X re-adds it → X duplicated in SRC and DST; (BUG B) a move the
	// grid NEVER performs leaves X pinned at DST forever (SRC keeps listing it, DST never does) with no
	// path to give up. This state machine tracks a pending record per moved/created item, accrues
	// authoritative presence flags from EACH fetch of the src/dst folders, and only clears the record
	// once the fetches let it decide SUCCESS / FAILED / DELETED. GLOBAL INVARIANT while pending: the item
	// appears in exactly ONE folder (toFolderId). Persisted via the item row's `pendingMove` field so it
	// round-trips through makeInvSavePairs/applyCachedItems and survives a reload.
	// Map<itemId, { itemId, fromFolderId, toFolderId, destFetched, destPresent, srcFetched, srcPresent }>
	// fromFolderId === null → a locally-created item (no source folder; pin to toFolderId until confirmed).
	const pendingMoves = new Map()

	function _newPending(itemId, fromFolderId, toFolderId) {
		return {
			itemId, fromFolderId: fromFolderId ?? null, toFolderId,
			destFetched: false, destPresent: false, srcFetched: false, srcPresent: false,
		}
	}
	// The serializable snapshot stamped onto the item row at toFolderId so the record survives reload.
	function _pendingRowStamp(rec) {
		return {
			fromFolderId: rec.fromFolderId, toFolderId: rec.toFolderId,
			destFetched: rec.destFetched, destPresent: rec.destPresent,
			srcFetched: rec.srcFetched, srcPresent: rec.srcPresent,
		}
	}

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
	// WHY: default 'date' (most recent) matches Firestorm's default InventorySortOrder for new items.
	const sortMode   = ref('date')    // item sort within a folder: 'name' | 'date' | 'type'
	// WHY: FS "Sort System Folders to Top" gear toggle. When on (default, mirrors FS), system folders
	// (a real preferred AssetType, typeDefault >= 0) sort above user folders; when off, purely by name.
	const systemFoldersToTop = ref(true)
	const contextMenu = ref(null)     // { x, y, kind:'item'|'folder', obj } | null
	const propsTargets = ref([])      // [{ key, kind, obj }] — one open Properties floater per item/folder
	// ── Worn-attachment tracking (session-local half of FS get_is_item_worn) ──
	// itemIds of OBJECT items this session attached via the wear path (RezSingleAttachmentFromInv)
	// and not yet detached. FS answers "is worn?" from gAgentAvatarp->isWearingAttachment
	// (llinventoryfunctions.cpp get_is_item_worn); we have no avatar attachment-point model yet, so
	// this Set is the honest session-side record. Attachments worn BEFORE this session are detected
	// from the scene instead: their ObjectUpdate NameValue carries "AttachItemID" (FS
	// llviewerobject.cpp extractAttachmentItemID) — see useInventory.isItemWorn, which checks both.
	const wornAttachments = ref(new Set())
	function markWorn(itemId) {
		if (!itemId || wornAttachments.value.has(itemId)) return
		const s = new Set(wornAttachments.value); s.add(itemId); wornAttachments.value = s
	}
	function markDetached(itemId) {
		if (!itemId || !wornAttachments.value.has(itemId)) return
		const s = new Set(wornAttachments.value); s.delete(itemId); wornAttachments.value = s
	}
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
		pendingMoves.clear()
		// WHY: caps belong to the session — re-armed by the CAPS_READY message after each login.
		caps.value       = new Set()
		cacheLoaded.value = false
		selectedId.value = ''
		sortMode.value   = 'date'
		systemFoldersToTop.value = true
		contextMenu.value = null
		propsTargets.value = []
		wornAttachments.value = new Set()
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
			if (systemFoldersToTop.value) {
				const sa = isSystem(a), sb = isSystem(b)
				if (sa !== sb) return sa ? -1 : 1
			}
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
			// WHY _enrichItem: rows cached by an older session (before flag derivation existed, or via a
			// path that skipped it) carry raw masks without canX — re-derive on load so a cache-hydrated
			// row never renders false NM/NC/NT until the live re-fetch lands.
			if (!fetched.value.has(folderId)) items.value.set(folderId, (list || []).map(_enrichItem))
		}
		// WHY: rebuild the move-reconciliation state machine from any cached rows that carried a
		// `pendingMove` stamp — an unconfirmed move/create from last session must keep suppressing a
		// lagging SRC fetch (BUG A) and stay resolvable (BUG B) across the reload. The stamp lives on the
		// row at toFolderId; the record is keyed by itemId. If two rows collide (shouldn't happen — the
		// invariant is one folder per pending item), the toFolderId on the record wins.
		for (const [, list] of (pairs || [])) {
			for (const it of (list || [])) {
				const pm = it?.pendingMove
				if (pm && it.itemId && pm.toFolderId) {
					pendingMoves.set(it.itemId, {
						itemId: it.itemId,
						fromFolderId: pm.fromFolderId ?? null,
						toFolderId: pm.toFolderId,
						destFetched: !!pm.destFetched, destPresent: !!pm.destPresent,
						srcFetched: !!pm.srcFetched, srcPresent: !!pm.srcPresent,
					})
				}
			}
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
			if (!folderId || !f) continue
			const skel = m.get(folderId)
			if (skel) {
				// Folder already in the login skeleton. Normally skeleton-wins (it's authoritative from
				// login). BUT if the CACHED copy is dirty (a local create/rename/move the grid hasn't
				// confirmed), the reload skeleton may still carry the STALE parentId/name because the grid
				// write-back lagged — so apply the cached edit OVER the skeleton until the grid confirms.
				// WHY parentId/name/version only: those are the user-editable fields; keep the skeleton's
				// source/typeDefault. dirty stays true (still unconfirmed) so a mid-session BulkUpdate clears it.
				if (f.dirty) {
					const next = { ...skel, source: 'agent', dirty: true }
					if (f.parentId != null) next.parentId = f.parentId
					if (f.name     != null) next.name     = f.name
					if (f.version  != null) next.version  = f.version
					m.set(folderId, next)
				}
				continue
			}
			// Folder absent from the skeleton (write-back lagged / created last session) — restore it.
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

	// True if the folder/item `id` already lives inside the Trash system folder (type 14) — Trash
	// is an ancestor, or (for a folder) is itself. WHY: FS greys out Delete for rows already in the
	// Trash, so pressing Del there is a no-op; we use this to skip a redundant "move to Trash" that
	// would otherwise fire a pointless MoveInventoryItem/Folder at the sim. Cycle-safe walk.
	function isInTrash(id) {
		if (!id) return false
		const trashId = findSystemFolder(14)
		if (!trashId) return false
		// Start from the containing folder for an item, or the folder itself for a folder.
		let cur = folders.value.has(id) ? id : (findItem(id)?.folderId || '')
		const seen = new Set()
		while (cur && !seen.has(cur)) {
			if (cur === trashId) return true
			seen.add(cur)
			cur = folders.value.get(cur)?.parentId || ''
		}
		return false
	}

	function select(id) { selectedId.value = id }

	// ── Sort (folders stay system-then-name; items sort by the chosen mode) ──
	function setSort(m) { sortMode.value = m }
	function setSystemFoldersToTop(on) { systemFoldersToTop.value = !!on }
	function toggleSystemFoldersToTop() { systemFoldersToTop.value = !systemFoldersToTop.value }
	function sortItems(list) {
		const arr = [...list]
		if (sortMode.value === 'date')      arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
		else if (sortMode.value === 'type') arr.sort((a, b) => (a.assetType - b.assetType) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
		else                                arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
		return arr
	}

	// ── Context menu + Properties popover ──
	// WHY: `targets` carries the FULL right-click selection so multi-capable actions (Delete,
	// Copy-UUID) operate on every selected row (FS behavior). `obj`/`kind` stay the clicked row
	// (the menu header + single-target actions like Rename use them). When the caller omits
	// targets, single-selection is implied → default to just the clicked row.
	function openContextMenu(x, y, kind, obj, targets = null) {
		const list = (Array.isArray(targets) && targets.length) ? targets : [{ kind, obj }]
		contextMenu.value = { x, y, kind, obj, targets: list }
	}
	function closeContextMenu() { contextMenu.value = null }
	// Resolve an inventory id (folderId or itemId) to a context-menu target { kind, obj }.
	// Folders win when an id collides (folder ids and item ids are distinct UUIDs in practice).
	// Returns null when the id matches neither (stale selection entry).
	function resolveTarget(id) {
		const folder = folders.value.get(id)
		if (folder) return { kind: 'folder', obj: folder }
		let found = null
		items.value.forEach(list => {
			if (found) return
			const it = list.find(i => i.itemId === id)
			if (it) found = it
		})
		return found ? { kind: 'item', obj: found } : null
	}
	// WHY: each item/folder opens its OWN Properties floater (FS behavior) — keep a list keyed by
	// kind+id so a second item doesn't replace the first. Opening an already-open one is a no-op
	// (its existing floater stays; FloaterWindow handles re-focus on click).
	function showProperties(kind, obj) {
		contextMenu.value = null
		const id = obj?.itemId || obj?.folderId
		if (!id) return
		const key = `${kind}:${id}`
		if (propsTargets.value.some(t => t.key === key)) return
		propsTargets.value = [...propsTargets.value, { key, kind, obj }]
	}
	function closePropertiesFor(key) { propsTargets.value = propsTargets.value.filter(t => t.key !== key) }
	function closeProperties() { propsTargets.value = [] }

	// Local-only: insert item into the Favorites folder's in-memory list (no server cap yet).
	function addToFavorites(item) {
		const favId = findSystemFolder(23)
		if (!favId) return
		const list = items.value.get(favId) || []
		if (list.some(i => i.itemId === item.itemId)) return
		items.value.set(favId, [...list, _enrichItem({ ...item, parentId: favId })])
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
	//
	// This is the authoritative-fetch hook for the MOVE-RECONCILIATION STATE MACHINE (see pendingMoves):
	// each fetch of a folder feeds presence flags into every pending record whose from/to touches it and
	// may RESOLVE the record. `liveList` is authoritative grid data. See _reconcilePending for the rules.
	function setItems(folderId, list) {
		// WHY: the cap fetch surfaces raw masks (ownerMask + nextOwnerMask) but only the server's
		// current-owner canCopy/canModify/canTransfer flags. Re-derive both the owner and next-owner
		// convenience flags here (via the shared _enrichItem choke point) so every ingested row carries
		// nextCan* for the Properties floater, regardless of which path delivered it.
		// _reconcilePending's liveList is therefore ALWAYS pre-enriched.
		const enriched = (list || []).map(_enrichItem)
		const merged = _reconcilePending(folderId, enriched)
		items.value.set(folderId, merged)
		fetched.value.add(folderId)
		fetching.value.delete(folderId)
		_schedTrigger()
	}

	// Does `list` (authoritative fetch of a folder) contain itemId?
	function _listHas(list, itemId) { return list.some(i => i?.itemId === itemId) }

	// Strip the transient pending-move stamp off an item row (row becomes authoritative).
	function _clearStamp(it) {
		if (!it || !it.pendingMove) return it
		const { pendingMove, ...clean } = it
		void pendingMove
		return clean
	}

	// Reconcile the authoritative liveList for `folderId` against the move-reconciliation state machine.
	// Returns the list to store at `folderId`. Also mutates OTHER folders' lists when a pending resolves.
	//
	// Steps:
	//   1) Update presence flags on every pending record whose src/dst is `folderId`.
	//   2) RESOLVE any record the accrued flags now decide (SUCCESS/FAILED/DELETED) — applying the
	//      authoritative placement and deleting the record.
	//   3) Build `folderId`'s stored list, honouring records STILL pending (keep at to / drop from src /
	//      drop from any third folder) so the GLOBAL INVARIANT holds: a pending item lives only at its to.
	function _reconcilePending(folderId, liveList) {
		// (1) Accrue authoritative presence for every pending record this fetch informs.
		for (const rec of pendingMoves.values()) {
			if (rec.toFolderId === folderId) {
				rec.destFetched = true
				rec.destPresent = _listHas(liveList, rec.itemId)
			}
			if (rec.fromFolderId != null && rec.fromFolderId === folderId) {
				rec.srcFetched = true
				rec.srcPresent = _listHas(liveList, rec.itemId)
			}
		}

		// (2) Resolve whatever the accrued flags now decide. Collect resolutions so we can apply their
		// placement side-effects (to OTHER folders + to this folder's build) after the loop.
		const resolvedToDropHere = new Set()   // itemIds no longer pending-pinned to `folderId`
		for (const rec of [...pendingMoves.values()]) {
			const decision = _pendingDecision(rec)
			if (decision === 'pending') continue
			pendingMoves.delete(rec.itemId)
			if (decision === 'failed') {
				// The move never happened — HONOR the grid: X belongs at fromFolderId, not at to.
				// Remove any optimistic copy at to (unless to === the folder we're building — handled below),
				// and ensure X exists at fromFolderId (the src fetch that proved srcPresent carries it, but a
				// prior optimistic move removed it from the in-memory src list, so re-add if missing).
				_removeItemFrom(rec.toFolderId, rec.itemId, folderId, resolvedToDropHere)
				_ensureItemAt(rec.fromFolderId, rec.itemId, folderId)
			} else if (decision === 'deleted') {
				// X gone server-side — remove everywhere; never resurrect.
				_removeItemFrom(rec.toFolderId, rec.itemId, folderId, resolvedToDropHere)
				if (rec.fromFolderId != null) _removeItemFrom(rec.fromFolderId, rec.itemId, folderId, resolvedToDropHere)
			}
			else if (decision === 'success') {
				// X stays at to (authoritative). Strip the now-stale stamp off the to-row. When to === the
				// folder being built the build step strips it; else strip it in place here (this fetch is of
				// the SRC, so the to-row won't be rebuilt this pass).
				if (rec.toFolderId !== folderId) {
					const toList = items.value.get(rec.toFolderId)
					if (toList) {
						const i = toList.findIndex(x => x.itemId === rec.itemId)
						// _enrichItem: the re-placed row may have arrived via an optimistic path that never
						// derived canX — re-derive as it becomes authoritative.
						if (i >= 0 && toList[i].pendingMove) items.value.set(rec.toFolderId, toList.map(x => _enrichItem(_clearStamp(x))))
					}
				}
			}
		}

		// (3) Build the stored list for `folderId`.
		const out = []
		const seen = new Set()
		for (const it of liveList) {
			if (!it?.itemId) { out.push(it); continue }
			seen.add(it.itemId)
			const rec = pendingMoves.get(it.itemId)
			if (rec) {
				// Still pending. Keep only at to; drop from src or any third folder.
				if (rec.toFolderId === folderId) {
					out.push({ ...it, pendingMove: _pendingRowStamp(rec) })
				}
				// else: folderId is src or a third folder → drop X here (invariant: lives only at to).
				continue
			}
			// Not pending. If a just-resolved record said drop it here, honour that; else authoritative.
			if (resolvedToDropHere.has(it.itemId)) continue
			out.push(_clearStamp(it))
		}
		// Re-add / re-stamp any pending item pinned to `folderId` (to) that liveList omitted (write-back lag).
		// _enrichItem: the pinned row came from an optimistic move/create — re-derive canX on re-place so a
		// re-placed row never keeps stale/missing perm flags (the "false NM/NC/NT until reload" bug).
		const existing = items.value.get(folderId) || []
		for (const it of existing) {
			if (seen.has(it.itemId)) continue
			const rec = pendingMoves.get(it.itemId)
			if (rec && rec.toFolderId === folderId) out.push(_enrichItem({ ...it, pendingMove: _pendingRowStamp(rec) }))
		}
		return out
	}

	// Decide a pending record from its accrued authoritative flags. See the state-machine rules:
	//   SUCCESS  destPresent === true, but hold the record until src is CONFIRMED CLEAN (srcFetched &&
	//            !srcPresent) so a later lagging src-fetch is still suppressed (fixes BUG A). Created
	//            items (fromFolderId === null) have no src to confirm → success as soon as destPresent.
	//   FAILED   destFetched && !destPresent && srcPresent → the move didn't happen (fixes BUG B).
	//   DELETED  destFetched && !destPresent && srcFetched && !srcPresent → gone server-side.
	//   PENDING  otherwise (e.g. dest not fetched yet) → stay optimistic at to.
	function _pendingDecision(rec) {
		if (rec.destPresent) {
			if (rec.fromFolderId == null) return 'success'
			return (rec.srcFetched && !rec.srcPresent) ? 'success' : 'pending'
		}
		if (rec.destFetched && !rec.destPresent) {
			if (rec.srcPresent) return 'failed'
			if (rec.srcFetched && !rec.srcPresent) return 'deleted'
		}
		return 'pending'
	}

	// Remove itemId from a folder's stored list. If the folder is `buildingFolderId` (the list setItems is
	// about to overwrite), record it in dropHere instead so the build step drops it — never write a list
	// that will be immediately replaced.
	function _removeItemFrom(folderId, itemId, buildingFolderId, dropHere) {
		if (folderId == null) return
		if (folderId === buildingFolderId) { dropHere.add(itemId); return }
		const list = items.value.get(folderId)
		if (!list) return
		if (list.some(i => i.itemId === itemId)) {
			// Survivor rewrite — enrich so rows kept through the rewrite always carry derived canX.
			items.value.set(folderId, list.filter(i => i.itemId !== itemId).map(x => _enrichItem(_clearStamp(x))))
		}
	}

	// Ensure itemId exists (authoritative, un-stamped) in a folder's stored list. Skips `buildingFolderId`
	// (setItems is rebuilding it from the authoritative liveList that already carries X). Pulls the row
	// from wherever it currently lives (e.g. the optimistic copy at to) so no data is invented.
	function _ensureItemAt(folderId, itemId, buildingFolderId) {
		if (folderId == null || folderId === buildingFolderId) return
		const list = items.value.get(folderId) || []
		if (list.some(i => i.itemId === itemId)) return
		let row = null
		items.value.forEach(l => { if (!row) { const f = l.find(i => i.itemId === itemId); if (f) row = f } })
		if (!row) return
		items.value.set(folderId, [...list, _enrichItem(_clearStamp({ ...row, parentId: folderId }))])
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
			// WHY enrich here: UpdateCreateInventoryItem/BulkUpdateInventory carry raw masks (ownerMask +
			// nextOwnerMask) but NOT the canCopy/canModify/canTransfer convenience flags the perm badges +
			// Properties floater read. Without deriving them the freshly-RECEIVED item shows NM/NC/NT
			// (undefined → falsy) until a reload runs it through setItems/the cap fetch, which does enrich.
			// Shared _enrichItem choke point — same derivation as setItems + applyBulkUpdate.
			const enriched = _enrichItem(it)
			// WHY a pending-move record with fromFolderId=null — a locally-created item the grid hasn't
			// confirmed. A lagging re-fetch of this folder (or a reload skeleton) may not list it yet during
			// write-back lag; the record makes _reconcilePending re-add it so it doesn't vanish, and pins it
			// here until an authoritative fetch confirms (destPresent → SUCCESS, since there is no src). The
			// stamp on the row serialises the record so it survives a reload.
			const rec = _newPending(it.itemId, null, it.parentId)
			pendingMoves.set(it.itemId, rec)
			items.value.set(it.parentId, [...cur, { ...enriched, pendingMove: _pendingRowStamp(rec) }])
		}
		_schedTrigger()
	}

	// Optimistically add a folder the client just asked the sim to create (CreateInventoryFolder
	// has no reply message — the viewer owns the new FolderID). source:'agent' so totals count it.
	function addFolderOptimistic({ folderId, parentId, name, typeDefault = -1 }) {
		if (!folderId || folders.value.has(folderId)) return
		const m = new Map(folders.value)
		// WHY dirty:true — this folder is a local edit the grid hasn't confirmed yet. On the next reload
		// the login skeleton may not include it (or may carry a stale parentId/name) while the grid
		// write-back lags, so applyFolderCache must let the CACHED copy win. Cleared on confirm/BulkUpdate.
		m.set(folderId, { folderId, parentId, name, typeDefault, version: 0, source: 'agent', dirty: true })
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
		// WHY: the grid caught up on this folderId — clear the local-edit marker so the skeleton (now
		// authoritative) wins on the next reload instead of the stale cached copy overriding it.
		delete next.dirty
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

	// Public item lookup: return { item, folderId } for a given itemId, or null if not loaded.
	// WHY: the clipboard (copy/cut/paste) needs the item's row (for canCopy perms + name) and its
	// source folder without every caller re-walking the items map.
	function findItem(itemId) {
		if (!itemId) return null
		let found = null
		items.value.forEach((list, folderId) => {
			if (found) return
			const it = list.find(i => i.itemId === itemId)
			if (it) found = { item: it, folderId }
		})
		return found
	}

	function renameItemLocal(itemId, name) {
		if (!itemId) return
		const folderId = _findItemFolder(itemId)
		if (!folderId) return
		const list = items.value.get(folderId) || []
		items.value.set(folderId, list.map(i => (i.itemId === itemId ? _enrichItem({ ...i, name }) : i)))
		_schedTrigger()
	}

	function renameFolderLocal(folderId, name) {
		if (!folderId) return
		const f = folders.value.get(folderId)
		if (!f) return
		const m = new Map(folders.value)
		// WHY dirty:true — a local rename the grid hasn't confirmed. Marks the cached copy as the
		// winner in applyFolderCache so the reload skeleton's stale name can't revert it during write-back lag.
		m.set(folderId, { ...f, name, dirty: true })
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
		// WHY a pending-move record — a local move the grid hasn't confirmed. _reconcilePending accrues
		// authoritative presence from EACH src/dst fetch so the item (a) survives a lagging DST fetch that
		// omits it, (b) is suppressed in a lagging SRC fetch even AFTER a DST fetch confirms it (record held
		// until src is confirmed clean → fixes BUG A duplicate), and (c) is returned to SRC if the grid
		// never performs the move (fixes BUG B stuck). If a record already exists (re-move / created item
		// moved again), carry its ORIGINAL fromFolderId so the true source stays authoritative.
		const prior = pendingMoves.get(itemId)
		const origFrom = prior ? prior.fromFolderId : fromFolderId
		const rec = _newPending(itemId, origFrom, toFolderId)
		pendingMoves.set(itemId, rec)
		// WHY _enrichItem on the re-placed row: the moving row may have entered the store via a path
		// that predates flag derivation (old IDB cache, optimistic insert) and carry raw masks with no
		// canX — without re-deriving here the MOVED item shows false NM/NC/NT until a full reload.
		if (!toList.some(i => i.itemId === itemId)) {
			items.value.set(toFolderId, [...toList, _enrichItem({ ...moving, parentId: toFolderId, pendingMove: _pendingRowStamp(rec) })])
		} else {
			items.value.set(toFolderId, toList.map(i => (i.itemId === itemId ? _enrichItem({ ...i, parentId: toFolderId, pendingMove: _pendingRowStamp(rec) }) : i)))
		}
		_schedTrigger()
	}

	function moveFolderLocal(folderId, toParentId) {
		if (!folderId || !toParentId || folderId === toParentId) return
		const f = folders.value.get(folderId)
		if (!f || f.parentId === toParentId) return
		const m = new Map(folders.value)
		// WHY dirty:true — a local move the grid hasn't confirmed. applyFolderCache lets this cached
		// parentId win over the reload skeleton's stale parentId until the grid write-back lands.
		m.set(folderId, { ...f, parentId: toParentId, dirty: true })
		folders.value = m
	}

	// Drop an item from whatever folder list it's in (purge / sim-driven removal).
	function removeItemLocal(itemId) {
		if (!itemId) return
		// WHY: an authoritative local removal (purge) supersedes any pending move — drop the record so a
		// stale src/dst fetch can never resurrect the item via the state machine.
		pendingMoves.delete(itemId)
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

	// ── AUTHORIZED SHRINK: purge ALL descendants of a folder (Empty Trash) ──────────────────────
	// Mirrors FS purge_descendents_of (llviewerinventory.cpp:1898): on OpenSim (no AIS cap) the
	// viewer sends PurgeInventoryDescendents and "Update[s] model immediately because there is no
	// callback mechanism" (llviewerinventory.cpp:1955-1965, gInventory.onDescendentsPurgedFromServer).
	// This is that immediate model update: remove every descendant folder + item locally, retire
	// their pendingMoves records, and mark the purged folders FETCHED. The fetched flag is what turns
	// the non-shrinking cache save into an AUTHORIZED shrink — mergeItemPairs (inventoryCache.js)
	// treats a fetched folder's now-empty list as authoritative, so the next save DROPS the purged
	// rows instead of resurrecting them from the previous snapshot. Returns the purged ids so the
	// caller can also evict the purged FOLDERS from the IDB folder cache (saveCachedFolders UNIONS
	// prev+next — it can never shrink on its own — so a targeted removeCachedFolder is required).
	function purgeDescendantsLocal(folderId) {
		const out = { itemIds: [], folderIds: [] }
		if (!folderId || !folders.value.has(folderId)) return out
		// Collect descendant folders breadth-first (cycle-safe via `seen`).
		const seen = new Set([folderId])
		const queue = [folderId]
		while (queue.length) {
			const cur = queue.shift()
			folders.value.forEach(f => {
				if (f.parentId === cur && !seen.has(f.folderId)) {
					seen.add(f.folderId)
					out.folderIds.push(f.folderId)
					queue.push(f.folderId)
				}
			})
		}
		// Items in the purged root + every descendant folder. A purge is authoritative — retire any
		// pending-move record so a stale src/dst fetch can never resurrect a purged row through the
		// move-reconciliation state machine (same rule as removeItemLocal).
		for (const fid of [folderId, ...out.folderIds]) {
			for (const it of (items.value.get(fid) || [])) {
				if (!it?.itemId) continue
				out.itemIds.push(it.itemId)
				pendingMoves.delete(it.itemId)
			}
		}
		// Also retire records whose DESTINATION is inside the purged subtree (an item optimistically
		// moved into Trash whose row hasn't landed in the stored list yet) — otherwise a later fetch
		// of its src folder would pin the purged item back into existence.
		for (const rec of [...pendingMoves.values()]) {
			if (seen.has(rec.toFolderId)) pendingMoves.delete(rec.itemId)
		}
		// Drop descendant folders from the tree + their item lists. Mark them FETCHED too: their
		// lists are now authoritatively empty this session, so mergeItemPairs drops their previously-
		// cached rows on the next save instead of keeping them (the shrink is authorized).
		if (out.folderIds.length) {
			const m = new Map(folders.value)
			for (const fid of out.folderIds) {
				m.delete(fid)
				items.value.delete(fid)
				fetched.value.add(fid)
				fetching.value.delete(fid)
			}
			folders.value = m
		}
		// The purged folder itself survives (Empty Trash keeps Trash), EMPTY — and authoritatively so.
		items.value.set(folderId, [])
		fetched.value.add(folderId)
		fetching.value.delete(folderId)
		_schedTrigger()
		return out
	}

	// Recompute the cached convenience perm flags from the mask bits (PERM_COPY 0x8000,
	// PERM_MODIFY 0x4000, PERM_TRANSFER 0x2000 — see phoenix-firestorm llpermissionsflags.h).
	// canCopy/canModify/canTransfer = current-owner perms (the "You can" badges);
	// nextCan* = perms a recipient inherits (Next-Owner section of the Properties floater).
	function _permFlags(ownerMask, nextOwnerMask) {
		const m = ownerMask | 0
		const n = nextOwnerMask | 0
		return {
			canCopy:         (m & 0x8000) !== 0,
			canModify:       (m & 0x4000) !== 0,
			canTransfer:     (m & 0x2000) !== 0,
			nextCanCopy:     (n & 0x8000) !== 0,
			nextCanModify:   (n & 0x4000) !== 0,
			nextCanTransfer: (n & 0x2000) !== 0,
		}
	}

	// THE single enrichment choke point: derive the canX/nextCanX convenience flags from the row's
	// own masks. EVERY path that writes an item row into `items` must funnel through this (setItems,
	// applyCachedItems, addCreatedItems, addToFavorites, moveItemLocal, renameItemLocal,
	// updateItemPermsLocal, applyBulkUpdate, and the move-reconciliation re-place/ensure/survivor
	// rewrites). WHY: any path that skipped derivation left canX undefined (→ falsy) and the row
	// rendered false NM/NC/NT until a reload pushed it back through the cap fetch. Rows without an
	// ownerMask are passed through untouched — never fabricate all-false flags from a missing mask.
	function _enrichItem(it) {
		if (!it || it.ownerMask == null) return it
		const out = { ...it, ..._permFlags(it.ownerMask, it.nextOwnerMask) }
		// Symmetric no-fabrication: a row carrying ownerMask but NO nextOwnerMask (e.g. a mask-less
		// ack merged over a legacy row) keeps whatever nextCan* it already had rather than getting
		// all-false derived from the missing mask.
		if (it.nextOwnerMask == null) {
			out.nextCanCopy = it.nextCanCopy
			out.nextCanModify = it.nextCanModify
			out.nextCanTransfer = it.nextCanTransfer
		}
		return out
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
			return _enrichItem(next)
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
				// WHY: a BulkUpdate/fetch carrying this folderId means the grid caught up — clear the
				// local-edit marker so the skeleton wins on the next reload (spread `prev` first so a
				// stale prev.dirty doesn't linger, then the explicit delete removes it either way).
				const next = { source: 'agent', ...prev, ...f }
				delete next.dirty
				m.set(f.folderId, next)
			}
			folders.value = m
		}
		if (Array.isArray(its) && its.length) {
			for (const it of its) {
				if (!it?.itemId || !it?.parentId) continue
				// WHY: an authoritative BulkUpdate ack for this item means the grid caught up — retire any
				// pending-move record so a later lagging src/dst fetch can't re-run the state machine, and
				// so the persisted cache stops carrying the stamp.
				pendingMoves.delete(it.itemId)
				// Remove any stale copy from its previous folder (move/rename reconciliation), but KEEP the
				// row: a migrate ack that omits fields (masks, desc, createdAt) must not erase them — the
				// insert below merges prevRow under the ack, mirroring the update-in-place branch. Without
				// this a BulkUpdate move ack carrying no masks left the re-placed row with no ownerMask and
				// therefore no derivable canX → false NM/NC/NT until reload (the recurring move-path bug).
				const oldFolder = _findItemFolder(it.itemId)
				let prevRow = null
				if (oldFolder) {
					const ol = items.value.get(oldFolder) || []
					prevRow = ol.find(x => x.itemId === it.itemId) || null
					if (oldFolder !== it.parentId) {
						items.value.set(oldFolder, ol.filter(x => x.itemId !== it.itemId))
					}
				}
				const list = items.value.get(it.parentId) || []
				const idx = list.findIndex(x => x.itemId === it.itemId)
				// WHY _enrichItem: recompute canCopy/canModify/canTransfer from the MERGED row's masks —
				// otherwise a perms change reconciled here (live via the EventQueue path) updates the raw
				// mask but leaves the cached flags (and rendered perm tags) stale. Deriving from the merged
				// row (not just the ack's fields) also keeps nextCan* correct when the ack carries an
				// ownerMask but omits nextOwnerMask (the previous row's mask stays authoritative).
				if (idx >= 0) {
					// WHY _clearStamp: the grid confirmed this item — strip the transient pending stamp so
					// it's authoritative and never re-injected by a stale fetch.
					list[idx] = _clearStamp(_enrichItem({ ...list[idx], ...it }))
				} else {
					items.value.set(it.parentId, [...list, _clearStamp(_enrichItem({ ...prevRow, ...it }))])
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

	// WHY: OpenSim's inventory-offer ACK (IM dialog 5 "received") comes back with fromAgentId = the
	// RECIPIENT but fromAgentName = the GIVER's name (an OpenSim quirk). To render FS's "[recipient]
	// received your inventory offer." we resolve the recipient's real name from our OWN give record —
	// giveInventory notes it here keyed by the recipient's agentId, and useInstantMessage reads it on
	// the dialog-5/6 ack. Plain Map (non-reactive) — this is a lookup cache, not rendered state.
	const _giveRecipientNames = new Map()
	function noteGiveRecipient(agentId, name) { if (agentId) _giveRecipientNames.set(agentId, name || '') }
	function giveRecipientName(agentId) { return agentId ? (_giveRecipientNames.get(agentId) || '') : '' }

	return {
		folders, rootId, libRootId, items, fetched, fetching, caps, capsReady, cacheLoaded,
		selectedId, sortMode, systemFoldersToTop, contextMenu, propsTargets, dragPayload, setDrag, clearDrag,
		loadFromLogin, childFolders, folderItems, isExpanded, isFetched, isFetching,
		markFetching, setCaps, applyCachedItems, applyFolderCache, toggle, expandAll, collapseAll,
		ensureExpand, dropExpand, expandedUnion, isFilterCollapsed, toggleFilterCollapse, clearFilterCollapse, findSystemFolder, isInTrash,
		select, descendantCounts,
		setSort, setSystemFoldersToTop, toggleSystemFoldersToTop, sortItems, openContextMenu, closeContextMenu, resolveTarget, showProperties, closePropertiesFor, closeProperties, addToFavorites,
		setItems, folderCount, itemCount, clear, findItem,
		agentFolderIds, agentFolderCount, agentItemCount, agentFetchedCount, allAgentFetched,
		pendingAgentFolders, addCreatedItems, addFolderOptimistic, confirmFolder, landmarkTargetFolders,
		renameItemLocal, renameFolderLocal, moveItemLocal, moveFolderLocal,
		removeItemLocal, removeFolderLocal, purgeDescendantsLocal, updateItemPermsLocal, applyBulkUpdate,
		wornAttachments, markWorn, markDetached,
		noteGiveRecipient, giveRecipientName,
	}
})
