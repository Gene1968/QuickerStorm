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
}

// ── Server → Client ─────────────────────────────────────────────────────
export const S = {
	LOGIN_OK:     'login_ok',   // { agentId, sessionId, simIp, simPort, seedCap, regionName }
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
}

// ── WebRTC voice signaling (keep for proximity voice) ───────────────────
export const SIG = {
	OFFER:        'offer',
	ANSWER:       'answer',
	ICE:          'ice',
	PEER_JOINED:  'peer-joined',
	PEER_LEFT:    'peer-left',
}
