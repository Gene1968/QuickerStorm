/**
 * shared/protocol.js — WebSocket envelope types for quickerSTORM LLUDP bridge.
 * Imported by Bun server and Vue client.
 * Convention: client→server and server→client messages use { t, d } envelope.
 */

// ── Client → Server ─────────────────────────────────────────────────────
export const C = {
	LOGIN:         'login',         // { grid, username, password }
	LOGOUT:        'logout',        // {}
	MOVE:          'move',          // { controlFlags, bodyRot, headRot, camCenter, camAt, camLeft, camUp, far }
	CHAT:          'chat',          // { message, type, channel }
	CAPS_FETCH:    'caps_fetch',    // { url, method, body? } — CORS proxy
	TELEPORT:      'teleport',      // { x, y, z } — same-region teleport via LocationBar coord edit
	REBAKE:        'rebake',        // {} — trigger RebakeAvatarTextures cap (Avatar Health → Force Appearance Update)
	CHECK_CIRCUIT: 'check_circuit', // { grid, username } — is my circuit still alive on server?
	RESYNC_WORLD:  'resync_world',  // {} — replay cached region/terrain/spawn snapshot, nudge sim for ObjectUpdates
	IM_SEND:       'im_send',       // { toAgentId, toAgentName, fromAgentName, message } — outbound IM via ImprovedInstantMessage
	OBJECT_TOUCH:  'object_touch',  // { localId } — outbound ObjectGrab + ObjectDeGrab pair
	OBJECT_SIT:    'object_sit',    // { targetId } — outbound AgentRequestSit + AgentSit pair
	OBJECT_SELECT: 'object_select', // { localIds: number[] } — outbound ObjectSelect → triggers ObjectProperties reply
	OBJECT_DESELECT:'object_deselect', // { localIds: number[] } — outbound ObjectDeselect
	SET_ALWAYS_RUN: 'set_always_run', // { alwaysRun: boolean } — outbound SetAlwaysRun (Low #21)
	CLIENT_DIAG:    'client_diag',    // { received, stored, prims, av, meshes, upsertFails } — periodic mesh-side stats forwarded to server-log
	MAP_QUERY:      'map_query',      // { minX, maxX, minY, maxY } — MapBlockRequest range
	MAP_NAME_QUERY: 'map_name_query', // { name } — MapNameRequest by region name
	MAP_TELEPORT:   'map_teleport',   // { regionX, regionY, x, y, z } — TeleportLocationRequest to (regionX*256+x,...)
	TP_LANDMARK:    'tp_landmark',     // { landmarkId } — TeleportLandmarkRequest (Low 65); sim resolves the LM asset's location
	TP_HOME:        'tp_home',         // {} — TeleportLandmarkRequest with zero UUID; sim sends avatar to stored home position
	SET_HOME:       'set_home',        // { regionName, x, y, z } — SetStartLocationRequest (Low 204) LocationID=1
	INV_FETCH_FOLDER: 'inv_fetch_folder', // { folderId } or { folderIds:[] } — fetch folder item(s) via FetchInventoryDescendents2 cap (batched)
	CREATE_LANDMARK:  'create_landmark',  // { name, desc, folderId } — CreateInventoryItem (Low 305) type/invType=3; sim builds LM from current pos
	CREATE_INV_FOLDER:'create_inv_folder',// { folderId, parentId, name } — CreateInventoryFolder (Low 273); client supplies the new folderId
	// ── Social (Phase 3) ──
	AVATAR_PROPS_REQ: 'avatar_props_req', // { avatarId } — AvatarPropertiesRequest (Low 169); sim replies Properties/Interests/Groups
	PARCEL_INFO_REQ:  'parcel_info_req',  // { parcelId } — ParcelInfoRequest (Low 54)
	FRIEND_OFFER:     'friend_offer',     // { toAgentId, toAgentName, message } — ImprovedInstantMessage dialog 38
	FRIEND_RESPOND:   'friend_respond',   // { transactionId, accept:boolean, folderId? } — Accept(297)/Decline(298)Friendship
	FRIEND_REMOVE:    'friend_remove',    // { agentId } — TerminateFriendship (Low 300)
	FRIEND_RIGHTS:    'friend_rights',    // { agentId, rights:number } — ChangeUserRights (Low 321)
	NAME_REQ:         'name_req',         // { ids:string[] } — UUIDNameRequest (Low 235) → resolve avatar UUIDs to names
}

// ── Server → Client ─────────────────────────────────────────────────────
export const S = {
	LOGIN_OK:     'login_ok',   // { agentId, sessionId, simIp, simPort, seedCap, regionName, inventoryRoot, inventorySkeleton:[{folderId,parentId,name,typeDefault,version}], inventoryLibRoot, inventorySkeletonLib }
	LOGIN_FAIL:   'login_fail', // { message }
	OBJECT_UPDATE:'obj_upd',    // { objects: [{ localId, fullId, pcode, pos, rot, scale, nameValue, parentId, shape, defaultColor?, faceColors? }] }
	TERSE_UPDATE: 'terse_upd', // { objects: [{ localId, pos:[x,y,z] }] } — position-only sim updates
	CHAT_MSG:     'chat_msg',   // { fromName, sourceId, type, channel, message, pos }
	REGION_INFO:  'region',     // { name, handle, waterHeight }
	TELEPORT_OK:     'tp_ok',      // { regionName, seedCap }
	TELEPORT_FINISH: 'tp_finish',  // { simIp, simPort, regionHandle, seedCap, simAccess } — cross-region TP
	CAPS_RESULT:  'caps_result',// { id, status, body }
	ERROR:        'error',      // { code, message }
	DEBUG:        'debug',      // { level:'info'|'warn'|'error', msg: string } — server log forwarded to browser
	DISCONNECTED:    'disconnected',   // { reason: string } — sim killed the circuit
	AGENT_SPAWN_POS: 'spawn_pos',     // { pos: [slX, slY, slZ] } — AgentMovementComplete confirmed position
	KILL_OBJECT:     'kill_obj',      // { ids: number[] } — sim removed these localIds from scene
	TERRAIN_PATCH:   'terrain_patch', // { layerType:'LAND'|'WATER', patchSize:16, patches:[{x,y,heights:number[]}] }
	CIRCUIT_STATUS:  'circuit_status',// { alive: boolean } — response to CHECK_CIRCUIT
	IM_RECV:         'im_recv',       // { fromAgentId, fromAgentName, toAgentId, dialog, message, timestamp } — incoming IM
	OBJECT_PROPS:    'object_props',  // { items: [{ fullId, creatorId, ownerId, name, description, ... }] } — sim's ObjectProperties reply
	MAP_BLOCKS:      'map_blocks',    // { blocks: [{ regionX, regionY, name, access, regionFlags, waterHeight, agents, mapImageId }] }
	CAPS_READY:      'caps_ready',    // { caps: string[] } — HTTP cap names available after seed-cap fetch
	INV_FOLDER:      'inv_folder',    // { folderId, items: [{ itemId, parentId, name, desc, assetType, invType, assetId, flags }], error? } — FetchInventoryDescendents2 reply
	INV_ITEM_CREATED:'inv_item_created', // { items: [{ itemId, parentId, assetId, name, desc, assetType, invType, flags, ownerMask }] } — UpdateCreateInventoryItem (Low 267)
	// ── Social (Phase 3) ──
	// SOCIAL_INIT data is folded into LOGIN_OK under d.social (resume-safe) — no separate message.
	FRIEND_STATUS:   'friend_status',  // { online:boolean, ids:string[] } — Online/OfflineNotification
	SELF_GROUPS:     'self_groups',    // { groups:[{ id, name, insignia, powers, acceptNotices, contribution }] } — AgentGroupDataUpdate
	AGENT_DATA:      'agent_data',     // { activeGroupId, groupTitle, groupName, groupPowers } — AgentDataUpdate
	AVATAR_PROPS:    'avatar_props',   // { avatarId, properties?, interests?, groups? } — AvatarProperties/Interests/GroupsReply
	PARCEL_INFO:     'parcel_info',    // { parcel:{ parcelId, ownerId, name, desc, actualArea, globalX, globalY, globalZ, simName, snapshotId, dwell, salePrice } } — ParcelInfoReply
	NAME_REPLY:      'name_reply',    // { names: { [uuid]: "First Last" } } — UUIDNameReply
}

// ── WebRTC voice signaling (keep for proximity voice) ───────────────────
export const SIG = {
	OFFER:        'offer',
	ANSWER:       'answer',
	ICE:          'ice',
	PEER_JOINED:  'peer-joined',
	PEER_LEFT:    'peer-left',
}
