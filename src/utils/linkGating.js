// src/utils/linkGating.js — Link / Unlink menu gating (PACKAGE 4, 2026-07-13 batch).
// Client-side prediction of FS LLSelectMgr::enableLinkObjects (llselectmgr.cpp:877-916) /
// enableUnlinkObjects (llselectmgr.cpp:918-937), reusing objectPermissions.js's aggregate
// helper (repo precedent: takeGating.js layers the same way over objectPermissions.js).
// Convention (matches takeGating's A-CONTRACT): unknown perms/owner (ObjectProperties not yet
// arrived) → PERMISSIVE — the sim stays authoritative. OpenSim's link/delink failures are
// SILENT (Scene.Inventory.cs:3032-3072 log-only) — there is no ack to watch for, so (unlike
// Take's useTakeWatch) there is no watchdog here; a refusal that slips past this gate is a
// dead click, same as any other silent-refusal surface in this codebase.
import { aggregateBit, PERM_MODIFY, isAttachment } from '@/utils/objectPermissions'
import { linksetRootLocalId } from '@/utils/linksetRoot'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

/** Resolve a list of localIds to their DISTINCT linkset roots, first-seen order preserved (so
 *  ids[0] — the "newest"/primary selection by uiStore convention — puts its root first). */
function resolveRoots(objects, ids) {
	const roots = []
	const seen = new Set()
	for (const id of ids) {
		if (id == null) continue
		const root = linksetRootLocalId(objects, id)
		if (!seen.has(root)) { seen.add(root); roots.push(root) }
	}
	return roots
}

// Do any two KNOWN owners differ? Objects whose ObjectProperties hasn't arrived (ownerId
// missing/zero) are skipped, matching the "unknown → allow" convention — FS's own
// selectGetOwner (llselectmgr.cpp:806-813) only fires CannotLinkDifferentOwners once it has
// resolved a definite owner for the selection, not merely "some props are still missing".
function ownersKnownDifferent(objects, ids) {
	let owner
	for (const id of ids) {
		const o = objects.get(id)?.ownerId
		if (!o || o === ZERO_UUID) continue
		if (owner === undefined) owner = o.toLowerCase()
		else if (owner !== o.toLowerCase()) return true
	}
	return false
}

/**
 * Gate for Build ▸ Link / ObjectContextMenu's Link row.
 * @param {Map<number,Object>} objects   worldStore.objects
 * @param {Array<number|null|undefined>} ids   selection, primary first ([editObjectId, ...selectedObjectIds])
 * @returns {{ disabled: boolean, title: string|undefined, reason: 'differentOwners'|null, roots: number[] }}
 */
export function canLinkGate(objects, ids) {
	const roots = resolveRoots(objects, ids || [])
	// FS CannotLinkIncompleteSet (llselectmgr.cpp:786-790): need ≥2 roots. No client-side toast
	// for this one — the row is simply disabled (matches the package note: no invented toasts
	// beyond the different-owners case).
	if (roots.length < 2) {
		return { disabled: true, title: 'Select two or more objects to link', reason: null, roots }
	}
	// FS enableLinkObjects tests permModify per selected object (llselectmgr.cpp:888-898, first-
	// match-fails). aggregateBit's AND/OR/unknown fold gives the same "any prop still missing ⇒
	// unknown ⇒ permissive" behavior takeGating.js already relies on for Take/Take-copy.
	const modState = aggregateBit(roots.map((id) => objects.get(id)), 'ownerMask', PERM_MODIFY)
	if (modState === 'off' || modState === 'mixed') {
		return { disabled: true, title: "You don't have modify permission on all the objects", reason: null, roots }
	}
	if (ownersKnownDifferent(objects, roots)) {
		// FS CannotLinkDifferentOwners (llselectmgr.cpp:804-813 / notifications.xml:2305-2308).
		return { disabled: true, title: 'Not all of the objects have the same owner', reason: 'differentOwners', roots }
	}
	return { disabled: false, title: undefined, reason: null, roots }
}

/**
 * Gate for Build ▸ Unlink / ObjectContextMenu's Unlink row.
 * @param {Map<number,Object>} objects
 * @param {(id:number) => number[]} linksetMembersFn   worldStore.linksetMembers
 * @param {Array<number|null|undefined>} ids   every currently-relevant localId
 * @returns {{ disabled: boolean, title: string|undefined }}
 */
export function canUnlinkGate(objects, linksetMembersFn, ids) {
	const list = (ids || []).filter((id) => id != null)
	if (!list.length) return { disabled: true, title: undefined }
	// FS enableUnlinkObjects requires the (first) editable object be part of a linkset with >1
	// member (llselectmgr.cpp:920-926, getRootEdit/mChildList). linksetMembers([root,...children])
	// has length 1 for a childless standalone prim.
	const inLinkset = list.some((id) => linksetMembersFn(id).length > 1)
	if (!inLinkset) return { disabled: true, title: 'Object is not part of a linked set' }
	// FS bails on attachments (llselectmgr.cpp:925 !first_editable_object->isAttachment()).
	if (list.some((id) => isAttachment(objects, id))) {
		return { disabled: true, title: "Attachments can't be unlinked" }
	}
	const modState = aggregateBit(list.map((id) => objects.get(id)), 'ownerMask', PERM_MODIFY)
	if (modState === 'off' || modState === 'mixed') {
		return { disabled: true, title: "You don't have modify permission on this object" }
	}
	return { disabled: false, title: undefined }
}
