/**
 * server/handlers/poll.ts — Real-time room-scoped polls.
 *
 * Messages handled:
 *   { t: 'pc', d: { question, options, roomId?, endsAt? } }  — create
 *   { t: 'pv', d: { pollId, optionIdx } }                     — vote / change vote
 *   { t: 'px', d: { pollId } }                                 — manually close (creator)
 *   { t: 'pu', d: { pollId, endsAt? } }                        — update (creator)
 *   { t: 'pd', d: { pollId } }                                 — delete (creator)
 *   { t: 'pl', d: { roomId } }                                 — list active+recent polls
 *
 * Server broadcasts:
 *   { t: 'pr',  d: { poll } }   — poll state (on every change)
 *   { t: 'prd', d: { pollId, roomId } }  — poll deleted (clients remove from cache)
 *
 * Persistence: polls + poll_votes tables. Vote is upsertable (re-voting changes choice).
 * Dev users (non-UUID auth IDs) can interact in-memory only — DB writes are skipped.
 *
 * Auto-close: a background sweep every 60 s closes polls whose endsAt has passed
 * and broadcasts the resulting state. Vote attempts on expired polls also trigger
 * an immediate close.
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getUser as getUserState, sendToUser, broadcastToRoom } from '../state/world.ts'
import { getSupabase } from '../supabase.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── In-memory poll cache ────────────────────────────────────────────────
interface PollEntry {
	id: string
	roomId: string
	question: string
	options: string[]
	createdBy: string  // authUserId
	closed: boolean
	createdAt: string
	endsAt: string | null
	votes: Map<string, number>  // userId → optionIdx
}

const polls = new Map<string, PollEntry>()
const hydratedRooms = new Set<string>()

// ── Helpers ─────────────────────────────────────────────────────────────

function snapshot(p: PollEntry) {
	const tallies = new Array(p.options.length).fill(0)
	const voteList: Array<[string, number]> = []
	for (const [uid, idx] of p.votes) {
		if (idx >= 0 && idx < tallies.length) {
			tallies[idx]++
			voteList.push([uid, idx])
		}
	}
	return {
		id: p.id,
		roomId: p.roomId,
		question: p.question,
		options: p.options,
		createdBy: p.createdBy,
		closed: p.closed,
		createdAt: p.createdAt,
		endsAt: p.endsAt,
		tallies,
		totalVotes: voteList.length,
		votes: voteList,
	}
}

function broadcastPoll(p: PollEntry) {
	broadcastToRoom(p.roomId, { t: 'pr', d: { poll: snapshot(p) } })
}

function broadcastDelete(pollId: string, roomId: string) {
	broadcastToRoom(roomId, { t: 'prd', d: { pollId, roomId } })
}

function genId() {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
	return 'pl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Validate and normalize a client-supplied endsAt string → ISO or null. */
function parseEndsAt(raw: any): string | null {
	if (!raw) return null
	const d = new Date(raw)
	if (isNaN(d.getTime())) return null
	if (d.getTime() < Date.now()) return null  // can't be in the past
	return d.toISOString()
}

/** Returns true if the poll just transitioned to closed; updates state + DB. */
async function checkExpiry(p: PollEntry): Promise<boolean> {
	if (p.closed || !p.endsAt) return false
	if (new Date(p.endsAt).getTime() > Date.now()) return false
	p.closed = true
	if (UUID_RE.test(p.createdBy)) {
		try {
			const sb = getSupabase()
			await sb.from('polls').update({ closed: true }).eq('id', p.id)
		} catch (e: any) {
			console.warn('[poll] auto-close persist failed:', e.message)
		}
	}
	return true
}

// ── Handlers ────────────────────────────────────────────────────────────

export async function handlePollCreate(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	const authUserId = ws.data.authUserId
	if (!userId || !authUserId) return

	const state = getUserState(userId)
	if (!state) return

	const roomId = data.roomId || state.roomId
	const question = (data.question || '').toString().trim().slice(0, 280)
	const options: string[] = Array.isArray(data.options)
		? data.options.map((o: any) => String(o).trim().slice(0, 80)).filter(Boolean)
		: []

	if (!roomId || !question || options.length < 2 || options.length > 10) return

	const id = genId()
	const createdAt = new Date().toISOString()
	const endsAt = parseEndsAt(data.endsAt)

	const entry: PollEntry = {
		id, roomId, question, options,
		createdBy: authUserId,
		closed: false,
		createdAt,
		endsAt,
		votes: new Map(),
	}
	polls.set(id, entry)

	if (UUID_RE.test(authUserId)) {
		try {
			const sb = getSupabase()
			await sb.from('polls').insert({
				id, room_id: roomId, question, options,
				created_by: authUserId, closed: false, created_at: createdAt,
				ends_at: endsAt,
			})
		} catch (e: any) {
			console.warn('[poll] insert failed:', e.message)
		}
	}

	broadcastPoll(entry)
}

export async function handlePollVote(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	const authUserId = ws.data.authUserId
	if (!userId || !authUserId) return

	const { pollId, optionIdx } = data
	if (!pollId || typeof optionIdx !== 'number') return

	const entry = polls.get(pollId)
	if (!entry) return

	// If poll just expired, close it and broadcast — drop the vote.
	if (await checkExpiry(entry)) { broadcastPoll(entry); return }
	if (entry.closed) return
	if (optionIdx < 0 || optionIdx >= entry.options.length) return

	entry.votes.set(authUserId, optionIdx)

	if (UUID_RE.test(authUserId)) {
		try {
			const sb = getSupabase()
			await sb.from('poll_votes').delete().match({ poll_id: pollId, user_id: authUserId })
			await sb.from('poll_votes').insert({
				poll_id: pollId, user_id: authUserId, option_idx: optionIdx,
			})
		} catch (e: any) {
			console.warn('[poll] vote persist failed:', e.message)
		}
	}

	broadcastPoll(entry)
}

export async function handlePollClose(ws: ServerWebSocket<WSData>, data: any) {
	const authUserId = ws.data.authUserId
	if (!authUserId) return

	const { pollId } = data
	if (!pollId) return

	const entry = polls.get(pollId)
	if (!entry) return
	if (entry.createdBy !== authUserId) return

	entry.closed = true

	if (UUID_RE.test(authUserId)) {
		try {
			const sb = getSupabase()
			await sb.from('polls').update({ closed: true }).eq('id', pollId)
		} catch (e: any) {
			console.warn('[poll] close persist failed:', e.message)
		}
	}

	broadcastPoll(entry)
}

/** Update poll metadata (currently just endsAt). Creator-only. */
export async function handlePollUpdate(ws: ServerWebSocket<WSData>, data: any) {
	const authUserId = ws.data.authUserId
	if (!authUserId) return

	const { pollId } = data
	if (!pollId) return

	const entry = polls.get(pollId)
	if (!entry) return
	if (entry.createdBy !== authUserId) return

	const update: Record<string, any> = {}
	if ('endsAt' in data) {
		const next = parseEndsAt(data.endsAt)
		// Allow explicitly clearing by passing null
		entry.endsAt = data.endsAt === null ? null : (next ?? entry.endsAt)
		update.ends_at = entry.endsAt
	}

	if (Object.keys(update).length > 0 && UUID_RE.test(authUserId)) {
		try {
			const sb = getSupabase()
			await sb.from('polls').update(update).eq('id', pollId)
		} catch (e: any) {
			console.warn('[poll] update persist failed:', e.message)
		}
	}

	// In case the new endsAt is already in the past, immediately close.
	await checkExpiry(entry)
	broadcastPoll(entry)
}

/** Delete a poll. Creator-only. */
export async function handlePollDelete(ws: ServerWebSocket<WSData>, data: any) {
	const authUserId = ws.data.authUserId
	if (!authUserId) return

	const { pollId } = data
	if (!pollId) return

	const entry = polls.get(pollId)
	if (!entry) return
	if (entry.createdBy !== authUserId) return

	const roomId = entry.roomId
	polls.delete(pollId)

	if (UUID_RE.test(authUserId)) {
		try {
			const sb = getSupabase()
			// poll_votes has ON DELETE CASCADE on poll_id, so deleting the poll cleans both.
			await sb.from('polls').delete().eq('id', pollId)
		} catch (e: any) {
			console.warn('[poll] delete persist failed:', e.message)
		}
	}

	broadcastDelete(pollId, roomId)
}

export async function handlePollList(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const state = getUserState(userId)
	const roomId = data.roomId || state?.roomId
	if (!roomId) return

	await hydrateRoomPolls(roomId)

	const list = []
	for (const entry of polls.values()) {
		if (entry.roomId !== roomId) continue
		// Run expiry check at list time so anyone opening the poll panel sees
		// up-to-date state without waiting for the next sweep tick.
		if (await checkExpiry(entry)) broadcastPoll(entry)
		list.push(snapshot(entry))
	}
	sendToUser(userId, { t: 'pl', d: { roomId, polls: list } })
}

// ── DB hydration ────────────────────────────────────────────────────────

async function hydrateRoomPolls(roomId: string): Promise<void> {
	if (hydratedRooms.has(roomId)) return
	hydratedRooms.add(roomId)

	try {
		const sb = getSupabase()
		const { data: rows, error } = await sb
			.from('polls')
			.select('id, room_id, question, options, created_by, closed, created_at, ends_at')
			.eq('room_id', roomId)
			.order('created_at', { ascending: false })
			.limit(20)

		if (error || !rows) {
			if (error) console.warn('[poll] hydrate polls error:', error.message)
			return
		}

		for (const row of rows) {
			if (polls.has(row.id)) continue
			polls.set(row.id, {
				id: row.id,
				roomId: row.room_id,
				question: row.question,
				options: Array.isArray(row.options) ? row.options : [],
				createdBy: row.created_by || '',
				closed: !!row.closed,
				createdAt: row.created_at,
				endsAt: row.ends_at,
				votes: new Map(),
			})
		}

		const pollIds = rows.map(r => r.id)
		if (pollIds.length === 0) return
		const { data: votes } = await sb
			.from('poll_votes')
			.select('poll_id, user_id, option_idx')
			.in('poll_id', pollIds)
		for (const v of votes || []) {
			const entry = polls.get(v.poll_id)
			if (entry) entry.votes.set(v.user_id, v.option_idx)
		}
	} catch (e: any) {
		console.warn('[poll] hydrate exception:', e.message)
	}
}

// ── Background expiry sweep ─────────────────────────────────────────────
// Runs every 60 s; closes any open polls whose endsAt has passed and broadcasts
// their new state to the room.
const SWEEP_INTERVAL_MS = 60_000
setInterval(async () => {
	for (const entry of polls.values()) {
		if (await checkExpiry(entry)) broadcastPoll(entry)
	}
}, SWEEP_INTERVAL_MS)
