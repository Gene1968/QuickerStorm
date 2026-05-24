/**
 * server/index.ts — quickerSTORM WebSocket + HTTP server (Bun runtime).
 *
 * Phase 1: XML-RPC login proxy, per-session LLUDP bridge, caps CORS proxy, static SPA.
 * All AVA office handlers removed; new LLUDP handlers wired below.
 */

import { readFileSync, existsSync, statSync } from 'fs'
import { join, normalize, extname } from 'path'
import { handleLogin, handleLogout } from './handlers/login'
import { handleClientMessage } from './handlers/lludp'
import { handleCapsFetch } from './handlers/caps'
import { deleteSession, resolveCircuitId, attachWs, detachWs, scheduleExpire } from './state/sessions'
import { C } from '../shared/protocol.js'
import type { ServerWebSocket } from 'bun'
import * as dgram from 'dgram'

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

// ── UDP loopback self-test ──────────────────────────────────────────────
// WHY: If this fails, bun's dgram recv is broken on this machine/runtime.
// Run at startup so we know immediately whether receive is functional.
function selfTestUdp(): void {
	const sock = dgram.createSocket('udp4')
	let done = false

	const finish = (pass: boolean, reason: string) => {
		if (done) return
		done = true
		if (pass) console.log(`[udp-self-test] ✓ PASS — ${reason}`)
		else      console.error(`[udp-self-test] ✗ FAIL — ${reason}`)
		try { sock.close() } catch { /* already closed */ }
	}

	sock.on('error', (err: Error) => finish(false, `socket error: ${err.message}`))

	sock.on('message', (msg: Buffer) => {
		if (msg.toString() === 'ping') finish(true, 'loopback recv OK — bun dgram is functional')
		else finish(false, `unexpected message: ${msg.toString('hex')}`)
	})

	sock.bind(0, '127.0.0.1', () => {
		const { port } = sock.address()
		console.log(`[udp-self-test] bound on 127.0.0.1:${port}, sending ping to self…`)
		sock.send(Buffer.from('ping'), port, '127.0.0.1', (err: Error | null) => {
			if (err) finish(false, `send error: ${err.message}`)
		})
		// 2-second timeout — if no message by then, recv is broken
		setTimeout(() => finish(false, 'timeout — no loopback packet in 2s. Bun dgram recv may be broken on this platform/version.'), 2000)
	})
}

selfTestUdp()

const PORT = Number(process.env.PORT) || 8787

// ── Static SPA serving ──────────────────────────────────────────────────
// Only serve static files when explicitly configured (production/Docker).
// In dev, Vite handles the frontend on its own port.
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
	'.woff2': 'font/woff2',
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
			'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable',
		},
	})
}

// ── WebSocket data attached to each connection ──────────────────────────
interface WSData {
	sessionId: string
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

		// WebSocket upgrade
		if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			const ok = server.upgrade(req, {
				data: { sessionId: crypto.randomUUID() } satisfies WSData,
			})
			if (ok) return undefined as any
			return new Response('WebSocket upgrade failed', { status: 400 })
		}

		// Health check
		if (url.pathname === '/healthz') {
			return new Response('ok', { headers: { 'Content-Type': 'text/plain' } })
		}

		// Static SPA (GET/HEAD only)
		if (req.method === 'GET' || req.method === 'HEAD') {
			const staticRes = tryServeStatic(url)
			if (staticRes) return staticRes
		}

		return new Response('quickerSTORM server OK\n', {
			headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS },
		})
	},

	websocket: {
		open(_ws: ServerWebSocket<WSData>) {
			// WHY: Timer started inside login handler after session + socket are ready.
			// Starting here (pre-login) finds no session → auto-clears → retransmit never runs.
		},

		message(ws: ServerWebSocket<WSData>, raw: string | Buffer) {
			if (typeof raw !== 'string') return  // no binary frames in Phase 1

			let msg: { t: string; d: unknown }
			try { msg = JSON.parse(raw) } catch { return }

			const wsId     = ws.data.sessionId
			// WHY: Reconnect WS has a new per-connection UUID; resolve to the existing circuitId
			// so MOVE/CHAT find the right session even after a page-reload reconnect.
			const circuitId = resolveCircuitId(wsId)

			switch (msg.t) {
				case C.LOGIN:
					handleLogin(ws, wsId, msg.d as { grid: string; username: string; password: string })
					break
				case C.LOGOUT:
					handleLogout(ws, circuitId)
					break
				case C.CAPS_FETCH: {
					const d = msg.d as { id: string; url: string; method?: string; body?: string }
					handleCapsFetch(ws, d.id, d.url, d.method, d.body)
					break
				}
				default:
					// MOVE and CHAT go to LLUDP bridge — use resolved circuitId
					handleClientMessage(circuitId, msg)
			}
		},

		close(ws: ServerWebSocket<WSData>) {
			const wsId     = ws.data.sessionId
			const circuitId = resolveCircuitId(wsId)
			detachWs(wsId)
			// WHY: Don't destroy circuit immediately — hold for CIRCUIT_HOLD_MS so the browser
			// can reconnect (page reload) and resume the same sim circuit without re-login.
			scheduleExpire(circuitId)
		},

		perMessageDeflate: true,
	},
})

console.log(`quickerSTORM server listening on http://localhost:${server.port}`)
