# Tier-2 disk-backed asset cache

> Design spec, 2026-06-17. Makes the COLD/first-visit asset path fast by persisting fetched +
> transcoded assets to disk on the server, so the expensive grid-fetch + J2C→WebP transcode happens
> once ever (across clients, visits, and server restarts) instead of every cold load. Read
> `docs/render-cache-model.md` and FEATURE-GAPS "Cold-asset-pipeline work" first.

## Problem

Live cold-vs-warm measurement (Requiem, dense 256m, 4626 objs, 2026-06-17): **cold ~13 min**
(texture grid-fetch bound), **warm ~13–20 s** (`tex q=0`, all from the client's qs-tex IDB). The whole
usability problem is the COLD/first-visit asset path. Within it, the server-side bottleneck:

- The server's `assetMemo` (RAM LRU + in-flight coalescing, 384 MB) is **in-memory only** — lost on
  every server restart. The brake live-test was *double-cold* precisely because restarting the server
  flushed it.
- Each grid asset fetch takes **2–3 s**; the J2C→WebP transcode pool is **w=4**; sustained throughput
  ~15 textures/min; plus repeated `http_404` waste on assets the grid lacks.

So even though assets are **immutable by UUID** (a perfect cache key), the server re-fetches +
re-transcodes them on every cold load and every restart. A disk-backed Tier-2 cache fixes this: the
first client to load a region pays the grid cost once; every later client / visit / restart is served
pre-transcoded bytes from disk.

This does NOT replace the per-client qs-tex IDB cache (which makes *that client's own* revisit ~13 s).
It fixes the *first* visit for everyone after the first-ever, and survives server restarts.

## Architecture — read-through layer BEHIND the existing RAM memo

The RAM `assetMemo` stays exactly as-is: hot tier + concurrency gate (coalescer). The disk cache slots
**inside** the memo's `work()` closure, so it runs only on a RAM miss and coalescing automatically
covers disk reads:

```
request → assetMemo.memo(key)                ← RAM hit → return instantly (+ coalesce concurrent)
            └─ work()  [runs on RAM miss only]:
                 1. diskCache.get(key)        → disk HIT → return payload (NO grid, NO transcode)
                 2. diskCache.isNegative(key) → fresh 404 → return null fast (NO grid)
                 3. grid fetch + transcode    ← existing code; the only slow path
                 4. on success → diskCache.put(key, payload)
                    on 404     → diskCache.putNegative(key)
                 5. return payload
```

`key = "${assetType}:${uuid}"` (the same key the RAM memo already uses). Assets are immutable by UUID
→ **no invalidation logic, ever**. Returning `null` from `work()` is not cached in RAM (existing
behavior: `_put` only on `v != null`), so a retry re-enters `work()` and hits the fast disk-negative
path instead of re-firing a 2–3 s grid fetch — this is what kills the 404 retry waste.

**Negative-cache ONLY a definitive 404 (not-found), never a transient failure.** The grid fetch can
fail from a 404 (asset genuinely absent — safe to remember for `NEG_TTL_MS`) OR from a timeout /
network error / 5xx (transient — the asset may well exist). `putNegative` is called **only** when the
failure is a confirmed 404; timeouts/5xx fall through uncached so the next attempt retries normally.
(The handler already surfaces 404 distinctly — it logs `http_404`; step 4 keys off that, not any
error.)

## Components

### New: `server/lib/assetDiskCache.ts` (focused module wrapping `bun:sqlite`)

`bun:sqlite` is built into Bun (no dependency). The module is the only place that touches SQLite.

Schema (created on open if missing):

```sql
CREATE TABLE IF NOT EXISTS assets (
  key      TEXT PRIMARY KEY,   -- "assetType:uuid"
  data     BLOB    NOT NULL,   -- RAW asset bytes (transcoded WebP for textures; raw for mesh/etc.)
  mime     TEXT    NOT NULL,
  hasAlpha INTEGER,            -- 0/1, NULL for non-texture
  bytes    INTEGER NOT NULL,   -- data.length, for LRU accounting
  accessed INTEGER NOT NULL    -- ms timestamp, bumped on get (LRU recency)
);
CREATE INDEX IF NOT EXISTS idx_assets_accessed ON assets(accessed);
CREATE TABLE IF NOT EXISTS negatives (
  key TEXT PRIMARY KEY,
  at  INTEGER NOT NULL         -- ms timestamp of the 404
);
```

WHY raw bytes not base64: the client `AssetPayload` carries `dataB64` (base64), but storing base64 on
disk is +33% bloat. Store raw `Uint8Array`/`Buffer` bytes; reconstruct the payload on read
(`dataB64 = base64(data)`). The base64 encode cost on a disk hit is negligible vs. the 2–3 s grid
fetch it replaces, and disk hits only happen on RAM misses.

`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;` (cache data is rebuildable; WAL + NORMAL is
the fast/durable-enough balance). Keep an in-memory `_totalBytes` seeded from `SELECT SUM(bytes)` at
open, incremented on put / decremented on evict — so no `SUM` per put.

Public API (all synchronous — `bun:sqlite` is synchronous; blob writes of ~30–560 KB are sub-ms):

| Method | Behavior |
|---|---|
| `get(key): AssetPayload \| null` | Row → bump `accessed`, return `{ dataB64, mime, ...(hasAlpha!=null ? {hasAlpha:!!hasAlpha} : {}) }`. Miss → null. |
| `put(key, payload)` | Decode `dataB64`→bytes, upsert row (`accessed=now`), update `_totalBytes`, then evict-if-over. |
| `isNegative(key): boolean` | Row with `at > now - NEG_TTL` → true; expired row → delete + false; no row → false. |
| `putNegative(key)` | Upsert `negatives(key, now)`. |
| `stats()` | `{ size, bytes, hits, misses, evictions, negSize }` for the log line. |

Eviction (`put`, when `_totalBytes > cap`): delete oldest-accessed rows until under cap —
`DELETE FROM assets WHERE key IN (SELECT key FROM assets ORDER BY accessed ASC LIMIT ?)`, decrementing
`_totalBytes` by the removed rows' `bytes` (select them first to sum, or loop). Negatives expire
lazily on `isNegative`.

### Modify: `server/handlers/assets.ts`

- Construct one `assetDiskCache` instance alongside the existing `assetMemo` (guarded by the disable
  flag → a null-object no-op when disabled).
- Inside the memo `work()` closure, implement the 5-step read-through flow above (disk get →
  negative check → grid fetch → disk put / putNegative).
- Extend the periodic `[AssetMemo]` log line with disk stats: `disk hits=… miss=… MB=… evict=… neg=…`
  so the payoff is live-verifiable (a second cold visit should show disk hits climbing and grid
  fetches dropping).

## Error handling — the cache must NEVER break asset serving

Every disk operation is wrapped in try/catch. On any failure (corrupt DB, disk full, lock contention)
it logs **once** (rate-limited, not per-op) and **falls through to the grid fetch** (for `get`/
`isNegative`, treat as miss; for `put`/`putNegative`, swallow). On open failure → delete the DB file +
recreate; if that also fails → run as a disabled no-op. The cache is a pure optimization, never a
dependency. The server must start and serve assets even if the disk cache is completely unavailable.

## Configuration (env vars, sensible defaults)

| Env | Default | Meaning |
|---|---|---|
| `ASSET_DISK_CACHE` | `1` (on) | `0` disables entirely (no-op object). |
| `ASSET_DISK_CACHE_PATH` | `.cache/assets.sqlite` | DB file path. Add `.cache/` to `.gitignore`. |
| `ASSET_DISK_CACHE_BYTES` | `8 * 1024**3` (8 GB) | LRU size cap (disk-bound; bump on VPS/NAS). |
| `ASSET_DISK_NEG_TTL_MS` | `6 * 3600 * 1000` (6 h) | Negative (404) entry lifetime. |

## Testing — `server/__tests__/assetDiskCache.test.ts` (bun test)

Use a temp file path per test (e.g. under `os.tmpdir()`); clean up in `afterEach`. `bun:sqlite` works
in bun test.

1. **roundtrip:** `put` then `get` returns an identical payload — exact `dataB64` bytes, `mime`, and
   `hasAlpha` (texture) / absent `hasAlpha` (mesh). Missing key → `null`.
2. **LRU eviction:** with a tiny cap, put N assets past the cap → oldest-accessed evicted, most-recent
   survive; a `get` on an old key bumps its recency so it survives the next eviction.
3. **negative cache:** `putNegative` → `isNegative` true; with `NEG_TTL_MS` set tiny and a forced
   clock gap, the entry expires → `isNegative` false and the row is purged.
4. **persistence (the whole point):** open at a temp path, `put`, close, reopen the SAME path → the
   asset is still there via `get`, and `_totalBytes` re-seeds correctly.
5. **resilience:** `ASSET_DISK_CACHE=0` (disabled) → all ops are safe no-ops (`get`→null, `put`→
   nothing, never throws). Corrupt/garbage DB file at the path → open recovers (recreate) and serves.

(Time-dependent tests inject `now` via an optional param or a clock function so they don't sleep.)

## File structure

| File | Responsibility | Change |
|---|---|---|
| `server/lib/assetDiskCache.ts` | SQLite-backed Tier-2 store (the only SQLite touch point) | CREATE |
| `server/__tests__/assetDiskCache.test.ts` | unit tests | CREATE |
| `server/handlers/assets.ts` | wire read-through + negative caching + log | MODIFY |
| `.gitignore` | ignore `.cache/` | MODIFY |

## Out of scope (separate lined-up items)

- The **~5-min front stall + throughput** investigation (pool workers / dispatch / head-of-line) —
  FEATURE-GAPS cold-pipeline #2. This spec reduces *repeat* cold cost; it does not change first-ever
  throughput.
- **Idle-time client texture auto-backfill** — FEATURE-GAPS #3.
- **Raising the qs-geom IDB disk cap** — the logged quick win (client-side, unrelated to this server
  module).
- Hybrid blob-on-FS storage — rejected (overkill for 30–560 KB assets).

## Acceptance

- `bun test server/__tests__/assetDiskCache.test.ts` green; full server suite at baseline.
- Server starts with the cache enabled and with `ASSET_DISK_CACHE=0`; starting twice persists the DB.
- Live: cold-load a fresh region (grid fetches + `[AssetMemo] disk miss` climbing, DB file grows);
  **restart the server**; revisit the SAME region → `[AssetMemo] disk hits` dominate, grid `[Asset]`
  lines drop sharply, load time collapses from ~13 min toward ~1–2 min.
- Gene commits (he commits).
