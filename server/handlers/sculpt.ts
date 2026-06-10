// server/handlers/sculpt.ts — fetch a legacy sculpt-map texture and decode it to sculpt geometry.
// The sculpt map is a J2C texture (ViewerAsset/GetTexture cap, ?texture_id=). We decode it to raw
// RGB pixels (NOT through the sRGB display path — the bytes are position data, not colour) and run
// the libomv SculptMesh algorithm → one submesh, base64-encoded in the same shape as MESH_DATA so
// the client builds it through the identical BufferGeometry path.
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { decodeJ2C } from '../lib/j2c'
import { sculptToSubmesh } from '../lib/sculptDecode'
import { S } from '../../shared/protocol.js'

export async function handleSculptFetch(circuitId: string, req: { sculptId: string; sculptType: number }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const sculptId = req?.sculptId
	const sculptType = req?.sculptType ?? 1
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.SCULPT_DATA, d: { sculptId, sculptType, ...d } }))
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetTexture')
	if (!cap || !sculptId) { send({ error: 'cap_unavailable' }); return }
	try {
		const res = await fetch(`${cap}/?texture_id=${sculptId}`, { headers: { Accept: 'image/x-j2c' }, signal: AbortSignal.timeout(25_000) })
		if (!res.ok) { send({ error: `http_${res.status}` }); return }
		const raw = Buffer.from(await res.arrayBuffer())
		const img = await decodeJ2C(raw)   // raw pixels, no PNG/sRGB transform
		const sm = sculptToSubmesh(img.pixels, img.width, img.height, img.channels, sculptType)
		const b64 = (ta: Float32Array | Uint16Array) =>
			Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64')
		send({ submeshes: [{ positions: b64(sm.positions), normals: b64(sm.normals), uvs: b64(sm.uvs), indices: b64(sm.indices) }] })
		slog.info(s.ws, `[Sculpt] ${sculptId.slice(0, 8)}… type=${sculptType & 0x07} ${img.width}×${img.height} → ${sm.positions.length / 3} verts`)
	} catch (e) {
		send({ error: (e as Error).message })
	}
}
