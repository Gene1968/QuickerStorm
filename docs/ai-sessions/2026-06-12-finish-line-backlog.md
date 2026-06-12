# AI Session — Finish-Line Backlog Items 1–4 (+ render-killer root-cause)

Date: 2026-06-12 (autonomous session) · Branch: phase3 · Tool: Claude Code (Fable 5) · Reviewer: Gene

## 1. crc-probe-audit (backlog #1) — RESOLVED

The "sim re-feeds ~20k updates on reload" was three separate artifacts:

1. **Counter misread** — `decoded=` in `[PrimDiag]` is cumulative per circuit; Bountiful Sandbox
   trickles ~8 live updates/s (~29k/h, terse+full for movers). "23.5k for 5,626 objects" ≈ 49 min
   of normal trickle. True cold re-feed duplication measured at only **1.2×** (decoded=6,736 /
   distinct=5,572 on a clean cold load).
2. **REAL BUG: `objCacheClearRegion` wedge** — deleted one record per cursor step; 5,648 steps
   under cold-load longtask starvation took **6.5 minutes** (measured live), queueing every
   qs-objects txn behind it. `preseedRegionCache` awaited it with no log before the await and no
   `tx.onabort` route → when the txn aborted, preseed hung FOREVER, silently: no probe resync,
   scene starved at 47/5,572 prims.
3. **REAL BUG: crcMap session poison** — `getRegionCrcMap` raced a 3s timeout against a
   per-record cursor walk; behind write pressure it timed out and the catch memoized the EMPTY
   map for the whole session → every probe partitioned as a miss → request-all ("asked 19.9k of
   24k").

**Fixes** (`src/lib/objectCache.js`, `src/composables/useWorldEngine.js`):
- clearRegion: atomic `count + delete(IDBKeyRange.bound([key,-Inf],[key,Inf]))`; awaits in-flight
  flush first; throws on failure (caller handles).
- `txDone()` helper adds **onabort** to every objectCache txn; reads got tx-level onabort too.
- crcMap read: one `getAll` request instead of a cursor walk; throws so the caller degrades.
- preseed: purge wrapped in try/catch — failure logs, skips the run-marker write (next session
  retries), ALWAYS requests probe resync; invalidates the crcMap memo post-purge.
- crcMap memo: seeded free from preseed's getAll (warm-path probes never touch IDB at all);
  failures un-memoize (promise-identity guard) so one starved batch ≠ poisoned session.
- Tests: objectCache.test.js 3 → 12 tests.

**Live-verified** (fresh circuits, Bountiful Sandbox): warm login → 5,156 probes replayed,
`asked=0`, scene 5,572/5,572. Cold (run-marker wiped) → purge instant, all-miss re-feed completed
in <1 min.

**Sim-side facts** (opensim master source): probes/full/compressed all carry the PART's
PseudoCRC (the `ParentGroup.PseudoCRC` encoder is commented-out dead code); PseudoCRC and CacheID
both persist in the region DB (CacheID re-randomizes only on OAR load); `RequestPrim` answers one
part per request (no group fan-out); handshake Flags=0 → sim probes all `IsViewerCachable` groups
on entry, full-updates the rest.

## 2. Storage budget (backlog #2) — SHIPPED

- **qs-geom**: CAP_FRACTION 0.2→0.3, hard max 2→4GB (was 97% full after two regions).
- **qs-mesh v3** (was UNBOUNDED): lastUsed index + batched touches + put-time LRU eviction
  (textureCache pattern), cap 0.1×quota / max 1GB, onabort on every txn, onblocked/onversionchange.
  ⚠ **v3 upgrade drops v2 records** (they lack lastUsed → would be unevictable). One-time cost:
  cold mesh re-fetch per asset — largely masked because qs-geom baked-geometry hits skip the raw
  read; measured ~1.1k assets re-fetched in ~8 background minutes while the scene stayed usable.
- **Unscaled mesh/sculpt bakes**: `m1→m2`, `s1→s2` keys drop the scale hash; bakes dispatch at
  scale [1,1,1]; the existing applySwap cur/bakeScale ratio re-applies prim scale on serve; sync
  tier-1 hits scale via bakePrimScale. Submesh bakes are LINEAR in scale, so this is exact (and
  BufferGeometry.scale handles non-uniform normals). Kills the per-scale duplication that was
  11.7k of 14.4k qs-geom entries. Old m1/s1 entries age out via LRU (no migration).
  ⚠ One-time m2/s2 re-bake on first load per region. Live-verified: proportions correct, mem-tier
  dedup visible (same asset at different scales = sibling serves), warm reload served 100% of mesh
  geometry from qs-geom with ZERO qs-mesh reads.

## 3. Texture bulletproofing (backlog #3) — SHIPPED

Applied the item-1 lesson everywhere: an aborted IDB txn settles neither oncomplete nor onerror,
so awaits hang forever. A hung `texCacheGet` froze that uuid's `blobInflight` promise — every
later request joined it → the full-queue stall Gene saw (session-degradation, never reproduced
fresh).

- `texCacheGet`: **10s watchdog → resolves null (miss)** — a wedged read degrades to a network
  re-fetch (server memoizes) instead of freezing the texture pipeline; logs trip counts.
- onabort handlers on every textureCache txn (get/put/touches/stats/failedLoad/failedMark/clear).
- geomCache got the same onabort treatment (flush/touches/getMany/evict/stats/clear) — a hung
  getMany would have stalled the whole build drain.

## 4. Lit shading (backlog #4) — SHIPPED (calibration pending Gene's A/B)

**(a) auto-off trigger**: restored designed thresholds (20 FPS / 10s — Gene had detuned to
4/45s to dodge transients) and added two gates:
- *Load gate*: build/fetch activity (buildQ>50, tex/mesh queues, geomPending>25) + 5s settle
  window — low FPS during loads never counts.
- *Main-thread discriminator*: if longtasks ate >30% of the FPS window (texture-apply tail,
  geometry deserialize, GC), the frame rate is main-thread-bound — disabling lit shading (a
  GPU/fragment cost) cannot recover it, so it doesn't count. Uses a never-reset longtask
  accumulator (`_ltTotalMs`) fed by the existing PerformanceObserver.
Verified live: lit shading survived a full cold load at 4–11 FPS (previously auto-disabled).

**(b) lighting calibration**: root cause of "darker/less-red vs FS" = **ACESFilmicToneMapping**
(darkens mid-tones, desaturates/hue-shifts reds, applies to unlit fragments too). FS's legacy
pipeline applies no filmic curve. Switched to `NoToneMapping` (output stays SRGBColorSpace) and
re-balanced lights for it: sun 1.0 (was 1.2), fill 0.3 (was 0.45), ambient 0.45 (was 0.5).
⚠ **Needs Gene's visual A/B vs Firestorm** — autonomous screenshots look sane (no blow-out,
correct path/sky exposure) but color calibration is a human call.

## Render-killer root-caused en route (the biggest find)

**Symptom**: black/partial viewport, "page unresponsive", session-wide build stall, 4,625
per-frame exceptions: `TypeError: Cannot set properties of undefined (setting 'value')` in
three's `refreshUniformsCommon` — ONE poisoned mesh makes `renderer.render` throw every frame,
killing everything after it in `animate` and starving every interval.

**Root cause**: `_placeholder` objects skip `hasMaterial` → creation material is **MeshBasic** —
but the PBR/legacy material blocks didn't exclude placeholders, so the async legacy-materials
callback assigned **normalMap onto a MeshBasicMaterial**. Basic's program has no normalMap
uniforms → three throws at `uniforms.normalMap.value`. Initial-load-only (placeholders come from
the cache-paint path) — which is why it looked like a heisenbug (1, 4, then 89 poisoned meshes
across runs; resync rebuilds never reproduced). Forensic chain: per-frame stack → onBeforeRender
culprit tagging → material state dump (`Basicv3+map+nrm`) → prototype setter trap → quarantined-id
correlation (20/20 had legacy defaultMaterialId).

**Fixes**:
- `!obj._placeholder` added to BOTH material-block guards + `isMeshStandardMaterial` guard on the
  normalMap assignment (useWorldEngine.js ~1988/2009).
- **Render quarantine guardrail** (keep regardless): `renderer.render` wrapped in try/catch; the
  thrower (tracked via a shared `onBeforeRender` hook) gets a fresh placeholder material on
  strike 1, hidden on strike 2, with forensic material-state logging. One poisoned mesh now costs
  one placeholder prim instead of the whole session.

## Suggested commit split (subjects ≤50 chars; Gene commits)

1. `fix(cache): objCache purge wedge + onabort hangs` — objectCache.js, useWorldEngine
   preseed/crcMap, objectCache.test.js
2. `feat(cache): qs-mesh LRU cap + geom cap 0.3/4GB` — meshCache.js v3 (⚠ drops v2 records),
   geomCache.js constants, both test files
3. `feat(render): unscaled m2/s2 mesh bakes` — geomKey.js, useWorldEngine bakeScale/tier-1
   scaling, geomKey.test.js (⚠ one-time region re-bake)
4. `fix(tex): texCacheGet watchdog + IDB onabort` — textureCache.js, geomCache.js onabort
5. `fix(render): placeholder mats poisoned MeshBasic` — the two `!obj._placeholder` guards +
   isMeshStandardMaterial guard
6. `feat(render): quarantine render-killing meshes` — animate try/catch, _noteDraw hook
7. `feat(render): gate lit auto-off on load+longtask` — updateFps gates, restored 20FPS/10s
8. `feat(render): NoToneMapping + FS-style lighting` — renderer init + light intensities
   (**A/B vs Firestorm before committing this one**)

## Watch items / open

- A **256m sky/horizon dome mesh** (multi-face, legacy materials) is among the placeholder-race
  victims — if Gene ever sees a black world with the quarantine log naming a ~256m mesh, that's it.
- Heap creep (backlog #5) still open: one renderer OOM-crash-like page reload observed during a
  texture-apply tail; cross-reload accumulation (worker-isolate phantom heap) reconfirmed —
  fresh-tab baseline was healthy (6–9%) so the leak hunt needs a single long, focused session.
- Unfocused pages build at near-zero rate (rAF-assist skips `!document.hasFocus()`); intentional
  design, but it confounds any automated testing — clicks/focus required.
- OpenJP2 "Tile part length size inconsistent" decode failures for a handful of textures
  (server-side, pre-existing).
- `[Probe] rx batch` / probe-flow client logs relay as `[ClientLog/info]` at WARN level (cosmetic).
