# Heavy-Region Warm-Read Decouple — Design

> Spec for FEATURE-GAPS #10. Date: 2026-06-13. Branch: phase3.
> Goal: warm geometry cache (qs-geom) gives real benefit *during* region load, so a
> previously-visited dense region loads in seconds instead of re-baking everything over 2–4 min.

---

## Problem

On a **warm** region (data already in IndexedDB and healthy — idle probe: qs-geom 3036 recs @87 ms)
the ideal load path is: every prim is a cache **hit** → zero bakes → zero writes → zero IDB
contention. Reads stay fast, the scene rebuilds from cache.

In practice a self-reinforcing cascade defeats this:

1. A single early `geomCacheGetMany` readonly txn is starved (under the write storm and/or
   main-thread saturation) and trips the 4 s lookup watchdog (`useWorldEngine.js:360`).
2. The watchdog degrades that batch to an **all-miss bake**.
3. Each bake calls `geomCacheStore` → buffers a write → `_scheduleFlush`.
4. `_writeBuf` fills to `FLUSH_MAX = 200` almost instantly under a bake storm, so `_flushNow`'s
   read-priority gate is **punched through** (`geomCache.js:161`) and a readwrite flush txn runs.
5. That readwrite txn (overlapping `[STORE, META]` scope) blocks the next readonly `getMany` from
   even starting → another watchdog trip → **more bakes → more writes → more punch-through**.

Observed live: `idb=0` hits during load, `wdog=487` accumulated, everything re-baked. The warm
cache gives ~0 benefit exactly when it is needed most. ("Speeds up near the end" = the in-session
mem tier slowly warming, not IDB.)

**Confirmed not the cause:** cold cache (data is present), cap eviction (qs-geom well under cap),
or a cap/protocol problem. The blocker is read↔write contention on the hot path, with main-thread
saturation (item 11) as a coupled aggravator that is explicitly **out of scope** here.

---

## Memory model (the three pools this design depends on)

| Pool | What it holds | Touches GPU/VRAM? | Sized by |
|------|---------------|-------------------|----------|
| **Disk** — IDB `qs-geom` | Persistent baked geometry, survives sessions | No | `navigator.storage.estimate()` → 0.3 × quota, ≤4 GB (already) |
| **CPU RAM — mem cache tier** (`_mem` byteLRU) | Dedup/hand-out copies of geometry in the tab process | **No** | Fixed 128 MB today → **this design makes it auto-detected + overridable** |
| **CPU RAM + VRAM — live scene** (memGovernor, 1536 MB) | `BufferGeometry` attached to meshes, uploaded to the GPU | **Yes** | `min(1536 MB, 0.40 × V8 heap)` — VRAM is unqueryable, stays conservative |
| **CPU RAM — deferred write buffer** (`_writeBuf`) | Transient baked arrays awaiting flush, freed on flush | No | new write-buffer ceiling (CPU-RAM) |

**Crux:** today the mem cache tier is counted *inside* the 1536 MB VRAM governor budget
(`useWorldEngine.js:3143` — `setAppBytes(... + getGeomMemBytes())`). So growing the cache would
steal from live-scene geometry and worsen the cull-spiral (item 13). The mem tier and write buffer
are **pure CPU RAM that never touches VRAM**, so they must be budgeted separately and removed from
the governor total. Doing so lets the cache grow *and* returns VRAM budget to live geometry.

**Auto-detection reality:** disk can be queried precisely (`storage.estimate`); RAM cannot —
`navigator.deviceMemory` is the only signal and is coarse (capped at `8`, rounded), so a user
override is required for high-end systems; VRAM is not queryable at all by the browser.

---

## Components

### 1. Write-deferral (keystone — breaks the cascade)

New module state + API in `geomCache.js`:

- `setGeomCacheLoading(bool)` — sets a `_loading` flag. Driven by the engine's **existing** load
  signal (`useWorldEngine.js:3573`: `pendingMeshIds.size > 50 || tex/mesh queued/inflight ||
  _geomPending > 25`). No new "settled" detection is invented. Debounced (~750 ms trailing) so brief
  dips between bursts don't thrash the flush mode.
- While `_loading` is true, `_flushNow` **suspends all flushes**: no `FLUSH_MS` timer flush, and
  **no `FLUSH_MAX` punch-through**. Writes purely accumulate in `_writeBuf`.
- On `_loading` → false: flush everything once, then resume the existing steady-state
  `_readsInFlight` gate (unchanged — still correct for post-load incremental writes).
- **Safety valves** (both emit a one-line console/log entry — no-silent-caps rule):
  - *Byte ceiling* — when buffered bytes ≥ `WRITE_BUFFER_CEILING_BYTES`, force one flush even while
    loading. Rationale: a buffer that large means we are genuinely cold (reads are mostly misses), so
    eating the contention is acceptable.
  - *Time ceiling* — if `_loading` has been continuously true for > `MAX_DEFER_MS` (30 s) with no
    flush, force one. Bounds RAM; geometry is re-derivable so data loss risk is nil.
- `pagehide` force-flush is retained unchanged.

**Why this is the keystone:** during load, zero readwrite txns interleave with `getMany`, so the
readonly lookups run back-to-back and resolve fast. If a read still times out and bakes, the
resulting write is *buffered, not flushed*, so it cannot block the next read — the next read hits and
the cascade is broken at the write side.

`_writeBuf` accounting gains a running byte total (`_writeBufBytes`) so the byte ceiling is O(1);
`geomCacheStore`, `geomCacheEvict`, and the flush all keep it in sync.

### 2. CPU-RAM cache budget decoupled from the VRAM governor

- In `useWorldEngine.js:3143`, drop `getGeomMemBytes()` from `setAppBytes(...)`. The governor then
  budgets only VRAM-bound pools (textures + live geometry + mesh cache, unchanged for now).
- Net effect: live geometry regains the ~128 MB+ the cache tier was occupying → **relieves the
  cull-spiral (item 13)**; the cache tier can grow without triggering live-scene eviction.
- The cache tier keeps its **own** bound (the byteLRU budget, §3) so it cannot OOM the tab — this
  also addresses the app/tab memory-creep watch item.
- **Telemetry:** the `[Mem]` line keeps a `geomCacheMB` figure but as a **separate segment** against
  its own budget (e.g. `geomCacheMB=X/Y`), not summed into the app/VRAM total.

### 3. Sized cache RAM — auto-detect + user override

- `byteLRU` gains `setBudget(n)`: updates `budgetBytes` and immediately `_evictUntilFit` to the new
  bound. (Today `budgetBytes` is a closure constant; this is the only API gap.)
- `geomCache` exposes `setGeomMemBudget(bytes)` → calls `_mem.setBudget(bytes)` and stores the value
  for telemetry.
- `uiStore` gains `geomCacheRamMb` (ref, persisted to `localStorage` key `qs-geom-cache-mb`, mirrors
  the existing `drawDistance` pattern) + `setGeomCacheRamMb(v)` clamped to **128–8192 MB**.
  - **Default (auto-detect):** from `navigator.deviceMemory` — `<4 → 256`, `4 → 512`, `≥8 (or
    undefined-but-not-low) → 1024` MB. A persisted user override wins over the auto value (this is
    what lets a 64 GB box exceed what `deviceMemory`'s cap of `8` can report).
- `WRITE_BUFFER_CEILING_BYTES` default 256 MB; scales with the configured budget (transient pool,
  freed on flush, so it does not need to be large).
- A Prefs / QuickPrefs slider binds to `geomCacheRamMb`. **Additive** — the store + apply path lands
  in this task; the exact UI control can ride QuickPrefs the same way the draw-distance slider is
  planned.

### 4. Front-load — per-region manifest prefetch

- A manifest record maps `regionHandle → array of geomKeys` seen during a visit. Stored in the
  `META` store (key e.g. `manifest:<regionHandle>`) or a small dedicated store.
- On `_loading` → false (visit settled), write the current region's requested-key set to the
  manifest. Size-capped (e.g. ≤ 20k keys) and recency-pruned (keep the N most-recent regions).
- On region entry, read that region's manifest → issue **one bulk `geomCacheGetMany`** → populates
  the (now larger) mem tier *before* the ObjectUpdate storm. Prims whose keys are resident then hit
  tier-1 synchronously via `geomMemGet` and never issue an IDB read or a bake during the burst.
- The manifest is a **hint, not authoritative**: missing keys, extra keys, or keys since LRU-evicted
  from IDB are all harmless — the normal `requestGeometry` read/bake path remains the source of
  truth. On the densest regions the tier still cannot hold everything; the remainder reads from IDB
  during the storm, but write-deferral (§1) keeps those reads fast.

---

## Data flow (warm revisit, after this design)

```
region entry
  └─ read manifest[regionHandle] ─ one bulk getMany ─→ populate mem tier (size = geomCacheRamMb)
ObjectUpdates stream in → drainMeshQueue → requestGeometry(key)
  ├─ geomMemGet HIT (prefetched)            → applySwap, no IDB, no bake          ← common case
  └─ mem miss → batched getMany (readonly)
        ├─ IDB HIT  → applySwap, promote to mem  (fast: no flush txns interleaved) ← write-deferral
        └─ IDB miss → worker bake → geomCacheStore → buffered (NOT flushed while loading)
load settles (engine loading→false)
  └─ flush _writeBuf once → write manifest → resume steady-state _readsInFlight gate
```

## Error handling / degradation

- `getMany` failure still degrades to all-miss (unchanged); the watchdog still backstops a starved
  read so the drain can never wedge.
- Byte/time ceilings guarantee `_writeBuf` and deferral duration are bounded even if the engine never
  signals `loading→false` (bug, or a continuously-streaming region).
- Manifest read/write failures are best-effort and never block load (try/catch → skip prefetch).
- `setBudget` to a smaller value evicts immediately; correctness is unaffected (evicted keys re-read
  from IDB or re-bake).

---

## Scope

**In:** `src/lib/geomCache.js`, `src/lib/byteLRU.js` (`setBudget`), one line of memGovernor
accounting in `src/composables/useWorldEngine.js`, `src/stores/uiStore.js` (setting), a Prefs/
QuickPrefs control, manifest persistence.

**Out (and why):**
- Main-thread saturation / draw-call instancing (item 11) — the *residual* risk if reads still time
  out after deferral; verify post-fix, address separately.
- texCache warm-read starvation — same pattern, separate DB and item.
- Mesh-cache tier (`getMeshBytes`) — same kind of CPU-RAM pool; pulling it out of the VRAM governor
  is a natural follow-up but kept out to bound blast radius.
- Live-scene / VRAM budget raise — risky (VRAM unqueryable), stays conservative; this is item 13.

---

## Testing

**Unit (vitest):**
- Deferral: with `setGeomCacheLoading(true)`, `geomCacheStore` followed by exceeding `FLUSH_MAX`
  does **not** flush (no readwrite txn); `setGeomCacheLoading(false)` flushes.
- Byte ceiling: buffering past `WRITE_BUFFER_CEILING_BYTES` while loading forces a flush + logs.
- Time ceiling: deferral > `MAX_DEFER_MS` forces a flush.
- `byteLRU.setBudget`: lowering the budget evicts oldest-first until it fits; raising does not evict.
- Manifest round-trip: write keys for a region, read them back; size cap + recency prune honored.
- Governor total: `setAppBytes` argument excludes `getGeomMemBytes()`.

**Live (the real bar — per the no-regressions rule):**
- Warm dense region: `idb` hits stay > 0 throughout the load burst, `wdog` ≈ 0, wall-clock load
  drops from minutes toward seconds.
- Cold region: still flushes (ceilings fire as expected), RAM stays bounded at the configured budget,
  no wedge.
- Cull-spiral telemetry (item 13): live geometry visibly receives the freed VRAM budget; no new
  `⚠THROTTLING` introduced by the cache decoupling.
- High-RAM override: setting `geomCacheRamMb` high on the 64 GB box yields more resident hits on
  revisit; setting it low evicts down without error.

## Cache-version note

This change touches cache *plumbing* (read/write scheduling, RAM budget, manifest) only — it does
**not** alter baked geometry output, so **no `GEOM_VERSION` bump** and no user cache wipe. (Geometry
deforms remain batched under item 8 per the cache-discipline rule.)
