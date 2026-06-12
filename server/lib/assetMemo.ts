// server/lib/assetMemo.ts — byte-budget LRU + in-flight coalescing for asset handler results.
// WHY: handleAssetFetch/handleMeshFetch were stateless pass-throughs — every client retry refired
// a grid HTTP fetch AND a J2C decode. On a dense region the decode pool's FIFO backed up minutes
// deep, every response landed past the client's 30s timeout, and the timeout→retry loop re-fed the
// queue (observed: server bursting [Asset] lines for textures the client had long given up on).
// Coalescing makes concurrent/retried requests share ONE unit of work; the LRU makes any re-ask of
// a recently served asset free. Errors (null) are never cached — a later retry re-attempts.
export function createAssetMemo<T>(opts: { budgetBytes: number; sizeOf: (v: T) => number }) {
	const map = new Map<string, { v: T; b: number }>()   // recency order: oldest first
	const inflight = new Map<string, Promise<T | null>>()
	let bytes = 0
	let hits = 0, misses = 0, evictions = 0

	function _put(key: string, v: T) {
		const prev = map.get(key)
		if (prev) { map.delete(key); bytes -= prev.b }
		const b = opts.sizeOf(v) || 0
		map.set(key, { v, b })
		bytes += b
		for (const [k, e] of map) {
			if (bytes <= opts.budgetBytes) break
			if (k === key) continue            // never evict the entry we just paid for
			map.delete(k)
			bytes -= e.b
			evictions++
		}
	}

	return {
		/** Return the cached value, the shared in-flight promise, or run work() and cache its result. */
		memo(key: string, work: () => Promise<T | null>): Promise<T | null> {
			const e = map.get(key)
			if (e) {
				hits++
				map.delete(key)                 // re-insert → most recent
				map.set(key, e)
				return Promise.resolve(e.v)
			}
			let p = inflight.get(key)
			if (!p) {
				misses++
				p = work()
					.then(v => { if (v != null) _put(key, v); return v })
					.finally(() => inflight.delete(key))
				inflight.set(key, p)
			}
			return p
		},
		stats: () => ({ size: map.size, bytes, hits, misses, evictions, inflight: inflight.size }),
	}
}
