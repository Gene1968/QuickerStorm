# Mesh Geometry Decode — Design

**Date:** 2026-06-04
**Status:** Design approved (pending spec review)
**Branch:** phase3
**Companion to:** `2026-06-03-caps-feature-map.md` (cluster A — mesh fetch)

## Goal

Render **mesh prims** as their real geometry instead of placeholder cubes. Mesh is the dominant
content type for modern OpenSim/SL builds (furniture, buildings, vehicles), so this is the biggest
remaining "world looks like world" lever after diffuse textures. Legacy sculpts are a follow-up
phase on the same architecture.

## Approach: server-side decode, client builds geometry

The server fetches the mesh asset, parses its LLSD-binary header, inflates a LOD, and decodes the
LLVolumeFaces binary into flat geometry arrays; the client builds a `THREE.BufferGeometry` and
replaces the cube. This reuses the server's existing `parseLLSDBinary` (lib/llsd.ts) and Bun `zlib`,
keeps the heavy/proprietary decode off the browser, and mirrors the texture pipeline (UUID-keyed,
IndexedDB-cached).

## Reference (cluster A map + libomv/FS)

- **Mesh detection:** Sculpt ExtraParam type `0x30` = `[sculptTexture UUID 16B][sculptType U8]`.
  `sculptType & 0x07`: 1 sphere, 2 torus, 3 plane, 4 cylinder, **5 mesh**. For mesh, the UUID is the
  **mesh asset** id. (Bit 0x40 = invert, 0x80 = mirror — irrelevant for mesh.)
- **Fetch:** `GET {ViewerAsset|GetMesh2|GetMesh}/?mesh_id={uuid}`, `Accept: application/vnd.ll.mesh`.
  MVP fetches the **whole asset** (no byte-range).
- **Header:** optional 17-byte `<? LLSD/Binary ?>` prefix, then LLSD-**Binary** map with keys
  `version`, `high_lod`/`medium_lod`/`low_lod`/`lowest_lod`/`skin`/`physics_*` each `{offset,size}`.
  Offsets are **relative to the end of the header** (absolute = `headerSize + offset`, where
  `headerSize` = the byte index returned by `parseLLSDBinary(...).end`).
- **LOD block:** zlib **deflate** (use `zlib.inflateSync`; if it fails, try raw via
  `inflateRawSync`). Inflated payload is LLSD-**Binary**: an **array of submeshes**, each a map:
  - `PositionDomain`: `{Min:[x,y,z], Max:[x,y,z]}` (floats)
  - `Position`: binary blob, `U16[3]` per vertex, little-endian; un-quantize each axis:
    `v = Min + (u16/65535) * (Max - Min)`
  - `Normal`: binary blob, `U16[3]` per vertex; un-quantize to `[-1,1]`: `n = (u16/65535)*2 - 1`
  - `TexCoord0`: binary blob, `U16[2]` per vertex; un-quantize via `TexCoord0Domain{Min,Max}` (2D)
    if present, else `[0,1]`
  - `TriangleList`: binary blob, `U16[3]` per triangle (vertex indices)
  - (`NoGeometry` flag → skip a submesh)
- **Per-submesh = a Three group** with its own material slot (face index), so the existing
  TextureEntry per-face texture/material can map to submeshes later.

## Components

### Server
- `server/lib/lludp-codec.ts` — `parseSculptExtraParam(buf, start, len)` → `{uuid, sculptType}`;
  wire into both decoders' ExtraParams walk (alongside the existing `0x80` handling). Emit
  `meshId?: string` (set only when `sculptType & 7 === 5`) and `sculptType?: number` on `ObjectData`.
- `server/lib/meshDecode.ts` — NEW, pure + testable:
  - `parseMeshHeader(buf)` → `{ headerSize, lods: { high?, medium?, low?, lowest? } }`
  - `decodeMeshLOD(buf, headerSize, lod)` → `Submesh[]` where
    `Submesh = { positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint16Array }`
    (inflate + LLSD-binary submesh array + un-quantize).
- `server/handlers/mesh.ts` — NEW `handleMeshFetch(circuitId, { meshId })`: resolve cap, fetch full
  asset, `parseMeshHeader` → pick high LOD (fallback medium→low→lowest) → `decodeMeshLOD` → send
  `S.MESH_DATA { meshId, submeshes }` (arrays as plain number[] or base64; see Data shapes).
- `shared/protocol.js` — `C.MESH_FETCH { meshId }`, `S.MESH_DATA { meshId, submeshes, error? }`.

### Client
- `src/composables/useMeshFetch.js` — `getMesh(uuid)` → `Submesh[]` (or null); IndexedDB-cached
  (reuse `textureCache.js` pattern or a parallel `meshCache.js`), in-flight dedupe + negative cache.
- `src/composables/useWorldEngine.js` — when `obj.meshId`, fetch geometry; on arrival build a
  `THREE.BufferGeometry` (set `position`/`normal`/`uv` attributes + `index`; one `addGroup` per
  submesh) and swap it into the existing mesh (replace the cube geometry), keeping the current
  material/texture pipeline. Guard against teardown (mesh.parent) as elsewhere.

### Data shapes
`S.MESH_DATA.submeshes`: `[{ positions:number[], normals:number[], uvs:number[], indices:number[] }]`.
Keep arrays as JSON number[] for MVP (simple); switch to base64 typed arrays later if payloads are
large. Mesh is fetched once per UUID and cached, so JSON size is acceptable initially.

## Bundles (ordered)

1. **Capture one real mesh asset** — one-shot server-side fetch of a known mesh UUID (logged from a
   detected mesh prim) → `server/__tests__/fixtures/mesh-asset.bin`. Single HTTP fetch, reliable.
2. **Server detect** — `parseSculptExtraParam` + emit `meshId`/`sculptType` in both decoders. TDD
   (synthetic ExtraParam bytes + the captured packet if available).
3. **Header parse** — `parseMeshHeader` (vs captured asset): asserts a `high`/`medium` LOD
   `{offset,size}` and a sane `headerSize`.
4. **LLVolumeFaces decode** — `decodeMeshLOD` (vs captured asset): asserts ≥1 submesh, vertex count
   > 0, `indices.length % 3 === 0`, all positions finite and within `PositionDomain`. The meat.
5. **Client apply** — `useMeshFetch` + BufferGeometry build + cube replacement + IndexedDB cache.
6. **Live-verify** — mesh objects render as real shapes; existing texture pipeline textures them.

## Testing

- `parseSculptExtraParam`, `parseMeshHeader`, `decodeMeshLOD` are pure → unit-tested. Header + LOD
  decode run against the captured real `mesh-asset.bin` (the proven fixture pattern).
- Geometry correctness assertions: vertex/triangle counts, finite + in-domain positions,
  `indices.length % 3 === 0`, indices < vertexCount.
- Visual = live-verify.

## Risks

1. **Quantization details** (position/normal/UV domains, endianness) — pin against the captured
   asset; assert positions land inside `PositionDomain`.
2. **zlib variant** — try `inflateSync`, fall back to `inflateRawSync`.
3. **Big meshes / payload size** — MVP fetches whole asset + high LOD + JSON arrays; LOD-by-distance,
   byte-range, and base64 typed arrays are deferred perf work.
4. **Mesh detection on full-update prims** rides the shared ExtraParams wiring (compressed is solid;
   full-update ExtraParams has known fragility — track if mesh prims via full update mis-detect).

## Out of scope (deferred)

- Legacy sculpts (sculptType 1–4) — phase 2, same architecture (J2C sculpt map → vertex grid).
- LOD-by-distance selection, byte-range fetch, base64 payloads.
- Rigged/skinned mesh (avatar bodies) + physics mesh.
