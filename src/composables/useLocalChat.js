// src/composables/useLocalChat.js — receive ChatFromSim messages, send ChatFromViewer
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useChatStore } from '@/stores/chatStore'
import { S } from '@shared/protocol.js'

export function useLocalChat() {
	const { on, off }  = useRealtimeSocket()
	const { sendChat } = useLLUDP()
	const chatStore    = useChatStore()

	function onChatMsg(d) {
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
