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
	message?: string
}

/** Hash plaintext password per SL protocol: "$1$" + md5(password) */
export function hashPassword(plaintext: string): string {
	const md5 = createHash('md5').update(plaintext, 'utf8').digest('hex')
	return `$1$${md5}`
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
    ${str('first', p.first)}
    ${str('last', p.last)}
    ${str('passwd', p.hashedPass)}
    ${str('start', p.start)}
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

	const login = members['login'] === 'true' || members['login'] === '1'
	if (!login) {
		return { login: false, message: members['message'] || 'Login failed' }
	}

	return {
		login: true,
		session_id:      members['session_id'],
		agent_id:        members['agent_id'],
		sim_ip:          members['sim_ip'],
		sim_port:        parseInt(members['sim_port'] ?? '0', 10),
		circuit_code:    parseInt(members['circuit_code'] ?? '0', 10),
		seed_capability: members['seed_capability'],
		region_x:        parseInt(members['region_x'] ?? '0', 10),
		region_y:        parseInt(members['region_y'] ?? '0', 10),
	}
}

/** POST an XML-RPC request; returns parsed body string */
export async function xmlRpcPost(uri: string, body: string): Promise<string> {
	const res = await fetch(uri, {
		method: 'POST',
		headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
		body,
	})
	if (!res.ok) throw new Error(`XML-RPC HTTP error ${res.status}`)
	return res.text()
}
