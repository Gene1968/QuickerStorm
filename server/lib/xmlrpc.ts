// server/lib/xmlrpc.ts — minimal XML-RPC client for SL/OpenSim grid login
import { createHash } from 'crypto'

export interface LoginParams {
	first: string
	last: string
	hashedPass: string  // already $1$-prefixed md5
	start: string       // 'last', 'home', or 'uri:region&x&y&z'
}

export interface LoginResult {
	login: boolean
	session_id?: string
	agent_id?: string
	sim_ip?: string
	sim_port?: number
	circuit_code?: number
	seed_capability?: string
	region_x?: number
	region_y?: number
	region_name?: string
	start_location?: string   // 'last', 'home', or 'uri:...' echoed back by grid
	look_at?: string          // "[r0,r0,r0]" viewer orientation hint
	agent_access?: string     // 'M', 'A', etc
	message?: string
}

/** Hash plaintext password per SL protocol: "$1$" + md5(password) */
export function hashPassword(plaintext: string): string {
	const md5 = createHash('md5').update(plaintext, 'utf8').digest('hex')
	return `$1$${md5}`
}

/** Escape special XML characters in user-supplied strings */
function escXml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

/** Build the XML-RPC login_to_simulator request body */
export function buildLoginXml(p: LoginParams): string {
	const str = (name: string, val: string) =>
		`<member><name>${name}</name><value><string>${val}</string></value></member>`
	const bool = (name: string, val: boolean) =>
		`<member><name>${name}</name><value><boolean>${val ? 1 : 0}</boolean></value></member>`

	return `<?xml version="1.0"?>
<methodCall>
  <methodName>login_to_simulator</methodName>
  <params><param><value><struct>
    ${str('first', escXml(p.first))}
    ${str('last', escXml(p.last))}
    ${str('passwd', escXml(p.hashedPass))}
    ${str('start', escXml(p.start))}
    ${str('channel', 'quickerSTORM')}
    ${str('version', '0.1.0')}
    ${str('platform', 'web')}
    ${str('mac', '00:00:00:00:00:00')}
    ${str('id0', '00000000-0000-0000-0000-000000000000')}
    ${bool('agree_to_tos', true)}
    ${bool('read_critical', true)}
  </struct></value></param></params>
</methodCall>`
}

/** Parse an XML-RPC methodResponse struct into a flat object */
export function parseLoginResponse(xml: string): LoginResult {
	const members: Record<string, string> = {}

	const memberRe = /<member>\s*<name>([^<]+)<\/name>\s*<value>\s*(?:<([^>]+)>)?([^<]*)(?:<\/[^>]+>)?\s*<\/value>\s*<\/member>/g
	let m: RegExpExecArray | null
	while ((m = memberRe.exec(xml)) !== null) {
		const [, name, , value] = m
		members[name.trim()] = value.trim()
	}

	// WHY: parseInt returns NaN for malformed values; guard to keep numeric fields typed as number
	const parseIntSafe = (s: string | undefined, radix = 10): number => {
		const n = parseInt(s ?? '0', radix)
		return Number.isNaN(n) ? 0 : n
	}

	const login = members['login'] === 'true' || members['login'] === '1'
	if (!login) {
		return { login: false, message: members['message'] || 'Login failed' }
	}

	return {
		login: true,
		session_id:      members['session_id'],
		agent_id:        members['agent_id'],
		sim_ip:          members['sim_ip'],
		sim_port:        parseIntSafe(members['sim_port']),
		circuit_code:    parseIntSafe(members['circuit_code']),
		seed_capability: members['seed_capability'],
		region_x:        parseIntSafe(members['region_x']),
		region_y:        parseIntSafe(members['region_y']),
		region_name:     members['region_name'],
		start_location:  members['start_location'],
		look_at:         members['look_at'],
		agent_access:    members['agent_access'],
	}
}

/** POST an XML-RPC request; returns parsed body string */
export async function xmlRpcPost(uri: string, body: string): Promise<string> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), 30_000)  // 30s — slow OpenSim grids need it
	try {
		const res = await fetch(uri, {
			method: 'POST',
			headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
			body,
			signal: controller.signal,
		})
		if (!res.ok) throw new Error(`XML-RPC HTTP ${res.status} from ${uri}`)
		return res.text()
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') {
			// WHY: port 8002 (common OpenSim) may be blocked by firewall/ISP;
			// browser can reach it (whitelisted exe) but bun.exe may not.
			throw new Error(
				`Login server unreachable — timed out after 30s (${uri}). ` +
				`Check: is the grid up? Is port ${new URL(uri).port || '443'} blocked by your firewall?`
			)
		}
		throw new Error(`XML-RPC connect error: ${(err as Error).message} (${uri})`)
	} finally {
		clearTimeout(timeout)
	}
}
