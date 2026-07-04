// src/utils/objectPermissions.js — SL object-permission constants + selection helpers.
// A-owned file (2026-07-03 batch, PACKAGE A). B (edit floater) and C (menu gating) import from
// here — do NOT redefine these bits elsewhere; ObjectEditFloater's old inline shifts were off by
// one (M/C/T mapped to 13/14/15 instead of 14/15/13).
//
// Constants verified against Firestorm indra/llinventory/llpermissionsflags.h:
//   PERM_TRANSFER = 1<<13 (line 40), PERM_MODIFY = 1<<14 (line 44), PERM_COPY = 1<<15 (line 47),
//   PERM_EXPORT = 1<<16 (line 50), PERM_MOVE = 1<<19 (line 64), PERM_ALL = 0x7FFFFFFF (line 73).
// Perm-field U8 enum (the `Field` byte of ObjectPermissions Low 105, message_template.msg:2285):
//   llpermissionsflags.h:80-85 — PERM_BASE 0x01, PERM_OWNER 0x02, PERM_GROUP 0x04,
//   PERM_EVERYONE 0x08, PERM_NEXT_OWNER 0x10.
import { PCODE_AVATAR } from '@/stores/worldStore'
import { linksetRootLocalId } from '@/utils/linksetRoot'

export const PERM_TRANSFER = 0x2000   // 1<<13
export const PERM_MODIFY   = 0x4000   // 1<<14
export const PERM_COPY     = 0x8000   // 1<<15
export const PERM_EXPORT   = 0x10000  // 1<<16
export const PERM_MOVE     = 0x80000  // 1<<19
export const PERM_ALL      = 0x7fffffff

// Which mask an ObjectPermissions packet edits (Field U8). Named PF_* to avoid clashing with the
// PERM_* bit constants above (FS overloads the PERM_ prefix for both).
export const PF_BASE       = 0x01
export const PF_OWNER      = 0x02
export const PF_GROUP      = 0x04
export const PF_EVERYONE   = 0x08
export const PF_NEXT_OWNER = 0x10

// Zero UUID — "no owner yet" / unset id fields.
const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

const sameId = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/**
 * Aggregate one permission bit across a selection — port of FS LLSelectMgr::selectGetPerm
 * (llselectmgr.cpp:4219): AND-accumulate and OR-accumulate the masks over all records; a bit set
 * in the AND ⇒ on everywhere, clear in the OR ⇒ off everywhere, otherwise mixed. Any record whose
 * mask is missing (ObjectProperties not yet arrived — FS's !node->mValid) ⇒ 'unknown'.
 *
 * @param {Array<Object>} records   object records (worldStore.objects values)
 * @param {string} maskField        'baseMask'|'ownerMask'|'groupMask'|'everyoneMask'|'nextOwnerMask'
 * @param {number} bit              PERM_* bit to test
 * @returns {'on'|'off'|'mixed'|'unknown'}
 */
export function aggregateBit(records, maskField, bit) {
	if (!records?.length) return 'unknown'
	let and = 0xffffffff
	let or = 0
	for (const rec of records) {
		const mask = rec?.[maskField]
		if (mask == null) return 'unknown'
		and &= mask
		or |= mask
	}
	if (and & bit) return 'on'
	if (!(or & bit)) return 'off'
	return 'mixed'
}

/**
 * Is this object (any member id) an avatar attachment? True when the linkset root's parentId
 * resolves to a PCODE_AVATAR record, or the root's NameValue carries AttachItemID (FS reads the
 * same pair — llviewerobject.cpp:2084,7686 getNVPair("AttachItemID")).
 * @param {Map<number,Object>} objects  worldStore.objects
 */
export function isAttachment(objects, localId) {
	const root = linksetRootLocalId(objects, localId)
	const rec = objects.get(root)
	if (!rec) return false
	if (rec.parentId && objects.get(rec.parentId)?.pcode === PCODE_AVATAR) return true
	return typeof rec.nameValue === 'string' && rec.nameValue.includes('AttachItemID')
}

/**
 * Client-side prediction of OpenSim's CanTakeObject (PermissionsModule.cs:1963) — the
 * no-god / no-friend-rights / no-group-powers approximation (those layers need sim-side state we
 * don't have; the sim stays authoritative and useTakeWatch toasts silent refusals):
 *   !isAttachment && (owner === agent || (everyoneMask has TRANSFER && MODIFY))
 * @returns {boolean|null}  null = perms not yet known (caller maps null → enabled per convention)
 */
export function canTakeObject(objects, localId, agentId) {
	const root = linksetRootLocalId(objects, localId)
	const rec = objects.get(root)
	if (!rec) return null
	if (isAttachment(objects, root)) return false          // PermissionsModule.cs:1973 — never take attachments
	if (rec.ownerId == null || rec.ownerId === ZERO_UUID) return null   // ObjectProperties not arrived
	if (sameId(rec.ownerId, agentId)) return true
	if (rec.everyoneMask == null) return null
	return (rec.everyoneMask & PERM_TRANSFER) !== 0 && (rec.everyoneMask & PERM_MODIFY) !== 0
}

/**
 * Client-side prediction of OpenSim's CanTakeCopyObject (PermissionsModule.cs:2004), same
 * approximation as canTakeObject:
 *   !isAttachment && (owner === agent ? ownerMask has COPY : everyoneMask has COPY && TRANSFER)
 * @returns {boolean|null}  null = perms not yet known
 */
export function canTakeCopyObject(objects, localId, agentId) {
	const root = linksetRootLocalId(objects, localId)
	const rec = objects.get(root)
	if (!rec) return null
	if (isAttachment(objects, root)) return false          // PermissionsModule.cs:2013
	if (rec.ownerId == null || rec.ownerId === ZERO_UUID) return null
	if (sameId(rec.ownerId, agentId)) {
		if (rec.ownerMask == null) return null
		return (rec.ownerMask & PERM_COPY) !== 0            // PermissionsModule.cs:2016-2021
	}
	if (rec.everyoneMask == null) return null
	return (rec.everyoneMask & PERM_COPY) !== 0 && (rec.everyoneMask & PERM_TRANSFER) !== 0   // :2017,2023
}
