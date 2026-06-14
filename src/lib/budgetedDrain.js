// src/lib/budgetedDrain.js — frame-budgeted FIFO drain. Pure + synchronous so it is unit-testable
// without a DOM/renderer. Used by the texture build pump (useTextureFetch) to spread decode+upload
// cost across frames instead of bursting (FEATURE-GAPS #11). `processOne` MAY start async work; this
// helper only bounds how many items are STARTED per call (a count cap + a wall-clock budget on the
// synchronous portion of the loop). It always processes at least one item so a single already-long
// frame can never stall the queue forever.
//
// `now` is injected (defaults to performance.now) so tests pass a deterministic fake clock.
export function drainWithinBudget({ queue, maxItems = 32, budgetMs = 4, now = () => performance.now(), processOne, onError = null }) {
	if (!queue || !queue.length || typeof processOne !== 'function') return 0
	const start = now()
	let processed = 0
	while (queue.length && processed < maxItems) {
		// Time cap is checked only after the first item, so we always make ≥1 unit of progress.
		if (processed > 0 && now() - start >= budgetMs) break
		const item = queue.shift()
		processed++
		try { processOne(item) } catch (e) { if (onError) onError(e, item) }
	}
	return processed
}
