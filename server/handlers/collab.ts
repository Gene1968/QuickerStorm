/**
 * server/handlers/collab.ts — Yjs document sync relay with permission enforcement.
 *
 * Handles Yjs sync protocol over the existing WS envelope:
 *   { t: 'ys', d: { docId, data, roomId?, type?, persistent?, title? } }  — sync step
 *   { t: 'yu', d: { docId, data } }  — incremental update
 *   { t: 'ya', d: { docId, data } }  — awareness update
 *
 * Permission checks:
 *   - Sync (ys): user must have at least 'viewer' access, or doc must be public
 *   - Update (yu): user must have 'editor' or 'owner' role
 *   - Awareness (ya): user must have at least 'viewer' access
 */

import * as Y from 'yjs'
import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getUser, sendToUser, broadcastToRoom } from '../state/world.ts'
import {
	getOrCreateDoc,
	getDoc,
	subscribe,
	unsubscribe,
	applyUpdate,
	getEncodedState,
	getSubscribers,
	loadFromDb,
	checkAccess,
	getOwner,
} from '../state/docs.ts'

/**
 * Broadcast the current subscriber count for a doc to everyone in its room.
 * Includes access info so the WhiteboardButton can show lock state.
 */
function broadcastDocPresence(docId: string, roomId: string) {
	const entry = getDoc(docId)
	const count = getSubscribers(docId).size
	broadcastToRoom(roomId, {
		t: 'dp',
		d: { docId, count, access: entry?.access || 'public' },
	})
}

/**
 * Handle Yjs sync step (client joining a doc or sending sync response).
 *
 * Flow:
 * 1. Client sends { t: 'ys', d: { docId, data: stateVector, roomId, type, persistent } }
 * 2. Server loads/creates doc, checks permissions, subscribes client
 * 3. Sends back full state as update + doc info (role, access, isNew)
 */
export async function handleYjsSync(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	const authUserId = ws.data.authUserId
	if (!userId || !authUserId) return

	const { docId, data: payload, roomId, type, persistent, title } = data
	if (!docId) return

	const state = getUser(userId)
	if (!state) return

	// Get or create the doc entry
	const entry = getOrCreateDoc(docId, {
		roomId: roomId || state.roomId,
		type: type || 'whiteboard',
		persistent: persistent ?? true,
		title: title || 'Untitled',
		createdBy: authUserId,
	})

	// Load from DB if not already loaded
	if (!entry.loadedFromDb) {
		await loadFromDb(docId)
	}

	// ── Permission checks ────────────────────────────────────────────────

	// Archived docs:
	//   - locked   → forced viewer (read-only) for everyone
	//   - unlocked → use normal member roles (owner/editor can still edit)
	if (entry.archived) {
		subscribe(docId, userId)

		// Send sync data
		const fullState = getEncodedState(docId)
		if (fullState && fullState.length > 0) {
			sendToUser(userId, {
				t: 'ys',
				d: { docId, data: Buffer.from(fullState).toString('base64') },
			})
		} else {
			sendToUser(userId, { t: 'ys', d: { docId, data: '' } })
		}

		const memberRole = entry.members.get(authUserId) || (entry.access === 'public' ? 'editor' : null)
		let effectiveRole: 'owner' | 'editor' | 'viewer'
		if (entry.locked) {
			effectiveRole = 'viewer'
		} else {
			if (!memberRole) {
				sendToUser(userId, {
					t: 'yd',
					d: { docId, reason: 'no-access', owner: getOwner(docId) },
				})
				return
			}
			effectiveRole = memberRole
		}

		const isActualOwner = entry.members.get(authUserId) === 'owner'
		const docInfo: any = {
			docId,
			isNew: false,
			role: effectiveRole,
			isActualOwner,
			access: entry.access,
			owner: getOwner(docId),
			title: entry.title,
			archived: true,
			locked: entry.locked,
		}
		// Include members list for actual owner so the settings panel works
		// even when the effective role got clamped to 'viewer' by lock state.
		if (isActualOwner) {
			docInfo.members = []
			for (const [uid, r] of entry.members) docInfo.members.push({ userId: uid, role: r })
		}
		sendToUser(userId, { t: 'yi', d: docInfo })
		return
	}

	// Brand new board: first user becomes owner
	if (entry.isNew) {
		entry.createdBy = authUserId
		entry.members.set(authUserId, 'owner')
		entry.permissionsLoaded = true

		// Subscribe and sync
		subscribe(docId, userId)
		broadcastDocPresence(docId, entry.roomId)

		// Send empty sync so client marks as synced (board is empty)
		sendToUser(userId, {
			t: 'ys',
			d: { docId, data: '' },
		})

		// Send doc info: this is a new board, show setup modal
		sendToUser(userId, {
			t: 'yi',
			d: { docId, isNew: true, role: 'owner', access: entry.access, owner: authUserId, title: entry.title },
		})
		return
	}

	// Check access for existing boards
	const role = checkAccess(docId, authUserId)
	if (!role) {
		// No access — send denied
		const owner = getOwner(docId)
		sendToUser(userId, {
			t: 'yd',
			d: { docId, reason: 'no-access', owner },
		})
		return
	}

	// ── User has access — subscribe and sync ─────────────────────────────

	subscribe(docId, userId)
	broadcastDocPresence(docId, entry.roomId)

	// Send sync data
	if (payload) {
		try {
			const clientSv = Buffer.from(payload, 'base64')
			const update = Y.encodeStateAsUpdate(entry.doc, new Uint8Array(clientSv))
			const updateB64 = Buffer.from(update).toString('base64')
			sendToUser(userId, {
				t: 'ys',
				d: { docId, data: updateB64 },
			})
		} catch (e: any) {
			console.warn(`[collab] sync error for doc ${docId}:`, e.message)
		}
	} else {
		const fullState = getEncodedState(docId)
		if (fullState && fullState.length > 0) {
			sendToUser(userId, {
				t: 'ys',
				d: { docId, data: Buffer.from(fullState).toString('base64') },
			})
		}
	}

	// Send doc info with role (include members list for owners)
	const isActualOwner = entry.members.get(authUserId) === 'owner'
	const docInfo: any = {
		docId,
		isNew: false,
		role,
		isActualOwner,
		access: entry.access,
		owner: getOwner(docId),
		title: entry.title,
		archived: false,
		locked: entry.locked,
	}
	if (isActualOwner) {
		docInfo.members = []
		for (const [uid, r] of entry.members) {
			docInfo.members.push({ userId: uid, role: r })
		}
	}
	sendToUser(userId, { t: 'yi', d: docInfo })
}

/**
 * Handle Yjs incremental update from a client.
 * Apply to server doc and relay to all other subscribers.
 * Only editors and owners can write.
 */
export function handleYjsUpdate(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	const authUserId = ws.data.authUserId
	if (!userId || !authUserId) return

	const { docId, data: payload } = data
	if (!docId || !payload) return

	// Permission check: must be editor or owner
	const role = checkAccess(docId, authUserId)
	if (!role || role === 'viewer') return  // silently drop

	// Apply update to server-held Y.Doc
	try {
		const update = Buffer.from(payload, 'base64')
		applyUpdate(docId, new Uint8Array(update))
	} catch (e: any) {
		console.warn(`[collab] update error for doc ${docId}:`, e.message)
		return
	}

	// Relay to all other subscribers
	const subscribers = getSubscribers(docId)
	for (const subId of subscribers) {
		if (subId === userId) continue
		sendToUser(subId, {
			t: 'yu',
			d: { docId, data: payload },
		})
	}
}

/**
 * Handle Yjs awareness update (cursor position, selection, user info).
 * Purely ephemeral — relay to subscribers, never persist.
 * Viewers can receive awareness but also send (their cursor is visible).
 */
export function handleYjsAwareness(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const { docId, data: payload } = data
	if (!docId || !payload) return

	// Relay to all other subscribers (no permission check for awareness — if subscribed, they can send)
	const subscribers = getSubscribers(docId)
	for (const subId of subscribers) {
		if (subId === userId) continue
		sendToUser(subId, {
			t: 'ya',
			d: { docId, data: payload },
		})
	}
}

/**
 * Handle a client leaving a doc (explicit close or disconnect cleanup).
 */
export function handleDocClose(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const { docId } = data
	if (!docId) return

	const entry = getDoc(docId)
	const roomId = entry?.roomId
	unsubscribe(docId, userId)
	if (roomId) broadcastDocPresence(docId, roomId)
}
