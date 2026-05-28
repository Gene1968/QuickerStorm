# Tech Debt Log — quickerSTORM

> Shortcuts and known issues to revisit. Add rows as they appear; review during planning.

| ID | Description | Introduced | Why Accepted | Priority | Effort |
| --- | --- | --- | --- | --- | --- |
| orphaned-ptt-events | Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js | 2026-05-24 | Legacy file; dispatches removed from listener but still fire into void | low | 1h |
| var-region-terrain | terrain-codec.ts only supports 16×16 patches (PATCH_SIZE=16). Var-regions (512×512, 1024×1024) send patchSize=32 with type byte 0x37 (LandExtended). Codec detects and logs but returns null — no terrain rendered on var-region grids (NeverWorld, etc). | 2026-05-25 | 32×32 IDCT not yet implemented; affects non-standard grids only | medium | 3h |
| terrain-missing-patches | Specific patches on standard 256×256 grids never reach worldStore — those grid cells stay at h=0 and avatars fall through to "water" while FS shows ~22m terrain. Reproducible at slX/slY=7/6 (patch (0,0)) on NeverWorld. Decoder ships 6+ prior fixes; likely a bitstream desync in one patch's coefficient stream truncating the rest. | 2026-05-27 | Real fix needs bitstream replay vs libomv; band-aid (mean-fill missing patches) rejected as it masks the bug and could render water as false land | high | 4-8h |

## Var-region terrain (patchSize=32) not decoded

`server/lib/terrain-codec.ts` only handles 16×16 patches. OpenSim var-region grids (NeverWorld 512×512, etc.) send `layerTypeByte=0x37` (LandExtended) with 32×32 patches. Codec detects and logs the mismatch but returns null — no terrain renders on those grids. Fix requires: 2D IDCT expansion to 32×32, `PATCH_SIZE` generalization, and zigzag/dequant table rebuild for 32×32. Normal 256×256 grids unaffected.

## Terrain decoder missing patches on 256×256 grids

`server/lib/terrain-codec.ts` decodes most patches correctly but specific patches per region never reach `worldStore.terrainHeights`. Observed 2026-05-27 on NeverWorld: walking to slX/slY=(7,6) — which falls inside patch (0,0), the SW corner — produces foot Z snap to ~1m (water) because the underlying heights stay at the 0-init default. Firestorm at the same coords shows terrain at ~22m with avatars resting on it.

Visible consequence: avatar position diverges from FS by ~20m vertically, scenery differs, jump cannot recover because there is no terrain mesh to land on.

**Hypothesis ranking** (untested, see `memory/terrain-decoder-missing-patches.md`):

1. Bit-reader desyncs on one patch's coefficient stream → every subsequent patch reads garbage → `MIN_HEADER_BITS=66` exhaustion guard terminates loop early → late patches stay at h=0.
2. `patchIds` 10-bit field rounds into an out-of-range patchX/Y under a specific LE-chunked byte alignment → `patchX > 15 || patchY > 15` `continue` silently drops a real patch.
3. Sim splits 256 patches across multiple LayerData packets and a non-first packet has its zero-coded body mis-decoded → packet dropped → its patches never arrive.
4. Spurious `END_OF_PATCHES` (0x61) byte appears mid-stream due to upstream desync → loop exits prematurely.

**Diagnostic plan**: add `worldStore.patchReceived: Set<string>` keyed `"px,py"`, log missing keys after first 5s post-RegionHandshake; cross-check with server-side count emitted by codec; if codec emits all 256 → relay/handler bug; if < 256 → bitstream replay vs libomv `TerrainCompressor.DecompressLand` byte-by-byte on the raw LayerData slice.

**Rejected band-aid**: mean-fill of missing patches would mask the bug, can falsely render water as land at intentional depths, and would have to be removed when the real fix lands.

Priority: high — affects correctness of own-avatar position vs the rest of the world. Effort: 4–8h once picked up.

## Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js

`useOfficeEngine.js` dispatches `ava-ptt-start` and `ava-ptt-stop` window events (lines ~6933, ~6978). The listener in `ProximityVoiceBar.vue` was removed as part of the audio controls redesign (2026-05-24). These dispatches now fire into the void. When `useOfficeEngine.js` is eventually replaced by `useWorldEngine.js`, these dispatches should not be carried over.
