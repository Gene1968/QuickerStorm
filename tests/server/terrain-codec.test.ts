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
