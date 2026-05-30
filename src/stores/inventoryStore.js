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
	}

	// Direct child folders of a folder, name-sorted.
	function childFolders(parentId) {
		const out = []
		folders.value.forEach(f => { if (f.parentId === parentId) out.push(f) })
		out.sort((a, b) => a.name.localeCompare(b.name))
		return out
	}

	function folderItems(folderId) { return items.value.get(folderId) || [] }
	function isExpanded(id)        { return expanded.value.has(id) }
	function isFetched(id)         { return fetched.value.has(id) }

	function toggle(id) {
		const s = new Set(expanded.value)
		if (s.has(id)) s.delete(id); else s.add(id)
		expanded.value = s
	}

	// Slice 2 hook: store fetched folder contents.
	function setItems(folderId, list) {
		const m = new Map(items.value)
		m.set(folderId, list)
		items.value = m
		fetched.value = new Set(fetched.value).add(folderId)
	}

	const folderCount = computed(() => folders.value.size)
	const itemCount   = computed(() => {
		let n = 0
		items.value.forEach(list => { n += list.length })
		return n
	})

	function clear() { loadFromLogin(null) }

	return {
		folders, rootId, libRootId, items, expanded, fetched,
		loadFromLogin, childFolders, folderItems, isExpanded, isFetched,
		toggle, setItems, folderCount, itemCount, clear,
	}
})
