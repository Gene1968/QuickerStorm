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
    function writeFloat32b(v: number) {
      const tmp = Buffer.allocUnsafe(4)
      tmp.writeFloatBE(v, 0)
      writeBits2(tmp.readUInt32BE(0), 32)
    }

    // Patch: dcOffset=0, range=4, quantWbits=0x03, patchIds=0
    writeFloat32b(0.0)   // dcOffset
    writeBits2(4, 16)    // range = 4
    writeBits2(0x03, 8)  // quantWbits → wbits=(0x03&0x0f)+2=5, prequant=2, quantize=4
    writeBits2(0, 10)    // patchIds: x=0, y=0

    // Coefficients: rawCoeffs[0]=16, sign=positive, then sentinel endMark=31
    writeBits2(16, 5)    // value = 16 (5 bits, not sentinel=31)
    writeBits2(0, 1)     // sign = positive
    writeBits2(31, 5)    // endMark → break

    // Sentinel patch: dcOffset=0, range=0, quantWbits=97
    writeFloat32b(0.0)
    writeBits2(0, 16)
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
      tmp.writeFloatBE(v, 0)
      writeBits(tmp.readUInt32BE(0), 32)
    }

    // Patch 1: dc_offset=25.5, range=0, quant_wbits=0, patchids=0 (x=0,y=0)
    writeFloat32(25.5)
    writeBits(0, 16)    // range
    writeBits(0, 8)     // quant_wbits
    writeBits(0, 10)    // patchids: x=0, y=0

    // Sentinel: quant_wbits = END_OF_PATCHES (97)
    writeFloat32(0.0)
    writeBits(0, 16)    // range
    writeBits(97, 8)    // END_OF_PATCHES

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
