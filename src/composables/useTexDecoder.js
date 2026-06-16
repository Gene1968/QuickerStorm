import { decodeToBitmap } from '@/lib/texDecodeBitmap.js'

// Dispatches Blob→ImageBitmap decode to a module worker (off the main thread), falling back to
// synchronous main-thread decode when the worker can't be constructed (no module-worker support, CSP,
// test env) or errors out. FEATURE-GAPS #11 Pass 2 — mirrors useMeshBaker.
//
//   decode(blob, maxDim) → Promise<ImageBitmap | null>
export function useTexDecoder() {
	let worker = null
	let dead = false
	let nextId = 1
	const pending = new Map()              // id → { resolve, blob, maxDim }
	const stats = { jobs: 0, decodeMs: 0 } // snapshot+reset by takeStats (5s telemetry)
	// WHY recycle (parity with useMeshBaker): Chrome's performance.memory — the memory governor's signal —
	// sums ALL worker isolates in the process, and an idle worker never GCs its own intermediates.
	// Terminating frees the isolate instantly; the worker is stateless so respawn is just module re-init.
	// Lighter need here (ImageBitmaps are transferred OUT, not retained) but kept as a safety valve.
	const RECYCLE_AFTER_JOBS = 2000
	let jobsSinceSpawn = 0

	// Main-thread fallback decode (no worker): time it locally — this IS real main-thread cost.
	function syncDecode(blob, maxDim) {
		const t0 = performance.now()
		return Promise.resolve(decodeToBitmap(blob, maxDim)).then(b => { stats.decodeMs += performance.now() - t0; return b })
	}

	function initWorker() {
		if (worker || dead) return
		try {
			worker = new Worker(new URL('../workers/texDecode.worker.js', import.meta.url), { type: 'module' })
			worker.onmessage = (e) => {
				const { id, bitmap, decodeMs } = e.data
				stats.decodeMs += decodeMs || 0
				const p = pending.get(id)
				if (p) { pending.delete(id); p.resolve(bitmap || null) }
				jobsSinceSpawn++
				if (jobsSinceSpawn >= RECYCLE_AFTER_JOBS && pending.size === 0) {
					jobsSinceSpawn = 0
					try { worker.terminate() } catch { /* ignore */ }
					worker = null              // initWorker() respawns on next decode; `dead` stays false
				}
			}
			worker.onerror = (e) => { console.warn('[texDecoder] worker error → sync fallback', e?.message || e); killWorker() }
			worker.onmessageerror = (e) => { console.warn('[texDecoder] worker message error → sync fallback', e); killWorker() }
		} catch {
			dead = true
			worker = null
		}
	}

	// Worker failed: tear it down and resolve everything still pending via the main-thread fallback.
	function killWorker() {
		dead = true
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		for (const [, p] of pending) p.resolve(syncDecode(p.blob, p.maxDim))
		pending.clear()
	}

	function decode(blob, maxDim) {
		stats.jobs++
		initWorker()
		// No worker (won't build / killed) → decode inline on the main thread (= pre-Pass-2 behavior).
		if (dead || !worker) return syncDecode(blob, maxDim)
		const id = nextId++
		return new Promise((resolve) => {
			pending.set(id, { resolve, blob, maxDim })
			// WHY try/catch: a non-cloneable payload throws DataCloneError synchronously here; without
			// this the promise would hang forever (texture stuck white). Fall back to sync decode.
			try {
				worker.postMessage({ id, blob, maxDim })
			} catch (err) {
				console.warn('[texDecoder] postMessage failed → sync fallback', err?.message || err)
				pending.delete(id)
				resolve(syncDecode(blob, maxDim))
			}
		})
	}

	// Backpressure signal: decodes posted but not yet returned. The pump throttles dispatch on this so
	// decoded ImageBitmaps (resident RGBA) can't outpace the upload drain.
	function outstanding() { return pending.size }

	// Snapshot + reset the throughput counters (5s telemetry cadence).
	function takeStats() {
		const s = { ...stats }
		stats.jobs = 0; stats.decodeMs = 0
		return s
	}

	function dispose() {
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		dead = true
		for (const [, p] of pending) p.resolve(null)
		pending.clear()
	}

	// True once the worker failed to construct / errored and we fell back to main-thread decode.
	function isDead() { return dead }

	return { decode, dispose, outstanding, takeStats, isDead }
}
