// Truth tables for the object-permission helpers (PACKAGE A). The canTake* tables mirror
// OpenSim PermissionsModule.cs CanTakeObject (:1963) / CanTakeCopyObject (:2004) minus the
// god/friend-rights/group layers; aggregateBit ports FS LLSelectMgr::selectGetPerm
// (llselectmgr.cpp:4219).
import { describe, it, expect } from 'vitest'
import {
	PERM_TRANSFER, PERM_MODIFY, PERM_COPY, PERM_EXPORT, PERM_MOVE, PERM_ALL,
	PF_BASE, PF_OWNER, PF_GROUP, PF_EVERYONE, PF_NEXT_OWNER,
	aggregateBit, isAttachment, canTakeObject, canTakeCopyObject,
} from '@/utils/objectPermissions'
import { PCODE_PRIM, PCODE_AVATAR } from '@/stores/worldStore'

const AGENT = 'AAAAAAAA-1111-2222-3333-444444444444'
const OTHER = 'BBBBBBBB-1111-2222-3333-444444444444'
const ZERO  = '00000000-0000-0000-0000-000000000000'

const world = (...recs) => new Map(recs.map(r => [r.localId, { pcode: PCODE_PRIM, ...r }]))

describe('perm constants (llpermissionsflags.h:40-85)', () => {
	it('bit values match Firestorm', () => {
		expect(PERM_TRANSFER).toBe(1 << 13)
		expect(PERM_MODIFY).toBe(1 << 14)
		expect(PERM_COPY).toBe(1 << 15)
		expect(PERM_EXPORT).toBe(1 << 16)
		expect(PERM_MOVE).toBe(1 << 19)
		expect(PERM_ALL).toBe(0x7fffffff)
	})
	it('perm-field U8 enum matches Firestorm', () => {
		expect([PF_BASE, PF_OWNER, PF_GROUP, PF_EVERYONE, PF_NEXT_OWNER]).toEqual([0x01, 0x02, 0x04, 0x08, 0x10])
	})
})

describe('aggregateBit — FS selectGetPerm AND/OR accumulate', () => {
	const bit = PERM_MODIFY
	it('all records have the bit → on', () => {
		expect(aggregateBit([{ ownerMask: PERM_MODIFY | PERM_COPY }, { ownerMask: PERM_MODIFY }], 'ownerMask', bit)).toBe('on')
	})
	it('no record has the bit → off', () => {
		expect(aggregateBit([{ ownerMask: PERM_COPY }, { ownerMask: 0 }], 'ownerMask', bit)).toBe('off')
	})
	it('some on, some off → mixed', () => {
		expect(aggregateBit([{ ownerMask: PERM_MODIFY }, { ownerMask: 0 }], 'ownerMask', bit)).toBe('mixed')
	})
	it('any record missing the mask → unknown (even if others agree)', () => {
		expect(aggregateBit([{ ownerMask: PERM_MODIFY }, {}], 'ownerMask', bit)).toBe('unknown')
		expect(aggregateBit([{ ownerMask: null }], 'ownerMask', bit)).toBe('unknown')
	})
	it('empty / missing selection → unknown', () => {
		expect(aggregateBit([], 'ownerMask', bit)).toBe('unknown')
		expect(aggregateBit(undefined, 'ownerMask', bit)).toBe('unknown')
	})
	it('mask 0 is valid data, not unknown', () => {
		expect(aggregateBit([{ nextOwnerMask: 0 }], 'nextOwnerMask', bit)).toBe('off')
	})
})

describe('isAttachment', () => {
	it('root parented to an avatar → true', () => {
		const w = world({ localId: 1, pcode: PCODE_AVATAR }, { localId: 2, parentId: 1 })
		expect(isAttachment(w, 2)).toBe(true)
	})
	it('child of an attached root → true (resolves to root first)', () => {
		const w = world({ localId: 1, pcode: PCODE_AVATAR }, { localId: 2, parentId: 1 }, { localId: 3, parentId: 2 })
		expect(isAttachment(w, 3)).toBe(true)
	})
	it('nameValue AttachItemID → true (llviewerobject.cpp:2084)', () => {
		const w = world({ localId: 2, nameValue: 'AttachItemID STRING RW SV deadbeef' })
		expect(isAttachment(w, 2)).toBe(true)
	})
	it('plain in-world prim → false', () => {
		const w = world({ localId: 2, parentId: 0, nameValue: '' })
		expect(isAttachment(w, 2)).toBe(false)
	})
	it('unknown id → false', () => {
		expect(isAttachment(new Map(), 99)).toBe(false)
	})
})

// OpenSim CanTakeObject approximation (PermissionsModule.cs:1963):
// !attachment && (owner || (everyone TRANSFER && MODIFY))
describe('canTakeObject', () => {
	it('owner → true', () => {
		const w = world({ localId: 1, ownerId: AGENT, everyoneMask: 0 })
		expect(canTakeObject(w, 1, AGENT)).toBe(true)
	})
	it('owner compare is case-insensitive', () => {
		const w = world({ localId: 1, ownerId: AGENT.toLowerCase() })
		expect(canTakeObject(w, 1, AGENT)).toBe(true)
	})
	it('non-owner with everyone TRANSFER+MODIFY → true', () => {
		const w = world({ localId: 1, ownerId: OTHER, everyoneMask: PERM_TRANSFER | PERM_MODIFY })
		expect(canTakeObject(w, 1, AGENT)).toBe(true)
	})
	it('non-owner with everyone TRANSFER only → false', () => {
		const w = world({ localId: 1, ownerId: OTHER, everyoneMask: PERM_TRANSFER })
		expect(canTakeObject(w, 1, AGENT)).toBe(false)
	})
	it('non-owner, everyone mask 0 → false', () => {
		const w = world({ localId: 1, ownerId: OTHER, everyoneMask: 0 })
		expect(canTakeObject(w, 1, AGENT)).toBe(false)
	})
	it('attachment → false even for the owner (PermissionsModule.cs:1973)', () => {
		const w = world({ localId: 9, pcode: PCODE_AVATAR }, { localId: 1, parentId: 9, ownerId: AGENT })
		expect(canTakeObject(w, 1, AGENT)).toBe(false)
	})
	it('perms unknown (no ownerId yet) → null', () => {
		const w = world({ localId: 1 })
		expect(canTakeObject(w, 1, AGENT)).toBeNull()
	})
	it('zero-UUID owner → null (props not real yet)', () => {
		const w = world({ localId: 1, ownerId: ZERO })
		expect(canTakeObject(w, 1, AGENT)).toBeNull()
	})
	it('non-owner with ownerId but no everyoneMask → null', () => {
		const w = world({ localId: 1, ownerId: OTHER })
		expect(canTakeObject(w, 1, AGENT)).toBeNull()
	})
	it('no record at all → null', () => {
		expect(canTakeObject(new Map(), 1, AGENT)).toBeNull()
	})
	it('child id resolves to the ROOT record', () => {
		const w = world({ localId: 1, ownerId: OTHER, everyoneMask: 0 }, { localId: 2, parentId: 1, ownerId: AGENT })
		// root (1) is owned by OTHER with no everyone perms → false, even though the CHILD row says AGENT
		expect(canTakeObject(w, 2, AGENT)).toBe(false)
	})
})

// OpenSim CanTakeCopyObject approximation (PermissionsModule.cs:2004):
// !attachment && (owner ? ownerMask COPY : everyone COPY && TRANSFER)
describe('canTakeCopyObject', () => {
	it('owner with COPY → true', () => {
		const w = world({ localId: 1, ownerId: AGENT, ownerMask: PERM_COPY })
		expect(canTakeCopyObject(w, 1, AGENT)).toBe(true)
	})
	it('owner WITHOUT copy (no-copy item) → false', () => {
		const w = world({ localId: 1, ownerId: AGENT, ownerMask: PERM_MODIFY | PERM_TRANSFER })
		expect(canTakeCopyObject(w, 1, AGENT)).toBe(false)
	})
	it('non-owner with everyone COPY+TRANSFER → true', () => {
		const w = world({ localId: 1, ownerId: OTHER, everyoneMask: PERM_COPY | PERM_TRANSFER })
		expect(canTakeCopyObject(w, 1, AGENT)).toBe(true)
	})
	it('non-owner with everyone COPY but no TRANSFER → false (PermissionsModule.cs:2023)', () => {
		const w = world({ localId: 1, ownerId: OTHER, everyoneMask: PERM_COPY })
		expect(canTakeCopyObject(w, 1, AGENT)).toBe(false)
	})
	it('attachment → false (PermissionsModule.cs:2013)', () => {
		const w = world({ localId: 9, pcode: PCODE_AVATAR }, { localId: 1, parentId: 9, ownerId: AGENT, ownerMask: PERM_ALL })
		expect(canTakeCopyObject(w, 1, AGENT)).toBe(false)
	})
	it('owner but ownerMask unknown → null', () => {
		const w = world({ localId: 1, ownerId: AGENT })
		expect(canTakeCopyObject(w, 1, AGENT)).toBeNull()
	})
	it('non-owner but everyoneMask unknown → null', () => {
		const w = world({ localId: 1, ownerId: OTHER })
		expect(canTakeCopyObject(w, 1, AGENT)).toBeNull()
	})
	it('no record → null', () => {
		expect(canTakeCopyObject(new Map(), 1, AGENT)).toBeNull()
	})
})
