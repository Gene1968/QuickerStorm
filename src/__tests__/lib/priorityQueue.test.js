import { describe, it, expect } from 'bun:test'
import { heapPush, heapPop } from '@/lib/priorityQueue.js'

function drainAll(h) {
	const out = []
	let e
	while ((e = heapPop(h)) !== null) out.push(e.priority)
	return out
}

describe('priorityQueue min-heap', () => {
	it('pops entries in ascending priority regardless of push order', () => {
		const h = []
		;[50, 10, 30, 5, 40, 20].forEach(p => heapPush(h, { priority: p }))
		expect(drainAll(h)).toEqual([5, 10, 20, 30, 40, 50])
	})
	it('heapPop on empty → null', () => {
		expect(heapPop([])).toBe(null)
	})
	it('single entry pushes and pops', () => {
		const h = []
		heapPush(h, { priority: 7, id: 'a' })
		expect(heapPop(h)).toEqual({ priority: 7, id: 'a' })
		expect(h.length).toBe(0)
	})
	it('Infinity priorities sort last (non-distance fetches drain after near ones)', () => {
		const h = []
		;[Infinity, 3, Infinity, 1].forEach(p => heapPush(h, { priority: p }))
		expect(drainAll(h)).toEqual([1, 3, Infinity, Infinity])
	})
	it('interleaved push/pop keeps min order', () => {
		const h = []
		heapPush(h, { priority: 5 }); heapPush(h, { priority: 2 })
		expect(heapPop(h).priority).toBe(2)
		heapPush(h, { priority: 1 }); heapPush(h, { priority: 8 })
		expect(heapPop(h).priority).toBe(1)
		expect(heapPop(h).priority).toBe(5)
		expect(heapPop(h).priority).toBe(8)
		expect(heapPop(h)).toBe(null)
	})
	it('length stays valid for stats while heaped', () => {
		const h = []
		;[3, 1, 2].forEach(p => heapPush(h, { priority: p }))
		expect(h.length).toBe(3)
	})
})
