// server/handlers/inventory.ts — FetchInventoryDescendents2 cap → typed item list.
// WHY: the folder TREE arrives free at login (xmlrpc inventory-skeleton). Folder CONTENTS (items)
// require this HTTP cap. We keep cap URLs + LLSD entirely server-side and hand the client clean
// JSON, matching the LLUDP-decode→JSON pattern used everywhere else.
import { getSession } from '../state/sessions'
import { parseLLSD, llsdNum, llsdStr } from '../lib/llsd'
import { slog } from '../lib/serverLog'
import { S } from '../../shared/protocol.js'

const INV_CAP = 'FetchInventoryDescendents2'

export async function handleInventoryFetch(circuitId: string, folderId: string): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	if (!folderId) return

	const cap = s.caps.get(INV_CAP)
	if (!cap) {
		// WHY: seed-cap fetch (login.ts) may not have completed yet, or the grid doesn't offer it.
		// Tell the client so it can clear its "fetching" flag and retry on CAPS_READY.
		s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], error: 'cap_unavailable' } }))
		return
	}

	// fetch_folders=0: the skeleton already has every folder; we only need items here.
	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n<llsd><map><key>folders</key><array><map>` +
		`<key>folder_id</key><uuid>${folderId}</uuid>` +
		`<key>owner_id</key><uuid>${s.agentId}</uuid>` +
		`<key>fetch_folders</key><boolean>0</boolean>` +
		`<key>fetch_items</key><boolean>1</boolean>` +
		`<key>sort_order</key><integer>0</integer>` +
		`</map></array></map></llsd>`

	try {
		const res = await fetch(cap, {
			method: 'POST',
			headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
			body,
		})
		const text = await res.text()
		const parsed = parseLLSD(text) as any
		const items: Array<Record<string, unknown>> = []
		const folders = Array.isArray(parsed?.folders) ? parsed.folders : []
		for (const f of folders) {
			for (const it of (Array.isArray(f?.items) ? f.items : [])) {
				items.push({
					itemId:    llsdStr(it.item_id),
					parentId:  llsdStr(it.parent_id),
					name:      llsdStr(it.name),
					desc:      llsdStr(it.desc),
					assetType: llsdNum(it.type),       // AssetType (drives icon)
					invType:   llsdNum(it.inv_type),
					assetId:   llsdStr(it.asset_id),
					flags:     llsdNum(it.flags),
					createdAt: llsdNum(it.created_at),
				})
			}
		}
		slog.info(s.ws, `[Inv] folder ${folderId.slice(0, 8)} → ${items.length} items (HTTP ${res.status})`)
		s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items } }))
	} catch (e) {
		slog.warn(s.ws, `Inventory fetch failed: ${(e as Error).message}`)
		s.ws.send(JSON.stringify({ t: S.INV_FOLDER, d: { folderId, items: [], error: (e as Error).message } }))
	}
}
