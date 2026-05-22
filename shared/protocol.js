/**
 * shared/protocol.js — Message type constants for the quickerSTORM WebSocket protocol.
 *
 * Imported by both the Bun server and the Vue client.
 * Phase 1 (signaling) keeps the existing { type: '...' } format for backward compat.
 * Phase 2+ adds { t: '...', d: {...} } envelope for presence/pose/chat.
 */

// ── Signaling (WebRTC) ──────────────────────────────────────────────────
// These use the legacy { type, ... } format carried over from signal-server.js.
export const SIG = {
	JOIN:         'join',
	OFFER:        'offer',
	ANSWER:       'answer',
	ICE:          'ice',
	CHANGE_ROOM:  'change-room',
	TALKING:      'talking',
	PEER_JOINED:  'peer-joined',
	PEER_LEFT:    'peer-left',
	PEER_EXISTING:'peer-existing',
	ROOM_USERS:   'room-users',
	JOIN_ACK:     'join-ack',
}

// ── Room privacy ────────────────────────────────────────────────────────
export const DOOR = {
	LOCK_ROOM:      'lock-room',
	UNLOCK_ROOM:    'unlock-room',
	KNOCK:          'knock',
	ADMIT:          'admit',
	DENY:           'deny',
	ROOM_LOCKED:    'room-locked',
	ADMITTED:       'admitted',
	DENIED:         'denied',
	KNOCK_RECEIVED: 'knock-received',
	ROOM_LOCK_STATE:'room-lock-state',
}

// ── Envelope message types (Phase 2+) ───────────────────────────────────
// Short keys to minimize JSON overhead on high-frequency messages.
export const MSG = {
	// Client → Server
	POSE:     'pose',
	CURSOR:   'cursor',
	CHAT:     'chat',
	TYPING:   'typing',
	PING:     'ping',

	// Server → Client
	WORLD:    'world',
	ENTER:    'enter',
	LEAVE:    'leave',
	PONG:     'pong',
}

// ── Collaboration (Yjs sync, polls, reactions) ─────────────────────────
export const COLLAB = {
	// Yjs document sync
	YJS_SYNC:      'ys',    // { docId, data: base64 }  — sync step 1/2
	YJS_UPDATE:    'yu',    // { docId, data: base64 }  — incremental update
	YJS_AWARENESS: 'ya',    // { docId, data: base64 }  — cursor/selection awareness

	// Polls
	POLL_CREATE:   'pc',    // { question, options[], roomId?, endsAt? }
	POLL_VOTE:     'pv',    // { pollId, optionIdx }
	POLL_RESULT:   'pr',    // server→room: { poll: { id, question, options, endsAt, tallies, votes, ... } }
	POLL_CLOSE:    'px',    // { pollId } (creator-only)
	POLL_UPDATE:   'pu',    // { pollId, endsAt? } (creator-only) — null endsAt clears it
	POLL_DELETE:   'pd',    // { pollId } (creator-only)
	POLL_DELETED:  'prd',   // server→room: { pollId, roomId } — clients remove from cache
	POLL_LIST:     'pl',    // client→server: { roomId } / server→client: { roomId, polls[] }

	// Doc presence (server → room: subscriber count changed)
	DOC_PRESENCE:  'dp',    // { docId, count } — broadcast to room

	// Reactions (ephemeral — never persisted)
	REACTION:      'rx',    // { emoji } — broadcast to room peers
}

// Close codes
export const CLOSE = {
	SUPERSEDED: 4001,   // another tab connected with same auth user
}
