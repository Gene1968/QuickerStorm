// src/composables/useLocalChat.js — receive ChatFromSim messages, send ChatFromViewer
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useChatStore } from '@/stores/chatStore'
import { useSessionStore } from '@/stores/sessionStore'
import { S } from '@shared/protocol.js'

export function useLocalChat() {
	const { on, off }    = useRealtimeSocket()
	const { sendChat }   = useLLUDP()
	const chatStore      = useChatStore()
	const sessionStore   = useSessionStore()

	function onChatMsg(d) {
		// WHY: sim sends blank ChatFromSim packets for typing state changes (chatType 3/4/5
		// observed in OpenSim — enum varies by version). Filter all empty messages rather
		// than enumerating chatType values; nothing useful has an empty message body.
		if (!d.message) return
		// WHY: sim always echoes our own sent chat back as ChatFromSimulator; skip the
		// echo to avoid duplicating the optimistic "Me:" entry already in the store.
		if (d.sourceId && d.sourceId === sessionStore.agentId) return
		chatStore.addMessage(d)
	}

	onMounted(() => on(S.CHAT_MSG, onChatMsg))
	onUnmounted(() => off(S.CHAT_MSG, onChatMsg))

	function send(message, channel = 0) {
		sendChat(message, 1 /* normal */, channel)
		// Optimistically add own message
		chatStore.addMessage({ fromName: 'Me', message, chatType: 1 })
	}

	return { messages: chatStore.messages, send }
}
