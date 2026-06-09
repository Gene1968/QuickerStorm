# Per-Face Prim Materials — Design

**Date:** 2026-06-08
**Status:** Approved (design); not yet implemented
**Scope:** Square box and cylinder prims only (source-verified face maps). Prism, triangle/half profiles, sphere, torus, and any cut/hollow prim keep the existing dominant-face MVP.

**Prism note (scope correction during planning):** Prism was originally in scope, but Three's `CylinderGeometry(…, radialSegments=3, …)` puts all three lateral faces in a **single** geometry group, while SL numbers them as three separate faces (1, 2, 3). Splitting them would require a custom geometry builder (rejected approach C) — forcing one texture across all three sides reproduces exactly the wrong-side failure this design exists to avoid. Prism therefore falls back to dominant-face. True prism per-side is deferred to a future custom-geometry pass.

## Problem

Prims currently render with a single "dominant" texture/tint (`pickPrimTexture`): the `defaultTexture`, or the most-common per-face texture if the default is Blank. SL prims carry a full per-face `TextureEntry` (different texture, tint, and UV transform per face), already decoded server-side into `obj.faceTextures / faceColors / faceRepeats / faceOffset / faceRotation` (indexed by SL face number). For prims this per-face data is decoded but never used — multi-textured builds (the common "different texture on each side of a box" case) render with one texture on all faces.

Mesh assets already render per-face via `buildFaceMaterials` + geometry groups (`swapSubmeshesToGeometry` sets `materialIndex = submesh index = SL face index`). Prims were excluded because the prim→face mapping was believed unreliable.

## Already implemented (reuse — do NOT rebuild)

An audit of the current tree shows much of the machinery exists; this work is wiring + one new pure map, not new infrastructure:

- **`buildFaceMaterials(mesh, obj)`** (`useWorldEngine.js:2550`) — builds one `MeshBasicMaterial` per geometry group, applies per-face texture/tint/UV, array-aware dispose, stale-swap guard. Triggered from `applySwap` at line 1474 (`if (meshMulti) buildFaceMaterials(...)`). **Change = add an optional `faceMap` param; otherwise reused as-is.**
- **`hasMultiFaceMesh(obj)`** (`useWorldEngine.js:60`) — the ≥2-distinct gate pattern to mirror for prims.
- **Geometry groups** are produced by Three's box/cyl/prism constructors and **survive the worker bake** (`extractGeomArrays`/`geometryFromArrays` in `primGeometry.js`). No geometry change needed.
- **TextureEntry per-face decode** — `faceTextures / faceColors / faceRepeats / faceOffset / faceRotation / pbrMaterials`, all indexed by SL face number, already on every `ObjectData`.
- **ObjectEditFloater Texture tab** already reads `obj.faceTextures / faceColors / pbrMaterials` for any object: `distinctTextures` + `isMultiTexture` ("Multiple (N)"), `isMultiColor`, `faceTexChips` (per-face diffuse chips with face-number badges + preview), `pbrFaceChips`. For prims it ALREADY displays per-face overrides — the renderer simply hasn't matched that display yet. **The only floater gap is per-face UV** (it shows the default face's repeats/offset/rotation only).

So the remaining work is: `primFaceMap` (new), the `faceMap` param on `buildFaceMaterials`, `hasMultiFacePrim` + the `applySwap`/gate wiring, and the floater's per-face-UV display.

## Key findings (what makes this tractable)

1. **Three.js primitive geometries DO produce groups** (empirically verified, three r184):
   - `BoxGeometry(1,1,1,2,8,2)` → 6 groups, `materialIndex` 0–5, order `+X, -X, +Y, -Y, +Z, -Z`.
   - `CylinderGeometry(...)` / prism → 3 groups: 0 = lateral side, 1 = top (+Y), 2 = bottom (-Y).
   - `SphereGeometry` / `TorusGeometry` → **0 groups** (single material — correct, they are ~1 SL face).
2. **Groups survive the worker bake.** `extractGeomArrays` serializes `geom.groups` and `geometryFromArrays` restores them, so a worker-baked prim arrives with its groups intact.
3. **`buildFaceMaterials` already does the per-face work** — it builds one `MeshBasicMaterial` per group, applies per-face texture/tint/UV, with array-aware dispose and a stale-swap guard. It only needs to (a) be reachable for prims and (b) know that a prim group's `materialIndex` is *not* the SL face index.

So the only genuinely new/fragile thing is the **SL-face-index → Three-group remap** per prim type.

## Architecture

### New unit: `src/lib/primFaceMap.js` (pure)

```
primFaceMap(shape) -> number[] | null
```

- Returns a `group → SLface` array: for Three group `materialIndex g`, the SL TextureEntry face index is `result[g]`.
- Returns `null` when the prim is not a clean box/cylinder/prism (sphere, torus, or any prim with hollow, profile cut/slice, or a profile/path the simplified geometry does not model face-for-face). `null` signals the caller to keep the single-material dominant-face path.
- Pure, total, no I/O — unit-testable; safe in hot paths.

**Derivation of the map (source-verified).** Two halves are composed:
- *Three group → physical side*: fixed by Three's constructors (box mi: 0=+X,1=−X,2=+Y,3=−Y,4=+Z,5=−Z; cylinder mi: 0=side,1=top,2=bottom), mapped to SL axes via `slToThree(x,y,z)=(x,z,−y)`: Three +X→SL +X, −X→−X, +Y→SL +Z (top), −Y→SL −Z (bottom), +Z→SL −Y, −Z→SL +Y.
- *SL face index → physical side*: from the [SL Wiki Face table](https://wiki.secondlife.com/wiki/Face) (raw wikitext), clean box face list: `0=top(+Z), 1=−Y, 2=+X, 3=+Y, 4=−X, 5=bottom(−Z)`; cylinder: `0=top(+Z), 1=outside, 2=bottom(−Z)`.

Composed `group→SLface` arrays:
- `BOX_FACE_MAP = [2, 4, 0, 5, 1, 3]`
- `CYL_FACE_MAP = [1, 0, 2]`

These are frozen as the unit-test's expected values and confirmed by one live spot-check (a box textured distinctly per side).

**Gating:** the box map applies only to a true square box (`pathCurve===16 && (profileCurve&0x0F)===1`); the cylinder map only to `pathCurve===16 && profileCurve&0x0F===0`. Any prim with hollow or a path/profile cut (`profileHollow / pathBegin / pathEnd / profileBegin / profileEnd` non-zero) renumbers SL faces → returns `null` (fallback). All other types → `null`.

### Changed unit: `buildFaceMaterials(mesh, obj, faceMap?)`

- New optional `faceMap` param. For each group `materialIndex g`, the SL face index is `faceMap ? faceMap[g] : g`. All TE lookups (`faceTextures`, `faceColors`, `faceRepeats`, `faceOffset`, `faceRotation`) use the SL face index.
- Mesh callers pass no `faceMap` → behavior unchanged (`g == SLface`).
- If `faceMap[g]` is out of range or the face has no override, fall back to `defaultTexture` / `defaultColor` (existing behavior).

### Changed unit: `hasMultiFacePrim(obj)` (new, in useWorldEngine)

- True when `primFaceMap(obj.shape)` is non-null **and** there are ≥2 distinct real textures or ≥2 distinct real tints across the prim's faces (mirrors `hasMultiFaceMesh`'s ≥2-distinct gate).
- This gate is the perf guard (see below).

### Wiring in useWorldEngine

- `applySwap` (post-bake hot-swap, where geometry/groups are guaranteed present): if `hasMultiFacePrim(obj)` → `buildFaceMaterials(mesh, obj, primFaceMap(obj.shape))`.
- The single-material prim path (`primTexId = pickPrimTexture` at the construction site, PBR/legacy apply) is skipped for multi-face prims, the same way it is skipped today for `meshMulti`. Extend that guard to also cover multi-face prims.
- Backfill (`reapplyDiffuse` / `backfillTextures`) already skips array-material meshes — no change needed; multi-face prims are array-material so they are correctly skipped.

## Data flow

```
ObjectUpdate (server decode: per-face TE arrays, indexed by SL face)
  → engine upsert: build prim geometry (groups present)
  → worker bake (groups serialized + restored)
  → applySwap:
      hasMultiFacePrim?  yes → buildFaceMaterials(mesh, obj, primFaceMap(shape))
                          no  → single MeshBasic/Standard, pickPrimTexture (unchanged)
```

## ObjectEditFloater integration

The floater already surfaces per-face textures, tints, and PBR for any object (mesh or prim), so multi-face prims read correctly there the moment they render. Two additive touches keep it consistent with the new per-face rendering:

- **Per-face UV (the gap).** The Mapping section currently shows only `defaultRepeats / defaultOffset / defaultRotation`. Add per-face UV display mirroring `faceTexChips`: a `faceUvRows` computed listing faces that override UV (`faceRepeats[i] / faceOffset[i] / faceRotation[i]`), shown under a "Per-face mapping" subsection. Read-only, same style as existing rows.
- **No data-shape changes.** The floater already binds to the same `obj.*` fields the renderer uses, so no new store wiring. This is purely surfacing the per-face UV that the renderer now applies.

Explicitly out of scope for the floater here: a face-picker that highlights a single face in the 3D view and shows its *resolved* (override-or-default) values — that is a larger Build-Tools feature (the "Select face" mode) deferred to a later pass. The current override-chip display is sufficient for parity with the rendering change.

## Perf

A multi-material box costs 6 draw calls vs 1. On 20k-prim regions, applying it to every prim would multiply draw calls. Mitigation: enter the multi-material path **only when faces genuinely differ** (`hasMultiFacePrim` ≥2-distinct gate). Uniform-texture prims — the large majority — stay single-material. Draw-call cost scales with the count of actually-multi-textured prims, not total prims.

## Edge cases / fallback

- **Sphere / torus / cut / hollow / profile-sliced / unmodeled profile** → `primFaceMap` returns `null` → dominant-face MVP. No regression.
- **Multi-face prim that also carries PBR / legacy material** → skip PBR, render unlit per-face (same accepted limitation as the mesh per-face path; tech-debt `perface-pbr-skip`).
- **Per-face glow / fullbright** → deferred (parity with the mesh path, which is also unlit per-face). Logged as debt.
- **Twist/taper** → deformation moves vertices but does not change group membership or count, so the map still holds. (Extreme twist that visually scrambles faces is cosmetic, not a mapping break.)
- **Stale async swap** → reuse `buildFaceMaterials`' existing `mesh.material !== mats` guard inside the texture `.then()`.

## Testing

- `src/__tests__/lib/primFaceMap.test.js`:
  - box → frozen verified 6-entry `group→SLface` array.
  - cylinder, prism → frozen verified 3-entry arrays.
  - sphere, torus → `null`.
  - hollow / profile-cut / sliced box → `null`.
- Indexing behavior: given a `faceMap`, group `g` resolves to the correct SL face and pulls that face's TE entry (test the resolution helper, not the Three material object).
- Live verification: rez/observe a box with a distinct texture per side → textures land on the correct sides; a multi-tint box → tints on correct sides; a uniform box → still single-material (no perf regression, no visual change).
- ObjectEditFloater: with a multi-face prim selected, the Texture tab shows per-face texture chips (existing) and the new per-face UV rows; values match what the renderer applies. Uniform prim shows no per-face sections.

## Out of scope

- Cut/hollow/sliced face mapping (those add/renumber SL faces beyond the simplified geometry).
- Per-face PBR and per-face glow/fullbright.
- Sphere/torus per-face (single SL face in practice).
- Any change to the mesh per-face path beyond the additive `faceMap` parameter.
