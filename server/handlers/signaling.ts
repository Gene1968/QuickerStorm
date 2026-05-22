/**
 * server/handlers/signaling.ts — WebRTC signaling + room privacy.
 *
 * Direct port of signal-server.js logic to Bun's ServerWebSocket API.
 * Handles: join, offer, answer, ice, change-room, talking,
 *          lock-room, unlock-room, knock, admit, deny.
 */

import type { ServerWebSocket } from 'bun'
import type { WSData } from '../index.ts'

// ── State maps ──────────────────────────────────────────────────────────
// roomId → Map<userId, ws>
export const rooms = new Map<string, Map<string, ServerWebSocket<WSData>>>()
// ws → { userId, roomId }
export const sockets = new Map<ServerWebSocket<WSData>, { userId: string; roomId: string | null }>()
// roomId → Set<userId> (occupants holding the lock)
const lockedRooms = new Map<string, Set<string>>()
// roomId → Map<userId, ws> (pending knockers)
const knockQueue = new Map<string, Map<string, ServerWebSocket<WSData>>>()

// ── Helpers ─────────────────────────────────────────────────────────────
function send(ws: ServerWebSocket<WSData>, msg: any) {
	if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

// ── Main message router ─────────────────────────────────────────────────
export function handleSignaling(ws: ServerWebSocket<WSData>, msg: any) {
	switch (msg.type) {
		case 'join':        handleJoin(ws, msg.userId, msg.roomId, msg.admitted); break
		case 'offer':
		case 'answer':
		case 'ice':         relay(ws, msg.peerId, msg); break
		case 'change-room': handleChangeRoom(ws, msg.userId, msg.roomId, msg.admitted); break
		case 'talking':     broadcast(ws, msg); break
		case 'lock-room':   handleLockRoom(ws, msg.userId, msg.roomId); break
		case 'unlock-room': handleUnlockRoom(ws, msg.userId, msg.roomId); break
		case 'knock':       handleKnock(ws, msg.userId, msg.roomId); break
		case 'admit':       handleAdmit(ws, msg.userId, msg.knockerId); break
		case 'deny':        handleDeny(ws, msg.userId, msg.knockerId); break
	}
}

// ── Join / Leave ────────────────────────────────────────────────────────

function handleJoin(ws: ServerWebSocket<WSData>, userId: string, roomId: string, admitted = false) {
	// Leave any existing room first
	handleLeave(ws, true)

	// Evict stale connection from same base user
	const baseUserId = userId.split('_')[0]
	for (const [_roomId, otherRoom] of rooms) {
		for (const [existingId, existingWs] of otherRoom) {
			if (existingId.split('_')[0] === baseUserId && existingId !== userId && existingWs !== ws) {
				console.log(`[signal] evicting stale connection ${existingId} for baseUser ${baseUserId}`)
				existingWs.close(4001, 'superseded')
				break
			}
		}
	}

	// Privacy gate: if room is locked, block entry
	const lockSet = lockedRooms.get(roomId)
	if (lockSet && lockSet.size > 0 && !lockSet.has(userId) && !admitted) {
		sockets.set(ws, { userId, roomId: null })
		ws.data.userId = userId
		ws.data.roomId = null
		send(ws, { type: 'room-locked', roomId })
		return
	}

	sockets.set(ws, { userId, roomId })
	ws.data.userId = userId
	ws.data.roomId = roomId

	if (!rooms.has(roomId)) rooms.set(roomId, new Map())
	const room = rooms.get(roomId)!

	// Notify existing peers / send existing peers to newcomer
	for (const [existingUserId, existingWs] of room) {
		send(existingWs, { type: 'peer-joined', peerId: userId })
		send(ws, { type: 'peer-existing', peerId: existingUserId })
	}

	room.set(userId, ws)

	// Room user list + join ack
	send(ws, { type: 'room-users', users: [...room.keys()] })
	send(ws, { type: 'join-ack', userId, roomId })

	// If room is locked, add newcomer to lock set (they were admitted)
	if (lockSet) lockSet.add(userId)
}

export function handleLeave(ws: ServerWebSocket<WSData>, silent = false) {
	const info = sockets.get(ws)
	if (!info) return
	sockets.delete(ws)

	const { userId, roomId } = info
	ws.data.userId = null
	ws.data.roomId = null

	// Clean up knock queue
	for (const [qRoomId, queue] of knockQueue) {
		if (queue.has(userId)) {
			queue.delete(userId)
			if (queue.size === 0) knockQueue.delete(qRoomId)
		}
	}

	if (!roomId) return

	const room = rooms.get(roomId)
	if (!room) return

	room.delete(userId)
	if (room.size === 0) rooms.delete(roomId)

	if (!silent) {
		for (const peerWs of room.values()) {
			send(peerWs, { type: 'peer-left', peerId: userId })
		}
	}

	// Lock cleanup
	const lockSet = lockedRooms.get(roomId)
	if (lockSet) {
		lockSet.delete(userId)
		if (lockSet.size === 0) {
			lockedRooms.delete(roomId)
			// Auto-admit all knockers
			const queue = knockQueue.get(roomId)
			if (queue) {
				for (const [knockerId, knockerWs] of queue) {
					if (knockerWs.readyState === 1) {
						send(knockerWs, { type: 'admitted', roomId })
						handleJoin(knockerWs, knockerId, roomId)
					}
				}
				knockQueue.delete(roomId)
			}
			// Notify remaining occupants room is unlocked
			const updatedRoom = rooms.get(roomId)
			if (updatedRoom) {
				for (const peerWs of updatedRoom.values()) {
					send(peerWs, { type: 'room-lock-state', roomId, locked: false })
				}
			}
		}
	}
}

function handleChangeRoom(ws: ServerWebSocket<WSData>, userId: string, newRoomId: string, admitted?: boolean) {
	const lockSet = lockedRooms.get(newRoomId)
	if (lockSet && lockSet.size > 0 && !lockSet.has(userId) && !admitted) {
		send(ws, { type: 'room-locked', roomId: newRoomId })
		return
	}
	handleLeave(ws, false)
	handleJoin(ws, userId, newRoomId, admitted)
}

// ── Relay / broadcast ───────────────────────────────────────────────────

function relay(fromWs: ServerWebSocket<WSData>, targetUserId: string, msg: any) {
	const fromInfo = sockets.get(fromWs)
	if (!fromInfo?.roomId) return
	const room = rooms.get(fromInfo.roomId)
	if (!room) return
	const targetWs = room.get(targetUserId)
	if (targetWs) send(targetWs, { ...msg, peerId: fromInfo.userId })
}

function broadcast(fromWs: ServerWebSocket<WSData>, msg: any) {
	const fromInfo = sockets.get(fromWs)
	if (!fromInfo?.roomId) return
	const room = rooms.get(fromInfo.roomId)
	if (!room) return
	for (const [, ws] of room) {
		if (ws !== fromWs) send(ws, msg)
	}
}

// ── Room privacy handlers ───────────────────────────────────────────────

function handleLockRoom(ws: ServerWebSocket<WSData>, userId: string, roomId: string) {
	const info = sockets.get(ws)
	if (!info) return

	if (!lockedRooms.has(roomId)) lockedRooms.set(roomId, new Set())
	lockedRooms.get(roomId)!.add(userId)

	const room = rooms.get(roomId)
	if (room) {
		for (const peerWs of room.values()) {
			send(peerWs, { type: 'room-lock-state', roomId, locked: true })
		}
	}
}

function handleUnlockRoom(ws: ServerWebSocket<WSData>, userId: string, roomId: string) {
	const info = sockets.get(ws)
	if (!info || info.roomId !== roomId) return

	const lockSet = lockedRooms.get(roomId)
	if (!lockSet) return

	lockSet.delete(userId)
	if (lockSet.size === 0) {
		lockedRooms.delete(roomId)
		const queue = knockQueue.get(roomId)
		if (queue) {
			for (const [knockerId, knockerWs] of queue) {
				if (knockerWs.readyState === 1) {
					send(knockerWs, { type: 'admitted', roomId })
					handleJoin(knockerWs, knockerId, roomId)
				}
			}
			knockQueue.delete(roomId)
		}
	}

	const room = rooms.get(roomId)
	if (room) {
		const stillLocked = lockedRooms.has(roomId) && lockedRooms.get(roomId)!.size > 0
		for (const peerWs of room.values()) {
			send(peerWs, { type: 'room-lock-state', roomId, locked: stillLocked })
		}
	}
}

function handleKnock(ws: ServerWebSocket<WSData>, userId: string, roomId: string) {
	const lockSet = lockedRooms.get(roomId)
	if (!lockSet || lockSet.size === 0) {
		send(ws, { type: 'admitted', roomId })
		handleJoin(ws, userId, roomId)
		return
	}

	if (!knockQueue.has(roomId)) knockQueue.set(roomId, new Map())
	knockQueue.get(roomId)!.set(userId, ws)

	const room = rooms.get(roomId)
	if (room) {
		for (const peerWs of room.values()) {
			send(peerWs, { type: 'knock-received', knockerId: userId, roomId })
		}
	}
}

function handleAdmit(ws: ServerWebSocket<WSData>, userId: string, knockerId: string) {
	const info = sockets.get(ws)
	if (!info?.roomId) return
	const roomId = info.roomId

	const queue = knockQueue.get(roomId)
	if (!queue) return
	const knockerWs = queue.get(knockerId)
	if (!knockerWs) return

	queue.delete(knockerId)
	if (queue.size === 0) knockQueue.delete(roomId)

	handleLeave(knockerWs, false)
	send(knockerWs, { type: 'admitted', roomId })
	handleJoin(knockerWs, knockerId, roomId, true)
}

function handleDeny(ws: ServerWebSocket<WSData>, userId: string, knockerId: string) {
	const info = sockets.get(ws)
	if (!info?.roomId) return
	const roomId = info.roomId

	const queue = knockQueue.get(roomId)
	if (!queue) return
	const knockerWs = queue.get(knockerId)
	if (!knockerWs) return

	queue.delete(knockerId)
	if (queue.size === 0) knockQueue.delete(roomId)

	send(knockerWs, { type: 'denied', roomId })
}
