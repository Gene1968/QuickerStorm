/**
 * useMessaging — native Supabase messaging composable.
 *
 * Replaces useSlack.js for DMs, group conversations, and real-time message
 * delivery. Reactive state is module-level so all callers share one data pool.
 * Only the instance that calls start() drives the Realtime subscriptions.
 *
 * Data flow:
 *   - MessagingRepo.subscribeMessages()  → Postgres Changes (INSERT on messages)
 *   - MessagingRepo.subscribeParticipants() → Postgres Changes (INSERT on conversation_participants)
 *   - No polling — all updates arrive via WebSocket push.
 */
import { ref, computed } from 'vue'
import { MessagingRepo } from '@/api/backend.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { AuthRepo } from '@/api/supabase/AuthRepo.js'
import { useAudio } from '@/composables/useAudio.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'

// ── Module-level shared state ──────────────────────────────────────────
const conversations = ref([])     // all my conversations, sorted by updated_at desc
const conversationsLoaded = ref(false)
const activeConversation = ref(null)   // currently open conversation object
const activeMessages = ref([])     // messages for active conversation (oldest → newest)
const messagesLoading = ref(false)
const hasMoreMessages = ref(false)  // true if older messages can be loaded
const unreadCounts = ref({})     // { conversationId: count }
const error = ref(null)

const totalUnread = computed(() =>
	Object.values(unreadCounts.value).reduce((s, n) => s + (n || 0), 0),
)

// ── Filtered conversation lists ───────────────────────────────────────
const dmConversations = computed(() =>
	conversations.value.filter(c => !c.is_group || c.type === 'dm'),
)
const groupConversations = computed(() =>
	conversations.value.filter(c => c.is_group && c.type !== 'channel'),
)
const channelConversations = computed(() =>
	conversations.value.filter(c => c.type === 'channel'),
)

/**
 * Map of otherUser authUserId → unread count for 1:1 DMs.
 * Used by the sidebar to show badges on user rows.
 */
const dmUnreadByAuthId = computed(() => {
	const myId = _myAuthUserId()
	const map = {}
	for (const conv of dmConversations.value) {
		const count = unreadCounts.value[conv.id]
		if (!count) continue
		const other = (conv.participants || []).find(p => p.user_id !== myId)
		if (other) map[other.user_id] = count
	}
	return map
})

const publicChannels = ref([]) // browseable public channels (may include non-joined)

// ── Internal state ─────────────────────────────────────────────────────
let _started = false
const _wsHandlerRefs = []
let _pinUnsubscribe = null

// Pinned messages for the active conversation. Loaded on openConversation;
// kept fresh by Supabase Realtime UPDATE subscription on the messages table.
const pinnedMessages = ref([])

// ── Helpers ────────────────────────────────────────────────────────────

function _myAuthUserId () {
	const session = AuthRepo.getSession()
	return session?.user?.id || null
}

/**
 * Resolve a presence-store user object to a Supabase auth user UUID.
 * Presence users have `authUserId` (added in usePresence normalization).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function resolveAuthUserId (presenceUser) {
	if (!presenceUser) return null
	// Direct auth UUID (preferred) — must be a real UUID, not a synthetic dev ID
	if (presenceUser.authUserId && UUID_RE.test(presenceUser.authUserId)) return presenceUser.authUserId
	// Fallback: search presenceStore for matching id to find authUserId
	const presenceStore = usePresenceStore()
	const match = presenceStore.users.find(u => String(u.id) === String(presenceUser.id))
	const id = match?.authUserId || null
	return id && UUID_RE.test(id) ? id : null
}

/**
 * Build display info for a conversation (name, color, initials) from
 * participant auth user IDs resolved against the presence store.
 */
function _conversationDisplayInfo (conv) {
	const myId = _myAuthUserId()
	const presenceStore = usePresenceStore()

	if (!conv.is_group) {
		const otherParticipant = (conv.participants || []).find(p => p.user_id !== myId)
		// Self-DM (only one participant, which is me)
		if (!otherParticipant) {
			return { name: 'Notes to Self', color: '#2d6a9f', initials: '📝' }
		}
		const otherUser = presenceStore.users.find(u => u.authUserId === otherParticipant.user_id)
		return {
			name: otherUser?.name || otherUser?.email || 'Unknown',
			color: otherUser?.color || '#3d5470',
			initials: _initials(otherUser?.name || '?'),
		}
	}

	// Group: use title or list participant names
	if (conv.title) {
		return { name: conv.title, color: '#4a6070', initials: conv.title.slice(0, 2).toUpperCase() }
	}
	const names = (conv.participants || [])
		.filter(p => p.user_id !== myId)
		.map(p => {
			const u = presenceStore.users.find(u => u.authUserId === p.user_id)
			return u?.name?.split(' ')[0] || 'Unknown'
		})
	const name = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '')
	return { name: name || 'Group', color: '#4a6070', initials: 'GR' }
}

function _initials (name) {
	if (!name) return '??'
	const parts = name.trim().split(' ').filter(Boolean)
	if (parts.length >= 2) return (parts[0][0] + parts.at(-1)[0]).toUpperCase()
	return name.slice(0, 2).toUpperCase() || '??'
}

// ── Public API ─────────────────────────────────────────────────────────

export function useMessaging () {
	return {
		// State
		conversations,
		conversationsLoaded,
		activeConversation,
		activeMessages,
		messagesLoading,
		hasMoreMessages,
		unreadCounts,
		totalUnread,
		error,

		// Filtered lists
		dmConversations,
		groupConversations,
		channelConversations,
		dmUnreadByAuthId,
		publicChannels,

		// Actions
		start,
		stop,
		openDmWithUser,
		openConversation,
		closeConversation,
		sendMessage,
		sendTyping,
		createGroupConversation,
		addMember,
		removeMember,
		markActiveRead,
		loadMore,
		fetchConversations,
		createChannel,
		joinChannel,
		leaveChannel,
		fetchPublicChannels,
		uploadAttachment,
		getAttachmentUrl,
		fetchBookmarks,
		addBookmark,
		removeBookmark,
		subscribeBookmarks,
		pinMessage,
		unpinMessage,
		fetchPinnedMessages,
		pinnedMessages,

		// Helpers
		resolveAuthUserId,
		getConversationDisplayInfo,
		senderName,
		senderColor,
		senderInitials,
	}
}

// ── Lifecycle ──────────────────────────────────────────────────────────

async function start () {
	if (_started) return
	_started = true

	try {
		await Promise.all([
			fetchConversations(),
			_fetchUnreadCounts(),
		])
	} catch (e) {
		console.warn('[messaging] start fetch failed:', e)
	}

	// Subscribe to new messages via WS (replaces Supabase Realtime)
	const { playSound } = useAudio()
	const rtSocket = useRealtimeSocket()

	function _onWs (type, cb) {
		rtSocket.on(type, cb)
		_wsHandlerRefs.push([type, cb])
	}

	_onWs('chat', (data) => {
		// data: { id, convId, senderId, body, replyTo, ts, attachments? }
		const msg = {
			id: data.id,
			conversation_id: data.convId,
			sender_id: data.senderId,
			body: data.body,
			reply_to_id: data.replyTo || null,
			created_at: data.ts,
			attachments: Array.isArray(data.attachments) ? data.attachments : [],
		}

		if (msg.sender_id !== _myAuthUserId()) playSound('dm.mp3')
		const activeId = activeConversation.value?.id
		if (msg.conversation_id === activeId) {
			// If this is our own message echoing back, replace the matching
			// optimistic entry in place — same body + conv, oldest first.
			// Otherwise sender sees their bubble twice until the 10s cleanup.
			if (msg.sender_id === _myAuthUserId()) {
				const optIdx = activeMessages.value.findIndex(m =>
					m._optimistic
					&& m.conversation_id === msg.conversation_id
					&& m.body === msg.body
					&& (m.reply_to_id || null) === (msg.reply_to_id || null)
				)
				if (optIdx >= 0) {
					const next = [...activeMessages.value]
					next.splice(optIdx, 1, msg)
					activeMessages.value = next
					markActiveRead()
					_bumpConversation(msg.conversation_id, msg)
					return
				}
			}
			// Live append — avoid duplicates (e.g. echo from another tab)
			if (!activeMessages.value.some(m => m.id === msg.id)) {
				activeMessages.value = [...activeMessages.value, msg]
			}
			markActiveRead()
		} else {
			unreadCounts.value = {
				...unreadCounts.value,
				[msg.conversation_id]: (unreadCounts.value[msg.conversation_id] || 0) + 1,
			}
		}
		_bumpConversation(msg.conversation_id, msg)
	})

	// Typing indicators from peers
	_onWs('typing', (data) => {
		// data: { userId, convId, active }
		// Emit a custom event so UI components can show typing indicators
		window.dispatchEvent(new CustomEvent('ava-typing', { detail: data }))
	})
}

function stop () {
	_started = false
	const rtSocket = useRealtimeSocket()
	for (const [type, cb] of _wsHandlerRefs) rtSocket.off(type, cb)
	_wsHandlerRefs.length = 0
}

// ── Conversations ──────────────────────────────────────────────────────

async function fetchConversations () {
	try {
		const data = await MessagingRepo.fetchMyConversations()
		conversations.value = data
		conversationsLoaded.value = true
	} catch (e) {
		error.value = e.message
		console.warn('[messaging] fetchConversations failed:', e)
	}
}

async function _fetchUnreadCounts () {
	try {
		unreadCounts.value = await MessagingRepo.fetchUnreadCounts()
	} catch (e) {
		console.warn('[messaging] fetchUnreadCounts failed:', e)
	}
}

/**
 * Bump a conversation to the top of the list and update its lastMessage.
 */
function _bumpConversation (conversationId, msg) {
	const idx = conversations.value.findIndex(c => c.id === conversationId)
	if (idx < 0) {
		// New conversation not in list yet — fetch all
		fetchConversations()
		return
	}
	const conv = { ...conversations.value[idx], updated_at: new Date().toISOString() }
	if (msg) conv.lastMessage = msg
	const list = [...conversations.value]
	list.splice(idx, 1)
	list.unshift(conv)
	conversations.value = list
}

// ── Open / Close ───────────────────────────────────────────────────────

/**
 * Open a DM with a presence-store user. Resolves their auth UUID,
 * gets or creates the conversation, then opens it.
 */
async function openDmWithUser (presenceUser) {
	const otherAuthId = resolveAuthUserId(presenceUser)
	if (!otherAuthId) throw new Error('Cannot resolve user identity for DM')
	const convId = await MessagingRepo.getOrCreateDm(otherAuthId)
	await openConversation(convId)
}

/**
 * Open a conversation by ID: load messages, mark read, set active.
 */
async function openConversation (conversationId) {
	messagesLoading.value = true
	error.value = null
	try {
		const { messages, hasMore } = await MessagingRepo.fetchMessages(conversationId)
		activeMessages.value = messages
		hasMoreMessages.value = hasMore

		// Find or create conversation in local list
		let conv = conversations.value.find(c => c.id === conversationId)
		if (!conv) {
			await fetchConversations()
			conv = conversations.value.find(c => c.id === conversationId)
		}
		activeConversation.value = conv || { id: conversationId }

		// Pinned messages: fetch + subscribe to live pin/unpin updates.
		_subscribePins(conversationId)
		try {
			pinnedMessages.value = await MessagingRepo.fetchPinnedMessages(conversationId)
		} catch (e) {
			console.warn('[messaging] fetchPinnedMessages failed:', e)
			pinnedMessages.value = []
		}

		// Mark as read
		await markActiveRead()
	} catch (e) {
		error.value = e.message
		throw e
	} finally {
		messagesLoading.value = false
	}
}

function _subscribePins (conversationId) {
	if (_pinUnsubscribe) { try { _pinUnsubscribe() } catch { /* ignore */ } }
	_pinUnsubscribe = MessagingRepo.subscribePinUpdates(conversationId, (newRow) => {
		// Patch the matching message in the active thread so badges update live.
		const idx = activeMessages.value.findIndex(m => m.id === newRow.id)
		if (idx >= 0) {
			const next = [...activeMessages.value]
			next[idx] = { ...next[idx], pinned_at: newRow.pinned_at, pinned_by: newRow.pinned_by }
			activeMessages.value = next
		}
		// Update the pinned-list (insert / remove based on new pinned_at).
		if (newRow.pinned_at) {
			const exists = pinnedMessages.value.some(m => m.id === newRow.id)
			if (!exists) {
				const base = activeMessages.value.find(m => m.id === newRow.id)
				if (base) {
					pinnedMessages.value = [{ ...base, pinned_at: newRow.pinned_at, pinned_by: newRow.pinned_by }, ...pinnedMessages.value]
				}
			} else {
				pinnedMessages.value = pinnedMessages.value
					.map(m => m.id === newRow.id ? { ...m, pinned_at: newRow.pinned_at, pinned_by: newRow.pinned_by } : m)
			}
		} else {
			pinnedMessages.value = pinnedMessages.value.filter(m => m.id !== newRow.id)
		}
	})
}

function closeConversation () {
	if (_pinUnsubscribe) { try { _pinUnsubscribe() } catch { /* ignore */ } }
	_pinUnsubscribe = null
	pinnedMessages.value = []
	activeConversation.value = null
	activeMessages.value = []
	hasMoreMessages.value = false
}

// ── Send ───────────────────────────────────────────────────────────────

/**
 * Send a message to the active conversation.
 * Optimistically appends so the sender sees it immediately.
 * @param {Array} attachments — pre-uploaded attachment metadata from
 *   MessagingRepo.uploadAttachment(). Each: { kind, storagePath, filename,
 *   mimeType, sizeBytes, width?, height? }
 */
async function sendMessage (text, replyToId = null, attachments = []) {
	const conv = activeConversation.value
	if (!conv) throw new Error('No active conversation')
	const body = (text || '').trim()
	const safeAttachments = Array.isArray(attachments) ? attachments : []
	if (!body && safeAttachments.length === 0) return

	const optimistic = {
		id: `optimistic-${Date.now()}`,
		conversation_id: conv.id,
		sender_id: _myAuthUserId(),
		body,
		reply_to_id: replyToId,
		created_at: new Date().toISOString(),
		attachments: safeAttachments,
		_optimistic: true,
	}
	activeMessages.value = [...activeMessages.value, optimistic]

	const rtSocket = useRealtimeSocket()
	rtSocket.emit('chat', {
		convId: conv.id,
		body,
		replyTo: replyToId,
		attachments: safeAttachments,
	})

	setTimeout(() => {
		const still = activeMessages.value.find(m => m.id === optimistic.id)
		if (still) {
			console.warn('[messaging] optimistic message not confirmed after 10s — removing')
			activeMessages.value = activeMessages.value.filter(m => m.id !== optimistic.id)
		}
	}, 10_000)
}

/**
 * Send a typing indicator via WS.
 */
function sendTyping (active) {
	const conv = activeConversation.value
	if (!conv) return
	const rtSocket = useRealtimeSocket()
	rtSocket.emit('typing', { convId: conv.id, active })
}

// ── Read Tracking ──────────────────────────────────────────────────────

async function markActiveRead () {
	const conv = activeConversation.value
	if (!conv) return
	try {
		await MessagingRepo.markRead(conv.id)
		// Clear unread count locally
		if (unreadCounts.value[conv.id]) {
			const next = { ...unreadCounts.value }
			delete next[conv.id]
			unreadCounts.value = next
		}
	} catch (e) {
		console.warn('[messaging] markRead failed:', e)
	}
}

// ── Pagination ─────────────────────────────────────────────────────────

async function loadMore () {
	const conv = activeConversation.value
	if (!conv || !hasMoreMessages.value) return
	const oldest = activeMessages.value[0]
	if (!oldest) return

	try {
		const { messages, hasMore } = await MessagingRepo.fetchMessages(conv.id, {
			before: oldest.created_at,
		})
		activeMessages.value = [...messages, ...activeMessages.value]
		hasMoreMessages.value = hasMore
	} catch (e) {
		console.warn('[messaging] loadMore failed:', e)
	}
}

// ── Group Conversations ────────────────────────────────────────────────

async function createGroupConversation (presenceUsers, title = null) {
	const ids = presenceUsers.map(u => resolveAuthUserId(u)).filter(Boolean)
	if (!ids.length) throw new Error('No valid users selected')

	const convId = await MessagingRepo.createGroupConversation(ids, title)
	await fetchConversations()
	await openConversation(convId)
	return convId
}

async function addMember (conversationId, presenceUser) {
	const authId = resolveAuthUserId(presenceUser)
	if (!authId) throw new Error('Cannot resolve user identity')
	await MessagingRepo.addMember(conversationId, authId)
	await fetchConversations()
}

async function removeMember (conversationId, authUserId) {
	await MessagingRepo.removeMember(conversationId, authUserId)
	await fetchConversations()
}

// ── Channels ──────────────────────────────────────────────────────────

async function createChannel (name, description = null, isPrivate = false, invitedPresenceUsers = []) {
	const ids = invitedPresenceUsers.map(u => resolveAuthUserId(u)).filter(Boolean)
	const convId = await MessagingRepo.createChannel(name, description, isPrivate, ids)
	await fetchConversations()
	await openConversation(convId)
	return convId
}

async function joinChannel (channelId) {
	await MessagingRepo.joinChannel(channelId)
	await fetchConversations()
}

async function leaveChannel (channelId) {
	await MessagingRepo.leaveChannel(channelId)
	if (activeConversation.value?.id === channelId) closeConversation()
	await fetchConversations()
}

async function fetchPublicChannels () {
	try {
		publicChannels.value = await MessagingRepo.fetchPublicChannels()
	} catch (e) {
		console.warn('[messaging] fetchPublicChannels failed:', e)
	}
}

// ── Attachments ────────────────────────────────────────────────────────

async function uploadAttachment (conversationId, file) {
	return MessagingRepo.uploadAttachment(conversationId, file)
}

async function getAttachmentUrl (storagePath) {
	return MessagingRepo.getAttachmentUrl(storagePath)
}

// ── Channel Bookmarks ──────────────────────────────────────────────────

async function fetchBookmarks (channelId) {
	return MessagingRepo.fetchBookmarks(channelId)
}

async function addBookmark (channelId, url, label) {
	return MessagingRepo.addBookmark(channelId, url, label)
}

async function removeBookmark (id) {
	return MessagingRepo.removeBookmark(id)
}

function subscribeBookmarks (channelId, handlers) {
	return MessagingRepo.subscribeBookmarks(channelId, handlers)
}

// ── Pinned Messages ────────────────────────────────────────────────────

async function pinMessage (messageId) {
	await MessagingRepo.pinMessage(messageId)
	// Realtime UPDATE will refresh pinnedMessages + activeMessages; in case
	// realtime is delayed, do an optimistic local patch.
	const now = new Date().toISOString()
	const myId = _myAuthUserId()
	const idx = activeMessages.value.findIndex(m => m.id === messageId)
	if (idx >= 0) {
		const next = [...activeMessages.value]
		next[idx] = { ...next[idx], pinned_at: now, pinned_by: myId }
		activeMessages.value = next
	}
	if (!pinnedMessages.value.some(m => m.id === messageId)) {
		const base = activeMessages.value.find(m => m.id === messageId)
		if (base) pinnedMessages.value = [{ ...base, pinned_at: now, pinned_by: myId }, ...pinnedMessages.value]
	}
}

async function unpinMessage (messageId) {
	await MessagingRepo.unpinMessage(messageId)
	const idx = activeMessages.value.findIndex(m => m.id === messageId)
	if (idx >= 0) {
		const next = [...activeMessages.value]
		next[idx] = { ...next[idx], pinned_at: null, pinned_by: null }
		activeMessages.value = next
	}
	pinnedMessages.value = pinnedMessages.value.filter(m => m.id !== messageId)
}

async function fetchPinnedMessages (conversationId) {
	return MessagingRepo.fetchPinnedMessages(conversationId)
}

// ── Display Helpers ────────────────────────────────────────────────────

function getConversationDisplayInfo (conv) {
	return _conversationDisplayInfo(conv)
}

function senderName (senderId) {
	const myId = _myAuthUserId()
	if (senderId === myId) return 'You'
	const presenceStore = usePresenceStore()
	const user = presenceStore.users.find(u => u.authUserId === senderId)
	return user?.name || user?.email || 'Unknown'
}

function senderInitials (senderId) {
	const name = senderName(senderId)
	if (name === 'You') return 'ME'
	return _initials(name)
}

function senderColor (senderId) {
	const myId = _myAuthUserId()
	if (senderId === myId) return '#2d6a9f'
	const presenceStore = usePresenceStore()
	const user = presenceStore.users.find(u => u.authUserId === senderId)
	return user?.color || '#3d5470'
}
