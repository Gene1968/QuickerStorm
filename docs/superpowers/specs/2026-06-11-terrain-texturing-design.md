# Terrain Texturing — SL-Parity Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm)
**Scope:** Replace the elevation-only vertex-color terrain with SL/Firestorm-parity
4-texture, height-blended, noise-dithered terrain. Bundled local defaults for
instant paint + grid-supplied custom textures.

## Problem

Terrain currently renders as a `PlaneGeometry` painted with per-vertex colors
derived purely from elevation (`heightColor()` in `useWorldEngine.js`), on a
`MeshBasicMaterial`. The region *already* hands us everything needed for real
texturing — `RegionHandshake` decodes `terrainDetail[0..3]` (4 detail-texture
UUIDs) plus `terrainStartHeight`/`terrainHeightRange` (4 corner floats each) and
stores them in `sessionStore.terrainTextures` (`App.vue:28-45`) — but nothing
consumes them. The ground reads as a flat elevation gradient instead of SL's
blended dirt/grass/rock/mountain.

## Goal

Render terrain with SL-parity fidelity:
- 4 detail textures blended by elevation, using the region's per-corner
  `StartHeight`/`HeightRange` bilinearly interpolated across the region.
- Fractal noise turbulence dithering the band seams (Firestorm `terrainF` look).
- Textures sourced from the grid (custom per region), with SL's stock defaults
  bundled locally for zero-latency paint and as a load-time fallback.

## Non-Goals (deferred)

- **PBR terrain** (`TerrainPBR1..4` / `SupportTerrainPBR`) — rare on OpenSim; later slice.
- Changes to terrain **geometry, collision, raycast, or height decode** — all untouched.
- Server-side changes — `terrainDetail`/start/range already decoded and relayed.

## Architecture

### Components

1. **`src/lib/terrainTextures.js`** (NEW, pure + asset map)
   - `DEFAULT_TERRAIN_UUIDS` — the 4 well-known OpenSim default terrain UUIDs,
     each mapped to its bundled WebP (`src/assets/img/terrain-{dirt,grass,rock,mountain}.webp`).
     *Verify the exact UUIDs against OpenSim `RegionSettings.cs DEFAULT_TERRAIN_TEXTURE_1..4`
     during implementation — do not trust from memory.*
   - `resolveTerrainSlot(uuid)` → `{ kind: 'default', url }` when the UUID is a
     known default, else `{ kind: 'custom', uuid }`.
   - `bilerpCorners(corners, u, v)` — bilinear interpolation of a 4-corner array
     (00,01,10,11 order per the codec) at normalized region coords. Pure, unit-tested.
   - `layerWeights(elev, starts[4], ranges[4], noise)` — the SL blend: per-layer
     alpha from `(elev - start) / range` ramps + noise turbulence, normalized.
     Pure, unit-tested. (Mirrors the fragment math so it can be tested off-GPU.)

2. **`src/lib/terrainMaterial.js`** (NEW) — builds the terrain `ShaderMaterial`:
   - Uniforms: `uTex0..3` (sampler2D), `uStartHeight` (vec4), `uHeightRange` (vec4),
     `uRegionSize` (vec2), `uTexScale` (float, SL terrain repeat), `uNoiseScale`/`uNoiseAmp`.
   - **Unlit** (consistent with the existing MeshBasicMaterial-for-terrain decision —
     avoids the ACES/tone-map artifacts documented in `[[threejs-rendering-decisions]]`).
   - Vertex shader passes world XZ + elevation (Three Y) to the fragment shader.
   - Fragment shader: bilerp the corner start/range from world XZ → region UV,
     compute 4 layer weights (with fractal noise), sample each detail texture at
     `worldXZ * uTexScale`, blend, output sRGB.
   - Falls back to a flat tint if a sampler is not yet bound (1×1 placeholder texture).

3. **`useWorldEngine.js`** — wiring:
   - Keep building the terrain mesh on the current `MeshBasicMaterial` + vertex
     colors (so the ground is **never blank** during login). `heightColor()` stays
     as the pre-texture look and the shader's fallback base color.
   - New `loadTerrainTextures()` driven by a `watch` on `sessionStore.terrainTextures`
     (alongside the existing `waterHeight` watch at `useWorldEngine.js:201`):
     for each of the 4 slots, `resolveTerrainSlot()`:
     - **default** → load bundled WebP via `THREE.TextureLoader` (browser-native,
       instant, no grid fetch, no J2C decode).
     - **custom** → request through the **existing texture pipeline**
       (`useTextureFetch` → server J2C decode → IDB cache). Until it resolves, bind
       the bundled grass/dirt default so the slot is never empty.
   - Once **all 4 slots have at least a fallback texture** bound, swap
     `terrainMesh.material` to the terrain `ShaderMaterial` and set its uniforms.
     Re-bind each slot's uniform as custom textures finish decoding (no full rebuild).
   - On region change / unmount: dispose the terrain material + revert to the
     vertex-color material on the next region's mesh (existing `clearTerrain` path).

### Data flow

```
RegionHandshake (server)
  → S.REGION_INFO { terrainDetail[4], terrainStartHeight[4], terrainHeightRange[4] }
  → sessionStore.terrainTextures            (already wired, App.vue:38-44)
  → [watch] loadTerrainTextures()           (NEW, useWorldEngine)
      slot default → bundled WebP (instant)
      slot custom  → useTextureFetch (J2C decode, async)
  → terrainMaterial uniforms (uTex0..3, uStartHeight, uHeightRange, uRegionSize)
  → swap terrainMesh.material once 4 slots bound
```

### Loading transition

| Phase | Terrain material | Look |
|-------|------------------|------|
| Login / LayerData arriving | `MeshBasicMaterial` + vertex colors | elevation gradient (current) |
| `terrainTextures` resolved, defaults bound | `ShaderMaterial`, defaults in custom slots | textured, instant on stock regions |
| Custom textures decoded | same material, uniforms re-bound | full per-region parity |

## Blend math (SL parity)

Per fragment, in world XZ:
1. `u = worldX / regionSizeX`, `v = worldZ-mapped / regionSizeY` (respect the
   `iy = ry - slY` mesh orientation from `[[threejs-rendering-decisions]]`).
2. `start = bilerp(uStartHeight, u, v)`, `range = bilerp(uHeightRange, u, v)`.
3. `e = (elevation - start) / range` → normalized 0..3 layer position.
4. Add fractal noise `turb(worldXZ * uNoiseScale) * uNoiseAmp` to `e` to dither seams.
5. Layer weights from the fractional position across [tex0,tex1,tex2,tex3]; sample
   each at `worldXZ * uTexScale`; blend; convert to sRGB output.

The pure JS twins (`bilerpCorners`, `layerWeights`) let us unit-test the blend
logic without a GL context; the GLSL is the same math.

## Testing

- **Unit (bun:test or vitest, pure libs):**
  - `bilerpCorners` — corner/edge/center interpolation, var-region sizes.
  - `layerWeights` — monotonic elevation → correct dominant layer, weight sum ≈ 1,
    noise within bounds, clamps at min/max elevation.
  - `resolveTerrainSlot` — known defaults → bundled url; unknown → custom passthrough;
    empty `''` slot → fallback default.
- **Build:** `npm run build:staging` green (shader compiles, asset imports resolve).
- **Live-verify (user):** stock region paints textured instantly on login; custom
  region (e.g. NeverWorld) shows defaults then swaps to custom textures; band seams
  look dithered not striped; no regression to height/collision/walk.

## Risks / Notes

- **Default UUIDs must be verified** against OpenSim source, not memory — a wrong
  UUID silently routes a default region through the (slower, decode-heavy) custom path.
- **Texture repeat scale (`uTexScale`)** needs tuning to match SL's terrain density;
  start from FS's value and adjust live.
- **sRGB/linear:** sample textures as sRGB, do blend math in the appropriate space,
  output sRGB — mirror the care already taken in `heightColor()`/`srgbToLinear()`.
- WebP decode is browser-native and universally supported in the target Chrome.
- Memory: 4 terrain textures are negligible vs the object texture budget; no
  interaction with the texture-cache LRU governor.
