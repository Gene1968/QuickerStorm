/**
 * Supabase AuthRepo — Google OAuth via Supabase Auth.
 *
 * Requests Calendar + Gmail + profile scopes so a single sign-in covers both
 * Supabase RLS (auth.uid()) and the existing GoogleApi.js Calendar/Gmail calls
 * (provider_token from the session).
 *
 * Sign-in UX: popup flow. We let supabase-js generate the PKCE auth URL with
 * skipBrowserRedirect, open it in a popup, and the popup forwards the resulting
 * ?code= back to the main window via three parallel channels (localStorage storage
 * event, BroadcastChannel, postMessage) so that whichever survives COOP headers
 * delivers the code. The main window calls exchangeCodeForSession(code), which
 * reads the PKCE verifier from localStorage and establishes the session without
 * a full-page redirect. Falls back to full-page redirect if the popup is blocked.
 */
import { ref } from 'vue'
import { supabase } from './client.js'
// import { setGoogleToken, clearGoogleAuth, storeRefreshToken } from '@/api/GoogleApi.js'

const SCOPES = [
	'https://www.googleapis.com/auth/calendar.readonly',
	'https://www.googleapis.com/auth/gmail.readonly',
	'https://www.googleapis.com/auth/userinfo.email',
	'https://www.googleapis.com/auth/userinfo.profile',
].join(' ')

export const session = ref(null)
export const authReady = ref(false)

let _initialized = false
let _lastProviderToken = null

/**
 * Mirror the Supabase session's Google provider_token into GoogleApi's
 * in-memory cache so CalendarApi / GmailApi calls authenticate transparently.
 *
 * provider_token is only attached to a session immediately after sign-in or a
 * TOKEN_REFRESHED event that re-ran the provider flow; subsequent sessions
 * restored from storage may omit it. We therefore only update when we see a
 * fresh token, and clear on explicit sign-out.
 */
function _syncGoogleProviderToken (sess) {
	const token = sess?.provider_token
	if (!token || token === _lastProviderToken) return
	_lastProviderToken = token
	// Google access tokens live ~1h; Supabase exposes expires_in for the Supabase
	// JWT, not the provider token, but in practice they line up closely enough.
	const expiresIn = Number(sess?.expires_in) || 3600
	setGoogleToken(token, expiresIn)
	// Persist the Google refresh token so silent refresh works after the access
	// token expires. Without this the user must manually reconnect every ~1h.
	if (sess?.provider_refresh_token) {
		storeRefreshToken(sess.provider_refresh_token)
	}
	window.dispatchEvent(new CustomEvent('ava-google-auth-changed', { detail: { authed: true } }))
}

async function init () {
	if (_initialized) return
	_initialized = true
	const sb = supabase()

	// If we landed on the OAuth callback (?code=... in the URL), explicitly
	// exchange it for a session. detectSessionInUrl is supposed to do this, but
	// races with getSession() and can silently no-op when hash routing is in
	// play. Doing it ourselves is deterministic.
	const params = new URLSearchParams(window.location.search)
	const code = params.get('code')
	if (code) {
		try {
			const { data, error } = await sb.auth.exchangeCodeForSession(code)
			if (error) console.error('[Supabase] code exchange failed:', error)
			else {
				session.value = data.session || null
				// Notify the main window via localStorage (storage event) + BC.
				// localStorage storage event is unaffected by COOP.
				if (session.value) {
					try { localStorage.setItem('ava-oauth-pending', JSON.stringify({ session: session.value, ts: Date.now() })) } catch { /* ignore */ }
					try {
						const bc = new BroadcastChannel('ava-oauth')
						bc.postMessage({ type: 'supabase-session', session: session.value })
						bc.close()
					} catch { /* ignore */ }
				}
			}
		} catch (err) {
			console.error('[Supabase] code exchange threw:', err)
		}
		// Strip ?code= and ?state= from the URL so a refresh doesn't retry.
		const url = new URL(window.location.href)
		url.searchParams.delete('code')
		url.searchParams.delete('state')
		history.replaceState(null, '', url.pathname + url.search + url.hash)
	}

	if (!session.value) {
		const { data } = await sb.auth.getSession()
		session.value = data.session || null
	}
	// Push the JWT to the realtime socket so RLS-filtered subscriptions work.
	if (session.value?.access_token) {
		sb.realtime.setAuth(session.value.access_token)
	}
	// Hand the Google access token off to GoogleApi so CalendarApi works.
	_syncGoogleProviderToken(session.value)

	sb.auth.onAuthStateChange((event, newSession) => {
		session.value = newSession || null
		if (newSession?.access_token) sb.realtime.setAuth(newSession.access_token)
		if (event === 'SIGNED_OUT') {
			_lastProviderToken = null
			clearGoogleAuth()
			window.dispatchEvent(new CustomEvent('ava-google-auth-changed', { detail: { authed: false } }))
			return
		}
		_syncGoogleProviderToken(newSession)
	})
	authReady.value = true
}

export const AuthRepo = {
	backend: 'supabase',

	async ready () {
		await init()
		return session.value
	},

	getSession () { return session.value },

	getUser () {
		const u = session.value?.user
		if (!u) return null
		// Shape mirrors the SP UserApi response so userStore consumers don't care.
		const meta = u.user_metadata || {}
		return {
			Id: u.id,
			Email: u.email,
			Title: meta.full_name || meta.name || u.email,
			UserPrincipalName: u.email,
			AvatarUrl: meta.avatar_url || meta.picture || '',
			authUserId: u.id,
		}
	},

	getProviderToken () {
		// Google access_token; available on the freshest session after sign-in
		// or after Supabase silently refreshes via the stored provider_refresh_token.
		return session.value?.provider_token || null
	},

	/**
	 * Sign in with Google. Popup flow by default; falls back to a full-page
	 * redirect if the popup is blocked or the auth URL can't be obtained.
	 *
	 * In popup mode the function resolves once the session is established (or
	 * rejects on error / user cancellation). Callers can await it to know when
	 * it's safe to bootstrap identity.
	 */
	async signInWithGoogle ({ popup = true } = {}) {
		const sb = supabase()
		const redirectTo = window.location.origin + window.location.pathname
		const oauthOpts = {
			provider: 'google',
			options: {
				scopes: SCOPES,
				queryParams: { access_type: 'offline', prompt: 'consent' },
				redirectTo,
			},
		}

		if (!popup) {
			await sb.auth.signInWithOAuth(oauthOpts)
			return
		}

		// Open a blank popup synchronously from the user gesture so the popup
		// blocker doesn't kill it while we async-fetch the OAuth URL below.
		const popupWin = window.open('about:blank', 'supabase-oauth', 'width=520,height=660,left=200,top=100')
		if (!popupWin) {
			console.warn('[Supabase] Popup blocked — falling back to full-page redirect')
			await sb.auth.signInWithOAuth(oauthOpts)
			return
		}

		let authUrl
		try {
			const { data, error } = await sb.auth.signInWithOAuth({
				...oauthOpts,
				options: { ...oauthOpts.options, skipBrowserRedirect: true },
			})
			if (error) throw error
			authUrl = data?.url
			if (!authUrl) throw new Error('No auth URL returned by Supabase')
		} catch (err) {
			popupWin.close()
			throw err
		}

		popupWin.location.href = authUrl

		return new Promise((resolve, reject) => {
			let bc = null
			let handled = false
			let cancelTimer = null

			const cleanup = () => {
				window.removeEventListener('message', onMessage)
				window.removeEventListener('storage', onStorage)
				bc?.close()
				bc = null
				if (cancelTimer) { clearTimeout(cancelTimer); cancelTimer = null }
				localStorage.removeItem('ava-oauth-pending')
			}

			const handleCode = async (code) => {
				if (handled) return
				handled = true
				cleanup()
				try {
					const { data, error } = await sb.auth.exchangeCodeForSession(code)
					if (error) throw error
					session.value = data.session || null
					if (session.value?.access_token) sb.realtime.setAuth(session.value.access_token)
					_syncGoogleProviderToken(session.value)
					resolve(session.value)
				} catch (err) {
					reject(err)
				}
			}

			const handleSession = (sess) => {
				if (handled) return
				handled = true
				cleanup()
				session.value = sess
				if (sess?.access_token) sb.realtime.setAuth(sess.access_token)
				_syncGoogleProviderToken(sess)
				resolve(sess)
			}

			// Channel 1: localStorage storage event — fires on all same-origin windows
			// except the writer; unaffected by COOP.
			const onStorage = (e) => {
				if (e.key !== 'ava-oauth-pending' || !e.newValue) return
				let data
				try { data = JSON.parse(e.newValue) } catch { return }
				if (data?.code) handleCode(data.code)
				else if (data?.session) handleSession(data.session)
			}
			window.addEventListener('storage', onStorage)

			// Channel 2: postMessage (works when COOP is not enforced)
			const onMessage = (e) => {
				if (e.origin !== window.location.origin) return
				if (e.data?.type !== 'supabase-oauth-code' || !e.data.code) return
				handleCode(e.data.code)
			}
			window.addEventListener('message', onMessage)

			// Channel 3: BroadcastChannel (works across browsing context groups)
			bc = new BroadcastChannel('ava-oauth')
			bc.onmessage = (e) => {
					if (e.data?.type === 'supabase-oauth-code' && e.data.code) handleCode(e.data.code)
				else if (e.data?.type === 'supabase-session' && e.data.session) handleSession(e.data.session)
			}

			// 5-minute timeout — gives up if user takes too long or closes the popup
			cancelTimer = setTimeout(() => {
				if (!handled) { cleanup(); reject(new Error('Sign-in cancelled')) }
			}, 5 * 60 * 1000)
		})
	},

	async signOut () {
		const sb = supabase()
		await sb.auth.signOut()
		session.value = null
		_lastProviderToken = null
		clearGoogleAuth()
	},
}
