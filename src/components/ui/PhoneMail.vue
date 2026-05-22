<script setup>
/**
 * PhoneMail — Gmail inbox / read / compose for the phone overlay.
 *
 * Uses the same GmailApi as the computer screen's GmailApp, but rendered
 * in a phone-friendly stack (sender + subject + snippet rows, full-screen
 * read with iframed HTML body, slide-in compose).
 */
import { ref, onMounted } from 'vue'
import { ChevronLeft as ChevronLeftIcon, RefreshCw as ArrowPathIcon, PenSquare as PencilSquareIcon, CornerUpLeft as ArrowUturnLeftIcon, Send as PaperAirplaneIcon } from '@lucide/vue'
import { GmailApi, isGoogleAuthenticated, startGoogleAuthPopup, buildRawEmail } from '@/api/GoogleApi.js'
import { sanitizeHtml, wrapAsIframeDoc, plainTextToHtml } from '@/utils/sanitizeBodyHtml.js'

const view = ref('inbox') // 'inbox' | 'read' | 'compose'
const inbox = ref([])
const isLoading = ref(false)
const error = ref(null)
const selectedMsg = ref(null)
const selectedFull = ref(null)

const composeTo = ref('')
const composeSubject = ref('')
const composeBody = ref('')
const composeReplyMeta = ref(null)
const isSending = ref(false)

// ── Helpers (parity with GmailApp.vue) ──────────────────────────────────
function getHeader(msg, name) {
	const h = msg?.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())
	return h?.value || ''
}
function formatDate(dateStr) {
	if (!dateStr) return ''
	const d = new Date(dateStr)
	const now = new Date()
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
	}
	const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
	if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' })
	return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}
function decodeBase64Url(data) {
	const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
	return decodeURIComponent(
		atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
	)
}
/**
 * Build a self-contained, sandboxable HTML document for the email body so
 * the iframe gets:
 *   - all script-execution surfaces stripped (no console warnings)
 *   - <base target="_blank"> so anchors open in a new tab when clicked
 */
function bodyDoc(payload) {
	const raw = pickBody(payload)
	return wrapAsIframeDoc(raw)
}

function pickBody(payload) {
	if (!payload) return '<p style="color:#94a3b8">Unable to display message body.</p>'
	if (payload.body?.data) return sanitizeHtml(decodeBase64Url(payload.body.data))
	if (payload.parts) {
		for (const part of payload.parts) {
			if (part.mimeType === 'text/html' && part.body?.data) return sanitizeHtml(decodeBase64Url(part.body.data))
			if (part.parts) {
				const nested = pickBody(part)
				if (nested && !nested.startsWith('<p style="color:#94a3b8"')) return nested
			}
		}
		for (const part of payload.parts) {
			if (part.mimeType === 'text/plain' && part.body?.data) {
				return `<div style="white-space:pre-wrap;font-family:inherit;margin:0">${plainTextToHtml(decodeBase64Url(part.body.data))}</div>`
			}
		}
	}
	return '<p style="color:#94a3b8">Unable to display message body.</p>'
}
function extractSenderName(from) {
	const match = from.match(/^"?([^"<]+)"?\s*</)
	return match ? match[1].trim() : from.split('@')[0]
}
function extractSenderInitial(from) {
	const name = extractSenderName(from)
	return (name[0] || '?').toUpperCase()
}
function senderColor(from) {
	let h = 0
	for (let i = 0; i < from.length; i++) h = (h * 31 + from.charCodeAt(i)) >>> 0
	return `hsl(${h % 360}, 50%, 50%)`
}

// ── Inbox ──────────────────────────────────────────────────────────────
async function fetchInbox() {
	if (!isGoogleAuthenticated()) return
	isLoading.value = true
	error.value = null
	try {
		const messages = await GmailApi.getInbox(20)
		if (!messages?.length) { inbox.value = []; return }
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

// ── Read ───────────────────────────────────────────────────────────────
async function openMessage(msg) {
	selectedMsg.value = msg
	selectedFull.value = null
	view.value = 'read'
	try {
		selectedFull.value = await GmailApi.getFullMessage(msg.id)
	} catch (e) {
		error.value = e.message || 'Failed to load message'
	}
	// TODO(mark-as-read): re-enable once the OAuth token has gmail.modify scope.
	// Without that scope GmailApi.markRead returns 403, so leaving this commented
	// out for now to avoid spurious console errors. The optimistic UI update is
	// also disabled so the unread dot keeps reflecting Gmail's actual state.
	// if (msg.labelIds?.includes('UNREAD')) {
	// 	const idx = inbox.value.findIndex(m => m.id === msg.id)
	// 	if (idx >= 0) {
	// 		const updated = { ...inbox.value[idx], labelIds: inbox.value[idx].labelIds.filter(l => l !== 'UNREAD') }
	// 		inbox.value = [...inbox.value.slice(0, idx), updated, ...inbox.value.slice(idx + 1)]
	// 	}
	// 	try { await GmailApi.markRead(msg.id) }
	// 	catch (e) { console.warn('[phone-mail] markRead failed:', e?.message || e) }
	// }
}

function backToInbox() {
	view.value = 'inbox'
	selectedMsg.value = null
	selectedFull.value = null
	error.value = null
}

// ── Compose ────────────────────────────────────────────────────────────
function startCompose() {
	composeTo.value = ''
	composeSubject.value = ''
	composeBody.value = ''
	composeReplyMeta.value = null
	view.value = 'compose'
}

function startReply() {
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

async function sendEmail() {
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
			error.value = 'Gmail send permission not granted. Reconnect Google with updated permissions.'
		} else {
			error.value = e.message || 'Failed to send'
		}
	} finally {
		isSending.value = false
	}
}

function reconnectGoogle() {
	startGoogleAuthPopup(() => fetchInbox())
}

onMounted(() => {
	if (isGoogleAuthenticated()) fetchInbox()
})
</script>

<template>
	<div class="pm-mail">
		<!-- Not authenticated -->
		<div v-if="!isGoogleAuthenticated()" class="pm-auth">
			<div class="pm-auth-icon">📧</div>
			<div class="pm-auth-title">Connect Gmail</div>
			<div class="pm-auth-sub">Sign in with Google to read and send mail.</div>
			<button class="pm-cta" @click="reconnectGoogle">Connect Google</button>
		</div>

		<!-- Inbox -->
		<template v-else-if="view === 'inbox'">
			<div class="pm-toolbar">
				<button class="pm-icon-btn" @click="fetchInbox" :disabled="isLoading" title="Refresh">
					<ArrowPathIcon class="pm-icon-svg" :class="{ spin: isLoading }" />
				</button>
				<div class="pm-toolbar-title">Inbox</div>
				<button class="pm-icon-btn" @click="startCompose" title="Compose">
					<PencilSquareIcon class="pm-icon-svg" />
				</button>
			</div>
			<div v-if="error" class="pm-error">
				{{ error }}
				<button v-if="error.includes('permission')" class="pm-link" @click="reconnectGoogle">Reconnect</button>
			</div>
			<div class="pm-list">
				<div v-if="isLoading && !inbox.length" class="pm-state">Loading inbox…</div>
				<div v-else-if="!inbox.length" class="pm-state">No messages</div>
				<button
					v-for="msg in inbox"
					:key="msg.id"
					class="pm-row"
					:class="{ unread: msg.labelIds?.includes('UNREAD') }"
					@click="openMessage(msg)"
				>
					<span class="pm-avatar" :style="{ background: senderColor(getHeader(msg, 'From')) }">
						{{ extractSenderInitial(getHeader(msg, 'From')) }}
					</span>
					<span class="pm-row-text">
						<span class="pm-row-top">
							<span class="pm-row-sender">{{ extractSenderName(getHeader(msg, 'From')) }}</span>
							<span class="pm-row-date">{{ formatDate(getHeader(msg, 'Date')) }}</span>
						</span>
						<span class="pm-row-subject">{{ getHeader(msg, 'Subject') || '(no subject)' }}</span>
						<span class="pm-row-snippet">{{ msg.snippet }}</span>
					</span>
					<span v-if="msg.labelIds?.includes('UNREAD')" class="pm-unread-dot"></span>
				</button>
			</div>
		</template>

		<!-- Read -->
		<template v-else-if="view === 'read'">
			<div class="pm-toolbar">
				<button class="pm-icon-btn" @click="backToInbox" title="Back">
					<ChevronLeftIcon class="pm-icon-svg" />
				</button>
				<div class="pm-toolbar-title">Message</div>
				<button class="pm-icon-btn" @click="startReply" title="Reply" :disabled="!selectedFull">
					<ArrowUturnLeftIcon class="pm-icon-svg" />
				</button>
			</div>
			<div v-if="error" class="pm-error">{{ error }}</div>
			<div v-if="!selectedFull" class="pm-state">Loading message…</div>
			<template v-else>
				<div class="pm-read-header">
					<div class="pm-read-subject">{{ getHeader(selectedFull, 'Subject') || '(no subject)' }}</div>
					<div class="pm-read-from-row">
						<span class="pm-avatar pm-avatar-sm" :style="{ background: senderColor(getHeader(selectedFull, 'From')) }">
							{{ extractSenderInitial(getHeader(selectedFull, 'From')) }}
						</span>
						<div class="pm-read-from-text">
							<div class="pm-read-from">{{ extractSenderName(getHeader(selectedFull, 'From')) }}</div>
							<div class="pm-read-date">{{ formatDate(getHeader(selectedFull, 'Date')) }}</div>
						</div>
					</div>
				</div>
				<div class="pm-read-body">
					<iframe
						class="pm-body-iframe"
						:srcdoc="bodyDoc(selectedFull.payload)"
						sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
						referrerpolicy="no-referrer"
					></iframe>
				</div>
			</template>
		</template>

		<!-- Compose -->
		<template v-else-if="view === 'compose'">
			<div class="pm-toolbar">
				<button class="pm-icon-btn" @click="view = selectedFull ? 'read' : 'inbox'" title="Discard">
					<ChevronLeftIcon class="pm-icon-svg" />
				</button>
				<div class="pm-toolbar-title">{{ composeReplyMeta ? 'Reply' : 'New Message' }}</div>
				<button class="pm-icon-btn pm-send" @click="sendEmail" :disabled="isSending || !composeTo.trim() || !composeBody.trim()" title="Send">
					<PaperAirplaneIcon class="pm-icon-svg" />
				</button>
			</div>
			<div v-if="error" class="pm-error">
				{{ error }}
				<button v-if="error.includes('permission')" class="pm-link" @click="reconnectGoogle">Reconnect</button>
			</div>
			<div class="pm-compose">
				<div class="pm-field">
					<label>To</label>
					<input v-model="composeTo" type="text" placeholder="recipient@example.com" autofocus />
				</div>
				<div class="pm-field">
					<label>Subject</label>
					<input v-model="composeSubject" type="text" placeholder="Subject" />
				</div>
				<textarea
					v-model="composeBody"
					class="pm-compose-body"
					placeholder="Write your message…"
				></textarea>
				<div v-if="isSending" class="pm-state pm-state-sm">Sending…</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
/* The phone screen passes us a dark gradient bg from PhoneOverlay's .ph-screen.
   Inside Mail we use a light card-like surface so it reads like an iOS Mail app. */
.pm-mail {
	flex: 1;
	display: flex;
	flex-direction: column;
	background: #f8fafc;
	color: #0f172a;
	overflow: hidden;
	font-size: 0.8125rem;
}

/* Auth */
.pm-auth {
	flex: 1;
	display: flex; flex-direction: column;
	align-items: center; justify-content: center;
	gap: 0.5rem;
	padding: 1.5rem;
	text-align: center;
}
.pm-auth-icon { font-size: 2.25rem; }
.pm-auth-title { font-size: 1rem; font-weight: 600; color: #0f172a; }
.pm-auth-sub { font-size: 0.75rem; color: #64748b; margin-bottom: 0.5rem; }
.pm-cta {
	padding: 0.5rem 1rem;
	border-radius: 0.5rem;
	border: none;
	background: #2563eb;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
}
.pm-cta:hover { background: #1d4ed8; }

/* Toolbar */
.pm-toolbar {
	display: flex; align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 0.625rem;
	background: #ffffff;
	border-bottom: 1px solid #e2e8f0;
	flex-shrink: 0;
}
.pm-toolbar-title {
	flex: 1;
	font-size: 0.875rem;
	font-weight: 600;
	color: #0f172a;
	text-align: center;
}
.pm-icon-btn {
	width: 2rem; height: 2rem;
	display: flex; align-items: center; justify-content: center;
	border: none;
	background: none;
	color: #2563eb;
	cursor: pointer;
	border-radius: 0.375rem;
}
.pm-icon-btn:hover:not(:disabled) { background: #eff6ff; }
.pm-icon-btn:disabled { color: #cbd5e1; cursor: default; }
.pm-icon-svg { width: 1.125rem; height: 1.125rem; }
.pm-icon-svg.spin { animation: pm-spin 0.8s linear infinite; }
@keyframes pm-spin { to { transform: rotate(360deg); } }
.pm-send { color: #2563eb; }

/* Error */
.pm-error {
	padding: 0.5rem 0.75rem;
	background: #fef2f2;
	color: #991b1b;
	font-size: 0.6875rem;
	border-bottom: 1px solid #fecaca;
	display: flex; align-items: center; gap: 0.375rem;
}
.pm-link {
	background: none; border: none;
	color: #1d4ed8;
	font-size: 0.6875rem;
	cursor: pointer;
	text-decoration: underline;
	padding: 0;
}

/* List */
.pm-list {
	flex: 1;
	overflow-y: auto;
	background: #ffffff;
}
.pm-state {
	padding: 2rem 1rem;
	text-align: center;
	font-size: 0.75rem;
	color: #94a3b8;
	font-style: italic;
}
.pm-state-sm { padding: 0.5rem; }

.pm-row {
	width: 100%;
	display: flex;
	align-items: flex-start;
	gap: 0.625rem;
	padding: 0.5rem 0.75rem;
	background: none;
	border: none;
	border-bottom: 1px solid #f1f5f9;
	cursor: pointer;
	text-align: left;
	font-family: inherit;
	color: inherit;
	position: relative;
}
.pm-row:hover { background: #f8fafc; }

.pm-avatar {
	flex-shrink: 0;
	width: 2rem; height: 2rem;
	border-radius: 50%;
	display: flex; align-items: center; justify-content: center;
	color: #fff;
	font-size: 0.75rem;
	font-weight: 600;
}
.pm-avatar-sm { width: 1.75rem; height: 1.75rem; font-size: 0.6875rem; }

.pm-row-text {
	flex: 1; min-width: 0;
	display: flex; flex-direction: column;
	gap: 0.0625rem;
}
.pm-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
.pm-row-sender {
	font-size: 0.8125rem;
	font-weight: 500;
	color: #0f172a;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.pm-row.unread .pm-row-sender { font-weight: 700; }
.pm-row-date {
	flex-shrink: 0;
	font-size: 0.6875rem;
	color: #64748b;
}
.pm-row-subject {
	font-size: 0.75rem;
	color: #0f172a;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.pm-row.unread .pm-row-subject { font-weight: 600; }
.pm-row-snippet {
	font-size: 0.6875rem;
	color: #64748b;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.pm-unread-dot {
	position: absolute;
	top: 0.625rem; left: 0.25rem;
	width: 0.375rem; height: 0.375rem;
	border-radius: 50%;
	background: #2563eb;
}

/* Read view */
.pm-read-header {
	padding: 0.875rem 0.875rem 0.625rem;
	background: #ffffff;
	border-bottom: 1px solid #e2e8f0;
}
.pm-read-subject {
	font-size: 0.9375rem;
	font-weight: 700;
	color: #0f172a;
	margin-bottom: 0.5rem;
	line-height: 1.3;
}
.pm-read-from-row { display: flex; align-items: center; gap: 0.5rem; }
.pm-read-from-text { display: flex; flex-direction: column; gap: 0.0625rem; min-width: 0; }
.pm-read-from { font-size: 0.75rem; font-weight: 600; color: #0f172a; }
.pm-read-date { font-size: 0.6875rem; color: #64748b; }

.pm-read-body {
	flex: 1;
	overflow: hidden;
	display: flex;
	background: #fff;
}
.pm-body-iframe {
	flex: 1;
	border: none;
	background: #fff;
}

/* Compose */
.pm-compose {
	flex: 1;
	display: flex; flex-direction: column;
	gap: 0;
	background: #fff;
	overflow: hidden;
}
.pm-field {
	display: flex; align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 0.75rem;
	border-bottom: 1px solid #f1f5f9;
}
.pm-field label {
	font-size: 0.6875rem;
	font-weight: 600;
	color: #64748b;
	width: 3rem;
	flex-shrink: 0;
}
.pm-field input {
	flex: 1;
	border: none;
	background: none;
	font-size: 0.8125rem;
	color: #0f172a;
	font-family: inherit;
	outline: none;
	padding: 0.125rem 0;
}
.pm-compose-body {
	flex: 1;
	border: none;
	padding: 0.625rem 0.75rem;
	font-size: 0.8125rem;
	color: #0f172a;
	font-family: inherit;
	resize: none;
	outline: none;
	background: #fff;
}
</style>
