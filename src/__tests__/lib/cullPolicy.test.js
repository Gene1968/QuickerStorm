import { describe, it, expect } from 'bun:test'
import { selectEvictions, selectReloads, groupChildrenByRoot } from '@/lib/cullPolicy.js'

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
	it('never evicts candidates at or within minDist (near guard)', () => {
		const cands = [{ id: 1, dist: 50 }, { id: 2, dist: 96 }, { id: 3, dist: 97 }, { id: 4, dist: 300 }]
		expect(selectEvictions(cands, 10, 96)).toEqual([4, 3])
	})
	it('all candidates within minDist → [] (culler converges to near set, not zero)', () => {
		const cands = [{ id: 1, dist: 10 }, { id: 2, dist: 96 }]
		expect(selectEvictions(cands, 10, 96)).toEqual([])
	})
	it('minDist omitted → legacy behavior (no guard)', () => {
		expect(selectEvictions([{ id: 1, dist: 5 }], 5)).toEqual([1])
	})
})

describe('groupChildrenByRoot', () => {
	it('groups child ids under their parentId; roots (parentId 0/absent) are not grouped', () => {
		const objects = new Map([
			[1, { localId: 1, parentId: 0 }],          // root
			[2, { localId: 2, parentId: 1 }],          // child of 1
			[3, { localId: 3, parentId: 1 }],          // child of 1
			[4, { localId: 4 }],                       // root (no parentId field)
			[5, { localId: 5, parentId: 4 }],          // child of 4
		])
		const g = groupChildrenByRoot(objects)
		expect(g.get(1)).toEqual([2, 3])
		expect(g.get(4)).toEqual([5])
		expect(g.has(2)).toBe(false)
		expect(g.size).toBe(2)
	})
	it('empty map → empty grouping', () => {
		expect(groupChildrenByRoot(new Map()).size).toBe(0)
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
