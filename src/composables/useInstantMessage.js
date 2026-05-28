// src/composables/useInstantMessage.js — IM conversations via ImprovedInstantMessage (LLUDP)
// Module-level state so any floater/menu sharing the same composable sees the same conversations.
import { ref, onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useSessionStore } from '@/stores/sessionStore'
import { useAvatarStore } from '@/stores/avatarStore'
import { playSound } from '@/composables/useAudio'
import { S } from '@shared/protocol.js'

// conversations: Map<remoteAgentId, { agentId, agentName, messages: [{from, text, ts, dialog}] }>
const conversations = ref(new Map())
const activeId      = ref(null)   // currently focused conversation (drives floater tab)
const unreadCount   = ref(0)

// WHY: localStorage key scoped to logged-in agent — switching avatars must not bleed history.
function storageKey(agentId) {
	return `qs_im_${agentId || 'anon'}`
}

function persist(agentId) {
	// WHY: Skip when agentId empty (pre-login or post-logout). Writing to qs_im_anon would
	// pollute the bucket and stomp another user's anon-bucket state.
	if (!agentId) return
	const serial = {}
	for (const [id, conv] of conversations.value) serial[id] = conv
	try { localStorage.setItem(storageKey(agentId), JSON.stringify(serial)) } catch {}
}

function load(agentId) {
	if (!agentId) return
	try {
		const raw = localStorage.getItem(storageKey(agentId))
		if (!raw) return
		const data = JSON.parse(raw)
		const m = new Map()
		for (const [id, conv] of Object.entries(data)) m.set(id, conv)
		conversations.value = m
	} catch {}
}

function ensureConv(agentId, agentName) {
	let conv = conversations.value.get(agentId)
	if (!conv) {
		conv = { agentId, agentName: agentName || agentId.slice(0, 8), messages: [] }
		conversations.value.set(agentId, conv)
		// trigger reactivity (Map set doesn't notify)
		conversations.value = new Map(conversations.value)
	} else if (agentName && conv.agentName !== agentName) {
		conv.agentName = agentName
	}
	return conv
}

let registered = false

export function useInstantMessage() {
	const { on, off } = useRealtimeSocket()
	const { sendIM }  = useLLUDP()
	const session     = useSessionStore()
	const avatar      = useAvatarStore()

	function onImRecv(d) {
		// WHY: dialog 0=MessageFromAgent, 1=MessageBox, 4=FromTaskAsAlert, 19=BusyAutoResponse, etc.
		// For Phase 2 only handle 0 (normal IM); other dialogs (group invites, requests) are Phase 3.
		if (d.dialog !== 0) return
		const isNew = !conversations.value.has(d.fromAgentId)
		const conv = ensureConv(d.fromAgentId, d.fromAgentName)
		if (isNew) playSound('chime.mp3', 0.5)
		conv.messages.push({ from: d.fromAgentName, text: d.message, ts: d.timestamp * 1000, dialog: d.dialog })
		conversations.value = new Map(conversations.value)
		if (activeId.value !== d.fromAgentId) unreadCount.value++
		persist(session.agentId)
	}

	// Singleton hookup — multiple call sites won't double-bind.
	onMounted(() => {
		if (!registered) {
			on(S.IM_RECV, onImRecv)
			registered = true
		}
		if (session.agentId && conversations.value.size === 0) load(session.agentId)
	})
	onUnmounted(() => { /* keep registered — module-level state survives component unmount */ })

	function openWith(agentId, agentName) {
		ensureConv(agentId, agentName)
		activeId.value = agentId
		unreadCount.value = 0
	}

	function setActive(agentId) {
		activeId.value = agentId
		if (agentId) unreadCount.value = 0
	}

	function send(toAgentId, text) {
		if (!text.trim()) return
		const conv = ensureConv(toAgentId)
		const fromName = avatar.displayName || 'User'
		sendIM(toAgentId, fromName, text)
		conv.messages.push({ from: 'Me', text, ts: Date.now(), dialog: 0 })
		conversations.value = new Map(conversations.value)
		persist(session.agentId)
	}

	function close(agentId) {
		conversations.value.delete(agentId)
		conversations.value = new Map(conversations.value)
		if (activeId.value === agentId) activeId.value = null
		persist(session.agentId)
	}

	return {
		conversations, activeId, unreadCount,
		openWith, setActive, send, close,
	}
}

export function loadIMHistory(agentId) { load(agentId) }
