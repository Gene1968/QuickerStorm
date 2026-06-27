// server/lib/caps/invoke.ts — generic cap call. runCap is pure (injectable fetch) and unit-tested;
// invokeCap binds it to a session + replies over the WS, correlated by id.
import { getSession } from '../../state/sessions'
import { parseLLSD } from '../llsd'
import { encodeLLSD } from './llsdEncode'
import { getCapDef, DEDICATED_CAPS, type CapDef } from './registry'
import { slog } from '../serverLog'
import { S } from '../../../shared/protocol.js'

export interface CapOutcome { ok: boolean; result?: any; error?: string; status?: number }

export async function runCap(
	url: string,
	def: CapDef | undefined,
	params: any,
	method: 'POST' | 'GET',
	fetchFn: typeof fetch = fetch,
): Promise<CapOutcome> {
	const payload = def?.request ? def.request(params) : params
	const res = await fetchFn(url, {
		method,
		headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
		body: method === 'GET' ? undefined : encodeLLSD(payload),
		signal: AbortSignal.timeout(30_000),
	})
	const text = await res.text()
	if (!res.ok) return { ok: false, error: `http_${res.status}`, status: res.status }
	const parsed = parseLLSD(text)
	return { ok: true, result: def?.response ? def.response(parsed) : parsed }
}

/** Resolve the session's cap URL by NAME, run the round-trip, reply S.CAP_RESULT { id, cap, ... }. */
export async function invokeCap(
	circuitId: string,
	id: string,
	capName: string,
	params: any,
	method?: 'POST' | 'GET',
): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const reply = (d: Partial<CapOutcome>) =>
		s.ws.send(JSON.stringify({ t: S.CAP_RESULT, d: { id, cap: capName, ...d } }))

	if (DEDICATED_CAPS.has(capName)) { reply({ ok: false, error: 'dedicated_cap' }); return }
	const url = s.caps.get(capName)
	if (!url) {
		slog.warn(s.ws, `[Cap] ${capName} cap_unavailable (session has ${s.caps.size} cap(s))`)
		reply({ ok: false, error: 'cap_unavailable' })
		return
	}
	const def = getCapDef(capName)
	try {
		reply(await runCap(url, def, params, method || def?.method || 'POST'))
	} catch (e) {
		reply({ ok: false, error: (e as Error).message })
	}
}
