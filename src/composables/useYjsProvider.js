/**
 * useYjsProvider — Client-side Yjs document sync over the shared WebSocket.
 *
 * Provides a managed Y.Doc per docId, synced via the existing multiplexed WS
 * connection (useRealtimeSocket). Implements the Yjs sync protocol, awareness,
 * and permission state (role, access, denied, isNew).
 *
 * Usage:
 *   import { useYjsProvider } from '@/composables/useYjsProvider.js'
 *   const { doc, awareness, connect, disconnect, connected, role, denied } = useYjsProvider(docId, opts)
 */

import { ref, watch, onUnmounted } from 'vue'
import * as Y from 'yjs'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'

// Module-level cache: one Y.Doc per docId (shared across components)
const docCache = new Map() // docId → { doc, awareness, refCount }

/**
 * Simple awareness implementation for cursor/selection sync.
 */
class SimpleAwareness {
	constructor(doc, clientId) {
		this.doc = doc
		this.clientId = clientId
		this.states = new Map()
		this._localState = {}
		this._listeners = new Set()
	}

	getLocalState() { return this._localState }

	setLocalState(state) {
		this._localState = state
		this.states.set(this.clientId, state)
		this._notify()
	}

	getStates() { return this.states }

	applyRemoteUpdate(update) {
		if (update.clientId === this.clientId) return
		if (update.state === null) {
			this.states.delete(update.clientId)
		} else {
			this.states.set(update.clientId, update.state)
		}
		this._notify()
	}

	encodeLocal() {
		return { clientId: this.clientId, state: this._localState }
	}

	onChange(cb) {
		this._listeners.add(cb)
		return () => this._listeners.delete(cb)
	}

	_notify() {
		for (const cb of this._listeners) {
			try { cb(this.states) } catch (e) { console.error('[awareness] listener error:', e) }
		}
	}

	destroy() {
		this.states.clear()
		this._listeners.clear()
	}
}

/**
 * Create or retrieve a shared Y.Doc + awareness for a given docId.
 */
export function useYjsProvider(docId, opts = {}) {
	const { emit, on, off, connected: wsConnected } = useRealtimeSocket()

	const connected = ref(false)
	const synced = ref(false)

	// ── Permission state ────────────────────────────────────────────────
	const role = ref(null)            // effective role: 'owner' | 'editor' | 'viewer' | null
	const isActualOwner = ref(false)  // true if user is in members map as owner (independent of effective role)
	const access = ref('public')      // 'public' | 'private'
	const isNew = ref(false)          // true if board is brand new (show setup)
	const denied = ref(null)          // { reason, owner } or null
	const owner = ref(null)           // owner's authUserId
	const title = ref('')             // board title
	const members = ref([])           // [{ userId, role }] — populated for actual owners
	const archived = ref(false)       // true if viewing an archived board
	const locked = ref(true)          // when archived: true = read-only for everyone, false = members editable

	// Pending permission operation resolvers
	const _permResolvers = new Map() // action → { resolve, reject }

	// Get or create cached doc
	let cached = docCache.get(docId)
	if (!cached) {
		const doc = new Y.Doc()
		const awareness = new SimpleAwareness(doc, doc.clientID)
		cached = { doc, awareness, refCount: 0 }
		docCache.set(docId, cached)
	}
	cached.refCount++

	const doc = cached.doc
	const awareness = cached.awareness

	// ── WS message handlers ──────────────────────────────────────────────

	function handleSync(data) {
		if (data.docId !== docId) return
		// Empty data means the doc is empty (new board) — still mark as synced
		if (!data.data) {
			synced.value = true
			return
		}
		try {
			const update = _base64ToUint8(data.data)
			Y.applyUpdate(doc, update)
			synced.value = true
		} catch (e) {
			console.error('[yjs] sync apply error:', e)
		}
	}

	function handleUpdate(data) {
		if (data.docId !== docId) return
		if (!data.data) return
		try {
			const update = _base64ToUint8(data.data)
			Y.applyUpdate(doc, update)
		} catch (e) {
			console.error('[yjs] update apply error:', e)
		}
	}

	function handleAwareness(data) {
		if (data.docId !== docId) return
		if (!data.data) return
		try {
			const parsed = JSON.parse(atob(data.data))
			awareness.applyRemoteUpdate(parsed)
		} catch (e) {
			console.error('[yjs] awareness apply error:', e)
		}
	}

	/** Handle access denied from server */
	function handleDenied(data) {
		if (data.docId !== docId) return
		denied.value = { reason: data.reason, owner: data.owner || null }
		connected.value = false
	}

	/** Handle doc info from server (role, access, isNew) */
	function handleDocInfo(data) {
		if (data.docId !== docId) return
		role.value = data.role || null
		isActualOwner.value = data.isActualOwner === true || data.role === 'owner'
		access.value = data.access || 'public'
		isNew.value = data.isNew || false
		owner.value = data.owner || null
		title.value = data.title || ''
		members.value = data.members || []
		archived.value = data.archived || false
		locked.value = data.locked ?? true
		denied.value = null
	}

	/** Handle permission operation results */
	function handlePermResult(data) {
		if (data.docId !== docId && data.docId !== null) return
		const action = data.action
		const resolver = _permResolvers.get(action)
		if (resolver) {
			_permResolvers.delete(action)
			if (data.ok) {
				resolver.resolve(data.data || true)
			} else {
				resolver.reject(new Error(data.error || 'unknown error'))
			}
		}
	}

	// ── Local change observer (sends updates to server) ──────────────────

	function onDocUpdate(update, origin) {
		if (origin === 'remote') return
		const b64 = _uint8ToBase64(update)
		emit('yu', { docId, data: b64 })
	}

	// ── Connect / Disconnect ─────────────────────────────────────────────

	function sendSyncRequest() {
		const sv = Y.encodeStateVector(doc)
		emit('ys', {
			docId,
			data: _uint8ToBase64(sv),
			roomId: opts.roomId,
			type: opts.type || 'whiteboard',
			persistent: opts.persistent ?? true,
			title: opts.title || 'Untitled',
		})
	}

	function connect() {
		// Reset state
		denied.value = null
		role.value = null
		isNew.value = false

		// Register WS listeners
		on('ys', handleSync)
		on('yu', handleUpdate)
		on('ya', handleAwareness)
		on('yd', handleDenied)
		on('yi', handleDocInfo)
		on('ypr', handlePermResult)

		// Listen for local doc changes
		doc.on('update', onDocUpdate)

		// Initial sync request
		sendSyncRequest()
		connected.value = true
	}

	// Re-issue the sync handshake on WebSocket reconnect so the server picks
	// us back up as a subscriber and ships any updates we missed while offline.
	const _stopReconnectWatch = watch(wsConnected, (isConn, wasConn) => {
		if (isConn && !wasConn && connected.value) {
			synced.value = false
			sendSyncRequest()
		}
	})

	function disconnect() {
		connected.value = false
		synced.value = false

		off('ys', handleSync)
		off('yu', handleUpdate)
		off('ya', handleAwareness)
		off('yd', handleDenied)
		off('yi', handleDocInfo)
		off('ypr', handlePermResult)
		doc.off('update', onDocUpdate)

		emit('yc', { docId })
	}

	/**
	 * Broadcast local awareness state to peers.
	 */
	function broadcastAwareness() {
		const encoded = awareness.encodeLocal()
		const b64 = btoa(JSON.stringify(encoded))
		emit('ya', { docId, data: b64 })
	}

	/**
	 * Send a permission operation and return a Promise for the result.
	 */
	function emitPermission(action, payload = {}) {
		return new Promise((resolve, reject) => {
			_permResolvers.set(action, { resolve, reject })
			emit('yp', { docId, action, ...payload })
			// Timeout after 10s
			setTimeout(() => {
				if (_permResolvers.has(action)) {
					_permResolvers.delete(action)
					reject(new Error('permission operation timed out'))
				}
			}, 10000)
		})
	}

	// ── Cleanup on unmount ───────────────────────────────────────────────

	onUnmounted(() => {
		_stopReconnectWatch()
		disconnect()

		cached.refCount--
		if (cached.refCount <= 0) {
			awareness.destroy()
			doc.destroy()
			docCache.delete(docId)
		}
	})

	return {
		doc,
		awareness,
		connected,
		synced,
		connect,
		disconnect,
		broadcastAwareness,
		// Permission state
		role,
		isActualOwner,
		access,
		isNew,
		denied,
		owner,
		title,
		members,
		archived,
		locked,
		emitPermission,
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function _uint8ToBase64(uint8) {
	let binary = ''
	for (let i = 0; i < uint8.length; i++) {
		binary += String.fromCharCode(uint8[i])
	}
	return btoa(binary)
}

function _base64ToUint8(b64) {
	const binary = atob(b64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}
