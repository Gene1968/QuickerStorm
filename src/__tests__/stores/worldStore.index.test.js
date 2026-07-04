import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorldStore, PCODE_AVATAR, PCODE_PRIM } from '@/stores/worldStore'

beforeEach(() => setActivePinia(createPinia()))

const ids = (list) => list.map(o => o.localId).sort((a, b) => a - b)

describe('worldStore avatars/prims incremental index', () => {
	it('upsertObject routes objects into the right per-kind list', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_AVATAR })
		s.upsertObject({ localId: 2, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 3, pcode: PCODE_PRIM })
		expect(ids(s.avatars)).toEqual([1])
		expect(ids(s.prims)).toEqual([2, 3])
	})

	it('removeObject drops from the index', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_AVATAR })
		s.upsertObject({ localId: 2, pcode: PCODE_PRIM })
		s.removeObject(2)
		expect(ids(s.prims)).toEqual([])
		expect(ids(s.avatars)).toEqual([1])
	})

	it('clearAll empties both indexes', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_AVATAR })
		s.upsertObject({ localId: 2, pcode: PCODE_PRIM })
		s.clearAll()
		expect(s.avatars).toEqual([])
		expect(s.prims).toEqual([])
		expect(s.objects.size).toBe(0)
	})

	it('updateObjectPos keeps the kind and exposes the updated record via the index', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_AVATAR, pos: [0, 0, 0] })
		s.updateObjectPos(1, [5, 6, 7])
		expect(ids(s.avatars)).toEqual([1])
		expect(s.avatars[0].pos).toEqual([5, 6, 7])     // index holds the live merged record
	})

	it('applyObjectProperties (matched by fullId) updates the indexed record', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_PRIM, fullId: 'ABC-123' })
		const hit = s.applyObjectProperties({ fullId: 'abc-123', name: 'Crate' })
		expect(hit).toBe(true)
		expect(s.prims[0].name).toBe('Crate')          // index reflects merged props
	})

	it('applyObjectProperties merges via the _byFullId index (exact-case hit) and keeps perms', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 4, pcode: PCODE_PRIM, fullId: 'exact-case' })
		const hit = s.applyObjectProperties({ fullId: 'exact-case', ownerMask: 0x4000, name: 'Box' })
		expect(hit).toBe(true)
		expect(s.objects.get(4).ownerMask).toBe(0x4000)
	})

	it('applyObjectProperties returns false for an unknown fullId', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 4, pcode: PCODE_PRIM, fullId: 'aaa' })
		expect(s.applyObjectProperties({ fullId: 'zzz', name: 'Ghost' })).toBe(false)
		expect(s.applyObjectProperties({ name: 'no fullId at all' })).toBe(false)
	})

	it('reconciles when an objects pcode changes kind (avatar → prim)', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_AVATAR })
		expect(ids(s.avatars)).toEqual([1])
		s.upsertObject({ localId: 1, pcode: PCODE_PRIM })   // same localId, now a prim
		expect(ids(s.avatars)).toEqual([])                  // moved out of avatars
		expect(ids(s.prims)).toEqual([1])                   // ...and into prims
	})

	it('non-avatar/non-prim pcode is in neither index', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: 1 })            // e.g. a tree/grass PCode
		expect(s.avatars).toEqual([])
		expect(s.prims).toEqual([])
		expect(s.objects.size).toBe(1)                      // still tracked in objects
	})
})

describe('fullId index', () => {
	it('localIdForFullId returns the localId of an upserted prim', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 5, fullId: 'aaa', pcode: PCODE_PRIM })
		expect(s.localIdForFullId('aaa')).toBe(5)
	})
	it('does not index avatars', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 7, fullId: 'av1', pcode: PCODE_AVATAR })
		expect(s.localIdForFullId('av1')).toBeUndefined()
	})
	it('removeObject clears the fullId entry', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 5, fullId: 'aaa', pcode: PCODE_PRIM })
		s.removeObject(5)
		expect(s.localIdForFullId('aaa')).toBeUndefined()
	})
	it('removeObject of a stale localId does not clobber a fullId reclaimed by a newer localId', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 5, fullId: 'aaa', pcode: PCODE_PRIM })
		s.upsertObject({ localId: 9, fullId: 'aaa', pcode: PCODE_PRIM })   // reclaim
		expect(s.localIdForFullId('aaa')).toBe(9)
		s.removeObject(5)                                                  // remove OLD localId
		expect(s.localIdForFullId('aaa')).toBe(9)                         // index untouched
	})
})

// PACKAGE A: linkset link-order tracking (FS mChildList semantics — arrival order, not localId
// order; link numbers per llfloatertools.cpp:623-647).
describe('linkset link-order tracking', () => {
	it('linksetMembers returns [root, ...children] in ARRIVAL order (not localId order)', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })                 // root
		s.upsertObject({ localId: 99, parentId: 10, pcode: PCODE_PRIM })   // 1st child (high localId)
		s.upsertObject({ localId: 11, parentId: 10, pcode: PCODE_PRIM })   // 2nd child (low localId)
		expect(s.linksetMembers(10)).toEqual([10, 99, 11])
	})

	it('resolves any MEMBER id to the same list', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, parentId: 10, pcode: PCODE_PRIM })
		expect(s.linksetMembers(20)).toEqual([10, 20])
	})

	it('ids with no store record pass through unexpanded', () => {
		const s = useWorldStore()
		expect(s.linksetMembers(777)).toEqual([777])
	})

	it('re-upsert of a child (partial update, same parent) does not duplicate it', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, parentId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, pos: [1, 2, 3] })                    // update omits parentId
		s.upsertObject({ localId: 20, parentId: 10 })                      // update repeats parentId
		expect(s.linksetMembers(10)).toEqual([10, 20])
	})

	it('reparent moves the child: removed from old parent, appended to new', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 30, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, parentId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 31, parentId: 30, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, parentId: 30 })                      // reparent 10 → 30
		expect(s.linksetMembers(10)).toEqual([10])
		expect(s.linksetMembers(30)).toEqual([30, 31, 20])                 // appended AFTER 31
	})

	it('removeObject cleans the parent list and the removed root’s own child list', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, parentId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 21, parentId: 10, pcode: PCODE_PRIM })
		s.removeObject(20)
		expect(s.linksetMembers(10)).toEqual([10, 21])
		s.removeObject(10)                                                 // root gone → own list dropped
		expect(s.linksetMembers(10)).toEqual([10])
	})

	it('clearAll drops link tracking', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
		s.upsertObject({ localId: 20, parentId: 10, pcode: PCODE_PRIM })
		s.clearAll()
		s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
		expect(s.linksetMembers(10)).toEqual([10])
	})

	it('linkset with an avatar parent (attachment) roots at the attached prim, not the avatar', () => {
		const s = useWorldStore()
		s.upsertObject({ localId: 1, pcode: PCODE_AVATAR })
		s.upsertObject({ localId: 10, parentId: 1, pcode: PCODE_PRIM })    // attached root
		s.upsertObject({ localId: 20, parentId: 10, pcode: PCODE_PRIM })
		expect(s.linksetMembers(20)).toEqual([10, 20])                     // stops below the avatar
	})

	describe('linkNumberOf (llfloatertools.cpp:623-647 convention)', () => {
		it('childless standalone prim → 0', () => {
			const s = useWorldStore()
			s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
			expect(s.linkNumberOf(10)).toBe(0)
		})
		it('root of a linkset → 1; children → 2+ in arrival order', () => {
			const s = useWorldStore()
			s.upsertObject({ localId: 10, pcode: PCODE_PRIM })
			s.upsertObject({ localId: 99, parentId: 10, pcode: PCODE_PRIM })
			s.upsertObject({ localId: 11, parentId: 10, pcode: PCODE_PRIM })
			expect(s.linkNumberOf(10)).toBe(1)
			expect(s.linkNumberOf(99)).toBe(2)
			expect(s.linkNumberOf(11)).toBe(3)
		})
		it('unknown id → 0', () => {
			const s = useWorldStore()
			expect(s.linkNumberOf(777)).toBe(0)
		})
	})
})
