// server/handlers/materials.ts — fetch prim materials over the cap layer.
//   pbr:    GET ViewerAsset/?material_id={uuid} → LLSD { data: <gltf json> } → raw GLTF JSON to client.
//   legacy: POST RenderMaterials cap with a zlib LLSD array of material IDs → zlib LLSD response →
//           flat normal/spec record per ID.
// Cap URLs + tokens stay server-side; the client gets clean JSON to map onto Three materials.
import { deflateSync, inflateSync } from 'zlib'
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseLLSD, llsdStr, llsdNum } from '../lib/llsd'
import { S } from '../../shared/protocol.js'

export async function handleMaterialFetch(circuitId: string, req: { kind: string; ids: string[] }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const ids = (req?.ids || []).filter(Boolean)
	if (!ids.length) return
	if (req.kind === 'pbr') return fetchPbr(s, ids)
	return fetchLegacy(s, ids)
}

async function fetchPbr(s: any, ids: string[]): Promise<void> {
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetTexture')
	const materials: Record<string, unknown> = {}
	if (cap) {
		for (const uuid of ids) {
			try {
				const res = await fetch(`${cap}/?material_id=${uuid}`, { signal: AbortSignal.timeout(20_000) })
				if (!res.ok) continue
				// LLSD wrapper { version, type:"GLTF 2.0", data:"<minified gltf json>" }.
				const wrap = parseLLSD(await res.text()) as Record<string, unknown> | null
				const json = wrap ? llsdStr((wrap as any).data) : ''
				if (json) materials[uuid] = JSON.parse(json)
			} catch (e) { slog.warn(s.ws, `[Mat] pbr ${uuid.slice(0, 8)} fail: ${(e as Error).message}`) }
		}
	}
	s.ws.send(JSON.stringify({ t: S.MATERIAL_DATA, d: { kind: 'pbr', materials } }))
}

// DEFERRED: our RenderMaterials request format is wrong — the cap returns an empty (0-byte) body,
// so inflate fails. Rather than thrash blind, legacy is disabled (returns empty, logs once) until
// the request/response zip format is captured from a real viewer and TDD'd. See materials-pbr spec.
// PBR (the cleaner GLTF path) is unaffected.
let _legacyLoggedFail = false
async function fetchLegacy(s: any, ids: string[]): Promise<void> {
	const cap = s.caps.get('RenderMaterials')
	const materials: Record<string, unknown> = {}
	if (cap) {
		try {
			const idsLlsd = `<?xml version="1.0"?><llsd><array>${ids
				.map(u => `<binary encoding="base16">${u.replace(/-/g, '')}</binary>`).join('')}</array></llsd>`
			const zipped = deflateSync(Buffer.from(idsLlsd))
			const body = `<?xml version="1.0"?><llsd><map><key>Zipped</key><binary encoding="base64">${zipped.toString('base64')}</binary></map></llsd>`
			const res = await fetch(cap, { method: 'POST', headers: { 'Content-Type': 'application/llsd+xml' }, body, signal: AbortSignal.timeout(20_000) })
			const top = parseLLSD(await res.text()) as Record<string, unknown> | null
			const zb = Buffer.from(llsdStr((top as any)?.Zipped).replace(/\s+/g, ''), 'base64')
			const arr = parseLLSD(inflateSync(zb).toString('utf8')) as any[] | null
			for (const entry of (Array.isArray(arr) ? arr : [])) {
				const id = llsdStr(entry?.ID)
				const M = entry?.Material ?? {}
				if (id) materials[id] = {
					normMap: llsdStr(M.NormMap), specMap: llsdStr(M.SpecMap), specExp: llsdNum(M.SpecExp),
					alphaMode: llsdNum(M.DiffuseAlphaMode), alphaCutoff: llsdNum(M.AlphaMaskCutoff),
				}
			}
		} catch (e) {
			if (!_legacyLoggedFail) { _legacyLoggedFail = true; slog.warn(s.ws, `[Mat] legacy disabled (request format TBD): ${(e as Error).message}`) }
		}
	}
	s.ws.send(JSON.stringify({ t: S.MATERIAL_DATA, d: { kind: 'legacy', materials } }))
}
