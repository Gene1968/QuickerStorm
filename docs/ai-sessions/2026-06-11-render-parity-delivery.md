# 2026-06-11 — Render parity delivery: J2C decode, alpha modes, RenderMaterials, FS-parity sculpts

One feature delivery assembled from a chain of root-caused fixes, each live-verified against
Firestorm on the same region (palm-forest sculpt `1f22d8ad…`/667280850 was the test object
throughout). 128 server tests green, staging build green.

## Shipped

### 1. J2C decoder swap: cornerstone-openjpeg → magick-wasm (server/lib/j2c.ts)
`@cornerstonejs/codec-openjpeg@1.3.0` (latest) silently mis-decodes Kakadu-encoded multi-quality-
layer RGBA codestreams — luma/chroma/alpha all corrupted (alpha foliage rendered as opaque white
blobs). Proven via grid-direct asset fetch (`http://<grid>:8002/assets/<uuid>` is public on OpenSim
Robust) + Pillow ground truth + a parity sweep: magick-wasm is byte-identical to cornerstone on
streams cornerstone decodes correctly, and matches Pillow on the ones it corrupts. Cornerstone kept
as lazy fallback (logs if it ever rescues a stream). Fixture test: `j2c-rgba-kakadu.test.ts`.
Client texture IDB cache purged once (qs-tex v2→v3, `failed` store cleared for one retry).

### 2. Legacy alpha modes (#17b) (useWorldEngine.js, ObjectEditFloater.vue)
Textures with alpha now render BLENDED (SL legacy default `DIFFUSE_ALPHA_MODE_BLEND`) instead of
a hard `alphaTest=0.5` cutout that banded gradient alphas. `depthWrite` stays ON (the historical
white-wash came from depthWrite=false, not blending); `alphaTest=0.05` discards near-zero
fragments. Precedence in `alphaPolicyStamp`: floater override > material DiffuseAlphaMode > auto.
Floater "Alpha mode" select (Auto/None/Blend/Mask/Emissive) is wired live via a module-level
engine bridge (`setObjectAlphaMode`) — local render override only, not sent to the sim.

### 3. RenderMaterials cap fixed (#16) (handlers/materials.ts, lib/llsd.ts)
Root-caused from OpenSim source (`MaterialsModule.cs`): the `Zipped` payload both ways is
zlib-compressed LLSD-**Binary** (request: array of 16-byte material IDs; response: array of
`{ID, Material}`), not LLSD-XML as we sent/parsed → sim threw → empty body → feature disabled
since slice 2. New `encodeLLSDBinaryUuidArray` + pure request/response codecs, tested against
OpenSim's verbatim empty-response constant. Material alpha mode/cutoff, normal map, specExp now
flow to the client material path.

### 4. TextureAnim decode (lludp-codec.ts)
`TextureAnim` block now captured in both ObjectUpdate paths (was skipped; compressed path also
never advanced past the TE — latent). When a texture animation is ON, viewers bypass TE repeats
via a texture matrix — decoded and relayed (`obj.textureAnim`, in TEDUMP) for diagnosis; render-
side application deferred until live content needs it.

### 5. FS-parity sculpt mesh builder (server/lib/sculptDecode.ts) — the big one
Rewritten to mirror `LLVolume::sculpt`/`sculptGenerateMapVertices`/`sculpt_calc_mesh_resolution`
(llvolume.cpp:3050/3170) exactly:
- **Aspect-aware grid**: vertices = min(detail², w×h/4) split by map aspect ratio (8×512 palm
  map → 4×256-side grid, NOT fixed 32×32). genNGon emits sides+1 points spanning 0..1 inclusive.
- **Exact sampling lattice**: texel = floor(k/sides × dim) — even columns; rows even **from the
  bottom** (FS reads LLImageRaw, whose scanlines are bottom-up; our top-down decode mirrors the
  row index). Off-lattice texels are never read by viewers and may hold garbage by design.
- **UV = k/sides**: phase-aligns grid-multiple repeats — the palm's TE Repeats 4×-256 land exactly
  one full texture per billboard quad (the author's design, fully decoded).
- Sphere pole pinch, torus row wrap, plane seam clamp, INVERT/MIRROR flags.
- Client `uvXform` repeat clamp (±100) REMOVED — FS has none; huge repeats are legitimate content.

## Key lessons (also in session memory)
- Sculpt authors target the exact viewer sampling lattice; emulate it verbatim.
- LL viewer code indexes images bottom-up (GL convention) — flip rows when porting.
- FS Build-Tools shows greyed defaults when a face has no material — not material evidence.
- Per-axis RPM (= repeat ÷ prim span) is a strong remote cross-check for TE decode correctness.
- OpenSim Robust exposes `GET /assets/<uuid>` publicly — invaluable offline-analysis lever.
- `QS_WATCH_LOCALIDS` raw hex capture settled every decode-correctness argument definitively.

## Deferred / follow-ups
- Per-face legacy material fetch (buildFaceMaterials does default face only).
- Floater display of material Glossiness/normal/spec maps (#16 polish), Select Face radio.
- Emissive alpha mode renders as None (unlit prim materials).
- TextureAnim render application (texture matrix override) when live content needs it.
- Cached objects decoded before the TextureAnim/codec fixes lack the new fields until re-seen
  fresh (ObjectSelect on Edit forces a fresh full update).
