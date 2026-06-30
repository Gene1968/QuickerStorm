# Environment & Day/Night System — Design

**Date:** 2026-06-29
**Status:** Approved (design); plan + implementation to follow.
**Scope chunk:** "Environment visuals — everything incl. cycle" (per FEATURE-GAPS-QUEUE Terrain & Environment cluster).

## Goal

Make the world stop reading flat and noon-lit. Introduce a single time-of-day state that
drives a gradient sky, a moving sun, and a global brightness ramp so the whole scene visibly
moves through dawn → noon → dusk → night, driven by the region's actual sun (with a local
fallback + a manual override).

## Grounding (reference-first)

Verified against the local checkouts and current engine state before design:

- **Sun/time protocol:** `SimulatorViewerTimeMessage` (Low 150) is the LLUDP path. Fields per
  `server/lib/protocol/message_template.msg:3438-3448`: `UsecSinceStart (U64)`, `SecPerDay (U32)`,
  `SecPerYear (U32)`, `SunDirection (LLVector3)`, `SunPhase (F32)`, `SunAngVelocity (LLVector3)`.
  **Not currently decoded** by QuickerStorm. OpenSim default day length ≈ 14400 s.
- **Terrain detail textures:** already decoded — `decodeRegionHandshake()` at
  `server/lib/lludp-codec.ts:1718` yields `terrainDetail[]` (4 UUIDs), `terrainStartHeight[]`,
  `terrainHeightRange[]`. `src/lib/terrainMaterial.js` already blends 4 textures by elevation
  (start-height + height-range + perlin dither). This is a **wiring/verify** task, not new build.
- **Wind/cloud LayerData:** NOT decoded — `server/lib/terrain-codec.ts:345` explicitly skips
  WIND(0x57)/CLOUD(0x43); only LAND is decoded. Decoding the sim cloud bitstream is out of scope;
  we ship **procedural clouds** instead.
- **Current lighting (the "flat noon" rig), `src/composables/useWorldEngine.js`:**
  DirectionalLight sun `0xfff4e6 @ 1.0` pos `(50,80,50)` (≈L1662), cool fill `0xaad4f5 @ 0.3`
  (≈L1668), AmbientLight `0xfff4e6 @ 0.45` (≈L1671). `scene.background = Color(0x87ceeb)` (L1536),
  `scene.fog = FogExp2(0x87ceeb, 0.0006)` (L1540). Tone mapping `NoToneMapping` (L1565),
  shadows disabled. Render loop: `animate(time)` at ≈L4488; per-frame renderer call ≈L4742.
- **Material reality:** avatars + default prims use **unlit** `MeshBasicMaterial`; terrain + water
  use **unlit** custom `ShaderMaterial`. Only PBR prims (`MeshStandardMaterial`) and the opt-in
  "Lit Shading" prims (`MeshLambertMaterial`) respond to lights. → The cycle CANNOT rely on lights
  alone to darken the world.

## Crux decision — how the world darkens (Approach A, approved)

Because most of the scene is unlit, a moving sun + sky alone would leave the ground/objects fully
bright at night ("dark sky over a lit world"). Resolution: a **global exposure ramp**.

- Switch renderer tone mapping `NoToneMapping → LinearToneMapping`. At `toneMappingExposure = 1.0`
  this is effectively identity (multiply-by-1 then clamp), so calibrated daytime colors are
  preserved. Ramp exposure **down** toward night (clamped to `[EXPOSURE_NIGHT_MIN, 1.0]`,
  `EXPOSURE_NIGHT_MIN ≈ 0.22`). This darkens **every** material uniformly and cheaply — no
  per-material changes, no perf hit, no risk of the historical "black scene" lit-material bugs.
- Lit prims (Lambert/Standard) additionally get directional shaping from the moving sun light —
  a free bonus, not a dependency.

Rejected: (B) forcing all materials lit — perf cost across thousands of prims + black-scene risk;
(C) sky-only cosmetic — unconvincing night.

## Architecture

```
SimulatorViewerTimeMessage (Low 150)
  └─ server: decodeSimulatorViewerTime()  [lludp-codec.ts]
       └─ handler [lludp.ts] → relay S.ENVIRONMENT_TIME {sunDirection, sunPhase,
            sunAngVelocity, secPerDay, usecSinceStart}  [shared/protocol.js]
            └─ client useEnvironment.js  ← single source of env state
                 • seeds local clock from msg; extrapolates via secPerDay + sunAngVelocity
                 • computes dayPhase from sun elevation
                 • dayPhase → keyframed palette (night/dawn/noon/dusk)
                 • exposes reactive env: {sunDirThree, sunColor, sunIntensity, ambientColor,
                     skyZenith, skyHorizon, sunGlow, fogColor, exposure, starOpacity, cloudTint}
                 └─ consumed each frame by:
                      - useWorldEngine.animate(): lights, fog, renderer.toneMappingExposure
                      - SkyDome shader uniforms
                      - cloud layer shader uniforms
```

## Components

### 1. Server — `SimulatorViewerTimeMessage` decoder + relay
- `server/lib/lludp-codec.ts`: `decodeSimulatorViewerTime(buf)` returning
  `{ usecSinceStart: bigint→number, secPerDay, secPerYear, sunDirection:[x,y,z],
     sunPhase, sunAngVelocity:[x,y,z] }`. Use the existing template-driven path; cite Low 150.
- `server/handlers/lludp.ts`: register Low 150; on receipt, relay.
- `shared/protocol.js`: add `S.ENVIRONMENT_TIME` server→client message carrying the decoded fields.
- The message is low-frequency; it is a *correction*, not the animation source.

### 2. Client — `src/composables/useEnvironment.js` (new, single source of truth)
- **State:** last server sample (sunDirection SL-frame, sunAngVelocity, secPerDay, usecSinceStart,
  receivedAt), a fixed-sky override (off | normalizedTimeOfDay 0..1), and a `cycleEnabled` pref.
- **`update(dt)`** (called from render loop): if `cycleEnabled` and a server sample exists,
  advance the sun by `sunAngVelocity * elapsed` (or recompute from `usecSinceStart + elapsed`
  against `secPerDay`); else use override time or local-clock fallback.
- **`dayPhase`:** derived from sun **elevation** = `sunDirection.z` (SL frame is Z-up, so the
  up-component is the elevation sine, independent of render frame). Map elevation∈[-1,1] to a
  phase scalar used to sample the palette.
- **Palette:** explicit keyframes (concrete colors, tunable):
  | key | elev | sky zenith | sky horizon | ambient | sun color | sun I | fog | exposure | stars |
  |-----|------|-----------|-------------|---------|-----------|-------|-----|----------|-------|
  | night | ≤ −0.10 | `#0a0f1e` | `#1a2238` | `#26304d` | `#3a4a6b` | 0.05 | `#0a0f1e` | 0.22 | 1.0 |
  | dawn/dusk | ≈ 0.0 | `#2b3a66` | `#e8975a` | `#6b5a52` | `#ffb066` | 0.6 | `#caa07a` | 0.55 | 0.3 |
  | day | ≥ 0.35 | `#3a7bd5` | `#9ec9ee` | `#fff4e6` | `#fff4e6` | 1.0 | `#87ceeb` | 1.0 | 0.0 |
  Interpolate (smoothstep) between adjacent keyframes by elevation. Dawn vs dusk distinguished by
  sign of vertical velocity (or sunPhase) for horizon-tint side; values otherwise shared.
- **Output:** convert `sunDirection` to render frame via the engine's existing `slToThree()` before
  exposing `sunDirThree`. Expose all palette outputs as plain reactive values.
- **Pure helpers** (unit-tested, no Three/Vue deps): `elevationFromSunDir(dir)`,
  `dayPhaseFromElevation(elev)`, `samplePalette(phase)`.

### 3. Client — `SkyDome` (in useWorldEngine or `src/lib/skyDome.js`)
- Large inverted `SphereGeometry` (BackSide), positioned at camera each frame (sky never approached),
  rendered first / depth-write off so it's a pure backdrop. Replaces solid `scene.background`
  (set `scene.background = null` and let the dome show; keep fog).
- Gradient fragment shader: lerp `skyZenith`→`skyHorizon` by view elevation; add a sun disc + glow
  centered on `sunDirThree`; additive star field (cheap point sprites or a star texture) faded by
  `starOpacity`. Optional simple moon disc opposite the sun (low priority within this component).
- Guard shader compile per the render-quarantine pattern; fall back to a vertical-gradient texture
  if compile fails.

### 4. Engine wiring — `useWorldEngine.animate()`
- Each frame: `env.update(dt)`; then apply `sun.position = sunDirThree * R`, `sun.color`,
  `sun.intensity`, `ambient.color`/`intensity`, `scene.fog.color`, sky-dome + cloud uniforms,
  and `renderer.toneMappingExposure = env.exposure`.
- One-time: `renderer.toneMapping = THREE.LinearToneMapping`. Verify the existing fixed sun/fill
  rig is superseded by env-driven values (keep the cool fill light, drive its intensity off phase).

### 5. Terrain detail textures (wiring/verify)
- Confirm decoded `RegionHandshake.terrainDetail[]` UUIDs + start-height/height-range reach
  `terrainMaterial.js` (replacing bundled defaults), fetched through the existing texture cache.
  Fall back to bundled WebP defaults on missing/dead assets. Mostly verification; fix the wire if
  it is currently defaults-only.

### 6. Procedural clouds — `src/lib/cloudLayer.js`
- High translucent plane (or shader dome band) above the region, camera-following horizontally,
  scrolling slowly (constant wind vector). Density/tint driven by `cloudTint` + `dayPhase`
  (orange at dawn/dusk, white midday, near-invisible at deep night). Procedural noise or a tiled
  cloud WebP. Depth-write off; renders after sky, before/independent of scene objects.

### 7. Trees / plants billboards (independent, last)
- PCode TREE(15)/GRASS(20) prims → camera-facing billboard quads, one bundled texture per species.
- **Requires a small reference read** for the species→texture mapping (OpenSim/libopenmetaverse
  tree-species enum) before implementing — do not hand-derive. Bundle a handful of WebP billboards.
- Fully separable from the atmosphere work; if it slips, atmosphere still ships complete.

### 8. Preferences / QuickPrefs
- **Day/night cycle** toggle (on = follow region time; off = fixed sky). When off, a
  **time-of-day override slider** (0..1) drives the sky directly (FS fixed-sky parity).
- Persist both (existing prefs store/IDB). Place alongside the existing "Lit Shading" graphics pref.
- The QuickPrefs draw-distance/preferences sync issue (separate queue item) is out of scope here.

## Error handling / edge cases
- **No time message** (grids that never send Low 150): local-clock fallback seeded at noon with
  `secPerDay = 14400`; respects the fixed-sky override if set.
- **Exposure floor:** clamp `[0.22, 1.0]` so night is moody, never pure black; never exceed 1.0 so
  daytime calibration is untouched.
- **Shader compile failure:** sky/cloud fall back to texture/gradient; never crash the render loop
  (wrap per existing try/catch quarantine at the renderer call).
- **Tone-mapping switch regression risk:** Linear@1.0 ≈ identity; visually diff day scene before/after
  on live verify to confirm no color shift.

## Testing
- **vitest (pure):** `elevationFromSunDir`, `dayPhaseFromElevation`, `samplePalette` (keyframe
  endpoints + midpoints + clamps); `decodeSimulatorViewerTime` round-trip from a captured/synthetic
  Low-150 buffer.
- **Live verify (osgrid):** sky visibly transitions; world darkens via exposure; lit prims shade
  with sun; terrain uses region textures; clouds scroll; trees billboard. Confirm day scene
  unchanged after tone-mapping switch. Confirm fallback when no time message.

## Internal sequencing (batch discipline)
1. **Server burst** (decoder + relay) → one Bun restart → "server settled — reconnect."
2. **Client over HMR:** `useEnvironment` + palette/helpers (+ tests) → SkyDome + engine
   exposure/light wiring → Preferences toggle/slider → terrain UUID wiring → procedural clouds →
   trees (last, after the species-table read).

## Out of scope (explicit)
- Sim wind/cloud LayerData decode (procedural clouds instead).
- WindLight/EEP cap-driven sky parameters (LLUDP sun only this pass).
- Shadows / SSR / water reflections (separate render brainstorm-first item).
- Real moon phase / star constellations accuracy (simple disc + generic star field only).
