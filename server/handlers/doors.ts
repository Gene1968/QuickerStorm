/**
 * server/handlers/doors.ts — Door state relay via WS.
 *
 * Door RPCs (set_door_state, auto_unlock_room) require auth.uid() so they
 * must be called from the CLIENT with the user's Supabase session. The server
 * just relays the result to all connected clients (replacing Supabase Realtime).
 *
 * Messages:
 *   { t: 'door', d: { doorId, isOpen, isLocked } }  — single door changed
 *   { t: 'door_refresh', d: { roomId } }             — room auto-unlocked, refetch
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { getAllUsers } from '../state/world.ts'

/**
 * Handle a door state broadcast from the client.
 * The client has already written to Supabase — we just relay to peers.
 */
export function handleDoor(ws: ServerWebSocket<WSData>, data: any) {
	const { doorId, isOpen, isLocked, roomId, action } = data

	if (action === 'auto_unlock' && roomId) {
		// Broadcast refresh to all clients
		broadcastToAll({ t: 'door_refresh', d: { roomId } }, ws)
	} else if (doorId !== undefined) {
		// Broadcast single door change to all clients
		broadcastToAll({ t: 'door', d: { doorId, isOpen, isLocked } }, ws)
	}
}

function broadcastToAll(msg: any, excludeWs?: any) {
	const json = JSON.stringify(msg)
	for (const [, state] of getAllUsers()) {
		if (state.ws !== excludeWs && state.ws.readyState === 1) {
			state.ws.send(json)
		}
	}
}
