// server/handlers/mesh.ts — fetch a mesh asset and decode it to geometry arrays for the client.
// GET {ViewerAsset|GetMesh2|GetMesh}/?mesh_id={uuid} → parseMeshHeader → best LOD → decodeMeshLOD →
// flat arrays. Cap URLs stay server-side; the client gets clean JSON it turns into a BufferGeometry.
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseMeshHeader, decodeMeshLOD, pickLodRef } from '../lib/meshDecode'
import { createAssetMemo } from '../lib/assetMemo'
import { openAssetDiskCacheSafe, createDisabledAssetDiskCache, type AssetDiskCache, type AssetPayload } from '../lib/assetDiskCache'
import { S } from '../../shared/protocol.js'

// Tier-2 decoded-mesh cache + request coalescing (same rationale as assets.ts: retries used to
// refire the grid fetch AND the LOD decode). Keyed by `meshId:lod` — mesh bytes are global by UUID,
// and each LOD level decodes to its own submesh payload (see pickLodRef / the per-level fetch).
type MeshPayload = { submeshes: { positions: string; normals: string; uvs: string; indices: string }[] }
const MESH_MEMO_BUDGET = 256 * 1048576
let _meshLogN = 0
const meshMemo = createAssetMemo<MeshPayload>({
	budgetBytes: MESH_MEMO_BUDGET,
	sizeOf: v => v.submeshes.reduce((b, sm) => b + sm.positions.length + sm.normals.length + sm.uvs.length + sm.indices.length, 0),
})

// Tier-2 DISK cache for DECODED meshes (survives restart; shared across clients). The grid fetch +
// LOD decode then happens once EVER for an immutable-by-(uuid,lod) mesh, instead of every cold load /
// restart — this is the cold-throughput lever (mesh fetch ~16/s was the heavy-region settle ceiling).
// Its own sqlite file so the decoded-mesh working set doesn't evict textures (and vice versa); mirrors
// how meshMemo is separate from assetMemo. Env-tunable; disabled → no-op. Reuses the assets disk-cache
// engine (a generic size-bounded LRU blob store) via the serialize helpers below.
const MESH_DISK_CACHE_ON    = process.env.MESH_DISK_CACHE !== '0'
const MESH_DISK_CACHE_PATH  = process.env.MESH_DISK_CACHE_PATH  || '.cache/mesh.sqlite'
const MESH_DISK_CACHE_BYTES = Number(process.env.MESH_DISK_CACHE_BYTES) || 4 * 1024 * 1024 * 1024
const MESH_DISK_NEG_TTL_MS  = Number(process.env.MESH_DISK_NEG_TTL_MS) || 6 * 3600 * 1000
try { mkdirSync(dirname(MESH_DISK_CACHE_PATH), { recursive: true }) } catch { /* ignore */ }
const meshDisk: AssetDiskCache = MESH_DISK_CACHE_ON
	? openAssetDiskCacheSafe({ path: MESH_DISK_CACHE_PATH, capBytes: MESH_DISK_CACHE_BYTES, negTtlMs: MESH_DISK_NEG_TTL_MS })
	: createDisabledAssetDiskCache()
let _diskHits = 0, _diskMiss = 0, _memoStatTick = 0

// The disk store speaks AssetPayload {dataB64, mime}; a decoded mesh is JSON. Persist the same JSON we
// already hold in RAM (submesh fields are base64), one base64 wrap for the blob interface. NOTE: this
// keeps the base64 submeshes as text on disk (~33% larger than raw Float32/Uint16); acceptable for v1,
// a future pass could pack raw bytes to reclaim it. Pure + exported → unit-tested round-trip.
const MESH_DISK_MIME = 'application/x-qs-mesh-lod'
export function serializeMeshPayload(p: MeshPayload): AssetPayload {
	return { mime: MESH_DISK_MIME, dataB64: Buffer.from(JSON.stringify(p), 'utf8').toString('base64') }
}
export function deserializeMeshPayload(a: AssetPayload): MeshPayload {
	return JSON.parse(Buffer.from(a.dataB64, 'base64').toString('utf8')) as MeshPayload
}

export async function handleMeshFetch(circuitId: string, req: { meshId: string; lod?: number }): Promise<void> {
	const s = getSession(circuitId)
	if (!s) return
	const meshId = req?.meshId
	const wantLod = Math.max(0, Math.min(3, (req?.lod ?? 0) | 0))
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.MESH_DATA, d: { meshId, lod: wantLod, ...d } }))
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetMesh2') || s.caps.get('GetMesh')
	if (!cap || !meshId) { send({ error: 'cap_unavailable' }); return }
	try {
		const payload = await meshMemo.memo(`${meshId}:${wantLod}`, async () => {
			const key = `${meshId}:${wantLod}`
			// Tier-2: a previously fetched+decoded mesh answers from disk — no grid fetch, no LOD decode.
			const cached = meshDisk.get(key)
			if (cached) { _diskHits++; return deserializeMeshPayload(cached) }
			_diskMiss++
			// A recently-confirmed 404 short-circuits without re-spending a grid fetch.
			if (meshDisk.isNegative(key)) throw new Error('http_404')

			const res = await fetch(`${cap}/?mesh_id=${meshId}`, { headers: { Accept: 'application/vnd.ll.mesh' }, signal: AbortSignal.timeout(25_000) })
			if (!res.ok) {
				if (res.status === 404) meshDisk.putNegative(key)   // genuine missing asset (no range req here)
				throw new Error(`http_${res.status}`)
			}
			const buf = Buffer.from(await res.arrayBuffer())
			const h = parseMeshHeader(buf)
			const picked = pickLodRef(h.lods, wantLod)
			if (!picked) throw new Error('no_lod')
			const lod = picked.ref
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
			const result: MeshPayload = { submeshes }
			meshDisk.put(key, serializeMeshPayload(result))   // persist for every later client / visit / restart
			return result
		})
		if (!payload) { send({ error: 'unavailable' }); return }
		send(payload)
		if ((++_memoStatTick % 200) === 0) {
			const m = meshMemo.stats(), d = meshDisk.stats()
			slog.info(s.ws, `[MeshMemo] size=${m.size} MB=${(m.bytes / 1048576).toFixed(0)} hits=${m.hits} misses=${m.misses} inflight=${m.inflight} | disk hits=${_diskHits} miss=${_diskMiss} MB=${(d.bytes / 1048576).toFixed(0)} size=${d.size} evict=${d.evictions} neg=${d.negSize}`)
		}
	} catch (e) {
		send({ error: (e as Error).message })
	}
}
