// src/composables/useInventory.js — drives lazy + bulk folder-content fetches over the cap layer.
// Folder TREE comes from the login skeleton (inventoryStore.loadFromLogin). Folder ITEMS are
// fetched here: expanding a folder (or the background loader) → C.INV_FETCH_FOLDER →
// server FetchInventoryDescendents2 → S.INV_FOLDER → inventoryStore.setItems.
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useInventoryStore } from '@/stores/inventoryStore'
import { C, S } from '@shared/protocol.js'

const BATCH        = 40   // folders per cap POST (server batches them into one request)
const MAX_INFLIGHT = 80   // cap on folders awaiting reply during the background bulk load
const PUMP_MS      = 150

let registered = false
let pump = null

export function useInventory() {
	const { on, off, emit } = useRealtimeSocket()
	const inv = useInventoryStore()

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
			const fset = new Set(inv.fetching); fset.delete(d.folderId); inv.fetching = fset
			return
		}
		inv.setItems(d.folderId, d.items || [])
	}

	function onCapsReady(d) {
		inv.setCaps(d?.caps || [])
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

	// Create a new folder. The client owns the FolderID (CreateInventoryFolder has no reply),
	// so we generate it, tell the sim, and optimistically add it to the tree. Returns the id.
	function createFolder({ name, parentId, typeDefault = -1 }) {
		if (!parentId) return ''
		const folderId = crypto.randomUUID()
		emit(C.CREATE_INV_FOLDER, { folderId, parentId, name: name || 'New Folder' })
		inv.addFolderOptimistic({ folderId, parentId, name: name || 'New Folder', typeDefault })
		return folderId
	}

	onMounted(() => {
		if (!registered) {
			on(S.INV_FOLDER,       onInvFolder)
			on(S.CAPS_READY,       onCapsReady)
			on(S.INV_ITEM_CREATED, onItemCreated)
			registered = true
		}
	})
	// Keep handlers registered for the session — module-level state survives component unmount.
	onUnmounted(() => {})

	return { fetchFolder, fetchFolders, fetchAll, stopFetchAll, createLandmark, createFolder }
}
