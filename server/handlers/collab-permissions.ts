/**
 * server/handlers/collab-permissions.ts — Permission management for collaborative docs.
 *
 * Handles { t: 'yp', d: { action, docId, ... } } messages.
 * Actions: setup, update, archive, new-board, list-history
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getUser as getUserState, sendToUser, broadcastToRoom } from '../state/world.ts'
import {
	getDoc,
	getOrCreateDoc,
	getSubscribers,
	getOwner,
	checkAccess,
	loadFromDb,
	removeDoc,
	isMissingLockedColumnError,
	type DocRole,
} from '../state/docs.ts'
import { getSupabase } from '../supabase.ts'

/**
 * Route permission actions.
 */
export async function handlePermissions(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	const authUserId = ws.data.authUserId
	if (!userId || !authUserId) return

	const { action, docId } = data
	if (!action) return

	switch (action) {
		case 'setup':
			await handleSetup(userId, authUserId, data)
			break
		case 'update':
			await handleUpdate(userId, authUserId, data)
			break
		case 'archive':
			await handleArchive(userId, authUserId, data)
			break
		case 'new-board':
			await handleNewBoard(userId, authUserId, data)
			break
		case 'list-history':
			await handleListHistory(userId, authUserId, data)
			break
		case 'list-mine':
			await handleListMine(userId, authUserId, data)
			break
		default:
			sendToUser(userId, { t: 'ypr', d: { docId, action, ok: false, error: 'unknown-action' } })
	}
}

/**
 * List Mine: Return all collab docs the user can access — across every room,
 * active + archived. Used by the phone overlay so users can pop into any
 * whiteboard / doc / task board from anywhere.
 *
 * Payload: { type? }
 * Response data: array of { id, type, title, access, archived, locked, room_id, created_by, created_at, updated_at, archived_at }
 */
async function handleListMine(userId: string, authUserId: string, data: any) {
	const { type } = data
	try {
		const sb = getSupabase()

		// Find docs the user is an explicit member of (any role).
		const { data: memberships, error: memErr } = await sb
			.from('collab_doc_members')
			.select('doc_id')
			.eq('user_id', authUserId)
		if (memErr) {
			sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-mine', ok: false, error: memErr.message } })
			return
		}
		const memberDocIds = new Set((memberships || []).map(m => m.doc_id))

		// Pull all docs (filter by type when provided). We over-fetch then
		// filter access client-side so we don't have to express the OR in SQL.
		const baseCols = 'id, title, type, access, archived, room_id, created_by, created_at, updated_at, archived_at'
		let query = sb
			.from('collab_docs')
			.select(`${baseCols}, locked`)
			.order('updated_at', { ascending: false })
			.limit(200)
		if (type) query = query.eq('type', type)

		let { data: docs, error } = await query

		// Same locked-column fallback as elsewhere in case migration 0015 hasn't run.
		if (isMissingLockedColumnError(error)) {
			let fallback = sb
				.from('collab_docs')
				.select(baseCols)
				.order('updated_at', { ascending: false })
				.limit(200)
			if (type) fallback = fallback.eq('type', type)
			;({ data: docs, error } = await fallback)
		}

		if (error) {
			sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-mine', ok: false, error: error.message } })
			return
		}

		const accessible = (docs || []).filter(d => d.access === 'public' || memberDocIds.has(d.id))
		sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-mine', ok: true, data: accessible } })
	} catch (e: any) {
		console.warn(`[collab-perms] list-mine error:`, e.message)
		sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-mine', ok: false, error: e.message } })
	}
}

/**
 * Setup: First-time board configuration (only works if doc.isNew).
 * Payload: { docId, title, access, members: [{ userId, role }] }
 */
async function handleSetup(userId: string, authUserId: string, data: any) {
	const { docId, title, access, members } = data
	if (!docId) return

	const entry = getDoc(docId)
	if (!entry) {
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'setup', ok: false, error: 'not-found' } })
		return
	}

	// Only the creator (first opener) can set up
	if (entry.createdBy !== authUserId) {
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'setup', ok: false, error: 'not-owner' } })
		return
	}

	// Apply settings
	entry.title = title || entry.title
	entry.access = access || 'public'
	entry.isNew = false
	entry.dirty = true

	// Set members (owner is always the creator)
	entry.members.clear()
	entry.members.set(authUserId, 'owner')
	if (members && Array.isArray(members)) {
		for (const m of members) {
			if (m.userId && m.role && m.userId !== authUserId) {
				entry.members.set(m.userId, m.role as DocRole)
			}
		}
	}

	// Persist to Supabase immediately
	await persistDocAndMembers(docId, entry)

	// Notify the user
	sendToUser(userId, { t: 'ypr', d: { docId, action: 'setup', ok: true } })

	// Send updated doc info to all subscribers
	for (const subId of getSubscribers(docId)) {
		const subState = getUserState(subId)
		const subAuthId = subState?.authUserId
		if (!subAuthId) continue
		const role = checkAccess(docId, subAuthId)
		const subIsActualOwner = entry.members.get(subAuthId) === 'owner'
		const subDocInfo: any = {
			docId,
			isNew: false,
			role,
			isActualOwner: subIsActualOwner,
			access: entry.access,
			owner: authUserId,
			title: entry.title,
			archived: entry.archived,
			locked: entry.locked,
		}
		if (subIsActualOwner) {
			subDocInfo.members = []
			for (const [uid, r] of entry.members) subDocInfo.members.push({ userId: uid, role: r })
		}
		sendToUser(subId, { t: 'yi', d: subDocInfo })
	}
}

/**
 * Update: Change permissions on an existing board. Owner-only.
 * Payload: { docId, access?, title?, members?: [{ userId, role, remove? }] }
 */
async function handleUpdate(userId: string, authUserId: string, data: any) {
	const { docId, access, title, members } = data
	if (!docId) return

	const entry = getDoc(docId)
	if (!entry) {
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'update', ok: false, error: 'not-found' } })
		return
	}

	// Owner check — for archived docs the effective role from checkAccess may
	// be 'viewer' (if locked). Look at the membership map directly so the owner
	// can still toggle settings (e.g. unlock an archived board).
	const isOwner = entry.archived
		? entry.members.get(authUserId) === 'owner'
		: checkAccess(docId, authUserId) === 'owner'
	if (!isOwner) {
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'update', ok: false, error: 'not-owner' } })
		return
	}

	// Apply changes
	if (access) entry.access = access
	if (title) entry.title = title
	if (typeof data.locked === 'boolean') entry.locked = data.locked

	if (members && Array.isArray(members)) {
		for (const m of members) {
			if (!m.userId || m.userId === authUserId) continue  // can't remove/change own owner role
			if (m.remove) {
				entry.members.delete(m.userId)
			} else if (m.role) {
				entry.members.set(m.userId, m.role as DocRole)
			}
		}
	}

	entry.dirty = true
	await persistDocAndMembers(docId, entry)

	sendToUser(userId, { t: 'ypr', d: { docId, action: 'update', ok: true } })

	// Notify all subscribers of updated permissions
	for (const subId of getSubscribers(docId)) {
		const subState = getUserState(subId)
		const subAuthId = subState?.authUserId
		if (!subAuthId) continue

		// Compute effective role identically to handleYjsSync so the
		// archived+locked / archived+unlocked / active flows all stay aligned.
		let effectiveRole: DocRole | null
		if (entry.archived && entry.locked) {
			effectiveRole = 'viewer'
		} else {
			effectiveRole = checkAccess(docId, subAuthId)
		}

		if (!effectiveRole) {
			sendToUser(subId, { t: 'yd', d: { docId, reason: 'access-revoked', owner: authUserId } })
		} else {
			const subIsActualOwner = entry.members.get(subAuthId) === 'owner'
			const subDocInfo: any = {
				docId,
				isNew: false,
				role: effectiveRole,
				isActualOwner: subIsActualOwner,
				access: entry.access,
				owner: authUserId,
				title: entry.title,
				archived: entry.archived,
				locked: entry.locked,
			}
			if (subIsActualOwner) {
				subDocInfo.members = []
				for (const [uid, r] of entry.members) subDocInfo.members.push({ userId: uid, role: r })
			}
			sendToUser(subId, { t: 'yi', d: subDocInfo })
		}
	}
}

/**
 * Archive: Archive the current board. Owner-only.
 * Renames docId to wb-{room}-{timestamp}, sets archived=true.
 * Payload: { docId }
 */
async function handleArchive(userId: string, authUserId: string, data: any) {
	const { docId } = data
	// Default behavior is "archive" (locked=true). Pass locked=false to "Save"
	// — snapshot to history but keep the archived copy editable.
	const locked = data.locked === false ? false : true
	if (!docId) return

	const entry = getDoc(docId)
	if (!entry) {
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'archive', ok: false, error: 'not-found' } })
		return
	}

	const role = checkAccess(docId, authUserId)
	if (role !== 'owner') {
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'archive', ok: false, error: 'not-owner' } })
		return
	}

	const archivedId = `${docId}-${Date.now()}`
	const sb = getSupabase()

	try {
		// Save current Yjs state before archiving
		const Y = await import('yjs')
		const state = Y.encodeStateAsUpdate(entry.doc)
		const yjs_state = Buffer.from(state).toString('base64')

		// Validate created_by is a real UUID (dev sessions use non-UUID IDs)
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		const createdBy = entry.createdBy && uuidRegex.test(entry.createdBy) ? entry.createdBy : null

		const archivePayload: Record<string, any> = {
			id: archivedId,
			room_id: entry.roomId,
			type: entry.type,
			title: entry.title,
			persistent: true,
			yjs_state,
			access: entry.access,
			archived: true,
			locked,
			archived_at: new Date().toISOString(),
			created_by: createdBy,
		}

		let { error: insertErr } = await sb.from('collab_docs').upsert(archivePayload, { onConflict: 'id' })

		if (isMissingLockedColumnError(insertErr)) {
			console.warn('[collab-perms] cannot persist locked state — apply migration 0015_collab_docs_locked.sql')
			delete archivePayload.locked
			;({ error: insertErr } = await sb.from('collab_docs').upsert(archivePayload, { onConflict: 'id' }))
		}

		if (insertErr) {
			console.warn(`[collab-perms] archive insert error:`, insertErr.message)
			sendToUser(userId, { t: 'ypr', d: { docId, action: 'archive', ok: false, error: insertErr.message } })
			return
		}

		// Copy member entries to the archived doc ID
		const memberRows: any[] = []
		for (const [uid, r] of entry.members) {
			memberRows.push({ doc_id: archivedId, user_id: uid, role: r })
		}
		if (memberRows.length > 0) {
			await sb.from('collab_doc_members').insert(memberRows)
		}

		// Delete the original doc row and its members
		await sb.from('collab_doc_members').delete().eq('doc_id', docId)
		await sb.from('collab_docs').delete().eq('id', docId)

		// Disconnect all subscribers
		for (const subId of getSubscribers(docId)) {
			sendToUser(subId, { t: 'yd', d: { docId, reason: 'archived' } })
		}

		// Remove from memory
		removeDoc(docId)

		// Broadcast to room that the board is gone
		broadcastToRoom(entry.roomId, { t: 'dp', d: { docId, count: 0, access: 'public' } })

		sendToUser(userId, { t: 'ypr', d: { docId, action: 'archive', ok: true, data: { archivedId, locked } } })
	} catch (e: any) {
		console.warn(`[collab-perms] archive error:`, e.message)
		sendToUser(userId, { t: 'ypr', d: { docId, action: 'archive', ok: false, error: e.message } })
	}
}

/**
 * New Board: Archive current board + create a fresh one. Owner-only.
 * Payload: { docId, title, access, members }
 */
async function handleNewBoard(userId: string, authUserId: string, data: any) {
	const { docId, title, access, members } = data
	if (!docId) return

	// Archive the current board first
	await handleArchive(userId, authUserId, { docId })

	// Create the new board
	const entry = getOrCreateDoc(docId, {
		roomId: data.roomId || docId.replace('wb-', ''),
		type: 'whiteboard',
		persistent: true,
		title: title || 'Untitled',
		createdBy: authUserId,
	})

	entry.access = access || 'public'
	entry.isNew = false
	entry.members.set(authUserId, 'owner')
	if (members && Array.isArray(members)) {
		for (const m of members) {
			if (m.userId && m.role && m.userId !== authUserId) {
				entry.members.set(m.userId, m.role as DocRole)
			}
		}
	}
	entry.dirty = true

	await persistDocAndMembers(docId, entry)

	sendToUser(userId, { t: 'ypr', d: { docId, action: 'new-board', ok: true } })
}

/**
 * List History: Return archived boards for a room that the user has access to.
 * Payload: { roomId }
 */
async function handleListHistory(userId: string, authUserId: string, data: any) {
	const { roomId, type } = data
	if (!roomId) {
		sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-history', ok: false, error: 'no-room' } })
		return
	}

	try {
		const sb = getSupabase()

		// Get all archived boards in this room (optionally filtered by type)
		let query = sb
			.from('collab_docs')
			.select('id, title, type, created_by, created_at, archived_at, access')
			.eq('room_id', roomId)
			.eq('archived', true)
		if (type) query = query.eq('type', type)
		const { data: boards, error } = await query
			.order('archived_at', { ascending: false })
			.limit(50)

		if (error) {
			sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-history', ok: false, error: error.message } })
			return
		}

		// Get user's memberships for filtering private boards
		const { data: memberships } = await sb
			.from('collab_doc_members')
			.select('doc_id')
			.eq('user_id', authUserId)

		const memberDocIds = new Set((memberships || []).map(m => m.doc_id))

		// Filter: public boards + private boards where user is a member
		const accessible = (boards || []).filter(b =>
			b.access === 'public' || memberDocIds.has(b.id)
		)

		sendToUser(userId, {
			t: 'ypr',
			d: { docId: null, action: 'list-history', ok: true, data: accessible },
		})
	} catch (e: any) {
		console.warn(`[collab-perms] list-history error:`, e.message)
		sendToUser(userId, { t: 'ypr', d: { docId: null, action: 'list-history', ok: false, error: e.message } })
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Persist doc metadata + members to Supabase.
 */
async function persistDocAndMembers(docId: string, entry: any) {
	const sb = getSupabase()

	// Validate created_by is a real UUID (dev sessions use non-UUID IDs)
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	const createdBy = entry.createdBy && uuidRegex.test(entry.createdBy) ? entry.createdBy : null

	// Upsert the doc row
	const docPayload: Record<string, any> = {
		id: docId,
		room_id: entry.roomId,
		type: entry.type,
		title: entry.title,
		persistent: entry.persistent,
		access: entry.access,
		archived: entry.archived || false,
		locked: entry.locked,
		created_by: createdBy,
		updated_at: new Date().toISOString(),
	}

	let upsertResult = await sb.from('collab_docs').upsert(docPayload, { onConflict: 'id' })
	if (isMissingLockedColumnError(upsertResult.error)) {
		delete docPayload.locked
		upsertResult = await sb.from('collab_docs').upsert(docPayload, { onConflict: 'id' })
	}

	// Replace all members — filter to valid UUIDs only
	await sb.from('collab_doc_members').delete().eq('doc_id', docId)
	const rows: any[] = []
	for (const [uid, role] of entry.members) {
		if (uid && uuidRegex.test(uid)) rows.push({ doc_id: docId, user_id: uid, role })
	}
	if (rows.length > 0) {
		await sb.from('collab_doc_members').insert(rows)
	}
}

