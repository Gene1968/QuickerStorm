# Near-First Load — Design

> Render/Cache unified-model **Next work #1** (`docs/render-cache-model.md`). Build + fetch the
> immediate surroundings FIRST, so a heavy region's *nearby* set loads in seconds (the Firestorm
> "nearby in 1–2 s" feel) instead of waiting behind far objects in FIFO order.
> Date: 2026-06-15. Workflow: evidence-first, one slice, test-first, Gene commits.

## Problem

Three work queues currently dispatch in **FIFO insertion order**, blind to distance:

| Queue | Structure | Drain | Holds |
|---|---|---|---|
| `pendingMeshIds` | `Set` | `drainMeshQueue` (budgeted, `BAKE_INFLIGHT_CAP`) | localIds awaiting **main-thread mesh build** |
| `netQueue` | array | `_pump` / `netQueue.shift()` (6 slots) | **texture network fetches** (true misses only) |

On a heavy region the sim's interest list and the warm cache both deliver far objects mixed with
near ones; FIFO builds/fetches them in arrival order, so the avatar's immediate surroundings can sit
unbuilt/untextured for a long time while distant geometry is processed first.

Only the cull-tick *reload* path (`selectReloads` in `cullPolicy.js`) is distance-aware today; the
primary cold-load build/fetch is not.

## What is and isn't in scope (cache interaction)

This slice prioritizes **downloads and main-thread builds** — the two bottlenecks. Cache hits are
handled correctly by the existing short-circuits and are *not* re-queued:

- **Textures:** a GPU-resident texture (`cache`), a resident blob (`blobCache`), or an IndexedDB hit
  (`texCacheGet`) each short-circuits *before* `netQueue` (see `getBaseTexture` / `getBlob`). A cache
  hit draws immediately (GPU) or via the cheap per-frame decode pump (`buildQueue`) and **never
  consumes a download slot**. The priority `netQueue` therefore orders **only genuine network
  fetches** — exactly the bottleneck.
- **Geom/mesh:** a geom-cache hit skips the **bake** and a mesh-cache hit skips the **download+decode**,
  but the object is **still built on the main thread** via `drainMeshQueue → upsertMesh` for every
  object regardless of cache state (single-main-thread ceiling, model #11). So a cached object is NOT
  instantly drawn-and-cleared — it is still paced through `pendingMeshIds` at the build rate. This is
  *why* near-first build ordering helps **every** region type, warm included.

**Consequence:** near-first **download** ordering targets cold/partial regions; near-first **build**
ordering targets the main-thread ceiling on all regions. Both are in this slice.

## Reference point

Distance = `camDistToObj(obj)` (camera position), consistent with the existing governor / cull /
`selectReloads`. No new reference frame.

## Part 1 — Mesh build near-first

Keep `pendingMeshIds` (`Set`) as the membership/dedup structure — `add`/`has`/`delete` semantics
unchanged. Add a **throttled distance-sorted drain order** alongside it:

- New pure helper in `cullPolicy.js` (mirrors `selectReloads`/`selectEvictions`):
  ```
  orderByDistance(ids, distFn) → ids sorted ascending by distFn(id)
  ```
  Pure, deterministic, unit-testable in isolation.
- In `useWorldEngine.js`, `drainMeshQueue` maintains `_drainOrder` (array) + `_drainOrderAt`
  (timestamp) + a cursor. The order is rebuilt when **stale** — any of:
  - older than `DRAIN_ORDER_TTL_MS` (~750 ms), OR
  - exhausted (cursor reached the end) while the Set is non-empty, OR
  - the camera has moved more than `DRAIN_ORDER_MOVE_M` (~8 m) since the last rebuild.
- Drain iterates `_drainOrder`, **skipping ids no longer in `pendingMeshIds`** (killed/evicted/already
  built), applying the **same** per-tick budget and `BAKE_INFLIGHT_CAP` backpressure as today. On
  `delete`, the Set is the source of truth; the order array is allowed to contain stale ids (skipped).
- New arrivals during the TTL window join the next rebuild — bounded staleness, no per-insert cost.

**Cost:** one `O(n log n)` sort at most ~1.3×/s (TTL-gated). Builds run ~30/s (~33 ms each) and
dominate; a few-ms sort of ~28k ids off the per-frame path is negligible. Fallback if it ever shows
in a profile: radial bucketing (`O(n)` partition into coarse bands, drain nearest band first).

## Part 2 — Texture fetch near-first (priority `netQueue`)

Fetches are **build-triggered** (every `getTexture()` fires inside `upsertMesh`), so near-first build
already enqueues near textures first on a fresh cold load. The gap is **re-requests while the queue is
already deep** — backfill, soft-retries, and revisits can enqueue a near texture behind a wall of far
ones. Option B (priority queue) closes that gap and is faithful to "distance-ordered queues."

- Thread an optional `priority` (a number; smaller = nearer = sooner) through the public API:
  `getTexture(uuid, xform = null, priority = Infinity)` → `getBaseTexture(uuid, priority)` →
  `getBlob(uuid, priority)` → `_wsFetch(uuid, priority)`. `useTextureFetch` stays **world-agnostic** —
  it only sees a number; the engine computes `priority = camDistToObj(obj)` at each call site.
- `netQueue` entries become `{ run, priority }`. `_pump` dispatches the **lowest-priority** queued
  entry when a slot frees (nearest first) instead of `shift()` (FIFO).
- Dispatch selection: with `MAX_INFLIGHT = 6` and a bounded queue, an `O(n)` min-scan per dispatched
  slot is cheap and infrequent (pump runs on slot-free + the periodic engine re-pump). A small pure
  helper `takeMinPriority(queue)` (splice out the min) keeps it testable. (If queue depth ever makes
  the scan show up, switch to a binary-heap insert — deferred, YAGNI.)
- Entries with no priority passed default to `Infinity` (drain last) — preserves today's behavior for
  any non-distance-aware caller (terrain slots, bundled defaults).
- Call sites updated to pass distance: the prim diffuse (`~2084`), PBR maps (`~2124`), per-face
  (`~3694`), and the backfill re-apply (`~3773`). Terrain texture loads (`~1423`) keep the default
  (not distance-meaningful).

## Files touched

- `src/lib/cullPolicy.js` — new `orderByDistance(ids, distFn)` (pure).
- `src/composables/useWorldEngine.js` — `drainMeshQueue` order maintenance; pass `priority` to
  `getTexture` at the 4 prim/mesh call sites.
- `src/composables/useTextureFetch.js` — `priority` param through `getTexture`/`getBaseTexture`/
  `getBlob`/`_wsFetch`; `netQueue` entries `{ run, priority }`; `_pump` min-priority dispatch;
  `takeMinPriority` helper.

## Testing (test-first)

- `cullPolicy.test.js` — `orderByDistance`: ascending order; ties stable; empty; single; ids whose
  `distFn` returns `Infinity` sort last.
- `useTextureFetch.test.js` (or the existing texture test) — `_pump` dispatches lower-priority first
  when multiple are queued; default `Infinity` priority drains last; cache hits (GPU/blob/IDB) never
  enter `netQueue` (regression guard for the in-scope/out-of-scope boundary).
- Engine-level drain ordering is covered by the pure `orderByDistance` test + manual live-verify
  (the `drainMeshQueue` glue is thin around the pure helper).

## Telemetry / verification

- Add nothing heavy. The existing `[Drain]` / `[Mem]` lines already report `buildQ` and texture
  `queued`/`inflight`. Live-verify on a heavy region: on TP/cold-load, near objects (around the
  avatar) should build and texture visibly before far ones; the load badge's near-set should fill
  fast even while the far count is still high.

## Non-goals (separate slices, per the model's Next-work list)

- Refresh-textures button (#2), near-aware texture **eviction** (#3), badge = texture readiness (#4),
  LOD (#5), off-main-thread build (#6). This slice is ordering only — no eviction, budget, or LOD
  changes.

## Risks

- **Sort cost on the protected main thread** — mitigated by TTL-gating (≤~1.3×/s) and the bucketing
  fallback; will watch `[Slow]` for any drain-tick regression.
- **Stale order array** — bounded by TTL + move-threshold rebuild; Set remains source of truth so
  stale ids are skipped, never built twice.
- **Priority default** — `Infinity` default preserves FIFO-ish behavior for non-distance callers; no
  regression for terrain/bundled textures.
