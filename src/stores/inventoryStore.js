// src/stores/inventoryStore.js — agent + library inventory tree.
// WHY: the folder skeleton arrives free in the LOGIN_OK payload (parsed from the XML-RPC login
// response). Folder CONTENTS (items) are fetched lazily per-folder via the FetchInventoryDescendents2
// cap (Phase 3 slice 2) and dropped into `items` by folderId.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { itemMatchesType } from '@/utils/inventoryIcons'

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
	const capsReady = computed(() => caps.value.has('FetchInventoryDescendents2'))
	const filterText = ref('')        // tree search box (matches folder + loaded item names + perms)
	const filtering  = computed(() => filterText.value.trim().length > 0)
	const typeFilter = ref('all')     // TYPE_FILTERS id; 'all' = no type restriction
	const selectedId = ref('')        // selected folder/item id (drives footer + highlight)
	const filtersActive = computed(() => filtering.value || typeFilter.value !== 'all')

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
		filterText.value = ''
		typeFilter.value = 'all'
		selectedId.value = ''
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

	// ── Filter matching (folder names always available; item names only once fetched) ──
	function nameMatches(name) { return (name || '').toLowerCase().includes(filterText.value.trim().toLowerCase()) }
	function folderNameMatches(folderId) { const f = folders.value.get(folderId); return !!f && nameMatches(f.name) }

	// WHY: fold the FS-style "(no copy)(no modify)(no transfer)" tags into the searchable text so
	// the filter box can find restricted items (e.g. type "no transfer").
	function itemSearchText(it) {
		let s = it.name || ''
		if (it.canCopy === false)     s += ' no copy'
		if (it.canModify === false)   s += ' no modify'
		if (it.canTransfer === false) s += ' no transfer'
		return s
	}
	// An item passes the active filters (text + type).
	function itemVisible(it) {
		return nameMatches(itemSearchText(it)) && itemMatchesType(it, typeFilter.value)
	}
	function folderHasMatch(folderId) {
		if (!filtersActive.value) return true
		// Folder-name text match reveals all contents only when no type restriction is set.
		if (filtering.value && typeFilter.value === 'all' && folderNameMatches(folderId)) return true
		for (const it of folderItems(folderId)) if (itemVisible(it)) return true
		for (const c of childFolders(folderId)) if (folderHasMatch(c.folderId)) return true
		return false
	}

	function select(id) { selectedId.value = id }

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

	function clear() { loadFromLogin(null) }

	return {
		folders, rootId, libRootId, items, expanded, fetched, fetching, caps, capsReady,
		filterText, filtering, typeFilter, selectedId, filtersActive,
		loadFromLogin, childFolders, folderItems, isExpanded, isFetched, isFetching,
		markFetching, setCaps, toggle, expandAll, collapseAll, findSystemFolder,
		nameMatches, folderNameMatches, folderHasMatch, itemVisible, select, descendantCounts,
		setItems, folderCount, itemCount, clear,
		agentFolderIds, agentFolderCount, agentItemCount, agentFetchedCount, allAgentFetched,
		pendingAgentFolders,
	}
})
