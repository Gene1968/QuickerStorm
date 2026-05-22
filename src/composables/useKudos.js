/**
 * useKudos — lazy-loaded kudos feed for the break-room kudos wall.
 *
 * Module-level singleton: `recentKudos` holds the last ~50 entries, refreshed
 * via Realtime. `giveKudos()` writes a new row, fires a confetti burst over
 * the recipient's avatar, and toasts both sides.
 */
import { ref } from 'vue'
import { KudosRepo } from '@/api/backend.js'
import { usePresenceStore } from '@/stores/presenceStore.js'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useReactions } from '@/composables/useReactions.js'

// ── Module-level state ────────────────────────────────────────────────────────

/** Array of recent kudos rows (PascalCase, newest first). */
export const recentKudos = ref([])

let isStarted = false
let _unsubscribeRealtime = null

async function refresh() {
	try {
		recentKudos.value = await KudosRepo.list({ limit: 50 })
	} catch (e) {
		console.warn('[useKudos] refresh failed:', e)
	}
}

/** Fires when a Realtime INSERT lands. If we're the recipient, celebrate. */
function _handleRealtime(payload) {
	refresh()
	if (payload?.eventType !== 'INSERT' || !payload.new) return
	const avatarStore = useAvatarStore()
	const myAuthId = avatarStore.authUserId
	if (!myAuthId) return
	if (String(payload.new.to_user_id) !== String(myAuthId)) return

	const presenceStore = usePresenceStore()
	const sender = presenceStore.users.find(u =>
		String(u.authUserId || u.auth_user_id) === String(payload.new.from_user_id),
	)
	const senderName = sender?.name || 'Someone'

	window.dispatchEvent(new CustomEvent('ava-toast', {
		detail: { message: `🎉 ${senderName} sent you kudos!`, type: 'success' },
	}))
	try {
		const { sendReaction } = useReactions()
		sendReaction('🎉')
	} catch { /* ignore — reactions optional */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a kudos to another user. `toUser` may be a presence row (with `authUserId`)
 * or a raw auth UUID. Recipient gets a confetti reaction over their avatar +
 * a toast. Sender gets a confirmation toast.
 */
export async function giveKudos(toUser, message) {
	const presenceStore = usePresenceStore()
	const avatarStore   = useAvatarStore()

	const trimmed = String(message || '').trim()
	if (!trimmed) throw new Error('message is required')
	if (trimmed.length > 280) throw new Error('message too long (max 280)')

	const toAuthId = typeof toUser === 'string'
		? toUser
		: (toUser?.authUserId || toUser?.AuthUserId || toUser?.auth_user_id)
	if (!toAuthId) throw new Error('recipient missing auth id')

	await KudosRepo.create({ ToUserId: toAuthId, Message: trimmed })

	// Sender toast — recipient's tab celebrates separately via _handleRealtime.
	const recipient = presenceStore.users.find(u =>
		String(u.authUserId || u.auth_user_id) === String(toAuthId),
	)
	const recName = recipient?.name || 'them'
	window.dispatchEvent(new CustomEvent('ava-toast', {
		detail: { message: `✨ Kudos sent to ${recName}!`, type: 'success' },
	}))

	return {
		FromUserId: avatarStore.authUserId,
		ToUserId:   toAuthId,
		Message:    trimmed,
		Created:    new Date().toISOString(),
	}
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useKudos() {
	function start() {
		if (isStarted) return
		isStarted = true
		refresh()
		if (typeof KudosRepo.subscribe === 'function') {
			_unsubscribeRealtime = KudosRepo.subscribe(_handleRealtime)
		}
	}

	function stop() {
		if (_unsubscribeRealtime) { try { _unsubscribeRealtime() } catch { /* ignore */ } _unsubscribeRealtime = null }
		isStarted = false
	}

	return { start, stop, recentKudos, giveKudos, refresh }
}
