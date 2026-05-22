/**
 * server/index.ts — QuickerStorm WebSocket + HTTP server (Bun runtime).
 *
 * Replaces signal-server.js with Bun's native WebSocket and HTTP handling.
 * Phase 1: WebRTC signaling, room privacy, Jitsi/Google token endpoints, static SPA.
 * Phase 2+: presence, pose, chat, cursor relay with Supabase flush.
 */

import { readFileSync, existsSync, statSync } from 'fs'
import { join, normalize, extname } from 'path'
import { handleJitsiToken } from './jitsi.ts'
import { handleGoogleToken } from './google.ts'
import { handleSignaling, handleLeave, sockets } from './handlers/signaling.ts'
import { handlePresenceJoin, handlePresenceLeave, handleRoomChange, handleProfileUpdate, handleReclaim } from './handlers/presence.ts'
import { handlePose, handleSound, handleGreet, handleFridge } from './handlers/pose.ts'
import { handleChat, handleTyping } from './handlers/chat.ts'
import { handleDoor } from './handlers/doors.ts'
import { handleCursor } from './handlers/cursor.ts'
import { handleYjsSync, handleYjsUpdate, handleYjsAwareness, handleDocClose } from './handlers/collab.ts'
import { handlePermissions } from './handlers/collab-permissions.ts'
import { handlePollCreate, handlePollVote, handlePollClose, handlePollList, handlePollUpdate, handlePollDelete } from './handlers/poll.ts'
import { handleReaction } from './handlers/reaction.ts'
import { handleConnect4, cleanupConnect4 } from './handlers/connect4.ts'
import { unsubscribeAll as unsubscribeAllDocs, getSubscribers as getDocSubscribers } from './state/docs.ts'
import { broadcastToRoom as broadcastToRoomWorld } from './state/world.ts'
import { startFlush } from './state/flush.ts'
import type { ServerWebSocket } from 'bun'

// ── Load .env.development.local for local dev ───────────────────────────
if (existsSync('.env.development.local')) {
	let loaded = 0
	readFileSync('.env.development.local', 'utf8').split('\n').forEach((line: string) => {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) return
		const eq = trimmed.indexOf('=')
		if (eq === -1) return
		const key = trimmed.slice(0, eq).trim()
		const val = trimmed.slice(eq + 1).trim()
		if (key && !(key in process.env)) { process.env[key] = val; loaded++ }
	})
	console.log(`[env] Loaded ${loaded} vars from .env.development.local`)
} else {
	console.log('[env] .env.development.local not found — relying on process env')
}

const PORT = Number(process.env.PORT) || 8787

// ── Static SPA serving ──────────────────────────────────────────────────
// Only serve static files when explicitly configured (production/Railway).
// In dev mode, Vite handles the frontend on its own port.
const STATIC_DIR = process.env.STATIC_DIR || null
if (STATIC_DIR) console.log(`[static] serving SPA from ${STATIC_DIR}`)

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js':   'application/javascript; charset=utf-8',
	'.mjs':  'application/javascript; charset=utf-8',
	'.css':  'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg':  'image/svg+xml',
	'.png':  'image/png',
	'.jpg':  'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif':  'image/gif',
	'.webp': 'image/webp',
	'.ico':  'image/x-icon',
	'.woff': 'font/woff',
	'.woff2':'font/woff2',
	'.ttf':  'font/ttf',
	'.otf':  'font/otf',
	'.mp3':  'audio/mpeg',
	'.mp4':  'video/mp4',
	'.glb':  'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.pdf':  'application/pdf',
	'.map':  'application/json; charset=utf-8',
}

const CORS_HEADERS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
}

function tryServeStatic(url: URL): Response | null {
	if (!STATIC_DIR) return null

	const urlPath = (url.pathname || '/').replace(/\/+$/, '') || '/'
	let filePath = normalize(join(STATIC_DIR, urlPath))
	const base = normalize(STATIC_DIR)
	if (!filePath.startsWith(base)) return null

	let stat: ReturnType<typeof statSync> | null
	try { stat = statSync(filePath) } catch { stat = null }
	if (stat?.isDirectory()) {
		filePath = join(filePath, 'index.html')
		try { stat = statSync(filePath) } catch { stat = null }
	}
	// SPA fallback
	if (!stat) {
		filePath = join(STATIC_DIR, 'index.html')
		try { stat = statSync(filePath) } catch { return null }
	}

	const ext = extname(filePath).toLowerCase()
	const type = MIME[ext] || 'application/octet-stream'
	const isHtml = ext === '.html'
	const body = readFileSync(filePath)

	return new Response(body, {
		headers: {
			'Content-Type': type,
			'Content-Length': String(stat!.size),
			'Cache-Control': isHtml || filePath.endsWith('version.json')
				? 'no-cache, no-store, must-revalidate'
				: 'public, max-age=31536000, immutable',
		},
	})
}

// ── WebSocket data attached to each connection ──────────────────────────
export interface WSData {
	userId: string | null        // signaling userId (compound: "presenceId_sessionId")
	roomId: string | null        // signaling room
	authUserId?: string          // Supabase auth UUID (set on presence join)
	presenceUserId?: string      // presence row ID or authUserId (set on presence join)
}

// ── Bun server ──────────────────────────────────────────────────────────
const server = Bun.serve<WSData>({
	port: PORT,

	async fetch(req, server) {
		const url = new URL(req.url)

		// CORS preflight
		if (req.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS_HEADERS })
		}

		// WebSocket upgrade — accept on any path for backward compat with signal-server
		if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			const ok = server.upgrade(req, {
				data: { userId: null, roomId: null } satisfies WSData,
			})
			if (ok) return undefined as any
			return new Response('WebSocket upgrade failed', { status: 400 })
		}

		// HTTP API routes
		if (url.pathname === '/api/jitsi-token' && req.method === 'POST') {
			return handleJitsiToken(req)
		}
		if (url.pathname === '/api/google-token' && req.method === 'POST') {
			return handleGoogleToken(req)
		}
		if (url.pathname === '/healthz') {
			return new Response('ok', { headers: { 'Content-Type': 'text/plain' } })
		}

		// Static SPA (GET/HEAD only)
		if (req.method === 'GET' || req.method === 'HEAD') {
			const staticRes = tryServeStatic(url)
			if (staticRes) return staticRes
		}

		return new Response('QuickerStorm server OK\n', {
			headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
		})
	},

	websocket: {
		open(ws: ServerWebSocket<WSData>) {
			// nothing — client must send 'join' first
		},

		pong(ws: ServerWebSocket<WSData>) {
			// Mark alive when browser responds to our ping
			markAlive(ws)
		},

		message(ws: ServerWebSocket<WSData>, raw: string | Buffer) {
			// Any message = connection is alive (covers idle users who send no signaling)
			markAlive(ws)

			let msg: any
			try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) } catch { return }

			// Route by format: { t, d } = envelope (Phase 2+), { type } = signaling (Phase 1)
			if (msg.t) {
				const d = msg.d || {}
				switch (msg.t) {
					case 'join':    handlePresenceJoin(ws, d); break
					case 'reclaim': handleReclaim(ws, d); break
					case 'room':    handleRoomChange(ws, d); break
					case 'profile': handleProfileUpdate(ws, d); break
					case 'pose':    handlePose(ws, d); break
					case 'sound':   handleSound(ws, d); break
					case 'fridge':  handleFridge(ws, d); break
					case 'greet':   handleGreet(ws, d); break
					case 'chat':    handleChat(ws, d); break
					case 'typing':  handleTyping(ws, d); break
					case 'door':    handleDoor(ws, d); break
					case 'cursor':  handleCursor(ws, d); break
					case 'ys':     handleYjsSync(ws, d); break
					case 'yu':     handleYjsUpdate(ws, d); break
					case 'ya':     handleYjsAwareness(ws, d); break
					case 'yc':     handleDocClose(ws, d); break
					case 'yp':     handlePermissions(ws, d); break
					case 'pc':     handlePollCreate(ws, d); break
					case 'pv':     handlePollVote(ws, d); break
					case 'px':     handlePollClose(ws, d); break
					case 'pl':     handlePollList(ws, d); break
					case 'pu':     handlePollUpdate(ws, d); break
					case 'pd':     handlePollDelete(ws, d); break
					case 'rx':     handleReaction(ws, d); break
					case 'c4':     handleConnect4(ws, d); break
					case 'ping':    if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong' })); break
				}
			} else if (msg.type) {
				handleSignaling(ws, msg)
			}
		},

		close(ws: ServerWebSocket<WSData>) {
			handleLeave(ws, false)
			handlePresenceLeave(ws)
			if (ws.data.presenceUserId) {
				const affected = unsubscribeAllDocs(ws.data.presenceUserId)
				for (const { docId, roomId } of affected) {
					const count = getDocSubscribers(docId).size
					broadcastToRoomWorld(roomId, { t: 'dp', d: { docId, count } })
				}
				cleanupConnect4(ws.data.presenceUserId)
			}
		},

		perMessageDeflate: true,
	},
})

// ── Ping/pong keepalive: detect dead connections ────────────────────────
const aliveSet = new WeakSet<ServerWebSocket<WSData>>()

/** Mark a connection as alive (called on pong and on any message). */
function markAlive(ws: ServerWebSocket<WSData>) {
	aliveSet.add(ws)
}

const PING_INTERVAL = 30_000
setInterval(() => {
	for (const [clientWs] of sockets) {
		if (!aliveSet.has(clientWs)) {
			clientWs.close(1000, 'ping timeout')
			handleLeave(clientWs, false)
			handlePresenceLeave(clientWs)
			continue
		}
		aliveSet.delete(clientWs)
		clientWs.ping()
	}
}, PING_INTERVAL)

// ── Start the 30s Supabase flush cycle ──────────────────────────────────
// Only starts if SUPABASE_SERVICE_ROLE_KEY is configured. In local dev
// without the key, the server still works for signaling/relay — it just
// doesn't persist presence to the database.
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
	startFlush()
} else {
	console.log('[flush] SUPABASE_SERVICE_ROLE_KEY not set — flush disabled (signaling-only mode)')
}

console.log(`QuickerStorm server listening on http://localhost:${server.port}`)
