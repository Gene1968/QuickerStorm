// server/handlers/caps.ts — CORS proxy for HTTP capability calls
import type { ServerWebSocket } from 'bun'
import { S } from '../../shared/protocol.js'

export async function handleCapsFetch(
	ws: ServerWebSocket<unknown>,
	requestId: string,
	url: string,
	method = 'POST',
	body?: string
): Promise<void> {
	try {
		const res = await fetch(url, {
			method,
			headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
			body: method !== 'GET' ? body : undefined,
		})
		const text = await res.text()
		ws.send(JSON.stringify({ t: S.CAPS_RESULT, d: { id: requestId, status: res.status, body: text } }))
	} catch (err) {
		ws.send(JSON.stringify({ t: S.ERROR, d: { code: 'caps_error', message: (err as Error).message } }))
	}
}
