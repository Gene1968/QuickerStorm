// src/lib/killPolicy.js — decide whether a KillObject should evict the persistent qs-objects
// descriptor cache. An interest-driven CULL (cull:true) is temporary — the object re-enters as the
// camera moves, so keep the descriptor (re-enter rebuilds from the server replay + warm geom/tex IDB).
// A genuine sim DELETE (cull:false / absent) evicts, as does the legacy VITE_KEEP_CACHE_ON_KILL=false
// path. The env override forces keep for grids that enable distance culling.

/**
 * @param {{ cull?: boolean, keepCacheEnv: boolean }} o
 * @returns {boolean} true → evict the descriptor; false → keep it
 */
export function shouldEvictOnKill({ cull, keepCacheEnv }) {
	if (keepCacheEnv) return false
	if (cull) return false
	return true
}
