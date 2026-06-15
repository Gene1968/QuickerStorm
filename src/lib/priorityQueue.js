// src/lib/priorityQueue.js — binary min-heap keyed by entry.priority, for the asset-fetch queues
// (texture / mesh / sculpt) that grow many-thousands deep on dense regions. Near-first dispatch needs
// the lowest-priority (= nearest) entry next; an O(n) min-scan per freed slot would add to the very
// main-thread saturation we are trying to relieve, so the queue is a heap: O(log n) push/pop. The
// backing array IS the heap, so queue.length stays valid for stats. Entries are objects carrying a
// numeric `priority` (smaller = nearer = dispatched sooner); ties break arbitrarily (order among
// equal-distance fetches does not matter). Pure: operate only on the array handed in.

export function heapPush(heap, entry) {
	heap.push(entry)
	let i = heap.length - 1
	while (i > 0) {
		const parent = (i - 1) >> 1
		if (heap[parent].priority <= heap[i].priority) break
		const tmp = heap[parent]; heap[parent] = heap[i]; heap[i] = tmp
		i = parent
	}
}

export function heapPop(heap) {
	const n = heap.length
	if (n === 0) return null
	const top = heap[0]
	const last = heap.pop()
	if (n > 1) {
		heap[0] = last
		let i = 0
		const len = heap.length
		for (;;) {
			const l = 2 * i + 1, r = 2 * i + 2
			let smallest = i
			if (l < len && heap[l].priority < heap[smallest].priority) smallest = l
			if (r < len && heap[r].priority < heap[smallest].priority) smallest = r
			if (smallest === i) break
			const tmp = heap[i]; heap[i] = heap[smallest]; heap[smallest] = tmp
			i = smallest
		}
	}
	return top
}
