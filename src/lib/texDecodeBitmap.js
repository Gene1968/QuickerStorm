// src/lib/texDecodeBitmap.js — decode an image Blob (WebP from our pipeline) into downscaled CPU pixel
// data ({data:Uint8ClampedArray RGBA, width, height}), with NO THREE dependency so it can run inside
// texDecode.worker.js OR inline on the main thread as a fallback. FEATURE-GAPS #11 Pass 2: moves
// createImageBitmap + downscale off the main thread.
//
// WHY CPU pixels (not an ImageBitmap): a GPU-backed ImageBitmap created in a worker (the
// createImageBitmap(OffscreenCanvas) downscale produces one) and TRANSFERRED to the main thread cannot
// be uploaded on the main-thread WebGL context — its shared-image/mailbox belongs to the worker's GPU
// context, so texImage2D fails with `glCopySubTextureCHROMIUM: invalid mailbox / not a shared image`.
// Reading the canvas back to CPU pixels (getImageData) and uploading a THREE.DataTexture sidesteps that
// entirely (raw bytes have no mailbox), while keeping the expensive decode+downscale off the main thread.

// Pure: the resident-texture dimension cap. Returns the scaled {w,h} (longest edge = maxDim, each axis
// floored at 1px), or null when the image already fits (no downscale). Mirrors useTextureFetch MAX_TEX_DIM.
export function computeDownscale(w, h, maxDim) {
	const longest = Math.max(w, h)
	if (longest <= maxDim) return null
	const s = maxDim / longest
	return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

// Decode `blob` to RGBA CPU pixels whose longest edge is ≤ maxDim: { data, width, height } or null.
// Bakes the Y-flip at decode (`imageOrientation:'flipY'`) so getImageData row 0 = image BOTTOM, which is
// exactly what a THREE.DataTexture wants (data[0] → texel t=0 = bottom; DataTexture ignores UNPACK_FLIP_Y).
// `premultiplyAlpha:'none'` + getImageData (always returns straight/unpremultiplied alpha) keeps straight
// alpha, matching the old path. Returns null on ANY failure (no createImageBitmap in jsdom, malformed
// blob, no 2D context) — never throws. Uses OffscreenCanvas because it works on the main thread AND in a
// worker (document.createElement('canvas') does not exist in a worker).
export async function decodeToPixels(blob, maxDim) {
	if (typeof createImageBitmap !== 'function') return null
	let bitmap
	try {
		bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' })
	} catch { return null }
	const ds = computeDownscale(bitmap.width, bitmap.height, maxDim)
	const w = ds ? ds.w : bitmap.width
	const h = ds ? ds.h : bitmap.height
	try {
		const canvas = new OffscreenCanvas(w, h)
		const ctx = canvas.getContext('2d')
		if (!ctx) { bitmap.close?.(); return null }
		ctx.drawImage(bitmap, 0, 0, w, h)       // full-size (w,h = bitmap dims) or downscaled
		const data = ctx.getImageData(0, 0, w, h).data   // Uint8ClampedArray RGBA, straight alpha, Y baked
		bitmap.close?.()
		return { data, width: w, height: h }
	} catch {
		bitmap.close?.()
		return null
	}
}
