/**
 * server/state/world.ts — In-memory world state: users, rooms, cursors, typing.
 *
 * This is the single source of truth for all ephemeral real-time state.
 * Supabase is the durable store — this is flushed every 30s.
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'

// ── User state ──────────────────────────────────────────────────────────
export interface UserProfile {
	displayName: string
	email: string
	avaEmail: string
	slackId: string
	jobTitle: string
	avatarColor: string
	avatarUrl: string
	status: string
	slackStatus: string
	preferences: string  // JSON string
}

export interface UserState {
	ws: ServerWebSocket<WSData>
	authUserId: string
	clientSessionId?: string     // sessionStorage tab ID — used to detect same-tab reconnects
	presenceRowId: string | null  // Supabase users table UUID
	profile: UserProfile
	roomId: string
	seatId: string | null  // e.g. 'office-0:desk' — full room:seat qualifier
	posX: number
	posZ: number
	rotation: number
	avatarState: any  // { holding, gesture, dogCmd, soundMuted, ... }
	lastActivity: number  // Date.now()
	connectedAt: number
	dirty: boolean  // needs flushing to Supabase
}

// ── State maps ──────────────────────────────────────────────────────────
// Keyed by a server-assigned compact user identifier (presenceRowId or authUserId)
const users = new Map<string, UserState>()
// roomId → Set<userId> (for scoped broadcasting)
const roomMembers = new Map<string, Set<string>>()

// ── Helpers ─────────────────────────────────────────────────────────────

/** Get a user's canonical ID (presenceRowId preferred, authUserId fallback). */
export function getUserId(state: UserState): string {
	return state.presenceRowId || state.authUserId
}

export function getUser(userId: string): UserState | undefined {
	return users.get(userId)
}

export function getAllUsers(): Map<string, UserState> {
	return users
}

export function getRoomMembers(roomId: string): Set<string> {
	return roomMembers.get(roomId) || new Set()
}

// ── User lifecycle ──────────────────────────────────────────────────────

export function addUser(userId: string, state: UserState): void {
	users.set(userId, state)
	const roomId = state.roomId
	if (roomId) {
		if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set())
		roomMembers.get(roomId)!.add(userId)
	}
}

export function removeUser(userId: string): UserState | undefined {
	const state = users.get(userId)
	if (!state) return undefined
	users.delete(userId)
	if (state.roomId) {
		const members = roomMembers.get(state.roomId)
		if (members) {
			members.delete(userId)
			if (members.size === 0) roomMembers.delete(state.roomId)
		}
	}
	return state
}

/**
 * Move a user to a new room. Updates roomMembers maps.
 */
export function moveUserToRoom(userId: string, newRoomId: string): string | null {
	const state = users.get(userId)
	if (!state) return null
	const oldRoomId = state.roomId

	// Remove from old room
	if (oldRoomId) {
		const members = roomMembers.get(oldRoomId)
		if (members) {
			members.delete(userId)
			if (members.size === 0) roomMembers.delete(oldRoomId)
		}
	}

	// Add to new room
	state.roomId = newRoomId
	state.dirty = true
	if (newRoomId) {
		if (!roomMembers.has(newRoomId)) roomMembers.set(newRoomId, new Set())
		roomMembers.get(newRoomId)!.add(userId)
	}

	return oldRoomId
}

/**
 * Update a user's pose (position, rotation, avatar state).
 */
export function updatePose(userId: string, x: number, z: number, rotation: number, avatarState?: any): boolean {
	const state = users.get(userId)
	if (!state) return false
	state.posX = x
	state.posZ = z
	state.rotation = rotation
	if (avatarState !== undefined) state.avatarState = avatarState
	state.lastActivity = Date.now()
	state.dirty = true
	return true
}

/**
 * Update a user's profile fields (status, avatar, display name, etc.).
 */
export function updateProfile(userId: string, profile: Partial<UserProfile>): boolean {
	const state = users.get(userId)
	if (!state) return false
	Object.assign(state.profile, profile)
	state.lastActivity = Date.now()
	state.dirty = true
	return true
}

/**
 * Build a serializable snapshot of a single user for wire transmission.
 */
export function serializeUser(userId: string, state: UserState) {
	return {
		id: userId,
		authUserId: state.authUserId,
		name: state.profile.displayName,
		email: state.profile.email,
		avaEmail: state.profile.avaEmail,
		slackId: state.profile.slackId,
		title: state.profile.jobTitle,
		roomId: state.seatId || state.roomId,  // send full seatId so peers know sitting state
		color: state.profile.avatarColor,
		avatarUrl: state.profile.avatarUrl,
		status: state.profile.status || 'online',
		slackStatus: state.profile.slackStatus,
		posX: state.posX,
		posZ: state.posZ,
		rotation: state.rotation,
		avatarState: state.avatarState,
		lastSeen: new Date(state.lastActivity).toISOString(),
	}
}

/**
 * Build a full world snapshot for a newly connecting client.
 */
export function buildWorldSnapshot() {
	const result: any[] = []
	for (const [userId, state] of users) {
		result.push(serializeUser(userId, state))
	}
	return result
}

/**
 * Find an existing user by authUserId (for duplicate session detection).
 */
export function findByAuthUserId(authUserId: string): [string, UserState] | null {
	for (const [userId, state] of users) {
		if (state.authUserId === authUserId) return [userId, state]
	}
	return null
}

/**
 * Get all dirty users for flushing, then clear dirty flags.
 */
export function getDirtyUsers(): Map<string, UserState> {
	const dirty = new Map<string, UserState>()
	for (const [userId, state] of users) {
		if (state.dirty && state.presenceRowId) {
			dirty.set(userId, state)
			state.dirty = false
		}
	}
	return dirty
}

/**
 * Broadcast a JSON message to every connected client except the sender.
 */
export function broadcastGlobal(msg: any, excludeUserId?: string): void {
	const json = JSON.stringify(msg)
	for (const [memberId, state] of users) {
		if (memberId === excludeUserId) continue
		if (state?.ws?.readyState === 1) {
			state.ws.send(json)
		}
	}
}

/**
 * Broadcast a JSON message to all members of a room except the sender.
 */
export function broadcastToRoom(roomId: string, msg: any, excludeUserId?: string): void {
	const members = roomMembers.get(roomId)
	if (!members) return
	const json = JSON.stringify(msg)
	for (const memberId of members) {
		if (memberId === excludeUserId) continue
		const state = users.get(memberId)
		if (state?.ws?.readyState === 1) {
			state.ws.send(json)
		}
	}
}

/**
 * Send a JSON message to a specific user.
 */
export function sendToUser(userId: string, msg: any): void {
	const state = users.get(userId)
	if (state?.ws?.readyState === 1) {
		state.ws.send(JSON.stringify(msg))
	}
}
