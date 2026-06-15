// src/composables/useMeshFetch.js — fetch decoded mesh submeshes by UUID (IndexedDB → server).
// Mirrors useTextureFetch's layered cache + dedupe + negative cache. Geometry arrives as base64
// typed-array blobs (compact); we rebuild Float32/Uint16 arrays. A concurrency cap avoids bursting
// hundreds of mesh requests at once (which stalled the sim circuit).
import { useRealtimeSocket } from './useRealtimeSocket'
import { meshCacheGet, meshCachePut } from '@/lib/meshCache.js'
import { createByteLRU } from '@/lib/byteLRU.js'
import { heapPush, heapPop } from '@/lib/priorityQueue.js'
import { C, S } from '@shared/protocol.js'

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
	const resolve = pending.get(d?.meshId)
	if (resolve) pending.delete(d.meshId)
	else if (!d?.meshId) return
	if (d.error || !d.submeshes) { stats.failed++; resolve?.(null); return }
	stats.done++
	const subs = d.submeshes.map(s => ({
		positions: b64ToTyped(s.positions, Float32Array),
		normals:   b64ToTyped(s.normals, Float32Array),
		uvs:       b64ToTyped(s.uvs, Float32Array),
		indices:   b64ToTyped(s.indices, Uint16Array),
	}))
	if (resolve) { resolve(subs); return }
	// Late arrival (request already timed out): keep the decode anyway — cache in RAM + IDB and
	// clear the failure mark so the next getMesh (cull stream-in re-bake, reload) succeeds without
	// refetching. Mesh timeouts have NO soft retry, so without this a single slow grid response
	// blanked that mesh for the whole session. Mirrors the texture-side late-arrival fix.
	stats.late++
	failed.delete(d.meshId)
	mem.set(d.meshId, subs)
	meshCachePut(d.meshId, subs)
}

// Send one network request, respecting the in-flight cap; queue (min-heap, nearest first) if full.
// priority = distance to the viewer (smaller = nearer = fetched sooner); Infinity for non-near callers.
function _netFetch(uuid, priority = Infinity) {
	return new Promise(resolve => {
		const run = async () => {
			active++
			// Late arrivals land in RAM/IDB while this request waits in the queue — settle from
			// cache when the slot opens instead of burning a 30s timeout (mirrors useTextureFetch).
			const cached = mem.has(uuid) ? mem.get(uuid) : await meshCacheGet(uuid).catch(() => null)
			if (cached) { _done(); resolve(cached); return }
			const { emit } = useRealtimeSocket()
			const timer = setTimeout(() => { stats.timeout++; pending.delete(uuid); _done(); resolve(null) }, FETCH_TIMEOUT_MS)
			pending.set(uuid, v => { clearTimeout(timer); _done(); resolve(v) })
			emit(C.MESH_FETCH, { meshId: uuid })
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

export function getMesh(uuid, priority = Infinity) {
	if (!uuid) return Promise.resolve(null)
	if (mem.has(uuid)) return Promise.resolve(mem.get(uuid))
	if (failed.has(uuid)) return Promise.resolve(null)
	if (inflight.has(uuid)) return inflight.get(uuid)
	_wire()
	stats.requested++
	const p = (async () => {
		const cached = await meshCacheGet(uuid)
		if (cached) { mem.set(uuid, cached); return cached }
		const net = await _netFetch(uuid, priority)
		if (net) { mem.set(uuid, net); meshCachePut(uuid, net); return net }
		failed.add(uuid)
		return null
	})().then(r => { inflight.delete(uuid); return r })
	inflight.set(uuid, p)
	return p
}
