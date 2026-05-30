import { describe, it, expect } from 'vitest'
import { BitReader, PATCH_SIZE } from '../../server/lib/terrain-codec'
import { decodeLayerData } from '../../server/lib/terrain-codec'

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

	it('reads IEEE 754 float32 (LE)', () => {
		// WHY: LayerData floats are little-endian on the wire (BitConverter on x86).
		const buf = Buffer.alloc(4)
		buf.writeFloatLE(25.5, 0)
		const r = new BitReader(buf)
		expect(r.readFloat32LE()).toBeCloseTo(25.5, 4)
	})

	it('tracks bytesRead', () => {
		const buf = Buffer.alloc(4)
		const r = new BitReader(buf)
		r.readBits(9)
		expect(r.bytesRead).toBe(2)
	})
})

describe('decodeLayerData — IDCT path (non-zero range)', () => {
  it('decodes DC-only coefficient to expected height', () => {
    // Exercises the full IDCT pipeline (range ≠ 0).
    // rawCoeffs[0] = 16, wbits=5 (quantWbits=0x03), range=4, dcOffset=0
    // Expected: block[i] = rawCoeffs[0]/PATCH_SIZE = 16/16 = 1.0 (IDCT of pure DC)
    // mult = range/quantize = 4/(1<<2) = 1.0
    // addval = mult*(1<<(prequant-1)) + dcOffset = 1*2 + 0 = 2.0
    // height = 1.0 * 1.0 + 2.0 = 3.0 for all 256 positions
    // WHY: If idct1D applies OO_SQRT2 twice or oosob is missing, the DC-only block
    // produces 0.25*D or 0.5*D instead of D/N, and heights come out wrong.
    const bitBuf2: number[] = []
    let totalBits2 = 0
    function writeBits2(val: number, n: number) {
      for (let i = n - 1; i >= 0; i--) {
        const byteIdx = (totalBits2 / 8) | 0
        const bitIdx  = 7 - (totalBits2 % 8)
        if (bitIdx === 7) bitBuf2.push(0)
        if ((val >> i) & 1) bitBuf2[byteIdx] |= (1 << bitIdx)
        totalBits2++
      }
    }
    function writeFloat32LE(v: number) {
      const tmp = Buffer.allocUnsafe(4)
      tmp.writeFloatLE(v, 0)            // LE bytes, written MSB-first per byte (byte-aligned here)
      for (let k = 0; k < 4; k++) writeBits2(tmp[k], 8)
    }

    // Header — field order matches readPatchHeader: quantWbits, dcOffset, range, patchIds
    writeBits2(0x03, 8)  // quantWbits → wbits=(0x03&0x0f)+2=5, prequant=2, quantize=4
    writeFloat32LE(0.0)  // dcOffset = 0
    writeBits2(4, 8); writeBits2(0, 8)  // range = 4, little-endian (readU16LE: lo byte first)
    writeBits2(0, 10)    // patchIds: x=0, y=0

    // Coefficients (prefix code): index 0 = POSITIVE_VALUE '110' + mag, then ZERO_EOB '10'.
    writeBits2(0b110, 3) // POSITIVE_VALUE marker
    writeBits2(16, 5)    // magnitude = 16 (wbits=5)
    writeBits2(0b10, 2)  // ZERO_EOB → remaining coefficients are 0

    // Sentinel patch: quantWbits = END_OF_PATCHES (97)
    writeBits2(97, 8)

    while (totalBits2 % 8 !== 0) writeBits2(0, 1)

    const patchBytes = Buffer.from(bitBuf2)
    const groupHdr   = Buffer.from([0x08, 0x01, 16, 0x4C])
    const data       = Buffer.concat([groupHdr, patchBytes])
    const body = Buffer.allocUnsafe(3 + data.length)
    body[0] = 0x4C
    body.writeUInt16LE(data.length, 1)
    data.copy(body, 3)
    const pkt = Buffer.concat([Buffer.alloc(8), body])

    const result = decodeLayerData(pkt, 8)
    expect(result).not.toBeNull()
    expect(result!.patches).toHaveLength(1)
    const h = result!.patches[0].heights
    for (let i = 0; i < 256; i++) {
      expect(h[i]).toBeCloseTo(3.0, 1)  // DC-only patch → uniform height
    }
  })
})

describe('decodeLayerData — var-region (LandExtended 0x4D, 32-bit patch IDs)', () => {
  it('decodes a patch at (20,18) — beyond the legacy 16×16 grid', () => {
    // WHY: OpenSim var-regions (>256m) send LayerType 0x4D ('M', LandExtended) and
    // encode patch IDs as 32 bits ((x<<16)|y), not the legacy 10-bit (x<<5)|y.
    // Header up to patchIds is byte-aligned (8+32+16=56 bits = 7 bytes), so we can
    // build it with plain byte writes; only the coefficient stream is sub-byte.
    // Flat patch (range=0) so the coeff stream is a single ZERO_EOB symbol ('10').
    const hdr = Buffer.alloc(1 + 4 + 2 + 4)
    let o = 0
    hdr[o] = 0x00; o += 1               // quantWbits = 0 (wbits=2, prequant=2)
    hdr.writeFloatLE(30.0, o); o += 4   // dcOffset = 30.0 (LE float, read directly)
    hdr.writeUInt16LE(0, o); o += 2     // range = 0 → flat patch, IDCT skipped
    // patchIds = (x<<16)|y = (20<<16)|18, little-endian 32-bit → X=20, Y=18
    hdr.writeUInt32LE((20 << 16) | 18, o)
    const coeff = Buffer.from([0b10000000])  // ZERO_EOB ('10'), rest padding

    const data     = Buffer.concat([Buffer.from([0x08, 0x01, 16, 0x4D]), hdr, coeff])
    const body     = Buffer.allocUnsafe(3 + data.length)
    body[0]        = 0x4D               // Type 'M' — LandExtended
    body.writeUInt16LE(data.length, 1)
    data.copy(body, 3)
    const pkt = Buffer.concat([Buffer.alloc(8), body])

    const result = decodeLayerData(pkt, 8)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('LAND')
    expect(result!.patches).toHaveLength(1)
    expect(result!.patches[0].x).toBe(20)
    expect(result!.patches[0].y).toBe(18)
    for (let i = 0; i < 256; i++) expect(result!.patches[0].heights[i]).toBeCloseTo(30.0, 2)
  })
})

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

describe('decodeLayerData — zero-range patch', () => {
  it('returns flat terrain at dc_offset when range=0', () => {
    // Build a minimal LayerData packet for a flat patch at height=25.5
    const bitBuf: number[] = []
    let totalBits = 0
    function writeBits(val: number, n: number) {
      for (let i = n - 1; i >= 0; i--) {
        const byteIdx = (totalBits / 8) | 0
        const bitIdx  = 7 - (totalBits % 8)
        if (bitIdx === 7) bitBuf.push(0)
        if ((val >> i) & 1) bitBuf[byteIdx] |= (1 << bitIdx)
        totalBits++
      }
    }
    function writeFloat32(v: number) {
      const tmp = Buffer.allocUnsafe(4)
      tmp.writeFloatLE(v, 0)            // LE bytes, written MSB-first per byte (byte-aligned here)
      for (let k = 0; k < 4; k++) writeBits(tmp[k], 8)
    }

    // Patch 1 — field order matches readPatchHeader: quant_wbits, dc_offset, range, patchids.
    writeBits(0, 8)     // quant_wbits
    writeFloat32(25.5)  // dc_offset
    writeBits(0, 16)    // range = 0 → flat patch
    writeBits(0, 10)    // patchids: x=0, y=0
    writeBits(0b10, 2)  // ZERO_EOB coefficient symbol (range=0 still writes one symbol)

    // Sentinel: quant_wbits = END_OF_PATCHES (97)
    writeBits(97, 8)

    // Pad to byte boundary
    while (totalBits % 8 !== 0) writeBits(0, 1)

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
    for (let i = 0; i < 256; i++) {
      expect(h[i]).toBeCloseTo(25.5, 2)
    }
  })
})
