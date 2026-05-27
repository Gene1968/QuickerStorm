// src/composables/useLLUDP.js — client-side encoder: encode move/chat → WS → Bun → UDP
import { useRealtimeSocket } from './useRealtimeSocket'
import { C } from '@shared/protocol.js'

export function useLLUDP() {
	const { emit } = useRealtimeSocket()

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

	return { sendMove, sendChat, sendLogout, sendIM }
}
