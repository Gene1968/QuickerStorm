# TP ingestion backpressure + Arriving-overlay gate

**Date:** 2026-06-14
**Status:** Design approved (Gene)
**Refines:** FEATURE-GAPS render item #11; bug "TELEPORT into heavy region wedges + stuck on 'Arriving' (2026-06-14)"
**Branch:** phase3

## Problem

Teleporting into a heavy region wedges where a *cold reload* of the same region completes
fine. Root-caused via the `timed()` probe (commit bb8992a): NO `[Slow]` fired
(drain/cull/reparent/render all <250ms — ruled out), `frames=0`, and the main thread is
dominated by the `obj_upd` path (`n=303`, 191ms/window, max ~80–98ms each). Memory is fine
(39%, geomMB=86) so this is NOT the #13 geometry-runaway. It is an **ObjectUpdate ingestion
flood**: the sim sends objects faster than the client can absorb them on the main thread.

Two corrections to the original FEATURE-GAPS note, established by reading the code:

1. **The "Arriving" overlay does not gate on buildQ / full load.** It clears on the *second*
   `AgentSpawnPos` (`onAgentSpawnPos`, useWorldEngine.js ~2606–2612). It stays stuck because
   that two-packet handshake is fragile (one of the packets is starved under the flood, or the
   grid only sends one), not because of a load gate.

2. **`buildQ` 28k vs `objs` 12.9k is not a leak.** In the telemetry line, `objs` is
   `meshMap.size` (built meshes), not received objects. 28k is a legitimate backlog:
   `preseedRegionCache` dumps the entire warm IDB cache into `pendingMeshIds` in one
   synchronous loop, plus the live flood. The mesh *build* drain is already paced and the
   probe cleared it.

The actual freeze is the **synchronous per-batch work in `onObjectUpdate`** — `persistObjects`
(one `objCachePut` per object) + the `upsertObject` loop — plus the one-shot
`preseedRegionCache` loop, all running on the main thread and starving rAF (and texture-read
callbacks → TexCache watchdog trips).

## Goals

- Stop big ObjectUpdate batches (and the preseed dump) from blocking rAF, so a TP into a heavy
  region stays responsive and completes like a cold reload does.
- Make the "Arriving" overlay clear reliably once the avatar is placed in the destination,
  with a hard fallback so it can never hang.
- No protocol change. No regression to the working same-region / failed-TP paths.
- Keep the DEV `timed()` + `qsCensus()` probes in tree (disposable).

## Non-goals

- Server-side relay pacing (considered; rejected — the dominant cost includes the client-side
  preseed IDB loop the server cannot pace, and it adds latency + a protocol surface).
- Touching the mesh build drain (already paced; not the freeze).
- Any change to region-membership semantics (TeleportFinish = committed, TeleportFailed = stay).

---

## Part A — Client ingest pump (backpressure)

### Data structure
- `_ingestQueue` — `Array<{ o, persist }>` (FIFO). `o` is the raw prim object; `persist` is
  `true` for live ObjectUpdate prims, `false` for preseed entries (already in the cache).

### `onObjectUpdate` changes
- **Avatars unchanged**: still processed fully inline (upsert + `upsertMesh` + own-avatar
  attribution + camera). This preserves own-avatar detection and the follow camera.
- **Prims**: instead of `persistObjects(objs)` + the synchronous `upsertObject` /
  `pendingMeshIds.add` loop, push each non-avatar object onto `_ingestQueue` with
  `persist:true`. The per-5s diag block stays as-is (already throttled).
- `persistObjects(objs)` as a synchronous whole-batch call is removed from the hot path; its
  per-object work moves into the pump (see below).

### `preseedRegionCache` changes
- After `objCacheGetAll(key)`, push cached prims (skipping avatars and ids already in
  `worldStore.objects`) onto `_ingestQueue` with `persist:false`, instead of looping
  `upsertObject` + `pendingMeshIds.add` inline.
- The crcMap seeding (`_crcMapKey` / `_crcMapP`) stays **synchronous** — it is cheap and the
  probe pipeline needs it immediately to avoid request-all re-feeds.

### `pumpIngest()`
- Driven from the existing **30ms drain interval** (the `_meshDrainTimer` block), wrapped as
  `timed('ingest', pumpIngest)`, placed **before** `timed('drain', drainMeshQueue)` so objects
  exist before their meshes are pulled. CPU work → runs while the tab is unfocused, same
  rationale as the mesh drain.
- Uses the existing `drainWithinBudget({ queue, maxItems, budgetMs, processOne, onError })`
  helper (`src/lib/budgetedDrain.js`): count cap + wall-clock budget, always ≥1 item/call.
- Budget: visible tab `maxItems ≈ 512`, `budgetMs ≈ 6`. Hidden tab raises the budget (mirror
  the drain's hidden-tab branch) since there are no frames to protect.
- `processOne({ o, persist })`:
  1. `worldStore.upsertObject(o)` (merges into the objects map + the `_avatars`/`_prims` index).
  2. If `persist`: `objCachePut(key, { ...(worldStore.objects.get(o.localId) ?? {}), ...o })`
     — same merged-record semantics as the current `persistObjects` (never persist a raw
     partial). `key = regionCacheKey()`; if no key, skip persist (matches current guard).
  3. If `!(evicted.has(o.localId) || evicted.has(o.parentId ?? 0))`:
     `pendingMeshIds.add(o.localId)` (same eviction guard as today's inline path).
  - `onError`: increment `upsertMeshFailures`-style counter + throttled warn (reuse existing
    diag style); never throw out of the pump.

### Lifecycle / clearing
- `onTeleportFinish` and any region-change scene clear: `_ingestQueue.length = 0` alongside the
  existing `pendingMeshIds.clear()`.
- No separate timer to stop; the pump is part of the always-running drain interval and no-ops
  on an empty queue.

### Accepted trade-offs / edge cases
- **Probe timing**: `worldStore.objects` and the qs-obj cache fill slightly slower (paced). A
  CRC probe arriving in that window may mark a miss → harmless re-request (matches existing
  documented "slightly stale → harmless re-requests" behavior).
- **TerseUpdate before ingest**: a TerseUpdate (position) for a prim whose full update is still
  queued finds no object yet. This is rare during the initial cross-region flood (full updates
  dominate; terse follows). Behavior degrades to "position applied on the next full/terse after
  ingest" — no crash. Noted, not mitigated in v1.
- **Memory**: ingest adds objects to `worldStore` + IDB but no geometry; it is far lighter than
  baking. The pump is not gated by `memUnderPressure()` (the build drain still is) so the
  client always learns what exists (needed for CRC/probes).

---

## Part B — Arriving-overlay gate

Region membership is unchanged: `TeleportFinish` = the sim already swapped the UDP socket to
the destination (committed); `TeleportFailed` (no `TeleportFinish`) = stay in the old region.
This part only changes when the **overlay** clears.

### State
- `_tpSpawnApplied` (bool) — a non-zero destination spawn pos has been applied since the TP.
- `_tpArrivalTimer` (timeout id) — hard fallback.
- `_tpSettleTimer` (timeout id) — short post-spawn settle.

### `onTeleportFinish`
- Keep `teleportStatus = 'arriving'`, `_tpSceneCleared = true`, scene clear.
- Set `_tpSpawnApplied = false`.
- Start `_tpArrivalTimer` (~12s) — see below.

### `onAgentSpawnPos`
- Keep the existing fast clear (2nd packet → `teleportStatus = ''`).
- When a **non-zero pos is applied** while `teleportStatus === 'arriving'`: set
  `_tpSpawnApplied = true` and start `_tpSettleTimer` (~2.5s) → on fire, if still `'arriving'`,
  clear the overlay (avatar is placed = arrived; covers single-spawn-pos grids).
- On the fast clear, also cancel both timers.

### `_tpArrivalTimer` fire (still `'arriving'`)
- `_tpSpawnApplied === true` → silent clear (`teleportStatus = ''`) + `debugStore` warn
  ("arrival confirmed by spawn pos but no 2nd AgentSpawnPos within 12s").
- `_tpSpawnApplied === false` → **option (b)**: `notificationStore.notify` a soft
  "Teleport is taking longer than expected" (toast), then clear.

### Cancellation
- Cancel `_tpArrivalTimer` + `_tpSettleTimer` on: successful overlay clear, `TeleportFailed`,
  region change, and engine teardown (`onUnmounted` cleanup alongside the existing timer
  clears).

### Why this is safe
- Normal success stays fast (2nd packet path unchanged; Part A also keeps that packet from
  being starved).
- Same-region `TeleportLocal` (no `TeleportFinish`) never starts the timers — its existing
  `else`-branch clear in `onAgentSpawnPos` is untouched.
- `TeleportFailed` path unchanged (clears overlay, stays in old region).

---

## Testing

- **Unit (vitest, lib-level):** `drainWithinBudget` is already covered; add a focused test for
  the ingest `processOne` semantics if extracted to a pure helper (merge-record persist, evict
  guard, avatar skip). Otherwise rely on the existing budgetedDrain tests + build.
- **Build:** `npm run build:staging` green (ESLint flat-config is broken repo-wide — verify via
  vitest + build, per project convention).
- **Live verify (Gene, heavy region):**
  - TP into the heavy region: `frames` > 0 throughout, no multi-second freeze, `[Slow]` quiet,
    scene completes like a cold reload. `qsCensus()` after settle for the before/after picture.
  - Overlay: clears promptly on arrival; on a deliberately slow/silent destination the hard
    timeout clears it (silent if placed, soft toast if never placed).
  - Regression: same-region TP and a rejected TP both behave as before.

## Rollback

Both parts are additive and isolated to `useWorldEngine.js` (+ reuse of `budgetedDrain.js`).
Reverting the ingest pump restores the synchronous path; reverting the timers restores the
two-packet-only clear. No GEOM_VERSION bump, no cache-version change, no protocol change.
