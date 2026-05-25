# Tech Debt Log — quickerSTORM

> Shortcuts and known issues to revisit. Add rows as they appear; review during planning.

| ID | Description | Introduced | Why Accepted | Priority | Effort |
| --- | --- | --- | --- | --- | --- |
| orphaned-ptt-events | Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js | 2026-05-24 | Legacy file; dispatches removed from listener but still fire into void | low | 1h |
| var-region-terrain | terrain-codec.ts only supports 16×16 patches (PATCH_SIZE=16). Var-regions (512×512, 1024×1024) send patchSize=32 with type byte 0x37 (LandExtended). Codec detects and logs but returns null — no terrain rendered on var-region grids (NeverWorld, etc). | 2026-05-25 | 32×32 IDCT not yet implemented; affects non-standard grids only | medium | 3h |

## Var-region terrain (patchSize=32) not decoded

`server/lib/terrain-codec.ts` only handles 16×16 patches. OpenSim var-region grids (NeverWorld 512×512, etc.) send `layerTypeByte=0x37` (LandExtended) with 32×32 patches. Codec detects and logs the mismatch but returns null — no terrain renders on those grids. Fix requires: 2D IDCT expansion to 32×32, `PATCH_SIZE` generalization, and zigzag/dequant table rebuild for 32×32. Normal 256×256 grids unaffected.

## Orphaned `ava-ptt-start/stop` event dispatches in useOfficeEngine.js

`useOfficeEngine.js` dispatches `ava-ptt-start` and `ava-ptt-stop` window events (lines ~6933, ~6978). The listener in `ProximityVoiceBar.vue` was removed as part of the audio controls redesign (2026-05-24). These dispatches now fire into the void. When `useOfficeEngine.js` is eventually replaced by `useWorldEngine.js`, these dispatches should not be carried over.
