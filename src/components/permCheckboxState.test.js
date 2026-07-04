// Tests for the FS tri-state perm-checkbox view-model (PACKAGE B).
// FS reference: llpanelpermissions.cpp:986-1122 setValue/setTentative branches.
import { describe, it, expect } from 'vitest'
import {
	permCheckboxView,
	nextOwnerCopyTentative,
	nextOwnerTransferTentative,
	everyoneCopyTentative,
	everyoneMoveEditable,
	everyoneCopyEditable,
	everyoneExportEditable,
	lockedFromOwnerMask,
} from './permCheckboxState.js'
import { PERM_COPY, PERM_TRANSFER, PERM_MODIFY, PERM_EXPORT, PERM_MOVE } from '@/utils/objectPermissions.js'

describe('permCheckboxView', () => {
	it("'on' → checked, no indeterminate, enabled, not faded", () => {
		expect(permCheckboxView('on')).toEqual({
			checked: true, indeterminate: false, disabled: false, faded: false,
		})
	})

	it("'off' → unchecked, enabled", () => {
		expect(permCheckboxView('off')).toEqual({
			checked: false, indeterminate: false, disabled: false, faded: false,
		})
	})

	it("'mixed' → checked + indeterminate + faded (FS setValue(true)+setTentative(true))", () => {
		expect(permCheckboxView('mixed')).toEqual({
			checked: true, indeterminate: true, disabled: false, faded: true,
		})
	})

	it("'unknown' → disabled + faded, unchecked", () => {
		expect(permCheckboxView('unknown')).toEqual({
			checked: false, indeterminate: false, disabled: true, faded: true,
		})
	})

	it('null/undefined state treated as unknown', () => {
		expect(permCheckboxView(null).disabled).toBe(true)
		expect(permCheckboxView(undefined).disabled).toBe(true)
	})

	it("FS quirk: 'on' + tentative → checked AND indeterminate + faded", () => {
		// llpanelpermissions.cpp:1093-1096 — Next-owner Copy tentative on a uniformly-on bit.
		expect(permCheckboxView('on', { tentative: true })).toEqual({
			checked: true, indeterminate: true, disabled: false, faded: true,
		})
	})

	it("'off' + tentative stays clean (FS clears tentative on every off branch)", () => {
		expect(permCheckboxView('off', { tentative: true })).toEqual({
			checked: false, indeterminate: false, disabled: false, faded: false,
		})
	})

	it("'mixed' + tentative is indeterminate regardless", () => {
		expect(permCheckboxView('mixed', { tentative: true }).indeterminate).toBe(true)
	})

	it('canEdit=false disables but still shows the state', () => {
		const v = permCheckboxView('on', { canEdit: false })
		expect(v.disabled).toBe(true)
		expect(v.checked).toBe(true)
		expect(v.indeterminate).toBe(false)
	})

	it('unknown wins over canEdit=true', () => {
		expect(permCheckboxView('unknown', { canEdit: true }).disabled).toBe(true)
	})
})

describe('FS tentative quirks (agent-rights driven)', () => {
	it('nextOwnerCopyTentative: tentative exactly when agent lacks COPY', () => {
		expect(nextOwnerCopyTentative(PERM_COPY)).toBe(false)
		expect(nextOwnerCopyTentative(PERM_COPY | PERM_TRANSFER)).toBe(false)
		expect(nextOwnerCopyTentative(PERM_TRANSFER)).toBe(true)     // no copy right
		expect(nextOwnerCopyTentative(PERM_MODIFY)).toBe(true)
		expect(nextOwnerCopyTentative(0)).toBe(true)
		expect(nextOwnerCopyTentative(null)).toBe(true)
		expect(nextOwnerCopyTentative(undefined)).toBe(true)
	})

	it('nextOwnerCopy quirk end-to-end: bit uniformly ON still renders tentative without copy rights', () => {
		// llpanelpermissions.cpp:1093-1096 — setValue(true) + setTentative(!can_copy)
		const view = permCheckboxView('on', { tentative: nextOwnerCopyTentative(PERM_TRANSFER) })
		expect(view.checked).toBe(true)
		expect(view.indeterminate).toBe(true)
		expect(view.faded).toBe(true)
		// ...and clean when the agent CAN copy
		const clean = permCheckboxView('on', { tentative: nextOwnerCopyTentative(PERM_COPY) })
		expect(clean.indeterminate).toBe(false)
		expect(clean.faded).toBe(false)
	})

	it('nextOwnerTransferTentative: tentative exactly when agent lacks TRANSFER (:1110-1113)', () => {
		expect(nextOwnerTransferTentative(PERM_TRANSFER)).toBe(false)
		expect(nextOwnerTransferTentative(PERM_COPY)).toBe(true)
		expect(nextOwnerTransferTentative(0)).toBe(true)
	})

	it('everyoneCopyTentative: tentative when agent lacks COPY OR TRANSFER (:1030-1033)', () => {
		expect(everyoneCopyTentative(PERM_COPY | PERM_TRANSFER)).toBe(false)
		expect(everyoneCopyTentative(PERM_COPY)).toBe(true)
		expect(everyoneCopyTentative(PERM_TRANSFER)).toBe(true)
		expect(everyoneCopyTentative(0)).toBe(true)
	})
})

describe('FS Anyone-row enable gates (llpanelpermissions.cpp:919-920)', () => {
	it('everyoneMoveEditable: needs owner PERM_MOVE (:919)', () => {
		expect(everyoneMoveEditable(PERM_MOVE)).toBe(true)
		expect(everyoneMoveEditable(PERM_MOVE | PERM_COPY)).toBe(true)
		expect(everyoneMoveEditable(PERM_COPY | PERM_TRANSFER)).toBe(false)
		expect(everyoneMoveEditable(0)).toBe(false)
		expect(everyoneMoveEditable(null)).toBe(false)
		expect(everyoneMoveEditable(undefined)).toBe(false)
	})

	it('everyoneCopyEditable: needs owner COPY AND TRANSFER (:920)', () => {
		expect(everyoneCopyEditable(PERM_COPY | PERM_TRANSFER)).toBe(true)
		expect(everyoneCopyEditable(PERM_COPY)).toBe(false)          // no-transfer → sim would refuse
		expect(everyoneCopyEditable(PERM_TRANSFER)).toBe(false)      // no-copy → sim would refuse
		expect(everyoneCopyEditable(PERM_MOVE | PERM_MODIFY)).toBe(false)
		expect(everyoneCopyEditable(0)).toBe(false)
		expect(everyoneCopyEditable(null)).toBe(false)
	})
})

describe('FS export enable gate (llpanelpermissions.cpp:931-947 + can_set_export :83-86)', () => {
	const AGENT = 'aaaaaaaa-1111-2222-3333-444444444444'
	const OTHER = 'bbbbbbbb-1111-2222-3333-444444444444'
	const UNRESTRICTED = PERM_MODIFY | PERM_COPY | PERM_TRANSFER   // PERM_ITEM_UNRESTRICTED, llpermissionsflags.h:75
	const exportable = {
		creatorId: AGENT, ownerId: AGENT,
		baseMask: PERM_EXPORT | UNRESTRICTED,
		ownerMask: PERM_EXPORT | UNRESTRICTED,
		nextOwnerMask: UNRESTRICTED,
	}

	it('creator==owner + base/owner EXPORT + next unrestricted → editable', () => {
		expect(everyoneExportEditable(exportable)).toBe(true)
	})

	it('creator != owner → NOT editable (:932 mCreatorID == mOwnerID)', () => {
		expect(everyoneExportEditable({ ...exportable, creatorId: OTHER })).toBe(false)
	})

	it('creator/owner compare is case-insensitive', () => {
		expect(everyoneExportEditable({ ...exportable, creatorId: AGENT.toUpperCase() })).toBe(true)
	})

	it('base or owner mask missing PERM_EXPORT → NOT editable (can_set_export :85)', () => {
		expect(everyoneExportEditable({ ...exportable, baseMask: UNRESTRICTED })).toBe(false)
		expect(everyoneExportEditable({ ...exportable, ownerMask: UNRESTRICTED })).toBe(false)
	})

	it('next-owner mask not fully MODIFY|COPY|TRANSFER → NOT editable (can_set_export :85)', () => {
		expect(everyoneExportEditable({ ...exportable, nextOwnerMask: PERM_COPY | PERM_TRANSFER })).toBe(false)
		expect(everyoneExportEditable({ ...exportable, nextOwnerMask: 0 })).toBe(false)
	})

	it('null/missing record or ids → NOT editable', () => {
		expect(everyoneExportEditable(null)).toBe(false)
		expect(everyoneExportEditable(undefined)).toBe(false)
		expect(everyoneExportEditable({})).toBe(false)
		expect(everyoneExportEditable({ ...exportable, ownerId: null })).toBe(false)
	})
})

describe('Locked display state (llpanelobject.cpp:644-663 — PERM_MOVE, not PERM_MODIFY)', () => {
	it('owner can move → NOT locked (:646-651)', () => {
		expect(lockedFromOwnerMask(PERM_MOVE)).toBe(false)
		expect(lockedFromOwnerMask(PERM_MOVE | PERM_MODIFY)).toBe(false)
	})

	it("owner can't move → locked (:652-657)", () => {
		expect(lockedFromOwnerMask(0)).toBe(true)
		expect(lockedFromOwnerMask(PERM_COPY | PERM_TRANSFER)).toBe(true)
	})

	it('no-mod but movable object is NOT locked (the old 0x4000/PERM_MODIFY test got this wrong)', () => {
		const noModMovable = (PERM_MOVE | PERM_COPY | PERM_TRANSFER) & ~PERM_MODIFY
		expect(lockedFromOwnerMask(noModMovable)).toBe(false)
	})

	it('modify set but move cleared → locked (PERM_MODIFY must not unlock)', () => {
		expect(lockedFromOwnerMask(PERM_MODIFY)).toBe(true)
	})

	it('mask unknown (props not arrived) → null', () => {
		expect(lockedFromOwnerMask(null)).toBe(null)
		expect(lockedFromOwnerMask(undefined)).toBe(null)
	})
})
