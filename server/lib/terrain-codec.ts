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
