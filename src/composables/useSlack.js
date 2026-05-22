/**
 * useSlack — Slack member sync, status, and DM client.
 *
 * Reactive state is module-level so all callers share one data pool.
 * Only the instance that calls start() drives the polling timers.
 *
 * Polling cadence:
 *   • users.list         — every 5 min (member list + status sync)
 *   • dm unread counts   — every 20 s (conversations.info per IM channel)
 *   • active DM thread   — every 15 s (conversations.history oldest=lastTs; skipped when tab hidden)
 */
import { ref, computed } from 'vue'
import SlackApi from '@/api/SlackApi.js'
import { slackStatusFromProfile } from '@/utils/slackStatusFormat.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'

const STATUS_POLL_MS = 5 * 60_000   // re-fetch member list + statuses every 5 min

// ── Shared module-level state (all useSlack() callers see the same data) ──
const members        = ref([])
const memberByEmail  = ref({})
const memberById     = ref({})
const isLoaded       = ref(false)
const error          = ref(null)
const lastSync       = ref(null)
const presenceMap    = ref({})   // slackId → 'active' | 'away'
const myChannels        = ref([])    // conversations the user is a member of
const myChannelsLoading = ref(false)

// ── DM client state ──────────────────────────────────────────────────
const activeDmChannel = ref(null)    // currently open channel object or null
const dmMessages      = ref([])      // messages oldest→newest for active channel
const dmLoading       = ref(false)
const dmUnreadCounts  = ref({})      // channelId → unread count (mentions for named channels, all for DMs)
const channelHasUnread = ref({})     // channelId → true when unread but no @mention (named channels only)
let   dmPollTimer           = null
let   unreadPollTimer       = null   // DM-only badge poll (every 90s)
let   channelPollTimer      = null   // named-channel badge poll (every 5 min)
let   unreadPollRunning     = false  // prevents concurrent DM poll cycles
let   channelPollRunning    = false  // prevents concurrent channel poll cycles

const totalDmUnread = computed(() =>
	Object.values(dmUnreadCounts.value).reduce((s, n) => s + (n || 0), 0),
)

const onlineSlackIds = computed(() =>
	members.value
		.filter(m => m._presence === 'active')
		.map(m => m.id),
)

const PRESENCE_CACHE_MS = 5 * 60_000
let presenceLastFetch = 0
let statusTimer = null

// ── Rate-limit backoff ────────────────────────────────────────────────
// When Slack returns 429, pause all polling until retry_after elapses.
// Also skip polls while the tab is hidden — no need to burn quota for
// a user who isn't looking at the screen.
let _slackPausedUntil = 0
function slackRateLimited(err) {
	const retryAfter = (err?.retryAfter || 60) * 1000
	_slackPausedUntil = Date.now() + retryAfter
}
function isSlackPaused() { return document.hidden || Date.now() < _slackPausedUntil }

export function useSlack() {
	const presenceStore = usePresenceStore()
	const avatarStore   = useAvatarStore()

	// ── Bootstrap: load all members once ────────────────────────────
	async function loadMembers() {
		if (isSlackPaused()) return
		error.value = null
		try {
			const raw = await SlackApi.getMembers()

			members.value = raw
			memberByEmail.value = {}
			memberById.value = {}
			for (const m of raw) {
				if (m.profile?.email) memberByEmail.value[m.profile.email.toLowerCase()] = m
				memberById.value[m.id] = m
			}

			isLoaded.value = true
			lastSync.value = new Date()

			await syncStatuses()
			// Fetch own profile fresh (users.list can be stale for status changes)
			if (avatarStore.slackUserToken && avatarStore.slackId) {
				try {
					const ownProfile = await SlackApi.getUserProfile(avatarStore.slackId)
					await avatarStore.setSlackFromSync(ownProfile)
				} catch (pe) {
					console.warn('[slack] own profile refresh failed:', pe.message)
				}
			}
		} catch (e) {
			if (e.message?.includes('ratelimited')) slackRateLimited(e)
			error.value = e.message
			console.warn('[slack] loadMembers failed:', e.message)
		}
	}

	// ── Sync Slack profiles → presenceStore ─────────────────────────
	async function syncStatuses() {
		if (!isLoaded.value) return
		for (const member of members.value) {
			applyMemberToPresence(member)
		}
	}

	// Strip punctuation that may differ between systems (apostrophes, hyphens, periods)
	// so "O'Brien" matches "OBrien", "Smith-Jones" matches "SmithJones", etc.
	// Strip possessive 's first so "OBrien's" → "OBrien" (not "OBriens"),
	// then strip remaining apostrophes/hyphens/dots.
	function normalizeWord(w) { return w.replace(/['\u2019]s\b/gi, '').replace(/['\u2019\-.]/g, '') }

	function applyMemberToPresence(member) {
		const slackEmail    = member.profile?.email?.toLowerCase() || ''
		const slackRealName = (member.profile?.real_name || '').toLowerCase().trim()

		// Match priority: SlackId (stable) → AvaEmail → SP email → display name
		// Name match uses word-subset: all words from the AVA name must appear in
		// the Slack real_name, so "Bruce Lee" matches "Bruce Jeong Lee".
		// Requires ≥ 2 words to prevent accidental single-word collisions.
		// Words are normalized to strip apostrophes/hyphens before comparing.
		const slackNameWords = slackRealName.split(/\s+/).filter(Boolean).map(normalizeWord)
		const existing =
			presenceStore.users.find(u => u.slackId  && u.slackId === member.id) ||
			(slackEmail && presenceStore.users.find(u =>
				(u.avaEmail && u.avaEmail.toLowerCase() === slackEmail) ||
				(u.email    && u.email.toLowerCase()    === slackEmail)
			)) ||
			(slackRealName && presenceStore.users.find(u => {
				const avaWords = (u.name || '').toLowerCase().trim().split(/\s+/).filter(Boolean).map(normalizeWord)
				return (avaWords.length >= 2 && avaWords.every(w => slackNameWords.includes(w))) ||
				       (slackNameWords.length >= 1 && slackNameWords.every(w => avaWords.includes(w)))
			}))

		if (!existing) return

		const slackStatus   = buildStatusText(member)
		const slackPresence = member._presence

		// Update local user's store if this Slack member is me
		const myName = avatarStore.displayName?.toLowerCase().trim()
		const isMe   = myName && existing.name?.toLowerCase().trim() === myName
		if (isMe) {
			void avatarStore.setSlackFromSync(member.profile)
			void avatarStore.setSlackIdentity(member.id, slackEmail)
		}

		// Only promote offline → online when Slack confirms active.
		// Never demote: QuickerStorm heartbeat stale-check (2 min) is the authoritative
		// offline signal — Slack marks 'away' for any idle user, including people
		// actively in QuickerStorm who haven't touched Slack recently.
		let reconciledStatus = existing.status
		if (!isMe && slackPresence === 'active' && existing.status === 'offline') {
			reconciledStatus = 'online'
		}

		presenceStore.upsertUser({
			...existing,
			slackStatus,
			slackId:   member.id,
			avaEmail:  slackEmail || existing.avaEmail || '',
			avatarUrl: existing.avatarUrl || member.profile?.image_192 || null,
			status:    reconciledStatus,
		})
	}

	function buildStatusText(member) {
		return slackStatusFromProfile(member)
	}

	// ── Lookup helpers ───────────────────────────────────────────────

	function getByEmail(email) {
		return memberByEmail.value[email?.toLowerCase()] || null
	}

	function getMember(slackId) {
		return memberById.value[slackId] || null
	}

	async function setMyStatus(userToken, text, emoji = '', expiration = 0) {
		if (!userToken) {
			console.warn('[slack] setMyStatus: no user token — set up user OAuth first')
			return
		}
		return SlackApi.setStatus(userToken, text, emoji, expiration)
	}

	async function clearMyStatus() {
		const token = avatarStore.slackUserToken
		if (!token) {
			console.warn('[slack] clearMyStatus: no user token')
			return
		}
		return SlackApi.clearStatus(token)
	}

	/** Map QuickerStorm presence to Slack client presence (green vs away). Requires user token. */
	async function pushMyPresenceToSlack() {
		const token = avatarStore.slackUserToken
		if (!token) return
		try {
			const presence =
				avatarStore.status === 'away' || avatarStore.status === 'offline' ? 'away' : 'auto'
			await SlackApi.setUserPresence(token, presence)
		} catch (e) {
			console.warn('[slack] pushMyPresenceToSlack:', e.message)
		}
	}

	async function dmByEmail(email, text) {
		const member = getByEmail(email)
		if (!member) throw new Error(`Slack user not found for ${email}`)
		return SlackApi.sendDM(member.id, text)
	}

	/**
	 * DM a presence-store user object.
	 * Resolves the Slack member by slackId → avaEmail → SP email → display name.
	 */
	async function dmUser(presenceUser, text, { forceBot = false } = {}) {
		// Use the authenticated user's own token if available (DM appears from them, not QuickerStorm).
		// Pass forceBot:true to always send as the QuickerStorm app (e.g. invites).
		const userToken = forceBot ? undefined : (avatarStore.slackUserToken || undefined)

		async function sendAndTrackRead(promise) {
			const r = await promise
			if (userToken && r?.channel && r?.ts) registerOutgoingDmRead(r.channel, r.ts)
			return r
		}

		// 1. Direct Slack member ID (fastest, most reliable)
		if (presenceUser.slackId && memberById.value[presenceUser.slackId]) {
			return sendAndTrackRead(SlackApi.sendDM(presenceUser.slackId, text, userToken))
		}
		// 2. AVA email (@avatechnologyllc.com) — matches Slack profile email index
		if (presenceUser.avaEmail) {
			const m = getByEmail(presenceUser.avaEmail)
			if (m) return sendAndTrackRead(SlackApi.sendDM(m.id, text, userToken))
		}
		// 3. SP/MS email — unlikely to match but worth a try
		if (presenceUser.email) {
			const m = getByEmail(presenceUser.email)
			if (m) return sendAndTrackRead(SlackApi.sendDM(m.id, text, userToken))
		}
		// 4. Name match — same logic as applyMemberToPresence uses
		const targetName = presenceUser.name?.toLowerCase().trim()
		if (targetName) {
			const byName = members.value.find(m => {
				const rn = (m.profile?.real_name    || '').toLowerCase().trim()
				const dn = (m.profile?.display_name || '').toLowerCase().trim()
				if (rn === targetName || dn === targetName) return true
				// Word-subset: all words from the AVA name must appear in the Slack real_name
				const targetWords = targetName.split(/\s+/).filter(Boolean)
				const rnWords     = rn.split(/\s+/)
				return targetWords.length >= 2 && targetWords.every(w => rnWords.includes(w))
			})
			if (byName) return sendAndTrackRead(SlackApi.sendDM(byName.id, text, userToken))
		}
		throw new Error(`Slack user not found for ${presenceUser.name || presenceUser.email}`)
	}

	// ── My channels (cached) ─────────────────────────────────────────
	async function fetchMyChannels() {
		const token = avatarStore.slackUserToken
		if (!token || myChannelsLoading.value) return
		myChannelsLoading.value = true
		try {
			const raw = await SlackApi.getMyConversations(token)
			// For IM channels, resolve the other person's display name
			myChannels.value = raw.map(ch => {
				if (ch.is_im && ch.user) {
					const m = memberById.value[ch.user]
					ch._dmName = m?.profile?.display_name || m?.real_name || ch.user
					ch._dmColor = m ? slackColorById(ch.user) : '#3d5470'
				}
				return ch
			})
			const starredChs = myChannels.value.filter(c => c.is_starred)
			console.log('[slack] fetchMyChannels: total', raw.length,
				'| starred:', starredChs.length,
				starredChs.length ? starredChs.map(c => c.name || c.id) : '(none have is_starred)')
		} catch (e) {
			console.warn('[slack] fetchMyChannels failed:', e.message)
		} finally {
			myChannelsLoading.value = false
		}
	}

	function slackColorById(id) {
		const palette = ['#3d5470','#4a6070','#3a5868','#445e70','#506070']
		let h = 0
		for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
		return palette[h % palette.length]
	}

	// ── Presence for panel users (rate-limited, cached 5 min) ────────
	/**
	 * Fetch presence for a list of Slack member IDs.
	 * Fires in the background — presenceMap updates reactively as each
	 * result arrives (1 call per 1.2 s to stay within Tier-1 rate limit).
	 * Skips the whole fetch if called again within the cache window.
	 */
	async function fetchPanelPresence(memberIds) {
		if (!memberIds.length) return
		if (Date.now() - presenceLastFetch < PRESENCE_CACHE_MS) return
		presenceLastFetch = Date.now()

		for (const id of memberIds) {
			try {
				const presence = await SlackApi.getPresence(id)
				presenceMap.value[id] = presence   // 'active' | 'away'
			} catch { /* skip on error */ }
			await new Promise(r => setTimeout(r, 1200))
		}
	}

	// ── DM client ────────────────────────────────────────────────────

	async function openDm(channel) {
		if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null }
		activeDmChannel.value = channel
		dmMessages.value = []
		await loadDmHistory(channel.id)
		// Clear unread badge and mark read in Slack
		dmUnreadCounts.value = { ...dmUnreadCounts.value, [channel.id]: 0 }
		const latestTs = dmMessages.value.at(-1)?.ts
		if (latestTs && avatarStore.slackUserToken) {
			channel.last_read = latestTs   // keep cache in sync so pollUnreadCounts doesn't re-badge
			SlackApi.markConversationRead(channel.id, latestTs, avatarStore.slackUserToken).catch(() => {})
		}
		dmPollTimer = setInterval(pollDmMessages, 15_000)
	}

	function closeDm() {
		if (dmPollTimer) { clearInterval(dmPollTimer); dmPollTimer = null }
		activeDmChannel.value = null
		dmMessages.value = []
	}

	async function loadDmHistory(channelId) {
		const token = avatarStore.slackUserToken
		if (!token) return
		dmLoading.value = true
		try {
			const { messages } = await SlackApi.getConversationHistory(channelId, token, { limit: 40 })
			dmMessages.value = messages.slice().reverse()  // Slack returns newest-first
		} catch (e) {
			console.warn('[slack] loadDmHistory failed:', e.message)
		} finally {
			dmLoading.value = false
		}
	}

	async function pollDmMessages() {
		if (isSlackPaused()) return
		const ch    = activeDmChannel.value
		const token = avatarStore.slackUserToken
		if (!ch || !token) return
		const lastTs = dmMessages.value.at(-1)?.ts
		try {
			const { messages } = await SlackApi.getConversationHistory(ch.id, token, { oldest: lastTs, limit: 10 })
			if (messages.length) {
				const newer = messages.slice().reverse()
				dmMessages.value = [...dmMessages.value, ...newer]
				const newestTs = newer.at(-1).ts
				ch.last_read = newestTs   // keep cache in sync
				SlackApi.markConversationRead(ch.id, newestTs, token).catch(() => {})
			}
		} catch (e) {
			if (e.message?.includes('ratelimited')) slackRateLimited(e)
			console.warn('[slack] pollDmMessages failed:', e.message)
		}
	}

	function registerOutgoingDmRead(channelId, ts) {
		const token = avatarStore.slackUserToken
		if (!channelId || !ts || !token) return
		const ch = myChannels.value.find(c => c.id === channelId)
		if (ch) ch.last_read = ts
		SlackApi.markConversationRead(channelId, ts, token).catch(() => {})
		dmUnreadCounts.value = { ...dmUnreadCounts.value, [channelId]: 0 }
	}

	async function sendDmToChannel(channelId, text) {
		const data = await SlackApi.postMessageAs(channelId, text, avatarStore.slackUserToken)
		const ts = data?.ts || data?.message?.ts
		if (ts) registerOutgoingDmRead(channelId, ts)
		return data
	}

	/** Open the flyout for a presence-store user, creating the IM channel if needed. */
	async function openDmWithUser(presenceUser) {
		const token = avatarStore.slackUserToken
		if (!token) throw new Error('Connect Slack in Settings to send DMs')

		// Resolve Slack user ID
		let slackId = presenceUser.slackId
		if (!slackId) {
			const email = presenceUser.avaEmail || presenceUser.email
			if (email) slackId = getByEmail(email)?.id
		}
		if (!slackId) {
			const name      = presenceUser.name?.toLowerCase().trim() || ''
			const nameWords = name.split(/\s+/).filter(Boolean).map(normalizeWord)
			slackId = members.value.find(m => {
				const rn = (m.profile?.real_name    || '').toLowerCase().trim()
				const dn = (m.profile?.display_name || '').toLowerCase().trim()
				if (rn === name || dn === name) return true
				// Normalized exact match (handles missing apostrophes/hyphens)
				if (normalizeWord(rn) === normalizeWord(name)) return true
				// AVA words ⊆ Slack words (normal case)
				const rnWords = rn.split(/\s+/).filter(Boolean).map(normalizeWord)
				if (nameWords.length >= 2 && nameWords.every(w => rnWords.includes(w))) return true
				// Slack words ⊆ AVA words (handles extra AVA suffixes like "'s Clone", "Jr", etc.)
				return rnWords.length >= 1 && rnWords.every(w => nameWords.includes(w))
			})?.id
		}
		if (!slackId) throw new Error(`Slack user not found for ${presenceUser.name || presenceUser.email}`)

		// Find or open the IM channel
		let channel = myChannels.value.find(c => c.is_im && c.user === slackId)
		if (!channel) {
			channel = await SlackApi.openConversation(slackId, token)
			const m = memberById.value[slackId]
			channel._dmName  = m?.profile?.display_name || m?.real_name || slackId
			channel._dmColor = slackColorById(slackId)
			myChannels.value = [...myChannels.value, channel]
		}

		await openDm(channel)
	}

	// Shared helper: get last_read for a channel, caching the result to skip
	// conversations.info on subsequent cycles (conversations.list never includes it).
	async function getLastRead(ch, token) {
		if (ch.last_read && parseFloat(ch.last_read) > 0) return ch.last_read
		const info = await SlackApi.getConversationInfo(ch.id, token)
		const lr = info?.last_read ?? null
		if (lr) ch.last_read = lr   // cache for next cycle — skips conversations.info
		return lr
	}

	// Count messages after lastRead for a channel.
	// Returns { count, hasMention } — hasMention is true if any fetched message
	// contains a direct @mention, <!here>, or <!channel> targeting mySlackId.
	// Omits messages you sent (Slack does not treat your own posts as unread).
	async function countUnread(ch, lastRead, token, mySlackId = '') {
		// Must be a finite Unix timestamp > year 2001 to be a valid oldest= param.
		// Catches null, '0', '0000000000.000000', NaN, and other garbage values.
		const ts = parseFloat(lastRead)
		if (!isFinite(ts) || ts < 1_000_000_000) return { count: 0, hasMention: false }
		const { messages, hasMore } = await SlackApi.getConversationHistory(
			ch.id, token, { oldest: lastRead, limit: 20 },
		)
		const fromOthers = mySlackId
			? messages.filter(m => m.user !== mySlackId)
			: messages
		const othersCount = fromOthers.length
		const count = othersCount + (hasMore && othersCount > 0 ? 1 : 0)
		let hasMention = false
		if (mySlackId && othersCount > 0) {
			hasMention = fromOthers.some(m =>
				m.text && (
					m.text.includes(`<@${mySlackId}>`) ||
					m.text.includes('<!here>') ||
					m.text.includes('<!channel>')
				)
			)
		}
		return { count, hasMention }
	}

	/** Poll DM (is_im) channels only — runs every 90s. */
	async function pollUnreadCounts() {
		if (isSlackPaused()) return
		if (unreadPollRunning) return
		const token = avatarStore.slackUserToken
		if (!token) return
		if (!myChannels.value.length) {
			await fetchMyChannels()
			if (!myChannels.value.length) return
		}
		unreadPollRunning = true
		const counts = { ...dmUnreadCounts.value }
		const mySlackId = avatarStore.slackId || ''
		try {
			const dms = myChannels.value.filter(c => c.is_im)
			for (const ch of dms) {
				if (activeDmChannel.value?.id === ch.id) { counts[ch.id] = 0; continue }
				try {
					const lastRead = await getLastRead(ch, token)
					await new Promise(r => setTimeout(r, 2000))
					const { count } = await countUnread(ch, lastRead, token, mySlackId)
					counts[ch.id] = count
				} catch (e) {
					if (e.message?.includes('ratelimited')) slackRateLimited(e)
					console.warn('[slack] DM poll failed:', ch._dmName || ch.id, e.message)
					if (e.retryAfter) await new Promise(r => setTimeout(r, (e.retryAfter + 1) * 1000))
				}
				await new Promise(r => setTimeout(r, 2000))
			}
		} finally {
			unreadPollRunning = false
		}
		dmUnreadCounts.value = counts
	}

	/** Poll named (non-IM, non-MPIM) channels — runs every 5 min. */
	async function pollChannelCounts() {
		if (isSlackPaused()) return
		if (channelPollRunning) return
		const token = avatarStore.slackUserToken
		if (!token) return
		channelPollRunning = true
		const counts  = { ...dmUnreadCounts.value }
		const hasUnread = { ...channelHasUnread.value }
		const mySlackId = avatarStore.slackId || ''
		try {
			const channels = myChannels.value.filter(c => !c.is_im && !c.is_mpim)
			for (const ch of channels) {
				try {
					const lastRead = await getLastRead(ch, token)
					await new Promise(r => setTimeout(r, 2000))
					const { count, hasMention } = await countUnread(ch, lastRead, token, mySlackId)
					// Red badge (with count) only for @mentions / <!here> / <!channel>
					counts[ch.id]   = hasMention ? count : 0
					// Bold + dot for any unread that isn't a direct mention
					hasUnread[ch.id] = count > 0 && !hasMention
				} catch (e) {
					if (e.message?.includes('ratelimited')) slackRateLimited(e)
					console.warn('[slack] channel poll failed:', ch.name || ch.id, e.message)
					if (e.retryAfter) await new Promise(r => setTimeout(r, (e.retryAfter + 1) * 1000))
				}
				await new Promise(r => setTimeout(r, 2000))
			}
		} finally {
			channelPollRunning = false
		}
		dmUnreadCounts.value  = counts
		channelHasUnread.value = hasUnread
	}

	// ── Lifecycle ────────────────────────────────────────────────────
	async function start() {
		if (statusTimer) return   // already running
		await loadMembers()
		statusTimer = setInterval(loadMembers, STATUS_POLL_MS)

		// Kick off an immediate DM unread fetch, then channel poll after DMs finish
		if (avatarStore.slackUserToken) {
			fetchMyChannels()
				.then(() => pollUnreadCounts())
				.then(() => pollChannelCounts())
				.catch(() => {})
		}
		// DMs: 48 channels × 2 calls × 2000ms ≈ 192s — poll every 5 min
		if (!unreadPollTimer) {
			unreadPollTimer = setInterval(pollUnreadCounts, 5 * 60_000)
		}
		// Named channels: 33 × 2 × 2000ms ≈ 132s — poll every 8 min
		if (!channelPollTimer) {
			channelPollTimer = setInterval(pollChannelCounts, 8 * 60_000)
		}

		// When the tab becomes visible again, immediately catch up on anything
		// missed while hidden — so the user doesn't wait for the next scheduled tick.
		document.addEventListener('visibilitychange', _onVisibilityChange)
	}

	function _onVisibilityChange() {
		if (document.hidden) return
		// Tab just became visible — run a catch-up poll for whatever is active
		pollDmMessages()
		pollUnreadCounts()
	}

	function stop() {
		clearInterval(statusTimer);     statusTimer     = null
		clearInterval(unreadPollTimer); unreadPollTimer  = null
		clearInterval(channelPollTimer); channelPollTimer = null
		clearInterval(dmPollTimer);     dmPollTimer     = null
		document.removeEventListener('visibilitychange', _onVisibilityChange)
	}

	return {
		members,
		memberByEmail,
		memberById,
		isLoaded,
		error,
		lastSync,
		onlineSlackIds,
		presenceMap,
		myChannels,
		myChannelsLoading,
		// DM client
		activeDmChannel,
		dmMessages,
		dmLoading,
		dmUnreadCounts,
		channelHasUnread,
		totalDmUnread,
		openDm,
		closeDm,
		sendDmToChannel,
		openDmWithUser,
		pollDmMessages,
		pollUnreadCounts,
		pollChannelCounts,
		fetchMyChannels,
		fetchPanelPresence,
		start,
		stop,
		getByEmail,
		getMember,
		setMyStatus,
		clearMyStatus,
		pushMyPresenceToSlack,
		dmByEmail,
		dmUser,
		syncStatuses,
	}
}

// ── Vite HMR: kill timers before each hot-reload so they don't accumulate ──
if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		clearInterval(statusTimer);      statusTimer      = null
		clearInterval(unreadPollTimer);  unreadPollTimer  = null
		clearInterval(channelPollTimer); channelPollTimer = null
		clearInterval(dmPollTimer);      dmPollTimer      = null
		unreadPollRunning  = false
		channelPollRunning = false
	})
}
