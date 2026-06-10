// server/handlers/mesh.ts — fetch a mesh asset and decode it to geometry arrays for the client.
// GET {ViewerAsset|GetMesh2|GetMesh}/?mesh_id={uuid} → parseMeshHeader → best LOD → decodeMeshLOD →
// flat arrays. Cap URLs stay server-side; the client gets clean JSON it turns into a BufferGeometry.
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseMeshHeader, decodeMeshLOD } from '../lib/meshDecode'
import { S } from '../../shared/protocol.js'

export async function handleMeshFetch(circuitId: string, req: { meshId: string }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const meshId = req?.meshId
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.MESH_DATA, d: { meshId, ...d } }))
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetMesh2') || s.caps.get('GetMesh')
	if (!cap || !meshId) { send({ error: 'cap_unavailable' }); return }
	try {
		const res = await fetch(`${cap}/?mesh_id=${meshId}`, { headers: { Accept: 'application/vnd.ll.mesh' }, signal: AbortSignal.timeout(25_000) })
		if (!res.ok) { send({ error: `http_${res.status}` }); return }
		const buf = Buffer.from(await res.arrayBuffer())
		const h = parseMeshHeader(buf)
		const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
		if (!lod) { send({ error: 'no_lod' }); return }
		// WHY base64 typed arrays (not number[]): a high-LOD mesh has tens of thousands of floats;
		// JSON number[] is ~3× larger and JSON.stringify of huge arrays blocks the event loop long
		// enough to stall AgentUpdate → sim drops the circuit ("no response 65s"). base64 of the raw
		// bytes is compact and cheap to stringify.
		const b64 = (ta: Float32Array | Uint16Array) =>
			Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength).toString('base64')
		const submeshes = decodeMeshLOD(buf, h.headerSize, lod).map(sm => ({
			positions: b64(sm.positions),   // Float32
			normals:   b64(sm.normals),     // Float32
			uvs:       b64(sm.uvs),         // Float32
			indices:   b64(sm.indices),     // Uint16
		}))
		send({ submeshes })
		slog.info(s.ws, `[Mesh] ${meshId.slice(0, 8)}… ${buf.length}B → ${submeshes.length} submesh(es)`)
	} catch (e) {
		send({ error: (e as Error).message })
	}
}
