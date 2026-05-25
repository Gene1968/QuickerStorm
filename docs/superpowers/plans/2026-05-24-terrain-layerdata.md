# Terrain LayerData Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decode LLUDP LayerData (Medium #6) terrain patches from the sim, relay them to the browser, and render height-displaced terrain with topo vertex coloring + a semi-transparent water plane at y=20.

**Architecture:** Bun server decodes the DCT-compressed LayerData binary (IDCT ported from phoenix-firestorm) and emits `S.TERRAIN_PATCH` WS messages. The browser updates a 257×257 vertex `PlaneGeometry` per patch, setting Y position and vertex color per height band. WorldStore caches the full height grid so HMR/remount rebuilds terrain without a new login.

**Tech Stack:** Bun/TypeScript server, Vue 3 + Three.js r168+, Pinia, Vitest (no existing tests — creates first test file)

---

## File Map

| Action | File |
|--------|------|
| Modify | `shared/protocol.js` — add `S.TERRAIN_PATCH` |
| Modify | `server/handlers/lludp.ts` — add `MEDIUM_LAYER_DATA = 6`, dispatch + emit |
| Modify | `server/lib/lludp-codec.ts` — add `decodeLayerData` export |
| **Create** | `server/lib/terrain-codec.ts` — BitReader, patch header, IDCT, full decode |
| Modify | `src/stores/worldStore.js` — add `terrainHeights`, `setTerrainPatch()` |
| Modify | `src/composables/useWorldEngine.js` — new geometry, `onTerrainPatch`, water plane |
| **Create** | `tests/server/terrain-codec.test.ts` — unit tests for decode |

---

## Task 1: Protocol constant + handler stub

**Files:**
- Modify: `shared/protocol.js`
- Modify: `server/handlers/lludp.ts`

- [ ] **Step 1: Add `S.TERRAIN_PATCH` to protocol**

In `shared/protocol.js`, add to the `S` object (after `KILL_OBJECT`):

```javascript
TERRAIN_PATCH:   'terrain_patch',  // { layerType:'LAND'|'WATER', patchSize:16, patches:[{x,y,heights:number[]}] }
```

- [ ] **Step 2: Add MEDIUM_LAYER_DATA constant to lludp.ts**

In `server/handlers/lludp.ts`, add after the `FIXED_PACKET_ACK` line:

```typescript
const MEDIUM_LAYER_DATA = 6  // LayerData (terrain patches) — Medium frequency, msg ID 6
```

- [ ] **Step 3: Add stub dispatch in handleUdpMessage**

In `server/handlers/lludp.ts`, add after the `HIGH_KILL_OBJECT` block (before the Low-frequency handlers):

```typescript
if (type === `med:${MEDIUM_LAYER_DATA}`) {
  // TODO: replace with real decode in Task 4
  slog.info(session.ws, `[terrain] LayerData received — dataOffset=${dataOffset} buf.length=${buf.length}`)
  return
}
```

- [ ] **Step 4: Commit**

```bash
git add shared/protocol.js server/handlers/lludp.ts
git commit -m "feat(terrain): add TERRAIN_PATCH protocol constant + LayerData stub handler"
```

---

## Task 2: terrain-codec.ts — BitReader + header decode

**Files:**
- Create: `server/lib/terrain-codec.ts`
- Create: `tests/server/terrain-codec.test.ts`

- [ ] **Step 1: Create terrain-codec.ts with BitReader and header types**

Create `server/lib/terrain-codec.ts`:

```typescript
// server/lib/terrain-codec.ts — LLUDP LayerData terrain patch decoder
// Reference: phoenix-firestorm/indra/llmessage/patch_idct.cpp + patch_dct.h
// Reference: libopenmetaverse (C#) terrain decode

export const PATCH_SIZE = 16
const END_OF_PATCHES = 97  // quant_wbits sentinel value marking no more patches

export interface TerrainPatch {
  x: number          // 0–15: patch column in 16×16 patch grid
  y: number          // 0–15: patch row
  heights: Float32Array  // PATCH_SIZE×PATCH_SIZE = 256 height values, metres
}

export interface LayerDataResult {
  type: 'LAND' | 'WATER'
  patchSize: number
  patches: TerrainPatch[]
}

interface GroupHeader {
  stride: number
  patchSize: number
  layerType: number
}

interface PatchHeader {
  dcOffset: number
  range: number
  quantWbits: number
  patchX: number
  patchY: number
}

// ── BitReader — reads MSB-first variable-length fields from a Buffer ──────────
// WHY: LLUDP terrain patch data uses bit-packed fields (not byte-aligned).
// Reads proceed MSB-first within each byte, matching LLBitPack in firestorm.
export class BitReader {
  private buf: Buffer
  private bitPos: number = 0

  constructor(buf: Buffer) { this.buf = buf }

  readBits(n: number): number {
    let result = 0
    for (let i = 0; i < n; i++) {
      const byteIdx = (this.bitPos / 8) | 0
      const bitIdx  = 7 - (this.bitPos % 8)   // MSB first
      if (byteIdx >= this.buf.length) break
      result = (result << 1) | ((this.buf[byteIdx] >> bitIdx) & 1)
      this.bitPos++
    }
    return result >>> 0  // force unsigned
  }

  // Read 32 bits and interpret as IEEE 754 float (big-endian bit order)
  readFloat32(): number {
    const bits = this.readBits(32)
    const tmp = Buffer.allocUnsafe(4)
    tmp.writeUInt32BE(bits, 0)
    return tmp.readFloatBE(0)
  }

  readU16(): number { return this.readBits(16) }
  readU8():  number { return this.readBits(8)  }

  get bytesRead(): number { return Math.ceil(this.bitPos / 8) }
}

// ── Group header — 4 plain bytes at start of LayerData.Data ──────────────────
function readGroupHeader(data: Buffer, offset: number): { hdr: GroupHeader; next: number } {
  // WHY: Group header uses plain byte reads (not bit-packed), LE per LLUDP convention.
  // stride: grids per region edge (256 → stored as 264 due to +8 buffer; ignore, just use patchSize).
  const stride    = data.readUInt16LE(offset)
  const patchSize = data.readUInt8(offset + 2)
  const layerType = data.readUInt8(offset + 3)
  return { hdr: { stride, patchSize, layerType }, next: offset + 4 }
}

// ── Patch header — bit-packed, read via BitReader ────────────────────────────
function readPatchHeader(reader: BitReader): PatchHeader | null {
  const dcOffset   = reader.readFloat32()
  const range      = reader.readU16()
  const quantWbits = reader.readU8()
  if (quantWbits === END_OF_PATCHES) return null  // sentinel: no more patches
  const patchIds   = reader.readBits(10)           // 5 bits x, 5 bits y
  // WHY: patchIds upper 5 bits = x (column), lower 5 bits = y (row).
  // See libopenmetaverse DecodePatchHeader and firestorm LLPatchHeader::decompress.
  const patchX = (patchIds >> 5) & 0x1f
  const patchY = patchIds & 0x1f
  return { dcOffset, range, quantWbits, patchX, patchY }
}
```

- [ ] **Step 2: Write failing test for BitReader and header parse**

Create `tests/server/terrain-codec.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { BitReader, PATCH_SIZE } from '../../server/lib/terrain-codec'

describe('BitReader', () => {
  it('reads 8 bits correctly', () => {
    const buf = Buffer.from([0b10110100])
    const r = new BitReader(buf)
    expect(r.readBits(8)).toBe(0b10110100)
  })

  it('reads bits across byte boundary', () => {
    const buf = Buffer.from([0b11110000, 0b00001111])
    const r = new BitReader(buf)
    expect(r.readBits(4)).toBe(0b1111)
    expect(r.readBits(4)).toBe(0b0000)
    expect(r.readBits(4)).toBe(0b0000)
    expect(r.readBits(4)).toBe(0b1111)
  })

  it('reads IEEE 754 float32', () => {
    // 25.5 as IEEE 754 BE: 0x41CC0000
    const buf = Buffer.from([0x41, 0xCC, 0x00, 0x00])
    const r = new BitReader(buf)
    expect(r.readFloat32()).toBeCloseTo(25.5, 4)
  })

  it('tracks bytesRead', () => {
    const buf = Buffer.alloc(4)
    const r = new BitReader(buf)
    r.readBits(9)
    expect(r.bytesRead).toBe(2)
  })
})
```

- [ ] **Step 3: Run test (expect pass — no decode yet)**

```bash
npx vitest run tests/server/terrain-codec.test.ts
```

Expected: all 4 tests **PASS** (BitReader is self-contained)

- [ ] **Step 4: Commit**

```bash
git add server/lib/terrain-codec.ts tests/server/terrain-codec.test.ts
git commit -m "feat(terrain): BitReader + patch/group header decode, first tests"
```

---

## Task 3: terrain-codec.ts — IDCT + decodeLayerData

**Files:**
- Modify: `server/lib/terrain-codec.ts`
- Modify: `tests/server/terrain-codec.test.ts`

- [ ] **Step 1: Write failing test for zero-range patch (no IDCT needed)**

Add to `tests/server/terrain-codec.test.ts`:

```typescript
import { decodeLayerData } from '../../server/lib/terrain-codec'

describe('decodeLayerData — zero-range patch', () => {
  it('returns flat terrain at dc_offset when range=0', () => {
    // Build a minimal LayerData packet for a flat patch at height=25.5
    // Body layout (at offset 8, after LLUDP header 6b + medium prefix 2b):
    //   offset 0: Type = 0x4C ('L' = LAND)
    //   offset 1-2: DataLength = 19 (4 group header + 15 patch header bits rounded to bytes)
    //   offset 3: Data starts
    //     [0-3]:  Group header: stride=264 (LE U16), patchSize=16, layerType=0x4C
    //     [4+]:   Patch header (bit-packed): dcOffset(F32) + range(U16=0) + qwbits(U8=0) + patchids(10b)
    //             + END_OF_PATCHES sentinel
    //
    // Build the bit-packed patch data manually:
    const bitBuf: number[] = []
    function writeBits(val: number, n: number) {
      for (let i = n - 1; i >= 0; i--) {
        const bitPos = bitBuf.length
        const byteIdx = (bitPos / 8) | 0
        const bitIdx  = 7 - (bitPos % 8)
        if (bitIdx === 7) bitBuf.push(0)
        if ((val >> i) & 1) bitBuf[byteIdx] |= (1 << bitIdx)
      }
    }
    function writeFloat32(v: number) {
      const tmp = Buffer.allocUnsafe(4)
      tmp.writeFloatBE(v, 0)
      writeBits(tmp.readUInt32BE(0), 32)
    }

    // Patch 1: dc_offset=25.5, range=0, quant_wbits=0, patchids=0 (x=0,y=0)
    writeFloat32(25.5)
    writeBits(0, 16)    // range
    writeBits(0, 8)     // quant_wbits
    writeBits(0, 10)    // patchids: x=0, y=0

    // Sentinel: quant_wbits = END_OF_PATCHES (97)
    writeFloat32(0.0)   // dc_offset (ignored)
    writeBits(0, 16)    // range
    writeBits(97, 8)    // END_OF_PATCHES

    // Pad to byte boundary
    while (bitBuf.length % 8 !== 0) writeBits(0, 1)

    const patchBytes = Buffer.from(bitBuf)
    const groupHdr   = Buffer.from([0x08, 0x01, 16, 0x4C])  // stride=264 LE, patchSize=16, type='L'
    const data       = Buffer.concat([groupHdr, patchBytes])

    const body = Buffer.allocUnsafe(3 + data.length)
    body[0] = 0x4C  // Type 'L'
    body.writeUInt16LE(data.length, 1)
    data.copy(body, 3)

    // Prepend fake LLUDP header (6 bytes) + medium prefix (2 bytes)
    const pkt = Buffer.concat([Buffer.alloc(8), body])

    const result = decodeLayerData(pkt, 8)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('LAND')
    expect(result!.patches).toHaveLength(1)
    const h = result!.patches[0].heights
    // All 256 heights should equal dc_offset=25.5 (zero-range shortcut)
    for (let i = 0; i < 256; i++) {
      expect(h[i]).toBeCloseTo(25.5, 2)
    }
  })
})
```

- [ ] **Step 2: Run — expect FAIL (decodeLayerData not yet exported)**

```bash
npx vitest run tests/server/terrain-codec.test.ts
```

Expected: **FAIL** — `decodeLayerData is not a function`

- [ ] **Step 3: Implement IDCT tables + decodePatch + decodeLayerData in terrain-codec.ts**

Append to `server/lib/terrain-codec.ts`:

```typescript
// ── Precomputed IDCT tables ──────────────────────────────────────────────────
// WHY: Zigzag (copy) matrix maps bitstream read order → 2D coefficient position.
// Standard diagonal zigzag for 16×16: diagonals 0–30, alternating direction.
function buildCopyMatrix(): Uint16Array {
  const mat = new Uint16Array(PATCH_SIZE * PATCH_SIZE)
  let pos = 0
  for (let sum = 0; sum < 2 * PATCH_SIZE - 1; sum++) {
    if (sum % 2 === 0) {
      let row = Math.min(sum, PATCH_SIZE - 1), col = sum - row
      while (row >= 0 && col < PATCH_SIZE) { mat[pos++] = row * PATCH_SIZE + col; row--; col++ }
    } else {
      let col = Math.min(sum, PATCH_SIZE - 1), row = sum - col
      while (col >= 0 && row < PATCH_SIZE) { mat[pos++] = row * PATCH_SIZE + col; row++; col-- }
    }
  }
  return mat
}

// Dequantize table: DEQUANT[row*16+col] = 1 + 2*(row+col) — matches firestorm patch_dct.cpp
function buildDequantTable(): Float32Array {
  const t = new Float32Array(PATCH_SIZE * PATCH_SIZE)
  for (let row = 0; row < PATCH_SIZE; row++)
    for (let col = 0; col < PATCH_SIZE; col++)
      t[row * PATCH_SIZE + col] = 1.0 + 2.0 * (row + col)
  return t
}

// Cosine table: COS_TABLE[k][n] = cos(PI * k * (2n+1) / 32)
// Used in 1D IDCT: x[n] = OO_SQRT2*F[0] + sum_{k=1}^{15} F[k]*COS_TABLE[k][n], scaled by OO_SQRT2
function buildCosTable(): Float32Array[] {
  const tables: Float32Array[] = []
  for (let k = 0; k < PATCH_SIZE; k++) {
    tables[k] = new Float32Array(PATCH_SIZE)
    for (let n = 0; n < PATCH_SIZE; n++)
      tables[k][n] = Math.cos(Math.PI * k * (2 * n + 1) / (2 * PATCH_SIZE))
  }
  return tables
}

const COPY_MATRIX  = buildCopyMatrix()
const DEQUANT      = buildDequantTable()
const COS_TABLE    = buildCosTable()
const OO_SQRT2     = 1 / Math.SQRT2  // 1/√2 ≈ 0.7071

// ── 1D IDCT — Type-III, matches firestorm idct_line() ────────────────────────
function idct1D(inp: Float32Array, out: Float32Array): void {
  for (let n = 0; n < PATCH_SIZE; n++) {
    let sum = inp[0] * OO_SQRT2
    for (let k = 1; k < PATCH_SIZE; k++) sum += inp[k] * COS_TABLE[k][n]
    out[n] = sum * OO_SQRT2
  }
}

// ── 2D IDCT — separable: IDCT each row, then each column ─────────────────────
function idct2D(block: Float32Array): void {
  const tmp = new Float32Array(PATCH_SIZE * PATCH_SIZE)
  const lineIn  = new Float32Array(PATCH_SIZE)
  const lineOut = new Float32Array(PATCH_SIZE)
  // Rows
  for (let row = 0; row < PATCH_SIZE; row++) {
    for (let k = 0; k < PATCH_SIZE; k++) lineIn[k] = block[row * PATCH_SIZE + k]
    idct1D(lineIn, lineOut)
    for (let n = 0; n < PATCH_SIZE; n++) tmp[row * PATCH_SIZE + n] = lineOut[n]
  }
  // Columns
  for (let col = 0; col < PATCH_SIZE; col++) {
    for (let k = 0; k < PATCH_SIZE; k++) lineIn[k] = tmp[k * PATCH_SIZE + col]
    idct1D(lineIn, lineOut)
    for (let n = 0; n < PATCH_SIZE; n++) block[n * PATCH_SIZE + col] = lineOut[n]
  }
}

// ── Read quantized DCT coefficients from bitstream ───────────────────────────
// WHY: Coefficients are variable-width integers. Each coefficient uses `wbits` bits.
// Sentinel: value == (2^wbits - 1) → end of significant data, remaining coeffs = 0.
// After sentinel, remaining coefficient positions stay 0.
// Sign: 1 bit follows each non-sentinel value (0=positive, 1=negative).
function readCoefficients(reader: BitReader, quantWbits: number): Int32Array {
  const coeffs = new Int32Array(PATCH_SIZE * PATCH_SIZE)  // default 0
  const wbits  = (quantWbits & 0x0f) + 2  // lower 4 bits + 2 = effective word bits
  const endMark = (1 << wbits) - 1        // all bits set = end-of-data marker

  for (let i = 0; i < PATCH_SIZE * PATCH_SIZE; i++) {
    const val = reader.readBits(wbits)
    if (val === endMark) break  // end of non-zero coefficients
    const sign = reader.readBits(1)
    coeffs[i] = sign ? -val : val
  }
  return coeffs
}

// ── Decode one 16×16 patch from bitstream ────────────────────────────────────
function decodePatch(reader: BitReader, hdr: PatchHeader): Float32Array {
  const heights = new Float32Array(PATCH_SIZE * PATCH_SIZE)

  // Zero-range shortcut: flat area, skip IDCT
  if (hdr.range === 0) {
    heights.fill(hdr.dcOffset)
    return heights
  }

  const rawCoeffs = readCoefficients(reader, hdr.quantWbits)

  // Dequantize into block array at zigzag-mapped positions
  const block = new Float32Array(PATCH_SIZE * PATCH_SIZE)
  for (let i = 0; i < rawCoeffs.length; i++) {
    const dest = COPY_MATRIX[i]
    block[dest] = rawCoeffs[i] * DEQUANT[dest]
  }

  // 2D IDCT — recovers spatial heights from frequency domain
  idct2D(block)

  // Denormalize to metres
  // WHY: firestorm decompress_patch formula (patch_idct.cpp ~line 600):
  //   prequant = (quant_wbits >> 4) + 2
  //   quantize = 1 << prequant
  //   mult = (1.0 / quantize) * range
  //   addval = mult * (1 << (prequant - 1)) + dcOffset
  //   height = block[i] * mult + addval
  const prequant = (hdr.quantWbits >> 4) + 2
  const quantize = 1 << prequant
  const mult     = hdr.range / quantize
  const addval   = mult * (1 << (prequant - 1)) + hdr.dcOffset
  for (let i = 0; i < block.length; i++) {
    heights[i] = block[i] * mult + addval
  }
  return heights
}

// ── Public entry point ────────────────────────────────────────────────────────
// Takes the full decoded LLUDP packet buffer + dataOffset (where body starts).
// LayerData body: U8 type | U16LE dataLen | U8[dataLen] data
// data: U16LE stride | U8 patchSize | U8 layerType | bit-packed patches...
export function decodeLayerData(buf: Buffer, dataOffset: number): LayerDataResult | null {
  try {
    if (dataOffset + 3 > buf.length) return null

    const layerTypeByte = buf[dataOffset]
    const dataLen       = buf.readUInt16LE(dataOffset + 1)
    const dataStart     = dataOffset + 3

    if (dataStart + dataLen > buf.length) return null

    // Only handle LAND and WATER layers
    const type = layerTypeByte === 0x4C ? 'LAND'
               : layerTypeByte === 0x57 ? 'WATER'
               : null
    if (!type) return null

    const data = buf.slice(dataStart, dataStart + dataLen)

    // Group header (4 plain bytes)
    if (data.length < 4) return null
    const { hdr: groupHdr, next: patchDataOffset } = readGroupHeader(data, 0)

    if (groupHdr.patchSize !== PATCH_SIZE) {
      // Large patches (32×32) not implemented in Phase 1
      console.warn(`[terrain] Unsupported patch_size=${groupHdr.patchSize} — skipping`)
      return null
    }

    // Decode patches via bit reader
    const reader  = new BitReader(data.slice(patchDataOffset))
    const patches: TerrainPatch[] = []

    for (let attempt = 0; attempt < 512; attempt++) {
      const ph = readPatchHeader(reader)
      if (!ph) break  // END_OF_PATCHES sentinel
      if (ph.patchX > 15 || ph.patchY > 15) continue  // out of range, skip
      const heights = decodePatch(reader, ph)
      patches.push({ x: ph.patchX, y: ph.patchY, heights })
    }

    return { type: type as 'LAND' | 'WATER', patchSize: groupHdr.patchSize, patches }
  } catch {
    return null  // malformed packet — never crash the server
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run tests/server/terrain-codec.test.ts
```

Expected: all tests **PASS**

- [ ] **Step 5: Commit**

```bash
git add server/lib/terrain-codec.ts tests/server/terrain-codec.test.ts
git commit -m "feat(terrain): IDCT decoder + decodeLayerData + zero-range patch test"
```

---

## Task 4: Wire up lludp.ts handler

**Files:**
- Modify: `server/handlers/lludp.ts`
- Modify: `server/lib/lludp-codec.ts`

- [ ] **Step 1: Export decodeLayerData from lludp-codec.ts**

In `server/lib/lludp-codec.ts`, add at the top with other imports (or at the end of the file):

```typescript
export { decodeLayerData } from './terrain-codec'
```

- [ ] **Step 2: Import decodeLayerData in lludp.ts**

In `server/handlers/lludp.ts`, add `decodeLayerData` to the existing import from `'../lib/lludp-codec'`:

```typescript
import {
  parseHeader, parseMsgType,
  decodeChatFromSimulator, decodeObjectUpdate, decodeImprovedTerseObjectUpdate,
  decodeObjectUpdateCached, encodeRequestMultipleObjects,
  decodeRegionHandshake, decodeZeroCoded,
  encodeAgentUpdate, encodeChatFromViewer, encodeCompletePingCheck, encodeRegionHandshakeReply,
  encodeTeleportLocationRequest, encodeCompleteAgentMovement,
  decodeTeleportLocal, decodeTeleportFinish, encodeAgentSetAppearance, decodeKillObject,
  decodeLayerData,  // ← add this
} from '../lib/lludp-codec'
```

- [ ] **Step 3: Replace stub with real handler**

In `server/handlers/lludp.ts`, replace the stub added in Task 1:

```typescript
// was:
if (type === `med:${MEDIUM_LAYER_DATA}`) {
  slog.info(session.ws, `[terrain] LayerData received — dataOffset=${dataOffset} buf.length=${buf.length}`)
  return
}

// replace with:
if (type === `med:${MEDIUM_LAYER_DATA}`) {
  // WHY: LayerData is NOT zero-coded — the flag may still be set by the sim but
  // zero-coding was already applied to the full packet above. No extra decode needed.
  try {
    const result = decodeLayerData(buf, dataOffset)
    if (!result) return
    session.ws.send(JSON.stringify({
      t: S.TERRAIN_PATCH,
      d: {
        layerType: result.type,
        patchSize: result.patchSize,
        patches: result.patches.map(p => ({
          x: p.x, y: p.y,
          heights: Array.from(p.heights),  // Float32Array → plain array for JSON
        })),
      },
    }))
    slog.info(session.ws, `[terrain] LAND patches=${result.patches.length}`)
  } catch (e) {
    slog.warn(session.ws, `[terrain] decode error: ${(e as Error).message}`)
  }
  return
}
```

- [ ] **Step 4: Restart dev server and log-check**

In terminal 2 (Bun server), run `npm run dev:server`. Login to OSGrid. In the server console, look for:

```
[terrain] LAND patches=N
```

If `N > 0` — decode is working. If nothing appears, verify `parseMsgType` returns `med:6` by adding a temporary `slog.info` after parseMsgType call for any `med:` type.

- [ ] **Step 5: Commit**

```bash
git add server/lib/lludp-codec.ts server/handlers/lludp.ts
git commit -m "feat(terrain): wire LayerData handler → TERRAIN_PATCH WS relay"
```

---

## Task 5: worldStore — terrain height cache

**Files:**
- Modify: `src/stores/worldStore.js`

- [ ] **Step 1: Add terrainHeights ref and setTerrainPatch action**

In `src/stores/worldStore.js`, add inside the `defineStore` callback (after the `avatarPos` block):

```javascript
// WHY: Terrain heights survive remount (HMR, navigation away/back).
// 257×257 = 66,049 vertices: 256×256 metre region, 1 vertex per metre, +1 for overlap.
// useWorldEngine rebuilds geometry from this on mount without needing a new LoginLayerData burst.
const terrainHeights = ref(new Float32Array(66049))

// WHY: Per-patch update instead of full-grid replace — patches arrive incrementally (one per
// TERRAIN_PATCH message). Update only the 17×17 vertices affected by this patch.
function setTerrainPatch(px, py, heights, patchSize = 16) {
  const stride = 257  // vertices per row (255 segments + 1)
  for (let j = 0; j < patchSize; j++) {
    for (let i = 0; i < patchSize; i++) {
      const slX = px * patchSize + i  // SL X coord (column)
      const slY = py * patchSize + j  // SL Y coord (row)
      if (slX > 256 || slY > 256) continue
      terrainHeights.value[slY * stride + slX] = heights[j * patchSize + i]
    }
  }
}

function clearTerrain() { terrainHeights.value.fill(0) }
```

- [ ] **Step 2: Expose in return object**

Add `terrainHeights`, `setTerrainPatch`, `clearTerrain` to the `return` statement:

```javascript
return {
  objects, avatars, prims,
  upsertObject, updateObjectPos, removeObject, clearAll,
  avatarPos, setAvatarPos,
  terrainHeights, setTerrainPatch, clearTerrain,  // ← add
}
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/worldStore.js
git commit -m "feat(terrain): worldStore terrain height cache + setTerrainPatch"
```

---

## Task 6: useWorldEngine — terrain geometry rebuild

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Store terrain mesh refs at top of useWorldEngine**

Inside `useWorldEngine(canvasRef)`, add after `const meshMap = new Map()`:

```javascript
let terrainMesh = null  // THREE.Mesh with 257×257 vertex PlaneGeometry
let waterMesh   = null  // flat blue plane at y=20
```

- [ ] **Step 2: Replace flat terrain in initScene()**

In `initScene()`, find and replace the existing terrain block:

```javascript
// REMOVE this block:
const terrain = new THREE.Mesh(
  new THREE.PlaneGeometry(256, 256, 64, 64),
  new THREE.MeshBasicMaterial({ color: 0x4a7c59 }),
)
terrain.rotation.x = -Math.PI / 2
terrain.position.set(128, 0, -128)
scene.add(terrain)

// REPLACE WITH:
// WHY: 255 segments × 255 segments = 256×256 cells = 257×257 vertices (1 vertex per SL metre).
// rotateX(-π/2) lays the plane flat. translate(128,0,-128) centres the region at Three.js
// origin matching slToThree(128,128,0). Vertex Y positions updated per TERRAIN_PATCH message.
const terrainGeo = new THREE.PlaneGeometry(256, 256, 255, 255)
terrainGeo.rotateX(-Math.PI / 2)
terrainGeo.translate(128, 0, -128)

// Add vertex color attribute — updated per patch in onTerrainPatch
const vtxColors = new Float32Array(terrainGeo.attributes.position.count * 3)
vtxColors.fill(0.29)  // fill with mid-green default (r=g=0.29 → ~0x4a4a4a-ish)
// Set initial green: r=0.29, g=0.49, b=0.35
for (let i = 0; i < vtxColors.length; i += 3) {
  vtxColors[i]     = 0.29  // r
  vtxColors[i + 1] = 0.49  // g
  vtxColors[i + 2] = 0.35  // b
}
terrainGeo.setAttribute('color', new THREE.BufferAttribute(vtxColors, 3))

terrainMesh = new THREE.Mesh(
  terrainGeo,
  new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
)
scene.add(terrainMesh)

// Water plane at SL z=20 (Three.js y=20)
waterMesh = new THREE.Mesh(
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

- [ ] **Step 3: Add rebuildTerrainFromStore() and call it in initScene**

Add this function inside `useWorldEngine`, just before `initScene`:

```javascript
// WHY: HMR and navigation away/back trigger onUnmounted+onMounted. worldStore.terrainHeights
// persists across remounts (Pinia ref). Rebuild geometry immediately on mount so terrain
// appears without waiting for another LayerData burst from the sim.
function rebuildTerrainFromStore() {
  if (!terrainMesh) return
  const pos    = terrainMesh.geometry.attributes.position
  const col    = terrainMesh.geometry.attributes.color
  const stride = 257
  let anyNonZero = false
  for (let slY = 0; slY <= 255; slY++) {
    for (let slX = 0; slX <= 255; slX++) {
      const vi = slY * stride + slX
      const h  = worldStore.terrainHeights[vi]
      if (h !== 0) anyNonZero = true
      pos.setY(vi, h)
      applyHeightColor(col, vi, h)
    }
  }
  if (anyNonZero) {
    pos.needsUpdate = true
    col.needsUpdate = true
    terrainMesh.geometry.computeVertexNormals()
  }
}
```

At the end of `initScene()`, add:

```javascript
rebuildTerrainFromStore()
```

- [ ] **Step 4: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(terrain): 257×257 PlaneGeometry + vertex colors + water plane + rebuild-on-mount"
```

---

## Task 7: useWorldEngine — onTerrainPatch handler

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Add height-to-color helper and applyHeightColor**

Inside `useWorldEngine`, add these two functions (before `onTerrainPatch`):

```javascript
// WHY: Topo coloring matches spec: teal near water, green mid, stone high.
// Returns [r, g, b] in 0–1 range. Smooth lerp between bands avoids hard edges.
function heightColor(h) {
  // deep/underwater
  if (h <= 0)   return [0.08, 0.30, 0.60]
  // shallow → low land
  if (h <= 10)  return lerpRgb([0.16, 0.50, 0.83], [0.25, 0.55, 0.45], h / 10)
  // low land → grass
  if (h <= 20)  return lerpRgb([0.25, 0.55, 0.45], [0.29, 0.49, 0.35], (h - 10) / 10)
  // grass → earthy mid
  if (h <= 40)  return lerpRgb([0.29, 0.49, 0.35], [0.45, 0.42, 0.35], (h - 20) / 20)
  // earthy → stone grey
  return lerpRgb([0.45, 0.42, 0.35], [0.60, 0.58, 0.58], Math.min((h - 40) / 60, 1))
}

function lerpRgb(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t) }

function applyHeightColor(colAttr, vertexIndex, h) {
  const [r, g, b] = heightColor(h)
  colAttr.setXYZ(vertexIndex, r, g, b)
}
```

- [ ] **Step 2: Add onTerrainPatch handler**

Add inside `useWorldEngine`, near the other `on*` handlers:

```javascript
function onTerrainPatch(payload) {
  if (!terrainMesh) return
  const { layerType, patchSize = 16, patches } = payload
  if (layerType === 'WATER') return  // water plane height fixed at 20 for Phase 1

  const pos    = terrainMesh.geometry.attributes.position
  const col    = terrainMesh.geometry.attributes.color
  const stride = 257  // vertices per row

  for (const { x: px, y: py, heights } of patches) {
    // Store in worldStore for remount persistence
    worldStore.setTerrainPatch(px, py, heights, patchSize)

    // WHY: Update (patchSize+1)×(patchSize+1) vertices to fill seam between patches.
    // Clamped height index prevents reading out-of-bounds on the patch edge.
    for (let j = 0; j <= patchSize; j++) {
      for (let i = 0; i <= patchSize; i++) {
        const slX = px * patchSize + i
        const slY = py * patchSize + j
        if (slX > 255 || slY > 255) continue
        const vi = slY * stride + slX
        const hIdx = Math.min(j, patchSize - 1) * patchSize + Math.min(i, patchSize - 1)
        const h = heights[hIdx]
        pos.setY(vi, h)
        applyHeightColor(col, vi, h)
      }
    }
  }

  pos.needsUpdate = true
  col.needsUpdate = true
  terrainMesh.geometry.computeVertexNormals()
}
```

- [ ] **Step 3: Register/deregister in lifecycle hooks**

In `onMounted`, add after the existing `on()` calls:

```javascript
on(S.TERRAIN_PATCH, onTerrainPatch)
```

In `onUnmounted`, add after the existing `off()` calls:

```javascript
off(S.TERRAIN_PATCH, onTerrainPatch)
```

- [ ] **Step 4: Add S import if not already present**

Confirm `S` is imported from `@shared/protocol.js` — it already is (used for `S.OBJECT_UPDATE` etc.). No change needed.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(terrain): onTerrainPatch handler — vertex height + topo color update"
```

---

## Task 8: Integration smoke test + cleanup

**Files:**
- Modify: `src/stores/worldStore.js` (clearTerrain on logout)
- Modify: `tests/server/terrain-codec.test.ts` (edge case tests)

- [ ] **Step 1: Add edge case tests**

Add to `tests/server/terrain-codec.test.ts`:

```typescript
describe('decodeLayerData — error cases', () => {
  it('returns null for buffer too short', () => {
    expect(decodeLayerData(Buffer.alloc(8), 8)).toBeNull()
  })

  it('returns null for non-LAND/WATER type', () => {
    const buf = Buffer.alloc(12)
    buf[8] = 0x37  // wind layer type
    buf.writeUInt16LE(0, 9)
    expect(decodeLayerData(buf, 8)).toBeNull()
  })

  it('returns null for large patch_size (32)', () => {
    // Group header at data[0]: stride=LE U16, patchSize=32, type=0x4C
    const groupHdr = Buffer.from([0x08, 0x01, 32, 0x4C])
    const body = Buffer.allocUnsafe(3 + groupHdr.length)
    body[0] = 0x4C
    body.writeUInt16LE(groupHdr.length, 1)
    groupHdr.copy(body, 3)
    const pkt = Buffer.concat([Buffer.alloc(8), body])
    expect(decodeLayerData(pkt, 8)).toBeNull()
  })
})
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run tests/server/terrain-codec.test.ts
```

Expected: all tests **PASS**

- [ ] **Step 3: Clear terrain on logout**

In `src/composables/useWorldEngine.js`, find `onKillObject` or the logout/disconnect handler. In `onUnmounted`, add:

```javascript
worldStore.clearTerrain()
```

WHY: stale terrain from session A would show briefly at session B's position before new patches arrive if not cleared.

- [ ] **Step 4: Visual smoke test — login to OSGrid**

Start both servers:
```
Terminal 1: npm run dev
Terminal 2: npm run dev:server
```

Login to OSGrid sandbox or NeverWorld. Watch for:
1. Server console: `[terrain] LAND patches=N` (expect multiple messages, ~16 patches per burst)
2. Browser: terrain shape visible within 5–10 seconds of login
3. Low-altitude areas (< 20m): teal/blue tones
4. Elevated land: green to stone grey
5. Water plane visible at y=20 over flat/low areas

If terrain is flat/all-green but correct shape, IDCT is correct, coloring may need height range tuning.

If terrain is all-black, check `vertexColors: true` is set on the material.

If terrain doesn't appear, add `console.log` in `onTerrainPatch` to verify WS message is arriving.

- [ ] **Step 5: Final commit**

```bash
git add src/stores/worldStore.js src/composables/useWorldEngine.js tests/server/terrain-codec.test.ts
git commit -m "feat(terrain): LayerData IDCT terrain rendering complete

- BitReader + DCT decoder (terrain-codec.ts)
- lludp.ts handler: med:6 → S.TERRAIN_PATCH relay
- worldStore: 257×257 Float32Array height cache
- PlaneGeometry 255×255 segments, vertex colors
- Height-topo coloring: teal/green/stone bands
- Water plane at y=20
- Vitest unit tests for decode edge cases
- clearTerrain on unmount"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `server/lib/terrain-codec.ts` — BitReader + IDCT | Tasks 2–3 |
| `decodeLayerData(buf, dataOffset)` | Task 3 |
| `lludp-codec.ts` expose `decodeLayerData` | Task 4 |
| `lludp.ts` detect `med:6`, emit `S.TERRAIN_PATCH` | Task 4 |
| `shared/protocol.js` `S.TERRAIN_PATCH` | Task 1 |
| `PlaneGeometry(256, 256, 255, 255)` | Task 6 |
| Vertex color BufferAttribute | Task 6 |
| `onTerrainPatch` — vertex Y + color update | Task 7 |
| Water plane at y=20 | Task 6 |
| `worldStore.terrainHeights` Float32Array | Task 5 |
| `setTerrainPatch()` per-patch update | Task 5 |
| Remount rebuild from store | Task 6 |
| Zero-range patch shortcut (skip IDCT) | Task 3 |
| Large patch_size warning + skip | Task 3 |
| Error handling: malformed packet → null | Task 3 |
| `clearTerrain` on unmount | Task 8 |
| Vitest unit tests | Tasks 2, 3, 8 |
