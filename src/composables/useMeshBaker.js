import { bakeJob } from '@/lib/primGeometry.js'

// Dispatches geometry bakes to a module worker, batching all jobs submitted within a
// microtask-flush window into one postMessage. Falls back to synchronous in-thread baking
// if the worker can't be constructed (no module-worker support, CSP, test env).
//
// bake(job) → Promise<arrays | { bad:true }>   job: { kind, shape?, scale, subs? }
export function useMeshBaker() {
	let worker = null
	let dead = false
	let nextId = 1
	let nextBatch = 1 // reserved: correlate replies if a future pooled/parallel worker returns batches out of order
	const pending = new Map()       // jobId → { resolve }
	let queue = []                  // jobs awaiting the next flush
	let flushScheduled = false
	// Throughput probe (read+reset by the engine's 5s telemetry): worker-side bake time vs jobs done.
	const stats = { batches: 0, jobs: 0, bakeMs: 0 }
	// WHY recycle: every batch structured-clones job payloads INTO the worker and allocates THREE
	// geometry intermediates there. That garbage lives in the WORKER's V8 isolate — but Chrome's
	// performance.memory (the governor's signal) sums all isolates in the process, and an idle worker
	// never triggers its own GC. Observed: heap pinned at 93% with the whole scene evicted, because
	// gigabytes of dead worker garbage counted against the budget. Terminating the worker frees its
	// entire isolate instantly; it's stateless, so respawn cost is just module re-init on next flush.
	const RECYCLE_AFTER_JOBS = 1500
	let jobsSinceSpawn = 0

	function initWorker() {
		if (worker || dead) return
		try {
			worker = new Worker(new URL('../workers/meshBake.worker.js', import.meta.url), { type: 'module' })
			worker.onmessage = (e) => {
				stats.batches++; stats.jobs += e.data.results.length; stats.bakeMs += e.data.bakeMs || 0
				jobsSinceSpawn += e.data.results.length
				for (const r of e.data.results) {
					const p = pending.get(r.id)
					if (!p) continue
					pending.delete(r.id)
					const { id, ...out } = r
					p.resolve(out)
				}
				// Recycle at a quiet moment (nothing pending/queued): frees the worker isolate's
				// accumulated garbage so it stops inflating the process heap the governor reads.
				if (jobsSinceSpawn >= RECYCLE_AFTER_JOBS && pending.size === 0 && queue.length === 0) {
					jobsSinceSpawn = 0
					try { worker.terminate() } catch { /* ignore */ }
					worker = null   // initWorker() respawns on the next flush; `dead` stays false
				}
			}
			worker.onerror = (e) => { console.warn('[meshBaker] worker error → sync fallback', e?.message || e); killWorker() }
			worker.onmessageerror = (e) => { console.warn('[meshBaker] worker message error → sync fallback', e); killWorker() }
		} catch {
			dead = true
			worker = null
		}
	}

	// Worker failed: tear it down and resolve everything still pending via the sync fallback.
	function killWorker() {
		dead = true
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		for (const [, p] of pending) p.resolveSync()
		pending.clear()
		queue = []
	}

	function flush() {
		flushScheduled = false
		if (!queue.length) return
		initWorker()
		const jobs = queue
		queue = []
		if (dead || !worker) {            // sync fallback
			for (const j of jobs) {
				const p = pending.get(j.id)
				pending.delete(j.id)
				p && p.resolve(syncBake(j))
			}
			return
		}
		// WHY: inputs (incl. shared-cache `subs` arrays) are structured-cloned, NOT transferred,
		// so the caller's arrays stay valid — required because the sync fallback may re-bake from them.
		// WHY try/catch: a non-cloneable payload (e.g. a Vue/Pinia reactive Proxy slipping through)
		// throws DataCloneError synchronously here — without this the whole batch's promises would
		// hang forever (prim stuck as a placeholder cube). Resolve the batch via sync bake instead.
		try {
			worker.postMessage({ batchId: nextBatch++, jobs })
		} catch (err) {
			console.warn('[meshBaker] postMessage failed → sync fallback for batch', err?.message || err)
			for (const j of jobs) {
				const p = pending.get(j.id)
				if (p) { pending.delete(j.id); p.resolve(syncBake(j)) }
			}
		}
	}

	function syncBake(job) {
		try { return bakeJob(job) } catch { return { bad: true } }
	}

	function bake(job) {
		const id = nextId++
		job.id = id
		return new Promise((resolve) => {
			pending.set(id, { resolve, resolveSync: () => resolve(syncBake(job)) })
			queue.push(job)
			if (!flushScheduled) { flushScheduled = true; queueMicrotask(flush) }
		})
	}

	function dispose() {
		try { worker && worker.terminate() } catch { /* ignore */ }
		worker = null
		dead = true
		for (const [, p] of pending) p.resolveSync()
		pending.clear()
		queue = []
	}

	// Backpressure signal: jobs requested but not yet resolved (queued + posted + awaiting reply).
	// The caller throttles dispatch on this so a fill flood can't pile unbounded job payloads
	// (esp. copied submesh arrays) faster than the single worker drains them → OOM.
	function outstanding() { return pending.size }

	// Snapshot + reset the worker throughput counters (5s telemetry cadence).
	function takeStats() {
		const s = { ...stats }
		stats.batches = 0; stats.jobs = 0; stats.bakeMs = 0
		return s
	}

	return { bake, dispose, outstanding, takeStats }
}
