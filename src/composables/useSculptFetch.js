// src/composables/useSculptFetch.js — fetch decoded sculpt geometry by (sculptId, sculptType).
// Mirrors useMeshFetch: the server fetches the sculpt-map J2C, runs the sculpt algorithm, and returns
// one submesh as base64 typed arrays. Keyed by sculptId+type (same map can be rezzed as different
// sculpt types). Concurrency-capped + negative cache like the other asset fetchers.
import { useRealtimeSocket } from './useRealtimeSocket'
import { heapPush, heapPop } from '@/lib/priorityQueue.js'
import { C, S } from '@shared/protocol.js'

const FETCH_TIMEOUT_MS = 30_000
const MAX_INFLIGHT = 12
const mem = new Map()         // key → submeshes[] (typed arrays)
const inflight = new Map()    // key → Promise<submeshes|null>
const pending = new Map()     // key → resolve fn (awaiting S.SCULPT_DATA)
const failed = new Set()
const queue = []
let active = 0

const keyOf = (id, type) => `${id}:${type & 0x07}`

let _wired = false
function _wire() { if (_wired) return; _wired = true; useRealtimeSocket().on(S.SCULPT_DATA, _on) }

function b64ToTyped(s, Type) {
	const bin = atob(s)
	const u8 = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
	return new Type(u8.buffer)
}

function _on(d) {
	const key = keyOf(d?.sculptId, d?.sculptType ?? 0)
	const resolve = pending.get(key)
	if (!resolve) return
	pending.delete(key)
	if (d.error || !d.submeshes) { resolve(null); return }
	const subs = d.submeshes.map(s => ({
		positions: b64ToTyped(s.positions, Float32Array),
		normals:   b64ToTyped(s.normals, Float32Array),
		uvs:       b64ToTyped(s.uvs, Float32Array),
		indices:   b64ToTyped(s.indices, Uint16Array),
	}))
	resolve(subs)
}

// priority = distance to the viewer (smaller = nearer = fetched sooner); queue is a min-heap.
function _netFetch(sculptId, sculptType, priority = Infinity) {
	const key = keyOf(sculptId, sculptType)
	return new Promise(resolve => {
		const run = () => {
			active++
			const { emit } = useRealtimeSocket()
			const timer = setTimeout(() => { pending.delete(key); _done(); resolve(null) }, FETCH_TIMEOUT_MS)
			pending.set(key, v => { clearTimeout(timer); _done(); resolve(v) })
			emit(C.SCULPT_FETCH, { sculptId, sculptType })
		}
		if (active < MAX_INFLIGHT) run(); else heapPush(queue, { run, priority })
	})
}
function _done() { active--; if (queue.length && active < MAX_INFLIGHT) heapPop(queue).run() }

export function getSculpt(sculptId, sculptType, priority = Infinity) {
	if (!sculptId) return Promise.resolve(null)
	const key = keyOf(sculptId, sculptType)
	if (mem.has(key)) return Promise.resolve(mem.get(key))
	if (failed.has(key)) return Promise.resolve(null)
	if (inflight.has(key)) return inflight.get(key)
	_wire()
	const p = (async () => {
		const net = await _netFetch(sculptId, sculptType, priority)
		if (net) { mem.set(key, net); return net }
		failed.add(key)
		return null
	})().then(r => { inflight.delete(key); return r })
	inflight.set(key, p)
	return p
}
