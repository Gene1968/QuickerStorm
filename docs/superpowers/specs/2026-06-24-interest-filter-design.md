# Camera-Driven Interest Filter — Single-Region Production Spec

**Date:** 2026-06-24
**Branch:** `ai/interest-filter` (off `phase3`)
**Status:** design approved; Phase 0 spike built + live-validated, productionization pending
**Related:** memory `interest-filtering-design`, `far-field-merge-heap-bound` (disproven predecessor),
`idb-mainthread-starvation-rootcause`, `render-cache-unified-model`

## Problem

On a default OpenSim grid, `[InterestManagement] ObjectsCullingByDistance` is `false`, so the simulator
floods the relay with *every* region object (~21k on a heavy VAR region) regardless of the viewer's draw
distance — `far` only reorders priority, it does not cull. The browser tries to build all of them →
`worldStore` / `buildQ` / asset caches balloon → the ~4GB tab heap pins → load wedges. Prior approaches
(far-field static-merge) were disproven: merging duplicated geometry and made heap *worse*; the working
set, not fidelity, is the problem.

## Goal

FS-like streaming with a **bounded working set**: the Bun relay forwards to the browser only the objects
inside a camera-centred interest volume, and streams them in/out (`ObjectUpdate` on enter, `KillObject` on
leave) as the camera moves. The browser never holds the whole region, so heap stays bounded at any region
size. The relay (a server with headroom) absorbs the sim flood; the tab is what we protect.

This is the proven mechanism — see Phase 0 results — productionized.

## Success criteria

1. Bounded working set + smooth streaming as the camera moves. *(Shown on 256m in Phase 0.)*
2. **Acceptance gate:** proven heap-collapse on a heavy VAR / ~21k-object region (the case that OOMs today).
   256m cannot demonstrate this; the mechanism is identical.
3. No regression on light regions (filter is cheap; nearly pass-through when the region fits the volume).
4. Warm-reload cache (Approach A / `qs-objects` llvocache) preserved as the avatar tours — touring must not
   erode the persisted descriptor set.
5. Default-on after the acceptance gate; `INTEREST_FILTER` kill-switch retained until then.

## Phase 0 result (baseline this spec builds on)

Flag-gated spike on `ai/interest-filter`, live on a 256m region (`R=64`, 4376 objects):
working set `sent` held **~355–1334** while the full region filled to **4376**; heap **111MB (3%)**,
`buildQ=0`, fps 41–58. Streaming confirmed: `leave` fired 220/249/297/65… and `enter` 58/366/416… as the
camera moved (113 ticks, 20 with leaves, 25 with enters). `relayed < decoded` confirmed both the full **and
compressed** forward paths are filtered. 189 server tests + 14 new unit tests green.

## Architecture

Keep the Phase 0 split:

- **`server/lib/interestFilter.ts`** — pure, unit-tested core. `withinInterest` (sphere, squared distance),
  `effectivePos` (walks child prims to their linkset ROOT region position — child `pos` is a parent-relative
  offset), `reconcileInterest` (enter/leave diff, `LEAVE_MARGIN=1.15` hysteresis). No I/O.
- **`server/handlers/lludp.ts`** — wiring. `filterForwardObjects` gates both forward paths (full
  ObjectUpdate + ObjectUpdateCompressed); terse deltas gated on `sentToClient`; `reconcileInterestTick`
  in the existing 500ms circuit timer streams enter (replay from `objCache`, capped per tick) + leave
  (KillObject); inbound sim `KillObject` clears `sentToClient`. `resync.ts` replays only the interest
  subset and rebuilds `sentToClient`.
- **Session state** — `sentToClient: Set<number>` (what the browser currently holds).

Production work is at the edges (below); the core mechanism is unchanged.

## Production deltas

### 1. Client-driven interest radius
The radius is no longer a server env var. The client computes `R` from `uiStore.drawDistance`, clamped down
by the memory governor under heap pressure, and sends it in each `MOVE` message (new field, default to the
current `far`/draw-distance value). The server uses the client's `R`, **clamped to a defensive
`[R_MIN, R_MAX]`** so a buggy/hostile client cannot request an unbounded radius that re-floods the tab.
When `R` is absent (pre-first-MOVE), fall back to the existing spawn-pos anchor + a default radius.

- Protocol: add `interestRadius` (metres) to the `C.MOVE` payload (`useLLUDP.sendMove`, `useWorldEngine`
  move builder). Server reads `msg.d.interestRadius` in `handleClientMessage`, stores on
  `session.lastAgentParams`, clamps in `interestRadius()`.
- The existing draw-distance slider + governor become the real control surface; the server filter is the
  enforced bound.

### 2. Cull vs delete (`KillObject` reason)
A "leave" is a temporary **cull**, not a delete. Today the client's `onKillObject` evicts the `qs-objects`
descriptor cache by default (`objCacheEvict`, gated only by the all-or-nothing `VITE_KEEP_CACHE_ON_KILL`
env flag). Geom (`qs-geom`) and textures (`qs-tex`) are content-keyed and survive a kill, but the descriptor
cache would steadily erode as the avatar tours — undermining warm-reload (criterion 4).

Fix: add `cull: true` to the `S.KILL_OBJECT` payload.
- `reconcileInterestTick` leaves send `cull: true`.
- Inbound sim `KillObject` (genuine delete) forwards without `cull` (or `cull: false`).
- Client `onKillObject`: on `cull` → remove scene node + `worldStore` entry but **keep** the `qs-objects`
  descriptor (re-enter rebuilds from the server's re-forwarded ObjectUpdate + warm geom/tex IDB → cheap).
  On delete → evict as today. This replaces the env flag with a per-message reason.

### 3. Governor integration
The client governor's role shifts from "locally hide far objects" to "decide the radius I can afford" (feeds
delta #1). The client's render-distance visibility cull stays as a cheap, redundant safety net (and the only
defense if the filter flag is off). The server filter is authoritative. No existing governor logic is
removed — only what feeds `R` is repurposed.

### 4. Arrival ramp
On login / teleport arrival, the client ramps the `R` it sends from a small value (immediate vicinity) up to
full over a few seconds (FS-style: start ~`max(target/2, 50)`, grow ~10%/s). Near objects paint first
instead of bursting the whole volume. Reuses the existing per-tick enter cap for server-side pacing; the
ramp itself is client-side on the `R` it reports.

### 5. Sim-bound `far` — unchanged in v1
Leave the client→sim `far` at `512` (region-wide). On default culling-OFF grids, lowering it would *starve*
cache-miss fulfillment (the sim wouldn't satisfy region-wide `RequestMultipleObjects`), and the Bun filter
already bounds the browser. Governor-coupling `far` only helps culling-ON grids; documented as a future
grid-specific option, **out of v1**.

### 6. Flag & telemetry
Retain `INTEREST_FILTER` as a kill-switch until the acceptance gate passes, then default on. Keep the 3s
`[Interest]` heartbeat (`sent/total`, enter/leave, cam, R); add cull-vs-delete counts.

## Data flow

```
client MOVE { camCenter, camAt, interestRadius=R } ──▶ server lastAgentParams
sim ObjectUpdate/Compressed ──▶ objCache.set ──▶ filterForwardObjects(R) ──┬─ in-volume ─▶ ws.send OBJECT_UPDATE, sentToClient.add
                                                                           └─ out        ─▶ (cached, not forwarded)
every 500ms: reconcileInterest(objCache, sentToClient, camCenter, R) ──┬─ enter ─▶ replay OBJECT_UPDATE, sentToClient.add
                                                                       └─ leave ─▶ KillObject{cull:true}, sentToClient.delete
sim KillObject ──▶ ws.send KillObject{cull:false}, objCache.delete, sentToClient.delete
```

## Testing

- Extend `server/lib/interestFilter.test.ts`: radius clamp `[R_MIN,R_MAX]`; cull-diff already covered.
- Server wiring: `MOVE` parsing of `interestRadius`; clamp behaviour; reconcile cull-flag on leave vs
  delete-flag on inbound kill.
- Client: a test that `KILL_OBJECT {cull:true}` removes the scene/store entry but does **not** call
  `objCacheEvict`, while a plain delete does.
- **Acceptance:** live run on a heavy VAR/~21k region — `sent` bounded, heap bounded, smooth streaming, warm
  reload still pre-seeds after touring.

## Out of scope (named, deferred)

- **Cone-weighting / FS rear-cull** — fast-follow only if the sphere's working set is still too large on a
  VAR region. Adds spin-around pop-in and another tuning parameter.
- **Multi-region / adjacent-region viewing** — its own spec + project. Presupposes neighbor-sim rendering
  (not implemented) and needs neighbor object caches keyed by region handle, coordinate offsets, neighbor
  circuits. Intersects existing cross-region-TP work.
- **Springback (#15)** — pre-existing AgentUpdate-starvation / remote-sim-latency bug; blocks smooth avatar
  walking but is unrelated to this change (no client→sim packet changes). Separate fix.

## Compounding track (independent)

Going live (`hosting-target`) grants `navigator.storage.persist()` (denied on localhost), making the
stream-out/in cycle cheap: re-enter rebuilds from warm IDB (Approach A) instead of re-fetch/decode. Plus the
server Tier-2 disk cache speeds cold loads. Bounded working set + warm persistence + Tier-2 = the coherent
pipeline. Deploy after the acceptance gate; not a dependency of this spec.
