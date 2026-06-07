// Module worker: bakes prim/submesh geometry off the main thread.
// Receives a batch: { batchId, jobs: [{ id, kind, shape?, scale, subs? }] }
// Replies:          { batchId, results: [{ id, ...arrays } | { id, bad:true }] }
// Output array buffers are transferred (zero-copy). Inputs are structured-cloned
// (NOT transferred) — submesh `subs` are shared main-thread cache arrays.
import { bakeJob } from '@/lib/primGeometry.js'

self.onmessage = (e) => {
	const { batchId, jobs } = e.data
	const results = []
	const transfer = []
	for (const job of jobs) {
		let out
		try {
			out = bakeJob(job)
		} catch (err) {
			out = { bad: true, error: String(err && err.message || err) }
		}
		out.id = job.id
		results.push(out)
		if (!out.bad) {
			if (out.position) transfer.push(out.position.buffer)
			if (out.normal)   transfer.push(out.normal.buffer)
			if (out.uv)       transfer.push(out.uv.buffer)
			if (out.index)    transfer.push(out.index.buffer)
		}
	}
	self.postMessage({ batchId, results }, transfer)
}
