import { describe, it, expect } from 'bun:test'
import { selectEvictions, selectReloads, groupChildrenByRoot, drawDistanceMayGrow, orderByDistance, selectVisibility, shouldEvictForBudget, shouldAutoRebuild } from '@/lib/cullPolicy.js'

// FEATURE-GAPS #13: the draw-distance governor must only GROW the radius when BOTH app-budget AND heap
// have headroom — the old recovery (appRatio-only) grew dd back every tick even under heap pressure.
// NOTE: shrinking/eviction is driven by the VRAM/app budget (+ genuine heap crisis), NOT moderate heap
// pressure — evicting resident assets doesn't relieve garbage-heap, it just churns the visible scene.
describe('heap-aware draw-distance recovery gate (#13)', () => {
	it('may grow ONLY when app AND heap both have headroom', () => {
		expect(drawDistanceMayGrow(0.40, 0.50, 0.85, 0.68)).toBe(true)    // both clear → grow
		expect(drawDistanceMayGrow(0.40, 0.90, 0.85, 0.68)).toBe(false)   // heap pressure blocks growth (THE FIX)
		expect(drawDistanceMayGrow(0.90, 0.50, 0.85, 0.68)).toBe(false)   // app pressure blocks growth
		expect(drawDistanceMayGrow(0.40, null, 0.85, 0.68)).toBe(true)    // no heap signal → app gate only
	})
})

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

describe('orderByDistance', () => {
	it('orders ids ascending by distFn (nearest first)', () => {
		const dist = new Map([[1, 30], [2, 200], [3, 10], [4, 96]])
		expect(orderByDistance([1, 2, 3, 4], id => dist.get(id))).toEqual([3, 1, 4, 2])
	})
	it('ids whose distFn returns Infinity sort last', () => {
		const dist = new Map([[1, Infinity], [2, 5], [3, Infinity], [4, 50]])
		expect(orderByDistance([1, 2, 3, 4], id => dist.get(id))).toEqual([2, 4, 1, 3])
	})
	it('empty → []', () => {
		expect(orderByDistance([], () => 0)).toEqual([])
	})
	it('single id → [id]', () => {
		expect(orderByDistance([7], () => 42)).toEqual([7])
	})
	it('does not mutate the input array', () => {
		const ids = [3, 1, 2]
		orderByDistance(ids, id => id)
		expect(ids).toEqual([3, 1, 2])
	})
})

// FEATURE-GAPS #13 (render ceiling): the render-distance visibility cull hides root meshes beyond the
// governor radius _effNear (decoupled from memory eviction) so far objects stop being traversed every
// frame. Pure decision: distance-only with a hysteresis dead-zone; the engine pre-filters protected ids
// (avatars/own/edited) and passes each root's current .visible so only CHANGES are emitted.
describe('selectVisibility (#13 render-distance cull)', () => {
	it('hides currently-visible roots beyond effNear', () => {
		const cands = [{ id: 1, dist: 300, visible: true }, { id: 2, dist: 50, visible: true }]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [1] })
	})
	it('shows currently-hidden roots within (effNear - hysteresis)', () => {
		const cands = [{ id: 1, dist: 50, visible: false }, { id: 2, dist: 300, visible: false }]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [1], hide: [] })
	})
	it('hysteresis dead-zone: roots between (effNear - hyst) and effNear keep their state (no churn)', () => {
		// effNear=192, hyst=16 → dead zone (176, 192]
		const cands = [
			{ id: 1, dist: 185, visible: true },   // visible in band → stays visible (not re-hidden)
			{ id: 2, dist: 185, visible: false },  // hidden in band → stays hidden (not re-shown)
		]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('emits ONLY state changes (already-correct roots omitted)', () => {
		const cands = [
			{ id: 1, dist: 50, visible: true },    // near + already visible → no-op
			{ id: 2, dist: 300, visible: false },  // far + already hidden → no-op
		]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('boundary: dist exactly == effNear is NOT hidden (strict >)', () => {
		const cands = [{ id: 1, dist: 192, visible: true }]
		expect(selectVisibility(cands, 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('empty candidates → {show:[], hide:[]}', () => {
		expect(selectVisibility([], 192, 16)).toEqual({ show: [], hide: [] })
	})
	it('does not mutate the input array', () => {
		const cands = [{ id: 1, dist: 300, visible: true }, { id: 2, dist: 50, visible: false }]
		selectVisibility(cands, 192, 16)
		expect(cands.map(c => c.id)).toEqual([1, 2])
	})
})

describe('shouldEvictForBudget', () => {
	// Eviction/texture-prune/draw-distance step-down must trigger ONLY on the resident/VRAM budget
	// (appRatio), never on raw process heap — evicting resident assets cannot relieve heap held by
	// transient garbage/backlog. The signature deliberately omits any heap parameter (regression guard
	// against re-introducing `|| emergencyHeap()`).
	it('evicts when the resident budget is exceeded', () => {
		expect(shouldEvictForBudget(1.01, 1.0)).toBe(true)
		expect(shouldEvictForBudget(2.0, 1.0)).toBe(true)
	})

	it('does NOT evict at or under the resident budget', () => {
		expect(shouldEvictForBudget(1.0, 1.0)).toBe(false)
		expect(shouldEvictForBudget(0.05, 1.0)).toBe(false)   // app 5% — the heap-99%/app-5% collapse case
	})
})

describe('shouldAutoRebuild', () => {
	// The auto-rebuild re-queues every object; it must NOT fire while intake is intentionally paused by
	// the heap brake (a paused scene is not a dead scene). Fires only on a real dead-scene signal.
	it('fires when dead-scan threshold is reached and NOT under pressure', () => {
		expect(shouldAutoRebuild(3, 3, false)).toBe(true)
		expect(shouldAutoRebuild(5, 3, false)).toBe(true)
	})

	it('does NOT fire while under memory pressure (paused, not dead)', () => {
		expect(shouldAutoRebuild(3, 3, true)).toBe(false)
		expect(shouldAutoRebuild(99, 3, true)).toBe(false)
	})

	it('does NOT fire below the dead-scan threshold', () => {
		expect(shouldAutoRebuild(2, 3, false)).toBe(false)
		expect(shouldAutoRebuild(0, 3, false)).toBe(false)
	})
})
