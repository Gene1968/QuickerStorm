/**
 * server/handlers/presence.ts — User presence: join, leave, world snapshot, profile updates.
 *
 * When a client sends { t: 'join', d: { roomId, profile, ... } }, the server:
 *  1. Registers them in the world state
 *  2. Sends a full world snapshot back
 *  3. Broadcasts their arrival to room peers
 *
 * Session displacement: if the same authUserId connects twice, the older
 * socket is closed with code 4001.
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'
import { CLOSE } from '../../shared/protocol.js'
import {
	addUser, removeUser, moveUserToRoom, updateProfile,
	findByAuthUserId, buildWorldSnapshot, serializeUser,
	getUser, broadcastToRoom, broadcastGlobal, getUserId, type UserState, type UserProfile,
} from '../state/world.ts'
import { flushUser } from '../state/flush.ts'

/**
 * Handle a presence join message from the client.
 * This is separate from the signaling 'join' — this carries profile data
 * and establishes the user in the world state.
 *
 * Message: { t: 'join', d: { roomId, presenceRowId, profile: {...}, posX, posZ, rotation, avatarState } }
 */
export function handlePresenceJoin(ws: ServerWebSocket<WSData>, data: any) {
	const { roomId, seatId, authUserId: clientAuthUserId, presenceRowId, profile, posX, posZ, rotation, avatarState, sessionId: clientSessionId } = data
	const authUserId = clientAuthUserId || ws.data.authUserId || ''

	if (!authUserId) {
		console.warn('[presence] join without authUserId — ignoring')
		return
	}

	// Persist authUserId on the socket for future messages
	ws.data.authUserId = authUserId

	// Multi-tab handling: if another connection already exists for this auth user,
	// reject the NEW tab (don't displace the existing one). The new tab gets a
	// 'displaced' message and shows the "Make this active" modal. Only when the
	// user explicitly reclaims (sends a 'reclaim' message) do we swap.
	//
	// Exception: if the new join carries the same sessionId as the existing entry,
	// it's the same browser tab reconnecting after suspension (Chrome aggressively
	// kills background WS connections). Auto-replace the stale socket rather than
	// falsely showing "Signed in on another device".
	const existing = findByAuthUserId(authUserId)
	if (existing) {
		const [, oldState] = existing
		if (oldState.ws !== ws) {
			// Dev auth IDs (dev-*) are synthetic per-browser identifiers — two connections
			// with the same dev authUserId are always the same browser tab reconnecting
			// (different browsers always get different ava_dev_uid → different authUserId).
			// Always silently replace for dev sessions; never displace.
			const isDevSession = authUserId.startsWith('dev-')
			if (isDevSession || (clientSessionId && clientSessionId === oldState.clientSessionId)) {
				// Same tab reconnecting after reload/suspension — silently replace the dead socket
				oldState.ws.close(1000, 'replaced by same session')
				handlePresenceLeave(oldState.ws)
				console.log(`[presence] same-session reconnect for ${authUserId} — replacing stale socket`)
				// Fall through to register the new connection
			} else {
				// Genuinely different device/tab — displace the new one
				sendJson(ws, { t: 'displaced', d: {} })
				ws.data.presenceUserId = undefined
				console.log(`[presence] rejected duplicate session for ${authUserId} — existing session kept`)
				return
			}
		}
	}

	const userId = presenceRowId || authUserId

	const userProfile: UserProfile = {
		displayName: profile?.displayName || '',
		email: profile?.email || '',
		avaEmail: profile?.avaEmail || '',
		slackId: profile?.slackId || '',
		jobTitle: profile?.jobTitle || '',
		avatarColor: profile?.avatarColor || '#4d6080',
		avatarUrl: profile?.avatarUrl || '',
		status: profile?.status || 'online',
		slackStatus: profile?.slackStatus || '',
		preferences: profile?.preferences || '{}',
	}

	const state: UserState = {
		ws,
		authUserId,
		clientSessionId: clientSessionId || undefined,
		presenceRowId: presenceRowId || null,
		profile: userProfile,
		roomId: roomId || 'lobby',
		seatId: seatId || null,
		posX: typeof posX === 'number' ? posX : 0,
		posZ: typeof posZ === 'number' ? posZ : 0,
		rotation: typeof rotation === 'number' ? rotation : 0,
		avatarState: avatarState || {},
		lastActivity: Date.now(),
		connectedAt: Date.now(),
		dirty: true,
	}

	// Store the userId on the WSData for later lookup
	ws.data.presenceUserId = userId

	addUser(userId, state)

	// Send full world snapshot to the new client
	const world = buildWorldSnapshot()
	sendJson(ws, { t: 'world', d: { users: world } })

	// WHY: broadcast globally so users in other rooms also see this user appear
	// in their sidebar. Previously this was room-scoped, which meant clients
	// already connected (e.g. a dev tab) never received `enter` for staging
	// users who joined later in a different room, leaving them invisible until
	// the next page reload. Same-room peers still get an avatar render trigger.
	broadcastGlobal({
		t: 'enter',
		d: serializeUser(userId, state),
	}, userId)

	console.log(`[presence] ${userProfile.displayName || userId} joined room ${state.roomId}`)
}

/**
 * Handle a room change via the presence system.
 * Message: { t: 'room', d: { roomId } }
 */
export function handleRoomChange(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const { roomId, seatId } = data
	if (!roomId) return

	const state = getUser(userId)
	if (!state) return

	// Update seatId (sitting state) even if room doesn't change
	state.seatId = seatId || null
	state.dirty = true

	const oldRoomId = moveUserToRoom(userId, roomId)
	if (oldRoomId === roomId) {
		// Same room but seat changed — broadcast updated state to all peers
		broadcastGlobal({
			t: 'enter',
			d: serializeUser(userId, state),
		}, userId)
		return
	}

	// Notify old room peers of departure
	if (oldRoomId) {
		broadcastToRoom(oldRoomId, {
			t: 'leave',
			d: { userId, roomId: oldRoomId },
		})
	}

	// Notify ALL peers of new location so clients in unrelated rooms also update.
	broadcastGlobal({
		t: 'enter',
		d: serializeUser(userId, state),
	}, userId)
}

/**
 * Handle a profile update from the client.
 * Message: { t: 'profile', d: { displayName?, status?, avatarColor?, ... } }
 */
export function handleProfileUpdate(ws: ServerWebSocket<WSData>, data: any) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	updateProfile(userId, data)

	const state = getUser(userId)
	if (!state) return

	// Broadcast profile change to all connected clients — status changes (e.g. away)
	// must reach users in other rooms who see this user in the sidebar.
	broadcastGlobal({
		t: 'profile',
		d: { userId, ...data },
	}, userId)
}

/**
 * Handle presence leave — called on WebSocket close.
 */
export function handlePresenceLeave(ws: ServerWebSocket<WSData>) {
	const userId = ws.data.presenceUserId
	if (!userId) return

	const state = removeUser(userId)
	if (!state) return

	// Write final state to Supabase
	flushUser(state)

	// WHY: broadcast globally so users in other rooms also flip this user to
	// offline in their sidebar. Previously this was room-scoped, which meant
	// peers in other rooms saw the user stuck "online" until they reloaded.
	// Same-room peers still get the avatar-removal signal.
	if (state.roomId) {
		broadcastGlobal({
			t: 'leave',
			d: { userId, roomId: state.roomId },
		})
	}

	ws.data.presenceUserId = undefined
	console.log(`[presence] ${state.profile.displayName || userId} disconnected`)
}

/**
 * Handle a session reclaim — the displaced tab wants to become active.
 * Closes the existing session and re-runs the join for the reclaiming tab.
 *
 * Message: { t: 'reclaim', d: { ...same as join... } }
 */
export function handleReclaim(ws: ServerWebSocket<WSData>, data: any) {
	const authUserId = data.authUserId || ws.data.authUserId
	if (!authUserId) return

	// Find and displace the currently active session
	const existing = findByAuthUserId(authUserId)
	if (existing) {
		const [, oldState] = existing
		if (oldState.ws !== ws) {
			oldState.ws.close(CLOSE.SUPERSEDED, 'superseded')
			handlePresenceLeave(oldState.ws)
		}
	}

	// Now join as the active session
	handlePresenceJoin(ws, data)
}

function sendJson(ws: ServerWebSocket<WSData>, msg: any) {
	if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}
