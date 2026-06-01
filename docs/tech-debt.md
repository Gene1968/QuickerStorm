# Tech Debt Log — quickerSTORM

> Shortcuts and known issues to revisit. Add rows as they appear; review during planning.

| ID | Description | Introduced | Why Accepted | Priority | Effort |
| --- | --- | --- | --- | --- | --- |
| orphaned-ptt-events | Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js | 2026-05-24 | Legacy file; dispatches removed from listener but still fire into void | low | 1h |
| ~~var-region-terrain~~ | FIXED 2026-05-30: 32×32 patch IDCT + 32-bit patch IDs implemented for LandExtended (typeB=0x4D). NeverWorld 512m terrain now decodes. NOT live-verified against a running grid — confirm on next NeverWorld session. (typeB=0x37 = OSGrid sea-floor, correctly skipped, unrelated.) | 2026-05-25 | — | low | — |
| ~~terrain-missing-patches~~ | RESOLVED 2026-05-27: OSGrid sea-floor layer (typeB=0x37) was being classified as LAND and overwriting real ground at patch (0,0). Fix in terrain-codec.ts removes 0x37 from `isLand`. All four bitstream-desync hypotheses were wrong. Instrumentation (worldStore.patchReceived Set, server keys+cache-size logging, codec OOB warnings) retained for regressions. See `memory/terrain-decoder-missing-patches.md`. | 2026-05-27 | — | — | — |
| terrain-mesh-mirror | Terrain mesh write path uses `iy = ry - slY` to match PlaneGeometry orientation. Pre-fix the mesh was N-S mirrored (invisible in flat regions; surfaced as "walking on water" / "sinking into hill"). Any new code touching `terrainMesh.geometry.attributes` must keep this invariant. Documented in `memory/threejs-rendering-decisions.md`. | 2026-05-27 | Constraint, not debt | low | — |
| map-stale-region-on-walk | Map purple dot uses `session.regionX/Y` which only updates on TeleportFinish. Walking across a region boundary triggers cross-sim handshake (DisableSimulator + new UseCircuitCode) that we don't yet handle — dot lags behind real region. | 2026-05-29 | Cross-sim walk is a separate Phase 2/3 feature, map TP path works correctly | medium | 6h |
| map-prim-diagnostics | `server/handlers/lludp.ts` still ships `prim-ids-snapshot.txt` writer, per-packet hex dumps in `→ MapBlockRequest`, and verbose `[PrimDiag]` logging. Useful while prim/map paths are flaky; remove or gate behind env var once stable. | 2026-05-29 | Active diagnostic — see [[phase2-prim-rendering-resolved]] | low | 1h |
| map-no-localstorage-cache | `mapStore.regions` populated each session — reopening Map after login re-queries every visible chunk. 60s in-session TTL helps but doesn't survive reload. Persist to localStorage with TTL for faster reopen. | 2026-05-29 | Phase 2 polish deferred — see [[map-phase2-shipped]] | low | 2h |
| friends-live-verify | Friends/Contacts tab in ConversationsFloater is fully built (search, online list, rights toggles, add-by-name, remove). NOT live-tested. Remove this row after confirming on a live grid. | 2026-05-30 | Implemented but unverified | medium | 0.5h |
| appearance-no-bake | AppearanceFloater edits local color/skin/hair in avatarStore; no AgentSetAppearance or baked texture pipeline. Outfits tab is a shell. Wiring bake risks global appearance corruption — needs test-grid validation before enabling. | 2026-05-31 | Risk management; Phase 3 late item | medium | 8h+ |
| coarse-location-minimap | CoarseLocationUpdate forwarding dropped at lludp.ts; minimap uses full ObjectUpdate dots only. Region-wide avatar dots unreliable for non-nearby avies. | 2026-05-31 | Separate server work needed; minimap otherwise functional | medium | 3h |
| var-region-live-verify | var-region-terrain fix (2026-05-30) not confirmed on a running NeverWorld session. Remove this row after first successful live test. | 2026-05-30 | Fix committed but unverified | low | 0.5h |

## Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js

`useOfficeEngine.js` dispatches `ava-ptt-start` and `ava-ptt-stop` window events (lines ~6933, ~6978). The listener in `ProximityVoiceBar.vue` was removed as part of the audio controls redesign (2026-05-24). These dispatches now fire into the void. When `useOfficeEngine.js` is eventually replaced by `useWorldEngine.js`, these dispatches should not be carried over.
