# AI Session — 2026-06-24/25 — Camera-driven interest filter shipped (+ var-region, dupe, slider)

**Branch:** `phase3` (interest-filter work merged from `ai/interest-filter`, then iterated directly).
**Outcome:** Heavy-region streaming via a Bun-side camera interest list — built, live-validated on Aspen, default-on, committed. Plus three adjacent fixes surfaced during live testing.

## What shipped (committed)

1. **Camera-driven interest filter** (`feat(interest): on by default + load/TP fixes`, `0629af1`; earlier pieces in the `ai/interest-filter` merge).
   - The Bun relay (`server/lib/interestFilter.ts` + `server/handlers/lludp.ts`) forwards to the browser only objects inside a **camera-centred sphere** (radius = client draw distance, server-clamped 32–512), streaming `enter` (replay) / `KillObject` as the camera moves. Hysteresis ×1.15 on leave. Avatars always kept.
   - **Client-driven radius**: client sends `interestRadius` in each `MOVE`, from `uiStore.drawDistance`, governor-clamped + FS-style arrival ramp (`src/lib/interestRadiusClient.js`).
   - **Cull vs delete**: interest leaves send `KillObject {cull:true}` so the client keeps its `qs-objects` descriptor (warm-reload preserved); genuine sim deletes still evict (`src/lib/killPolicy.js`).
   - **inInterest hold-child**: a linkset child whose root isn't cached yet is HELD (not forwarded blind) until the root arrives — without this, cold load forwarded ~13k at R=80; with it, ~2.8k.
   - **DEFAULT-ON** (`interestEnabled = process.env.INTEREST_FILTER !== '0'`).
   - **Live result (Aspen, ~24.5k objects):** `sent≈2.8k`, heap ~10%, fps 60 — was ~95% OOM. Acceptance gate passed.
   - Process: brainstorm → spec (`docs/superpowers/specs/2026-06-24-interest-filter-design.md`) → plan → subagent-driven execution → review (APPROVED) → merge → live iteration.

2. **Var-region size from terrain coverage** (`fix(terrain): region size from patch coverage`).
   - Cross-region TP into a grid that omits `RegionSizeX` in *both* EQ `TeleportFinish` and `EnableSimulator` left the client at 256m (TP clamped to 255,255; terrain/collision grid 256m on a 1024m region). Fix: derive region size from the max terrain patch index (universal, grid-agnostic — `src/lib/terrainSize.js`); `ensureTerrainGrid` made grow-preserving; `onTeleportFinish` floor-resets on unknown size. 256→512 cross-TP live-verified.

3. **Dupe tube-avatar on cross-sim TP** (in `0629af1`).
   - `swapCircuit` / same-sim-new-region cleared `objCache` but not `session.ownAvatarUpdate` → `OBJ_PROBE_RESYNC` re-sent a stale prior-region avatar (tube-only, no attachments). Fix: clear `ownAvatarUpdate` + `sentToClient` on both region-change paths.

4. **Draw-distance slider debounce** (in `0629af1`).
   - The slider committed `drawDistance` on every `@input` tick → re-sent the radius each tick → relay re-culled the region → UI froze. Now commits on `@change` (release) with a live drag label.

## Key finding for next session (root-caused, not yet built)

**Cold-load slowness on heavy regions = mesh-fetch/decode throughput, NOT prioritization.** Server fetches meshes ~16/s; client mesh queue ~450 → ~30s cold-load for the in-interest set; builds wait on fetches. `near=-1m` in the `[Drain]` log was a **red herring** — it's the nearest-particle-emitter stat (`ps=0/0`→-1), not the build anchor; near-first is working (`nearRefDist` = `avatarSLPos || spawnPos`). The real lever is the **cold-asset pipeline**: server Tier-2 disk cache (instant re-serve on revisit) + possibly client mesh-fetch concurrency. That's the next brainstorm→spec.

## Watch-list
- **Cone-shaped interest** (FS rear-cull): Gene's idea to load "seen items first." Parked as a data-driven fast-follow — fixing cold-asset throughput likely helps seen-first more. `camAt` is already server-side, so it's cheap to add when the data calls for it.
- The interest filter `enter`/`cull` churn + `sent` vs in-view over the next few regions.

## Notes
- Memory updated: `next-tasks-queue` (START HERE), `interest-filtering-design`, `varregion-size-on-teleport` (fix #3), `eslint-broken-flat-config` (dual test-runner gotcha).
- Test runners: server via `bun test server/`; client lib via `vitest` (the repo mixes `bun:test`/`vitest` files — neither runner is clean alone; see the eslint memory).
