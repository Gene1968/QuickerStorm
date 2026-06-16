// src/lib/texDecodeBitmap.js — decode an image Blob (WebP from our pipeline) into a downscaled
// ImageBitmap, with NO THREE dependency so it can run inside texDecode.worker.js OR inline on the main
// thread as a fallback. FEATURE-GAPS #11 Pass 2: moves createImageBitmap + downscale off the main thread.

// Pure: the resident-texture dimension cap. Returns the scaled {w,h} (longest edge = maxDim, each axis
// floored at 1px), or null when the image already fits (no downscale). Mirrors useTextureFetch MAX_TEX_DIM.
export function computeDownscale(w, h, maxDim) {
	const longest = Math.max(w, h)
	if (longest <= maxDim) return null
	const s = maxDim / longest
	return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

// Decode `blob` to an ImageBitmap whose longest edge is ≤ maxDim. Pre-flips Y and pins straight alpha at
// decode time: WebGL ignores texture.flipY (UNPACK_FLIP_Y) and texture.premultiplyAlpha for ImageBitmap
// sources, so both must be baked here to match the old <img> path. Returns null on ANY failure (no
// createImageBitmap in jsdom, malformed blob, no 2D context) — never throws. Uses OffscreenCanvas because
// it works on the main thread AND in a worker (document.createElement('canvas') does not exist in a worker).
export async function decodeToBitmap(blob, maxDim) {
	if (typeof createImageBitmap !== 'function') return null
	let bitmap
	try {
		bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })
	} catch { return null }
	const ds = computeDownscale(bitmap.width, bitmap.height, maxDim)
	if (!ds) return bitmap
	try {
		const canvas = new OffscreenCanvas(ds.w, ds.h)
		const ctx = canvas.getContext('2d')
		if (!ctx) return bitmap                 // no 2D context: keep the full-size bitmap (correct, larger)
		ctx.drawImage(bitmap, 0, 0, ds.w, ds.h)
		const scaled = await createImageBitmap(canvas)
		bitmap.close?.()                        // free the full-size intermediate
		return scaled
	} catch {
		return bitmap                           // downscale failed: use full-size bitmap
	}
}
