/**
 * useGmailNotify — polls Gmail unread count and shows a toast when new mail arrives.
 * Designed to run alongside useGoogleCalendar in OfficeCanvas.
 */
import { ref } from 'vue'
import { GmailApi, isGoogleAuthenticated } from '@/api/GoogleApi.js'

const POLL_INTERVAL = 2 * 60 * 1000 // 2 minutes

let _timer = null
let _lastUnread = -1 // -1 = not yet checked (skip first toast)
let _started = false

export function useGmailNotify () {
	const unreadCount = ref(0)

	async function check () {
		if (!isGoogleAuthenticated()) return
		try {
			const count = await GmailApi.getUnreadCount()
			unreadCount.value = count

			if (_lastUnread === -1) {
				// First check — seed the count, don't toast
				_lastUnread = count
				return
			}

			if (count > _lastUnread) {
				const diff = count - _lastUnread
				// Try to get the latest message sender for a richer toast
				let sender = ''
				try {
					const msgs = await GmailApi.getInbox(1)
					if (msgs.length) {
						const meta = await GmailApi.getMessage(msgs[0].id)
						const fromH = meta?.payload?.headers?.find(h => h.name.toLowerCase() === 'from')
						if (fromH) {
							const match = fromH.value.match(/^"?([^"<]+)"?\s*</)
							sender = match ? match[1].trim() : fromH.value.split('@')[0]
						}
					}
				} catch (_) { /* non-critical */ }

				const msg = diff === 1
					? (sender ? `New email from ${sender}` : 'You have a new email')
					: `${diff} new emails`

				window.dispatchEvent(new CustomEvent('ava-email-toast', {
					detail: { message: msg },
				}))
			}

			_lastUnread = count
		} catch (_) {
			// Silently ignore — don't break the poll loop for transient errors
		}
	}

	function startPolling () {
		if (_started) return
		_started = true
		stopPolling()

		// If already authed, start immediately
		if (isGoogleAuthenticated()) {
			check()
			_timer = setInterval(check, POLL_INTERVAL)
		}

		// Listen for auth changes — start/stop polling accordingly
		window.addEventListener('ava-google-auth-changed', onAuthChanged)
	}

	function onAuthChanged (e) {
		if (e.detail?.authed) {
			// Auth just became available — seed and start polling
			if (!_timer) {
				_lastUnread = -1
				check()
				_timer = setInterval(check, POLL_INTERVAL)
			}
		} else {
			// Auth lost — stop polling
			if (_timer) { clearInterval(_timer); _timer = null }
			_lastUnread = -1
		}
	}

	function stopPolling () {
		if (_timer) { clearInterval(_timer); _timer = null }
	}

	return { unreadCount, startPolling, stopPolling }
}
