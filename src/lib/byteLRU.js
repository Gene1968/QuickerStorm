// src/lib/byteLRU.js — generic byte-budget LRU map.
// WHY: the decoded mesh-asset RAM cache grew unbounded (~1.1GB on a 24k-object region) and pinned
// the JS heap above the cull/governor thresholds permanently — the root cause of the busy-region
// "objects drop to 0" death spiral. Any RAM cache that is backed by a persistent layer (IndexedDB)
// can be byte-bounded: evicting here only costs a re-read, never data loss.
//
// Recency: Map iteration order is insertion order; get() re-inserts to mark most-recent (O(1)).
// has() deliberately does NOT touch recency (cheap existence probe).
// The just-inserted entry is never evicted by its own insert — a single over-budget asset still
// caches (it is needed RIGHT NOW); it becomes evictable on the next insert.
export function createByteLRU({ budgetBytes, sizeOf }) {
	const map = new Map()        // key → { v, b } in recency order (oldest first)
	let bytes = 0
	let evictions = 0

	function _evictUntilFit(protectedKey) {
		for (const [k, e] of map) {
			if (bytes <= budgetBytes) break
			if (k === protectedKey) continue
			map.delete(k)
			bytes -= e.b
			evictions++
		}
	}

	return {
		get(key) {
			const e = map.get(key)
			if (!e) return undefined
			map.delete(key)          // re-insert → most recent
			map.set(key, e)
			return e.v
		},
		has: (key) => map.has(key),
		set(key, value) {
			const prev = map.get(key)
			if (prev) { map.delete(key); bytes -= prev.b }
			const b = sizeOf(value) || 0
			map.set(key, { v: value, b })
			bytes += b
			if (bytes > budgetBytes) _evictUntilFit(key)
		},
		delete(key) {
			const e = map.get(key)
			if (!e) return false
			map.delete(key)
			bytes -= e.b
			return true
		},
		clear() { map.clear(); bytes = 0 },
		size: () => map.size,
		bytes: () => bytes,
		evictions: () => evictions,
	}
}
