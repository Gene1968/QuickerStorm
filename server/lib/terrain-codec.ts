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
