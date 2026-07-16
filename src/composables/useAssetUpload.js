// src/composables/useAssetUpload.js — client side of the asset-upload framework (notecard/script v1).
// The browser never touches LLSD or cap URLs (useCaps.js convention): it sends plain fields + base64 bytes,
// Bun runs the 2-step HTTP-cap handshake (server/handlers/assetUpload.ts). Two operations here:
//   • saveAsset      → serialize text (assetSerialize) → C.ASSET_UPLOAD (update cap) → S.ASSET_UPLOAD_RESULT
//   • fetchAssetText → C.ASSET_FETCH (notecard_id/lsltext_id) → S.ASSET_DATA → strip envelope → text
// Correlation is by a per-request id (upload) or oldest-matching uuid+type (fetch); handlers are wired once
// at module scope (keyed, HMR-safe). Spec: docs/superpowers/specs/2026-07-15-asset-upload-notecard-script-design.md
import { useRealtimeSocket } from './useRealtimeSocket'
import { C, S } from '@shared/protocol.js'
import { notecardToAsset, scriptToAsset, notecardFromAsset, scriptFromAsset } from '@/lib/assetSerialize'

const UPLOAD_TIMEOUT_MS = 60_000
const FETCH_TIMEOUT_MS  = 30_000

let _wired = false
let _seq = 0
const _uploads = new Map()   // id  → { resolve }
const _fetches = new Map()   // rid → { uuid, assetType, resolve }

// utf8 ⇄ base64 (btoa is latin1-only, so round-trip through TextEncoder/Decoder for multi-byte safety).
function utf8ToB64(str) {
	const bytes = new TextEncoder().encode(str)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin)
}
function b64ToUtf8(b64) {
	const bin = atob(b64)
	const arr = Uint8Array.from(bin, c => c.charCodeAt(0))
	return new TextDecoder().decode(arr)
}

function ensureWired() {
	if (_wired) return
	const { on } = useRealtimeSocket()
	on(S.ASSET_UPLOAD_RESULT, (d) => {
		const p = _uploads.get(d?.id)
		if (!p) return
		_uploads.delete(d.id)
		p.resolve(d)
	}, 'asset-upload-result')
	// S.ASSET_DATA is shared with the texture pipeline — only claim notecard/lsltext replies, and only if
	// WE have a pending fetch for that uuid+type (texture floaters handle their own via getTextureUrl).
	on(S.ASSET_DATA, (d) => {
		if (d?.assetType !== 'notecard' && d?.assetType !== 'lsltext') return
		for (const [rid, f] of _fetches) {
			if (f.uuid === d.uuid && f.assetType === d.assetType) {
				_fetches.delete(rid)
				f.resolve(d)
				break
			}
		}
	}, 'asset-text-fetch')
	_wired = true
}

export function useAssetUpload() {
	const { emit } = useRealtimeSocket()
	ensureWired()

	// Save `text` into an existing notecard/script item via UpdateNotecard/ScriptAgentInventory.
	// Resolves { ok, assetId?, itemId?, error? }.
	function saveAsset({ kind, itemId, text }) {
		if (!itemId) return Promise.resolve({ ok: false, error: 'missing_itemId' })
		const assetStr = kind === 'script' ? scriptToAsset(text || '') : notecardToAsset(text || '')
		const dataB64 = utf8ToB64(assetStr)
		const id = `up-${++_seq}`
		return new Promise((resolve) => {
			_uploads.set(id, { resolve })
			emit(C.ASSET_UPLOAD, { id, mode: 'update', kind, itemId, dataB64 })
			setTimeout(() => {
				if (_uploads.has(id)) { _uploads.delete(id); resolve({ ok: false, error: 'timeout' }) }
			}, UPLOAD_TIMEOUT_MS)
		})
	}

	// Fetch + decode the text of an existing notecard/script asset. Resolves { text, error? }.
	function fetchAssetText({ kind, assetId }) {
		if (!assetId) return Promise.resolve({ text: '', error: 'missing_assetId' })
		const assetType = kind === 'script' ? 'lsltext' : 'notecard'
		const rid = `af-${++_seq}`
		return new Promise((resolve) => {
			_fetches.set(rid, { uuid: assetId, assetType, resolve })
			emit(C.ASSET_FETCH, { assetType, uuid: assetId })
			setTimeout(() => {
				if (_fetches.has(rid)) { _fetches.delete(rid); resolve({ error: 'timeout' }) }
			}, FETCH_TIMEOUT_MS)
		}).then((d) => {
			if (!d || d.error || !d.dataB64) return { text: '', error: d?.error || 'no_data' }
			const raw = b64ToUtf8(d.dataB64)
			return { text: kind === 'script' ? scriptFromAsset(raw) : notecardFromAsset(raw) }
		})
	}

	return { saveAsset, fetchAssetText }
}
