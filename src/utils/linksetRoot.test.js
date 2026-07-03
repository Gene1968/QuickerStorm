// linksetRootLocalId — DeRezObject must reference the linkset ROOT; OpenSim silently skips
// child-prim ids (Scene.Inventory.cs:2258-2260). This resolver is what makes Take / Take copy /
// Delete work on multi-prim linked builds when the user clicked a child prim.

import { describe, it, expect } from 'vitest'
import { linksetRootLocalId } from '@/utils/linksetRoot'
import { PCODE_AVATAR } from '@/stores/worldStore'

const PRIM = 9

function world(entries) {
	return new Map(entries.map(o => [o.localId, o]))
}

describe('linksetRootLocalId', () => {
	it('returns the id itself for a root prim (parentId 0/undefined)', () => {
		const m = world([{ localId: 1, pcode: PRIM, parentId: 0 }])
		expect(linksetRootLocalId(m, 1)).toBe(1)
	})

	it('walks a child prim up to the linkset root (multi-level)', () => {
		const m = world([
			{ localId: 1, pcode: PRIM, parentId: 0 },
			{ localId: 2, pcode: PRIM, parentId: 1 },
			{ localId: 3, pcode: PRIM, parentId: 2 },
		])
		expect(linksetRootLocalId(m, 3)).toBe(1)
		expect(linksetRootLocalId(m, 2)).toBe(1)
	})

	it('does NOT ascend into an avatar parent (attachment / sat-on prim)', () => {
		const m = world([
			{ localId: 9, pcode: PCODE_AVATAR, parentId: 0 },
			{ localId: 5, pcode: PRIM, parentId: 9 },
		])
		expect(linksetRootLocalId(m, 5)).toBe(5)
	})

	it('stops at an unknown parent id (parent not in the map yet)', () => {
		const m = world([{ localId: 7, pcode: PRIM, parentId: 999 }])
		expect(linksetRootLocalId(m, 7)).toBe(7)
	})

	it('is cycle-safe on corrupt parent chains', () => {
		const m = world([
			{ localId: 1, pcode: PRIM, parentId: 2 },
			{ localId: 2, pcode: PRIM, parentId: 1 },
		])
		const out = linksetRootLocalId(m, 1)
		expect([1, 2]).toContain(out)   // terminates, returns something in the chain
	})
})
