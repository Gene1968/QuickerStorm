// server/lib/j2c.ts — server-side JPEG2000 (J2C) → PNG transcode.
//
// WHY: SL/OpenSim deliver every texture (and mesh skin, map tiles, profile pics, terrain detail)
// as a raw J2C codestream (Content-Type image/x-j2c). Browsers cannot decode J2C natively. We
// decode on the Bun server with the OpenJPEG WASM build and re-encode as PNG so the browser gets
// a format createImageBitmap() accepts. WASM (not native) → no build step, runs on the prod host.
// Decode location decision: see docs/superpowers/specs/2026-06-03-caps-feature-map.md slice 0.
import openjpegFactory from '@cornerstonejs/codec-openjpeg'
import { encode as encodePng } from 'fast-png'

// WHY: the WASM module is initialised once and reused. The factory is async (compiles wasm); we
// memoise the promise so concurrent callers share a single instance. print/printErr are silenced —
// OpenJPEG emits an "[INFO] …main header…" line per decode that would otherwise flood server logs.
let modPromise: Promise<any> | null = null
function getModule(): Promise<any> {
	if (!modPromise) modPromise = openjpegFactory({ print: () => {}, printErr: () => {} })
	return modPromise
}

export interface DecodedImage {
	width: number
	height: number
	channels: number       // 1 (grey), 3 (RGB), 4 (RGBA)
	pixels: Uint8Array      // interleaved, 8-bit per sample
}

/** Decode a J2C codestream to raw interleaved 8-bit pixels. */
export async function decodeJ2C(bytes: Buffer | Uint8Array): Promise<DecodedImage> {
	const mod = await getModule()
	const dec = new mod.J2KDecoder()
	try {
		const enc = dec.getEncodedBuffer(bytes.length)
		enc.set(bytes)
		dec.decode()
		const fi = dec.getFrameInfo()
		// WHY copy: getDecodedBuffer() returns a view into the WASM heap that the next decode (and
		// dec.delete()) will clobber. Copy into a standalone array before the buffer is reused.
		const raw = dec.getDecodedBuffer()
		// WHY explicit: openjpeg-wasm sometimes parses the header (real width/height/components) but
		// produces an EMPTY pixel buffer for certain codestreams (progression order / truncation it
		// can't handle). Without this, fast-png later throws the opaque "wrong data size. Found 0,
		// expected N". Surface it as a clear, greppable decode failure instead.
		const expected = fi.width * fi.height * fi.componentCount
		if (raw.length < expected) {
			throw new Error(`j2c_decode_incomplete: got ${raw.length} of ${expected}B (${fi.width}×${fi.height}×${fi.componentCount})`)
		}
		const pixels = new Uint8Array(raw.length)
		pixels.set(raw)
		return { width: fi.width, height: fi.height, channels: fi.componentCount, pixels }
	} finally {
		dec.delete?.()
	}
}

// Max texture dimension after transcode. SL/OpenSim ship textures up to 1024² (sometimes 2048²);
// at full res a region's ~1500 textures blow past browser GPU/heap limits and crash the tab. 512 is
// the SL default detail size and plenty for a web viewer. Override with QS_MAX_TEX_DIM.
const MAX_TEX_DIM = Number(process.env.QS_MAX_TEX_DIM) || 512

// WHY pure + exported: box-downscale tested without a WASM decode. Halves interleaved 8-bit pixels
// (averaging each 2×2 block per channel) until both dims ≤ max. SL textures are power-of-two so
// repeated halving lands exactly; bails if a dimension is odd (can't cleanly halve) to stay in bounds.
export function downscalePixels(
	pixels: Uint8Array, width: number, height: number, channels: number, maxDim: number,
): { pixels: Uint8Array; width: number; height: number } {
	let w = width, h = height, px = pixels
	while ((w > maxDim || h > maxDim) && w >= 2 && h >= 2 && w % 2 === 0 && h % 2 === 0) {
		const nw = w >> 1, nh = h >> 1
		const out = new Uint8Array(nw * nh * channels)
		for (let y = 0; y < nh; y++) {
			for (let x = 0; x < nw; x++) {
				const sx = x << 1, sy = y << 1
				for (let c = 0; c < channels; c++) {
					const a = px[(sy * w + sx) * channels + c]
					const b = px[(sy * w + sx + 1) * channels + c]
					const cc = px[((sy + 1) * w + sx) * channels + c]
					const d = px[((sy + 1) * w + sx + 1) * channels + c]
					out[(y * nw + x) * channels + c] = (a + b + cc + d) >> 2
				}
			}
		}
		px = out; w = nw; h = nh
	}
	return { pixels: px, width: w, height: h }
}

// WHY pure + exported: lets the alpha-detection rule be unit-tested without a WASM decode.
// Reports transparency ONLY for 4-channel images that actually carry a sub-255 alpha sample —
// a fully-opaque RGBA texture returns false so the client doesn't needlessly mark it transparent
// (which would drop it into the blended/sorted pass for no reason).
export function pixelsHaveAlpha(pixels: Uint8Array | number[], channels: number): boolean {
	if (channels !== 4) return false
	for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true
	return false
}

/** Decode a J2C codestream → PNG buffer plus a flag for whether it carries real transparency. */
export async function j2cToPngWithAlpha(
	bytes: Buffer | Uint8Array,
): Promise<{ png: Buffer; hasAlpha: boolean; width: number; height: number; srcWidth: number; srcHeight: number }> {
	const dec = await decodeJ2C(bytes)
	const { channels } = dec
	const { pixels, width, height } = downscalePixels(dec.pixels, dec.width, dec.height, channels, MAX_TEX_DIM)
	const png = encodePng({ width, height, data: pixels, channels: channels as 1 | 2 | 3 | 4, depth: 8 })
	return { png: Buffer.from(png), hasAlpha: pixelsHaveAlpha(pixels, channels), width, height, srcWidth: dec.width, srcHeight: dec.height }
}

/** Decode a J2C codestream and re-encode it as a PNG buffer. */
export async function j2cToPng(bytes: Buffer | Uint8Array): Promise<Buffer> {
	return (await j2cToPngWithAlpha(bytes)).png
}
