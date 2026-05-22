/**
 * server/handlers/reaction.ts — Ephemeral emoji reactions broadcast to room peers.
 *
 * Reactions are NEVER persisted. Server simply relays { emoji } from sender
 * to everyone else in the same room, with a per-user rate limit to prevent
 * spam.
 *
 * Message: { t: 'rx', d: { emoji } }
 * Broadcast: { t: 'rx', d: { fromUserId, emoji, ts } }
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getUser as getUserState, broadcastToRoom } from '../state/world.ts'

const MIN_INTERVAL_MS = 500
const lastEmit = new Map<string, number>()  // presenceUserId → ts

// Allowed emoji set — short whitelist keeps payload small and prevents abuse.
const ALLOWED = new Set([
	'👍', '❤️', '🎉', '😂', '👏', '💡', '🔥', '✨', '🤔', '👀',
	'😮', '😢', '🙏', '✅', '❌', '🚀', '☕', '🎂', '🎵', '👋',
])

export function handleReaction(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const emoji = (data?.emoji || '').toString()
	if (!emoji || !ALLOWED.has(emoji)) return

	// Per-user rate limit
	const now = Date.now()
	const last = lastEmit.get(userId) || 0
	if (now - last < MIN_INTERVAL_MS) return
	lastEmit.set(userId, now)

	const state = getUserState(userId)
	if (!state?.roomId) return

	broadcastToRoom(state.roomId, {
		t: 'rx',
		d: { fromUserId: userId, emoji, ts: now },
	})
}
