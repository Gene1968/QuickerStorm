// server/handlers/materials.ts — fetch prim materials over the cap layer.
//   pbr:    GET ViewerAsset/?material_id={uuid} → LLSD { data: <gltf json> } → raw GLTF JSON to client.
//   legacy: POST RenderMaterials cap with a zlib LLSD array of material IDs → zlib LLSD response →
//           flat normal/spec record per ID.
// Cap URLs + tokens stay server-side; the client gets clean JSON to map onto Three materials.
import { deflateSync, inflateSync } from 'zlib'
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseLLSD, parseLLSDBinary, encodeLLSDBinaryUuidArray, uuidFromBytes, llsdStr, llsdNum } from '../lib/llsd'
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

// RenderMaterials wire format (root-caused from OpenSim MaterialsModule.cs RenderMaterialsPostCap):
// BOTH directions wrap a zlib blob in LLSD-XML { Zipped: <binary> }, but the zipped payload itself
// is LLSD *BINARY*, not XML — request: array of 16-byte binary material IDs (read via
// `new UUID(elem.AsBinary(), 0)`); response: array of { ID: binary16, Material: map } (see
// FaceMaterial.toOSD in SOPMaterial.cs). Our old request zipped LLSD-XML → the sim's
// DeserializeLLSDBinary threw → BadRequest/empty body, which is why legacy was disabled.

/** Build the RenderMaterials POST body for a list of material UUIDs. Pure for tests. */
export function buildRenderMaterialsPostBody(ids: string[]): string {
	const zipped = deflateSync(encodeLLSDBinaryUuidArray(ids))
	return `<?xml version="1.0"?><llsd><map><key>Zipped</key><binary encoding="base64">${zipped.toString('base64')}</binary></map></llsd>`
}

/** Decode a RenderMaterials response into uuid → flat legacy material record. Pure for tests. */
export function decodeRenderMaterialsResponse(xml: string): Record<string, unknown> {
	const materials: Record<string, unknown> = {}
	const top = parseLLSD(xml) as Record<string, unknown> | null
	const b64 = llsdStr((top as any)?.Zipped).replace(/\s+/g, '')
	if (!b64) return materials
	const arr = parseLLSDBinary(inflateSync(Buffer.from(b64, 'base64'))).value
	for (const entry of (Array.isArray(arr) ? arr : [])) {
		const rawId = entry?.ID
		const id = Buffer.isBuffer(rawId) ? uuidFromBytes(rawId) : llsdStr(rawId)
		const M = entry?.Material ?? {}
		if (!id) continue
		materials[id] = {
			normMap: llsdStr(M.NormMap), specMap: llsdStr(M.SpecMap), specExp: llsdNum(M.SpecExp),
			envIntensity: llsdNum(M.EnvIntensity),
			alphaMode: llsdNum(M.DiffuseAlphaMode), alphaCutoff: llsdNum(M.AlphaMaskCutoff),
		}
	}
	return materials
}

async function fetchLegacy(s: any, ids: string[]): Promise<void> {
	const cap = s.caps.get('RenderMaterials')
	let materials: Record<string, unknown> = {}
	if (cap) {
		try {
			const res = await fetch(cap, {
				method: 'POST',
				headers: { 'Content-Type': 'application/llsd+xml' },
				body: buildRenderMaterialsPostBody(ids),
				signal: AbortSignal.timeout(20_000),
			})
			if (!res.ok) throw new Error(`http_${res.status}`)
			materials = decodeRenderMaterialsResponse(await res.text())
			slog.info(s.ws, `[Mat] legacy ${ids.length} requested → ${Object.keys(materials).length} returned`)
		} catch (e) {
			slog.warn(s.ws, `[Mat] legacy fetch failed (${ids.length} ids): ${(e as Error).message}`)
		}
	}
	s.ws.send(JSON.stringify({ t: S.MATERIAL_DATA, d: { kind: 'legacy', materials } }))
}
