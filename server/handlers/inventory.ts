// server/handlers/inventory.ts — FetchInventoryDescendents2 cap → typed item list.
// WHY: the folder TREE arrives free at login (xmlrpc inventory-skeleton). Folder CONTENTS (items)
// require this HTTP cap. We keep cap URLs + LLSD entirely server-side and hand the client clean
// JSON, matching the LLUDP-decode→JSON pattern used everywhere else.
import { getSession } from '../state/sessions'
import { parseLLSD, llsdStr, llsdNum } from '../lib/llsd'
import { encodeLLSD, llsd } from '../lib/caps/llsdEncode'
import { buildInvRequest, decodeInvFolders } from '../lib/caps/inventoryCap'
import { slog } from '../lib/serverLog'
import { S } from '../../shared/protocol.js'

// WHY: grids expose the folder-descendents cap under either name (modern / legacy).
const INV_CAPS = ['FetchInventoryDescendents2', 'WebFetchInventoryDescendents']

// Folder creation via the CreateInventoryCategory cap. WHY a cap, not UDP CreateInventoryFolder:
// the UDP message is fire-and-forget and on OpenSim does NOT reliably persist (folder vanishes on
// reload). This cap is the modern/AIS path FS uses — OpenSim re-reads the folder (GetFolder) before
// returning 200, so a success response confirms the folder actually persisted.
// Request LLSD: { folder_id:uuid (non-zero), parent_id:uuid, name:string(≤63), type:integer }.
// Response LLSD (200): { folder_id, name, parent_id, type } (echo of the created folder).
// Returns true if the cap path was used (success OR failure reported); false if the cap is absent
// (caller falls back to the legacy UDP path). Ref: OpenSim BunchOfCaps.cs CreateInventoryCategory.
export async function handleCreateFolder(
	circuitId: string,
	d: { folderId: string; parentId: string; name?: string; type?: number },
): Promise<boolean> {
	const s = getSession(circuitId)
	if (!s) return false
	const cap = s.caps.get('CreateInventoryCategory')
	if (!cap) return false   // no cap → caller falls back to UDP CreateInventoryFolder
	if (!d.folderId || !d.parentId) { slog.warn(s.ws, 'CreateFolder(cap): missing folderId/parentId'); return true }

	const name = (d.name || 'New Folder').slice(0, 63)
	const reqValue = {
		folder_id: llsd.uuid(d.folderId),
		parent_id: llsd.uuid(d.parentId),
		name,
		type: llsd.int(d.type ?? -1),
	}
	try {
		const res = await fetch(cap, {
			method: 'POST',
			headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
			body: encodeLLSD(reqValue),
			signal: AbortSignal.timeout(20_000),
		})
		const text = await res.text()
		const parsed = parseLLSD(text) as Record<string, unknown>
		const newId = llsdStr(parsed?.folder_id)
		if (res.status === 200 && newId) {
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER_CREATED, d: {
				folderId:    newId,
				parentId:    llsdStr(parsed?.parent_id) || d.parentId,
				name:        llsdStr(parsed?.name) || name,
				typeDefault: llsdNum(parsed?.type),
			} }))
			slog.info(s.ws, `[Inv] CreateInventoryCategory OK "${name}" ${newId.slice(0, 8)}… under ${d.parentId.slice(0, 8)}…`)
		} else {
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER_CREATE_FAILED, d: { folderId: d.folderId, error: `HTTP ${res.status}` } }))
			slog.warn(s.ws, `[Inv] CreateInventoryCategory failed — HTTP ${res.status}, ${text.slice(0, 200).replace(/\s+/g, ' ')}`)
		}
	} catch (e) {
		s.ws.send(JSON.stringify({ t: S.INV_FOLDER_CREATE_FAILED, d: { folderId: d.folderId, error: (e as Error).message } }))
		slog.warn(s.ws, `[Inv] CreateInventoryCategory error: ${(e as Error).message}`)
	}
	return true
}

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
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId: f.folderId, items: f.items, subfolders: f.subfolders } }))
		}
		for (const folderId of ids) {
			if (!seen.has(folderId)) s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], subfolders: [] } }))
		}
		slog.info(s.ws, `[Inv] ${ids.length} folder(s) → ${total} items (HTTP ${res.status})`)
	} catch (e) {
		slog.warn(s.ws, `Inventory fetch failed: ${(e as Error).message}`)
		for (const folderId of ids) {
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], error: (e as Error).message } }))
		}
	}
}
