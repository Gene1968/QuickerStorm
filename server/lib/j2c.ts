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
		const pixels = new Uint8Array(raw.length)
		pixels.set(raw)
		return { width: fi.width, height: fi.height, channels: fi.componentCount, pixels }
	} finally {
		dec.delete?.()
	}
}

/** Decode a J2C codestream and re-encode it as a PNG buffer. */
export async function j2cToPng(bytes: Buffer | Uint8Array): Promise<Buffer> {
	const { width, height, channels, pixels } = await decodeJ2C(bytes)
	const png = encodePng({ width, height, data: pixels, channels: channels as 1 | 2 | 3 | 4, depth: 8 })
	return Buffer.from(png)
}
