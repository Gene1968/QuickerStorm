import { describe, it, expect } from 'bun:test'
import { selectEvictions, selectReloads } from '@/lib/cullPolicy.js'

describe('selectEvictions', () => {
	it('evicts farthest first, capped at maxN', () => {
		const cands = [{ id: 1, dist: 10 }, { id: 2, dist: 90 }, { id: 3, dist: 50 }, { id: 4, dist: 200 }]
		expect(selectEvictions(cands, 2)).toEqual([4, 2])
	})
	it('returns all (farthest-first) when maxN exceeds count', () => {
		expect(selectEvictions([{ id: 7, dist: 5 }, { id: 8, dist: 8 }], 10)).toEqual([8, 7])
	})
	it('empty candidates → []', () => {
		expect(selectEvictions([], 5)).toEqual([])
	})
	it('does not mutate the input array', () => {
		const cands = [{ id: 1, dist: 1 }, { id: 2, dist: 2 }]
		selectEvictions(cands, 1)
		expect(cands.map(c => c.id)).toEqual([1, 2])
	})
})

describe('selectReloads', () => {
	it('reloads nearest first, only within rNear, capped at maxN', () => {
		const cands = [{ id: 1, dist: 30 }, { id: 2, dist: 200 }, { id: 3, dist: 10 }, { id: 4, dist: 96 }]
		expect(selectReloads(cands, 96, 2)).toEqual([3, 1])
	})
	it('excludes anything beyond rNear', () => {
		expect(selectReloads([{ id: 5, dist: 500 }], 96, 5)).toEqual([])
	})
	it('empty candidates → []', () => {
		expect(selectReloads([], 96, 5)).toEqual([])
	})
})
