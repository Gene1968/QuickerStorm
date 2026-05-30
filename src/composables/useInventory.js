// src/composables/useInventory.js — drives lazy folder-content fetches over the cap layer.
// Folder TREE comes from the login skeleton (inventoryStore.loadFromLogin). Folder ITEMS are
// fetched here on demand: expanding a folder → C.INV_FETCH_FOLDER → server FetchInventoryDescendents2
// → S.INV_FOLDER → inventoryStore.setItems. Server resolves the cap URL (kept server-side).
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useInventoryStore } from '@/stores/inventoryStore'
import { C, S } from '@shared/protocol.js'

let registered = false

export function useInventory() {
	const { on, off, emit } = useRealtimeSocket()
	const inv = useInventoryStore()

	function fetchFolder(folderId) {
		if (!folderId) return
		if (inv.isFetched(folderId) || inv.isFetching(folderId)) return
		// WHY: caps arrive ~3s after login (seed-cap fetch). If not ready, skip silently — the
		// CAPS_READY handler refetches every expanded-but-unfetched folder once they land.
		if (!inv.capsReady) return
		inv.markFetching(folderId)
		emit(C.INV_FETCH_FOLDER, { folderId })
	}

	function onInvFolder(d) {
		if (!d?.folderId) return
		// cap not ready yet → clear the in-flight flag without marking fetched, so a later
		// CAPS_READY (or re-expand) retries.
		if (d.error === 'cap_unavailable') {
			const fset = new Set(inv.fetching); fset.delete(d.folderId); inv.fetching = fset
			return
		}
		inv.setItems(d.folderId, d.items || [])
	}

	function onCapsReady(d) {
		inv.setCaps(d?.caps || [])
		// Backfill any folder already expanded before caps were ready (root auto-expands on load).
		for (const id of inv.expanded) {
			if (!inv.isFetched(id)) fetchFolder(id)
		}
	}

	onMounted(() => {
		if (!registered) {
			on(S.INV_FOLDER,  onInvFolder)
			on(S.CAPS_READY,  onCapsReady)
			registered = true
		}
	})
	// Keep handlers registered for the session — module-level state survives component unmount.
	onUnmounted(() => {})

	return { fetchFolder }
}
