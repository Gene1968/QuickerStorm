# 2026-06-11 — Busy-region death spiral, asset-pipeline stalls, recovery UI

**Tool:** Claude Code (Fable 5) · **Reviewer:** Gene · **Branch:** phase3

## Symptom

On a 24k-object region after cache clear: objects loaded to ~90% then dropped to zero; alternating
hard reloads gave a blank region; objects vanished after idling. Resync World couldn't recover it.

## Root causes (confirmed via added [Cull]/[Mem] instrumentation; no [KillObj] — purely client-side)

1. **Unbounded decoded-mesh RAM cache** grew to ~1.1GB and pinned `performance.memory` above the
   culler (0.78) and governor (0.85) thresholds permanently → `cullTick` evicted 32 roots+children
   every second forever while `drainMeshQueue` refused to rebuild. End state: 24 objects resident,
   heap still 87%.
2. **Process-heap signal lies**: it counts uncollected garbage, and a hard-reloaded page can inherit
   the previous page's heap in the same renderer process (observed 92% with zero app content) →
   governor blocked all intake from the first frame → blank region.
3. **Asset pipeline discarded late arrivals**: grid responses landing just past the 30s client
   timeout were thrown away and re-requested from scratch — a zero-progress loop (8.8k textures
   queued, success counter frozen). Server handlers were stateless: every retry refired the grid
   fetch AND the J2C decode, keeping the decode FIFO minutes deep.
4. **Texture starvation by shared budget**: once geometry saturated the global budget, texture
   intake paused permanently — scene built, stayed white.

## Fixes shipped (all live-verified except where noted)

- `src/lib/byteLRU.js` (new, tested): generic byte-budget LRU → mesh-asset RAM cache capped 256MB.
- `memGovernor` v2: self-accounted budget (tex+meshCache+geometry bytes vs min(1536MB, 0.40×limit));
  process heap only as a corroborated near-OOM brake (`emergencyHeap`: >0.92 AND appRatio>0.5).
  Works on non-Chrome too.
- `selectEvictions(…, minDist=R_NEAR)`: near objects are never evicted — culler converges to
  "surroundings stay" instead of empty.
- Recovery: Advanced ▸ **Rebuild Scene** (clears evicted set, re-queues all known meshes, resyncs)
  + auto-fire on dead-scene detection (known>200, resident=0, 3 scans, 120s rate limit).
  Tooltips added distinguishing it from Resync World (quick replay vs thorough rebuild).
- Fetchers: late arrivals persisted to IDB with failure marks cleared (`late=` counter); queued
  fetches re-check cache at slot-open; texture intake gets its own 320MB budget.
- Server: `server/lib/assetMemo.ts` (new, tested) — byte-LRU + in-flight coalescing for texture
  (384MB) and decoded-mesh (256MB) payloads; errors never cached. `late=` in ClientDiag formatter.
- rAF: `animate()` drains the mesh queue only when the 30ms interval is starved (>100ms), removing
  a constant ≤8ms/frame tax. Remaining violations = draw-call cost (see tech-debt `render-draw-calls`).
- Logging: per-asset server lines sampled (first 10 then 1/25); [Mem]/[Main] relayed every ~9s.
- Test fixtures: `.j2c` files restored from git history into `server/__tests__/fixtures/` (runtime
  copies were replaced by .webp in 17b14d4).

## Outcome

Region loads fully; budget converges ~97% with far-linkset eviction churn only; zero fetch
timeouts; textures fill at grid speed and accumulate in IDB across visits. Residual white on first
visit = grid-side delivery rate (likely per-IP throttle) — superseded by the planned webp
texture-cache rewrite. 133 server + 96 client lib tests pass.

## Follow-ups

Tech-debt rows added: `render-draw-calls` (next render project), `tex-netqueue-closures`,
`gpu-texture-dispose`, `shader-precompile-frame`, `server-asset-fifo-no-cancel`.
