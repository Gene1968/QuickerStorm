// server/lib/caps/assetUpload.ts — the reusable 2-step HTTP-cap asset uploader.
// WHY: SL/OpenSim upload an asset in TWO POSTs (BunchOfCaps.cs / UpdateItemAsset.cs, mirrored by Firestorm
// llviewerassetupload.cpp AssetInventoryUploadCoproc): (1) POST an LLSD envelope to the cap → sim returns a
// one-time `uploader` URL; (2) POST the raw asset bytes to that URL → sim returns {new_asset,
// new_inventory_item, state:"complete"}. Bun performs BOTH POSTs, so the sim's step-1↔step-2 same-IP check
// (UpdateItemAsset.cs:298) is satisfied. Uploads are free on stock OpenSim (SampleMoneyModule.UploadCharge=0);
// expected_upload_cost is sent for wire-compat but ignored server-side. LLSD stays here — the browser never
// sees it (it sends base64 bytes + plain fields; see handlers/assetUpload.ts).
// Spec: docs/superpowers/specs/2026-07-15-asset-upload-notecard-script-design.md
import { parseLLSD, llsdStr } from '../llsd'
import { encodeLLSD, llsd } from './llsdEncode'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const LLSD_HEADERS = { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' }

export type UploadResult = { ok: boolean; assetId?: string; itemId?: string; error?: string }
export type FetchFn = typeof fetch

// Step 1: POST an LLSD body → parse the one-time uploader URL. Returns the URL or throws with the sim's
// error message. `state` must be "upload"; anything else (typically "error" with an {error:{message}} block)
// is a rejection we surface verbatim.
async function requestUploader(capUrl: string, reqValue: Record<string, unknown>, fetchFn: FetchFn): Promise<string> {
	const res = await fetchFn(capUrl, {
		method: 'POST', headers: LLSD_HEADERS, body: encodeLLSD(reqValue),
		signal: AbortSignal.timeout(30_000),
	})
	const parsed = parseLLSD(await res.text()) as Record<string, any>
	const state = llsdStr(parsed?.state)
	const uploader = llsdStr(parsed?.uploader)
	if (state !== 'upload' || !uploader) {
		const msg = llsdStr(parsed?.error?.message) || `bad step-1 state "${state}" (HTTP ${res.status})`
		throw new Error(msg)
	}
	return uploader
}

// Step 2: POST the raw bytes to the uploader URL → parse {new_asset, new_inventory_item, state:"complete"}.
async function postBytes(uploader: string, bytes: Buffer, fetchFn: FetchFn): Promise<UploadResult> {
	const res = await fetchFn(uploader, {
		method: 'POST',
		headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/llsd+xml' },
		body: bytes,
		signal: AbortSignal.timeout(60_000),
	})
	const parsed = parseLLSD(await res.text()) as Record<string, any>
	const state = llsdStr(parsed?.state)
	if (state !== 'complete') {
		const msg = llsdStr(parsed?.error?.message) || `upload state "${state}" (HTTP ${res.status})`
		return { ok: false, error: msg }
	}
	return { ok: true, assetId: llsdStr(parsed?.new_asset), itemId: llsdStr(parsed?.new_inventory_item) }
}

// Save `bytes` into an EXISTING agent-inventory item via UpdateNotecard/ScriptAgentInventory (the caller
// picks the cap URL by kind). Step-1 body is just {item_id, task_id:zero} (agent inventory; task_id would be
// a prim UUID for in-object items — not supported v1).
export async function updateItemAsset(
	capUrl: string, p: { itemId: string }, bytes: Buffer, fetchFn: FetchFn = fetch,
): Promise<UploadResult> {
	try {
		const uploader = await requestUploader(capUrl, {
			item_id: llsd.uuid(p.itemId), task_id: llsd.uuid(ZERO_UUID),
		}, fetchFn)
		return await postBytes(uploader, bytes, fetchFn)
	} catch (e) {
		return { ok: false, error: (e as Error).message }
	}
}

// Upload `bytes` as a BRAND-NEW asset + inventory item via NewFileAgentInventory. (v1 has no call site —
// notecard/script use create-blank-then-updateItemAsset — but this is the framework other uploads
// (sound/texture/bake) build on.)
export async function uploadNewAsset(
	capUrl: string,
	p: {
		assetTypeStr: string; invTypeStr: string; name: string; description?: string; folderId: string
		nextOwnerMask?: number; groupMask?: number; everyoneMask?: number; expectedCost?: number
	},
	bytes: Buffer, fetchFn: FetchFn = fetch,
): Promise<UploadResult> {
	try {
		const uploader = await requestUploader(capUrl, {
			folder_id: llsd.uuid(p.folderId),
			asset_type: p.assetTypeStr,
			inventory_type: p.invTypeStr,
			name: p.name,
			description: p.description || '',
			next_owner_mask: llsd.int(p.nextOwnerMask ?? 0x7FFFFFFF),
			group_mask: llsd.int(p.groupMask ?? 0),
			everyone_mask: llsd.int(p.everyoneMask ?? 0),
			expected_upload_cost: llsd.int(p.expectedCost ?? 0),
		}, fetchFn)
		return await postBytes(uploader, bytes, fetchFn)
	} catch (e) {
		return { ok: false, error: (e as Error).message }
	}
}
