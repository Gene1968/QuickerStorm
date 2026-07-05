// src/composables/useTaskInventory.js — prim (task) inventory: client state + the "Open" flow.
//
// Wire: C.REQUEST_TASK_INV { localId } → server RequestTaskInventory (Low 289) → ReplyTaskInventory
// → Xfer download → legacy-file parse (server/lib/taskInventory.ts) → S.TASK_INV { localId, taskId,
// serial, items, error? } or S.TASK_INV_EMPTY. FS model: llviewerobject.cpp:3009 requestInventory +
// llpanelobjectinventory.cpp (Content tab). "Open" = llfloateropenobject.cpp:155 moveToInventory —
// create an agent folder named after the object, then MoveTaskInventory (Low 288) per item; the sim
// acks each via the normal UpdateCreateInventoryItem/BulkUpdateInventory inventory machinery.
//
// Module-singleton (same pattern as useSoundEngine): state survives floater open/close; socket
// handlers are keyed so an HMR re-init never stacks duplicates.
import { reactive } from 'vue'
import { S, C } from '@shared/protocol.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
import { useLLUDP } from '@/composables/useLLUDP'
import { useInventoryStore } from '@/stores/inventoryStore'
import { useNotifications } from '@/composables/useNotifications'

// localId → { loading, loadedAt, empty, error, taskId, serial, items }
// WHY reactive Map: the Content tab renders straight off entries; TASK_INV mutates the SAME entry
// object in place so any in-flight openContents() poll sees the update too.
const _state = reactive(new Map())

// Server's Xfer watchdog gives up at 30s and sends TASK_INV{error}; this only catches the sim
// never answering ReplyTaskInventory at all (e.g. no perms — OpenSim replies silently-nothing).
const NO_REPLY_TIMEOUT_MS = 35_000
const _timeouts = new Map()   // localId → timer

let _inited = false
let _lludp = null
let _emit = null

function _entry(localId) {
	let e = _state.get(localId)
	if (!e) {
		e = reactive({ loading: false, loadedAt: 0, empty: false, error: null, taskId: null, serial: 0, items: [] })
		_state.set(localId, e)
	}
	return e
}

function _settle(localId, patch) {
	const e = _entry(localId)
	clearTimeout(_timeouts.get(localId)); _timeouts.delete(localId)
	Object.assign(e, { loading: false, loadedAt: Date.now(), error: null }, patch)
}

function _onTaskInv(d) {
	if (d?.localId == null) return
	_settle(d.localId, {
		empty: !d.items?.length && !d.error,
		error: d.error ?? null,
		taskId: d.taskId ?? null,
		serial: d.serial ?? 0,
		items: d.items ?? [],
	})
}

function _onTaskInvEmpty(d) {
	if (d?.localId == null) return
	_settle(d.localId, { empty: true, taskId: d.taskId ?? null, serial: d.serial ?? 0, items: [] })
}

function _onKill(d) {
	const ids = d?.ids
	if (!Array.isArray(ids)) return
	for (const id of ids) {
		_state.delete(id)
		clearTimeout(_timeouts.get(id)); _timeouts.delete(id)
	}
}

function _init() {
	if (_inited) return
	_inited = true
	const sock = useRealtimeSocket()
	_emit = sock.emit
	_lludp = useLLUDP()
	sock.on(S.TASK_INV,       _onTaskInv,      'taskinv:inv')
	sock.on(S.TASK_INV_EMPTY, _onTaskInvEmpty, 'taskinv:empty')
	sock.on(S.KILL_OBJECT,    _onKill,         'taskinv:kill')
}

export function useTaskInventory() {
	_init()

	function taskInvFor(localId) { return _state.get(localId) }

	/** Fetch a prim's contents. Re-requests freely (the sim's `serial` keeps replies consistent);
	 *  skips only when a request is already in flight or one landed under 3s ago (tab-flip guard). */
	function requestContents(localId, { force = false } = {}) {
		if (localId == null) return
		const e = _entry(localId)
		if (e.loading) return
		if (!force && e.loadedAt && Date.now() - e.loadedAt < 3000) return
		e.loading = true
		e.error = null
		_lludp.requestTaskInventory(localId)
		clearTimeout(_timeouts.get(localId))
		_timeouts.set(localId, setTimeout(() => {
			if (e.loading) Object.assign(e, { loading: false, error: 'No response from the region — you may not be allowed to view this object’s contents.' })
		}, NO_REPLY_TIMEOUT_MS))
	}

	/** FS "Open": copy this prim's contents into a new agent-inventory folder named after the
	 *  object (llfloateropenobject.cpp:155). Per-item perm refusals are the sim's call — they
	 *  surface via the AlertMessage → toast path, matching the take-watchdog philosophy. */
	async function openContents(localId, objectName) {
		const { notifyInfo } = useNotifications()
		const e = _entry(localId)
		if (!e.items.length && !e.loading) requestContents(localId)
		const t0 = Date.now()
		while (e.loading && Date.now() - t0 < NO_REPLY_TIMEOUT_MS) await new Promise(r => setTimeout(r, 250))
		if (e.error) { notifyInfo('Open object', e.error); return false }
		if (!e.items.length) { notifyInfo('Open object', 'This object has no contents.'); return false }
		const inv = useInventoryStore()
		if (!inv.rootId) { notifyInfo('Open object', 'Your inventory hasn’t loaded yet — try again in a moment.'); return false }
		const name = (objectName ?? '').trim() || 'Object Contents'
		// Folder create mirrors useInventory.createFolder minus the inline-rename UX (the name is
		// the object's, FS-style). Client owns the FolderID; the CreateInventoryCategory cap
		// persists it. (No IDB micro-save here — a hard reload inside the grid write-back window
		// re-fetches without it, but the moved items' acks re-anchor it via the normal machinery.)
		const folderId = crypto.randomUUID()
		_emit(C.CREATE_INV_FOLDER, { folderId, parentId: inv.rootId, name })
		inv.addFolderOptimistic({ folderId, parentId: inv.rootId, name, typeDefault: -1 })
		for (const it of e.items) _lludp.moveTaskInventory(localId, it.itemId, folderId)
		notifyInfo('Open object', `Copying ${e.items.length} item${e.items.length === 1 ? '' : 's'} to “${name}” in your inventory.`)
		return true
	}

	return { taskInvFor, requestContents, openContents }
}
