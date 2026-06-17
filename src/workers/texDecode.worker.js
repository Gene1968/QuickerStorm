// Module worker: decodes an image Blob into downscaled RGBA CPU pixels off the main thread.
// Receives { id, blob, maxDim }. Replies { id, pixels: {data, width, height} } with the pixel
// ArrayBuffer TRANSFERRED (zero-copy), or { id, bad: true } when decode yields null/throws.
// FEATURE-GAPS #11 Pass 2 — mirrors meshBake.worker.js. WHY CPU pixels not a transferred ImageBitmap:
// a worker-context GPU ImageBitmap can't be uploaded on the main-thread WebGL context (shared-image /
// mailbox mismatch → glCopySubTextureCHROMIUM errors). See texDecodeBitmap.js.
import { decodeToPixels } from '@/lib/texDecodeBitmap.js'

self.onmessage = async (e) => {
	const { id, blob, maxDim } = e.data
	const t0 = performance.now()
	let px = null
	try { px = await decodeToPixels(blob, maxDim) } catch { px = null }
	const decodeMs = performance.now() - t0
	if (px) self.postMessage({ id, pixels: px, decodeMs }, [px.data.buffer])
	else self.postMessage({ id, bad: true, decodeMs })
}
