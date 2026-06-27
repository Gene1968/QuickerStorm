// server/handlers/inventory.ts — FetchInventoryDescendents2 cap → typed item list.
// WHY: the folder TREE arrives free at login (xmlrpc inventory-skeleton). Folder CONTENTS (items)
// require this HTTP cap. We keep cap URLs + LLSD entirely server-side and hand the client clean
// JSON, matching the LLUDP-decode→JSON pattern used everywhere else.
import { getSession } from '../state/sessions'
import { parseLLSD } from '../lib/llsd'
import { encodeLLSD } from '../lib/caps/llsdEncode'
import { buildInvRequest, decodeInvFolders } from '../lib/caps/inventoryCap'
import { slog } from '../lib/serverLog'
import { S } from '../../shared/protocol.js'

// WHY: grids expose the folder-descendents cap under either name (modern / legacy).
const INV_CAPS = ['FetchInventoryDescendents2', 'WebFetchInventoryDescendents']

export async function handleInventoryFetch(circuitId: string, folderIds: string[]): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const ids = (folderIds || []).filter(Boolean)
	if (ids.length === 0) return

	const capName = INV_CAPS.find(n => s.caps.get(n))
	const cap = capName ? s.caps.get(capName) : undefined
	if (!cap) {
		// WHY: grid doesn't offer FetchInventoryDescendents2/WebFetchInventoryDescendents, or
		// the session hasn't had caps set yet. Log with which cap names the session has so we
		// can tell "no caps at all" from "wrong cap name" from "seed-cap fetch pending".
		slog.warn(s.ws, `[Inv] cap_unavailable — session has ${s.caps.size} cap(s): ${[...s.caps.keys()].join(', ') || '(none)'}`)
		for (const folderId of ids) {
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], error: 'cap_unavailable' } }))
		}
		return
	}

	const reqValue = buildInvRequest(ids, s.agentId)
	try {
		const res = await fetch(cap, {
			method: 'POST',
			headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
			body: encodeLLSD(reqValue),
			signal: AbortSignal.timeout(25_000),
		})
		const text = await res.text()
		const folders = decodeInvFolders(parseLLSD(text))
		if (folders.length === 0) {
			slog.warn(s.ws, `[Inv] empty response for ${ids.length} folder(s) — HTTP ${res.status}, ${text.length}B, sample: ${text.slice(0, 300).replace(/\s+/g, ' ')}`)
		}
		const seen = new Set<string>()
		let total = 0
		for (const f of folders) {
			seen.add(f.folderId)
			total += f.items.length
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId: f.folderId, items: f.items } }))
		}
		for (const folderId of ids) {
			if (!seen.has(folderId)) s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [] } }))
		}
		slog.info(s.ws, `[Inv] ${ids.length} folder(s) → ${total} items (HTTP ${res.status})`)
	} catch (e) {
		slog.warn(s.ws, `Inventory fetch failed: ${(e as Error).message}`)
		for (const folderId of ids) {
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], error: (e as Error).message } }))
		}
	}
}
