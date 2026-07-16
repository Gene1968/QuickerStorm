// server/handlers/assetUpload.ts — C.ASSET_UPLOAD → 2-step HTTP-cap upload → S.ASSET_UPLOAD_RESULT.
// WHY: the browser can't speak LLSD or hold cap URLs, so it sends {kind, mode, base64 bytes, itemId?} and
// Bun runs the two-POST handshake (lib/caps/assetUpload.ts). Mirrors the binary ASSET_FETCH pattern in the
// upload direction. Spec: docs/superpowers/specs/2026-07-15-asset-upload-notecard-script-design.md
import { getSession } from '../state/sessions'
import { updateItemAsset, uploadNewAsset } from '../lib/caps/assetUpload'
import { slog } from '../lib/serverLog'
import { S } from '../../shared/protocol.js'

// Cap name preference per kind for the UPDATE (save-into-existing-item) path. OpenSim registers the notecard
// cap as UpdateNotecardAgentInventory and the script cap under both UpdateScriptAgent (what FS sends) and the
// legacy UpdateScriptAgentInventory (BunchOfCaps.cs:234-256) — try each in order.
const UPDATE_CAPS: Record<string, string[]> = {
	notecard: ['UpdateNotecardAgentInventory'],
	script:   ['UpdateScriptAgent', 'UpdateScriptAgentInventory'],
}

type UploadMsg = {
	id: string
	mode: 'update' | 'new'
	kind: string
	dataB64: string
	itemId?: string                                   // update mode
	name?: string; description?: string; folderId?: string  // new mode
	assetTypeStr?: string; invTypeStr?: string              // new mode
}

export async function handleAssetUpload(circuitId: string, msg: UploadMsg): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const { id, mode, kind } = msg || ({} as UploadMsg)
	const reply = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.ASSET_UPLOAD_RESULT, d: { id, ...d } }))

	if (!id || !msg?.dataB64) { reply({ ok: false, error: 'bad_request' }); return }
	const bytes = Buffer.from(msg.dataB64, 'base64')

	// Resolve the cap URL. UPDATE → the kind-specific update cap (with fallbacks); NEW → NewFileAgentInventory.
	const capNames = mode === 'new' ? ['NewFileAgentInventory'] : (UPDATE_CAPS[kind] || [])
	const capName = capNames.find(n => s.caps.get(n))
	const capUrl = capName ? s.caps.get(capName) : undefined
	if (!capUrl) {
		slog.warn(s.ws, `[Upload] cap_unavailable (${mode}/${kind}) — have: ${[...s.caps.keys()].join(', ') || '(none)'}`)
		reply({ ok: false, error: 'cap_unavailable' })
		return
	}

	try {
		let res
		if (mode === 'update') {
			if (!msg.itemId) { reply({ ok: false, error: 'missing_itemId' }); return }
			res = await updateItemAsset(capUrl, { itemId: msg.itemId }, bytes)
		} else {
			if (!msg.folderId || !msg.assetTypeStr || !msg.invTypeStr) { reply({ ok: false, error: 'missing_new_meta' }); return }
			res = await uploadNewAsset(capUrl, {
				assetTypeStr: msg.assetTypeStr, invTypeStr: msg.invTypeStr,
				name: msg.name || 'New Item', description: msg.description, folderId: msg.folderId,
			}, bytes)
		}
		reply(res)
		slog.info(s.ws, `[Upload] ${mode}/${kind} ${bytes.length}B via ${capName} → ${res.ok ? `ok item=${(res.itemId || '').slice(0, 8)}…` : `FAIL ${res.error}`}`)
	} catch (e) {
		reply({ ok: false, error: (e as Error).message })
		slog.warn(s.ws, `[Upload] ${mode}/${kind} error: ${(e as Error).message}`)
	}
}
