// server/lib/j2cPool.ts — worker-thread pool for J2C→PNG decoding, with an inline fallback.
//
// WHY: decoding is a synchronous WASM call that blocks Bun's event loop (see lib/j2cWorker.ts). This
// pool fans decodes out to N worker threads so the main loop stays responsive and decodes run in
// parallel. If workers can't be spawned (or one dies fatally), we degrade gracefully to an inline
// decode — correctness over parallelism. A decode must never hang forever: a worker `onerror` rejects
// all of that worker's in-flight jobs so callers fall through to their existing error handling.
import { j2cToPngWithAlpha } from './j2c'

export interface DecodeResult {
	png: Buffer
	hasAlpha: boolean
	width: number
	height: number
	srcWidth: number
	srcHeight: number
}

interface PendingJob {
	resolve: (r: DecodeResult) => void
	reject: (e: Error) => void
}

interface PoolWorker {
	worker: Worker
	inflight: Map<number, PendingJob>
}

// WHY pure + exported: the least-busy pick is the one bit of scheduling logic worth unit-testing
// without spawning real workers. Returns the index of the worker with the fewest in-flight jobs
// (first on ties). Empty input → 0 so callers never index out of range.
export function pickWorkerIndex(inflightCounts: number[]): number {
	if (inflightCounts.length === 0) return 0
	let best = 0
	for (let i = 1; i < inflightCounts.length; i++) {
		if (inflightCounts[i] < inflightCounts[best]) best = i
	}
	return best
}

const POOL_SIZE = Math.max(1, Math.min(4, (require('node:os').cpus().length || 2) - 1))

let workers: PoolWorker[] | null = null
let degraded = false
let nextJobId = 1

function spawnPool(): void {
	if (workers || degraded) return
	try {
		const url = new URL('./j2cWorker.ts', import.meta.url).href
		const pool: PoolWorker[] = []
		for (let i = 0; i < POOL_SIZE; i++) {
			const worker = new Worker(url)
			const pw: PoolWorker = { worker, inflight: new Map() }

			worker.onmessage = (e: MessageEvent) => {
				const d = e.data as { id: number; ok: boolean; error?: string; png?: ArrayBuffer; hasAlpha?: boolean; width?: number; height?: number; srcWidth?: number; srcHeight?: number }
				const job = pw.inflight.get(d.id)
				if (!job) return
				pw.inflight.delete(d.id)
				if (d.ok && d.png) {
					job.resolve({
						png: Buffer.from(d.png),
						hasAlpha: !!d.hasAlpha,
						width: d.width || 0,
						height: d.height || 0,
						srcWidth: d.srcWidth || 0,
						srcHeight: d.srcHeight || 0,
					})
				} else {
					job.reject(new Error(d.error || 'j2c_worker_failed'))
				}
			}

			// WHY: a fatal worker error must not leave its jobs hanging forever. Reject every in-flight
			// job for this worker (callers fall through to error handling) and flip the pool to degraded
			// so subsequent decodes run inline rather than posting into a dead worker.
			worker.onerror = (err: ErrorEvent) => {
				const msg = String(err?.message || 'j2c_worker_error')
				for (const [, job] of pw.inflight) job.reject(new Error(msg))
				pw.inflight.clear()
				degraded = true
			}

			pool.push(pw)
		}
		workers = pool
	} catch {
		// Worker construction unsupported/failed on this runtime → permanent inline fallback.
		degraded = true
		workers = null
	}
}

/**
 * Decode a J2C codestream to PNG via a worker thread (or inline if the pool is degraded). Rejects
 * with the same Error the inline decode would throw (e.g. j2c_decode_incomplete) so the caller's
 * existing catch can send {error} to the client.
 */
export async function decodeInPool(bytes: Buffer): Promise<DecodeResult> {
	if (!workers && !degraded) spawnPool()
	if (degraded || !workers || workers.length === 0) {
		return j2cToPngWithAlpha(bytes)
	}

	const idx = pickWorkerIndex(workers.map(w => w.inflight.size))
	const pw = workers[idx]
	const id = nextJobId++
	// WHY copy to a standalone ArrayBuffer: the slice() yields a buffer covering exactly these bytes
	// (Buffer may be a view onto a pooled allocation); it is structured-cloned into the worker.
	const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

	return new Promise<DecodeResult>((resolve, reject) => {
		pw.inflight.set(id, { resolve, reject })
		try {
			pw.worker.postMessage({ id, buf }, [buf])
		} catch (e) {
			pw.inflight.delete(id)
			reject(e as Error)
		}
	})
}

// WHY exported: lets index.ts / diagnostics log pool health under load without poking internals.
export function getPoolStats(): { workers: number; inflight: number; degraded: boolean } {
	return {
		workers: workers ? workers.length : 0,
		inflight: workers ? workers.reduce((n, w) => n + w.inflight.size, 0) : 0,
		degraded,
	}
}
