import { describe, it, expect } from 'bun:test'
import { createByteLRU } from '@/lib/byteLRU.js'

// Sizer: value IS its byte size (numbers) — keeps tests readable.
const lru = (budget) => createByteLRU({ budgetBytes: budget, sizeOf: (v) => v })

describe('createByteLRU', () => {
	it('stores and retrieves values; tracks bytes', () => {
		const c = lru(100)
		c.set('a', 30)
		c.set('b', 40)
		expect(c.get('a')).toBe(30)
		expect(c.has('b')).toBe(true)
		expect(c.bytes()).toBe(70)
		expect(c.size()).toBe(2)
	})

	it('evicts least-recently-used entries when an insert exceeds the budget', () => {
		const c = lru(100)
		c.set('a', 40)
		c.set('b', 40)
		c.set('c', 40)             // 120 > 100 → evict 'a' (oldest)
		expect(c.has('a')).toBe(false)
		expect(c.has('b')).toBe(true)
		expect(c.has('c')).toBe(true)
		expect(c.bytes()).toBe(80)
	})

	it('get() refreshes recency — touched entries survive eviction', () => {
		const c = lru(100)
		c.set('a', 40)
		c.set('b', 40)
		c.get('a')                 // 'a' now most-recent
		c.set('c', 40)             // evict 'b', not 'a'
		expect(c.has('a')).toBe(true)
		expect(c.has('b')).toBe(false)
	})

	it('a single over-budget entry is still cached (newest never evicted by its own insert)', () => {
		const c = lru(100)
		c.set('huge', 500)
		expect(c.get('huge')).toBe(500)
		expect(c.bytes()).toBe(500)
		c.set('next', 10)          // now 'huge' is evictable
		expect(c.has('huge')).toBe(false)
		expect(c.bytes()).toBe(10)
	})

	it('overwriting a key replaces bytes, no double count', () => {
		const c = lru(100)
		c.set('a', 30)
		c.set('a', 50)
		expect(c.bytes()).toBe(50)
		expect(c.size()).toBe(1)
	})

	it('delete() removes entry and bytes', () => {
		const c = lru(100)
		c.set('a', 30)
		expect(c.delete('a')).toBe(true)
		expect(c.has('a')).toBe(false)
		expect(c.bytes()).toBe(0)
		expect(c.delete('a')).toBe(false)
	})

	it('evictions counter increments per evicted entry', () => {
		const c = lru(100)
		c.set('a', 60)
		c.set('b', 60)             // evicts 'a'
		expect(c.evictions()).toBe(1)
	})

	it('has() does not refresh recency', () => {
		const c = lru(100)
		c.set('a', 40)
		c.set('b', 40)
		c.has('a')                 // peek only — 'a' stays oldest
		c.set('c', 40)             // evicts 'a'
		expect(c.has('a')).toBe(false)
	})

	it('clear() empties the map and resets bytes', () => {
		const c = lru(100)
		c.set('a', 1); c.set('b', 2)
		c.clear()
		expect(c.size()).toBe(0)
		expect(c.bytes()).toBe(0)
	})
})
