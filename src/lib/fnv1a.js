// src/lib/fnv1a.js — FNV-1a 32-bit hash over a byte array.
// WHY: cache keys for baked geometry need a fast, dependency-free, deterministic hash.
// Two runs with distinct IVs concatenate to a 64-bit hex key (collision odds at
// ~100k distinct shapes are negligible); no cryptographic strength needed.
export function fnv1a32(bytes, seed = 0x811c9dc5) {
	let h = seed >>> 0
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i]
		// h *= 16777619 in 32-bit space via the canonical public-domain FNV shift trick (equivalent to Math.imul(h, 16777619) >>> 0).
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
	}
	return h >>> 0
}

const hex8 = (n) => n.toString(16).padStart(8, '0')

/**
 * 64-bit hex key: standard-basis FNV-1a (IV 0x811c9dc5) concatenated with a second
 * FNV-1a run using IV 0xcbf29ce4 (the high 32 bits of the FNV-64 offset basis
 * 0xcbf29ce484222325) to widen the key space.  The two halves are correlated (same
 * algorithm, same input, different IV), not cryptographically independent — this is
 * fine for cache-key collision avoidance but is not a true 64-bit hash.
 */
export function fnv1aHex64(bytes) {
	return hex8(fnv1a32(bytes, 0x811c9dc5)) + hex8(fnv1a32(bytes, 0xcbf29ce4))
}
