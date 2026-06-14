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
