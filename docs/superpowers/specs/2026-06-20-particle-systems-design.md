# Particle Systems (PSBlock) — Design

> Status: design approved 2026-06-20 (brainstorm). Spec for the v1 "common-case faithful"
> particle renderer. Decoupled from the asset/heap-loading grind; first of two "living world"
> features (system trees/grass = separate follow-up spec).

## Goal

Render in-world particle systems (fountains, fire, smoke, sparkle, glow rezzers) that today
render as **nothing**. The particle block (`PSBlock`) arrives in every full `ObjectUpdate` but is
currently skipped unparsed (`skipVar1('PSBlock')`, `server/lib/lludp-codec.ts:1536`); no field is
forwarded and no client consumer exists.

**Scope decision (brainstorm):** v1 = *common-case faithful*. Simulate the patterns and flags that
produce the vast majority of visible effects; defer exotica. Real particle textures via the existing
texture cache, bundled sparkle/flame fallback while loading or on 404.

## Non-goals (v1)

- Target-follow / ribbon (trail) mode
- Wind-field coupling
- Bounce planes
- System trees / grass / plants (PCode 3/95/255) — **separate follow-up spec**
- Merged single-buffer global particle system (a later optimization; rejected for v1 because draw
  calls are not the bottleneck — see FEATURE-GAPS #6)

## Architecture

Per-emitter `THREE.Points` with pooled, pre-allocated buffers; pure testable decode + simulation;
a composable owns the THREE objects, caps, culling, and heap-awareness; the engine wires it in at a
few small touch points.

### Modules

| Module | Kind | Responsibility |
|--------|------|----------------|
| `server/lib/particleCodec.ts` | new, pure (TS) | `decodeParticleSystem(buf, off, len) → psys \| null`. Defensive, bounds-checked. bun-tested. |
| `src/lib/particleSim.js` | new, pure (JS, no THREE) | Simulation over typed arrays: burst scheduling, pattern→initial velocity, accel/gravity integration, age→color/alpha/scale interpolation, retirement, cap/budget clamping. vitest-tested. |
| `src/composables/useParticles.js` | new | Owns the `Points` pool, per-emitter material + texture resolution (existing texture cache + bundled fallback), global + per-emitter caps, distance culling, heap-awareness. API: `register`, `unregister`, `step`, telemetry. |
| `src/composables/useWorldEngine.js` | edit (~3 touch points) | register/update/unregister emitters in `upsertMesh`/`removeMesh`; call `useParticles.step(dt, camPos)` from `animate()`. |
| `server/lib/lludp-codec.ts` | edit (1 site) | Replace `skipVar1('PSBlock')` with `decodeParticleSystem(...)`; attach result to the object record. |
| `shared/protocol.js` | edit (doc) | Document the new optional `psys` field on the `obj_upd` object record. |

### Decode (server)

Replace the blind `skipVar1('PSBlock')` at `lludp-codec.ts:1536` with a real, defensively-bounded
parse following the **local Firestorm** reference `indra/llmessage/llpartdata.{cpp,h}`
(`C:\Users\gene1\Downloads\Pages\git\phoenix-firestorm`; byte-identical to upstream LL, FS only adds
`asLLSD`/`fromLLSD` editor helpers). Runtime sim mimics FS `indra/newview/llviewerpartsource.cpp`.
The exact layout is locked in the implementation plan. Fields:

- **Classic compiled block:** source pattern, max-age, start-age, inner/outer angle, burst rate,
  burst radius, burst speed min/max, burst part-count, angular velocity (vec3), part acceleration
  (vec3), texture UUID, target UUID, part-data-flags, part-max-age, start color+alpha (RGBA),
  end color+alpha, start scale (x,y), end scale (x,y).
- **OpenSim-extended appended fields** (glow + blend-func source/dest) parsed only when the extended
  flag / length is present.

**Format detection and exact byte offsets are pinned during implementation** against the reference
source **and a live byte-dump diagnostic added to the Bun server** (we own the server + logs). The
spec deliberately does not fabricate offsets. Requirements that DO bind the implementation:

1. Every read is length-checked against `len`; a shortfall returns the best partial (or `null`),
   never throws, never reads past the field. The current tail-OOB
   (`server/handlers/lludp.ts:638-648` swallows `PSBlock:` overflow) must become impossible.
2. Decoding the next object in the packet proceeds normally — we consume exactly `len` bytes (the
   Variable1 length prefix), so the parse can never desync `off`.
3. A `psys` is only attached when a particle system is actually present (`len > 0` and a valid
   parse); absent/empty → no field, no cost.

> **Latent-bug note:** this is the particle path, which already uses `skipVar1` and does NOT drop
> later objects. The packet-`break` prim-drop is the *tree* PCode path (`lludp-codec.ts:1335-1341`)
> and is addressed in the system-trees follow-up spec, not here.

### Data flow

```
sim → full ObjectUpdate (tail contains PSBlock, Variable1)
  → server: decodeParticleSystem(buf, off, len) → psys
  → obj_upd record gains compact `psys` (only sim-needed fields)
  → client worldStore.upsertObject stores psys on the object
  → useWorldEngine.upsertMesh: useParticles.register(localId, psys, () => mesh.matrixWorld)
       (re-upsert updates; removeMesh / region-clear → unregister)
  → animate(): useParticles.step(dt, cameraWorldPos)
  → emitter follows the source object's live world transform each frame
```

The forwarded `psys` is a compact object — only the fields the simulation consumes (pattern, timing,
angles, speeds, counts, accel, age, start/end color+alpha+scale, glow, blend mode, texture UUID,
relevant flags). Not the raw block.

### Rendering & simulation (client)

Per emitter:

- **Buffer:** pre-allocated ring buffer sized to computed max live count
  `min(ceil(partMaxAge / burstRate) * burstPartCount, PER_EMITTER_CAP)`. Attributes: position (vec3),
  color (vec3), alpha (float). `drawRange` = live count. Particles recycled in place — **zero
  per-particle allocation, no GC sawtooth.**
- **`step(dt)`:** emit due bursts from the source transform (pattern → initial velocity), integrate
  position with accel/gravity, age particles, retire expired, interpolate color/alpha/scale over
  normalized age, write attributes, update `drawRange`.
- **Material:** `PointsMaterial` (escalate to a thin custom point shader only if size-attenuation /
  soft round alpha demands it), `transparent`, `depthWrite:false`, blend =
  `AdditiveBlending` when the emissive/glow flag is set else `NormalBlending`, `map` = resolved
  texture.
- **Patterns:** DROP, ANGLE, ANGLE_CONE, EXPLODE.
- **Flags:** interp-color, interp-scale, emissive(glow), follow-source.
- **Deferred:** target-follow/ribbon, wind, bounce (see non-goals).

### Texture resolution

Resolve the particle `texture` UUID through the **existing texture cache** (`useTextureFetch` /
the qs-tex pipeline — now robust). While loading or on 404, use a **bundled default** (sparkle for
generic, flame for additive/glow) so an emitter is never invisible. Texture swap is live (material
`map` updated when the real texture resolves). Material is keyed by `(textureUuid, blendMode)` and
shared across particles of an emitter.

## Performance & heap discipline (design pillar)

Given this project's loading/heap history, particles must never become a new pressure source:

- **Global live-particle budget** (`GLOBAL_PARTICLE_CAP`, ~20k) and **per-emitter cap**
  (`PER_EMITTER_CAP`, ~512). Bursts clamp to remaining global budget.
- **Distance culling** tied to the existing visibility cull / `_effNear`: emitters beyond the radius
  stop emitting and freeze (no buffer churn, kept resident cheaply); resume on approach.
- **Frame-budgeted:** total particles stepped per frame is bounded; never unbounded.
- **Heap-aware:** respects `memUnderPressure()` / the soft-heap brake — under pressure, stop
  spawning new emitters and shrink caps, mirroring the build/ingest/texture pumps.
- **Tab-hidden:** simulation pauses (no rAF work).
- All caps are module constants, easy to tune after live measurement.

## Testing

- **bun (`server/lib`):** `decodeParticleSystem` against captured byte fixtures — legacy compiled,
  OpenSim-extended, and truncated/malformed inputs (must not throw, returns correct fields or safe
  partial/null). Fixtures captured via the live byte-dump diagnostic.
- **vitest (`src/lib`):** `particleSim` — burst timing vs injected `dt`, initial velocity per
  pattern, age interpolation of color/alpha/scale, retirement, per-emitter cap clamping, global
  budget enforcement. Pure and deterministic.
- **Live-verify:** a region with known emitters (fountain / fire); a `[Particles]` telemetry line
  (active emitters, live particles, culled count); confirm no heap regression on a heavy region.

## Rollout / risk

- Decode is bounds-checked and additive; worst case a malformed block yields no `psys` (status quo).
- Rendering is gated by caps + culling + heap-awareness from day one.
- No cache-version bumps, no asset-pipeline changes.
- Bundled fallback textures are new small WebP assets committed with the feature.

## Follow-up (not this spec)

System trees / grass / plants (PCode 3/95/255): cheap bundled imposter (crossed alpha canopy +
trunk, species byte → texture/tint) **plus** fixing the full-`ObjectUpdate` packet-`break` that drops
later prims (`lludp-codec.ts:1335-1341`). Separate spec.
