// PACKAGE C — takeGate/takeCopyGate view-model over the PACKAGE-A predicates. The underlying
// permission truth tables live in objectPermissions.test.js (OpenSim PermissionsModule.cs
// CanTakeObject :1963 / CanTakeCopyObject :2004); here we verify the boolean|null →
// { disabled, title } mapping the menu rows consume: only explicit `false` disables,
// `null`(unknown) stays ENABLED per the A-CONTRACT convention, and titles explain why.
import { describe, it, expect } from 'vitest'
import { takeGate, takeCopyGate } from '@/utils/takeGating'
import { PERM_TRANSFER, PERM_MODIFY, PERM_COPY } from '@/utils/objectPermissions'
import { PCODE_PRIM, PCODE_AVATAR } from '@/stores/worldStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'

const world = (...recs) => new Map(recs.map(r => [r.localId, { pcode: PCODE_PRIM, ...r }]))

describe('takeGate', () => {
	it('no target (menu closed / nothing selected) → enabled, no title', () => {
		expect(takeGate(world(), null, AGENT)).toEqual({ disabled: false, title: undefined })
		expect(takeGate(world(), undefined, AGENT)).toEqual({ disabled: false, title: undefined })
	})
	it('unknown perms (no record / props not arrived) → enabled per convention', () => {
		expect(takeGate(world(), 7, AGENT).disabled).toBe(false)                          // no record at all
		expect(takeGate(world({ localId: 7 }), 7, AGENT).disabled).toBe(false)            // ownerId absent
	})
	it('own object → enabled', () => {
		expect(takeGate(world({ localId: 7, ownerId: AGENT }), 7, AGENT).disabled).toBe(false)
	})
	it("other's object, everyone transfer+modify → enabled", () => {
		const w = world({ localId: 7, ownerId: OTHER, everyoneMask: PERM_TRANSFER | PERM_MODIFY })
		expect(takeGate(w, 7, AGENT).disabled).toBe(false)
	})
	it("other's object without everyone transfer+modify → disabled with ownership title", () => {
		const g = takeGate(world({ localId: 7, ownerId: OTHER, everyoneMask: 0 }), 7, AGENT)
		expect(g.disabled).toBe(true)
		expect(g.title).toBe("You don't own this object and it isn't transferable")
	})
	it('attachment → disabled with attachment title (even when owned)', () => {
		const w = world(
			{ localId: 1, pcode: PCODE_AVATAR },
			{ localId: 7, parentId: 1, ownerId: AGENT, nameValue: 'AttachItemID STRING RW SV deadbeef' },
		)
		const g = takeGate(w, 7, AGENT)
		expect(g.disabled).toBe(true)
		expect(g.title).toBe("Attachments can't be taken")
	})
	it('linkset child resolves to root perms', () => {
		const w = world(
			{ localId: 1, ownerId: OTHER, everyoneMask: 0 },
			{ localId: 2, parentId: 1 },
		)
		expect(takeGate(w, 2, AGENT).disabled).toBe(true)
	})
})

describe('takeCopyGate', () => {
	it('no target → enabled, no title', () => {
		expect(takeCopyGate(world(), null, AGENT)).toEqual({ disabled: false, title: undefined })
	})
	it('unknown perms → enabled per convention', () => {
		expect(takeCopyGate(world({ localId: 7, ownerId: AGENT }), 7, AGENT).disabled).toBe(false)   // ownerMask absent → null
	})
	it('own copyable object → enabled', () => {
		const w = world({ localId: 7, ownerId: AGENT, ownerMask: PERM_COPY })
		expect(takeCopyGate(w, 7, AGENT).disabled).toBe(false)
	})
	it('own NO-COPY object → disabled with copy title', () => {
		const g = takeCopyGate(world({ localId: 7, ownerId: AGENT, ownerMask: PERM_TRANSFER | PERM_MODIFY }), 7, AGENT)
		expect(g.disabled).toBe(true)
		expect(g.title).toBe('Object is not copyable')
	})
	it("other's object with everyone copy+transfer → enabled", () => {
		const w = world({ localId: 7, ownerId: OTHER, everyoneMask: PERM_COPY | PERM_TRANSFER })
		expect(takeCopyGate(w, 7, AGENT).disabled).toBe(false)
	})
	it("other's object copy-without-transfer → disabled with copy title", () => {
		const g = takeCopyGate(world({ localId: 7, ownerId: OTHER, everyoneMask: PERM_COPY }), 7, AGENT)
		expect(g.disabled).toBe(true)
		expect(g.title).toBe('Object is not copyable')
	})
	it('attachment → disabled with attachment title', () => {
		const w = world(
			{ localId: 1, pcode: PCODE_AVATAR },
			{ localId: 7, parentId: 1, ownerId: AGENT, ownerMask: PERM_COPY, nameValue: 'AttachItemID STRING RW SV deadbeef' },
		)
		const g = takeCopyGate(w, 7, AGENT)
		expect(g.disabled).toBe(true)
		expect(g.title).toBe("Attachments can't be taken")
	})
})
