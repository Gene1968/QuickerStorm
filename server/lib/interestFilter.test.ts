import { describe, it, expect } from 'bun:test'
import {
	withinInterest,
	effectivePos,
	inInterest,
	reconcileInterest,
	clampRadius,
	resolveRadius,
	R_MIN,
	R_MAX,
	type ObjLike,
} from './interestFilter'

describe('withinInterest', () => {
	const cam: [number, number, number] = [100, 100, 20]

	it('keeps objects inside the radius', () => {
		expect(withinInterest([110, 100, 20], cam, 96)).toBe(true)   // 10m away
		expect(withinInterest([100, 100, 20], cam, 96)).toBe(true)   // at camera
	})

	it('rejects objects beyond the radius', () => {
		expect(withinInterest([300, 100, 20], cam, 96)).toBe(false)  // 200m away
	})

	it('treats null position as in-interest (safe default — never cull unknowns)', () => {
		expect(withinInterest(null, cam, 96)).toBe(true)
	})

	it('uses full 3D distance including Z', () => {
		expect(withinInterest([100, 100, 200], cam, 96)).toBe(false) // 180m up
	})
})

describe('effectivePos — linkset root resolution', () => {
	// Child prim pos is a PARENT-RELATIVE offset, not a region position. The interest
	// test must use the linkset ROOT's region position so a linkset is kept together.
	it('returns a root prim own position', () => {
		const root: ObjLike = { localId: 1, parentId: 0, pos: [50, 60, 22] }
		const cache = new Map<number, ObjLike>([[1, root]])
		expect(effectivePos(root, id => cache.get(id))).toEqual([50, 60, 22])
	})

	it('walks a child up to its root region position', () => {
		const root: ObjLike = { localId: 1, parentId: 0, pos: [50, 60, 22] }
		const child: ObjLike = { localId: 2, parentId: 1, pos: [0.5, 0, 1] }   // local offset
		const cache = new Map<number, ObjLike>([[1, root], [2, child]])
		expect(effectivePos(child, id => cache.get(id))).toEqual([50, 60, 22])
	})

	it('returns null when the root is not yet cached (caller forwards by default)', () => {
		const orphan: ObjLike = { localId: 2, parentId: 99, pos: [0.5, 0, 1] }
		const cache = new Map<number, ObjLike>([[2, orphan]])
		expect(effectivePos(orphan, id => cache.get(id))).toBeNull()
	})

	it('bails out of a cyclic/over-deep chain instead of looping forever', () => {
		const a: ObjLike = { localId: 1, parentId: 2, pos: [0, 0, 0] }
		const b: ObjLike = { localId: 2, parentId: 1, pos: [0, 0, 0] }
		const cache = new Map<number, ObjLike>([[1, a], [2, b]])
		// neither resolves to a parentId 0 root → null, no hang
		expect(effectivePos(a, id => cache.get(id), 4)).toBeNull()
	})
})

describe('inInterest — hold children with an unresolved root', () => {
	const cam: [number, number, number] = [100, 100, 20]
	const none = () => undefined

	it('always keeps avatars regardless of distance/position', () => {
		expect(inInterest({ localId: 1, pcode: 47, parentId: 0, pos: [9999, 9999, 20] }, none, cam, 96)).toBe(true)
	})

	it('keeps an in-range root and drops an out-of-range root', () => {
		const cache = new Map<number, ObjLike>([[1, { localId: 1, parentId: 0, pos: [105, 100, 20] }]])
		expect(inInterest(cache.get(1)!, id => cache.get(id), cam, 96)).toBe(true)
		const out = { localId: 2, parentId: 0, pos: [400, 100, 20] } as ObjLike
		expect(inInterest(out, none, cam, 96)).toBe(false)
	})

	it('HOLDS a child whose linkset root is not yet cached (no blind forward)', () => {
		const child: ObjLike = { localId: 2, parentId: 99, pos: [0.5, 0, 1] }   // root 99 missing
		const cache = new Map<number, ObjLike>([[2, child]])
		expect(inInterest(child, id => cache.get(id), cam, 96)).toBe(false)
	})
})

describe('reconcileInterest — enter/leave diff', () => {
	const cam: [number, number, number] = [100, 100, 20]

	it('does not enter a child whose root has not arrived, then enters it once the in-range root is cached', () => {
		const child: ObjLike = { localId: 2, parentId: 99, pos: [0.5, 0, 1] }
		const cache = new Map<number, ObjLike>([[2, child]])
		expect(reconcileInterest(cache, new Set(), cam, 96).enter).toEqual([])   // held
		cache.set(99, { localId: 99, parentId: 0, pos: [105, 100, 20] })          // root arrives, in range
		expect(reconcileInterest(cache, new Set(), cam, 96).enter.sort()).toEqual([2, 99])
	})

	it('reports in-range, not-yet-sent objects as enters', () => {
		const cache = new Map<number, ObjLike>([
			[1, { localId: 1, parentId: 0, pos: [105, 100, 20] }],   // in range
			[2, { localId: 2, parentId: 0, pos: [400, 100, 20] }],   // out of range
		])
		const { enter, leave } = reconcileInterest(cache, new Set(), cam, 96)
		expect(enter).toEqual([1])
		expect(leave).toEqual([])
	})

	it('does not re-enter already-sent objects', () => {
		const cache = new Map<number, ObjLike>([
			[1, { localId: 1, parentId: 0, pos: [105, 100, 20] }],
		])
		const { enter } = reconcileInterest(cache, new Set([1]), cam, 96)
		expect(enter).toEqual([])
	})

	it('reports sent objects that left the radius as leaves', () => {
		const cache = new Map<number, ObjLike>([
			[1, { localId: 1, parentId: 0, pos: [400, 100, 20] }],   // moved/was out
		])
		const { leave } = reconcileInterest(cache, new Set([1]), cam, 96)
		expect(leave).toEqual([1])
	})

	it('never enters or leaves avatars (pcode 47) — always kept', () => {
		const cache = new Map<number, ObjLike>([
			[1, { localId: 1, parentId: 0, pos: [9999, 9999, 20], pcode: 47 }],  // far avatar
		])
		// far avatar already sent: must NOT be killed
		const r1 = reconcileInterest(cache, new Set([1]), cam, 96)
		expect(r1.leave).toEqual([])
		// far avatar not yet sent: SHOULD be entered (avatars always in interest)
		const r2 = reconcileInterest(cache, new Set(), cam, 96)
		expect(r2.enter).toEqual([1])
	})

	it('applies leave hysteresis — a shown object survives just past the enter radius', () => {
		// 105m away, r=100 → outside enter radius (not entered if unsent), but inside the
		// leave band (100 * 1.15 = 115) → a shown object is NOT killed. Prevents boundary flap.
		const cache = new Map<number, ObjLike>([
			[1, { localId: 1, parentId: 0, pos: [205, 100, 20] }],
		])
		expect(reconcileInterest(cache, new Set(), cam, 100).enter).toEqual([])      // unsent: not entered
		expect(reconcileInterest(cache, new Set([1]), cam, 100).leave).toEqual([])   // sent: not killed yet
		// well past the band (120m, > 115) → killed
		const far = new Map<number, ObjLike>([[1, { localId: 1, parentId: 0, pos: [220, 100, 20] }]])
		expect(reconcileInterest(far, new Set([1]), cam, 100).leave).toEqual([1])
	})

	it('keeps a child whose root is in range, drops a child whose root is out', () => {
		const cache = new Map<number, ObjLike>([
			[1, { localId: 1, parentId: 0, pos: [105, 100, 20] }],            // root in range
			[2, { localId: 2, parentId: 1, pos: [0.5, 0, 1] }],               // its child
			[3, { localId: 3, parentId: 0, pos: [400, 100, 20] }],            // root out
			[4, { localId: 4, parentId: 3, pos: [0.5, 0, 1] }],               // its child
		])
		const { enter } = reconcileInterest(cache, new Set(), cam, 96)
		expect(enter.sort()).toEqual([1, 2])
	})
})

describe('clampRadius', () => {
	it('clamps to [R_MIN, R_MAX]', () => {
		expect(clampRadius(10)).toBe(R_MIN)
		expect(clampRadius(99999)).toBe(R_MAX)
		expect(clampRadius(96)).toBe(96)
	})
	it('rejects non-finite values to R_MIN', () => {
		expect(clampRadius(NaN)).toBe(R_MIN)
		expect(clampRadius(undefined as unknown as number)).toBe(R_MIN)
	})
})

describe('resolveRadius', () => {
	it('uses the clamped client radius when provided', () => {
		expect(resolveRadius(120)).toBe(120)
		expect(resolveRadius(5)).toBe(R_MIN)
	})
	it('falls back to the env/default radius when client radius is absent', () => {
		expect(resolveRadius(undefined)).toBe(96)
	})
})
