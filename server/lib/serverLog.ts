// server/lib/serverLog.ts — unified logging: console + browser debug stream
import type { ServerWebSocket } from 'bun'
import { S } from '../../shared/protocol.js'

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * Log to server console AND forward to the browser client via S.DEBUG envelope.
 * WHY: Without this, the only way to diagnose circuit issues is to read the
 * server terminal, which the user may not have open or visible.
 */
export function serverLog(ws: ServerWebSocket<unknown>, level: LogLevel, msg: string): void {
	const ts   = new Date().toISOString().slice(11, 23)
	const line = `${ts} [${level.toUpperCase()}] ${msg}`

	if (level === 'error')      console.error(`[srv] ${line}`)
	else if (level === 'warn')  console.warn(`[srv] ${line}`)
	else                        console.log(`[srv] ${line}`)

	try {
		ws.send(JSON.stringify({ t: S.DEBUG, d: { level, msg: line } }))
	} catch { /* ws may be closing */ }
}

/** Convenience shorthands */
export const slog = {
	info:  (ws: ServerWebSocket<unknown>, m: string) => serverLog(ws, 'info',  m),
	warn:  (ws: ServerWebSocket<unknown>, m: string) => serverLog(ws, 'warn',  m),
	error: (ws: ServerWebSocket<unknown>, m: string) => serverLog(ws, 'error', m),
}
