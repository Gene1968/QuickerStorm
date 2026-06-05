// server/handlers/assets.ts — asset fetch over the HTTP cap layer (ViewerAsset / GetTexture / GetMesh).
// WHY: SL/OpenSim serve textures, mesh, sounds, etc. as binary assets by UUID. ViewerAsset is the
// unified cap; type-specific caps are fallbacks. Textures come back as J2C (image/x-j2c) which the
// browser can't decode, so we transcode to PNG server-side (see lib/j2c.ts). Cap URLs + tokens stay
// on the server; the browser gets clean base64. Shapes from caps-feature-map cluster A.
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { j2cToPngWithAlpha } from '../lib/j2c'
import { S } from '../../shared/protocol.js'

export interface AssetRequestSpec {
	capNames: string[]      // cap names to try, in preference order
	queryKey: string        // the `?<key>=<uuid>` query parameter
	accept: string          // Accept header
	transcodeToPng: boolean // true → decode J2C and re-encode PNG before sending
	mime: string            // Content-Type sent to the browser (post-transcode for textures)
}

// WHY pure + exported: the query-key/cap-name mapping is the detail that silently 404s when wrong.
// Unit-tested in __tests__/assets.test.ts.
export function assetRequestSpec(assetType: string): AssetRequestSpec | null {
	switch (assetType) {
		case 'texture':
			return { capNames: ['ViewerAsset', 'GetTexture'], queryKey: 'texture_id', accept: 'image/x-j2c', transcodeToPng: true, mime: 'image/png' }
		case 'mesh':
			return { capNames: ['ViewerAsset', 'GetMesh2', 'GetMesh'], queryKey: 'mesh_id', accept: 'application/vnd.ll.mesh', transcodeToPng: false, mime: 'application/vnd.ll.mesh' }
		case 'sound':
			return { capNames: ['ViewerAsset'], queryKey: 'sound_id', accept: 'audio/ogg', transcodeToPng: false, mime: 'audio/ogg' }
		case 'animation':
			return { capNames: ['ViewerAsset'], queryKey: 'animatn_id', accept: 'application/vnd.ll.animation', transcodeToPng: false, mime: 'application/vnd.ll.animation' }
		default:
			return null
	}
}

export async function handleAssetFetch(circuitId: string, req: { assetType: string; uuid: string }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const { assetType, uuid } = req || ({} as any)
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.ASSET_DATA, d: { uuid, assetType, ...d } }))

	const spec = assetRequestSpec(assetType)
	if (!spec || !uuid) { send({ error: 'bad_request' }); return }

	const capName = spec.capNames.find(n => s.caps.get(n))
	const capBase = capName ? s.caps.get(capName) : undefined
	if (!capBase) {
		slog.warn(s.ws, `[Asset] cap_unavailable for ${assetType} — have: ${[...s.caps.keys()].join(', ') || '(none)'}`)
		send({ error: 'cap_unavailable' })
		return
	}

	const url = `${capBase}/?${spec.queryKey}=${uuid}`
	try {
		const res = await fetch(url, { headers: { Accept: spec.accept }, signal: AbortSignal.timeout(25_000) })
		// WHY: OpenSim returns 404 (not 416) when a speculative range overshoots; here we make no
		// range request, so a 404 is a genuine missing asset.
		if (!res.ok) { send({ error: `http_${res.status}` }); return }
		const raw = Buffer.from(await res.arrayBuffer())

		let out: Buffer, hasAlpha = false
		if (spec.transcodeToPng) { const r = await j2cToPngWithAlpha(raw); out = r.png; hasAlpha = r.hasAlpha }
		else out = raw
		send({
			mime: spec.transcodeToPng ? spec.mime : (res.headers.get('content-type') || spec.mime),
			dataB64: out.toString('base64'),
			...(spec.transcodeToPng ? { hasAlpha } : {}),
		})
		slog.info(s.ws, `[Asset] ${assetType} ${uuid.slice(0, 8)}… via ${capName} (${raw.length}B${spec.transcodeToPng ? ` → ${out.length}B png` : ''})`)
	} catch (e) {
		slog.warn(s.ws, `[Asset] fetch failed ${assetType} ${uuid.slice(0, 8)}…: ${(e as Error).message}`)
		send({ error: (e as Error).message })
	}
}
