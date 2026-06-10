# Slice 2 — Materials / PBR (hybrid lit) Design

**Date:** 2026-06-03
**Status:** Design approved (pending spec review)
**Branch:** phase3
**Companion to:** `2026-06-03-caps-feature-map.md` (cluster D)

## Goal

After diffuse textures (slice 1), render prim **materials**: legacy normal/specular maps
(`RenderMaterials`), GLTF **PBR** (base/metallic-roughness/normal/emissive), and TE **glow**. Make
material-bearing prims look right (lit, with normal/spec/PBR response) without regressing the fast,
flat-bright path that the majority of plain prims use today.

## Key decision — hybrid lit materials

Prims currently use `MeshBasicMaterial` (unlit) by deliberate choice: `MeshStandardMaterial` caused
rotation-flicker historically ([[threejs-rendering-decisions]]). Slice 2 keeps that default and
switches **only material-bearing prims** to a lit material. Per-prim selection at mesh-build:

```
PBR present (ExtraParam 0x80 material UUID) → MeshStandardMaterial + GLTF
else legacy material_id (TE field 11) != 0  → MeshStandardMaterial + RenderMaterials
else                                         → MeshBasicMaterial (current diffuse path)
```

This bounds the flicker risk, perf cost, and look-change to the minority of prims that actually
carry a material. Plain prims stay exactly as they are.

Sun/fill/ambient lights already exist in the scene (added for avatar capsules) — no new lighting
infrastructure needed; lit prims simply respond to them.

## Reference (authoritative shapes from cluster D map)

- **TE field layout** (per-face default + overrides): …texture(1), color(2), scaleS(3), scaleT(4),
  offsetS(5), offsetT(6), rotation(7), **bump(8)**, media(9), **glow(10)**, **material_id(11)**.
  - bump byte: `[7:6]=Shiny [5]=Fullbright [4:0]=Bumpmap`. glow: U8 `/255`. material_id: UUID (legacy
    LLMaterial ref; zero = none). material_id field is **optional** (blob may end before it).
- **ExtraParam `0x80` (MaterialsEP)** in the ExtraParams blob: `[count U8][te_index U8][asset_UUID
  16B]×count` — per-face GLTF material asset UUIDs.
- **PBR asset**: `GET ViewerAsset/?material_id={uuid}` → LLSD `{version:"1.1", type:"GLTF 2.0",
  data:"<gltf json ≤2048B>"}`. GLTF `materials[0]`: `pbrMetallicRoughness{baseColorTexture,
  metallicRoughnessTexture, baseColorFactor[RGBA], metallicFactor, roughnessFactor}`,
  `normalTexture`, `emissiveTexture`, `emissiveFactor[RGB]`, `alphaMode`, `alphaCutoff`,
  `doubleSided`; `images[].uri` = texture UUID strings; `KHR_texture_transform` for UV.
  TextureInfo index: 0 base, 1 normal, 2 metallicRoughness(==occlusion, ORM packed), 3 emissive.
- **Legacy `RenderMaterials` cap**: POST `{Zipped:<zlib LLSD array of 16-byte material IDs>}` (≤50);
  response `{Zipped:<zlib LLSD array of {ID(16B), Material:{NormMap, NormOffset/Repeat/Rotation X/Y
  int/10000, SpecMap, SpecOffset/Repeat/Rotation, SpecColor[RGBA U8], SpecExp, EnvIntensity,
  DiffuseAlphaMode(0none/1blend/2mask/3emissive), AlphaMaskCutoff}}>}`.
- **Precedence**: PBR (ExtraParam 0x80 non-null for a face) > legacy material_id > TE-only.

## Components

### Server (decode)
- `parseTextureEntryFields` (lib/lludp-codec.ts): extend the generic field-walker past rotation to
  read **bump(8)** and **glow(10)** and **material_id(11)**. Emit `defaultGlow`, `defaultShiny`,
  `defaultFullbright`, `defaultBump`, `defaultMaterialId` (+ per-face where cheap). Walk must consume
  fields 8–11 in order; material_id is optional (guard end).
- **ExtraParam 0x80 decode**: new helper `parseMaterialsExtraParam(buf, start, len)` →
  `Array<{te, uuid}>`. Call it where each decoder currently *skips* ExtraParams:
  - compressed decoder: it reads `epCount`+entries and skips; capture the `0x80` entry instead.
  - full decoder: replace the `skipVar1('ExtraParams')` with a parse that extracts 0x80.
  Emit `pbrMaterials: Array<string|null>` (per-face asset UUID) + `defaultPbrMaterial`.
- New `ObjectData` fields: `defaultGlow?`, `defaultFullbright?`, `defaultShiny?`,
  `defaultMaterialId?`, `defaultPbrMaterial?`, `pbrMaterials?`.

### Server (transport)
- Reuse `handleAssetFetch` for PBR: add `assetType:'material'` → `ViewerAsset` cap, query key
  `material_id`, **no transcode** (return raw LLSD text). Or a dedicated `handleMaterialFetch`.
- New `handleRenderMaterials(circuitId, materialIds[])`: POST the `RenderMaterials` cap with a
  zlib-compressed LLSD array of IDs; **zlib-inflate** the response (Bun `zlib`), parse LLSD, return
  per-ID material records as JSON. New protocol msgs `C.MATERIAL_FETCH` / `S.MATERIAL_DATA`.

### Frontend
- `useMaterialFetch.js` (sibling to useTextureFetch): `getPbrMaterial(uuid)` and
  `getLegacyMaterial(uuid)` → resolved material descriptors; IDB-cached (extend textureCache or a
  parallel store). Dedupe + negative cache like textures.
- `useWorldEngine` material selection: build `MeshStandardMaterial` for PBR/legacy prims, wire its
  maps from fetched textures (reuse `getTexture` for each image UUID, with UV from
  KHR_texture_transform / legacy repeat-offset). Plain prims unchanged. `glow → emissive`,
  `fullbright → emissive=diffuse` on the lit path.

## Bundles (ordered, each verifiable)

1. **Capture fixtures** — temporary instrumentation (as in slice 1.5): one login to capture (a) a
   PBR-material prim packet (ExtraParam 0x80), (b) a legacy-`material_id` prim packet, (c) a
   `RenderMaterials` cap response, (d) a PBR GLTF asset. Store under `server/__tests__/fixtures/`.
   Remove instrumentation after.
2. **Server decode** — TE glow/shiny/fullbright/material_id + ExtraParam 0x80. TDD vs fixtures
   (assert sane ranges + exact UUIDs where known + no desync).
3. **Material foundation** — `useMaterialFetch`, hybrid selection in useWorldEngine, MeshStandard
   for material prims, glow→emissive. (No maps yet — proves the lit path + selection.)
4. **PBR apply** — GLTF JSON → MeshStandard base/ORM/normal/emissive maps + factors + alphaMode.
5. **Legacy apply** — zlib RenderMaterials → normalMap + (specular via roughness/metalness approx or
   Phong) + alpha mode.
6. **Flicker + live verify** — confirm no rotation-flicker on lit prims (fix: `computeVertexNormals`
   on prim geometry + `material.needsUpdate`); live-verify PBR + legacy + glow render correctly.

## Out of scope (tracked as deferrals)

- True **bloom** post-process for glow (emissive only this slice).
- Material **overrides** (GenericStreamingMessage 0x4175 + ModifyMaterialParams cap) — needs the
  LLSD-Notation parser (task #6); separate follow-up.
- Per-face material arrays beyond default face follow Gap B's material-array work (task #10).
- Animated textures (TextureAnim).

## Testing

- Decoders: TDD against captured real fixtures (the proven slice-1.5 pattern) — ranges, known UUIDs,
  byte-consumption (no desync).
- Material fetch/parse: unit-test the pure GLTF→descriptor and LLSD→legacy-record mappers.
- Visual + flicker: live-verify (can't unit-test rendering).

## Risks

1. **Flicker** on lit prims — bounded to material prims; expected fix is normals + needsUpdate.
2. **RenderMaterials zipped-LLSD format** (XML vs binary) — confirm from the captured response
   before writing the parser.
3. **PBR without strong lighting** may look flat — acceptable; lighting polish (shadows, sky) is a
   separate later slice.
