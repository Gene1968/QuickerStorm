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
	type: 'LAND'
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

// ── 1D IDCT — Type-III, matches firestorm idct_column() (no outer scale) ─────
// WHY: firestorm applies outer scale (oosob=2/N) only in idct_line, not idct_column.
// We use this base function for both passes; oosob is applied separately in idct2D.
function idct1D(inp: Float32Array, out: Float32Array): void {
	for (let n = 0; n < PATCH_SIZE; n++) {
		let sum = inp[0] * OO_SQRT2
		for (let k = 1; k < PATCH_SIZE; k++) sum += inp[k] * COS_TABLE[k][n]
		out[n] = sum
	}
}

// ── 2D IDCT — separable: IDCT rows (no scale), then columns (× oosob=2/N) ────
// WHY: Matches firestorm idct_patch order — idct_column (no scale) then idct_line
// (× 2/size). Separability means row-then-column ≡ column-then-row; oosob applied
// once to the second pass exactly matches firestorm's combined scale of 2/N.
function idct2D(block: Float32Array): void {
	const tmp = new Float32Array(PATCH_SIZE * PATCH_SIZE)
	const lineIn  = new Float32Array(PATCH_SIZE)
	const lineOut = new Float32Array(PATCH_SIZE)
	const oosob   = 2.0 / PATCH_SIZE  // = 0.125; firestorm: 2.f/size in idct_line
	// Rows (no outer scale — matches firestorm idct_column)
	for (let row = 0; row < PATCH_SIZE; row++) {
		for (let k = 0; k < PATCH_SIZE; k++) lineIn[k] = block[row * PATCH_SIZE + k]
		idct1D(lineIn, lineOut)
		for (let n = 0; n < PATCH_SIZE; n++) tmp[row * PATCH_SIZE + n] = lineOut[n]
	}
	// Columns (with oosob — matches firestorm idct_line)
	for (let col = 0; col < PATCH_SIZE; col++) {
		for (let k = 0; k < PATCH_SIZE; k++) lineIn[k] = tmp[k * PATCH_SIZE + col]
		idct1D(lineIn, lineOut)
		for (let n = 0; n < PATCH_SIZE; n++) block[n * PATCH_SIZE + col] = lineOut[n] * oosob
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
// ws is optional — used for diagnostic logging only.
export function decodeLayerData(buf: Buffer, dataOffset: number, ws?: { send(s: string): void }): LayerDataResult | null {
	const dbg = (msg: string) => {
		if (ws) ws.send(JSON.stringify({ t: 'debug', d: { level: 'warn', msg: `[terrain-codec] ${msg}` } }))
		else    console.warn(`[terrain-codec] ${msg}`)
	}
	try {
		if (dataOffset + 4 > buf.length) { dbg(`buf too short: ${buf.length} < dataOffset+4=${dataOffset+4}`); return null }

		// WHY: LayerData body layout per message_template.msg (High 11), two-type-byte variant:
		//   [dataOffset+0] LayerID.Type       U8       — layer type (0x4C='L'=LAND etc)
		//   [dataOffset+1] DataBlock.LayerType U8      — SAME type repeated (Single block, no count)
		//   [dataOffset+2..3] DataBlock.Data.Length U16LE
		//   [dataOffset+4+]   DataBlock.Data bytes (group header + bit-packed patches)
		// Alt single-type-byte layout (if sim omits LayerID block): type=[0], dataLen=[1..2], data=[3+].
		// body24 in lludp.ts high:11 handler will show which applies: two same bytes → two-type layout.
		const layerTypeByte = buf[dataOffset]
		// Try two-type-byte layout first (per spec); fall back to single-type-byte if it overruns.
		let dataLen   = buf.readUInt16LE(dataOffset + 2)
		let dataStart = dataOffset + 4
		if (dataStart + dataLen > buf.length) {
			const dataLenAlt = buf.readUInt16LE(dataOffset + 1)
			const dataStartAlt = dataOffset + 3
			if (dataStartAlt + dataLenAlt <= buf.length) {
				// WHY: Sim sends single-type-byte layout (no LayerID block). Use alt offsets.
				dbg(`layout=single-type-byte dataLen=${dataLenAlt} (two-type gave overrun=${dataLen}) bufLen=${buf.length}`)
				dataLen   = dataLenAlt
				dataStart = dataStartAlt
			} else {
				dbg(`dataLen overrun: two-type=${dataLen} single-type=${dataLenAlt} bufLen=${buf.length} — body24 in lludp.ts shows layout`)
				return null
			}
		}

		// WHY: LayerData type byte (LayerID.Type) uses ASCII values derived from message_template.msg:
		//   0x4C ('L') = LAND       — classic SL and standard OpenSim
		//   0x4D ('M') = LandExtended — var-region terrain (512×512, 1024×1024), patchSize=32
		//   0x57 ('W') = WIND       — wind field (not terrain, skip)
		//   0x43 ('C') = CLOUD      — cloud field (not terrain, skip)
		//   0x38 ('8') = WATER      — water field (not terrain, skip)
		// NOTE: 0x06 was briefly added as "OSGrid LAND int enum" but that was wrong — Medium 6
		// is CoarseLocationUpdate; those packets were never LayerData. Removed 2026-05-25.
		const isLand = layerTypeByte === 0x4C   // ASCII 'L' — LAND (standard regions)
		            || layerTypeByte === 0x4D    // ASCII 'M' — LandExtended (var-regions, unsupported patchSize=32)
		const type = isLand ? 'LAND' : null
		if (!type) {
			const label = layerTypeByte === 0x57 ? 'WIND(0x57)'
			            : layerTypeByte === 0x43 ? 'CLOUD(0x43)'
			            : layerTypeByte === 0x38 ? 'WATER(0x38)'
			            : `unknown(0x${layerTypeByte.toString(16)})`
			dbg(`skipping non-LAND layer type=${label}`)
			return null
		}

		const data = buf.slice(dataStart, dataStart + dataLen)

		// Group header (4 plain bytes)
		if (data.length < 4) { dbg('data too short for group header'); return null }
		const { hdr: groupHdr, next: patchDataOffset } = readGroupHeader(data, 0)

		if (groupHdr.patchSize !== PATCH_SIZE) {
			// WHY: Var-regions (512×512, 1024×1024) use 32×32 patches; standard regions use 16×16.
			// 32×32 IDCT not yet implemented. Log patchSize so we can verify and add support.
			dbg(`unsupported patchSize=${groupHdr.patchSize} (expected ${PATCH_SIZE}) — var-region?`)
			return null
		}

		// Decode patches via bit reader
		const reader  = new BitReader(data.slice(patchDataOffset))
		const patches: TerrainPatch[] = []

		for (let attempt = 0; attempt < 512; attempt++) {
			const ph = readPatchHeader(reader)
			if (!ph) break  // END_OF_PATCHES sentinel
			if (ph.patchX > 15 || ph.patchY > 15) { dbg(`patchX=${ph.patchX} patchY=${ph.patchY} out of 16×16 grid — skipping`); continue }
			const heights = decodePatch(reader, ph)
			patches.push({ x: ph.patchX, y: ph.patchY, heights })
		}

		return { type: 'LAND', patchSize: groupHdr.patchSize, patches }
	} catch (e) {
		dbg(`exception: ${(e as Error).message}`)
		return null
	}
}
