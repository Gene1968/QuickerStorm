// src/composables/useMeshFetch.js — fetch decoded mesh submeshes by UUID (IndexedDB → server).
// Mirrors useTextureFetch's layered cache + dedupe + negative cache. Geometry arrives as base64
// typed-array blobs (compact); we rebuild Float32/Uint16 arrays. A concurrency cap avoids bursting
// hundreds of mesh requests at once (which stalled the sim circuit).
import { useRealtimeSocket } from './useRealtimeSocket'
import { meshCacheGet, meshCachePut } from '@/lib/meshCache.js'
import { C, S } from '@shared/protocol.js'

const FETCH_TIMEOUT_MS = 30_000
const MAX_INFLIGHT = 12       // concurrent network mesh fetches (was 6; 0 timeouts at 6 → headroom)
const mem = new Map()         // uuid → submeshes[] (typed arrays)
const inflight = new Map()    // uuid → Promise<submeshes|null>
const pending = new Map()     // uuid → resolve fn (awaiting S.MESH_DATA)
const failed = new Set()
const queue = []              // uuids waiting for a network slot
let active = 0
const stats = { requested: 0, done: 0, failed: 0, timeout: 0 }  // live counters (see getMeshStats)

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
	if (!resolve) return
	pending.delete(d.meshId)
	if (d.error || !d.submeshes) { stats.failed++; resolve(null); return }
	stats.done++
	const subs = d.submeshes.map(s => ({
		positions: b64ToTyped(s.positions, Float32Array),
		normals:   b64ToTyped(s.normals, Float32Array),
		uvs:       b64ToTyped(s.uvs, Float32Array),
		indices:   b64ToTyped(s.indices, Uint16Array),
	}))
	resolve(subs)
}

// Send one network request, respecting the in-flight cap; queue if full.
function _netFetch(uuid) {
	return new Promise(resolve => {
		const run = () => {
			active++
			const { emit } = useRealtimeSocket()
			const timer = setTimeout(() => { stats.timeout++; pending.delete(uuid); _done(); resolve(null) }, FETCH_TIMEOUT_MS)
			pending.set(uuid, v => { clearTimeout(timer); _done(); resolve(v) })
			emit(C.MESH_FETCH, { meshId: uuid })
		}
		if (active < MAX_INFLIGHT) run(); else queue.push(run)
	})
}
function _done() { active--; if (queue.length && active < MAX_INFLIGHT) queue.shift()() }

/** Live fetch counters (mesh). For watching steady population / confirming the cap holds. */
export function getMeshStats() {
	return { ...stats, inflight: active, queued: queue.length, cached: mem.size }
}

// Estimated JS-heap bytes held by the decoded-submesh cache (typed arrays per cached mesh asset).
export function getMeshBytes() {
	let b = 0
	for (const subs of mem.values()) {
		if (!Array.isArray(subs)) continue
		for (const s of subs) {
			b += (s.positions?.byteLength || 0) + (s.normals?.byteLength || 0) +
				(s.uvs?.byteLength || 0) + (s.indices?.byteLength || 0)
		}
	}
	return b
}

export function getMesh(uuid) {
	if (!uuid) return Promise.resolve(null)
	if (mem.has(uuid)) return Promise.resolve(mem.get(uuid))
	if (failed.has(uuid)) return Promise.resolve(null)
	if (inflight.has(uuid)) return inflight.get(uuid)
	_wire()
	stats.requested++
	const p = (async () => {
		const cached = await meshCacheGet(uuid)
		if (cached) { mem.set(uuid, cached); return cached }
		const net = await _netFetch(uuid)
		if (net) { mem.set(uuid, net); meshCachePut(uuid, net); return net }
		failed.add(uuid)
		return null
	})().then(r => { inflight.delete(uuid); return r })
	inflight.set(uuid, p)
	return p
}
