// PACKAGE 4 — canLinkGate/canUnlinkGate view-model over objectPermissions.js's aggregateBit,
// ports FS LLSelectMgr::enableLinkObjects (llselectmgr.cpp:877-916) / enableUnlinkObjects
// (llselectmgr.cpp:918-937). Unknown perms/owner → enabled (A-CONTRACT convention, same as
// takeGating.test.js).
import { describe, it, expect } from 'vitest'
import { canLinkGate, canUnlinkGate } from '@/utils/linkGating'
import { PERM_MODIFY } from '@/utils/objectPermissions'
import { PCODE_PRIM, PCODE_AVATAR } from '@/stores/worldStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

const world = (...recs) => new Map(recs.map(r => [r.localId, { pcode: PCODE_PRIM, ...r }]))

// Minimal linksetMembers stand-in: [root, ...children] by parentId, mirroring worldStore's
// contract (length 1 = childless standalone prim).
function membersFn(objects) {
	return (localId) => {
		let root = localId
		const seen = new Set()
		while (!seen.has(root)) {
			seen.add(root)
			const p = objects.get(root)?.parentId
			if (!p || objects.get(p)?.pcode === PCODE_AVATAR) break
			root = p
		}
		const children = [...objects.values()].filter((o) => o.parentId === root).map((o) => o.localId)
		return [root, ...children]
	}
}

describe('canLinkGate', () => {
	it('fewer than 2 roots → disabled, no toast reason', () => {
		expect(canLinkGate(world(), []).disabled).toBe(true)
		expect(canLinkGate(world({ localId: 1 }), [1]).disabled).toBe(true)
		expect(canLinkGate(world({ localId: 1 }), [1]).reason).toBe(null)
	})
	it('2 distinct roots, unknown perms/owner → enabled', () => {
		const w = world({ localId: 1 }, { localId: 2 })
		expect(canLinkGate(w, [1, 2]).disabled).toBe(false)
	})
	it('selecting two prims from the SAME linkset collapses to 1 root → disabled', () => {
		const w = world({ localId: 1 }, { localId: 2, parentId: 1 })
		expect(canLinkGate(w, [1, 2]).disabled).toBe(true)
	})
	it('known no-modify on one root → disabled, no toast reason', () => {
		const w = world({ localId: 1, ownerMask: PERM_MODIFY }, { localId: 2, ownerMask: 0 })
		const g = canLinkGate(w, [1, 2])
		expect(g.disabled).toBe(true)
		expect(g.reason).toBe(null)
	})
	it('known-different owners → ENABLED with differentOwners reason (FS refuses at invoke, not enable — llselectmgr.cpp:804-813 vs enableLinkObjects :877-916)', () => {
		const w = world({ localId: 1, ownerId: AGENT }, { localId: 2, ownerId: OTHER })
		const g = canLinkGate(w, [1, 2])
		expect(g.disabled).toBe(false)
		expect(g.reason).toBe('differentOwners')
	})
	it('same known owner → enabled', () => {
		const w = world({ localId: 1, ownerId: AGENT }, { localId: 2, ownerId: AGENT })
		expect(canLinkGate(w, [1, 2]).disabled).toBe(false)
	})
	it('roots array puts ids[0]s root first (new-root ordering)', () => {
		const w = world({ localId: 1 }, { localId: 2 })
		expect(canLinkGate(w, [2, 1]).roots).toEqual([2, 1])
	})
})

describe('canUnlinkGate', () => {
	it('empty selection → disabled', () => {
		expect(canUnlinkGate(world(), membersFn(world()), []).disabled).toBe(true)
	})
	it('standalone prim (no children) → disabled, not-linked title', () => {
		const w = world({ localId: 1 })
		const g = canUnlinkGate(w, membersFn(w), [1])
		expect(g.disabled).toBe(true)
		expect(g.title).toBe('Object is not part of a linked set')
	})
	it('root of a multi-prim linkset, unknown perms → enabled', () => {
		const w = world({ localId: 1 }, { localId: 2, parentId: 1 })
		expect(canUnlinkGate(w, membersFn(w), [1]).disabled).toBe(false)
	})
	it('child of a multi-prim linkset → enabled', () => {
		const w = world({ localId: 1 }, { localId: 2, parentId: 1 })
		expect(canUnlinkGate(w, membersFn(w), [2]).disabled).toBe(false)
	})
	it('attachment → disabled', () => {
		const w = world(
			{ localId: 9, pcode: PCODE_AVATAR },
			{ localId: 1, parentId: 9, nameValue: 'AttachItemID STRING RW SV deadbeef' },
			{ localId: 2, parentId: 1 },
		)
		expect(canUnlinkGate(w, membersFn(w), [1]).disabled).toBe(true)
	})
	it('known no-modify → disabled', () => {
		const w = world({ localId: 1, ownerMask: 0 }, { localId: 2, parentId: 1 })
		expect(canUnlinkGate(w, membersFn(w), [1]).disabled).toBe(true)
	})
})
