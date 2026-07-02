// server/lib/ghostReconcile.ts — pure core for stale-scene ghost reconciliation.
// A "ghost" is an object the client still paints from its persistent qs-objects IDB cache but the sim
// never mentioned this session (no ObjectUpdate, no ObjectUpdateCached probe) — i.e. deleted while the
// client was offline. distinctLocalIds is the sim's FULL current set (the interest filter limits what
// the relay FORWARDS, not what it RECEIVES), so the diff below cannot touch out-of-interest live
// objects. See docs/superpowers/specs/2026-06-27-stale-scene-ghost-reconciliation-design.md.

/** Client-cached localIds absent from the sim's session enumeration → genuine ghosts to evict. */
export function findGhosts(clientCached: Set<number> | null, distinctLocalIds: Set<number>): number[] {
	if (!clientCached) return []
	const ghosts: number[] = []
	for (const id of clientCached) if (!distinctLocalIds.has(id)) ghosts.push(id)
	return ghosts
}

export interface GhostReconcileGate {
	hasClientCached: boolean
	done: boolean
	msSinceProbe: number   // since the last ObjectUpdateCached probe (enumeration-quiet signal)
	msSinceLogin: number   // since region entry / login (don't fire mid-flood)
}

/** Enumeration has settled: client set received, not yet run, probes quiet ≥3s, past the ≥5s flood. */
export function ghostReconcileReady(g: GhostReconcileGate): boolean {
	const QUIET_MS = 3000
	const MIN_LOGIN_MS = 5000
	return g.hasClientCached && !g.done && g.msSinceProbe >= QUIET_MS && g.msSinceLogin >= MIN_LOGIN_MS
}
