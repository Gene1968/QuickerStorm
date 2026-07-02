// src/lib/killPolicy.js — decide whether a KillObject should evict the persistent qs-objects
// descriptor cache. A ghost reconciliation (deleted:true) is confirmed-dead → ALWAYS evict, even with
// keepCacheEnv. An interest-driven CULL (cull:true) is temporary — the object re-enters as the camera
// moves, so keep the descriptor (re-enter rebuilds from the server replay + warm geom/tex IDB). A
// genuine sim DELETE (cull:false / absent) evicts. The env override (VITE_KEEP_CACHE_ON_KILL) forces
// keep for routine kills on grids that enable distance culling, but never overrides a confirmed delete.

/**
 * @param {{ cull?: boolean, keepCacheEnv: boolean, deleted?: boolean }} o
 * @returns {boolean} true → evict the descriptor; false → keep it
 */
export function shouldEvictOnKill({ cull, keepCacheEnv, deleted }) {
	if (deleted) return true
	if (keepCacheEnv) return false
	if (cull) return false
	return true
}
