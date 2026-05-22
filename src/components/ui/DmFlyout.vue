<script setup>
/**
 * DmFlyout — slide-in conversation panel for native messaging.
 * Mounts inside .office-main (position:absolute at left edge).
 * Realtime delivery via Supabase Postgres Changes — no polling.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useMessaging } from '@/composables/useMessaging.js'
import { useAudio } from '@/composables/useAudio.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { openModal, closeModal } from '@/composables/useModalStack.js'
import EmojiPicker from '@/components/ui/EmojiPicker.vue'
import GifPicker from '@/components/ui/GifPicker.vue'
import ChannelBookmarksBar from '@/components/ui/ChannelBookmarksBar.vue'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENTS_PER_MESSAGE = 10
const BLOCKED_EXTS = new Set([
	'exe','bat','cmd','com','msi','scr','pif','vbs','vbe','wsf','wsh',
	'jar','sh','app','dmg','ps1','dll','deb','rpm','apk',
])

function _ext (name) {
	const i = name.lastIndexOf('.')
	return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function _humanSize (bytes) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const _signedUrlCache = new Map() // storagePath → { url, expiresAt }
async function _resolveAttachmentUrl (path, getter) {
	const now = Date.now()
	const cached = _signedUrlCache.get(path)
	if (cached && cached.expiresAt > now + 60_000) return cached.url
	const url = await getter(path)
	_signedUrlCache.set(path, { url, expiresAt: now + 50 * 60_000 })
	return url
}

const messaging      = useMessaging()
const presenceStore  = usePresenceStore()
const avatarStore    = useAvatarStore()
const { playSound }  = useAudio()

const input      = ref('')
const sending    = ref(false)
const sendError  = ref('')
const scrollEl   = ref(null)
const inputEl    = ref(null)
const fileInputEl = ref(null)
const emojiBtnEl = ref(null)
const gifBtnEl = ref(null)
const replyTo    = ref(null)       // message being replied to, or null
const expanded   = ref(false)      // centered overlay mode
const showMembers = ref(false)     // members panel toggle
const showPinned  = ref(false)     // pinned messages panel toggle (channel only)
const addMemberSearch = ref('')
const memberActionError = ref('')
const pinError = ref('')

// Pending uploads — each entry:
//   { localId, file, status: 'uploading'|'done'|'error', error?, previewUrl?, meta? }
// `meta` is the MessagingRepo.uploadAttachment return value when status='done'.
const pendingAttachments = ref([])
const showEmoji = ref(false)
const showGif = ref(false)
const renderedAttachmentUrls = ref({}) // storagePath → resolved signed URL

// Is this a channel or group (i.e. has manageable members)?
const isGroupOrChannel = computed(() => conv.value?.is_group === true)
const isChannel = computed(() => conv.value?.type === 'channel')
const isCreator = computed(() => conv.value?.created_by === avatarStore.authUserId)

// Current members resolved to presence users
const members = computed(() => {
	if (!conv.value?.participants) return []
	return conv.value.participants.map(p => {
		const user = presenceStore.users.find(u => u.authUserId === p.user_id)
		return {
			authUserId: p.user_id,
			name: user?.name || user?.email || 'Unknown',
			color: user?.color || '#3d5470',
			initials: _initials(user?.name || '?'),
			isMe: p.user_id === avatarStore.authUserId,
		}
	}).sort((a, b) => a.isMe ? -1 : b.isMe ? 1 : a.name.localeCompare(b.name))
})

// Users available to add (not already members)
const addableUsers = computed(() => {
	const memberIds = new Set((conv.value?.participants || []).map(p => p.user_id))
	const q = addMemberSearch.value.toLowerCase().trim()
	return presenceStore.users
		.filter(u => {
			if (!u.authUserId) return false
			if (memberIds.has(u.authUserId)) return false
			if (u.email?.includes('@localhost')) return false
			if (q && !u.name?.toLowerCase().includes(q) && !u.email?.toLowerCase().includes(q)) return false
			return true
		})
		.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
})

function _initials(name) {
	if (!name) return '??'
	const parts = name.trim().split(' ').filter(Boolean)
	if (parts.length >= 2) return (parts[0][0] + parts.at(-1)[0]).toUpperCase()
	return name.slice(0, 2).toUpperCase() || '??'
}

async function doAddMember(user) {
	memberActionError.value = ''
	try {
		await messaging.addMember(conv.value.id, user)
		// Refresh conversation to get updated participants
		await messaging.openConversation(conv.value.id)
		addMemberSearch.value = ''
	} catch (e) {
		memberActionError.value = e.message || 'Failed to add member'
	}
}

async function doRemoveMember(authUserId) {
	memberActionError.value = ''
	try {
		await messaging.removeMember(conv.value.id, authUserId)
		await messaging.openConversation(conv.value.id)
	} catch (e) {
		memberActionError.value = e.message || 'Failed to remove member'
	}
}

async function doLeave() {
	memberActionError.value = ''
	try {
		await messaging.leaveChannel(conv.value.id)
	} catch (e) {
		memberActionError.value = e.message || 'Failed to leave'
	}
}

const conv     = computed(() => messaging.activeConversation.value)
const messages = computed(() => messaging.activeMessages.value)
const loading  = computed(() => messaging.messagesLoading.value)
const hasMore  = computed(() => messaging.hasMoreMessages.value)
const pinnedMessages = computed(() => messaging.pinnedMessages.value)
const pinnedCount    = computed(() => pinnedMessages.value.length)

// Display info for the conversation header
const display = computed(() => {
	if (!conv.value) return { name: '', color: '#3d5470', initials: '??' }
	return messaging.getConversationDisplayInfo(conv.value)
})

// Auto-scroll to bottom when messages arrive
watch(messages, async (newVal, oldVal) => {
	// Only auto-scroll if we were already near the bottom or new messages arrived
	if (newVal.length > (oldVal?.length || 0)) {
		await nextTick()
		if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight
	}
}, { deep: true })

// Focus textarea whenever the flyout opens
watch(conv, async (val, old) => {
	if (val && !old) openModal()
	if (!val && old) closeModal()
	// On close OR when switching between conversations, clear composer state
	// so files chosen in one conversation can't accidentally upload to another.
	if (!val || (old && val && old.id !== val.id)) {
		for (const a of pendingAttachments.value) {
			if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
		}
		pendingAttachments.value = []
		showEmoji.value = false
		showGif.value = false
		showPinned.value = false
		pinError.value = ''
		sendError.value = ''
	}
	if (!val) { replyTo.value = null; expanded.value = false; showMembers.value = false; showPinned.value = false; return }
	await nextTick()
	inputEl.value?.focus()
})

async function send() {
	const text = input.value.trim()
	const ready = pendingAttachments.value.filter(a => a.status === 'done')
	const stillUploading = pendingAttachments.value.some(a => a.status === 'uploading')
	if (stillUploading) { sendError.value = 'Wait for uploads to finish'; return }
	if (!text && ready.length === 0) return
	if (sending.value || !conv.value) return

	input.value = ''
	sending.value = true
	sendError.value = ''
	try {
		const attachmentMetas = ready.map(a => a.meta)
		await messaging.sendMessage(text, replyTo.value?.id || null, attachmentMetas)
		// Revoke local preview URLs and reset
		for (const a of pendingAttachments.value) {
			if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
		}
		pendingAttachments.value = []
		playSound('sent.mp3')
		replyTo.value = null
	} catch (e) {
		sendError.value = e.message || 'Failed to send'
		input.value = text
	} finally {
		sending.value = false
		await nextTick()
		inputEl.value?.focus()
	}
}

// ── Attachments ──────────────────────────────────────────────────────

function onAttachClick () {
	fileInputEl.value?.click()
}

async function onFilesPicked (e) {
	const files = Array.from(e.target.files || [])
	e.target.value = ''
	if (!files.length || !conv.value) return

	for (const file of files) {
		if (pendingAttachments.value.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
			sendError.value = `Max ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`
			break
		}
		const validation = _validate(file)
		if (validation) {
			sendError.value = validation
			continue
		}
		_uploadOne(file)
	}
}

function _validate (file) {
	if (file.size > MAX_FILE_BYTES) return `${file.name} exceeds 25 MB limit`
	if (BLOCKED_EXTS.has(_ext(file.name))) return `${file.name} type not allowed`
	return null
}

function _uploadOne (file) {
	const localId = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	const isImage = file.type.startsWith('image/')
	const previewUrl = isImage ? URL.createObjectURL(file) : null
	const entry = {
		localId,
		file,
		status: 'uploading',
		previewUrl,
		meta: null,
		error: null,
	}
	pendingAttachments.value = [...pendingAttachments.value, entry]

	messaging.uploadAttachment(conv.value.id, file)
		.then((meta) => {
			const next = pendingAttachments.value.map(a =>
				a.localId === localId ? { ...a, status: 'done', meta } : a,
			)
			pendingAttachments.value = next
		})
		.catch((err) => {
			const next = pendingAttachments.value.map(a =>
				a.localId === localId ? { ...a, status: 'error', error: err?.message || 'Upload failed' } : a,
			)
			pendingAttachments.value = next
			sendError.value = err?.message || 'Upload failed'
		})
}

function removePending (localId) {
	const entry = pendingAttachments.value.find(a => a.localId === localId)
	if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl)
	pendingAttachments.value = pendingAttachments.value.filter(a => a.localId !== localId)
}

// ── Emoji ────────────────────────────────────────────────────────────

function toggleEmoji () {
	showEmoji.value = !showEmoji.value
}

// ── Pinning ──────────────────────────────────────────────────────────

async function togglePin (msg) {
	pinError.value = ''
	try {
		if (msg.pinned_at) await messaging.unpinMessage(msg.id)
		else await messaging.pinMessage(msg.id)
	} catch (e) {
		pinError.value = e?.message || 'Pin action failed'
	}
}

function togglePinnedPanel () {
	showPinned.value = !showPinned.value
	if (showPinned.value) showMembers.value = false
}

async function scrollToMessage (msgId) {
	showPinned.value = false
	await nextTick()
	const el = scrollEl.value?.querySelector(`[data-msg-id="${msgId}"]`)
	if (!el) return
	el.scrollIntoView({ block: 'center', behavior: 'smooth' })
	el.classList.add('dm-msg--flash')
	setTimeout(() => el.classList.remove('dm-msg--flash'), 1400)
}

// ── GIFs ─────────────────────────────────────────────────────────────

function toggleGif () {
	showGif.value = !showGif.value
	if (showGif.value) showEmoji.value = false
}

function onGifSelect (gif) {
	if (pendingAttachments.value.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
		sendError.value = `Max ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`
		return
	}
	const localId = `gif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	pendingAttachments.value = [...pendingAttachments.value, {
		localId,
		file: null,
		status: 'done',
		previewUrl: gif.previewUrl,
		meta: {
			kind: 'gif',
			externalUrl: gif.externalUrl,
			filename: gif.filename || 'GIF',
			mimeType: 'image/gif',
			sizeBytes: gif.sizeBytes,
			width: gif.width,
			height: gif.height,
		},
		error: null,
	}]
	showGif.value = false
}

function onEmojiSelect (emoji) {
	const el = inputEl.value
	if (!el) {
		input.value = (input.value || '') + emoji
		return
	}
	const start = el.selectionStart ?? input.value.length
	const end = el.selectionEnd ?? input.value.length
	const before = input.value.slice(0, start)
	const after = input.value.slice(end)
	input.value = before + emoji + after
	nextTick(() => {
		const pos = before.length + emoji.length
		el.focus()
		el.setSelectionRange(pos, pos)
	})
}

// ── Attachment URL resolution (signed, cached) ───────────────────────

async function resolveUrl (path) {
	if (renderedAttachmentUrls.value[path]) return
	try {
		const url = await _resolveAttachmentUrl(path, messaging.getAttachmentUrl)
		renderedAttachmentUrls.value = { ...renderedAttachmentUrls.value, [path]: url }
	} catch {
		// Failure leaves it un-resolved; renderer shows a fallback placeholder
	}
}


function onKeydown(e) {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault()
		send()
	}
}

function close() {
	messaging.closeConversation()
	replyTo.value = null
}

function setReply(msg) {
	replyTo.value = msg
	nextTick(() => inputEl.value?.focus())
}

function cancelReply() {
	replyTo.value = null
}

async function onScroll() {
	if (!scrollEl.value || !hasMore.value) return
	// Load more when scrolled near the top
	if (scrollEl.value.scrollTop < 60) {
		const prevHeight = scrollEl.value.scrollHeight
		await messaging.loadMore()
		await nextTick()
		// Maintain scroll position after prepending older messages
		if (scrollEl.value) {
			scrollEl.value.scrollTop = scrollEl.value.scrollHeight - prevHeight
		}
	}
}

// ── Message formatting ───────────────────────────────────────────────
function esc(str) {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Auto-link URLs in plain text
function formatText(raw) {
	if (!raw) return ''
	const urlRe = /(https?:\/\/[^\s<>"']+)/g
	const parts = []
	let last = 0
	let m
	while ((m = urlRe.exec(raw)) !== null) {
		if (m.index > last) parts.push(esc(raw.slice(last, m.index)))
		parts.push(`<a href="${esc(m[1])}" target="_blank" rel="noopener noreferrer" class="dm-link">${esc(m[1])}</a>`)
		last = m.index + m[0].length
	}
	if (last < raw.length) parts.push(esc(raw.slice(last)))
	return parts.join('').replace(/\n/g, '<br>')
}

function formatTime(ts) {
	if (!ts) return ''
	const d = new Date(ts)
	const now = new Date()
	const isToday = d.toDateString() === now.toDateString()
	if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
		' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(ts) {
	const d = new Date(ts)
	const now = new Date()
	const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
	if (d.toDateString() === now.toDateString()) return 'Today'
	if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
	return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

// Find the parent message for a reply
function getReplyParent(replyToId) {
	if (!replyToId) return null
	return messages.value.find(m => m.id === replyToId) || null
}

// Group consecutive messages by sender; inject day dividers
const groupedMessages = computed(() => {
	const msgs = messages.value
	if (!msgs.length) return []
	const result = []
	let lastDay = null
	let lastSender = null

	for (const msg of msgs) {
		if (!msg.created_at) continue
		const day = new Date(msg.created_at).toDateString()
		if (day !== lastDay) {
			result.push({ type: 'day', label: dayLabel(msg.created_at), key: 'day-' + msg.created_at })
			lastDay = day
			lastSender = null
		}
		const showHeader = msg.sender_id !== lastSender
		result.push({ type: 'msg', msg, showHeader, key: msg.id })
		lastSender = msg.sender_id
	}
	return result
})
</script>

<template>
	<!-- Transparent backdrop: blocks canvas clicks/scroll, closes flyout on click -->
	<div
		v-if="conv"
		class="dm-backdrop"
		:class="{ 'dm-backdrop--dim': expanded }"
		@click="close"
		@pointerdown.stop
		@wheel.stop.prevent
	/>
	<Transition name="dm-slide">
		<div v-if="conv" class="dm-flyout" :class="{ 'dm-flyout--expanded': expanded }" @click.stop @pointerdown.stop @wheel.stop>
			<!-- Header -->
			<div class="dm-header">
				<div class="dm-bubble" :style="{ background: display.color }">
					{{ display.initials }}
				</div>
				<span class="dm-title truncate">{{ display.name }}</span>
				<button
					v-if="isChannel"
					class="dm-expand-btn dm-pin-toggle"
					@click="togglePinnedPanel"
					:title="showPinned ? 'Hide pinned' : 'Pinned messages'"
				>
					<span>📌</span>
					<span v-if="pinnedCount > 0" class="dm-pin-toggle-count">{{ pinnedCount }}</span>
				</button>
				<button
					v-if="isGroupOrChannel"
					class="dm-expand-btn"
					@click="showMembers = !showMembers"
					:title="showMembers ? 'Hide members' : 'Members'"
				>👥</button>
				<button
					class="dm-expand-btn"
					@click="expanded = !expanded"
					:title="expanded ? 'Compact view' : 'Expand'"
				>{{ expanded ? '⊟' : '⊞' }}</button>
				<button class="dm-close" @click="close" title="Close">✕</button>
			</div>

			<!-- Channel bookmarks (channels only) -->
			<ChannelBookmarksBar v-if="isChannel && conv" :channel-id="conv.id" />

			<!-- Pinned messages panel (channels only) -->
			<div v-if="isChannel && showPinned" class="dm-pinned-panel">
				<div class="dm-pinned-header">
					<span class="dm-pinned-title">Pinned messages</span>
					<span class="dm-pinned-count">{{ pinnedCount }}</span>
				</div>
				<div v-if="!pinnedCount" class="dm-empty">No pinned messages yet.</div>
				<div
					v-for="m in pinnedMessages"
					:key="m.id"
					class="dm-pinned-item"
					@click="scrollToMessage(m.id)"
				>
					<div class="dm-pinned-meta">
						<span class="dm-pinned-name" :style="{ color: messaging.senderColor(m.sender_id) }">
							{{ messaging.senderName(m.sender_id) }}
						</span>
						<span class="dm-pinned-time">{{ formatTime(m.created_at) }}</span>
						<button
							class="dm-pinned-unpin"
							@click.stop="togglePin(m)"
							title="Unpin"
						>✕</button>
					</div>
					<div v-if="m.body" class="dm-pinned-body" v-html="formatText(m.body)" />
					<div v-if="m.attachments?.length" class="dm-pinned-attachhint">
						📎 {{ m.attachments.length }} attachment{{ m.attachments.length === 1 ? '' : 's' }}
					</div>
				</div>
				<div v-if="pinError" class="dm-send-error">{{ pinError }}</div>
			</div>

			<!-- Members panel -->
			<div v-if="showMembers && isGroupOrChannel" class="dm-members-panel">
				<div class="dm-members-header">
					<span class="dm-members-title">Members ({{ members.length }})</span>
				</div>

				<!-- Add member search -->
				<div class="dm-members-add-wrap">
					<input
						class="dm-members-search"
						v-model="addMemberSearch"
						placeholder="Add people..."
					/>
				</div>
				<div v-if="addMemberSearch.trim()" class="dm-members-add-list">
					<div
						v-for="user in addableUsers.slice(0, 8)"
						:key="user.id"
						class="dm-member-row dm-member-row--add"
						@click="doAddMember(user)"
					>
						<div class="dm-member-bubble" :style="{ background: user.color }">
							{{ _initials(user.name) }}
						</div>
						<span class="dm-member-name">{{ user.name }}</span>
						<span class="dm-member-action dm-member-action--add">+ Add</span>
					</div>
					<div v-if="!addableUsers.length" class="dm-members-empty">No users found</div>
				</div>

				<!-- Current members -->
				<div class="dm-members-list">
					<div
						v-for="m in members"
						:key="m.authUserId"
						class="dm-member-row"
					>
						<div class="dm-member-bubble" :style="{ background: m.color }">
							{{ m.initials }}
						</div>
						<span class="dm-member-name">
							{{ m.name }}
							<span v-if="m.isMe" class="dm-member-you">(you)</span>
						</span>
						<button
							v-if="!m.isMe && isCreator"
							class="dm-member-action dm-member-action--remove"
							@click="doRemoveMember(m.authUserId)"
							title="Remove from channel"
						>Remove</button>
					</div>
				</div>

				<!-- Leave -->
				<button class="dm-leave-btn" @click="doLeave">
					{{ isChannel ? 'Leave Channel' : 'Leave Group' }}
				</button>

				<div v-if="memberActionError" class="dm-send-error">{{ memberActionError }}</div>
			</div>

			<!-- Messages -->
			<div class="dm-messages" ref="scrollEl" @scroll="onScroll">
				<div v-if="hasMore" class="dm-load-more">
					<button class="dm-load-more-btn" @click="messaging.loadMore()">Load older messages</button>
				</div>
				<div v-if="loading && !messages.length" class="dm-empty pulse">Loading…</div>
				<div v-else-if="!loading && !messages.length" class="dm-empty">No messages yet. Say hello!</div>

				<template v-for="item in groupedMessages" :key="item.key">
					<!-- Day divider -->
					<div v-if="item.type === 'day'" class="dm-day-divider">
						<span>{{ item.label }}</span>
					</div>

					<!-- Message row -->
					<div
						v-else
						class="dm-msg"
						:class="{ 'dm-msg--optimistic': item.msg._optimistic, 'dm-msg--pinned': !!item.msg.pinned_at }"
						:data-msg-id="item.msg.id"
					>
						<div v-if="item.showHeader" class="dm-msg-avatar" :style="{ background: messaging.senderColor(item.msg.sender_id) }">
							{{ messaging.senderInitials(item.msg.sender_id) }}
						</div>
						<div v-else class="dm-msg-avatar-gap" />

						<div class="dm-msg-body">
							<div v-if="item.showHeader" class="dm-msg-meta">
								<span class="dm-msg-name">{{ messaging.senderName(item.msg.sender_id) }}</span>
								<span class="dm-msg-time">{{ formatTime(item.msg.created_at) }}</span>
							</div>
							<!-- Reply quote -->
							<div v-if="item.msg.reply_to_id" class="dm-reply-quote">
								<span class="dm-reply-bar" />
								<span class="dm-reply-text">{{ getReplyParent(item.msg.reply_to_id)?.body?.slice(0, 80) || '…' }}</span>
							</div>
							<div v-if="item.msg.body" class="dm-msg-text" v-html="formatText(item.msg.body)" />
							<!-- Attachments -->
							<div v-if="item.msg.attachments?.length" class="dm-attach-list">
								<template v-for="att in item.msg.attachments" :key="att.id || att.storagePath || att.externalUrl">
									<!-- GIF: external CDN URL, no signed URL needed -->
									<a
										v-if="att.kind === 'gif'"
										class="dm-attach-image dm-attach-gif"
										:href="att.externalUrl"
										target="_blank"
										rel="noopener"
									>
										<img :src="att.externalUrl" :alt="att.filename" loading="lazy" />
									</a>
									<!-- Uploaded image: needs signed URL -->
									<a
										v-else-if="att.kind === 'image'"
										class="dm-attach-image"
										:href="renderedAttachmentUrls[att.storagePath] || '#'"
										target="_blank"
										rel="noopener"
										@mouseenter="resolveUrl(att.storagePath)"
										@click="(e) => { if (!renderedAttachmentUrls[att.storagePath]) { e.preventDefault(); resolveUrl(att.storagePath) } }"
									>
										<img
											v-if="renderedAttachmentUrls[att.storagePath]"
											:src="renderedAttachmentUrls[att.storagePath]"
											:alt="att.filename"
											@load="resolveUrl(att.storagePath)"
										/>
										<span v-else class="dm-attach-image-pending" @mouseenter="resolveUrl(att.storagePath)">📷 {{ att.filename }}</span>
									</a>
									<!-- File: card with download link -->
									<a
										v-else
										class="dm-attach-file"
										:href="renderedAttachmentUrls[att.storagePath] || '#'"
										target="_blank"
										rel="noopener"
										:download="att.filename"
										@mouseenter="resolveUrl(att.storagePath)"
										@click="(e) => { if (!renderedAttachmentUrls[att.storagePath]) { e.preventDefault(); resolveUrl(att.storagePath) } }"
									>
										<span class="dm-attach-icon">📎</span>
										<span class="dm-attach-meta">
											<span class="dm-attach-name">{{ att.filename }}</span>
											<span class="dm-attach-size">{{ _humanSize(att.sizeBytes) }}</span>
										</span>
									</a>
								</template>
							</div>
							<button class="dm-reply-btn" @click="setReply(item.msg)" title="Reply">↩</button>
							<button
								v-if="isChannel && !item.msg._optimistic"
								class="dm-pin-btn"
								:class="{ 'dm-pin-btn--on': !!item.msg.pinned_at }"
								@click="togglePin(item.msg)"
								:title="item.msg.pinned_at ? 'Unpin message' : 'Pin message'"
							>📌</button>
						</div>
					</div>
				</template>
			</div>

			<!-- Reply preview -->
			<div v-if="replyTo" class="dm-reply-preview">
				<span class="dm-reply-preview-text">
					Replying to <strong>{{ messaging.senderName(replyTo.sender_id) }}</strong>:
					{{ replyTo.body?.slice(0, 60) }}{{ (replyTo.body?.length || 0) > 60 ? '…' : '' }}
				</span>
				<button class="dm-reply-cancel" @click="cancelReply">✕</button>
			</div>

			<!-- Pending attachment chips -->
			<div v-if="pendingAttachments.length" class="dm-pending-row">
				<div
					v-for="att in pendingAttachments"
					:key="att.localId"
					class="dm-pending-chip"
					:class="{ 'dm-pending-chip--err': att.status === 'error' }"
					:title="att.error || att.meta?.filename || att.file?.name || ''"
				>
					<img v-if="att.previewUrl" :src="att.previewUrl" class="dm-pending-thumb" />
					<span v-else class="dm-pending-icon">📎</span>
					<span class="dm-pending-name">{{ att.meta?.filename || att.file?.name || '…' }}</span>
					<span class="dm-pending-status">
						<span v-if="att.status === 'uploading'">⏳</span>
						<span v-else-if="att.status === 'error'">⚠</span>
						<span v-else-if="att.meta?.kind === 'gif'">🎬</span>
						<span v-else>✓</span>
					</span>
					<button class="dm-pending-remove" @click="removePending(att.localId)" title="Remove">✕</button>
				</div>
			</div>

			<!-- Input -->
			<div class="dm-input-area">
				<button
					class="dm-composer-btn"
					title="Attach file or image"
					@click="onAttachClick"
					:disabled="sending"
				>📎</button>
				<button
					ref="emojiBtnEl"
					class="dm-composer-btn"
					title="Insert emoji"
					@click="() => { toggleEmoji(); if (showEmoji) showGif = false }"
					:disabled="sending"
				>😀</button>
				<button
					ref="gifBtnEl"
					class="dm-composer-btn"
					title="Send a GIF"
					@click="toggleGif"
					:disabled="sending"
				>GIF</button>
				<input
					ref="fileInputEl"
					type="file"
					multiple
					class="dm-file-input"
					@change="onFilesPicked"
				/>
				<textarea
					ref="inputEl"
					class="dm-input"
					v-model="input"
					:placeholder="`Message ${display.name || '…'}`"
					rows="1"
					@keydown="onKeydown"
					:disabled="sending"
				/>
				<button
					class="dm-send"
					@click="send"
					:disabled="(!input.trim() && !pendingAttachments.some(a => a.status === 'done')) || sending"
				>
					{{ sending ? '…' : '↑' }}
				</button>
			</div>
			<div v-if="sendError" class="dm-send-error">{{ sendError }}</div>

			<EmojiPicker
				v-if="showEmoji"
				:anchor="emojiBtnEl"
				@select="(e) => { onEmojiSelect(e); showEmoji = false }"
				@close="showEmoji = false"
			/>
			<GifPicker
				v-if="showGif"
				:anchor="gifBtnEl"
				@select="onGifSelect"
				@close="showGif = false"
			/>
		</div>
	</Transition>
</template>

<style scoped>
.dm-backdrop {
	position: fixed;
	inset: 0;
	z-index: 198;
	cursor: default;
}
.dm-backdrop--dim {
	background: rgba(0, 0, 0, 0.45);
}

.dm-flyout {
	position: absolute;
	left: 0.25rem;
	top: 5vh;
	display: flex;
	flex-direction: column;
	background: color-mix(in srgb, var(--color-side) 88%, transparent);
	border: 1px solid var(--color-brd2);
	border-radius: 0.625rem;
	width: 22rem;
	height: 80vh;
	backdrop-filter: blur(12px);
	-webkit-backdrop-filter: blur(12px);
	box-shadow: 0 8px 40px rgba(0, 0, 0, 0.55);
	overflow: hidden;
	z-index: 575;
}

/* ── Expanded centered overlay ── */
.dm-flyout--expanded {
	position: fixed;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -50%);
	width: min(48rem, 85vw);
	height: 85vh;
	font-size: 1.05rem;
}
.dm-flyout--expanded .dm-messages {
	padding: 0.75rem 1.25rem;
	gap: 0.1875rem;
}
.dm-flyout--expanded .dm-msg-text {
	font-size: 0.9375rem;
	line-height: 1.5;
}
.dm-flyout--expanded .dm-input {
	font-size: 0.9375rem;
	padding: 0.5rem 0.75rem;
}
.dm-flyout--expanded .dm-input-area {
	padding: 0.625rem 1.25rem;
}
.dm-flyout--expanded .dm-header {
	padding: 0.75rem 1.25rem;
}
.dm-flyout--expanded .dm-reply-text {
	max-width: 24rem;
}

/* ── Expand toggle ── */
.dm-expand-btn {
	background: none;
	border: none;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 1rem;
	padding: 0.25rem;
	line-height: 1;
	border-radius: 0.25rem;
	transition: color 0.12s;
}
.dm-expand-btn:hover { color: var(--color-t1); }

/* ── Header ── */
.dm-header {
	display: flex;
	align-items: center;
	gap: 0.625rem;
	padding: 0.625rem 0.75rem;
	border-bottom: 1px solid var(--color-brd);
	flex-shrink: 0;
}
.dm-bubble {
	width: 1.875rem;
	height: 1.875rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.625rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.9);
	flex-shrink: 0;
}
.dm-title {
	flex: 1;
	min-width: 0;
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--color-t1);
}
.dm-close {
	background: none;
	border: none;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.75rem;
	padding: 0.25rem;
	line-height: 1;
	border-radius: 0.25rem;
	transition: color 0.12s;
}
.dm-close:hover { color: var(--color-t1); }

/* ── Messages ── */
.dm-messages {
	flex: 1;
	overflow-y: auto;
	padding: 0.5rem 0.75rem;
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	scrollbar-width: thin;
}
.dm-empty {
	text-align: center;
	color: var(--color-tm);
	font-size: 0.75rem;
	margin-top: 2rem;
}
.dm-load-more {
	text-align: center;
	margin-bottom: 0.5rem;
}
.dm-load-more-btn {
	background: none;
	border: 1px solid var(--color-brd);
	color: var(--color-tm);
	font-size: 0.6875rem;
	padding: 0.25rem 0.75rem;
	border-radius: 0.25rem;
	cursor: pointer;
	transition: color 0.12s, border-color 0.12s;
}
.dm-load-more-btn:hover { color: var(--color-t1); border-color: var(--color-brd2); }
.dm-day-divider {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin: 0.75rem 0 0.5rem;
	color: var(--color-tm);
	font-size: 0.625rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}
.dm-day-divider::before,
.dm-day-divider::after {
	content: '';
	flex: 1;
	height: 1px;
	background: var(--color-brd);
}
.dm-msg {
	display: flex;
	gap: 0.5rem;
	align-items: flex-start;
	padding: 0.0625rem 0;
	position: relative;
}
.dm-msg--optimistic { opacity: 0.6; }
.dm-msg-avatar {
	width: 1.75rem;
	height: 1.75rem;
	border-radius: 0.25rem;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.5rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.9);
	flex-shrink: 0;
	margin-top: 0.125rem;
}
.dm-msg-avatar-gap {
	width: 1.75rem;
	flex-shrink: 0;
}
.dm-msg-body { flex: 1; min-width: 0; position: relative; }
.dm-msg-meta {
	display: flex;
	align-items: baseline;
	gap: 0.375rem;
	margin-bottom: 0.125rem;
}
.dm-msg-name {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--color-t1);
}
.dm-msg-time {
	font-size: 0.6875rem;
	color: var(--color-tm);
}
.dm-msg-text {
	font-size: 0.8125rem;
	color: var(--color-t2);
	line-height: 1.45;
	word-break: break-word;
	white-space: pre-wrap;
}
.dm-msg-text :deep(.dm-link) {
	color: var(--color-accent3);
	text-decoration: underline;
	text-underline-offset: 2px;
	word-break: break-all;
}
.dm-msg-text :deep(.dm-link:hover) { opacity: 0.8; }
html.light .dm-msg-text :deep(.dm-link) { color: #0055aa; }

/* ── Reply ── */
.dm-reply-btn {
	position: absolute;
	top: 0;
	right: 0;
	background: none;
	border: none;
	color: var(--color-tm);
	font-size: 0.75rem;
	cursor: pointer;
	opacity: 0;
	transition: opacity 0.12s;
	padding: 0.125rem 0.25rem;
	border-radius: 0.125rem;
}
.dm-msg:hover .dm-reply-btn { opacity: 0.7; }
.dm-reply-btn:hover { opacity: 1 !important; color: var(--color-t1); }

.dm-reply-quote {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	margin-bottom: 0.1875rem;
}
.dm-reply-bar {
	width: 2px;
	height: 1rem;
	background: var(--color-accent3);
	border-radius: 1px;
	flex-shrink: 0;
}
.dm-reply-text {
	font-size: 0.6875rem;
	color: var(--color-tm);
	font-style: italic;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 14rem;
}

.dm-reply-preview {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.75rem;
	background: rgba(0, 0, 0, 0.15);
	border-top: 1px solid var(--color-brd);
	flex-shrink: 0;
}
.dm-reply-preview-text {
	flex: 1;
	font-size: 0.6875rem;
	color: var(--color-tm);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dm-reply-cancel {
	background: none;
	border: none;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.625rem;
	padding: 0.125rem;
}

/* ── Input ── */
.dm-input-area {
	display: flex;
	align-items: flex-end;
	gap: 0.375rem;
	padding: 0.5rem 0.75rem;
	border-top: 1px solid var(--color-brd);
	flex-shrink: 0;
}
.dm-input {
	flex: 1;
	background: rgba(0, 0, 0, 0.2);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	color: var(--color-t1);
	font-size: 0.8125rem;
	padding: 0.4375rem 0.625rem;
	resize: none;
	line-height: 1.4;
	max-height: 6rem;
	overflow-y: auto;
	transition: border-color 0.15s;
}
.dm-input:focus { outline: none; border-color: var(--color-accent3); }
.dm-input::placeholder { color: var(--color-tm); opacity: 0.7; }
.dm-send {
	width: 2rem;
	height: 2rem;
	border-radius: 0.375rem;
	border: none;
	background: var(--color-accent3);
	color: #fff;
	font-size: 1rem;
	font-weight: 700;
	cursor: pointer;
	flex-shrink: 0;
	transition: opacity 0.15s;
}
.dm-send:disabled { opacity: 0.4; cursor: default; }
.dm-send-error {
	font-size: 0.625rem;
	color: var(--color-red);
	padding: 0 0.75rem 0.375rem;
	flex-shrink: 0;
}

/* ── Pin toggle (header) ── */
.dm-pin-toggle {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.dm-pin-toggle-count {
	position: absolute;
	top: -0.25rem;
	right: -0.25rem;
	background: var(--color-accent3);
	color: #fff;
	font-size: 0.5625rem;
	font-weight: 700;
	border-radius: 999px;
	padding: 0 0.25rem;
	min-width: 0.875rem;
	text-align: center;
	line-height: 0.9375rem;
}

/* ── Pinned messages panel ── */
.dm-pinned-panel {
	border-bottom: 0.0625rem solid var(--color-brd);
	max-height: 18rem;
	overflow-y: auto;
	padding: 0.5rem 0.625rem 0.625rem;
	background: rgba(255, 196, 0, 0.04);
	flex-shrink: 0;
	scrollbar-width: thin;
}
.dm-pinned-header {
	display: flex;
	align-items: center;
	gap: 0.4375rem;
	padding-bottom: 0.375rem;
	border-bottom: 0.0625rem solid var(--color-brd);
	margin-bottom: 0.375rem;
}
.dm-pinned-title {
	font-size: 0.75rem;
	font-weight: 700;
	color: var(--color-t1);
}
.dm-pinned-count {
	font-size: 0.625rem;
	color: var(--color-tm);
	background: rgba(255, 255, 255, 0.06);
	border-radius: 999px;
	padding: 0 0.375rem;
}
.dm-pinned-item {
	background: rgba(255, 255, 255, 0.03);
	border: 0.0625rem solid var(--color-brd);
	border-left: 0.1875rem solid var(--color-accent3);
	border-radius: 0.3125rem;
	padding: 0.375rem 0.5rem;
	margin-bottom: 0.3125rem;
	cursor: pointer;
	transition: background 0.12s;
}
.dm-pinned-item:hover {
	background: rgba(255, 255, 255, 0.07);
}
.dm-pinned-meta {
	display: flex;
	align-items: center;
	gap: 0.4375rem;
	font-size: 0.6875rem;
}
.dm-pinned-name { font-weight: 700; }
.dm-pinned-time { color: var(--color-tm); }
.dm-pinned-unpin {
	margin-left: auto;
	background: none;
	border: 0;
	color: var(--color-tm);
	font-size: 0.6875rem;
	cursor: pointer;
	padding: 0 0.125rem;
}
.dm-pinned-unpin:hover { color: var(--color-red); }
.dm-pinned-body {
	font-size: 0.75rem;
	color: var(--color-t1);
	margin-top: 0.1875rem;
	line-height: 1.45;
	display: -webkit-box;
	-webkit-line-clamp: 3;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.dm-pinned-attachhint {
	font-size: 0.625rem;
	color: var(--color-tm);
	margin-top: 0.1875rem;
}

/* ── Per-message pin button + pinned indicator ── */
.dm-pin-btn {
	background: none;
	border: 0;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.75rem;
	padding: 0 0.1875rem;
	margin-left: 0.1875rem;
	opacity: 0;
	transition: opacity 0.12s, color 0.12s, transform 0.12s;
}
.dm-msg:hover .dm-pin-btn { opacity: 0.65; }
.dm-pin-btn:hover { opacity: 1; color: var(--color-accent3); transform: scale(1.1); }
.dm-pin-btn--on { opacity: 1; color: var(--color-accent3); }
.dm-msg--pinned .dm-msg-body {
	background: rgba(255, 196, 0, 0.06);
	border-left: 0.1875rem solid var(--color-accent3);
	padding-left: 0.4375rem;
	border-radius: 0.1875rem;
}

/* Brief flash when scrolling to a pinned message */
.dm-msg--flash .dm-msg-body {
	animation: dm-msg-flash 1.2s ease-out;
}
@keyframes dm-msg-flash {
	0%   { background: rgba(255, 196, 0, 0.35); }
	100% { background: transparent; }
}

/* ── Composer extras (emoji + attach) ── */
.dm-composer-btn {
	width: 2rem;
	height: 2rem;
	border-radius: 0.375rem;
	border: 1px solid var(--color-brd);
	background: rgba(255, 255, 255, 0.04);
	color: var(--color-t1);
	font-size: 1rem;
	cursor: pointer;
	flex-shrink: 0;
	transition: background 0.12s, border-color 0.12s;
	display: flex;
	align-items: center;
	justify-content: center;
}
.dm-composer-btn:hover:not(:disabled) {
	background: rgba(255, 255, 255, 0.1);
	border-color: var(--color-brd2);
}
.dm-composer-btn:disabled { opacity: 0.4; cursor: default; }
.dm-file-input {
	display: none;
}

/* ── Pending attachment chips above the input ── */
.dm-pending-row {
	display: flex;
	flex-wrap: wrap;
	gap: 0.375rem;
	padding: 0.5rem 0.75rem 0;
	flex-shrink: 0;
}
.dm-pending-chip {
	display: inline-flex;
	align-items: center;
	gap: 0.375rem;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	padding: 0.25rem 0.375rem 0.25rem 0.25rem;
	font-size: 0.6875rem;
	max-width: 16rem;
}
.dm-pending-chip--err {
	border-color: var(--color-red);
	color: var(--color-red);
}
.dm-pending-thumb {
	width: 1.5rem;
	height: 1.5rem;
	object-fit: cover;
	border-radius: 0.25rem;
}
.dm-pending-icon { font-size: 0.875rem; }
.dm-pending-name {
	max-width: 9rem;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dm-pending-status { font-size: 0.6875rem; opacity: 0.85; }
.dm-pending-remove {
	background: none;
	border: 0;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.75rem;
	padding: 0 0.125rem;
	line-height: 1;
}
.dm-pending-remove:hover { color: var(--color-red); }

/* ── Rendered attachments inside messages ── */
.dm-attach-list {
	display: flex;
	flex-wrap: wrap;
	gap: 0.375rem;
	margin-top: 0.25rem;
}
.dm-attach-image {
	display: inline-block;
	max-width: 16rem;
	border-radius: 0.375rem;
	overflow: hidden;
	background: rgba(0, 0, 0, 0.2);
	line-height: 0;
	border: 1px solid var(--color-brd);
}
.dm-attach-image img {
	display: block;
	max-width: 100%;
	max-height: 14rem;
	height: auto;
	object-fit: contain;
}
.dm-attach-image-pending {
	display: inline-block;
	padding: 0.5rem 0.75rem;
	font-size: 0.75rem;
	color: var(--color-tm);
	line-height: 1.4;
}
.dm-attach-file {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	background: rgba(255, 255, 255, 0.05);
	border: 1px solid var(--color-brd);
	border-radius: 0.375rem;
	padding: 0.4375rem 0.625rem;
	color: var(--color-t1);
	text-decoration: none;
	font-size: 0.75rem;
	max-width: 18rem;
	transition: background 0.12s, border-color 0.12s;
}
.dm-attach-file:hover {
	background: rgba(255, 255, 255, 0.1);
	border-color: var(--color-brd2);
}
.dm-attach-icon { font-size: 1rem; }
.dm-attach-meta { display: flex; flex-direction: column; min-width: 0; }
.dm-attach-name {
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.dm-attach-size {
	font-size: 0.6875rem;
	color: var(--color-tm);
}

/* ── Members panel ── */
.dm-members-panel {
	border-bottom: 1px solid var(--color-brd);
	max-height: 40vh;
	overflow-y: auto;
	scrollbar-width: thin;
	flex-shrink: 0;
}
.dm-members-header {
	display: flex;
	align-items: center;
	padding: 0.375rem 0.75rem;
}
.dm-members-title {
	font-size: 0.6875rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--color-tm);
}
.dm-members-add-wrap {
	padding: 0 0.75rem 0.375rem;
}
.dm-members-search {
	width: 100%;
	background: rgba(0, 0, 0, 0.2);
	border: 1px solid var(--color-brd);
	border-radius: 0.3125rem;
	color: var(--color-t1);
	font-size: 0.75rem;
	padding: 0.3125rem 0.5rem;
	box-sizing: border-box;
}
.dm-members-search:focus { outline: none; border-color: var(--color-accent3); }
.dm-members-search::placeholder { color: var(--color-tm); opacity: 0.7; }
.dm-members-add-list {
	padding: 0 0.375rem 0.25rem;
	border-bottom: 1px solid var(--color-brd);
	margin-bottom: 0.25rem;
}
.dm-members-list {
	padding: 0.125rem 0.375rem 0.25rem;
}
.dm-member-row {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	padding: 0.25rem 0.375rem;
	border-radius: 0.25rem;
	transition: background 0.1s;
}
.dm-member-row--add {
	cursor: pointer;
}
.dm-member-row--add:hover {
	background: rgba(255, 255, 255, 0.04);
}
.dm-member-bubble {
	width: 1.375rem;
	height: 1.375rem;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.45rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.9);
	flex-shrink: 0;
}
.dm-member-name {
	flex: 1;
	font-size: 0.75rem;
	color: var(--color-t2);
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dm-member-you {
	font-size: 0.625rem;
	color: var(--color-tm);
}
.dm-member-action {
	flex-shrink: 0;
	background: none;
	border: none;
	font-size: 0.625rem;
	font-weight: 600;
	cursor: pointer;
	padding: 0.125rem 0.375rem;
	border-radius: 0.1875rem;
	transition: color 0.12s, background 0.12s;
}
.dm-member-action--add {
	color: var(--color-accent3);
}
.dm-member-action--add:hover {
	background: rgba(0, 180, 216, 0.15);
}
.dm-member-action--remove {
	color: var(--color-tm);
	opacity: 0;
}
.dm-member-row:hover .dm-member-action--remove {
	opacity: 1;
}
.dm-member-action--remove:hover {
	color: #f44336;
	background: rgba(244, 67, 54, 0.1);
}
.dm-leave-btn {
	display: block;
	width: calc(100% - 1.5rem);
	margin: 0.375rem 0.75rem;
	padding: 0.375rem;
	background: rgba(220, 53, 46, 0.12);
	border: 1px solid rgba(220, 53, 46, 0.45);
	border-radius: 0.3125rem;
	color: #e53935;
	font-size: 0.6875rem;
	font-weight: 700;
	cursor: pointer;
	text-align: center;
	transition: background 0.12s, border-color 0.12s;
}
.dm-leave-btn:hover {
	background: rgba(220, 53, 46, 0.22);
	border-color: #e53935;
}
html.light .dm-leave-btn {
	background: rgba(198, 40, 40, 0.08);
	border-color: rgba(198, 40, 40, 0.4);
	color: #c62828;
}
html.light .dm-leave-btn:hover {
	background: rgba(198, 40, 40, 0.16);
	border-color: #c62828;
}
.dm-members-empty {
	font-size: 0.6875rem;
	color: var(--color-tm);
	padding: 0.375rem;
	font-style: italic;
	text-align: center;
}

/* Light mode members */
html.light .dm-members-search { background: rgba(255, 255, 255, 0.6); }
html.light .dm-member-row--add:hover { background: rgba(0, 0, 0, 0.04); }

/* ── Slide-in transition ── */
.dm-slide-enter-active { transition: transform 0.2s ease, opacity 0.2s ease; }
.dm-slide-leave-active { transition: transform 0.15s ease, opacity 0.15s ease; }
.dm-slide-enter-from, .dm-slide-leave-to {
	transform: translateX(-1rem);
	opacity: 0;
}

/* ── Scrollbar ── */
.dm-messages::-webkit-scrollbar { width: 0.25rem; }
.dm-messages::-webkit-scrollbar-track { background: transparent; }
.dm-messages::-webkit-scrollbar-thumb { background: var(--color-brd2); border-radius: 0.125rem; }

/* ── Light theme ── */
html.light .dm-flyout { box-shadow: 0 8px 40px rgba(0, 0, 0, 0.18); }
html.light .dm-input  { background: rgba(255, 255, 255, 0.6); }
html.light .dm-reply-preview { background: rgba(0, 0, 0, 0.05); }
</style>
