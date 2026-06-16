# qs-tex write-deferral — texture-side warm-read decouple (FEATURE-GAPS #11 / #10-for-textures)

**Date:** 2026-06-16
**Area:** Render / Cache (#11 main-thread / IDB read-starvation)
**Status:** design approved, pre-implementation

## Problem (code-confirmed via live `__texStats` + `[Main] phases`)

After #11 Pass 2 (off-main-thread decode) shipped, the `[Main] phases` probe shows `texbuild=3ms` —
texture decode/upload is no longer a main-thread cost. But the texture network queue still climbs into
the thousands and barely drains:

- `queued: 2876`, `qWait avg: ~20 min` (max 57 min), drain ≈ 0.7/s.
- `net: ~1.2s`, `srv: ~1.2s` (fetch + transcode are fast), but **`idb: avg 7.4s` (max 33s)** — each of the
  6 network slots burns ~7.4s on its IndexedDB re-check before it even fetches.

**Root cause (confirmed in `textureCache.js`):** `texCacheGet` uses a `readonly` txn (lines ~136), but
`texCachePut` fires a **separate `readwrite` txn per call** (line ~187), each doing put + `mt.get('stats')`
+ `st.count()` (+ an eviction cursor-walk when over the IDB cap). Because the writes share the `STORE`
scope with the reads, IndexedDB **serializes every read behind all preceding writes**. ~1,751 write-txns
× a few ms each ≈ the ~7s the reads measure. It is *not* decode (texbuild=3ms) and *not* main-thread CPU
(`render` dominates the thread, not texture work) — it is **qs-tex store-lock contention from per-put
writes**.

This is the texture-side of the geom warm-read problem (#10), which was fixed for `geomCache.js` but
**never ported to `textureCache.js`**. The fix is a faithful port of that committed, battle-tested pattern.

## Goal

Stop `texCachePut` from holding the `STORE` write-lock so often/long, so the `readonly` `texCacheGet`
reads stop serializing behind a write convoy:
1. `idb` read latency: ~7.4s → ~ms.
2. Network slots cycle at real grid speed; `queued` drains instead of climbing; `qWait` collapses.

**Non-goals (deferred):**
- Time-boxing the per-slot IDB re-check in `useTextureFetch._wsFetch` (earlier "lever 1") — dropped. With
  reads fast again it's unnecessary, and it would only add spurious grid refetches.
- `render=703ms` is now the dominant main-thread phase (fps ceiling) — a separate LOD/cull track, out of
  scope here.
- The in-memory `cache.size` drop (pruneTexturesLRU over the app budget) is a separate layer — watch item,
  not this fix.
- **No `DB_VERSION` bump** — the stored record shape (`{uuid, blob, bytes, hasAlpha, lastUsed}`) is
  unchanged, so **no cache wipe**.

## Architecture — port the geomCache write-deferral to textureCache

Mirror `geomCache.js`'s proven structure. All changes are in `src/lib/textureCache.js` plus one engine
signal wire-up.

### 1. In-memory write buffer (coalesce, latest-wins)
- `_writeBuf: Map<uuid, {uuid, blob, bytes, hasAlpha, lastUsed}>` — `texCachePut` writes here instead of
  opening a txn per call. Latest-wins (re-put of a uuid overwrites, adjusting `_writeBufBytes`).
- `_writeBufBytes` running sum (byte ceiling, O(1)); `_writeBufHardCap` (textures are small WebP blobs,
  ~3–20 KB; cap modest, e.g. 128 MB) — past the hard cap, skip buffering NEW uuids (overwrites of already
  buffered uuids still proceed) so the buffer can't OOM. `_writeBufDropped` telemetry counter.

### 2. Batched flush — one `readwrite` txn per flush window
- `_flushNow(force)` drains the whole `_writeBuf` in **one** `[STORE, META]` `readwrite` txn: put every
  buffered record, then do `count()` + over-cap eviction-cursor-walk **once** for the batch (port geom's
  `afterAllKeys` logic), write META `{totalBytes, count}`, stage `_lastStats`.
- `FLUSH_MS = 300`, `FLUSH_MAX = 256` (texture records are small → batch more than geom's 200).
- `_scheduleFlush()` arms a `FLUSH_MS` timer; `FLUSH_MAX` punch-through flushes immediately when not loading.

### 3. Loading gate (suspend flushes during the fill burst)
- `setTexCacheLoading(v)` — engine signal, mirrors `setGeomCacheLoading`: while `_loading`, suspend the
  FLUSH_MS/FLUSH_MAX flushes; only the byte ceiling (`_ceilingBytes`, e.g. 64 MB) / time ceiling
  (`_maxDeferMs = 30000`) / explicit force can flush. `LOADING_EXIT_DEBOUNCE_MS = 750` trailing debounce;
  on settle edge, a final `_flushNow(true)`.
- Wired in `useWorldEngine.js` right beside the existing `setGeomCacheLoading(loading)` (line ~3426), using
  the **same `loading` boolean** (`pendingMeshIds.size > 50 || tStat.queued>0 || tStat.inflight>0 || …`).

### 4. Read-priority gate
- `_readsInFlight` counter: `texCacheGet` does `_readsInFlight++` at entry / `--` when it settles. `_flushNow`
  defers a non-forced flush while `_readsInFlight > 0` (unless `_writeBuf.size >= FLUSH_MAX`), so a flush
  txn never queues ahead of an in-flight read. Direct port of geom's gate.

### 5. Read sees buffered writes
- `texCacheGet` checks `_writeBuf` FIRST and returns the buffered `{blob, hasAlpha}` on hit (touching
  `lastUsed`), so a just-`Put` texture is immediately readable without a spurious network refetch while it
  sits unflushed. (Critical: otherwise a concurrent request for the same uuid would miss IDB → refetch.)

### 6. Lifecycle
- `clearTextureCache()` clears `_writeBuf` + `_writeBufBytes` (in addition to the existing store clear).
- `pagehide` listener → `_flushNow(true)` so a tab close persists buffered textures (mirrors geom).
- `getTextureWriteBufStats() → { bytes, dropped }` for telemetry; surfaced on the engine `[Drain]` line.

## Data flow

```
texCachePut(uuid, blob, hasAlpha)
  → _writeBuf.set(uuid, {…})  (+_writeBufBytes; drop NEW keys past hard cap)
  → _scheduleFlush()          (suspended while _loading except ceilings)

texCacheGet(uuid)
  → _readsInFlight++
  → if _writeBuf.has(uuid): return buffered {blob,hasAlpha}   (no txn)
  → else readonly STORE txn (concurrent — no longer blocked by a per-put write convoy)
  → _readsInFlight--

_flushNow(force)            (FLUSH_MS timer / FLUSH_MAX / ceiling / settle / pagehide)
  → if !force && (_loading | _readsInFlight>0) && size<FLUSH_MAX: re-arm, return
  → one readwrite [STORE,META] txn: put all buffered; count()+evict once; META; stage _lastStats
```

## Error handling
- All flush/persist paths best-effort (swallow IDB errors), matching the current `texCachePut` try/catch.
- A flush failure leaves records dropped from the buffer (already cleared) — they re-fetch + re-persist on
  the next request; no corruption, consistent with geom.
- Buffered-but-unflushed textures lost on a hard crash before flush → re-fetched next visit (acceptable;
  not data the user owns).

## Testing
- `src/__tests__/lib/textureCache.test.js` (extend; jsdom uses fake-indexeddb as the existing suite does):
  - `texCachePut` followed immediately by `texCacheGet` for the same uuid returns the blob **before any
    flush** (served from `_writeBuf`).
  - Multiple `texCachePut` calls within a window result in a single flush txn (assert via a spy/wrapper or
    by observing that `getTextureCacheStats` count updates once after the flush window) — at minimum assert
    correctness: after the flush window, all puts are durably gettable.
  - `setTexCacheLoading(true)` suspends flushing (buffered count stays in `_writeBuf`, store not yet
    written); `setTexCacheLoading(false)` → after debounce, a flush persists them.
  - `getTextureWriteBufStats()` reports buffered bytes and drops.
  - Pure helpers (`planEvictions`, `resolveCacheCap`, `selectLiveFailed`) remain green.
- Full suite + `npm run build:staging`/`build:prod` green.
- **Live-verify (Gene):** on the same heavy region, `idb avg` collapses from ~7.4s to ~ms; `queued` drains
  and `qWait` drops from ~20 min; textures still persist (reload is warm); no flipped/missing textures.

## Risks / watch items
- Buffered Blob memory — bounded by `_writeBufHardCap`; textures are small, so this is far less risky than
  the geom array buffer that once OOM'd (the geom hard-cap lesson is carried over).
- Stats lag — `_lastStats` reflects flushed state; buffered-unflushed puts aren't counted until flush
  (cosmetic, Prefs panel only).
- Eviction correctness under batching — port geom's "getKey-before-put / never-evict-just-written" guard so
  totalBytes can't drift and trigger spurious evictions.
- The `loading` boolean already includes `tStat.queued>0` — so during a long texture fetch the buffer can
  stay deferred a while; the byte/time ceilings bound that (one short batched flush at the ceiling, far
  better than 1,751 per-put txns).
