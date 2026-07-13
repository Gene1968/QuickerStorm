// src/composables/useLLUDP.js — client-side encoder: encode move/chat → WS → Bun → UDP
import { useRealtimeSocket } from './useRealtimeSocket'
import { useWorldStore } from '@/stores/worldStore'
import { armTakeWatch } from './useTakeWatch'
import { linksetRootLocalId } from '@/utils/linksetRoot'
import { C } from '@shared/protocol.js'

export function useLLUDP() {
	const { emit } = useRealtimeSocket()
	const world = useWorldStore()
	// DeRezObject (take / take-copy / delete) MUST reference the linkset ROOT — OpenSim silently
	// skips child-prim ids (Scene.Inventory.cs:2258-2260). Resolve every clicked prim to its root.
	const rootOf = (id) => linksetRootLocalId(world.objects, id)

	/**
	 * Send avatar movement update.
	 * @param {Object} p
	 * @param {number}   p.controlFlags  bitmask: 0x01=fwd,0x02=back,0x04=left,0x08=right,0x10=up,0x20=down
	 * @param {number[]} p.bodyRot       [x,y,z] quaternion components
	 * @param {number[]} p.headRot       [x,y,z]
	 * @param {number[]} p.camCenter     [x,y,z] world pos
	 * @param {number[]} p.camAt         [x,y,z] unit vector
	 * @param {number[]} p.camLeft       [x,y,z]
	 * @param {number[]} p.camUp         [x,y,z]
	 * @param {number}   p.far           view distance
	 * @param {number}   p.interestRadius  desired Bun-side interest radius (m); server clamps
	 */
	function sendMove(p) {
		emit(C.MOVE, p)
	}

	// WHY: server lludp.ts destructures chatType from msg.d — must match
	function sendChat(message, chatType = 1, channel = 0) {
		emit(C.CHAT, { message, chatType, channel })
	}

	function sendLogout() {
		emit(C.LOGOUT, {})
	}

	function sendIM(toAgentId, fromAgentName, message) {
		emit(C.IM_SEND, { toAgentId, fromAgentName, message })
	}

	function sendTouch(localId) {
		emit(C.OBJECT_TOUCH, { localId })
	}

	// offset = object-local click point (FS pick.mObjectOffset, sent verbatim in
	// AgentRequestSit TargetObject.Offset — llviewermenu.cpp:5990-5992). OpenSim uses it as the
	// free-sit position when the prim has no scripted sit target.
	function sendSit(targetId, offset) {
		emit(C.OBJECT_SIT, { targetId, offset: offset ?? [0, 0, 0] })
	}

	// Lightweight hover-driven props request (RequestObjectPropertiesFamily, Medium 5) — no
	// selection side effects. Feeds saleType/salePrice for the Buy hover pointer (FS fills
	// node->mSaleInfo the same way; reply consumer llselectmgr.cpp:6421-6481).
	function requestObjectPropsFamily(objectId) {
		emit(C.OBJECT_PROPS_FAMILY_REQ, { objectId })
	}

	// FS parity: a normal click selects the whole OBJECT — root + every child. OpenSim's SelectPrim
	// (Scene.PacketHandlers.cs:198-226) loops the ids we send and calls SendPropertiesToClient PER
	// PRIM, so expanding here is what gets per-part ObjectProperties for the whole linkset. Ids with
	// no store record pass through unexpanded (linksetMembers returns [id]). Dedupe across inputs.
	function expandLinksets(localIds) {
		const ids = Array.isArray(localIds) ? localIds : [localIds]
		const out = new Set()
		for (const id of ids) for (const m of world.linksetMembers(id)) out.add(m)
		return [...out]
	}

	function sendSelect(localIds) {
		emit(C.OBJECT_SELECT, { localIds: expandLinksets(localIds) })
	}

	function sendDeselect(localIds) {
		// Membership is recomputed at deselect time: if the linkset changed between select and
		// deselect, the difference stays sim-selected (rare, harmless — the sim clears selection
		// state on its own timers; FS tracks selection nodes instead, which we don't need yet).
		emit(C.OBJECT_DESELECT, { localIds: expandLinksets(localIds) })
	}

	// ObjectPermissions (Low 105, message_template.msg:2285) — flip PERM_* bits on one prim's
	// base/owner/group/everyone/nextOwner mask. FS path: llpanelpermissions.cpp:1319 onCommitPerm →
	// LLSelectMgr::selectionSetObjectPermissions. field = PF_* (see @/utils/objectPermissions.js),
	// set = turn bits on/off, mask = PERM_* bits. NO root resolution — perms apply to the prim ids
	// given (FS sends per selected object); callers pass the id(s) they mean.
	function sendObjectPerms(localId, field, set, mask) {
		emit(C.OBJECT_PERMS, { localId, field, set: !!set, mask })
	}

	function sendRename(localId, name) {
		emit(C.OBJECT_RENAME, { localId, name })
	}

	function sendDescription(localId, description) {
		emit(C.OBJECT_SET_DESC, { localId, description })
	}

	function sendDelete(localId) {
		emit(C.OBJECT_DELETE, { localId: rootOf(localId) })
	}

	// FS "Take": DeRezObject Destination=Take(4); destinationFolderId = FS's destination category
	// UUID (Objects folder default) — optional, sim re-resolves if omitted. armTakeWatch: OpenSim
	// refuses takes SILENTLY (no packet) — the watchdog toasts if no inventory ack arrives.
	function takeObject(localIds, destinationFolderId) {
		const ids = [...new Set((Array.isArray(localIds) ? localIds : [localIds]).map(rootOf))]
		emit(C.OBJECT_TAKE, { localIds: ids, destinationFolderId })
		armTakeWatch('Take')
	}

	// FS "Take Copy": DeRezObject Destination=TakeCopy(1); copy lands in Objects, original stays in world.
	function takeObjectCopy(localIds) {
		const ids = [...new Set((Array.isArray(localIds) ? localIds : [localIds]).map(rootOf))]
		emit(C.OBJECT_TAKE_COPY, { localIds: ids })
		armTakeWatch('Take copy')
	}

	// Empty Trash: PurgeInventoryDescendents — permanently deletes the folder's contents.
	function purgeInventoryFolder(folderId) {
		emit(C.INV_PURGE_FOLDER, { folderId })
	}

	// ── MultipleObjectUpdate (move/rotate/scale) ────────────────────────────
	// FS semantics (llselectmgr.cpp:4894 sendMultipleUpdate): whole-object edits go to linkset
	// ROOTS with UPD_LINKED_SETS; "Edit linked parts" sends the exact prim ids un-flagged.
	const toIds = (localIds) => Array.isArray(localIds) ? localIds : [localIds]
	const idsFor = (localIds, linked) =>
		linked ? [...new Set(toIds(localIds).map(rootOf))] : [...new Set(toIds(localIds))]
	// FS packs each object's CURRENT position alongside rotation/scale edits — fall back to the
	// store's last-known pos when the caller doesn't supply one.
	const posFor = (localId, position) => position ?? world.objects?.get(localId)?.pos ?? null

	/** Move prim(s): UPD_POSITION. position = [x,y,z] region-local metres.
	 *  linked=true targets whole linksets (ids resolved to roots, UPD_LINKED_SETS set). */
	function sendPosition(localIds, position, { linked = false } = {}) {
		const updates = idsFor(localIds, linked).map((localId) => ({ localId, position }))
		emit(C.OBJECT_MULTI_UPDATE, { updates, linked })
	}

	/** Resize prim(s): UPD_SCALE|UPD_POSITION — FS always sends scale WITH position
	 *  (llpanelobject.cpp:2236 sendScale) so the sim anchors the stretch. scale = [x,y,z] m.
	 *  uniform=true = uniform stretch (UPD_UNIFORM). position optional (store pos fallback). */
	function sendScale(localIds, scale, { position, linked = false, uniform = false } = {}) {
		const updates = idsFor(localIds, linked).map((localId) => {
			const pos = posFor(localId, position)
			return { localId, scale, ...(pos ? { position: pos } : {}) }
		})
		emit(C.OBJECT_MULTI_UPDATE, { updates, linked, uniform })
	}

	/** Rotate prim(s): UPD_ROTATION|UPD_POSITION — FS always sends rotation WITH position
	 *  (llpanelobject.cpp:2187 sendRotation). rotation = quaternion [x,y,z,w] (server packs to
	 *  3 floats, W dropped — llquaternion.cpp:919). position optional (store pos fallback). */
	function sendRotation(localIds, rotation, { position, linked = false } = {}) {
		const updates = idsFor(localIds, linked).map((localId) => {
			const pos = posFor(localId, position)
			return { localId, rotation, ...(pos ? { position: pos } : {}) }
		})
		emit(C.OBJECT_MULTI_UPDATE, { updates, linked })
	}

	// ── Build/edit wire (rez, link, texture, duplicate) ─────────────────────

	/** Rez a new prim — ObjectAdd (Medium 1). params matches C.OBJECT_ADD's d shape exactly
	 *  (raw floats; server quantizes per FS packProfileParams/packPathParams). Caller (Build
	 *  tool) supplies pcode/material/path+profile params/ray/scale/rotation. */
	function createPrim(params) {
		emit(C.OBJECT_ADD, params)
	}

	/** Build a linkset — ObjectLink (Low 115). FIRST id in localIds becomes the new root
	 *  (OpenSim LLClientView.cs:9317) — caller orders localIds so the intended new root is first
	 *  (uiStore convention: [editObjectId, ...selectedObjectIds] — newest selection first). */
	function sendLink(localIds) {
		emit(C.OBJECT_LINK, { localIds: toIds(localIds) })
	}

	/** Break a linkset apart — ObjectDelink (Low 116). */
	function sendDelink(localIds) {
		emit(C.OBJECT_DELINK, { localIds: toIds(localIds) })
	}

	/** Whole-TE replace on one object — ObjectImage (Low 96). faces = FULL per-face table
	 *  (shared/protocol.js C.OBJECT_SET_TEXTURE documents the face shape) — not a sparse patch;
	 *  the server rebuilds the entire TextureEntry blob from it. */
	function setObjectTexture(localId, faces, mediaUrl) {
		emit(C.OBJECT_SET_TEXTURE, { localId, faces, mediaUrl })
	}

	/** Copy object(s), offset by [x,y,z] region-local metres — ObjectDuplicate (Low 90). */
	function duplicateObjects(localIds, offset, duplicateFlags = 0) {
		emit(C.OBJECT_DUPLICATE, { localIds: toIds(localIds), offset, duplicateFlags })
	}

	// ── Task (prim) inventory ───────────────────────────────────────────────
	// Contents live per PRIM (not per linkset) — send the clicked prim's id unresolved; the
	// Edit floater's Content tab shows the selected prim's inventory, matching FS.
	/** Fetch a prim's contents; server answers TASK_INV { localId, taskId, serial, items } or
	 *  TASK_INV_EMPTY. Re-request after edits — the sim bumps `serial` per mutation. */
	function requestTaskInventory(localId) {
		emit(C.REQUEST_TASK_INV, { localId })
	}

	/** "Open" flow: copy/move ONE task-inventory item into agent folderId (MoveTaskInventory,
	 *  Low 288). Ack arrives as the usual inventory create/bulk-update messages. */
	function moveTaskInventory(localId, itemId, folderId) {
		emit(C.TASK_INV_MOVE, { localId, itemId, folderId })
	}

	function sendSetAlwaysRun(alwaysRun) {
		emit(C.SET_ALWAYS_RUN, { alwaysRun: !!alwaysRun })
	}

	function sendMapQuery(minX, maxX, minY, maxY) {
		emit(C.MAP_QUERY, { minX, maxX, minY, maxY })
	}

	function sendMapNameQuery(name) {
		emit(C.MAP_NAME_QUERY, { name })
	}

	function sendMapTeleport(regionX, regionY, x, y, z) {
		emit(C.MAP_TELEPORT, { regionX, regionY, x, y, z })
	}

	// ── Right-click-menu wire (sit/buy/pay/group-invite) ──────────────────
	// Thin wrappers: no client-side resolution (group/category ids, price validation, etc.) —
	// the sim is authoritative and refusals surface via ALERT_MESSAGE / silent no-op (see
	// shared/protocol.js C.OBJECT_BUY / C.PAY_MONEY comments for OpenSim stock-module caveats).

	/** "Buy" on a for-sale object — ObjectBuy (Low 102), single object only (FS parity). */
	function buyObject({ localId, saleType, salePrice, categoryId }) {
		emit(C.OBJECT_BUY, { localId, saleType, salePrice, categoryId })
	}

	/** "Pay" — MoneyTransferRequest (Low 311). transactionType: see TRANS in shared/protocol.js
	 *  (TRANS.GIFT for Pay Resident, TRANS.PAY_OBJECT for paying an object/vendor). */
	function payMoney({ destId, amount, transactionType, description, isDestGroup }) {
		emit(C.PAY_MONEY, { destId, amount, transactionType, description, isDestGroup })
	}

	/** MoneyBalanceRequest (Low 313) — sim answers S.MONEY_BALANCE. */
	function requestMoneyBalance() {
		emit(C.MONEY_BALANCE_REQ, {})
	}

	/** Invite one or more agents to a group — InviteGroupRequest (Low 349). roleId defaults
	 *  sim-side to the Everyone role when omitted. */
	function inviteToGroup({ groupId, inviteeIds, roleId }) {
		emit(C.GROUP_INVITE, { groupId, inviteeIds, roleId })
	}

	return { sendMove, sendChat, sendLogout, sendIM, sendTouch, sendSit, sendSelect, sendDeselect, sendObjectPerms, sendRename, sendDescription, sendDelete, takeObject, takeObjectCopy, purgeInventoryFolder, sendPosition, sendScale, sendRotation, createPrim, sendLink, sendDelink, setObjectTexture, duplicateObjects, requestTaskInventory, moveTaskInventory, sendSetAlwaysRun, sendMapQuery, sendMapNameQuery, sendMapTeleport, buyObject, payMoney, requestMoneyBalance, inviteToGroup, requestObjectPropsFamily }
}
