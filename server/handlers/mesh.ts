// server/handlers/mesh.ts — fetch a mesh asset and decode it to geometry arrays for the client.
// GET {ViewerAsset|GetMesh2|GetMesh}/?mesh_id={uuid} → parseMeshHeader → best LOD → decodeMeshLOD →
// flat arrays. Cap URLs stay server-side; the client gets clean JSON it turns into a BufferGeometry.
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseMeshHeader, decodeMeshLOD } from '../lib/meshDecode'
import { createAssetMemo } from '../lib/assetMemo'
import { S } from '../../shared/protocol.js'

// Tier-2 decoded-mesh cache + request coalescing (same rationale as assets.ts: retries used to
// refire the grid fetch AND the LOD decode). Keyed by meshId — mesh bytes are global by UUID.
type MeshPayload = { submeshes: { positions: string; normals: string; uvs: string; indices: string }[] }
const MESH_MEMO_BUDGET = 256 * 1048576
let _meshLogN = 0
const meshMemo = createAssetMemo<MeshPayload>({
	budgetBytes: MESH_MEMO_BUDGET,
	sizeOf: v => v.submeshes.reduce((b, sm) => b + sm.positions.length + sm.normals.length + sm.uvs.length + sm.indices.length, 0),
})

export async function handleMeshFetch(circuitId: string, req: { meshId: string }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const meshId = req?.meshId
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.MESH_DATA, d: { meshId, ...d } }))
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetMesh2') || s.caps.get('GetMesh')
	if (!cap || !meshId) { send({ error: 'cap_unavailable' }); return }
	try {
		const payload = await meshMemo.memo(meshId, async () => {
			const res = await fetch(`${cap}/?mesh_id=${meshId}`, { headers: { Accept: 'application/vnd.ll.mesh' }, signal: AbortSignal.timeout(25_000) })
			if (!res.ok) throw new Error(`http_${res.status}`)
			const buf = Buffer.from(await res.arrayBuffer())
			const h = parseMeshHeader(buf)
			const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
			if (!lod) throw new Error('no_lod')
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
			if (++_meshLogN <= 10 || _meshLogN % 25 === 0) {
				slog.info(s.ws, `[Mesh] #${_meshLogN} ${meshId.slice(0, 8)}… ${buf.length}B → ${submeshes.length} submesh(es)`)
			}
			return { submeshes }
		})
		if (!payload) { send({ error: 'unavailable' }); return }
		send(payload)
	} catch (e) {
		send({ error: (e as Error).message })
	}
}
