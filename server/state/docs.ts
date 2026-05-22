/**
 * server/state/docs.ts — In-memory Yjs document store for collaboration.
 *
 * Holds active Y.Doc instances keyed by docId. Each doc tracks:
 * - The Yjs document state (CRDT)
 * - Which users are subscribed (for targeted relay)
 * - Whether it's dirty (needs flushing to Supabase)
 * - Whether it's persistent (saved to DB) or ephemeral (dropped on empty)
 * - Access control: public/private, member roles (owner/editor/viewer)
 */

import * as Y from 'yjs'
import { getSupabase } from '../supabase.ts'

export type DocRole = 'owner' | 'editor' | 'viewer'

export interface DocEntry {
	doc: Y.Doc
	roomId: string
	subscribers: Set<string>  // presenceUserId set — who has this doc open
	dirty: boolean
	persistent: boolean
	docId: string
	type: 'whiteboard' | 'doc' | 'taskboard'
	title: string
	createdBy: string | null
	loadedFromDb: boolean
	// Permission fields
	access: 'public' | 'private'
	archived: boolean
	locked: boolean   // when archived: true = read-only for everyone, false = members can still edit
	members: Map<string, DocRole>  // authUserId → role
	permissionsLoaded: boolean
	isNew: boolean  // true if no DB row exists (brand new board)
}

// ── State ──────────────────────────────────────────────────────────────
const docs = new Map<string, DocEntry>()

/**
 * Each operation tries with the `locked` column first. If Postgres reports
 * the column doesn't exist (migration 0015 not yet applied), the caller
 * should retry without it. We deliberately do NOT cache this — caching
 * would prevent recovery after the migration is applied without a server
 * restart, and the per-op cost of a single retry is negligible.
 */
export function isMissingLockedColumnError(err: any): boolean {
	return !!(err && /column.*locked/i.test(err.message || ''))
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get or create a doc entry. If the doc doesn't exist in memory,
 * it will be created empty. Call loadFromDb() separately to hydrate from Supabase.
 */
export function getOrCreateDoc(docId: string, opts: {
	roomId: string
	type?: 'whiteboard' | 'doc' | 'taskboard'
	persistent?: boolean
	title?: string
	createdBy?: string | null
}): DocEntry {
	let entry = docs.get(docId)
	if (entry) return entry

	entry = {
		doc: new Y.Doc(),
		roomId: opts.roomId,
		subscribers: new Set(),
		dirty: false,
		persistent: opts.persistent ?? true,
		docId,
		type: opts.type || 'whiteboard',
		title: opts.title || 'Untitled',
		createdBy: opts.createdBy || null,
		loadedFromDb: false,
		access: 'public',
		archived: false,
		locked: true,
		members: new Map(),
		permissionsLoaded: false,
		isNew: false,
	}
	docs.set(docId, entry)
	return entry
}

export function getDoc(docId: string): DocEntry | undefined {
	return docs.get(docId)
}

export function removeDoc(docId: string): void {
	const entry = docs.get(docId)
	if (entry) {
		entry.doc.destroy()
		docs.delete(docId)
	}
}

/**
 * Subscribe a user to a doc (they'll receive updates).
 */
export function subscribe(docId: string, userId: string): void {
	const entry = docs.get(docId)
	if (entry) entry.subscribers.add(userId)
}

/**
 * Unsubscribe a user from a doc. If no subscribers remain and doc is ephemeral, remove it.
 */
export function unsubscribe(docId: string, userId: string): void {
	const entry = docs.get(docId)
	if (!entry) return
	entry.subscribers.delete(userId)

	// Ephemeral docs are cleaned up when the last subscriber leaves
	if (entry.subscribers.size === 0 && !entry.persistent) {
		entry.doc.destroy()
		docs.delete(docId)
		console.log(`[docs] ephemeral doc ${docId} removed (no subscribers)`)
	}
}

/**
 * Unsubscribe a user from ALL docs they're in (called on disconnect).
 * Returns array of { docId, roomId } for docs that were affected (for broadcasting).
 */
export function unsubscribeAll(userId: string): Array<{ docId: string, roomId: string }> {
	const affected: Array<{ docId: string, roomId: string }> = []
	for (const [docId, entry] of docs) {
		if (entry.subscribers.has(userId)) {
			const roomId = entry.roomId
			unsubscribe(docId, userId)
			affected.push({ docId, roomId })
		}
	}
	return affected
}

/**
 * Apply a Yjs update (from a client) to the server-held doc.
 */
export function applyUpdate(docId: string, update: Uint8Array): boolean {
	const entry = docs.get(docId)
	if (!entry) return false
	Y.applyUpdate(entry.doc, update)
	entry.dirty = true
	return true
}

/**
 * Get the full encoded state of a doc (for sync step 1 response).
 */
export function getEncodedState(docId: string): Uint8Array | null {
	const entry = docs.get(docId)
	if (!entry) return null
	return Y.encodeStateAsUpdate(entry.doc)
}

/**
 * Get the state vector of a doc (for sync step 1 request).
 */
export function getStateVector(docId: string): Uint8Array | null {
	const entry = docs.get(docId)
	if (!entry) return null
	return Y.encodeStateVector(entry.doc)
}

/**
 * Load a doc's state and permissions from Supabase. No-op if already loaded.
 */
export async function loadFromDb(docId: string): Promise<boolean> {
	const entry = docs.get(docId)
	if (!entry || entry.loadedFromDb) return false

	try {
		const sb = getSupabase()
		const baseCols = 'yjs_state, persistent, title, type, access, archived, created_by'
		let data: any, error: any
		;({ data, error } = await sb
			.from('collab_docs')
			.select(`${baseCols}, locked`)
			.eq('id', docId)
			.single())

		// If the `locked` column doesn't exist yet (migration 0015 not applied),
		// retry without it. The doc will behave as if `locked = true` until the
		// migration is run.
		if (isMissingLockedColumnError(error)) {
			console.warn('[docs] `locked` column missing — apply migration 0015_collab_docs_locked.sql.')
			;({ data, error } = await sb
				.from('collab_docs')
				.select(baseCols)
				.eq('id', docId)
				.single())
		}

		if (error && error.code !== 'PGRST116') {
			// PGRST116 = no rows — doc is new
			console.warn(`[docs] loadFromDb error for ${docId}:`, error.message)
			return false
		}

		if (!data) {
			// No DB row — this is a brand new board
			entry.isNew = true
			entry.loadedFromDb = true
			entry.permissionsLoaded = true
			return true
		}

		if (data.yjs_state) {
			const buf = Buffer.from(data.yjs_state, 'base64')
			Y.applyUpdate(entry.doc, new Uint8Array(buf))
		}
		entry.persistent = data.persistent ?? true
		entry.title = data.title || entry.title
		entry.type = data.type || entry.type
		entry.access = data.access || 'public'
		entry.archived = data.archived || false
		entry.locked = data.locked ?? true
		entry.createdBy = data.created_by || entry.createdBy

		// Load members
		await loadMembers(docId)

		// If no owner exists in members, setup was never completed — treat as new
		let hasOwner = false
		for (const [, r] of entry.members) {
			if (r === 'owner') { hasOwner = true; break }
		}
		entry.isNew = !hasOwner

		entry.loadedFromDb = true
		entry.dirty = false
		return true
	} catch (e: any) {
		console.warn(`[docs] loadFromDb exception for ${docId}:`, e.message)
		return false
	}
}

/**
 * Load member roles from collab_doc_members into the entry's members Map.
 */
export async function loadMembers(docId: string): Promise<void> {
	const entry = docs.get(docId)
	if (!entry) return

	try {
		const sb = getSupabase()
		const { data, error } = await sb
			.from('collab_doc_members')
			.select('user_id, role')
			.eq('doc_id', docId)

		if (error) {
			console.warn(`[docs] loadMembers error for ${docId}:`, error.message)
			return
		}

		entry.members.clear()
		for (const row of data || []) {
			entry.members.set(row.user_id, row.role as DocRole)
		}
		entry.permissionsLoaded = true
	} catch (e: any) {
		console.warn(`[docs] loadMembers exception for ${docId}:`, e.message)
	}
}

/**
 * Check if a user has the required access level.
 * Returns the user's effective role, or null if no access.
 */
export function checkAccess(docId: string, authUserId: string): DocRole | null {
	const entry = docs.get(docId)
	if (!entry) return null

	// Public boards: everyone is effectively an editor
	if (entry.access === 'public') {
		// But if they have an explicit role, use that (owner gets owner privileges)
		return entry.members.get(authUserId) || 'editor'
	}

	// Private boards: must have an explicit member entry
	return entry.members.get(authUserId) || null
}

/**
 * Get the owner's authUserId for a doc.
 */
export function getOwner(docId: string): string | null {
	const entry = docs.get(docId)
	if (!entry) return null
	for (const [userId, role] of entry.members) {
		if (role === 'owner') return userId
	}
	return entry.createdBy
}

/**
 * Flush all dirty persistent docs to Supabase.
 * Called on the same 30s cycle as user flush.
 */
export async function flushDirtyDocs(): Promise<void> {
	const sb = getSupabase()
	let written = 0
	let failed = 0

	for (const [docId, entry] of docs) {
		if (!entry.dirty || !entry.persistent || entry.isNew) continue

		try {
			const state = Y.encodeStateAsUpdate(entry.doc)
			const base64 = Buffer.from(state).toString('base64')

			// Validate created_by is a real UUID
			const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			const createdBy = entry.createdBy && uuidRe.test(entry.createdBy) ? entry.createdBy : null

			const payload: Record<string, any> = {
				id: docId,
				room_id: entry.roomId,
				type: entry.type,
				title: entry.title,
				persistent: entry.persistent,
				yjs_state: base64,
				access: entry.access,
				archived: entry.archived,
				locked: entry.locked,
				updated_at: new Date().toISOString(),
				created_by: createdBy,
			}

			let { error } = await sb.from('collab_docs').upsert(payload, { onConflict: 'id' })

			if (isMissingLockedColumnError(error)) {
				delete payload.locked
				;({ error } = await sb.from('collab_docs').upsert(payload, { onConflict: 'id' }))
			}

			if (error) {
				console.warn(`[docs] flush failed for ${docId}:`, error.message)
				failed++
			} else {
				entry.dirty = false
				written++
			}
		} catch (e: any) {
			console.warn(`[docs] flush exception for ${docId}:`, e.message)
			failed++
		}
	}

	if (written > 0 || failed > 0) {
		console.log(`[docs] flushed ${written} docs, ${failed} failed`)
	}
}

/**
 * Get subscriber list for a doc (for broadcasting updates).
 */
export function getSubscribers(docId: string): Set<string> {
	return docs.get(docId)?.subscribers || new Set()
}
