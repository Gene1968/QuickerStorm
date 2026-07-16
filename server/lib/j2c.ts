// server/lib/j2c.ts — server-side JPEG2000 (J2C) → WebP transcode.
//
// WHY: SL/OpenSim deliver every texture (and mesh skin, map tiles, profile pics, terrain detail)
// as a raw J2C codestream (Content-Type image/x-j2c). Browsers cannot decode J2C natively. We
// decode on the Bun server with the OpenJPEG WASM build and re-encode as WebP so the browser gets
// a format createImageBitmap() accepts. WASM (not native) → no build step, runs on the prod host.
// Decode location decision: see docs/superpowers/specs/2026-06-03-caps-feature-map.md slice 0.
import openjpegFactory from '@cornerstonejs/codec-openjpeg'
import { initializeImageMagick, ImageMagick, MagickFormat, MagickReadSettings } from '@imagemagick/magick-wasm'

// WHY ImageMagick as primary: the cornerstone openjpeg-wasm build silently mis-decodes some
// codestreams — live-confirmed on Kakadu-encoded multi-quality-layer RGBA foliage (palm frond
// 59c3769c…): luma/chroma/alpha all corrupted, so alpha-cutout textures rendered as opaque white
// blobs. magick-wasm (which wraps a current OpenJPEG) is byte-identical to cornerstone on streams
// cornerstone gets right, and matches independent ground truth (Pillow) on the ones it gets wrong.
// See __tests__/j2c-rgba-kakadu.test.ts. Cornerstone is kept as a fallback for any stream
// ImageMagick rejects, since its tolerance envelope differs.
let magickReady: Promise<void> | null = null
function initMagick(): Promise<void> {
	if (!magickReady) {
		const wasmUrl = new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm'))
		magickReady = Bun.file(wasmUrl).arrayBuffer().then(b => initializeImageMagick(b))
	}
	return magickReady
}

// WHY: the cornerstone WASM module is initialised once and reused. The factory is async (compiles
// wasm); we memoise the promise so concurrent callers share a single instance. print/printErr are
// silenced — OpenJPEG emits an "[INFO] …main header…" line per decode that would flood server logs.
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

function magickDecode(bytes: Uint8Array): DecodedImage {
	let out: DecodedImage | null = null
	ImageMagick.read(bytes, img => {
		// WHY copy inside the callbacks: ImageMagick frees the native image (and its pixel area)
		// when the callbacks return; the Uint8Array copy must be taken before that.
		img.getPixels(px => {
			const channels = img.channelCount
			if (channels < 1 || channels > 4) throw new Error(`j2c_unsupported_channels: ${channels}`)
			const area = px.getArea(0, 0, img.width, img.height)   // channel-interleaved, Q8 (0-255)
			out = { width: img.width, height: img.height, channels, pixels: new Uint8Array(area) }
		})
	})
	if (!out) throw new Error('j2c_decode_empty')
	return out
}

async function openjpegDecode(bytes: Buffer | Uint8Array): Promise<DecodedImage> {
	const mod = await getModule()
	const dec = new mod.J2KDecoder()
	try {
		const enc = dec.getEncodedBuffer(bytes.length)
		enc.set(bytes)
		dec.decode()
		const fi = dec.getFrameInfo()
		// WHY: on garbage input openjpeg "succeeds" with a 0×0 frame — surface that as a decode
		// failure here rather than letting the WebP encoder downstream throw a confusing size error.
		if (!fi.width || !fi.height || !fi.componentCount) {
			throw new Error(`j2c_decode_invalid_frame: ${fi.width}×${fi.height}×${fi.componentCount}`)
		}
		// WHY copy: getDecodedBuffer() returns a view into the WASM heap that the next decode (and
		// dec.delete()) will clobber. Copy into a standalone array before the buffer is reused.
		const raw = dec.getDecodedBuffer()
		// WHY explicit: openjpeg-wasm sometimes parses the header (real width/height/components) but
		// produces an EMPTY pixel buffer for certain codestreams (progression order / truncation it
		// can't handle). Without this, the WebP encoder downstream throws a confusing size-mismatch
		// error. Surface it as a clear, greppable decode failure instead.
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

/** Decode a J2C codestream to raw interleaved 8-bit pixels. */
export async function decodeJ2C(bytes: Buffer | Uint8Array): Promise<DecodedImage> {
	await initMagick()
	try {
		return magickDecode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
	} catch (e) {
		// Truncated grid assets fail BOTH decoders (expected, classified failedHard downstream).
		// A stream only cornerstone can handle is the interesting case — log it so we notice.
		try {
			const r = await openjpegDecode(bytes)
			console.warn(`[j2c] magick decode failed (${(e as Error).message.slice(0, 80)}) but openjpeg succeeded — served fallback`)
			return r
		} catch {
			throw e instanceof Error ? e : new Error(String(e))
		}
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

// Lossy WebP quality for OPAQUE textures. 90 ≈ visually lossless on SL surfaces while staying
// 3-5× smaller than PNG. Alpha textures are encoded LOSSLESS instead (lossy RGB bleed fuzzes
// cutout edges); see j2cToImageWithAlpha. Override with QS_WEBP_QUALITY.
const WEBP_QUALITY = Number(process.env.QS_WEBP_QUALITY) || 90

// Map a raw interleaved channel count to the MagickFormat that describes those samples, so magick
// can import our already-decoded pixel buffer without a container header. WHY exported: pure, unit-
// tested without a WASM round-trip. Throws outside 1-4 (matches magickDecode's channel guard).
export function rawFormatFor(channels: number): MagickFormat {
	switch (channels) {
		case 1: return MagickFormat.Gray
		case 2: return MagickFormat.Graya
		case 3: return MagickFormat.Rgb
		case 4: return MagickFormat.Rgba
		default: throw new Error(`webp_unsupported_channels: ${channels}`)
	}
}

// Encode raw interleaved 8-bit pixels → WebP. Lossy (WEBP_QUALITY) by default; lossless when
// `lossless` is set (alpha cutouts). WHY magick: the J2C decode already runs through magick-wasm in
// this module, so the encoder is loaded — no second WASM, no native build on the prod host.
export function encodeWebp(
	pixels: Uint8Array, width: number, height: number, channels: number, lossless: boolean,
): Buffer {
	if (pixels.length !== width * height * channels) {
		throw new Error(`webp_encode_size_mismatch: got ${pixels.length}B, expected ${width * height * channels} (${width}×${height}×${channels})`)
	}
	const settings = new MagickReadSettings()
	settings.format = rawFormatFor(channels)
	settings.width = width
	settings.height = height
	settings.depth = 8
	let out: Buffer | null = null
	ImageMagick.read(pixels, settings, img => {
		// WHY: lossless quality = encode effort only (fidelity is guaranteed by the lossless define).
		// 100 costs ~3× encode time in the pool for no fidelity gain; 75 = libwebp default effort.
		img.quality = lossless ? 75 : WEBP_QUALITY
		if (lossless) {
			img.settings.setDefine(MagickFormat.WebP, 'lossless', 'true')
			// Settings-level defines are what the WebP encoder reads; artifact calls are ignored by magick-wasm.
			// WHY: 'exact' preserves RGB under fully-transparent (alpha=0) pixels; bilinear sampling reads
			// those texels at cutout edges (foliage), so without exact the GPU sees zeroed RGB → dark halos.
			img.settings.setDefine(MagickFormat.WebP, 'exact', 'true')
		}
		img.write(MagickFormat.WebP, data => { out = Buffer.from(data) })
	})
	if (!out) throw new Error('webp_encode_empty')
	return out
}

// Encode raw interleaved 8-bit pixels → a raw J2C codestream (the format SL/OpenSim store textures in).
//
// GOTCHA (spike-confirmed 2026-07-15): magick's `MagickFormat.J2c` writes a *JP2 container* (magic
// `00 00 00 0C 6A 50 20 20…`), NOT what SL calls "J2C". An SL texture asset is a **raw codestream**
// starting with the SOC+SIZ markers `FF 4F FF 51` — which magick produces under the misleadingly-named
// `MagickFormat.J2k`. libopenmetaverse OpenJPEG.Encode / FS LLImageJ2C both emit the same raw codestream;
// OpenSim stores the bytes verbatim (no transcode) and serves them Content-Type image/x-j2c. So we MUST
// use J2k here. `lossless` uses the reversible 5/3 wavelet (quality 100); otherwise quality maps to the
// OpenJPEG compression rate. Mirrors encodeWebp's raw-pixel import path (same loaded WASM, no native build).
const J2C_QUALITY = Number(process.env.QS_J2C_QUALITY) || 90

export function encodeJ2C(
	pixels: Uint8Array, width: number, height: number, channels: number, lossless = false,
): Buffer {
	if (pixels.length !== width * height * channels) {
		throw new Error(`j2c_encode_size_mismatch: got ${pixels.length}B, expected ${width * height * channels} (${width}×${height}×${channels})`)
	}
	const settings = new MagickReadSettings()
	settings.format = rawFormatFor(channels)
	settings.width = width
	settings.height = height
	settings.depth = 8
	let out: Buffer | null = null
	ImageMagick.read(pixels, settings, img => {
		img.quality = lossless ? 100 : J2C_QUALITY
		img.write(MagickFormat.J2k, data => { out = Buffer.from(data) })
	})
	if (!out) throw new Error('j2c_encode_empty')
	return out
}

/** Decode a J2C codestream → WebP buffer plus whether it carries real transparency. Opaque textures
 *  use lossy q90; alpha textures use lossless (no cutout edge-bleed).
 *
 *  `maxDim` overrides the world-load downscale cap (MAX_TEX_DIM). The texture-preview floater passes
 *  Infinity to transcode at FULL asset resolution (no downscale) so the preview shows true pixels —
 *  mirrors FS llpreviewtexture BOOST_PREVIEW, which fetches the image at its native discard level.
 *  `srcWidth/srcHeight` are ALWAYS the true J2C-header dimensions regardless of the cap. */
export async function j2cToImageWithAlpha(
	bytes: Buffer | Uint8Array,
	maxDim: number = MAX_TEX_DIM,
): Promise<{ image: Buffer; hasAlpha: boolean; width: number; height: number; srcWidth: number; srcHeight: number }> {
	const dec = await decodeJ2C(bytes)
	const { channels } = dec
	const { pixels, width, height } = downscalePixels(dec.pixels, dec.width, dec.height, channels, maxDim)
	const hasAlpha = pixelsHaveAlpha(pixels, channels)
	const image = encodeWebp(pixels, width, height, channels, hasAlpha)
	return { image, hasAlpha, width, height, srcWidth: dec.width, srcHeight: dec.height }
}

/** Decode a J2C codestream and re-encode it as a WebP buffer. */
export async function j2cToImage(bytes: Buffer | Uint8Array): Promise<Buffer> {
	return (await j2cToImageWithAlpha(bytes)).image
}
