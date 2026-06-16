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

// ── Heap-aware draw-distance governor (FEATURE-GAPS #13) ──────────────────────────────────────
// The engine's effective draw radius (_effNear) shrinks the working set under memory pressure. It
// must respond to EITHER the self-accounted app/VRAM budget OR the real process heap: a cold dense
// region pins the heap near its limit (bake/decode churn) while appRatio still looks free, so an
// app-only governor keeps loading past what the tab heap holds and wedges. heapRatio is null on
// browsers without performance.memory → treated as "no heap pressure" (app gate alone, as before).

// True when the working set MAY GROW (step _effNear up): app AND heap must BOTH have headroom.
// WHY both: the prior bug grew dd back on appRatio alone, canceling the heap-driven step-down every
// tick so dd never shrank under pure heap pressure (app low, heap pinned) → the wedge. Release at the
// lower hysteresis band (~0.68) so it doesn't immediately re-grow into the pressure it just relieved.
export function drawDistanceMayGrow(appRatio, heapRatio, cullResume, heapReleaseAt) {
	return appRatio < cullResume && (heapRatio == null || heapRatio < heapReleaseAt)
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

// Nearest-first ordering of a plain id list (near-first load). The engine owns THREE/camera, so it
// passes a distFn(id)→metres; this module just returns a NEW array sorted ascending (Infinity last).
// Used to drain the mesh-build queue closest-first so the player's surroundings build before far
// objects. Pure + total; the caller's Set stays the source of truth (stale ids are skipped on drain).
export function orderByDistance(ids, distFn) {
	// Decorate-sort-undecorate: call distFn EXACTLY ONCE per id (not inside the comparator, which would
	// invoke it ~2·n·log(n) times). On a 20k-deep build queue with a Map-lookup + child→root distFn,
	// comparator-side evaluation cost ~1.5s/rebuild and starved the render loop (#11). This is O(n) distFn.
	return ids
		.map(id => ({ id, d: distFn(id) }))
		.sort((a, b) => a.d - b.d)
		.map(e => e.id)
}
