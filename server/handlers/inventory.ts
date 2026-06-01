// server/handlers/inventory.ts — FetchInventoryDescendents2 cap → typed item list.
// WHY: the folder TREE arrives free at login (xmlrpc inventory-skeleton). Folder CONTENTS (items)
// require this HTTP cap. We keep cap URLs + LLSD entirely server-side and hand the client clean
// JSON, matching the LLUDP-decode→JSON pattern used everywhere else.
import { getSession } from '../state/sessions'
import { parseLLSD, llsdNum, llsdStr } from '../lib/llsd'
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

	// WHY: FetchInventoryDescendents2 accepts many folders in one POST — batching makes the
	// background "fetch all" cheap (a few requests vs one-per-folder). fetch_folders=0 because the
	// skeleton already has every folder; we only need items.
	const folderXml = ids.map(id =>
		`<map>` +
		`<key>folder_id</key><uuid>${id}</uuid>` +
		`<key>owner_id</key><uuid>${s.agentId}</uuid>` +
		`<key>fetch_folders</key><boolean>1</boolean>` +
		`<key>fetch_items</key><boolean>1</boolean>` +
		`<key>sort_order</key><integer>0</integer>` +
		`</map>`).join('')
	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<llsd><map><key>folders</key><array>${folderXml}</array></map></llsd>`

	try {
		const res = await fetch(cap, {
			method: 'POST',
			headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
			body,
		})
		const text = await res.text()
		const parsed = parseLLSD(text) as any
		const respFolders = Array.isArray(parsed?.folders) ? parsed.folders : []
		// WHY: diagnostic — if the grid returns no folders/items, surface status + a body sample so
		// we can tell apart "cap rejected request" vs "parser missed the shape" vs "empty folders".
		if (respFolders.length === 0) {
			slog.warn(s.ws, `[Inv] empty response for ${ids.length} folder(s) — HTTP ${res.status}, ${text.length}B, sample: ${text.slice(0, 300).replace(/\s+/g, ' ')}`)
		}
		const seen = new Set<string>()
		let total = 0
		for (const f of respFolders) {
			const folderId = llsdStr(f?.folder_id)
			if (!folderId) continue
			seen.add(folderId)
			const items = (Array.isArray(f?.items) ? f.items : []).map((it: any) => {
				// Owner permission mask → no-copy/mod/transfer flags. Bits: COPY 0x8000,
				// MODIFY 0x4000, TRANSFER 0x2000. Search-friendly + shown FS-style on the row.
				const perms = (it.permissions && typeof it.permissions === 'object') ? it.permissions : {}
				const ownerMask = llsdNum(perms.owner_mask)
				return {
					itemId:    llsdStr(it.item_id),
					parentId:  llsdStr(it.parent_id),
					name:      llsdStr(it.name),
					desc:      llsdStr(it.desc),
					assetType: llsdNum(it.type),       // AssetType (drives icon)
					invType:   llsdNum(it.inv_type),
					assetId:   llsdStr(it.asset_id),
					flags:     llsdNum(it.flags),
					createdAt: llsdNum(it.created_at),
					ownerMask,
					canCopy:     (ownerMask & 0x8000) !== 0,
					canModify:   (ownerMask & 0x4000) !== 0,
					canTransfer: (ownerMask & 0x2000) !== 0,
				}
			})
			total += items.length
			s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items } }))
		}
		// WHY: echo empty for any requested folder the sim omitted, so the client marks it fetched
		// and the background loader doesn't re-request it forever.
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
