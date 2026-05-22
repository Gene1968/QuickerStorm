/**
 * Supabase MessagingRepo — CRUD and Realtime for the native messaging system.
 *
 * Tables: conversations, conversation_participants, messages.
 * RPCs:   get_or_create_dm, create_group_conversation, add_conversation_member,
 *         get_unread_counts.
 *
 * Realtime: subscribes to Postgres Changes on `messages` and
 * `conversation_participants` — RLS ensures each client only receives events
 * for conversations they participate in.
 */
import { supabase } from './client.js'
import { AuthRepo } from './AuthRepo.js'

function _normalizeAttachment (row) {
	return {
		id: row.id,
		kind: row.kind,
		storagePath: row.storage_path,
		externalUrl: row.external_url,
		filename: row.filename,
		mimeType: row.mime_type,
		sizeBytes: row.size_bytes,
		width: row.width,
		height: row.height,
		createdAt: row.created_at,
	}
}

function _readImageDimensions (file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file)
		const img = new Image()
		img.onload = () => {
			resolve({ width: img.naturalWidth, height: img.naturalHeight })
			URL.revokeObjectURL(url)
		}
		img.onerror = (e) => {
			URL.revokeObjectURL(url)
			reject(e)
		}
		img.src = url
	})
}

export const MessagingRepo = {
	backend: 'supabase',

	// ── Conversations ────────────────────────────────────────────────

	/**
	 * Fetch all conversations the current user participates in, ordered by
	 * most-recently-active first. Each conversation includes its participant
	 * list (user_id + last_read_at) and the single most recent message for
	 * preview text.
	 */
	async fetchMyConversations () {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from('conversations')
			.select(`
				id, is_group, title, type, is_private, description, created_by, created_at, updated_at,
				conversation_participants ( user_id, last_read_at, joined_at )
			`)
			.order('updated_at', { ascending: false })
		if (error) throw error
		// Attach the latest message to each conversation for sidebar preview
		const convIds = (data || []).map(c => c.id)
		const previews = convIds.length ? await this._fetchLatestMessages(convIds) : {}
		return (data || []).map(c => ({
			...c,
			participants: c.conversation_participants || [],
			lastMessage: previews[c.id] || null,
		}))
	},

	/**
	 * Fetch the single most-recent message per conversation for preview.
	 * Uses a lateral-join–style approach: one query per batch, distinct on
	 * conversation_id ordered by created_at desc.
	 * @returns {Object} Map of conversationId → message row
	 */
	async _fetchLatestMessages (convIds) {
		const sb = supabase()
		const { data, error } = await sb
			.from('messages')
			.select('id, conversation_id, sender_id, body, created_at')
			.in('conversation_id', convIds)
			.order('created_at', { ascending: false })
		if (error) { console.warn('[messaging] preview fetch failed:', error); return {} }
		// Keep only the first (newest) message per conversation
		const map = {}
		for (const msg of data || []) {
			if (!map[msg.conversation_id]) map[msg.conversation_id] = msg
		}
		return map
	},

	// ── Messages ─────────────────────────────────────────────────────

	/**
	 * Fetch messages for a conversation, paginated by cursor.
	 * Returns { messages, hasMore }. Messages are oldest → newest.
	 * @param {string} conversationId
	 * @param {Object} opts
	 * @param {number} opts.limit - max messages to fetch (default 40)
	 * @param {string|null} opts.before - ISO timestamp cursor; fetch messages older than this
	 */
	async fetchMessages (conversationId, { limit = 40, before = null } = {}) {
		await AuthRepo.ready()
		const sb = supabase()
		let query = sb
			.from('messages')
			.select(`
				id, conversation_id, sender_id, body, reply_to_id, created_at, pinned_at, pinned_by,
				message_attachments ( id, kind, storage_path, external_url, filename, mime_type, size_bytes, width, height, created_at )
			`)
			.eq('conversation_id', conversationId)
			.order('created_at', { ascending: false })
			.limit(limit)
		if (before) {
			query = query.lt('created_at', before)
		}
		const { data, error } = await query
		if (error) throw error
		const messages = (data || []).map(m => ({
			id: m.id,
			conversation_id: m.conversation_id,
			sender_id: m.sender_id,
			body: m.body,
			reply_to_id: m.reply_to_id,
			created_at: m.created_at,
			pinned_at: m.pinned_at || null,
			pinned_by: m.pinned_by || null,
			attachments: (m.message_attachments || []).map(_normalizeAttachment),
		})).reverse()
		return { messages, hasMore: (data || []).length === limit }
	},

	// ── Attachments ──────────────────────────────────────────────────

	/**
	 * Upload a single file to the messaging-attachments bucket. Caller is
	 * responsible for size + mime validation; storage RLS enforces
	 * conversation membership.
	 *
	 * @returns {Object} attachment metadata to send with the chat WS payload:
	 *   { kind, storagePath, filename, mimeType, sizeBytes, width?, height? }
	 */
	async uploadAttachment (conversationId, file) {
		await AuthRepo.ready()
		const sb = supabase()
		const ext = (file.name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)
		const id = crypto.randomUUID()
		const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || `file.${ext || 'bin'}`
		const storagePath = `${conversationId}/${id}/${safeName}`
		const isImage = file.type.startsWith('image/')
		const kind = isImage ? 'image' : 'file'

		let dimensions = null
		if (isImage) {
			try { dimensions = await _readImageDimensions(file) } catch { /* non-fatal */ }
		}

		const { error } = await sb.storage
			.from('messaging-attachments')
			.upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
		if (error) throw new Error(error.message || 'upload failed')

		return {
			kind,
			storagePath,
			filename: file.name,
			mimeType: file.type || 'application/octet-stream',
			sizeBytes: file.size,
			width: dimensions?.width,
			height: dimensions?.height,
		}
	},

	/**
	 * Get a signed URL for an attachment (60 min). Bucket is private so
	 * we never use public URLs.
	 */
	async getAttachmentUrl (storagePath) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.storage
			.from('messaging-attachments')
			.createSignedUrl(storagePath, 60 * 60)
		if (error) throw error
		return data?.signedUrl || null
	},

	/**
	 * Send a message to a conversation.
	 * @returns {Object} The inserted message row.
	 */
	async sendMessage (conversationId, body, replyToId = null) {
		await AuthRepo.ready()
		const sb = supabase()
		const session = AuthRepo.getSession()
		const senderId = session?.user?.id
		if (!senderId) throw new Error('not authenticated')

		const row = {
			conversation_id: conversationId,
			sender_id: senderId,
			body,
		}
		if (replyToId) row.reply_to_id = replyToId

		const { data, error } = await sb
			.from('messages')
			.insert(row)
			.select('id, conversation_id, sender_id, body, reply_to_id, created_at')
			.single()
		if (error) throw error
		return data
	},

	// ── Participants / Read Tracking ─────────────────────────────────

	/**
	 * Mark a conversation as read up to now for the current user.
	 */
	async markRead (conversationId) {
		await AuthRepo.ready()
		const sb = supabase()
		const session = AuthRepo.getSession()
		const userId = session?.user?.id
		if (!userId) return
		const { error } = await sb
			.from('conversation_participants')
			.update({ last_read_at: new Date().toISOString() })
			.eq('conversation_id', conversationId)
			.eq('user_id', userId)
		if (error) console.warn('[messaging] markRead failed:', error)
	},

	/**
	 * Fetch unread counts for all of the current user's conversations.
	 * @returns {Object} Map of conversationId → unread count
	 */
	async fetchUnreadCounts () {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.rpc('get_unread_counts')
		if (error) throw error
		const map = {}
		for (const row of data || []) {
			map[row.conversation_id] = Number(row.unread)
		}
		return map
	},

	// ── Conversation Management (RPCs) ───────────────────────────────

	/**
	 * Get or create a 1-on-1 DM conversation. Idempotent.
	 * @param {string} otherAuthUserId - the other user's auth.users UUID
	 * @returns {string} conversation UUID
	 */
	async getOrCreateDm (otherAuthUserId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.rpc('get_or_create_dm', {
			other_user_id: otherAuthUserId,
		})
		if (error) throw error
		return data   // UUID string
	},

	/**
	 * Create a group conversation.
	 * @param {string[]} participantIds - auth user UUIDs (creator is auto-included)
	 * @param {string|null} title
	 * @returns {string} conversation UUID
	 */
	async createGroupConversation (participantIds, title = null) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.rpc('create_group_conversation', {
			participant_ids: participantIds,
			conv_title: title,
		})
		if (error) throw error
		return data
	},

	/**
	 * Add a member to an existing group conversation.
	 */
	async addMember (conversationId, newUserId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('add_conversation_member', {
			conv_id: conversationId,
			new_user_id: newUserId,
		})
		if (error) throw error
	},

	/**
	 * Remove a member from a group/channel conversation (caller must be a participant).
	 */
	async removeMember (conversationId, userId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('remove_conversation_member', {
			conv_id: conversationId,
			target_user_id: userId,
		})
		if (error) throw error
	},

	// ── Channels ────────────────────────────────────────────────────

	/**
	 * Create a channel (public or private).
	 * @param {string} name - channel name
	 * @param {string|null} description
	 * @param {boolean} isPrivate
	 * @param {string[]} invitedIds - auth user UUIDs to invite
	 * @returns {string} channel conversation UUID
	 */
	async createChannel (name, description = null, isPrivate = false, invitedIds = []) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.rpc('create_channel', {
			channel_name: name,
			channel_description: description,
			channel_is_private: isPrivate,
			invited_user_ids: invitedIds,
		})
		if (error) throw error
		return data
	},

	/**
	 * Join a public channel.
	 */
	async joinChannel (channelId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('join_channel', { channel_id: channelId })
		if (error) throw error
	},

	/**
	 * Leave a channel or group conversation.
	 */
	async leaveChannel (channelId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('leave_channel', { channel_id: channelId })
		if (error) throw error
	},

	/**
	 * List all public channels with member count and membership status.
	 * @returns {Object[]} Array of { id, title, description, created_by, created_at, member_count, is_member }
	 */
	async fetchPublicChannels () {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb.rpc('list_public_channels')
		if (error) throw error
		return data || []
	},

	// ── Pinned Messages ──────────────────────────────────────────────

	async pinMessage (messageId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('pin_message', { msg_id: messageId })
		if (error) throw error
	},

	async unpinMessage (messageId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb.rpc('unpin_message', { msg_id: messageId })
		if (error) throw error
	},

	async fetchPinnedMessages (conversationId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from('messages')
			.select(`
				id, conversation_id, sender_id, body, reply_to_id, created_at, pinned_at, pinned_by,
				message_attachments ( id, kind, storage_path, external_url, filename, mime_type, size_bytes, width, height, created_at )
			`)
			.eq('conversation_id', conversationId)
			.not('pinned_at', 'is', null)
			.order('pinned_at', { ascending: false })
			.limit(50)
		if (error) throw error
		return (data || []).map(m => ({
			id: m.id,
			conversation_id: m.conversation_id,
			sender_id: m.sender_id,
			body: m.body,
			reply_to_id: m.reply_to_id,
			created_at: m.created_at,
			pinned_at: m.pinned_at,
			pinned_by: m.pinned_by,
			attachments: (m.message_attachments || []).map(_normalizeAttachment),
		}))
	},

	/**
	 * Subscribe to message UPDATEs for a single conversation. The pin/unpin
	 * RPCs mutate the row's pinned_at; this fires for any message UPDATE so
	 * the caller decides whether the change is pin-related.
	 */
	subscribePinUpdates (conversationId, onUpdate) {
		const sb = supabase()
		const channel = sb
			.channel(`pin-updates-${conversationId}`)
			.on('postgres_changes', {
				event: 'UPDATE',
				schema: 'public',
				table: 'messages',
				filter: `conversation_id=eq.${conversationId}`,
			}, (payload) => {
				try { onUpdate?.(payload.new, payload.old) } catch (e) {
					console.warn('[messaging] pin update cb:', e)
				}
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},

	// ── Channel Bookmarks ────────────────────────────────────────────

	async fetchBookmarks (channelId) {
		await AuthRepo.ready()
		const sb = supabase()
		const { data, error } = await sb
			.from('channel_bookmarks')
			.select('id, channel_id, url, label, added_by, position, created_at')
			.eq('channel_id', channelId)
			.order('position', { ascending: true })
			.order('created_at', { ascending: true })
		if (error) throw error
		return data || []
	},

	async addBookmark (channelId, url, label) {
		await AuthRepo.ready()
		const sb = supabase()
		const session = AuthRepo.getSession()
		const userId = session?.user?.id
		if (!userId) throw new Error('not authenticated')

		// Append at the end (max position + 1).
		const { data: maxRow } = await sb
			.from('channel_bookmarks')
			.select('position')
			.eq('channel_id', channelId)
			.order('position', { ascending: false })
			.limit(1)
			.maybeSingle()
		const nextPos = (maxRow?.position ?? -1) + 1

		const { data, error } = await sb
			.from('channel_bookmarks')
			.insert({
				channel_id: channelId,
				url,
				label,
				added_by: userId,
				position: nextPos,
			})
			.select('id, channel_id, url, label, added_by, position, created_at')
			.single()
		if (error) throw error
		return data
	},

	async removeBookmark (id) {
		await AuthRepo.ready()
		const sb = supabase()
		const { error } = await sb
			.from('channel_bookmarks')
			.delete()
			.eq('id', id)
		if (error) throw error
	},

	subscribeBookmarks (channelId, { onInsert, onDelete, onUpdate }) {
		const sb = supabase()
		const channel = sb
			.channel(`bookmarks-${channelId}`)
			.on('postgres_changes', {
				event: 'INSERT',
				schema: 'public',
				table: 'channel_bookmarks',
				filter: `channel_id=eq.${channelId}`,
			}, (payload) => { try { onInsert?.(payload.new) } catch (e) { console.warn('[bookmarks] insert cb:', e) } })
			.on('postgres_changes', {
				event: 'DELETE',
				schema: 'public',
				table: 'channel_bookmarks',
				filter: `channel_id=eq.${channelId}`,
			}, (payload) => { try { onDelete?.(payload.old) } catch (e) { console.warn('[bookmarks] delete cb:', e) } })
			.on('postgres_changes', {
				event: 'UPDATE',
				schema: 'public',
				table: 'channel_bookmarks',
				filter: `channel_id=eq.${channelId}`,
			}, (payload) => { try { onUpdate?.(payload.new) } catch (e) { console.warn('[bookmarks] update cb:', e) } })
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},

	// ── Realtime Subscriptions ───────────────────────────────────────

	/**
	 * Subscribe to new messages across all conversations the user participates in.
	 * RLS filters events so only relevant messages are delivered.
	 * @param {Function} onInsert - called with the new message row
	 * @returns {Function} unsubscribe
	 */
	subscribeMessages (onInsert) {
		const sb = supabase()
		const channel = sb
			.channel('messaging-messages')
			.on('postgres_changes', {
				event: 'INSERT',
				schema: 'public',
				table: 'messages',
			}, (payload) => {
				try { onInsert(payload.new) } catch (e) {
					console.warn('[messaging] onInsert threw:', e)
				}
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},

	/**
	 * Subscribe to participant changes (detect being added to new conversations).
	 * @param {Function} onInsert - called with the new participant row
	 * @returns {Function} unsubscribe
	 */
	subscribeParticipants (onInsert) {
		const sb = supabase()
		const channel = sb
			.channel('messaging-participants')
			.on('postgres_changes', {
				event: 'INSERT',
				schema: 'public',
				table: 'conversation_participants',
			}, (payload) => {
				try { onInsert(payload.new) } catch (e) {
					console.warn('[messaging] onParticipantInsert threw:', e)
				}
			})
			.subscribe()
		return () => { try { sb.removeChannel(channel) } catch { /* ignore */ } }
	},
}
