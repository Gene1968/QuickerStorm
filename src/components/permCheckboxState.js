// src/components/permCheckboxState.js — pure view-model for the FS tri-state perm checkboxes
// (PACKAGE B, 2026-07-03). Maps aggregateBit() output (@/utils/objectPermissions.js) onto native
// <input type=checkbox> rendering, mirroring FS llpanelpermissions.cpp:986-1122 setValue/setTentative:
//   'on'      → checked; indeterminate + faded ONLY when `tentative` (FS sets tentative on a
//               uniformly-on bit in a few quirk cases — see helpers below)
//   'off'     → unchecked, never tentative (FS clears tentative on every off branch)
//   'mixed'   → checked + indeterminate + faded (FS setValue(true) + setTentative(true))
//   'unknown' → disabled + faded (ObjectProperties not yet arrived — FS !valid_*_perms)
// `canEdit=false` (not self-owned, or an FS base-mask gate fails) disables without hiding state.
import { PERM_COPY, PERM_TRANSFER, PERM_MODIFY, PERM_EXPORT, PERM_MOVE } from '@/utils/objectPermissions.js'

export function permCheckboxView(state, { tentative = false, canEdit = true } = {}) {
	const unknown = state == null || state === 'unknown'
	const checked = state === 'on' || state === 'mixed'
	const indeterminate = state === 'mixed' || (state === 'on' && !!tentative)
	return {
		checked,
		indeterminate,
		disabled: unknown || !canEdit,
		faded: unknown || indeterminate,
	}
}

// FS tentative quirks — derived from the AGENT's own rights on the selection (can_copy /
// can_transfer in LLPanelPermissions::updateUI), not from the bit being edited:
//   Next-owner Copy     → tentative when the agent lacks copy rights, even if the bit is
//                         uniformly on (llpanelpermissions.cpp:1093-1096 setTentative(!can_copy)).
//   Next-owner Transfer → tentative when the agent lacks transfer rights (:1110-1113).
//   Everyone Copy       → tentative when the agent lacks copy OR transfer rights (:1030-1033).
export function nextOwnerCopyTentative(ownerMask) {
	return !((ownerMask ?? 0) & PERM_COPY)
}
export function nextOwnerTransferTentative(ownerMask) {
	return !((ownerMask ?? 0) & PERM_TRANSFER)
}
export function everyoneCopyTentative(ownerMask) {
	return nextOwnerCopyTentative(ownerMask) || nextOwnerTransferTentative(ownerMask)
}

// FS enable gates for the Anyone row (llpanelpermissions.cpp:917-927). Given has_change_perm_ability
// (we approximate with self-owned, checked by the caller):
//   Anyone Move → owner mask must carry PERM_MOVE (:919)
//   Anyone Copy → owner mask must carry PERM_COPY AND PERM_TRANSFER (:920)
// Without these, toggling e.g. Anyone-Copy on a no-transfer object is a guaranteed sim refusal —
// and since the refetch returns identical masks, the optimistic checkbox would stick wrong.
export function everyoneMoveEditable(ownerMask) {
	return !!((ownerMask ?? 0) & PERM_MOVE)
}
export function everyoneCopyEditable(ownerMask) {
	const m = ownerMask ?? 0
	return !!(m & PERM_COPY) && !!(m & PERM_TRANSFER)
}

// FS OpenSim-export enable gate (llpanelpermissions.cpp:931-947): self_owned (caller) &&
// creator == owner && can_set_export(base, owner, next) — llpanelpermissions.cpp:83-86: base and
// owner masks must carry PERM_EXPORT and the next-owner mask must be fully PERM_ITEM_UNRESTRICTED
// (= MODIFY|COPY|TRANSFER, llpermissionsflags.h:75). FS additionally requires simSupportsExport and
// scans the object's task inventory + textures for exportability (:934-945) — both need data we
// don't stream yet (SimulatorFeatures, task inventory); the sim stays authoritative on those layers.
const PERM_ITEM_UNRESTRICTED = PERM_MODIFY | PERM_COPY | PERM_TRANSFER
export function everyoneExportEditable(rec) {
	const { creatorId, ownerId, baseMask, ownerMask, nextOwnerMask } = rec ?? {}
	if (!creatorId || !ownerId || creatorId.toLowerCase() !== ownerId.toLowerCase()) return false
	if (!((baseMask ?? 0) & PERM_EXPORT) || !((ownerMask ?? 0) & PERM_EXPORT)) return false
	return ((nextOwnerMask ?? 0) & PERM_ITEM_UNRESTRICTED) === PERM_ITEM_UNRESTRICTED
}

// FS Locked checkbox DISPLAY state (llpanelobject.cpp:644-663): keyed off PERM_MOVE on the OWNER
// mask — owner-can-move ⇒ not locked; owner-can't-move ⇒ locked. NOT PERM_MODIFY: a no-mod but
// movable object is unlocked. (onCommitLock :2585-2595 clears/sets PERM_MOVE|PERM_MODIFY together
// on PERM_OWNER, but the display test is PERM_MOVE alone.) null mask ⇒ null (props not arrived).
export function lockedFromOwnerMask(ownerMask) {
	if (ownerMask == null) return null
	return !(ownerMask & PERM_MOVE)
}
