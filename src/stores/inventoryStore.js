// src/stores/inventoryStore.js — agent + library inventory tree.
// WHY: the folder skeleton arrives free in the LOGIN_OK payload (parsed from the XML-RPC login
// response). Folder CONTENTS (items) are fetched lazily per-folder via the FetchInventoryDescendents2
// cap (Phase 3 slice 2) and dropped into `items` by folderId.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useInventoryStore = defineStore('inventory', () => {
	// folders: Map<folderId, { folderId, parentId, name, typeDefault, version, source }>
	const folders   = ref(new Map())
	const rootId    = ref('')   // agent root ("My Inventory")
	const libRootId = ref('')   // shared Library root
	const items     = ref(new Map())  // Map<folderId, Item[]> — filled by cap fetch
	const expanded  = ref(new Set())  // folderIds currently expanded in the tree
	const fetched   = ref(new Set())  // folderIds whose contents have been fetched
	const fetching  = ref(new Set())  // folderIds with an in-flight fetch
	const caps      = ref(new Set())  // HTTP cap names the sim offered (after seed-cap fetch)
	// WHY: grids name the descendents cap differently (modern vs legacy). Accept either.
	const capsReady = computed(() => caps.value.has('FetchInventoryDescendents2') || caps.value.has('WebFetchInventoryDescendents'))
	const selectedId = ref('')        // selected folder/item id (drives footer + highlight)
	const sortMode   = ref('name')    // item sort within a folder: 'name' | 'date' | 'type'
	const contextMenu = ref(null)     // { x, y, kind:'item'|'folder', obj } | null
	const propsTarget = ref(null)     // { kind, obj } shown in the Properties popover | null

	function loadFromLogin(d) {
		const m = new Map()
		for (const f of (d?.inventorySkeleton    || [])) m.set(f.folderId, { ...f, source: 'agent' })
		for (const f of (d?.inventorySkeletonLib || [])) m.set(f.folderId, { ...f, source: 'library' })
		folders.value   = m
		rootId.value    = d?.inventoryRoot    || ''
		libRootId.value = d?.inventoryLibRoot || ''
		items.value     = new Map()
		// WHY: auto-expand the root so the tree isn't a single collapsed row on open.
		expanded.value  = new Set(rootId.value ? [rootId.value] : [])
		fetched.value   = new Set()
		fetching.value  = new Set()
		// WHY: caps belong to the session — re-armed by the CAPS_READY message after each login.
		caps.value      = new Set()
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
	function isExpanded(id)        { return expanded.value.has(id) }
	function isFetched(id)         { return fetched.value.has(id) }
	function isFetching(id)        { return fetching.value.has(id) }

	function markFetching(id) { fetching.value = new Set(fetching.value).add(id) }
	function setCaps(names) { caps.value = new Set(names || []) }

	function toggle(id) {
		const s = new Set(expanded.value)
		if (s.has(id)) s.delete(id); else s.add(id)
		expanded.value = s
	}

	function expandAll() {
		const s = new Set()
		folders.value.forEach(f => s.add(f.folderId))
		expanded.value = s
	}
	function collapseAll() {
		expanded.value = new Set(rootId.value ? [rootId.value] : [])
	}

	// First folder with the given preferred type (e.g. Favorites=23, Current Outfit=46).
	function findSystemFolder(typeDefault) {
		let found = ''
		folders.value.forEach(f => { if (!found && Number(f.typeDefault) === typeDefault) found = f.folderId })
		return found
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
		let favId = ''
		folders.value.forEach(f => { if (!favId && Number(f.typeDefault) === 23) favId = f.folderId })
		if (!favId) return
		const list = items.value.get(favId) || []
		if (list.some(i => i.itemId === item.itemId)) return
		const m = new Map(items.value)
		m.set(favId, [...list, { ...item, parentId: favId }])
		items.value = m
		if (!fetched.value.has(favId)) fetched.value = new Set(fetched.value).add(favId)
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
	function setItems(folderId, list) {
		const m = new Map(items.value)
		m.set(folderId, list || [])
		items.value = m
		fetched.value = new Set(fetched.value).add(folderId)
		const fset = new Set(fetching.value); fset.delete(folderId); fetching.value = fset
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
		const m = new Map(items.value)
		for (const it of list) {
			if (!it?.parentId) continue
			const cur = m.get(it.parentId) || []
			if (cur.some(x => x.itemId === it.itemId)) continue
			m.set(it.parentId, [...cur, it])
		}
		items.value = m
	}

	// Optimistically add a folder the client just asked the sim to create (CreateInventoryFolder
	// has no reply message — the viewer owns the new FolderID). source:'agent' so totals count it.
	function addFolderOptimistic({ folderId, parentId, name, typeDefault = -1 }) {
		if (!folderId || folders.value.has(folderId)) return
		const m = new Map(folders.value)
		m.set(folderId, { folderId, parentId, name, typeDefault, version: 0, source: 'agent' })
		folders.value = m
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

	return {
		folders, rootId, libRootId, items, expanded, fetched, fetching, caps, capsReady,
		selectedId, sortMode, contextMenu, propsTarget,
		loadFromLogin, childFolders, folderItems, isExpanded, isFetched, isFetching,
		markFetching, setCaps, toggle, expandAll, collapseAll, findSystemFolder,
		select, descendantCounts,
		setSort, sortItems, openContextMenu, closeContextMenu, showProperties, closeProperties, addToFavorites,
		setItems, folderCount, itemCount, clear,
		agentFolderIds, agentFolderCount, agentItemCount, agentFetchedCount, allAgentFetched,
		pendingAgentFolders, addCreatedItems, addFolderOptimistic, landmarkTargetFolders,
	}
})
