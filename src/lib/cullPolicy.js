// src/lib/cullPolicy.js — pure ranking for memory-budget distance culling. The engine computes each
// candidate's distance to the camera (it owns THREE/camera) and passes plain {id, dist} objects;
// this module just orders + caps, so it is unit-testable without THREE or the DOM. Total + pure.

// Farthest-first, capped at maxN. Used when over the memory budget: evict the most-distant resident
// objects. `candidates` must already exclude protected ids (avatars / own / selected).
// minDist: candidates at or within this distance are NEVER evicted — without the guard, sustained
// memory pressure walks the farthest-first eviction all the way down to the player's feet and the
// scene monotonically empties (the busy-region "objects drop to 0" bug). With it, the culler
// converges to "everything near you stays" and eviction simply stops when only near objects remain.
export function selectEvictions(candidates, maxN, minDist = 0) {
	return [...candidates]
		.filter(c => c.dist > minDist)
		.sort((a, b) => b.dist - a.dist)
		.slice(0, maxN)
		.map(c => c.id)
}

// Group child localIds under their root: Map<parentId, childId[]> from a Map<localId, obj> (the
// worldStore objects map). WHY: SL linksets are flat — every child carries parentId = root localId,
// and child pos is PARENT-RELATIVE, so children can never be distance-ranked on their own pos. The
// culler therefore operates on roots only and uses this index to evict/reload a linkset as a unit.
export function groupChildrenByRoot(objects) {
	const byRoot = new Map()
	for (const [id, o] of objects) {
		const pid = o?.parentId ?? 0
		if (pid === 0) continue
		let arr = byRoot.get(pid)
		if (!arr) { arr = []; byRoot.set(pid, arr) }
		arr.push(id)
	}
	return byRoot
}

// Nearest-first within rNear, capped at maxN. Used when there is headroom: rebuild the closest
// previously-evicted objects. Anything beyond rNear is left evicted (hysteresis vs the evict radius).
export function selectReloads(candidates, rNear, maxN) {
	return candidates
		.filter(c => c.dist <= rNear)
		.sort((a, b) => a.dist - b.dist)
		.slice(0, maxN)
		.map(c => c.id)
}
