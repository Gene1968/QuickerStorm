# Stale-Scene Ghost Reconciliation — Design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Bug:** `docs/FEATURE-GAPS.md` line 412 — objects deleted while the client was offline persist
across a full logout → relogin, cluttering the region.

## Problem

The persistent per-object cache (`qs-objects` IndexedDB, `src/lib/objectCache.js`, modelled on
Firestorm's `llvocache`) pre-seeds the scene on login for instant paint. The sim reconciles that cache
via `ObjectUpdateCached` CRC probes: per object, a probe tells us hit (keep) or miss (re-fetch).

But the sim only probes/updates objects that **currently exist**. An object deleted while we were
offline is never probed and never updated — so it is never confirmed *and never evicted*. It sits in
`qs-objects` forever and re-paints on every login. The sim cannot help: it sends no `KillObject` for
something deleted while we weren't connected.

## Why this is server-side, not client-side

The obvious client-side fix — "on fresh login, cull any pre-seeded object that received no probe/update
within a settle window" — is **wrong** under our interest filter (`server/lib/interestFilter.ts`,
default ON). The relay forwards only *in-interest* objects to the browser. From the client's vantage,
a live-but-out-of-interest object looks identical to a ghost: no forwarded probe (the server only
forwards probes for ids it doesn't already hold), no forwarded update (interest-filtered out). A blanket
client cull would erode the entire warm cache outside the interest bubble — defeating the interest
filter's whole purpose.

The server has the information the client lacks. `session.distinctLocalIds` accumulates **every localId
seen in any probe or any update this session**. The interest filter only limits what is *forwarded* to
the browser, not what the server *receives* from the sim — so on an OpenSim grid with
`ObjectsCullingByDistance` OFF (the default, and the premise of the interest filter), `distinctLocalIds`
is the **full authoritative current object set** of the region. A ghost appears in neither a probe nor
an update, so it is absent from `distinctLocalIds`; an out-of-interest live object is present in it.

Therefore: **`ghosts = clientCached − distinctLocalIds`**, computed server-side, is safe — it cannot
touch out-of-interest live objects.

## Scope decision

v1 ships the **simple whole-region diff**. It is correct on grids where the sim enumerates the whole
region (OpenSim culling OFF — the live target and the interest filter's premise). On a grid that culls
by distance server-side, `distinctLocalIds` would be partial and the diff could wrongly kill far cached
objects; this is documented as a known limitation. The cost of a false kill is bounded and self-healing
— the object re-adds on its next update — whereas the bug we are fixing (persistent ghosts) does not
self-heal. Interest-scoped reconciliation (grid-agnostic, but needs the client to ship ghost positions)
is explicitly deferred.

## Data flow

1. **Client → server, once after pre-seed.** New message `OBJ_CLIENT_CACHED { ids: number[] }` — the
   localIds the client just pre-seeded from `qs-objects` for the current region (already in hand from
   `objCacheGetAll`). Server stores `session.clientCached: Set<number>`.

2. **Server, once after the sim's enumeration settles.** Compute `ghosts = findGhosts(clientCached,
   distinctLocalIds)`. Piggybacks on the existing 500 ms `reconcileInterestTick`. Runs once per region
   when all gates pass (see Settle gating). `session.ghostReconcileDone` makes it one-shot.

3. **Server → client.** `KILL_OBJECT { ids: ghosts, deleted: true }`. The client evicts each from the
   Three.js scene, `worldStore`, **and** `qs-objects` IDB — permanently, not just this session.

## Settle gating

The reconcile fires from `reconcileInterestTick` only when **all** hold:
- `session.clientCached` has arrived (non-null), and
- `session.ghostReconcileDone` is false, and
- ≥ 3000 ms since the last probe/update (`session.lastProbeRxAt` — the same quiescence signal
  `drainProbeResync` already uses; enumeration has gone quiet), and
- ≥ 5000 ms since login/region-entry (don't fire during the initial flood).

These thresholds live behind the pure predicate `ghostReconcileReady(...)` so they are unit-testable.
On fire: send the kill, set `ghostReconcileDone = true`, drop the killed ids from `clientCached`.

## Kill path

- Reuse `KILL_OBJECT`; add optional `deleted?: boolean`. Interest leaves keep sending `cull: true`;
  ghost reconciliation sends `deleted: true`.
- Extend the pure `shouldEvictOnKill({ cull, keepCacheEnv, deleted })`: `deleted === true` returns
  `true` first, **before** the `keepCacheEnv` short-circuit — so a confirmed-dead object is purged from
  IDB even on grids that set `VITE_KEEP_CACHE_ON_KILL=true`.
- `onKillObject` is otherwise unchanged: `removeMesh` + `worldStore.removeObject` + the existing
  linkset-child cascade all apply. (A ghost root's children are themselves ghosts and appear in the diff
  too; the cascade is a redundant safety net.)

## Edge cases

- **Region change / teleport:** server clears `clientCached` + `ghostReconcileDone` alongside the
  existing `objCache` / `distinctLocalIds` / `sentToClient` resets (lludp.ts region-change path). Client
  re-pre-seeds and re-sends `OBJ_CLIENT_CACHED` for the new region.
- **Cold first visit (empty cache):** `findGhosts → []`; no-op.
- **`clientCached` arrives after settle:** the 500 ms tick re-checks the gates each cycle and fires as
  soon as they pass.
- **Own avatar:** never in `clientCached` (pcode 47 is not persisted). Safe.
- **False positive** (live object not yet enumerated at settle): self-heals via its next update; the
  3 s-quiet + 5 s-min gates make this rare.

## Files & tests

| File | Change |
|------|--------|
| `shared/protocol.js` | Add `C.OBJ_CLIENT_CACHED`; document `deleted` on `KILL_OBJECT`. *(collision hot-spot — owned this session)* |
| `server/lib/ghostReconcile.ts` *(new)* | Pure `findGhosts(clientCached, distinctLocalIds)` + `ghostReconcileReady({ hasClientCached, done, msSinceProbe, msSinceLogin })`. Mirrors `probePartition.js`. |
| `server/lib/ghostReconcile.test.ts` *(new)* | Unit tests for both pure helpers. |
| `server/handlers/lludp.ts` | `OBJ_CLIENT_CACHED` handler (store set); reconcile call in `reconcileInterestTick`; clear on region change; send `KILL_OBJECT { deleted: true }` + `[GhostReconcile]` log. |
| `server/state/sessions.ts` | Add `clientCached: Set<number> \| null`, `ghostReconcileDone: boolean`; init in session create + region-change reset. |
| `src/lib/killPolicy.js` (+ `killPolicy.test.js`) | Add `deleted` flag. |
| `src/composables/useWorldEngine.js` | Send `OBJ_CLIENT_CACHED` after pre-seed; pass `payload.deleted` into `shouldEvictOnKill`. |

## Telemetry

`[GhostReconcile] clientCached=N distinct=M ghosts=K killed=[ids…]` — one line when the reconcile fires.

## Build/test sequencing

Server + client change. Per CLAUDE.md "Batch server edits": make all server edits (protocol, lib,
handler, state) in one burst, restart Bun once, tell the user "server settled — reconnect," then make
the client edits (killPolicy, useWorldEngine) over Vite HMR. Gates: `bun test server/` green +
client vitest for the pure helpers (ESLint is broken repo-wide — see `[[eslint-broken-flat-config]]`).

## Live verification

On a region with known objects rezzed-and-deleted while offline (the reported repro): fresh login →
after ~5 s the `[GhostReconcile]` line reports `ghosts=K` and the stale objects vanish from the scene;
a second login no longer shows them (IDB evicted). Confirm out-of-interest live objects are untouched
(tour the region; nothing that should exist disappears).
