/**
 * server/handlers/cursor.ts — Mouse/cursor position relay.
 *
 * Purely ephemeral — never written to DB.
 * Server relays cursor positions to room peers only.
 *
 * Message: { t: 'cursor', d: { x, y, docId? } }
 *   x, y: normalized screen coordinates (0-1) or document-relative coords
 *   docId: optional document identifier for collaborative editing
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getUser, broadcastToRoom } from '../state/world.ts'

/**
 * Handle a cursor position update from the client.
 */
export function handleCursor(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const { x, y, docId } = data
	if (typeof x !== 'number' || typeof y !== 'number') return

	const state = getUser(userId)
	if (!state) return

	// Relay to room peers only
	broadcastToRoom(state.roomId, {
		t: 'cursor',
		d: { userId, x, y, ...(docId ? { docId } : {}) },
	}, userId)
}
