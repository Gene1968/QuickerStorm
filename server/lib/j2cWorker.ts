// server/lib/j2cWorker.ts — Bun Worker that decodes one J2C→WebP job per message.
//
// WHY: j2cToImageWithAlpha() is a SYNCHRONOUS WASM call (single shared openjpeg instance) that BLOCKS
// Bun's event loop. Under a region texture flood it serializes all decodes AND stalls the circuit
// (UDP acks, WS heartbeats), contributing to silent circuit death. Running the decode inside a pool
// of worker threads keeps the main loop responsive and lets decodes run in parallel across cores.
// The pool (lib/j2cPool.ts) owns the workers; this file is just the per-job decode body.
import { j2cToImageWithAlpha } from './j2c'

// Each job: { id, buf, maxDim? }. buf is the J2C codestream as an ArrayBuffer (structured-cloned in
// — fine). maxDim (optional) overrides the world-load downscale cap; the preview path passes Infinity
// for a full-resolution transcode. Undefined → the decoder's default MAX_TEX_DIM (world-load behavior).
// Reply on success: { id, ok:true, image:<ArrayBuffer, transferred>, hasAlpha, width, height, srcWidth, srcHeight }.
// Reply on failure: { id, ok:false, error }. The pool rejects the matching job with this error so the
// caller's existing catch (handlers/assets.ts) sends {error} to the client, exactly as before.
self.onmessage = async (e: MessageEvent) => {
	const { id, buf, maxDim } = e.data as { id: number; buf: ArrayBuffer; maxDim?: number }
	try {
		const r = await j2cToImageWithAlpha(Buffer.from(buf), maxDim)
		const image = r.image
		// WHY .slice(byteOffset, …): the Buffer may be a view onto a larger pooled ArrayBuffer. slice
		// gives a standalone ArrayBuffer covering exactly these bytes, safe to transfer zero-copy.
		const imgBuf = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength)
		self.postMessage(
			{ id, ok: true, image: imgBuf, hasAlpha: r.hasAlpha, width: r.width, height: r.height, srcWidth: r.srcWidth, srcHeight: r.srcHeight },
			[imgBuf],
		)
	} catch (err) {
		self.postMessage({ id, ok: false, error: String((err as Error)?.message || err) })
	}
}
