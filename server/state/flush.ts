/**
 * server/state/flush.ts — Periodic batch write of user state to Supabase.
 *
 * Every 30 seconds, all dirty user records are written to the `users` table.
 * This replaces the per-client 12s heartbeat, reducing DB writes from
 * N_users * 5/min to 2/min regardless of user count.
 */

import { getSupabase } from '../supabase.ts'
import { getDirtyUsers, getAllUsers, type UserState } from './world.ts'
import { flushDirtyDocs } from './docs.ts'

const FLUSH_INTERVAL = 30_000  // 30 seconds
let flushTimer: ReturnType<typeof setInterval> | null = null

/**
 * Convert a UserState to a Supabase users table row for UPDATE.
 */
function toDbRow(state: UserState) {
	return {
		room_id: state.seatId || state.roomId,
		pos_x: state.posX,
		pos_z: state.posZ,
		rotation: state.rotation,
		status: state.profile.status || 'online',
		last_seen: new Date(state.lastActivity).toISOString(),
		avatar_state: state.avatarState ?? {},
		title: state.profile.displayName,
		avatar_color: state.profile.avatarColor,
		avatar_url: state.profile.avatarUrl || '',
		slack_status: state.profile.slackStatus || '',
		job_title: state.profile.jobTitle || '',
	}
}

/**
 * Flush all dirty user states to Supabase in individual UPDATE calls.
 * Uses service-role key so RLS is bypassed.
 */
async function flushDirtyUsers() {
	const dirty = getDirtyUsers()
	if (dirty.size === 0) return

	const sb = getSupabase()
	let written = 0
	let failed = 0

	for (const [_userId, state] of dirty) {
		if (!state.presenceRowId) continue
		try {
			const row = toDbRow(state)
			const { error } = await sb
				.from('users')
				.update(row)
				.eq('id', state.presenceRowId)
			if (error) {
				console.warn(`[flush] update failed for ${state.presenceRowId}:`, error.message)
				failed++
			} else {
				written++
			}
		} catch (e: any) {
			console.warn(`[flush] exception for ${state.presenceRowId}:`, e.message)
			failed++
		}
	}

	if (written > 0 || failed > 0) {
		console.log(`[flush] wrote ${written} users, ${failed} failed`)
	}
}

/**
 * Write a final heartbeat for a disconnecting user.
 * Called immediately on disconnect so the last position is persisted.
 */
export async function flushUser(state: UserState) {
	if (!state.presenceRowId) return
	try {
		const sb = getSupabase()
		const row = toDbRow(state)
		await sb.from('users').update(row).eq('id', state.presenceRowId)
	} catch (e: any) {
		console.warn(`[flush] disconnect write failed for ${state.presenceRowId}:`, e.message)
	}
}

/**
 * Start the periodic flush cycle.
 */
export function startFlush() {
	if (flushTimer) return
	flushTimer = setInterval(() => {
		flushDirtyUsers().catch(e => console.warn('[flush] cycle error:', e.message))
		flushDirtyDocs().catch(e => console.warn('[flush] docs cycle error:', e.message))
	}, FLUSH_INTERVAL)
	console.log(`[flush] started — writing to Supabase every ${FLUSH_INTERVAL / 1000}s`)
}

/**
 * Stop the flush cycle.
 */
export function stopFlush() {
	if (flushTimer) {
		clearInterval(flushTimer)
		flushTimer = null
	}
}
