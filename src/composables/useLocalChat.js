// src/composables/useLocalChat.js — receive ChatFromSim messages, send ChatFromViewer
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useChatStore } from '@/stores/chatStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useNotificationStore } from '@/stores/notificationStore'
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

	// Sim Alert/AgentAlertMessage — refusals ("You cannot copy…"), parcel/grid notices. FS shows
	// these as a notification tip AND logs them to chat history; mirror both. Keyed registration:
	// useLocalChat is instantiated per chat surface — the key stops handler stacking.
	function onAlert(d) {
		if (!d?.message) return
		const notif = useNotificationStore()
		notif.pushToast({ kind: 'info', title: 'Grid', body: d.message })
		chatStore.addMessage({ fromName: 'Grid', message: d.message, chatType: 1 })
	}

	// WHY no off() for the alert handler: it's registered under a KEY (idempotent — a later mount
	// replaces the earlier callback), and two components use this composable (SimpleWorldView is
	// permanent, ConversationsFloater comes and goes). If the floater's unmount off()'d the keyed
	// handler it would remove the ONE live registration and alerts would go silent until a remount.
	// The handler only touches global stores, so a stale closure is harmless.
	onMounted(() => { on(S.CHAT_MSG, onChatMsg); on(S.ALERT_MESSAGE, onAlert, 'localchat-alert') })
	onUnmounted(() => { off(S.CHAT_MSG, onChatMsg) })

	function send(message, channel = 0) {
		sendChat(message, 1 /* normal */, channel)
		// Optimistically add own message
		chatStore.addMessage({ fromName: 'Me', message, chatType: 1 })
	}

	return { messages: chatStore.messages, send }
}
