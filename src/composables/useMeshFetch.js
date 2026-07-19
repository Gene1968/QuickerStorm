// src/composables/useMeshFetch.js — fetch decoded mesh submeshes by UUID (IndexedDB → server).
// Mirrors useTextureFetch's layered cache + dedupe + negative cache. Geometry arrives as base64
// typed-array blobs (compact); we rebuild Float32/Uint16 arrays. A concurrency cap avoids bursting
// hundreds of mesh requests at once (which stalled the sim circuit).
import { useRealtimeSocket } from './useRealtimeSocket'
import { meshCacheGet, meshCachePut } from '@/lib/meshCache.js'
import { createByteLRU } from '@/lib/byteLRU.js'
import { heapPush, heapPop } from '@/lib/priorityQueue.js'
import { C, S } from '@shared/protocol.js'

// Cache/dedup key per LOD level — the IDB store keyPath is an opaque string, so "uuid:lod" just works.
// CRITICAL: lod 0 (high) keeps the BARE uuid so pre-LOD warm qs-mesh entries (keyed by uuid = the
// high decode) still hit — else every mesh re-downloads from the grid on a warm region (cube storm).
// 7·D: a rigged worn attachment (skin=true) gets RAW bind-space geometry + per-vertex joint
// indices/weights + the rig block from the server — different bytes from the same asset's plain
// decode, so it lives under a separate `:skin` cache lane. `:skin3` = runtime-skinning payload
// (`:skin2` was the AV-1 server rest-pose bake; stale entries just miss and refetch once).
const mkKey = (uuid, lod, skin = false) => `${lod === 0 ? uuid : `${uuid}:${lod}`}${skin ? ':skin3' : ''}`

const FETCH_TIMEOUT_MS = 30_000
const MAX_INFLIGHT = 12       // concurrent network mesh fetches (was 6; 0 timeouts at 6 → headroom)
// WHY bounded: unbounded, this cache hit ~1.1GB on a 24k-object region and pinned the heap above
// the cull/governor thresholds permanently (the busy-region death-spiral root cause). IDB holds
// every mesh durably, so RAM is just the hot tier — an evicted asset costs one IDB re-read.
const MESH_MEM_BUDGET = 256 * 1048576
const _subsBytes = (subs) => {
	if (!Array.isArray(subs)) return 0
	let b = 0
	for (const s of subs) {
		b += (s.positions?.byteLength || 0) + (s.normals?.byteLength || 0) +
			(s.uvs?.byteLength || 0) + (s.indices?.byteLength || 0)
	}
	return b
}
const mem = createByteLRU({ budgetBytes: MESH_MEM_BUDGET, sizeOf: _subsBytes })  // uuid → submeshes[]
const inflight = new Map()    // uuid → Promise<submeshes|null>
const pending = new Map()     // uuid → resolve fn (awaiting S.MESH_DATA)
const failed = new Set()
const queue = []              // uuids waiting for a network slot
let active = 0
const stats = { requested: 0, done: 0, failed: 0, timeout: 0, late: 0 }  // live counters (see getMeshStats)

let _wired = false
function _wire() { if (_wired) return; _wired = true; useRealtimeSocket().on(S.MESH_DATA, _on) }

function b64ToTyped(s, Type) {
	const bin = atob(s)
	const u8 = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
	return new Type(u8.buffer)
}

function _on(d) {
	// wantSkin echo selects the cache lane so a `:skin` request resolves its own pending entry.
	const key = d?.meshId != null ? mkKey(d.meshId, d.lod ?? 0, !!d.wantSkin) : null
	const resolve = key ? pending.get(key) : null
	if (resolve) pending.delete(key)
	else if (!d?.meshId) return
	if (d.error || !d.submeshes) { stats.failed++; resolve?.(null); return }
	stats.done++
	const subs = d.submeshes.map(s => ({
		positions: b64ToTyped(s.positions, Float32Array),
		normals:   b64ToTyped(s.normals, Float32Array),
		uvs:       b64ToTyped(s.uvs, Float32Array),
		indices:   b64ToTyped(s.indices, Uint16Array),
		// 7·D rig attributes (skin lane only): 4 influences per vertex, index into skin.jointNames.
		...(s.jointIndices ? { jointIndices: b64ToTyped(s.jointIndices, Uint8Array) } : {}),
		...(s.jointWeights ? { jointWeights: b64ToTyped(s.jointWeights, Float32Array) } : {}),
	}))
	// 7·D: skin block present → geometry is RAW bind-space; the render path builds a SkinnedMesh
	// bound to the live SL skeleton. Rides as a prop on the subs array; persisted by meshCache (below).
	if (d.skin) subs.skin = d.skin
	if (d.skinDbg) subs.skinDbg = d.skinDbg   // diagnostic (no-key | decode-null | ok | rig)
	if (resolve) { resolve(subs); return }
	// Late arrival (request already timed out): cache under the composite key + clear the failure mark.
	stats.late++
	failed.delete(key)
	mem.set(key, subs)
	meshCachePut(key, subs)
}

// Send one network request, respecting the in-flight cap; queue (min-heap, nearest first) if full.
// priority = distance to the viewer (smaller = nearer = fetched sooner); Infinity for non-near callers.
function _netFetch(uuid, lod, priority = Infinity, ensureSkin = false) {
	const key = mkKey(uuid, lod, ensureSkin)   // `:skin` lane keeps skinned geometry separate from plain
	return new Promise(resolve => {
		const run = async () => {
			active++
			const cached = mem.has(key) ? mem.get(key) : await meshCacheGet(key).catch(() => null)
			if (cached) { _done(); resolve(cached); return }
			const { emit } = useRealtimeSocket()
			const timer = setTimeout(() => { stats.timeout++; pending.delete(key); _done(); resolve(null) }, FETCH_TIMEOUT_MS)
			pending.set(key, v => { clearTimeout(timer); _done(); resolve(v) })
			// AV-1: wantSkin tells the server to bake REST-POSE skinned geometry (own `:skinv2` cache key).
			// Only worn attachments set it (ensureSkin); the server echoes it back so _on picks this lane.
			emit(C.MESH_FETCH, { meshId: uuid, lod, wantSkin: ensureSkin })
		}
		if (active < MAX_INFLIGHT) run(); else heapPush(queue, { run, priority })
	})
}
function _done() { active--; if (queue.length && active < MAX_INFLIGHT) heapPop(queue).run() }

/** Live fetch counters (mesh). For watching steady population / confirming the cap holds. */
export function getMeshStats() {
	return { ...stats, inflight: active, queued: queue.length, cached: mem.size(), lruEvicted: mem.evictions() }
}

// JS-heap bytes held by the decoded-submesh cache. O(1): the LRU keeps a running total.
export function getMeshBytes() {
	return mem.bytes()
}

// ensureSkin (AV-1): callers rendering a worn attachment pass true → the fetch uses the `:skin` cache
// lane and asks the server for REST-POSE skinned geometry. Scoped to worn attachments, so the plain
// mesh cache (used by rezzed meshes / linked prims) is untouched — only the handful of worn meshes
// populate the `:skin` lane. The lane suffix keeps skinned and plain geometry from ever colliding.
export function getMesh(uuid, lod = 0, priority = Infinity, ensureSkin = false) {
	if (!uuid) return Promise.resolve(null)
	const key = mkKey(uuid, lod, ensureSkin)
	if (mem.has(key)) return Promise.resolve(mem.get(key))
	if (failed.has(key)) return Promise.resolve(null)
	if (inflight.has(key)) return inflight.get(key)
	_wire()
	stats.requested++
	const p = (async () => {
		const cached = await meshCacheGet(key)
		if (cached) { mem.set(key, cached); return cached }
		const net = await _netFetch(uuid, lod, priority, ensureSkin)
		if (net) { mem.set(key, net); meshCachePut(key, net); return net }
		failed.add(key)
		return null
	})().then(r => { inflight.delete(key); return r })
	inflight.set(key, p)
	return p
}
