/**
 * server/handlers/pose.ts — Avatar pose relay.
 *
 * When a client sends { t: 'pose', d: { x, z, r, s } }, the server:
 *  1. Updates the user's position in world state
 *  2. Relays to all room peers (same room only)
 *
 * Also handles room sound relay (play_sound).
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { updatePose, getUser, broadcastToRoom, sendToUser } from '../state/world.ts'

/**
 * Handle a pose update from the client.
 * Message: { t: 'pose', d: { x, z, r, s } }
 *   x: posX, z: posZ, r: rotation, s: avatarState (optional)
 */
export function handlePose(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const { x, z, r, s } = data
	if (typeof x !== 'number' || typeof z !== 'number') return

	updatePose(userId, x, z, typeof r === 'number' ? r : 0, s)

	const state = getUser(userId)
	if (!state) return

	// Relay to room peers
	broadcastToRoom(state.roomId, {
		t: 'pose',
		d: { userId, x, z, r: typeof r === 'number' ? r : 0, s },
	}, userId)
}

/**
 * Handle a greeting relay — delivers a 'greet' event to the target user.
 * Message: { t: 'greet', d: { targetUserId } }
 */
export function handleGreet(ws: ServerWebSocket<WSData>, data: any) {
	const fromUserId = ws.data.presenceUserId
	if (!fromUserId) return
	const targetUserId = data.targetUserId ? String(data.targetUserId) : null
	if (!targetUserId) return
	const fromState = getUser(fromUserId)
	const targetState = getUser(targetUserId)
	if (!fromState || !targetState) return
	const sameRoom = fromState.roomId === targetState.roomId
	sendToUser(targetUserId, { t: 'greet', d: { fromUserId, sameRoom } })
}

/**
 * Handle a room sound broadcast from the client.
 * Message: { t: 'sound', d: { filename } }
 */
export function handleSound(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const state = getUser(userId)
	if (!state) return

	broadcastToRoom(state.roomId, {
		t: 'sound',
		d: { userId, filename: data.filename },
	}, userId)
}

/**
 * Relay a fridge door toggle to room peers.
 * Message: { t: 'fridge', d: { side: 'left'|'right', action: 'open'|'close' } }
 */
export function handleFridge(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const state = getUser(userId)
	if (!state) return

	const side = data.side === 'left' || data.side === 'right' ? data.side : null
	const action = data.action === 'open' || data.action === 'close' ? data.action : null
	if (!side || !action) return

	broadcastToRoom(state.roomId, {
		t: 'fridge',
		d: { side, action },
	}, userId)
}
