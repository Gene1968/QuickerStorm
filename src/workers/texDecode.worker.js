// Module worker: decodes an image Blob into a downscaled ImageBitmap off the main thread.
// Receives { id, blob, maxDim }. Replies { id, bitmap } with the bitmap TRANSFERRED (zero-copy),
// or { id, bad: true } when decode yields null/throws. FEATURE-GAPS #11 Pass 2 — mirrors meshBake.worker.js.
import { decodeToBitmap } from '@/lib/texDecodeBitmap.js'

self.onmessage = async (e) => {
	const { id, blob, maxDim } = e.data
	const t0 = performance.now()
	let bitmap = null
	try { bitmap = await decodeToBitmap(blob, maxDim) } catch { bitmap = null }
	const decodeMs = performance.now() - t0
	if (bitmap) self.postMessage({ id, bitmap, decodeMs }, [bitmap])
	else self.postMessage({ id, bad: true, decodeMs })
}
