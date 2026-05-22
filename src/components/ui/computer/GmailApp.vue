<script setup>
/**
 * GmailApp — Gmail tab inside the ComputerScreen overlay.
 * Inbox list, message reader, and compose/reply.
 */
import { ref, onMounted } from 'vue'
import { GmailApi, isGoogleAuthenticated, startGoogleAuthPopup, buildRawEmail } from '@/api/GoogleApi.js'

const view = ref('inbox') // 'inbox' | 'read' | 'compose'
const inbox = ref([])
const isLoading = ref(false)
const error = ref(null)
const selectedMsg = ref(null)
const selectedFull = ref(null)

// Compose state
const composeTo = ref('')
const composeSubject = ref('')
const composeBody = ref('')
const composeReplyMeta = ref(null) // { inReplyTo, references, threadId } when replying
const isSending = ref(false)

// ── Helpers ──────────────────────────────────────────────────

function getHeader (msg, name) {
	const h = msg?.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())
	return h?.value || ''
}

function formatDate (dateStr) {
	if (!dateStr) return ''
	const d = new Date(dateStr)
	const now = new Date()
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	}
	return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function extractHtmlBody (payload) {
	if (!payload) return ''
	// Direct body (non-multipart)
	if (payload.body?.data) {
		return decodeBase64Url(payload.body.data)
	}
	// Walk parts recursively
	if (payload.parts) {
		// Prefer text/html
		for (const part of payload.parts) {
			if (part.mimeType === 'text/html' && part.body?.data) {
				return decodeBase64Url(part.body.data)
			}
			if (part.parts) {
				const nested = extractHtmlBody(part)
				if (nested) return nested
			}
		}
		// Fallback to text/plain
		for (const part of payload.parts) {
			if (part.mimeType === 'text/plain' && part.body?.data) {
				const text = decodeBase64Url(part.body.data)
				return `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(text)}</pre>`
			}
		}
	}
	return '<p style="color:#8b949e">Unable to display message body.</p>'
}

function decodeBase64Url (data) {
	const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
	return decodeURIComponent(
		atob(base64).split('').map(c =>
			'%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
		).join('')
	)
}

function escapeHtml (str) {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function extractSenderName (from) {
	const match = from.match(/^"?([^"<]+)"?\s*</)
	return match ? match[1].trim() : from.split('@')[0]
}

// ── Inbox ────────────────────────────────────────────────────

async function fetchInbox () {
	if (!isGoogleAuthenticated()) return
	isLoading.value = true
	error.value = null
	try {
		const messages = await GmailApi.getInbox(20)
		if (!messages?.length) { inbox.value = []; return }
		// Fetch metadata in small batches to avoid 429 rate limits
		const results = []
		const BATCH = 4
		for (let i = 0; i < messages.length; i += BATCH) {
			const batch = messages.slice(i, i + BATCH)
			const fetched = await Promise.all(batch.map(m => GmailApi.getMessage(m.id)))
			results.push(...fetched)
			if (i + BATCH < messages.length) await new Promise(r => setTimeout(r, 200))
		}
		inbox.value = results
	} catch (e) {
		error.value = e.message || 'Failed to load inbox'
	} finally {
		isLoading.value = false
	}
}

// ── Read ─────────────────────────────────────────────────────

async function openMessage (msg) {
	selectedMsg.value = msg
	selectedFull.value = null
	view.value = 'read'
	try {
		selectedFull.value = await GmailApi.getFullMessage(msg.id)
	} catch (e) {
		error.value = e.message || 'Failed to load message'
	}
}

function backToInbox () {
	view.value = 'inbox'
	selectedMsg.value = null
	selectedFull.value = null
}

// ── Compose / Reply ──────────────────────────────────────────

function startCompose () {
	composeTo.value = ''
	composeSubject.value = ''
	composeBody.value = ''
	composeReplyMeta.value = null
	view.value = 'compose'
}

function startReply () {
	if (!selectedFull.value) return
	const from = getHeader(selectedFull.value, 'From')
	const subject = getHeader(selectedFull.value, 'Subject')
	const messageId = getHeader(selectedFull.value, 'Message-ID') || getHeader(selectedFull.value, 'Message-Id')
	composeTo.value = from
	composeSubject.value = subject.startsWith('Re:') ? subject : `Re: ${subject}`
	composeBody.value = ''
	composeReplyMeta.value = {
		inReplyTo: messageId,
		references: messageId,
		threadId: selectedFull.value.threadId,
	}
	view.value = 'compose'
}

async function sendEmail () {
	if (!composeTo.value.trim() || !composeBody.value.trim()) return
	isSending.value = true
	error.value = null
	try {
		const raw = buildRawEmail({
			to: composeTo.value,
			subject: composeSubject.value,
			body: composeBody.value,
			inReplyTo: composeReplyMeta.value?.inReplyTo,
			references: composeReplyMeta.value?.references,
		})
		const payload = { raw }
		if (composeReplyMeta.value?.threadId) payload.threadId = composeReplyMeta.value.threadId
		await GmailApi.sendMessage(payload)
		view.value = 'inbox'
		await fetchInbox()
	} catch (e) {
		if (e.status === 403 || e.message?.includes('403')) {
			error.value = 'Gmail send permission not granted. Please reconnect Google with updated permissions.'
		} else {
			error.value = e.message || 'Failed to send'
		}
	} finally {
		isSending.value = false
	}
}

function reconnectGoogle () {
	startGoogleAuthPopup(() => fetchInbox())
}

onMounted(() => {
	if (isGoogleAuthenticated()) fetchInbox()
})
</script>

<template>
	<div class="gmail-app">
		<!-- Not authenticated -->
		<div v-if="!isGoogleAuthenticated()" class="gmail-auth">
			<div class="gmail-auth-inner">
				<span class="gmail-auth-icon">&#9993;</span>
				<h3>Connect Gmail</h3>
				<p>Sign in with Google to access your inbox.</p>
				<button class="gmail-btn primary" @click="reconnectGoogle">Connect Google</button>
			</div>
		</div>

		<!-- Inbox view -->
		<template v-else-if="view === 'inbox'">
			<div class="gmail-toolbar">
				<h3 class="gmail-title">Inbox</h3>
				<div class="gmail-toolbar-actions">
					<button class="gmail-btn" @click="fetchInbox" :disabled="isLoading">
						{{ isLoading ? 'Loading...' : 'Refresh' }}
					</button>
					<button class="gmail-btn primary" @click="startCompose">Compose</button>
				</div>
			</div>
			<div v-if="error" class="gmail-error">
				{{ error }}
				<button v-if="error.includes('permission')" class="gmail-btn small" @click="reconnectGoogle">Reconnect</button>
			</div>
			<div class="gmail-inbox-list">
				<div v-if="isLoading && !inbox.length" class="gmail-loading">Loading inbox...</div>
				<div v-else-if="!inbox.length" class="gmail-empty">No messages</div>
				<div
					v-for="msg in inbox"
					:key="msg.id"
					class="gmail-row"
					:class="{ unread: msg.labelIds?.includes('UNREAD') }"
					@click="openMessage(msg)"
				>
					<div class="gmail-row-sender">{{ extractSenderName(getHeader(msg, 'From')) }}</div>
					<div class="gmail-row-content">
						<span class="gmail-row-subject">{{ getHeader(msg, 'Subject') || '(no subject)' }}</span>
						<span class="gmail-row-snippet"> &mdash; {{ msg.snippet }}</span>
					</div>
					<div class="gmail-row-date">{{ formatDate(getHeader(msg, 'Date')) }}</div>
				</div>
			</div>
		</template>

		<!-- Read view -->
		<template v-else-if="view === 'read'">
			<div class="gmail-toolbar">
				<button class="gmail-btn" @click="backToInbox">&larr; Back</button>
				<div class="gmail-toolbar-actions">
					<button class="gmail-btn primary" @click="startReply">Reply</button>
				</div>
			</div>
			<div v-if="error" class="gmail-error">{{ error }}</div>
			<div v-if="!selectedFull" class="gmail-loading">Loading message...</div>
			<template v-else>
				<div class="gmail-read-header">
					<h3 class="gmail-read-subject">{{ getHeader(selectedFull, 'Subject') || '(no subject)' }}</h3>
					<div class="gmail-read-meta">
						<span class="gmail-read-from">{{ getHeader(selectedFull, 'From') }}</span>
						<span class="gmail-read-date">{{ formatDate(getHeader(selectedFull, 'Date')) }}</span>
					</div>
					<div class="gmail-read-to">To: {{ getHeader(selectedFull, 'To') }}</div>
				</div>
				<div class="gmail-read-body">
					<iframe
						class="gmail-body-iframe"
						:srcdoc="extractHtmlBody(selectedFull.payload)"
						sandbox="allow-same-origin"
						referrerpolicy="no-referrer"
					></iframe>
				</div>
			</template>
		</template>

		<!-- Compose view -->
		<template v-else-if="view === 'compose'">
			<div class="gmail-toolbar">
				<button class="gmail-btn" @click="view = 'inbox'">&larr; Discard</button>
				<h3 class="gmail-title">{{ composeReplyMeta ? 'Reply' : 'New Message' }}</h3>
			</div>
			<div v-if="error" class="gmail-error">
				{{ error }}
				<button v-if="error.includes('permission')" class="gmail-btn small" @click="reconnectGoogle">Reconnect</button>
			</div>
			<div class="gmail-compose">
				<label class="gmail-field">
					<span>To</span>
					<input v-model="composeTo" type="text" placeholder="recipient@example.com" />
				</label>
				<label class="gmail-field">
					<span>Subject</span>
					<input v-model="composeSubject" type="text" placeholder="Subject" />
				</label>
				<textarea
					v-model="composeBody"
					class="gmail-compose-body"
					placeholder="Write your message..."
				></textarea>
				<div class="gmail-compose-actions">
					<button class="gmail-btn primary" @click="sendEmail" :disabled="isSending || !composeTo.trim()">
						{{ isSending ? 'Sending...' : 'Send' }}
					</button>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
.gmail-app {
	flex: 1;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	color: #000;
	font-size: 11px;
	background: #fff;
}

/* Auth */
.gmail-auth {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #c0c0c0;
}
.gmail-auth-inner { text-align: center; }
.gmail-auth-icon { font-size: 40px; display: block; margin-bottom: 8px; }
.gmail-auth-inner h3 { color: #000; margin: 0 0 6px; font-size: 13px; }
.gmail-auth-inner p { color: #444; margin: 0 0 12px; }

/* Toolbar — Win98 menu/toolbar look */
.gmail-toolbar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 3px 4px;
	background: #c0c0c0;
	border-bottom: 1px solid #808080;
}
.gmail-toolbar-actions { margin-left: auto; display: flex; gap: 4px; }
.gmail-title { margin: 0; font-size: 12px; font-weight: bold; color: #000; }

/* Win98 buttons */
.gmail-btn {
	padding: 3px 12px;
	background: #c0c0c0;
	border: 2px solid;
	border-color: #dfdfdf #808080 #808080 #dfdfdf;
	color: #000;
	font-size: 11px;
	font-family: inherit;
	cursor: pointer;
}
.gmail-btn:active { border-color: #808080 #dfdfdf #dfdfdf #808080; }
.gmail-btn:disabled { color: #808080; cursor: default; }
.gmail-btn.primary { font-weight: bold; }
.gmail-btn.small { padding: 2px 8px; font-size: 10px; margin-left: 6px; }

/* Error */
.gmail-error {
	padding: 4px 8px;
	background: #ffe0e0;
	color: #c00;
	font-size: 11px;
	border-bottom: 1px solid #808080;
}

/* Loading / empty */
.gmail-loading, .gmail-empty {
	padding: 32px 16px;
	text-align: center;
	color: #808080;
}

/* Inbox list */
.gmail-inbox-list {
	flex: 1;
	overflow-y: auto;
}
.gmail-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 3px 8px;
	border-bottom: 1px solid #e0e0e0;
	cursor: default;
}
.gmail-row:hover { background: #000080; color: #fff; }
.gmail-row:hover .gmail-row-sender,
.gmail-row:hover .gmail-row-subject,
.gmail-row:hover .gmail-row-snippet,
.gmail-row:hover .gmail-row-date { color: #fff; }
.gmail-row.unread { font-weight: bold; }

.gmail-row-sender {
	width: 140px;
	flex-shrink: 0;
	font-size: 11px;
	color: #000;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.gmail-row-content {
	flex: 1;
	font-size: 11px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.gmail-row-subject { color: #000; }
.gmail-row-snippet { color: #808080; }
.gmail-row-date {
	flex-shrink: 0;
	font-size: 11px;
	color: #808080;
}

/* Read view */
.gmail-read-header {
	padding: 8px;
	background: #c0c0c0;
	border-bottom: 1px solid #808080;
}
.gmail-read-subject { margin: 0 0 4px; color: #000; font-size: 13px; font-weight: bold; }
.gmail-read-meta { display: flex; gap: 12px; font-size: 11px; margin-bottom: 2px; }
.gmail-read-from { color: #000; }
.gmail-read-date { color: #444; }
.gmail-read-to { font-size: 11px; color: #444; }

.gmail-read-body {
	flex: 1;
	overflow: hidden;
	display: flex;
}
.gmail-body-iframe {
	flex: 1;
	border: none;
	background: #fff;
}

/* Compose view */
.gmail-compose {
	flex: 1;
	display: flex;
	flex-direction: column;
	padding: 8px;
	gap: 6px;
	background: #c0c0c0;
}
.gmail-field {
	display: flex;
	align-items: center;
	gap: 6px;
}
.gmail-field span {
	width: 50px;
	font-size: 11px;
	color: #000;
	flex-shrink: 0;
	text-align: right;
}
.gmail-field input {
	flex: 1;
	padding: 2px 4px;
	background: #fff;
	border: 2px solid;
	border-color: #808080 #dfdfdf #dfdfdf #808080;
	color: #000;
	font-size: 11px;
	font-family: inherit;
	outline: none;
}

.gmail-compose-body {
	flex: 1;
	padding: 4px;
	background: #fff;
	border: 2px solid;
	border-color: #808080 #dfdfdf #dfdfdf #808080;
	color: #000;
	font-size: 11px;
	font-family: inherit;
	resize: none;
	outline: none;
}

.gmail-compose-actions {
	display: flex;
	justify-content: flex-end;
	padding-top: 4px;
}
</style>
