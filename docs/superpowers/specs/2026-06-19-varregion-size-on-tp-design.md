# Var-region size on teleport — design

**Date:** 2026-06-19
**Area:** Teleport / region size — var-region movement
**Status:** implemented (movement scope), needs live-verify

## Problem

In a 1024×1024 var-region the avatar could not walk north of Y≈511 (camera panned freely; walking
was walled). Root cause (systematic-debugging, server+client+live):

- The client dead-reckons the avatar and clamps it each frame to `[1, regionSize-1]`
  (`useWorldEngine.js`) — correct intent ("don't walk off the sim edge").
- But `sessionStore.regionSizeX/Y` was **stale at 512** (the value from login: `region_size_x="512"`).
  The region (Bountiful Sandbox) is 1024×1024, so the clamp walled the avatar at 511.
- Why regionSize never updated to 1024 on the teleport into it:
  - `RegionHandshake` carries no size.
  - The UDP/EQ `TeleportFinish` **decoder dropped** `RegionSizeX/RegionSizeY` (the EQ body carries
    them on modern OpenSim/SL; our `decodeTeleportFinishLLSD` listed only the legacy fields).
  - `EnableSimulator` (another size carrier) was explicitly **unhandled**.
  - The fallback — a client map-block backfill — is async/fragile (depends on a map query resolving
    to the exact destination cell post-TP) and silently failed for this region.

## Approach (movement scope — chosen)

Make the destination region's size **authoritative and synchronous** on teleport by decoding it from
the EQ `TeleportFinish` event and pushing it to the client.

1. **`server/lib/eventQueue.ts`** — `decodeTeleportFinishLLSD` extracts `RegionSizeX/RegionSizeY`
   (LLSD `<integer>`, with a 4-byte BE `<binary>` fallback; `0` when the grid omits them). Added to
   `TeleportFinishFields`.
2. **`server/handlers/lludp.ts`** — `applyTeleportFinish` forwards `regionSizeX/Y` in the
   `S.TELEPORT_FINISH` message (`0` from the UDP path, which has no size) and logs
   `[TP] destination region size = A×B`.
3. **`src/composables/useWorldEngine.js`** — `onTeleportFinish` applies `d.regionSizeX/Y` directly
   when `> 0` (authoritative, synchronous → the movement clamp uses the real bounds immediately),
   otherwise keeps the existing map-block fallback.
4. **Instrumentation** — `EnableSimulator` (was unhandled) now decodes + logs `handle` + `RegionSizeX/Y`
   so a live test confirms whether this grid delivers the current-region size via TeleportFinish
   (preferred, wired) or only via EnableSimulator (informs a follow-up for walk-crossings).

## Testing

- `server/__tests__/eventQueue.test.ts`: decode `RegionSizeX/RegionSizeY` when present (1024); report
  `0` when absent. RED→GREEN. Server suite 152/0, client lib 241/0, `build:prod` green.

## Live-verify

Server already restarted with the fix (circuit dropped — expected). Hard-reload the client, TP into a
>512 var-region (e.g. Bountiful Sandbox, 1024). Expect: server log `[TP] destination region size =
1024×1024` + client `[3D] Region size from TeleportFinish: 1024×1024`; walking north past Y=512 works
to ~1023. If the log instead shows `[TP] destination region size = 0` (grid omits it) but the
`[EQ] EnableSimulator … size=1024×1024` line appears → follow-up: consume EnableSimulator's size.

## Out of scope (separate bug)

`TERRAIN_STRIDE = 513` (`worldStore.js`) caps the terrain heightmap at 512m, so terrain/ground past
Y=512 stays flat/absent even with `regionSize=1024`. Movement is now unblocked; terrain rendering for
>512 var-regions is a separate fix (scale stride/array/plane to the region size).
