// src/lib/cullPolicy.js — pure ranking for memory-budget distance culling. The engine computes each
// candidate's distance to the camera (it owns THREE/camera) and passes plain {id, dist} objects;
// this module just orders + caps, so it is unit-testable without THREE or the DOM. Total + pure.

// Farthest-first, capped at maxN. Used when over the memory budget: evict the most-distant resident
// objects. `candidates` must already exclude protected ids (avatars / own / selected).
export function selectEvictions(candidates, maxN) {
	return [...candidates].sort((a, b) => b.dist - a.dist).slice(0, maxN).map(c => c.id)
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
