/**
 * useGoogleCalendar — reads today's Google Calendar events and exposes
 * reactive state for the projector screen and meeting-start toasts.
 *
 * Auth: the app's Google sign-in (via Supabase AuthRepo) already grants
 * calendar + gmail scopes, and supabase/AuthRepo.js mirrors the
 * provider_token into GoogleApi.js on every auth state change. "Connect"
 * re-runs the Supabase OAuth flow to refresh that provider token.
 *
 * avatarStore.googleAccountIndex controls which /u/N/ Google account tab links
 * open in; it does NOT affect which calendar is read — that is determined by
 * whichever Google account the user authenticated with.
 */
import { ref, computed } from 'vue'
import {
	CalendarApi,
	isGoogleAuthenticated,
	loadGoogleTokenFromSession,
	refreshGoogleToken,
} from '@/api/GoogleApi.js'
import { AuthRepo } from '@/api/backend.js'

// ── Singleton state (shared across all callers) ───────────────────────
const events = ref([])   // today's calendar events (raw Google API items)
const isLoading = ref(false)
const error = ref(null)
const isAuthed = ref(false)

// Track which event IDs we've already toasted so we don't spam
const _toastedIds = new Set()

let _pollTimer = null
let _expiryTimer = null

function _scheduleExpiryWarning () {
	clearTimeout(_expiryTimer)
	const expiry = parseInt(sessionStorage.getItem('google_token_expiry') || '0')
	const msLeft = expiry - Date.now()
	if (msLeft <= 0) return
	// Fire 5 minutes before expiry to attempt a silent refresh
	const msUntilRefresh = Math.max(0, msLeft - 5 * 60_000)
	_expiryTimer = setTimeout(async () => {
		const ok = await refreshGoogleToken()
		if (ok) {
			// Refresh succeeded — reschedule for the new token's expiry
			isAuthed.value = true
			_scheduleExpiryWarning()
		} else {
			// No refresh token or it was revoked — ask the user to reconnect
			isAuthed.value = false
			events.value = []
			window.dispatchEvent(new CustomEvent('ava-toast', {
				detail: { message: '📅 Google session expired — reconnect in Settings', type: 'warn' },
			}))
		}
	}, msUntilRefresh)
}

// ── Helpers ──────────────────────────────────────────────────────────
function _startTime (ev) {
	return new Date(ev.start?.dateTime || ev.start?.date).getTime()
}
function _endTime (ev) {
	return new Date(ev.end?.dateTime || ev.end?.date).getTime()
}

/** Fire a toast when a meeting is starting within 10 minutes (once per event). */
function _maybeToastUpcoming () {
	const now = Date.now()
	const ev = events.value.find(e => _startTime(e) > now)
	if (!ev) return
	if (_toastedIds.has(ev.id)) return
	const minsUntil = Math.round((_startTime(ev) - now) / 60_000)
	if (minsUntil <= 10 && minsUntil >= 0) {
		_toastedIds.add(ev.id)
		const label = ev.summary || 'Meeting'
		const msg = minsUntil <= 1
			? `${label} is starting now`
			: `${label} starts in ${minsUntil} min`
		window.dispatchEvent(new CustomEvent('ava-toast', {
			detail: { message: `📅 ${msg}`, type: 'info' },
		}))
	}
}

async function fetchEvents () {
	if (!isGoogleAuthenticated()) {
		isAuthed.value = false
		return
	}
	isLoading.value = true
	error.value = null
	try {
		events.value = await CalendarApi.getTodayEvents()
		isAuthed.value = true
		_scheduleExpiryWarning()
		_maybeToastUpcoming()
	} catch (err) {
		error.value = err.message
		if (err.message?.includes('expired') || err.message?.includes('Not authenticated')) {
			isAuthed.value = false
		}
	} finally {
		isLoading.value = false
	}
}

// Restore auth state on module load — async because it may do a silent refresh.
// App.vue also calls loadGoogleTokenFromSession() in onMounted (that's fine, idempotent).
loadGoogleTokenFromSession().then(ok => {
	isAuthed.value = ok
	if (ok) _scheduleExpiryWarning()
})

// In Supabase mode the Google provider_token is handed to GoogleApi by
// supabase/AuthRepo.js whenever the session changes. Listen for that so this
// composable reflects the latest auth state and refreshes events immediately
// rather than waiting for the next poll tick.
if (typeof window !== 'undefined') {
	window.addEventListener('ava-google-auth-changed', (e) => {
		const authed = !!e.detail?.authed && isGoogleAuthenticated()
		isAuthed.value = authed
		if (authed) {
			_scheduleExpiryWarning()
			fetchEvents()
		} else {
			events.value = []
		}
	})
}

// ── Composable ───────────────────────────────────────────────────────
export function useGoogleCalendar () {
	/** Event currently in progress, or null */
	const currentEvent = computed(() => {
		const now = Date.now()
		return events.value.find(ev => _startTime(ev) <= now && _endTime(ev) > now) ?? null
	})

	/** Next upcoming event (not yet started), or null */
	const nextEvent = computed(() => {
		const now = Date.now()
		return events.value.find(ev => _startTime(ev) > now) ?? null
	})

	/** Start polling (every 5 min). Fetches immediately. */
	function startPolling () {
		if (_pollTimer) return
		fetchEvents()
		_pollTimer = setInterval(fetchEvents, 5 * 60_000)
	}

	/** Stop polling. */
	function stopPolling () {
		clearInterval(_pollTimer)
		_pollTimer = null
	}

	/**
	 * Connect (or reconnect) Google Calendar.
	 *
	 * The app's Google sign-in already granted calendar + gmail scopes, so we
	 * just re-run Supabase's OAuth flow. Because the user is already signed in
	 * and consented, Google returns a fresh provider_token almost immediately;
	 * AuthRepo mirrors it into GoogleApi via an auth state change event.
	 */
	function connectGoogle () {
		AuthRepo.signInWithGoogle()
	}

	return {
		events,
		currentEvent,
		nextEvent,
		isLoading,
		error,
		isAuthed,
		fetchEvents,
		startPolling,
		stopPolling,
		connectGoogle,
	}
}
