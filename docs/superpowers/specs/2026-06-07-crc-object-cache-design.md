# CRC Object Cache — Firestorm-style object retention across reloads

Date: 2026-06-07 · Branch: phase3 · Author: Gene (with Claude/Opus)

## Problem

Objects that loaded in a prior session disappear on reload. Firestorm does not have
this problem on the same grid. We want to replicate Firestorm's retention behavior.

### Root cause (traced against opensim/, phoenix-firestorm/, and our tree)

1. **OpenSim runs a CRC cache-negotiation protocol we ignore.** The sim sends
   `ObjectUpdateCached` (High #14) probes carrying `(localId, PseudoCRC)` for objects it
   believes the viewer may have cached (`LLClientView.cs:5319`). `PseudoCRC`
   (`SceneObjectPart.cs:183`) increments on every change to a part, so it is a real
   per-object version. Our server (`server/handlers/lludp.ts:583`) decodes only the
   `localId`, **discards the CRC**, and treats every probed id as a cache miss —
   re-requesting a full update for all of them. No validation, no skip.

2. **Our persistence is a whole-region snapshot that is overwritten.**
   `src/lib/objectCache.js` stores the entire region object set as one IDB record and
   `objCacheSave` **overwrites** it ("we overwrite it when the scene settles"). Firestorm
   instead keeps a per-object `mCacheMap` it *accumulates* and CRC-validates
   (`llvocache.cpp` / `llviewerregion.cpp`). Whole-region overwrite is fragile: any
   session that ends with fewer objects in `worldStore` than a prior session shrinks the
   persisted set.

3. **KillObject semantics.** OpenSim `ObjectsCullingByDistance = false` by default
   (`Scene.cs:736`), so on a stock grid `KillObject` is sent only on **genuine delete /
   region-cross**, not draw-distance culling. Firestorm evicts its disk cache entry on a
   sim KillObject (`llviewerobjectlist.cpp:1552 killCacheEntry`) — correct when kill =
   delete. Our `onKillObject` already removes from `worldStore`; the gap is that it does
   not also evict the persistent cache, and (separately) some grids *do* enable culling.

### How Firestorm actually retains

Persistent per-object cache + CRC negotiation. On relog the sim probes; FS matches the
cached CRC, renders from cache instantly, and re-downloads only what changed. We download
everything every login and can lose objects to the overwrite.

## Goals

- Objects seen in a prior session survive reload (primary).
- Honor the sim's CRC: skip re-download when CRC matches; re-fetch when it differs.
- Cut redundant full-update traffic on relog (secondary; falls out of the above).
- Degrade safely to current behavior if the cache or CRC is unavailable.

## Non-goals

- Server-side Tier-2 decoded-object cache (backlog #14; revisit with VPS/NAS hosting).
- Fixing per-login *delivery variance* (grid-side; separate, ~89% ceiling already traced).
- Content-hash fallback for PseudoCRC reseed (see Decisions).

## Decisions

- **CRC reseed on region restart: accept.** PseudoCRC re-seeds from `DateTime.Ticks` on
  restart (not DB-persisted by default), so after a sim restart every cached CRC mismatches
  → one full re-download of that region, then the cache re-validates. Same as Firestorm on
  OpenSim. No content-hash hardening.
- **Eviction: CRC-gated, kill = delete by default.** KillObject evicts the cache entry
  (culling off on stock grids). A guard `QS_KEEP_CACHE_ON_KILL` keeps the entry for grids
  that enable `ObjectsCullingByDistance` (where kill can mean cull). Default: evict.
- **Cache stays client-side (IndexedDB).** It is what survives a client reload; the server
  circuit is fresh each login.

## Architecture

Five independently-testable units.

### 1. Codec — `server/lib/lludp-codec.ts`

- `decodeObjectUpdateCached(buf, off)` returns `Array<{ localId, crc }>` (currently bare
  `localId[]`). The probe block is `localId (u32), crc (u32), updateFlags (u32)` per entry.
- Extract the per-object `crc` in `decodeObjectUpdate` and `decodeObjectUpdateCompressed`
  and surface it on each decoded object as `obj.crc` (the field is already on the wire; we
  drop it today). Compressed path: PseudoCRC is in the compressed block; full path: the
  `CRC` field in `ObjectData`.

### 2. Server probe handler — `server/handlers/lludp.ts`

- On `ObjectUpdateCached`: instead of enqueuing all ids as misses, forward the decoded
  `[{localId, crc}]` to the client as WS message `OBJ_CACHE_PROBE`.
- New inbound WS message `OBJ_CACHE_MISS: number[]` from the client → push those ids into
  the **existing** `cacheMissPending` queue; the existing `drainCacheMissQueue` /
  `RequestMultipleObjects` machinery is unchanged.
- Cache *hits* generate no sim traffic.
- Telemetry: count probes, hits-skipped (reported by client), misses requested.

### 3. Client object cache — `src/lib/objectCache.js`

Rework the single whole-region record into a **per-object** store.

- Store schema: `{ regionKey, localId, fullId, crc, data, savedAt }`, keyed by
  `[regionKey, localId]`; index on `regionKey` and on `savedAt` (for LRU).
- API:
  - `objCachePut(regionKey, obj)` — upsert one object (called on every full/compressed
    update). Per-object write; no whole-region overwrite.
  - `objCacheGetAll(regionKey)` — all objects for a region (pre-seed on enter).
  - `objCacheCrcMap(regionKey)` — `Map<localId, crc>` for probe partitioning.
  - `objCacheEvict(regionKey, localId)` — remove one (KillObject).
  - Region-level LRU (cap `MAX_REGIONS`, evict by oldest `savedAt`), preserved.
- Migration: bump `DB_VERSION`; on upgrade, drop the old `regions` store (stale snapshot
  format) and create the new per-object store. Acceptable — cache is a rebuildable
  optimization.

### 4. Client engine — `src/composables/useWorldEngine.js`

- **On full/compressed ObjectUpdate decode** → `objCachePut(regionKey, obj)` with `obj.crc`.
- **On `OBJ_CACHE_PROBE`** → pure `partitionProbes(probes, crcMap)` → `{ hits, misses }`.
  - `hits` (localId present with matching crc): upsert cached object into `worldStore` +
    `pendingMeshIds` (render from cache). Phase 1 may render via the existing pre-seed and
    simply skip the request; Phase 2 does the explicit hit→render.
  - `misses` (absent or crc differs): emit `OBJ_CACHE_MISS` to server.
- **On KillObject** → `worldStore.removeObject(id)` + `objCacheEvict(regionKey, id)` unless
  `QS_KEEP_CACHE_ON_KILL`.
- **Pre-seed on region enter** (keep): hydrate `worldStore` from `objCacheGetAll` for instant
  paint; CRC probes then reconcile (mismatch → re-fetch, hit → keep). Replaces the old
  `loadRegionCache` whole-array replay.
- Remove the whole-region `saveRegionCache` overwrite; persistence is now per-object on
  update.

### 5. WS plumbing — `shared/` + `src/composables/useRealtimeSocket.js`

- Add message types `OBJ_CACHE_PROBE` (server→client) and `OBJ_CACHE_MISS` (client→server)
  to the shared message registry; wire dispatch in the realtime socket and engine handlers.

## Data flow (relog)

1. Client mounts → pre-seeds scene from IDB (`objCacheGetAll`) → instant paint.
2. Sim sends `RegionHandshake`; we reply `RegionHandshakeReply` with Flags bit `0x2` **clear**
   so OpenSim enables probes (`LLClientView.cs:5739` `sendProbes = supportCache && (flags&2)==0`).
   **Verify** `encodeRegionHandshakeReply` sends Flags=0.
3. Sim warm-up: first pass sends full updates (`flags&2` path clears bit for next pass), then
   sends `ObjectUpdateCached` probes.
4. Client partitions probes against `objCacheCrcMap`: silent hits, `OBJ_CACHE_MISS` for the rest.
5. Server requests misses via existing `RequestMultipleObjects` drain; full updates arrive and
   `objCachePut` upserts cache + crc.

## Error handling / degrade

- IDB open/read failure → empty crc map → all probes become misses → exactly today's behavior.
- Probe entry missing crc, or object absent from cache → miss.
- Region-restart CRC reseed → all mismatch → one re-download (accepted).
- `partitionProbes` is pure and total (no throw); engine wraps IDB calls in try/catch.

## Testing

- `partitionProbes(probes, crcMap)` — pure: hit→no request + flagged render; miss→request;
  missing crc→miss; empty map→all miss.
- Codec: `decodeObjectUpdateCached` returns `{localId, crc}` pairs (fixture); `obj.crc`
  surfaced from full + compressed decode (fixtures).
- `objectCache.js`: put/get/evict, crcMap, region LRU, and **accumulation across saves does
  not shrink** (regression test for the overwrite bug).
- Server: probe handler emits `OBJ_CACHE_PROBE`; `OBJ_CACHE_MISS` enqueues into
  `cacheMissPending`.

## Phasing

- **Step 0 (empirical):** one live capture confirming OpenSim actually sends us
  `ObjectUpdateCached` probes given our current handshake flags. If it does not, fix the
  handshake reply first — do not build on a dead protocol.
- **Phase 1:** units 1–3 + miss path + per-object cache. Retention becomes correct
  (no overwrite-shrink; CRC validation). Hits rely on the existing pre-seed for render.
- **Phase 2:** unit 4b — explicit hit → instant render-from-cache.

## Open / verify during implementation

- Confirm `encodeRegionHandshakeReply` Flags = 0 (bit `0x2` clear).
- Confirm the exact byte layout of the `ObjectUpdateCached` block and the `CRC` field offset
  in full `ObjectUpdate` against captured fixtures before trusting the decoder.
