import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useIndexedDB } from '@/composables/useIndexedDB.js'

const AVATAR_KEY = 'ava_avatar_config'

const DEFAULT_COLORS = [
	'#00b4d8', '#2979ff', '#7c4dff', '#00c853',
	'#ff6d00', '#ff4081', '#00bcd4', '#f44336',
]

export const useAvatarStore = defineStore('avatar', () => {
	const db = useIndexedDB()

	// ── State ──────────────────────────────────────────────────────
	const avatarUrl   = ref(null)   // JSON avatar config or legacy .glb URL
	const color       = ref('#00b4d8')  // outfit / primary color
	const skinTone    = ref('#C68642')
	const hairColor   = ref('#3B2314')
	const hairStyle   = ref('medium')   // 'none' | 'short' | 'medium' | 'long'  ('smedium' migrated → 'medium' on load)
	const displayName = ref('')
	const title       = ref('')
	const initials    = ref('')
	const status      = ref('online')  // 'online' | 'away' | 'busy' | 'offline'
	/** Slack-style :shortcode: e.g. :coffee: — synced from Slack or set locally */
	const statusEmoji   = ref('')
	/** Slack status text (max 100 chars when sent to Slack) */
	const statusMessage = ref('')
	/** Raw combined line for presence SlackStatus (emoji + text, not emojified) */
	const slackStatus = computed(() => {
		const e = statusEmoji.value.trim()
		const t = statusMessage.value.trim()
		if (!e && !t) return ''
		return e ? `${e} ${t}`.trim() : t
	})
	const slackId        = ref('')     // Slack member ID, e.g. U0123ABC
	const avaEmail       = ref('')     // canonical @avatechnologyllc.com email
	const slackUserToken = ref('')     // xoxp- user token from OAuth (lets DMs send as the user)
	const slackTeamId    = ref('')     // Slack workspace ID (T...) — used to build app.slack.com URLs
	const isSetupDone = ref(false)
	/** Supabase auth user id (UUID). Used as the canonical key for presence/voice. */
	const authUserId = ref(null)
	const googleAccountIndex = ref(1) // which /u/N/ Google account to open (0 = first/personal, 1 = work, etc.)

	// ── Computed ───────────────────────────────────────────────────
	const avatarInitials = computed(() => {
		if (initials.value) return initials.value
		const parts = displayName.value.trim().split(' ')
		if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
		return displayName.value.slice(0, 2).toUpperCase() || 'AV'
	})

	const statusColor = computed(() => {
		const map = { online: '#00c853', away: '#ff6d00', busy: '#f44336', offline: '#4d6080' }
		return map[status.value] || map.offline
	})

	// ── Actions ────────────────────────────────────────────────────
	function _snapshot() {
		return {
			avatarUrl:    avatarUrl.value,
			color:        color.value,
			skinTone:     skinTone.value,
			hairColor:    hairColor.value,
			hairStyle:    hairStyle.value,
			displayName:  displayName.value,
			title:        title.value,
			initials:     initials.value,
			status:       status.value,
			statusEmoji:   statusEmoji.value,
			statusMessage: statusMessage.value,
			slackId:            slackId.value,
			avaEmail:           avaEmail.value,
			slackUserToken:     slackUserToken.value,
			slackTeamId:        slackTeamId.value,
			authUserId:         authUserId.value,
			googleAccountIndex: googleAccountIndex.value,
			isSetupDone:        isSetupDone.value,
		}
	}

	function _apply(saved) {
		avatarUrl.value    = saved.avatarUrl    ?? null
		color.value        = saved.color        ?? pickRandomColor()
		skinTone.value     = saved.skinTone     ?? '#C68642'
		hairColor.value    = saved.hairColor    ?? '#3B2314'
		const rawStyle     = saved.hairStyle ?? 'medium'
		hairStyle.value    = rawStyle === 'smedium' ? 'medium' : rawStyle
		displayName.value  = saved.displayName  ?? ''
		title.value        = saved.title        ?? ''
		initials.value     = saved.initials     ?? ''
		status.value       = saved.status       ?? 'online'
		statusEmoji.value   = saved.statusEmoji   ?? ''
		statusMessage.value = saved.statusMessage ?? ''
		slackId.value            = saved.slackId            ?? ''
		avaEmail.value           = saved.avaEmail           ?? ''
		slackUserToken.value     = saved.slackUserToken     ?? ''
		slackTeamId.value        = saved.slackTeamId        ?? ''
		// Migration: older configs stored this as `sharePointId` (SP user Id, int).
		// Prefer the new `authUserId` if present; fall back to legacy for a single
		// boot so existing avatars don't lose their seat identity.
		authUserId.value         = saved.authUserId ?? saved.sharePointId ?? null
		googleAccountIndex.value = saved.googleAccountIndex ?? 1
		isSetupDone.value        = saved.isSetupDone        ?? false
	}

	async function load() {
		let lsSaved  = null
		let idbSaved = null

		// localStorage — synchronous, always attempted first (more reliable in SP)
		try {
			const raw = localStorage.getItem(AVATAR_KEY)
			if (raw) lsSaved = JSON.parse(raw)
		} catch { /* ignore */ }

		// IndexedDB — richer storage; may be blocked in some SP contexts
		try {
			idbSaved = await db.get(AVATAR_KEY)
		} catch { /* ignore */ }

		// localStorage is always written before IDB in save(), so it is always at least
		// as fresh as IDB (and may be fresher if a prior IDB write failed silently).
		// Prefer LS when it has a completed setup; fall back to IDB only when LS is
		// incomplete or missing (e.g. privacy settings blocked LS, IDB still worked).
		const saved = lsSaved?.isSetupDone
			? lsSaved
			: (idbSaved ?? lsSaved)
		if (saved) _apply(saved)
	}

	async function save() {
		const data = _snapshot()
		// Write to localStorage first — synchronous, more reliable in SP contexts
		try { localStorage.setItem(AVATAR_KEY, JSON.stringify(data)) } catch { /* ignore */ }
		// Also write to IDB
		try { await db.set(AVATAR_KEY, data) } catch { /* ignore */ }
	}

	async function completeSetup(payload) {
		avatarUrl.value   = payload.avatarUrl   ?? avatarUrl.value
		color.value       = payload.color       ?? color.value
		skinTone.value    = payload.skinTone    ?? skinTone.value
		hairColor.value   = payload.hairColor   ?? hairColor.value
		hairStyle.value   = payload.hairStyle   ?? hairStyle.value
		displayName.value = payload.displayName ?? displayName.value
		title.value       = payload.title       ?? title.value
		initials.value    = payload.initials    ?? ''
		isSetupDone.value = true
		await save()
	}

	async function setStatus(newStatus) {
		status.value = newStatus
		await save()
	}

	/** Apply raw Slack profile fields (from users.list); persists when changed */
	async function setSlackFromSync(profile) {
		if (!profile) return
		const e = profile.status_emoji ?? ''
		const t = profile.status_text ?? ''
		if (statusEmoji.value === e && statusMessage.value === t) return
		statusEmoji.value = e
		statusMessage.value = t
		await save()
	}

	/** User-edited custom status (Slack :shortcode: + text); persists */
	async function setSlackCustom(emoji, text) {
		statusEmoji.value = (emoji || '').trim()
		statusMessage.value = (text || '').trim().slice(0, 100)
		await save()
	}

	async function setAvatarUrl(url) {
		avatarUrl.value = url
		await save()
	}

	async function setGoogleAccountIndex(n) {
		googleAccountIndex.value = Math.max(0, Math.min(9, Number(n) || 0))
		await save()
	}

	async function setSlackUserToken(token, teamId) {
		slackUserToken.value = token   || ''
		slackTeamId.value    = teamId  || slackTeamId.value
		await save()
	}

	// Called by useSlack when it identifies this user's Slack account.
	// slackId and avaEmail are stable once discovered — persist them immediately.
	async function setSlackIdentity(newSlackId, newAvaEmail) {
		slackId.value  = newSlackId  || slackId.value
		avaEmail.value = newAvaEmail || avaEmail.value
		await save()
	}

	function pickRandomColor() {
		return DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]
	}

	/**
	 * Seed identity + defaults from the AuthRepo user object.
	 *
	 * The param is whatever AuthRepo.getUser() returns — a SP-shaped record with
	 * { Id, Email, Title, UserPrincipalName, AvatarUrl, authUserId }. Id and
	 * authUserId are the Supabase auth UUID; they are identical here but both
	 * are kept so legacy consumers that expected an SP-style `Id` still work.
	 */
	function fromAuthUser(authUser) {
		// Always capture the auth user id — needed for presence, not a user preference.
		authUserId.value = authUser.authUserId || authUser.Id

		// Pick a stable default color for brand-new users (seed isSetupDone === false).
		// We fold the UUID string into a 32-bit int so the color ends up stable per user.
		let seed = 0
		const idStr = String(authUser.Id || '')
		for (let i = 0; i < idStr.length; i++) {
			seed = ((seed << 5) - seed + idStr.charCodeAt(i)) | 0
		}
		const seedIdx = Math.abs(seed) % DEFAULT_COLORS.length

		// ── Dev session: assign "Local Dev XX" identity ──────────────
		// In DEV mode (Vite dev server) or on localhost, the presence
		// composable creates a synthetic @localhost email so the local
		// user gets its own presence row. Give it a distinct display
		// name so it's visually separate from the real staging user.
		const onLocalhost = typeof window !== 'undefined' &&
			(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
		if (import.meta.env.DEV || onLocalhost) {
			const hasStaleAppName =
				(displayName.value || '').startsWith('Local Dev ')
			// Only auto-assign a dev name if the user hasn't customised it yet.
			// Once isSetupDone is true and the name no longer looks auto-generated,
			// leave it alone so page reloads don't stomp a custom dev identity.
			if (!isSetupDone.value || hasStaleAppName) {
				let devNum = localStorage.getItem('ava_dev_num')
				if (!devNum) {
					devNum = String(Math.floor(10 + Math.random() * 90))
					localStorage.setItem('ava_dev_num', devNum)
				}
				displayName.value = `Local Dev ${devNum}`
				title.value       = 'Developer'
				if (!color.value || color.value === '#00b4d8') {
					color.value = DEFAULT_COLORS[seedIdx]
				}
				save()
			}
			return
		}

		// If the user has already completed setup, don't overwrite their choices.
		if (isSetupDone.value) return

		displayName.value = authUser.Title || authUser.UserPrincipalName || ''
		title.value       = authUser.JobTitle || ''

		if (!color.value || color.value === '#00b4d8') {
			color.value = DEFAULT_COLORS[seedIdx]
		}
	}

	return {
		avatarUrl,
		color,
		skinTone,
		hairColor,
		hairStyle,
		displayName,
		title,
		initials,
		status,
		statusEmoji,
		statusMessage,
		slackStatus,
		slackId,
		avaEmail,
		slackUserToken,
		slackTeamId,
		isSetupDone,
		authUserId,
		avatarInitials,
		statusColor,
		load,
		save,
		completeSetup,
		googleAccountIndex,
		setGoogleAccountIndex,
		setStatus,
		setSlackFromSync,
		setSlackCustom,
		setAvatarUrl,
		setSlackIdentity,
		setSlackUserToken,
		fromAuthUser,
	}
})
