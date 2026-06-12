# AI Session — Instant-Load Geometry Cache

Date: 2026-06-12 · Branch: phase3 · Tool: Claude Code (Fable 5) · Reviewer: Gene

## What shipped (committed by Gene 2026-06-12)

Baked-geometry cache: `qs-geom` IndexedDB (own DB = own lock domain) + 128MB in-memory
byteLRU dedup tier, keyed by shape+scale hash (all 18 PrimShape fields + GEOM_VERSION).
Warm region re-entry rebuilds geometry from cache instead of re-baking; identical
shape+scale prims bake once per session; mesh/sculpt hits skip the qs-mesh raw read.
Memory-tier hits build final geometry with no placeholder cube. Deferred misses count
into the bake inflight cap (`_geomPending`). Telemetry: `[Bake] geomCache hit/miss/pend`,
`[Mem] geomCacheMB`, Prefs ▸ Network Geometry Cache card.

Spec: `docs/superpowers/specs/2026-06-12-instant-load-geometry-cache-design.md`
Plan: `docs/superpowers/plans/2026-06-12-instant-load-geometry-cache.md`

## Live-verify results (two regions)

- Warm `[Drain] built=748 (150/s)` vs ~30–37/s historical; ~95% cache hit rate;
  worker bake ~10ms TOTAL per 3s window (previously the cold-load bottleneck).
- qs-geom after two regions: 15,885 entries / 1.95GB — **97% of the 2GB cap**.
  11.7k entries are per-scale mesh copies → cap economics is the follow-up.
- Solved en route: "striping/dark trees on soft load, fixed by hard reload" =
  lit-shading auto-off (<20FPS, `useWorldEngine.js:3408`) used to fire during slow
  cold loads; fast cached loads keep FPS up so lit stays on (murky until lighting
  calibration lands). Gene additionally observed planar texture-repeat artifacts in
  transparent areas — kept open as a cache-adjacent watch item (finishGeom re-runs
  planar texgen on cache hits).

## Review-process catches worth remembering

- Duplicate keys in one lookup batch must NOT share one clone (in-place rescale/UV
  regen would cross-contaminate sibling meshes) — by-key grouping + per-entry clones.
- Deferred bake dispatch blinded the BAKE_INFLIGHT_CAP gate → `_geomPending`.
- totalBytes drift on same-key re-put (content-hash keys make overwrites byte-identical
  → count `added` only for new keys).
- Both `setAppBytes` call sites (cullTick + stats timer) must sum identically.

## Prioritized backlog (the finish line)

Goal state: visit any region daily → geometry instant ✅, objects not re-fed by sim,
textures paint in seconds without stalls, lit shading on without murk, no OOM on long
sessions. Items 1–5 reach it; 6+ is polish/scale.

1. **crc-probe-audit** — sim re-feeds ~20k updates for ~5k objects on reload (now the
   dominant reload cost). The CRC cache machinery exists (qs-objects v6, OBJ_CACHE_PROBE,
   2026-06-07 spec); this is a diagnosis: why isn't it suppressing the re-feed?
2. **Storage budget** (small, independent) — interim qs-geom cap bump (0.2→0.3 fraction,
   2→4GB max); cap qs-mesh (unbounded today); per-cache quota shares vs ~11.6GB origin
   quota (qs-tex holds 60%). Structural: store mesh bakes unscaled + bake scale on hit
   (kills the per-scale duplication that fills the cap).
3. **Texture bulletproofing** — the 38s/178s texCacheGet wedge + full-queue stall
   (session-degradation; didn't reproduce fresh). Revisit after #1 if not resolved.
4. **Lit shading viability** — (a) auto-off trigger math (don't judge FPS during load
   transients; Gene drops to 5fps long-term during loads on a top-tier rig);
   (b) lighting calibration (sRGB/sun-ambient) so lit mode isn't murky.
5. **OOM heap creep** — ~25MB/min unaccounted on long hot loads → 4.2GB crash.
6. **Draw-call instancing/merging** (tech-debt render-draw-calls).
7. **Watch/small**: planar-repeat striping in transparency (cache-adjacent);
   qs-geom onblocked/onversionchange before first DB_VERSION bump; drain brkCap tuning;
   `[INV] cap_unavailable` log spam → summarize.
8. **Further out**: per-face material continuation (point lights, shiny/glow/glass),
   rigged-mesh bind-pose, cross-region TP EventQueueGet, CoarseLocationUpdate map dots,
   springback, Layer-A var-region TP verify.
