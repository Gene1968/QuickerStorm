# Terrain Rendering via LLUDP LayerData

**Date:** 2026-05-24
**Status:** Approved for implementation
**Scope:** Phase 1 — height-displaced terrain with topo coloring, water plane

---

## Goal

Decode LLUDP `LayerData` (Medium #6) terrain patches arriving from the sim, relay them to the browser, and render them as a height-displaced Three.js mesh with height-based vertex coloring (teal → green → stone). Replace the current flat placeholder terrain. Add a semi-transparent water plane at y=20.

---

## Background

The sim streams terrain data as `LayerData` Medium-frequency packets (wire ID `0xFF 0x06`). Each packet covers one 16×16 height patch (256 float values = 16m × 16m of terrain). A 256×256m region produces up to 256 patches in a burst after login. Heights are DCT-compressed: each packet carries quantized DCT coefficients that require an IDCT to recover actual meter values.

Reference implementation: `phoenix-firestorm/indra/llmessage/patch_idct.cpp` and `patch_dct.h`.

---

## Architecture

### New files
| File | Purpose |
|------|---------|
| `server/lib/terrain-codec.ts` | BitReader + patch header decode + IDCT + `decodeLayerData()` |

### Modified files
| File | Change |
|------|--------|
| `server/lib/lludp-codec.ts` | Add `MEDIUM_LAYER_DATA = 6` to message ID map; expose `decodeLayerData` |
| `server/handlers/lludp.ts` | Add `medium:6` case → decode + emit `S.TERRAIN_PATCH` |
| `shared/protocol.js` | Add `S.TERRAIN_PATCH = 'terrain_patch'` |
| `src/composables/useWorldEngine.js` | Replace flat terrain geometry, add `onTerrainPatch` handler |
| `src/stores/worldStore.js` | Add `terrainHeights: Float32Array(66049)` + `setTerrainPatch()` |

---

## Server: terrain-codec.ts

### Wire format

```
[standard LLUDP header 6 bytes]
[0xFF 0x06]  ← Medium frequency, msg ID 6
LayerData block:
  U8   Type           — 0x4C='L' land, 0x57='W' water, 0x37='7' wind, 0x38='8' cloud
  U16  Length
  U8[] Data           — compressed group header + one or more patches
```

Inside `Data`:

```
Group header (5 bytes, big-endian):
  U16  stride      — grids per edge (expect 264 for 16×16 patches)
  U8   patch_size  — 16 (NORMAL) or 32 (LARGE)
  U8   layer_type  — same as outer Type field

Patch header (bit-packed, variable length via BitReader):
  F32  dc_offset   — 32 bits, IEEE float
  U16  range        — 16 bits
  U8   quant_wbits  — 8 bits: upper 4 = quant level, lower 4 = word bits
  U32  patchids     — bits 20-15 = patch_y, bits 10-5 = patch_x (for 16-patch grid)

Patch data:
  N × (word_bits+1) bitfield values — quantized DCT coefficients
  Terminated by end-of-data marker
```

### BitReader

```typescript
class BitReader {
  private buf: Buffer
  private bitPos: number = 0
  constructor(buf: Buffer) { this.buf = buf }
  readBits(n: number): number   // reads n bits, MSB first
  readFloat32(): number          // reads 32 bits as IEEE 754 float
  readU16(): number              // readBits(16)
  readU8(): number               // readBits(8)
  get bytesRead(): number        // Math.ceil(bitPos / 8)
}
```

### IDCT algorithm (ported from patch_idct.cpp)

```typescript
const PATCH_SIZE = 16
const DEQUANTIZE_TABLE: Float32Array  // 256 entries: 1.0 + 2.0*(i+j) for i,j in 0..15
const COPY_MATRIX: Uint8Array         // zigzag ordering, 256 entries (from firestorm)
precomputeCosTable()                   // COS[n][k] = cos((2k+1)*n*π / 32) for n,k in 0..15

function decodePatch(reader: BitReader, header: PatchHeader): Float32Array {
  // 1. Read quantized coefficients into 256-element buffer via bitstream
  // 2. Dequantize: coeff[i] = quantized[COPY_MATRIX[i]] * DEQUANTIZE_TABLE[i]
  // 3. 2D IDCT over 16×16 block
  // 4. Denormalize each height:
  //    prequant = (quant_wbits >> 4) + 2
  //    quantize = 1 << prequant
  //    ooq = 1.0 / quantize
  //    mult = ooq * range
  //    addval = mult * (1 << (prequant - 1)) + dc_offset
  //    height[i] = idct_block[i] * mult + addval
  return heights  // Float32Array(256), values in metres
}
```

**Zero-range optimisation:** if `range === 0`, all 256 heights = `dc_offset` — skip IDCT entirely.

### decodeLayerData

```typescript
export function decodeLayerData(buf: Buffer): LayerDataResult | null {
  // Skip standard LLUDP header (6 bytes) + medium freq prefix (2 bytes)
  // Read Type, Length, then Data
  // Parse group header
  // Only process type 'L' (land) and 'W' (water) — skip wind/cloud
  // Decode all patches in Data, return array of { x, y, heights }
}

interface LayerDataResult {
  type: 'LAND' | 'WATER'
  patchSize: number         // 16 or 32
  patches: TerrainPatch[]
}
interface TerrainPatch {
  x: number                 // 0–15 patch grid column
  y: number                 // 0–15 patch grid row
  heights: Float32Array     // 256 values (patchSize × patchSize)
}
```

---

## Server: lludp.ts handler

Add to message ID constants:
```typescript
const MEDIUM_LAYER_DATA = 6
```

Add to `handleUdpMessage()` dispatch:
```typescript
} else if (type === `medium:${MEDIUM_LAYER_DATA}`) {
  const result = decodeLayerData(msg)
  if (!result) return
  if (result.type === 'LAND' || result.type === 'WATER') {
    ws.send(JSON.stringify({
      t: S.TERRAIN_PATCH,
      d: {
        layerType: result.type,
        patchSize: result.patchSize,
        patches: result.patches.map(p => ({
          x: p.x, y: p.y,
          heights: Array.from(p.heights),   // JSON serialisable
        })),
      },
    }))
  }
}
```

**Note:** LayerData is not zero-coded. Skip `decodeZeroCoded()` for this message type.

---

## Protocol: shared/protocol.js

```javascript
export const S = {
  // ... existing ...
  TERRAIN_PATCH: 'terrain_patch',
}
```

---

## Client: worldStore.js

```javascript
// WHY: Terrain heights survive remount (HMR, nav away/back).
// useWorldEngine rebuilds geometry from stored heights on mount.
// 257×257 = 66,049 vertices (256×256 metre region, 1m grid, +1 overlap).
const terrainHeights = ref(new Float32Array(66049))

function setTerrainPatch(px, py, heights, patchSize = 16) {
  // px, py: 0–15 patch grid coords
  // heights: 256 floats covering patchSize×patchSize metres
  const stride = 257
  for (let j = 0; j < patchSize; j++) {
    for (let i = 0; i < patchSize; i++) {
      const slX = px * patchSize + i  // SL X coordinate (col)
      const slY = py * patchSize + j  // SL Y coordinate (row)
      if (slX > 256 || slY > 256) continue
      terrainHeights.value[slY * stride + slX] = heights[j * patchSize + i]
    }
  }
}
```

---

## Client: useWorldEngine.js

### Terrain geometry replacement

Replace current flat PlaneGeometry with a vertex-position-controlled one:

```javascript
// Replace existing terrain mesh creation in initScene():
const terrainGeo = new THREE.PlaneGeometry(256, 256, 255, 255)
// WHY: PlaneGeometry(256,256,255,255) → 256×256 vertex segments = 257×257 vertices.
// Each vertex = 1m × 1m of SL terrain. Heights applied via position.y attribute.
// Rotate to XZ plane (SL horizontal) then translate to region centre (Three.js coords).
terrainGeo.rotateX(-Math.PI / 2)
terrainGeo.translate(128, 0, -128)

// Vertex color attribute for height-based coloring
const colors = new Float32Array(terrainGeo.attributes.position.count * 3)
terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

const terrainMat = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.FrontSide,
})
const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat)
scene.add(terrainMesh)

// Water plane at SL z=20 (Three.js y=20)
const waterMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshBasicMaterial({
    color: 0x1a6fb5,
    transparent: true,
    opacity: 0.72,
    side: THREE.FrontSide,
  }),
)
waterMesh.rotation.x = -Math.PI / 2
waterMesh.position.set(128, 20, -128)
scene.add(waterMesh)
```

### Height color function

```javascript
function heightToColor(h) {
  // Returns [r, g, b] in 0–1 range
  if (h <= 0)   return [0.08, 0.30, 0.60]   // deep water teal
  if (h <= 10)  return lerpColor([0.16, 0.50, 0.83], [0.25, 0.55, 0.45], h / 10)
  if (h <= 20)  return lerpColor([0.25, 0.55, 0.45], [0.29, 0.49, 0.35], (h-10)/10)
  if (h <= 40)  return lerpColor([0.29, 0.49, 0.35], [0.45, 0.42, 0.35], (h-20)/20)
  return lerpColor([0.45, 0.42, 0.35], [0.60, 0.58, 0.58], Math.min((h-40)/60, 1))
}
function lerpColor(a, b, t) { return a.map((v, i) => v + (b[i]-v)*t) }
```

### onTerrainPatch handler

```javascript
function onTerrainPatch(payload) {
  const { layerType, patchSize = 16, patches } = payload
  if (layerType === 'WATER') {
    // Adjust water plane Y from first water patch dc value if needed (future)
    return
  }
  // LAND patches — update terrain geometry
  const pos    = terrainMesh.geometry.attributes.position
  const col    = terrainMesh.geometry.attributes.color
  const stride = 257  // vertices per row (255 segments + 1)

  for (const { x: px, y: py, heights } of patches) {
    worldStore.setTerrainPatch(px, py, heights, patchSize)
    for (let j = 0; j <= patchSize; j++) {
      for (let i = 0; i <= patchSize; i++) {
        const slX = px * patchSize + i
        const slY = py * patchSize + j
        if (slX > 255 || slY > 255) continue
        // PlaneGeometry vertex order: row-major, X left→right, Z front→back
        // After rotateX(-π/2) + translate: vertex index = slY * stride + slX
        const vi = slY * stride + slX
        const h = heights[Math.min(j, patchSize-1) * patchSize + Math.min(i, patchSize-1)]
        pos.setY(vi, h)   // Three.js Y = SL Z (height)
        const [r, g, b] = heightToColor(h)
        col.setXYZ(vi, r, g, b)
      }
    }
  }
  pos.needsUpdate = true
  col.needsUpdate = true
  terrainMesh.geometry.computeVertexNormals()
}
```

Register in `onMounted`:
```javascript
on(S.TERRAIN_PATCH, onTerrainPatch)
```
Deregister in `onUnmounted`:
```javascript
off(S.TERRAIN_PATCH, onTerrainPatch)
```

**Remount rebuild:** In `initScene()`, after creating terrain geometry, call `rebuildTerrainFromStore()` which applies all `worldStore.terrainHeights` to vertex positions — so HMR/nav-back doesn't lose terrain.

---

## Error handling

| Scenario | Handling |
|----------|---------|
| Decode error (short buffer, bad bits) | `decodeLayerData` returns `null`; handler logs debug, no crash |
| Out-of-range patch coords (px/py > 15) | `setTerrainPatch` clamps/skips; no array overrun |
| Wind/cloud layer type | Silently ignored in handler |
| Geometry not yet initialised | `terrainMesh` ref checked before patch apply |
| Zero-range patch | dc_offset applied to all 256 heights, IDCT skipped |

---

## Testing

1. **Unit — terrain-codec.ts:** Feed a known LayerData binary capture from OSGrid (use Wireshark or add a raw-log mode to lludp.ts). Assert decoded heights are plausible (0–512m range, smooth variation).
2. **Visual smoke test:** Login to OSGrid sandbox, wait 5–10s, confirm terrain shape is recognisable from known region (use minimap screenshot for comparison).
3. **Regression:** Flat terrain at login (before patches arrive) remains green — not black or broken.
4. **Remount:** HMR trigger mid-session — terrain should rebuild immediately from worldStore.

---

## Out of scope (Phase 1)

- Terrain texture (grass/sand/rock images) — vertex coloring only
- Water surface animation (waves, reflections)
- Terrain normals for lighting (MeshBasicMaterial, unlit)
- LARGE_PATCH_SIZE (32×32) support — log a warning if seen, skip
- Wind/cloud layer decoding
- Cross-region terrain seams
