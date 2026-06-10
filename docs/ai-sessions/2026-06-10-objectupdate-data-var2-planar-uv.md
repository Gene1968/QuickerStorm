# 2026-06-10 — ObjectUpdate `Data` Var2 decoder fix + planar texgen UV projection

**Tools:** Claude Code (Fable 5) · live forensics via `QS_WATCH_LOCALIDS` packet watch
**Reviewer:** Gene

## What shipped

1. **Decoder root-cause fix (the "torus" bug).** The full-ObjectUpdate tail walk read the `Data`
   field as Variable1; `message_template.msg` says **Variable 2**. With empty `Data` (`00 00`) the
   stray second zero byte was swallowed by the empty `Text` length — an accidental realignment that
   masked the bug on almost every object. Objects with non-trivial tails desynced at ExtraParams and
   **silently lost meshId/sculptId** (and potentially PBR ids), so a mesh rendered as its carrier
   shape (torus). The gutted record was then persisted to the IndexedDB object cache, and CRC
   probe-hits replayed it forever — no amount of cache purging could outrun the re-poisoning while
   the decoder kept gutting fresh deliveries. Fixed in `server/lib/lludp-codec.ts`; regression
   locked by a live-captured packet fixture `server/__tests__/objupdate-data-var2.test.ts`.
2. **Cache-poisoning hardening.** `persistObjects` now persists the *merged* store record instead of
   the raw incoming update (a partial update could overwrite a complete cached record); object-cache
   DB bumped to v6 for a one-time purge of poisoned records.
3. **Planar texgen UV projection** (deferred from the 2026-06-08 per-face spec). New
   `src/lib/planarUV.js` — 1:1 port of Firestorm `llface.cpp planarProjection()` (8 unit tests) —
   plus `applyPlanarUVs` in `useWorldEngine.applySwap`: regenerates the `uv` attribute for every
   face group whose effective TexGen is planar, after the final geometry scale. Without it, planar
   faces sampled the authored (often degenerate) mesh UVs → stripes/moire.
4. **`PERFACE_PRIMS` re-enabled** (stash-test had proven per-face innocent of the cold-load OOM).
5. **Build-floater FS parity:** Repeats-per-meter row (FS `getMaxDiffuseRepeats` formula: raw TE
   scale ÷ object span per axis, max) on default + per-face mapping rows; link numbering follows
   the LSL convention (unlinked object = link 0). Verified against FS-reported values for the test
   object to 5 decimal places (Scale 1.19157×1.32046, RPM 0.10898).
6. **Diagnostics kept in tree:** `[TEDUMP]` now also forwards over WS to the server log
   (`C.CLIENT_LOG`); new `QS_WATCH_LOCALIDS` env var hex-dumps the raw packet + decoded summary for
   watched localIds on the full/compressed decode paths and the resync replay — this was the tool
   that cracked the case (proved the meshId was on the wire and the decode dropped it).

## Debugging lessons (also recorded in session memory)

- `bun run --watch` **does** hot-restart on Windows now — a `server/` edit mid-session restarts the
  server, wipes in-memory circuit state, and drops the user's session. Batch server edits; warn first.
  A lingering old instance causes an `EADDRINUSE` crash-loop on restart.
- Vite dev can serve **stale transformed modules across hard reloads** when its file watcher misses a
  change — a client edit that "doesn't take" after several reloads means: restart Vite.
- OpenSim replies to `ObjectSelect` with **ObjectProperties only for objects you own** — selecting
  your own object never re-sends its ObjectUpdate, so a poisoned client record can't be refreshed
  that way.
- Capture → offline fixture → TDD remains the highest-leverage decoder workflow: one live packet
  ended a two-day regression hunt.

## Open follow-ups

- **#16 RenderMaterials cap** (request format wrong, returns 0 bytes) — blocks Normal/Specular
  display in the Texture tab and normal/spec rendering. Verification data ready: test roof face 1
  normal `26d0526f…`, face 0 specular `85ee4e09…` @ 1.19160/1.32040.
- Planar repeat-density side-by-side vs Firestorm on the same grid (user observation of "~200%"
  density; decode + math verified identical to FS, so pending visual confirmation).
- Select Face radio + Inspect Textures floater (Build Tools).
- Prism per-side faces (custom geometry), per-face PBR/glow, decoded-mesh cache LRU.
