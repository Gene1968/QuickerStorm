<script setup>
// Scoped inventory TREE for the Recent / Worn tabs. FS renders these tabs as real inventory
// panels (trees) with a filter applied — panel_main_inventory.xml "Recent Items" is an
// <inventory_panel> over the whole hierarchy (folders auto-open on matches, empties hidden),
// and FS's Worn tab is the same idea over currently-worn rows. This wrapper re-renders
// InventoryTreeNode under a SHADOWED `invFilter` provide whose item predicate defines the tab;
// `filtersActive` is pinned true so the tree auto-reveals matching branches exactly like an
// active search does (per-window filter-collapse still lets the user fold folders).
import { computed, provide } from 'vue'
import { useInventoryStore } from '@/stores/inventoryStore'
import InventoryTreeNode from '@/components/InventoryTreeNode.vue'

const props = defineProps({
	// Set<string> of itemIds in scope for this tab (rebuilt by the parent's computed).
	itemIds: { type: Object, required: true },
})
const inv = useInventoryStore()

function itemVisible(it) { return props.itemIds.has(it.itemId) }
// A folder shows when any descendant item is in scope (cycle-safe DFS, same guard as isInTrash).
function folderHasMatch(folderId) {
	const stack = [folderId]
	const seen = new Set()
	while (stack.length) {
		const id = stack.pop()
		if (seen.has(id)) continue
		seen.add(id)
		if (inv.folderItems(id).some(itemVisible)) return true
		for (const c of inv.childFolders(id)) stack.push(c.folderId)
	}
	return false
}

provide('invFilter', {
	filtersActive:     computed(() => true),
	filtering:         computed(() => false),
	typeFilter:        computed(() => 'scoped'),
	folderNameMatches: () => false,
	itemVisible,
	folderHasMatch,
})
</script>

<template>
	<div class="flex-1 min-h-0 overflow-y-auto px-1 py-1">
		<InventoryTreeNode v-if="inv.rootId" :folder-id="inv.rootId" />
	</div>
</template>
