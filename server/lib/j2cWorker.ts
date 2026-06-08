// server/lib/j2cWorker.ts — Bun Worker that decodes one J2C→PNG job per message.
//
// WHY: j2cToPngWithAlpha() is a SYNCHRONOUS WASM call (single shared openjpeg instance) that BLOCKS
// Bun's event loop. Under a region texture flood it serializes all decodes AND stalls the circuit
// (UDP acks, WS heartbeats), contributing to silent circuit death. Running the decode inside a pool
// of worker threads keeps the main loop responsive and lets decodes run in parallel across cores.
// The pool (lib/j2cPool.ts) owns the workers; this file is just the per-job decode body.
import { j2cToPngWithAlpha } from './j2c'

// Each job: { id, buf }. buf is the J2C codestream as an ArrayBuffer (structured-cloned in — fine).
// Reply on success: { id, ok:true, png:<ArrayBuffer, transferred>, hasAlpha, width, height, srcWidth, srcHeight }.
// Reply on failure: { id, ok:false, error }. The pool rejects the matching job with this error so the
// caller's existing catch (handlers/assets.ts) sends {error} to the client, exactly as before.
self.onmessage = async (e: MessageEvent) => {
	const { id, buf } = e.data as { id: number; buf: ArrayBuffer }
	try {
		const r = await j2cToPngWithAlpha(Buffer.from(buf))
		const png = r.png
		// WHY .slice(byteOffset, …): the PNG Buffer may be a view onto a larger pooled ArrayBuffer.
		// slice gives a standalone ArrayBuffer covering exactly the PNG bytes, safe to transfer zero-copy.
		const pngBuf = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
		self.postMessage(
			{ id, ok: true, png: pngBuf, hasAlpha: r.hasAlpha, width: r.width, height: r.height, srcWidth: r.srcWidth, srcHeight: r.srcHeight },
			[pngBuf],
		)
	} catch (err) {
		self.postMessage({ id, ok: false, error: String((err as Error)?.message || err) })
	}
}
