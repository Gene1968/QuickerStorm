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
	region_size_x?: number   // var-region width in metres (e.g. 512); absent on standard 256m grids
	region_size_y?: number   // var-region height in metres
	region_name?: string
	start_location?: string   // 'last', 'home', or 'uri:...' echoed back by grid
	look_at?: string          // "[r0,r0,r0]" viewer orientation hint
	agent_access?: string     // 'M', 'A', etc
	first_name?: string
	last_name?: string
	// WHY: the login response already carries the full inventory FOLDER tree (no cap needed).
	// Folder CONTENTS (items) still require the FetchInventoryDescendents2 cap (Phase 3 slice 2).
	inventory_root?: string             // UUID of the agent's root ("My Inventory") folder
	inventory_skeleton?: InvFolder[]    // every agent folder (no items)
	inventory_lib_root?: string         // UUID of the shared Library root folder
	inventory_skeleton_lib?: InvFolder[]// Library folders (read-only shared inventory)
	message?: string
}

/** One inventory folder from the login skeleton (no items — those need a cap fetch). */
export interface InvFolder {
	folderId: string
	parentId: string
	name: string
	typeDefault: number   // preferred AssetType for the folder (drives icon); -1 = none
	version: number
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

/** Parse an XML-RPC methodResponse struct into a flat object.
 *  WHY: The original single-pass regex failed on multi-line member values and
 *  variations in how OpenSim grids format their XML (extra whitespace, CDATA, etc.).
 *  Two-pass approach: extract <member> blocks first, then parse name + value within each.
 */
export function parseLoginResponse(xml: string): LoginResult {
	const members: Record<string, string> = {}

	// Pass 1: extract each <member>…</member> block (dotAll for multiline)
	const memberBlockRe = /<member>([\s\S]*?)<\/member>/g
	let block: RegExpExecArray | null
	while ((block = memberBlockRe.exec(xml)) !== null) {
		const blockStr = block[1]

		// Extract <name>
		const nameM = /<name>\s*([\s\S]*?)\s*<\/name>/.exec(blockStr)
		if (!nameM) continue
		const name = nameM[1].trim()

		// Extract value: prefer typed inner element (<string>, <int>, <boolean>, etc.)
		const typedM = /<value>\s*<[^/][^>]*>\s*([\s\S]*?)\s*<\/[^>]+>\s*<\/value>/.exec(blockStr)
		const plainM = /<value>\s*([\s\S]*?)\s*<\/value>/.exec(blockStr)
		const rawVal = typedM ? typedM[1].trim() : plainM ? plainM[1].trim() : ''

		// Decode XML entities in values
		members[name] = rawVal
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
	}

	// Log ALL parsed member keys (not values — they may contain session tokens)
	// WHY: OSGrid may return region_name under a different key or not at all; this surfaces it.
	const SENSITIVE = new Set(['session_id', 'agent_id', 'seed_capability', 'passwd'])
	const memberSummary = Object.entries(members)
		.map(([k, v]) => SENSITIVE.has(k) ? `${k}=<redacted>` : `${k}="${v.slice(0, 40)}"`)
		.join(', ')
	console.log(`[xmlrpc] parsed members: ${memberSummary}`)

	// WHY: parseInt returns NaN for malformed values; guard to keep numeric fields typed as number
	const parseIntSafe = (s: string | undefined, radix = 10): number => {
		const n = parseInt(s ?? '0', radix)
		return Number.isNaN(n) ? 0 : n
	}

	const login = members['login'] === 'true' || members['login'] === '1'
	if (!login) {
		return { login: false, message: members['message'] || 'Login failed' }
	}

	const result: LoginResult = {
		login: true,
		session_id:      members['session_id'],
		agent_id:        members['agent_id'],
		sim_ip:          members['sim_ip'],
		sim_port:        parseIntSafe(members['sim_port']),
		circuit_code:    parseIntSafe(members['circuit_code']),
		seed_capability: members['seed_capability'],
		region_x:        parseIntSafe(members['region_x']),
		region_y:        parseIntSafe(members['region_y']),
		region_size_x:   parseIntSafe(members['region_size_x']),
		region_size_y:   parseIntSafe(members['region_size_y']),
		region_name:     members['region_name'],
		start_location:  members['start_location'],
		look_at:         members['look_at'],
		agent_access:    members['agent_access'],
		first_name:      members['first_name'],
		last_name:       members['last_name'],
		// WHY: parsed from the raw XML (nested arrays the flat member scan above can't reach).
		inventory_root:         parseInventoryRoot(xml, 'inventory-root'),
		inventory_skeleton:     parseInventorySkeleton(xml, 'inventory-skeleton'),
		inventory_lib_root:     parseInventoryRoot(xml, 'inventory-lib-root'),
		inventory_skeleton_lib: parseInventorySkeleton(xml, 'inventory-skeleton-lib'),
	}

	console.log(`[xmlrpc] inventory skeleton: ${result.inventory_skeleton?.length ?? 0} folders, lib: ${result.inventory_skeleton_lib?.length ?? 0}, root=${result.inventory_root?.slice(0, 8)}`)

	// Debug log so we can verify parsing during development
	console.log('[xmlrpc] login OK — region:', result.region_name, 'sim:', result.sim_ip, ':', result.sim_port)

	return result
}

/**
 * Extract the raw inner XML of a named XML-RPC <member>'s <array> value.
 * WHY: the flat member parser in parseLoginResponse can't reach nested arrays/structs. This
 * slices out just the one member's <array>…</array> by counting nesting depth, so the per-struct
 * parse below operates on a bounded substring.
 */
function sliceMemberArray(xml: string, memberName: string): string | null {
	const nameIdx = xml.indexOf(`<name>${memberName}</name>`)
	if (nameIdx === -1) return null
	const arrStart = xml.indexOf('<array>', nameIdx)
	if (arrStart === -1) return null
	const re = /<(\/?)array>/g
	re.lastIndex = arrStart
	let depth = 0
	let m: RegExpExecArray | null
	while ((m = re.exec(xml)) !== null) {
		if (m[1]) { depth--; if (depth === 0) return xml.slice(arrStart, m.index) }
		else depth++
	}
	return null
}

/** Read a flat member value (string/int/i4) from a single XML-RPC <struct> body. */
function structMember(structBody: string, member: string): string {
	const re = new RegExp(`<name>${member}</name>\\s*<value>\\s*(?:<[^>]+>)?\\s*([\\s\\S]*?)\\s*(?:</[^>]+>)?\\s*</value>`)
	const m = re.exec(structBody)
	return m ? m[1].trim() : ''
}

/**
 * Parse an inventory folder array (inventory-skeleton or inventory-skeleton-lib) from the login XML.
 * Folder structs are flat (string/int members only), so a non-nesting <struct> scan is safe.
 */
export function parseInventorySkeleton(xml: string, memberName = 'inventory-skeleton'): InvFolder[] {
	const arrXml = sliceMemberArray(xml, memberName)
	if (!arrXml) return []
	const folders: InvFolder[] = []
	const structRe = /<struct>([\s\S]*?)<\/struct>/g
	let s: RegExpExecArray | null
	while ((s = structRe.exec(arrXml)) !== null) {
		const body = s[1]
		const td = structMember(body, 'type_default')
		const ver = structMember(body, 'version')
		folders.push({
			folderId:    structMember(body, 'folder_id'),
			parentId:    structMember(body, 'parent_id'),
			name:        structMember(body, 'name'),
			typeDefault: td  === '' ? -1 : parseInt(td, 10),
			version:     ver === '' ? 0  : parseInt(ver, 10),
		})
	}
	return folders
}

/**
 * The inventory-root / inventory-lib-root members are an array of one struct holding folder_id.
 * Returns that folder UUID, or '' if absent.
 */
export function parseInventoryRoot(xml: string, memberName = 'inventory-root'): string {
	const arrXml = sliceMemberArray(xml, memberName)
	if (!arrXml) return ''
	const s = /<struct>([\s\S]*?)<\/struct>/.exec(arrXml)
	return s ? structMember(s[1], 'folder_id') : ''
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
