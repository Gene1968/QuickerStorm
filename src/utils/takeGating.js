// src/utils/takeGating.js — shared Take / Take-copy menu gating (2026-07-03 batch, PACKAGE C).
// Thin view-model over objectPermissions' canTakeObject/canTakeCopyObject: maps the tri-state
// boolean|null predicate to a { disabled, title } pair for menu rows (ObjectContextMenu +
// MenuBar's two Take surfaces).
//
// Convention (A-CONTRACT): predicate `null` = ObjectProperties not yet arrived → row stays
// ENABLED (the sim is the authority; useTakeWatch toasts silent refusals). Only an explicit
// `false` disables, and `title` then explains why.
//
// References — the client-side prediction mirrors:
//   FS enable_take               llviewermenu.cpp:6900
//   FS enable_object_take_copy   llviewermenu.cpp:10871
//   OpenSim CanTakeObject        PermissionsModule.cs:1963 (attachment bail :1973)
//   OpenSim CanTakeCopyObject    PermissionsModule.cs:2004 (attachment bail :2013)
// (helpers implement the no-god/no-friend/no-group approximation — see objectPermissions.js)
import { canTakeObject, canTakeCopyObject, isAttachment } from '@/utils/objectPermissions'

const ENABLED = Object.freeze({ disabled: false, title: undefined })

/**
 * Gate for a "Take" row targeting `localId` (any linkset member id; helpers resolve the root).
 * @param {Map<number,Object>} objects  worldStore.objects
 * @param {number|null|undefined} localId
 * @param {string} agentId
 * @returns {{ disabled: boolean, title: string|undefined }}
 */
export function takeGate(objects, localId, agentId) {
	if (localId == null) return ENABLED
	if (canTakeObject(objects, localId, agentId) !== false) return ENABLED   // true OR null(unknown) → enabled
	return {
		disabled: true,
		title: isAttachment(objects, localId)
			? "Attachments can't be taken"
			: "You don't own this object and it isn't transferable",
	}
}

/**
 * Gate for a "Take copy" row targeting `localId`.
 * @returns {{ disabled: boolean, title: string|undefined }}
 */
export function takeCopyGate(objects, localId, agentId) {
	if (localId == null) return ENABLED
	if (canTakeCopyObject(objects, localId, agentId) !== false) return ENABLED
	return {
		disabled: true,
		title: isAttachment(objects, localId)
			? "Attachments can't be taken"
			: 'Object is not copyable',
	}
}
