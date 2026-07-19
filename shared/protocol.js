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
	OBJECT_RENAME:  'object_rename',  // { localId, name } — outbound ObjectName (Low 107)
	OBJECT_SET_DESC:'object_set_desc',// { localId, description } — outbound ObjectDescription (Low 108)
	OBJECT_PERMS:   'object_perms',   // { localId, field, set, mask } — outbound ObjectPermissions (Low 105): field=PF_* U8 (which mask), set=bool (bits on/off), mask=PERM_* U32 bits. Sim replies nothing — client re-selects to refetch ObjectProperties
	OBJECT_DELETE:  'object_delete',  // { localId } — outbound ObjectDelete (Low 89), Force=false
	OBJECT_TAKE:    'object_take',    // { localIds: number[], destinationFolderId } — outbound DeRezObject Destination=Take(4); FS passes the destination category UUID (llviewermenu.cpp confirm_take)
	OBJECT_TAKE_COPY:'object_take_copy',// { localIds: number[] } — outbound DeRezObject Destination=TakeCopy(1); OpenSim resolves the Objects folder itself so no DestinationID needed
	OBJECT_MULTI_UPDATE:'object_multi_update', // { updates:[{ localId, position?:[x,y,z], rotation?:[x,y,z,w], scale?:[x,y,z] }], linked?, uniform? } — outbound MultipleObjectUpdate (Medium 2): move/rotate/scale prims. Field presence per update sets the UPD_* type bits server-side (llselectmgr.h:60); linked = whole-linkset (send ROOT ids), uniform = uniform scale
	OBJECT_SHAPE:     'object_shape',        // { updates:[{ localId, pathCurve, profileCurve, pathBegin, pathEnd, pathScaleX, pathScaleY, pathShearX, pathShearY, pathTwist, pathTwistBegin, pathRadiusOffset, pathTaperX, pathTaperY, pathRevolutions, pathSkew, profileBegin, profileEnd, profileHollow }] } — outbound ObjectShape (Low 98, message_template.msg:2143-2171): edit a prim's path/profile params (Object-tab shape spinners). RAW FLOATS (volume-params space, same convention as OBJECT_ADD) — server quantizes per the shared encodeObjectAdd quantizer helpers. Per-PRIM (no root resolution — a linkset child edits its own shape). Multi-object capable; server chunks at 25 blocks/packet (same MTU budget as OBJECT_MULTI_UPDATE).
	// ── Build/edit wire (rez, link, texture, duplicate) ──
	OBJECT_ADD:       'object_add',       // { pcode, material, addFlags, pathCurve, profileCurve, pathBegin, pathEnd, pathScaleX, pathScaleY, pathShearX, pathShearY, pathTwist, pathTwistBegin, pathRadiusOffset, pathTaperX, pathTaperY, pathRevolutions, pathSkew, profileBegin, profileEnd, profileHollow, bypassRaycast, rayStart:[x,y,z], rayEnd:[x,y,z], rayTargetId, rayEndIsIntersection, scale:[x,y,z], rotation:[x,y,z,w], state } — outbound ObjectAdd (Medium 1); raw floats, server quantizes (FS llvolumemessage.cpp packProfileParams/packPathParams)
	OBJECT_LINK:      'object_link',      // { localIds:[u32,...] } — outbound ObjectLink (Low 115); FIRST id becomes the new linkset root (OpenSim LLClientView.cs:9317)
	OBJECT_DELINK:    'object_delink',    // { localIds:[u32,...] } — outbound ObjectDelink (Low 116)
	OBJECT_SET_TEXTURE:'object_set_texture', // { localId, faces:[{ textureId, color:[r,g,b,a 0..1], repeatU, repeatV, offsetU, offsetV, rotation, bump, shiny, fullbright, mediaFlags, texGen, glow, materialId }...], mediaUrl? } — outbound ObjectImage (Low 96): FULL per-face table, whole-TE replace (OpenSim SceneObjectPart.cs:5118)
	OBJECT_DUPLICATE:  'object_duplicate', // { localIds:[u32,...], offset:[x,y,z], duplicateFlags } — outbound ObjectDuplicate (Low 90)
	REQUEST_TASK_INV: 'request_task_inv', // { localId } — outbound RequestTaskInventory (Low 289); server runs ReplyTaskInventory → Xfer → parse and answers TASK_INV / TASK_INV_EMPTY
	TASK_INV_MOVE:    'task_inv_move',    // { localId, itemId, folderId } — outbound MoveTaskInventory (Low 288): copy/move ONE prim-inventory item into agent folderId ("Open" flow); sim acks via UpdateCreateInventoryItem/BulkUpdateInventory
	SET_ALWAYS_RUN: 'set_always_run', // { alwaysRun: boolean } — outbound SetAlwaysRun (Low 88)
	CLIENT_DIAG:    'client_diag',    // { received, stored, prims, av, meshes, upsertFails } — periodic mesh-side stats forwarded to server-log
	CLIENT_LOG:     'client_log',     // { level, msg, stack } — dev: forward matched console errors/warns (e.g. NaN) to server-log
	MAP_QUERY:      'map_query',      // { minX, maxX, minY, maxY } — MapBlockRequest range
	MAP_NAME_QUERY: 'map_name_query', // { name } — MapNameRequest by region name
	MAP_TELEPORT:   'map_teleport',   // { regionX, regionY, x, y, z } — TeleportLocationRequest to (regionX*256+x,...)
	TP_LANDMARK:    'tp_landmark',     // { landmarkId } — TeleportLandmarkRequest (Low 65); sim resolves the LM asset's location
	TP_HOME:        'tp_home',         // {} — TeleportLandmarkRequest with zero UUID; sim sends avatar to stored home position
	SET_HOME:       'set_home',        // { regionName, x, y, z } — SetStartLocationRequest (Low 324) LocationID=1
	INV_FETCH_FOLDER: 'inv_fetch_folder', // { folderId } or { folderIds:[] } — fetch folder item(s) via FetchInventoryDescendents2 cap (batched)
	ASSET_FETCH:      'asset_fetch',      // { assetType:'texture'|'mesh'|'sound'|..., uuid, full? } — fetch via ViewerAsset/GetTexture/GetMesh cap (server transcodes J2C→WebP). full=true → texture decoded at FULL resolution (no downscale cap) for the preview floater
	MATERIAL_FETCH:   'material_fetch',   // { kind:'pbr'|'legacy', ids:string[] } — fetch GLTF (ViewerAsset) or legacy (RenderMaterials cap)
	MESH_FETCH:       'mesh_fetch',       // { meshId, lod } — fetch + decode a mesh asset at LOD 0..3 (high..lowest) → geometry arrays
	SCULPT_FETCH:     'sculpt_fetch',     // { sculptId, sculptType } — fetch sculpt-map texture (J2C) → sculpt geometry
	CREATE_LANDMARK:  'create_landmark',  // { name, desc, folderId } — CreateInventoryItem (Low 305) type/invType=3; sim builds LM from current pos
	CREATE_INV_ITEM:  'create_inv_item',  // { kind:'notecard'|'script', name, desc?, folderId } — CreateInventoryItem (Low 305) with type/invType per kind (notecard 7/7, script 10/10), zero TransactionID → sim mints an empty default asset + item; reply forwarded as S.INV_ITEM_CREATED. Content is saved separately via ASSET_UPLOAD (UpdateNotecard/ScriptAgentInventory)
	CREATE_INV_FOLDER:'create_inv_folder',// { folderId, parentId, name } — CreateInventoryFolder (Low 273); client supplies the new folderId
	ASSET_UPLOAD:     'asset_upload',     // { id, mode:'update'|'new', kind:'notecard'|'script'|..., dataB64, itemId? (update), name?/desc?/folderId? (new) } — 2-step HTTP-cap upload. mode 'update' → UpdateNotecard/ScriptAgentInventory (save bytes into an existing item); mode 'new' → NewFileAgentInventory (fresh asset+item from bytes). Reply S.ASSET_UPLOAD_RESULT keyed by id. See docs/superpowers/specs/2026-07-15-asset-upload-notecard-script-design.md
	// ── Inventory writes (rename/move/delete/perms/wear) ──
	INV_RENAME_ITEM:    'inv_rename_item',    // { itemId, folderId, name } — MoveInventoryItem / UpdateInventoryItem rename in place
	INV_RENAME_FOLDER:  'inv_rename_folder',  // { folderId, name } — UpdateInventoryFolder rename
	INV_MOVE_ITEM:      'inv_move_item',      // { itemId, toFolderId, newName? } — MoveInventoryItem (newName? = rename-on-move)
	INV_MOVE_FOLDER:    'inv_move_folder',    // { folderId, toParentId } — MoveInventoryFolder
	COPY_INV_ITEM:      'copy_inv_item',      // { oldItemId, newFolderId, newName? } — CopyInventoryItem (Low 269); sim mints new ItemID, acks via BulkUpdateInventory
	INV_TRASH_ITEM:     'inv_trash_item',     // { itemId } — delete = MoveInventoryItem into Trash; server resolves Trash via skeleton (client may also pass trashFolderId)
	INV_TRASH_FOLDER:   'inv_trash_folder',   // { folderId } — delete = MoveInventoryFolder into Trash
	INV_PURGE_ITEM:     'inv_purge_item',     // { itemId } — permanent RemoveInventoryItem (empty-trash); encoder+handler wired, UI may leave hidden
	INV_PURGE_FOLDER:   'inv_purge_folder',   // { folderId } — outbound PurgeInventoryDescendents (Low 285): permanently delete a folder's CONTENTS (Empty Trash — the folder itself survives)
	INV_REMOVE_FOLDER:  'inv_remove_folder',  // { folderId } — permanent RemoveInventoryFolder (Low 272): delete the folder ROW itself (single-folder purge in Trash; send after INV_PURGE_FOLDER cleared its contents)
	INV_UPDATE_PERMS:   'inv_update_perms',   // { itemId, folderId, nextOwnerMask, everyoneMask?, groupMask? } — UpdateInventoryItem permission change
	INV_WEAR_ATTACHMENT:'inv_wear_attachment',// { itemId, attachPoint? } — RezSingleAttachmentFromInv (attachPoint 0 = default)
	INV_DETACH:         'inv_detach',         // { itemId } — detach attached object back to inventory
	REZ_OBJECT:         'rez_object',         // { itemId, folderId, position:{x,y,z}, name, description, assetType, invType, flags, saleType, salePrice, creationDate, creatorId, ownerId, groupId, baseMask, ownerMask, groupMask, everyoneMask, nextOwnerMask } — RezObject (Low 293); server holds no inventory so client sends the full InventoryData row (same fields as INV_UPDATE_PERMS). position = drop point in region coords; server rezzes AT it (BypassRaycast=1, RayEnd=position). removeItem defaults to !copyable
	// ── Social (Phase 3) ──
	AVATAR_PROPS_REQ: 'avatar_props_req', // { avatarId } — AvatarPropertiesRequest (Low 169); sim replies Properties/Interests/Groups
	PARCEL_INFO_REQ:  'parcel_info_req',  // { parcelId } — ParcelInfoRequest (Low 54)
	FRIEND_OFFER:     'friend_offer',     // { toAgentId, toAgentName, message } — ImprovedInstantMessage dialog 38
	FRIEND_RESPOND:   'friend_respond',   // { transactionId, accept:boolean, folderId? } — Accept(297)/Decline(298)Friendship
	IM_OFFER_REPLY:   'im_offer_reply',   // { imId, accept:boolean, fromAgentId, offerDialog, destFolderId? } — reply to inventory offer via ImprovedInstantMessage (accept=offer+1, decline=offer+2; accept bucket=destFolderId UUID, decline bucket empty)
	GIVE_INVENTORY:   'give_inventory',   // { toAgentId, itemId, assetType, name } — offer an inventory ITEM to another agent via ImprovedInstantMessage dialog 4 (IM_INVENTORY_OFFERED); fresh messageId (giver owns the tx), bucket=[assetType byte]+item UUID (LLGiveInventory::commitGiveInventoryItem)
	GIVE_INVENTORY_FOLDER: 'give_inventory_folder', // { toAgentId, folderId, name, items:[{itemId, assetType}] } — offer an inventory FOLDER via ImprovedInstantMessage dialog 4; bucket=[AT_FOLDER(8)]+folder UUID then [assetType]+itemUUID per DIRECT item (OpenSim copies subfolders server-side; top-folder items must be listed — LLGiveInventory::commitGiveInventoryCategory)
	FRIEND_REMOVE:    'friend_remove',    // { agentId } — TerminateFriendship (Low 300)
	FRIEND_RIGHTS:    'friend_rights',    // { agentId, rights:number } — GrantUserRights (Low 320)
	NAME_REQ:         'name_req',         // { ids:string[] } — UUIDNameRequest (Low 235) → resolve avatar UUIDs to names
	AVATAR_PICKER_REQ: 'avatar_picker_req', // { query, queryId } — AvatarPickerRequest (Low 26) for Add-Friend name search
	OBJ_CACHE_MISS:   'obj_cache_miss',   // { ids:number[] } — client cache lacks/mismatches these probed localIds; request full updates
	OBJ_PROBE_RESYNC: 'obj_probe_resync', // {} — engine mounted; replay the session's buffered ObjectUpdateCached probes (initial flood predates handler registration)
	OBJ_CLIENT_CACHED: 'obj_client_cached', // { ids:number[] } — localIds the client pre-seeded from qs-objects IDB this region; server diffs vs distinctLocalIds to find ghosts (objects deleted while offline)
	CAP_CALL:       'cap_call',     // { id, cap, params, method? } — generic HTTP capability call by name
	// ── Right-click-menu wire (sit/buy/pay/group-invite) ──
	OBJECT_BUY:       'object_buy',       // { localId, saleType, salePrice, categoryId } — outbound ObjectBuy (Low 102). FS: "does not work for multiple object buy" (llselectmgr.cpp:5019 sendBuy) — single object only. categoryId may be zero-UUID (sim re-resolves, same convention as OBJECT_TAKE); GroupID is always zero-UUID (we don't track an active group for transactions). With no money module loaded, OpenSim silently drops ObjectBuy (LLClientView.cs:11137-11138); stock SampleMoneyModule only allows salePrice===0 buys and BlueBox-refuses priced ones (SampleMoneyModule.cs:820-824) — refusals surface via ALERT_MESSAGE.
	PAY_MONEY:        'pay_money',        // { destId, amount, transactionType, description, isDestGroup? } — outbound MoneyTransferRequest (Low 311), FS give_money (llviewermessage.cpp:462-490). transactionType: see TRANS below. Stock OpenSim installs no-op this (SampleMoneyModule.cs:747-750 MoneyTransferAction is empty) — Pay is silently a no-op there.
	MONEY_BALANCE_REQ:'money_balance_req',// {} — outbound MoneyBalanceRequest (Low 313), FS llstatusbar.cpp:889-904 sendMoneyBalanceRequest (TransactionID = zero-UUID). Stock SampleMoneyModule always answers balance=0 (GetFundsForAgentID, SampleMoneyModule.cs:596-601).
	GROUP_INVITE:     'group_invite',     // { groupId, inviteeIds:string[], roleId? } — outbound InviteGroupRequest (Low 349); roleId defaults to zero-UUID (Everyone role). OpenSim: GroupsModule.InviteGroupRequest (XmlRpcGroups GroupsModule.cs:1393-1473) — silently dropped when no groups module is loaded (LLClientView.cs:11922-11935 checks m_GroupsModule == null before dispatch).
	OBJECT_PROPS_FAMILY_REQ: 'object_props_family_req', // { objectId, requestFlags? } — outbound RequestObjectPropertiesFamily (Medium 5), the lightweight HOVER-driven props request (no selection side effects; template comments it as "driven by mouse hovering", message_template.msg:2716). Used to learn saleType/salePrice for the Buy hover pointer before any select.
}

// ── Money transaction type constants (viewer→sim MoneyTransferRequest.TransactionType) ──
// FS indra/llinventory/lltransactiontypes.h:77 (TRANS_GIFT) / :84 (TRANS_PAY_OBJECT).
export const TRANS = {
	GIFT:       5001, // person-to-person L$ gift (Pay Resident)
	PAY_OBJECT: 5008, // paying an object (e.g. vendor, tip jar)
}

// ── Server → Client ─────────────────────────────────────────────────────
export const S = {
	LOGIN_OK:     'login_ok',   // { agentId, sessionId, simIp, simPort, seedCap, regionName, inventoryRoot, inventorySkeleton:[{folderId,parentId,name,typeDefault,version}], inventoryLibRoot, inventorySkeletonLib }
	LOGIN_FAIL:   'login_fail', // { message }
	OBJECT_UPDATE:'obj_upd',    // { objects: [{ localId, fullId, pcode, pos, rot, scale, nameValue, parentId, shape, defaultColor?, faceColors?, psys?, vel?, angVel?, sound? }] }  vel/angVel = [x,y,z] SL region frame (m/s, rad/s), omitted when ~0; sound = { id, gain, flags, radius } looped attached sound (flags U8 0x01 loop, 0x20 stop); id:null = explicit STOP marker (llStopSound sends Sound=Zero + STOP flag — SoundModule.cs:269-276); omitted when null-UUID AND flags+gain zero. psys = { pattern, burstRate, burstRadius, burstPartCount, burstSpeedMin/Max, maxAge, startAge, inner/outerAngle, angularVelocity, partAccel, texture, target, partFlags, partMaxAge, start/endColor[rgba], start/endScale[xy], start/endGlow, blendFuncSource/Dest }
	TERSE_UPDATE: 'terse_upd', // { objects: [{ localId, pos:[x,y,z], rot?:[x,y,z,w], vel?:[x,y,z], angVel?:[x,y,z] }] } — ~10Hz motion updates; vel m/s + angVel rad/s (SL region frame) omitted when ~0
	CHAT_MSG:     'chat_msg',   // { fromName, sourceId, type, channel, message, pos }
	REGION_INFO:  'region',     // { name, handle, waterHeight }
	TELEPORT_OK:       'tp_ok',       // { regionName, seedCap }
	TELEPORT_FINISH:   'tp_finish',   // { simIp, simPort, regionHandle, seedCap, simAccess, regionSizeX, regionSizeY } — cross-region TP (size 0 = grid omitted it)
	TELEPORT_FAILED:   'tp_failed',   // { reason: string } — sim rejected the TeleportLocationRequest
	TELEPORT_STARTED:  'tp_started',  // {} — TeleportLocationRequest sent; show progress overlay
	TELEPORT_PROGRESS: 'tp_progress', // { status: string } — "contacting"|"arriving" etc.
	CAPS_RESULT:  'caps_result',// { id, status, body }
	ERROR:        'error',      // { code, message }
	DEBUG:        'debug',      // { level:'info'|'warn'|'error', msg: string } — server log forwarded to browser
	DISCONNECTED:    'disconnected',   // { reason: string } — sim killed the circuit
	AGENT_SPAWN_POS: 'spawn_pos',     // { pos: [slX, slY, slZ] } — AgentMovementComplete confirmed position
	KILL_OBJECT:     'kill_obj',      // { ids:number[], cull?:boolean, deleted?:boolean } — sim/relay removed these localIds. cull:true = interest-leave (keep IDB descriptor); deleted:true = ghost reconciliation (always purge IDB)
	TERRAIN_PATCH:   'terrain_patch', // { layerType:'LAND'|'WATER', patchSize:16, patches:[{x,y,heights:number[]}] }
	ENVIRONMENT_TIME:'environment_time', // { sunDirection:[x,y,z], sunPhase, sunAngVelocity:[x,y,z], secPerDay, usecSinceStart } — SimulatorViewerTimeMessage (Low 150) → day/night cycle

	ALERT_MESSAGE:   'alert_message', // { message, modal } — sim AlertMessage (Low 134) / AgentAlertMessage (Low 135): perm refusals ("You cannot copy…"), grid notices; client shows toast + Grid chat line
	CIRCUIT_STATUS:  'circuit_status',// { alive: boolean } — response to CHECK_CIRCUIT
	IM_RECV:         'im_recv',       // { fromAgentId, fromAgentName, toAgentId, dialog, message, timestamp, imId, binaryBucket } — incoming IM (binaryBucket = base64; inventory offer dialog 4 = S8 assetType + 16-byte item UUID)
	OBJECT_PROPS:    'object_props',  // { items: [{ fullId, creatorId, ownerId, name, description, ... }] } — sim's ObjectProperties reply
	MAP_BLOCKS:      'map_blocks',    // { blocks: [{ regionX, regionY, name, access, regionFlags, waterHeight, agents, mapImageId }] }
	CAPS_READY:      'caps_ready',    // { caps: string[] } — HTTP cap names available after seed-cap fetch
	INV_FOLDER:      'inv_folder',    // { folderId, items: [{ itemId, parentId, name, desc, assetType, invType, assetId, flags }], error? } — FetchInventoryDescendents2 reply
	INV_ITEM_CREATED:'inv_item_created', // { items: [{ itemId, parentId, assetId, name, desc, assetType, invType, flags, ownerMask }] } — UpdateCreateInventoryItem (Low 267)
	INV_BULK_UPDATE: 'inv_bulk_update',  // { folders:[...], items:[...] } — decoded BulkUpdateInventory (rename/move/perms reconciliation)
	INV_ITEM_REMOVED:'inv_item_removed', // { itemIds:[...] } — decoded RemoveInventoryItem ack / sim-driven removal
	INV_FOLDER_CREATED:    'inv_folder_created',     // { folderId, parentId, name, typeDefault } — CreateInventoryCategory cap confirmed (persisted)
	INV_FOLDER_CREATE_FAILED:'inv_folder_create_failed', // { folderId, error } — cap rejected; client reverts the optimistic folder
	ASSET_UPLOAD_RESULT:   'asset_upload_result',    // { id, ok, assetId?, itemId?, error? } — reply to C.ASSET_UPLOAD (2-step upload complete or failed), correlated by id
	ASSET_DATA:      'asset_data',       // { uuid, assetType, mime, dataB64, error?, hasAlpha?, srcWidth?, srcHeight?, full? } — fetched asset; textures arrive as WebP (server-transcoded from J2C). srcWidth/srcHeight = TRUE J2C-header dims; full=true echoes a full-resolution preview decode
	MATERIAL_DATA:   'material_data',    // { kind:'pbr'|'legacy', materials:{ [uuid]: descriptor }, error? } — PBR GLTF json or legacy normal/spec record
	MESH_DATA:       'mesh_data',        // { meshId, lod, submeshes:[{positions,normals,uvs,indices}], skinned?, skinDbg?, error? } — skinned=true: positions are REST-POSE skinned (rigged attach, server-baked); place at avatar root

	SCULPT_DATA:     'sculpt_data',      // { sculptId, sculptType, submeshes:[{positions,normals,uvs,indices (base64)}], error? }
	// ── Social (Phase 3) ──
	// SOCIAL_INIT data is folded into LOGIN_OK under d.social (resume-safe) — no separate message.
	FRIEND_STATUS:   'friend_status',  // { online:boolean, ids:string[] } — Online/OfflineNotification
	SELF_GROUPS:     'self_groups',    // { groups:[{ id, name, insignia, powers, acceptNotices, contribution }] } — AgentGroupDataUpdate
	AGENT_DATA:      'agent_data',     // { activeGroupId, groupTitle, groupName, groupPowers } — AgentDataUpdate
	AVATAR_PROPS:    'avatar_props',   // { avatarId, properties?, interests?, groups? } — AvatarProperties/Interests/GroupsReply
	AVATAR_APPEARANCE:'avatar_appearance', // { avatarId, bakes:{head?,upper?,lower?,eyes?,skirt?,hair?}, params:[U8...], height, appearanceVersion?, cofVersion? } — decoded AvatarAppearance (Low 158); baked-texture UUIDs per FS ETextureIndex (HEAD8/UPPER9/LOWER10/EYES11/SKIRT19/HAIR20); params = raw VisualParam bytes (ascending-ID tweakable sequence, no ids on the wire), height = OpenSim SetHeight() estimate (m). Client flips peer cloud→jellydoll + scales the placeholder; bakes cached for the bake pipeline (bundle 7). Replayed from server cache on resync.
	PARCEL_INFO:     'parcel_info',    // { parcel:{ parcelId, ownerId, name, desc, actualArea, globalX, globalY, globalZ, simName, snapshotId, dwell, salePrice } } — ParcelInfoReply
	NAME_REPLY:      'name_reply',    // { names: { [uuid]: "First Last" } } — UUIDNameReply
	AVATAR_PICKER_REPLY:  'avatar_picker_reply',  // { queryId, avatars:[{ id, name }] } — AvatarPickerReply (Low 28)
	FRIEND_RIGHTS_CHANGED:'friend_rights_changed',// { agentId, relatedId, rights } — inbound ChangeUserRights (Low 321)
	OBJ_CACHE_PROBE:      'obj_cache_probe',      // { probes:[{localId,crc}] } — sim's ObjectUpdateCached; client decides hit/miss vs its IDB cache
	CAP_RESULT:     'cap_result',   // { id, cap, ok, result?, error?, status? } — generic cap reply, correlated by id
	EQ_EVENT:       'eq_event',     // { name, body } — EventQueue event with no dedicated server handler, forwarded raw
	// ── Task (prim) inventory ──
	TASK_INV:       'task_inv',       // { localId, taskId, serial, items:[{ itemId, parentId, assetId, assetType, invType, flags, name, desc, creationDate, baseMask, ownerMask, groupMask, everyoneMask, nextOwnerMask, creatorId, ownerId, lastOwnerId, groupId, groupOwned, saleType, salePrice }], error? } — parsed prim contents (ReplyTaskInventory + Xfer + legacy-file parse); error set (items empty) on xfer timeout/abort
	TASK_INV_EMPTY: 'task_inv_empty', // { localId, taskId, serial } — ReplyTaskInventory carried an empty Filename = prim has no inventory (SceneObjectPartInventory.cs:1465)
	// ── Sound (S-1/S-2) ──
	SOUND_TRIGGER:       'sound_trigger',       // { soundId, ownerId, objectId, parentId, handle, pos:[x,y,z], gain } — SoundTrigger (High 29): one-shot llTriggerSound/llPlaySound at a region-local position; handle = region handle U64 as string; parentId null-UUID = object is its own parent
	ATTACHED_SOUND:      'attached_sound',      // { soundId, objectId, ownerId, gain, flags } — AttachedSound (Medium 13): sound bound to an object (position tracks it); flags U8 0x01 loop; soundId null-UUID = cancel the object's pending sound
	ATTACHED_SOUND_GAIN: 'attached_sound_gain', // { objectId, gain } — AttachedSoundGainChange (Medium 14): volume change for an object's playing attached sound
	// ── Right-click-menu wire (sit/buy/pay/group-invite) ──
	SIT_RESPONSE:    'sit_response',   // { sitObjectId, autoPilot, sitPosition:[x,y,z], sitRotation:[x,y,z,w], cameraEyeOffset:[x,y,z], cameraAtOffset:[x,y,z], forceMouselook } — AvatarSitResponse (High 21): sim approved AgentRequestSit; W of sitRotation is re-derived (wire sends only xyz — llquaternion.cpp:919 packToVector3 convention)
	MONEY_BALANCE:   'money_balance',  // { balance, description, transactionId, success } — MoneyBalanceReply (Low 314), reply to MONEY_BALANCE_REQ or a completed PAY_MONEY/OBJECT_BUY
	OBJECT_PROPS_FAMILY: 'object_props_family', // { fullId, ownerId, groupId, baseMask..nextOwnerMask, saleType, salePrice, lastOwnerId, name, description } — ObjectPropertiesFamily (Medium 10), reply to OBJECT_PROPS_FAMILY_REQ. FS consumer: processObjectPropertiesFamily (llselectmgr.cpp:6421-6481) — fills the sale info that gates the buy hover cursor.
}

// ── WebRTC voice signaling (keep for proximity voice) ───────────────────
export const SIG = {
	OFFER:        'offer',
	ANSWER:       'answer',
	ICE:          'ice',
	PEER_JOINED:  'peer-joined',
	PEER_LEFT:    'peer-left',
}
