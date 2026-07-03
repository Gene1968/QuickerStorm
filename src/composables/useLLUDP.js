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

	function sendSit(targetId) {
		emit(C.OBJECT_SIT, { targetId })
	}

	function sendSelect(localIds) {
		const ids = Array.isArray(localIds) ? localIds : [localIds]
		emit(C.OBJECT_SELECT, { localIds: ids })
	}

	function sendDeselect(localIds) {
		const ids = Array.isArray(localIds) ? localIds : [localIds]
		emit(C.OBJECT_DESELECT, { localIds: ids })
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

	return { sendMove, sendChat, sendLogout, sendIM, sendTouch, sendSit, sendSelect, sendDeselect, sendRename, sendDescription, sendDelete, takeObject, takeObjectCopy, purgeInventoryFolder, sendSetAlwaysRun, sendMapQuery, sendMapNameQuery, sendMapTeleport }
}
