// src/lib/probePartition.js — pure decision for ObjectUpdateCached probes.
// WHY: given the sim's (localId, crc) probes and our persistent cache's localId→crc map,
// a probe is a HIT only when we hold that localId AND the stored crc equals the probed crc.
// Anything else (absent, crc differs, probe lacks a crc) is a MISS → request a full update.
// Total + pure: never throws, no I/O — unit-testable and safe to call in hot paths.
export function partitionProbes(probes, crcMap) {
	const hits = []
	const misses = []
	for (const p of probes ?? []) {
		const have = crcMap.get(p.localId)
		if (have !== undefined && p.crc !== undefined && have === p.crc) hits.push(p.localId)
		else misses.push(p.localId)
	}
	return { hits, misses }
}
