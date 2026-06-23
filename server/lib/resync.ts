// server/lib/resync.ts — replay cached world snapshot to the browser
//
// WHY: Sim only sends RegionHandshake, terrain LayerData, and ObjectUpdates once when
// the circuit comes online. After page reload the UDP circuit stays alive (Bun holds it
// for 15s) but the browser has lost its scene state. The browser cannot ask the sim to
// resend; instead we cache the snapshot here and replay it whenever the WS reconnects
// or the user clicks "Resync World".
import type { CircuitState } from '../state/sessions'
import { S } from '../../shared/protocol.js'
import { slog } from './serverLog'

// Patch and object payloads can be large — chunk to keep WS frames small and
// avoid blocking the event loop with one giant JSON.stringify.
const PATCHES_PER_FRAME = 32
const OBJECTS_PER_FRAME = 32

/**
 * Replay everything we have cached for this session back to the browser:
 *   1. REGION_INFO (region name, access)
 *   2. AGENT_SPAWN_POS (last known sim-authoritative position)
 *   3. TERRAIN_PATCH frames (chunked)
 *   4. OBJECT_UPDATE frames (chunked) — avatars + prims cached from sim
 * Safe to call multiple times — purely additive on the client (worldStore upsert
 * is idempotent and KillObject already pruned stale ids from objCache).
 */
export function replayCachedWorld(session: CircuitState): void {
	const ws = session.ws

	if (session.cachedRegionName) {
		ws.send(JSON.stringify({
			t: S.REGION_INFO,
			d: { name: session.cachedRegionName, access: session.cachedRegionAccess, ...session.cachedRegionEnv },
		}))
	}

	if (session.cachedSpawnPos) {
		ws.send(JSON.stringify({
			t: S.AGENT_SPAWN_POS,
			d: { pos: session.cachedSpawnPos },
		}))
	}

	// Re-establish the OWN avatar before prims. On resume the sim won't re-broadcast it (agent already
	// present) and it's never in the client's IDB cache, so without this the client never sets
	// ownAvatarLocalId → no follow-cam, movement blocked (user can only orbit) until a teleport. The
	// localId is session-stable, so live TerseUpdates reconcile the (briefly stale) replayed position.
	if (session.ownAvatarUpdate) {
		ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects: [session.ownAvatarUpdate] } }))
	}

	const nPatches = replayTerrain(session)

	const objs = [...session.objCache.values()]
	if (objs.length > 0) {
		for (let i = 0; i < objs.length; i += OBJECTS_PER_FRAME) {
			ws.send(JSON.stringify({
				t: S.OBJECT_UPDATE,
				d: { objects: objs.slice(i, i + OBJECTS_PER_FRAME) },
			}))
		}
	}

	slog.info(ws, `[resync] replayed cached world: region="${session.cachedRegionName ?? ''}" patches=${nPatches} objects=${objs.length} ownAvatar=${session.ownAvatarUpdate ? 'yes' : 'NONE'} spawnPos=${session.cachedSpawnPos?.join(',') ?? '?'}`)
	// Decode-forensics companion (lludp.ts WATCH_LOCALIDS): resync is a delivery path the packet
	// watch can't see — report whether a watched object was part of this replay and what it carried.
	for (const idStr of (process.env.QS_WATCH_LOCALIDS ?? '').split(',')) {
		const id = Number(idStr.trim())
		if (!id) continue
		const hit = session.objCache.get(id) as Record<string, unknown> | undefined
		if (hit) slog.warn(ws, `[Watch] Resync replayed localId=${id} meshId=${hit.meshId ?? 'NONE'} sculptType=${hit.sculptType ?? '-'} keys=${Object.keys(hit).join(',')}`)
	}
}

/**
 * Replay the cached terrain patches to the browser (chunked). Returns the patch count.
 *
 * WHY a standalone helper (and not just inside replayCachedWorld): on a NORMAL reload the resume's
 * replayCachedWorld burst fires BEFORE the client engine mounts its WS handlers, so these TERRAIN_PATCH
 * frames are dropped (same pre-mount race that loses the avatar frame). worldStore.terrainHeights then
 * stays all-zero → sampleTerrainHeight returns ~0 → client gravity floors the avatar at z≈1 (the "fall
 * through to 1m" bug, focus-dependent because rAF drives gravity). The post-mount OBJ_PROBE_RESYNC must
 * re-send terrain too — not just the avatar — so the collision heightmap rebuilds = automatic resync.
 * Idempotent: re-sending patches just re-fills the same heightmap cells.
 */
export function replayTerrain(session: CircuitState): number {
	const ws = session.ws
	const patches = [...session.terrainCache.values()]
	for (let i = 0; i < patches.length; i += PATCHES_PER_FRAME) {
		const chunk = patches.slice(i, i + PATCHES_PER_FRAME)
		ws.send(JSON.stringify({
			t: S.TERRAIN_PATCH,
			d: {
				layerType: 'LAND',
				patchSize: chunk[0].patchSize,
				patches: chunk.map(p => ({ x: p.x, y: p.y, heights: p.heights })),
			},
		}))
	}
	return patches.length
}
