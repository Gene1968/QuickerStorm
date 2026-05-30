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
	const capsReady = computed(() => caps.value.has('FetchInventoryDescendents2'))
	const filterText = ref('')        // tree search box (matches folder + loaded item names)
	const filtering  = computed(() => filterText.value.trim().length > 0)

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
	function folderHasMatch(folderId) {
		if (!filtering.value) return true
		if (folderNameMatches(folderId)) return true
		for (const it of folderItems(folderId)) if (nameMatches(it.name)) return true
		for (const c of childFolders(folderId)) if (folderHasMatch(c.folderId)) return true
		return false
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

	function clear() { loadFromLogin(null) }

	return {
		folders, rootId, libRootId, items, expanded, fetched, fetching, caps, capsReady,
		filterText, filtering,
		loadFromLogin, childFolders, folderItems, isExpanded, isFetched, isFetching,
		markFetching, setCaps, toggle, expandAll, collapseAll, findSystemFolder,
		nameMatches, folderNameMatches, folderHasMatch,
		setItems, folderCount, itemCount, clear,
	}
})
