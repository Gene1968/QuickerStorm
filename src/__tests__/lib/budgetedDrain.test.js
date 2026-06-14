// src/__tests__/lib/budgetedDrain.test.js
import { describe, it, expect } from 'bun:test'
import { drainWithinBudget } from '@/lib/budgetedDrain.js'

const fakeClock = (step = 1) => { let t = 0; return () => { const v = t; t += step; return v } }

describe('drainWithinBudget', () => {
	it('processes up to maxItems then stops, leaving the rest queued', () => {
		const q = [1, 2, 3, 4, 5]
		const seen = []
		const n = drainWithinBudget({ queue: q, maxItems: 2, budgetMs: 1e9, now: () => 0, processOne: (x) => seen.push(x) })
		expect(n).toBe(2)
		expect(seen).toEqual([1, 2])     // FIFO
		expect(q).toEqual([3, 4, 5])     // remainder stays queued
	})

	it('stops when the time budget is exceeded mid-drain (still does at least one)', () => {
		const q = [1, 2, 3, 4, 5]
		const seen = []
		const n = drainWithinBudget({ queue: q, maxItems: 100, budgetMs: 3, now: fakeClock(1), processOne: (x) => seen.push(x) })
		expect(n).toBe(3)
		expect(seen).toEqual([1, 2, 3])
	})

	it('always processes at least one item even if already over budget', () => {
		const q = [1, 2]
		const seen = []
		const n = drainWithinBudget({ queue: q, maxItems: 100, budgetMs: 1, now: fakeClock(1000), processOne: (x) => seen.push(x) })
		expect(n).toBe(1)
		expect(seen).toEqual([1])
	})

	it('empty queue processes zero, no throw', () => {
		expect(drainWithinBudget({ queue: [], maxItems: 10, budgetMs: 5, now: () => 0, processOne: () => {} })).toBe(0)
	})

	it('a throwing processOne is counted, surfaced via onError, and does not abort the loop', () => {
		const q = [1, 2, 3]
		const seen = [], errs = []
		const n = drainWithinBudget({
			queue: q, maxItems: 10, budgetMs: 1e9, now: () => 0,
			processOne: (x) => { if (x === 2) throw new Error('boom'); seen.push(x) },
			onError: (e, item) => errs.push(item),
		})
		expect(n).toBe(3)
		expect(seen).toEqual([1, 3])
		expect(errs).toEqual([2])
		expect(q).toEqual([])
	})
})
