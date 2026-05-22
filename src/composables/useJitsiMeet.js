/**
 * useJitsiMeet — singleton wrapper around the Jitsi Meet IFrame API (JaaS).
 *
 * Uses 8x8.vc (Jitsi-as-a-Service, free tier) instead of meet.jit.si which
 * no longer allows free embedding beyond 5 minutes.
 *
 * JaaS requires a signed RS256 JWT per session.  The signal server's
 * /api/jitsi-token endpoint generates it server-side so the private key
 * never reaches the browser.
 *
 * Setup (once):
 *   1. Create account at https://jaas.8x8.vc
 *   2. Create an API key → note APP_ID and Key ID, download private.key
 *   3. Set on Railway (signal server):
 *        JAAS_APP_ID      = vpaas-magic-cookie-...
 *        JAAS_API_KEY_ID  = <key id from console>
 *        JAAS_PRIVATE_KEY = <contents of private.key with newlines as \n>
 *   4. Set in .env files:
 *        VITE_JAAS_APP_ID = vpaas-magic-cookie-...   (public, safe to commit)
 *        VITE_SIGNAL_URL  = wss://your-signal.railway.app
 */
import { ref, shallowRef } from 'vue'

const JITSI_DOMAIN = '8x8.vc'
const APP_ID       = import.meta.env.VITE_JAAS_APP_ID || ''

// ── Singleton state ───────────────────────────────────────────────────
const isActive         = ref(false)
const participantCount = ref(0)
const roomName         = ref('')
const _api             = shallowRef(null)

let _scriptPromise = null

function _loadScript() {
	if (_scriptPromise) return _scriptPromise
	if (window.JitsiMeetExternalAPI) return (_scriptPromise = Promise.resolve())
	_scriptPromise = new Promise((resolve, reject) => {
		const s   = document.createElement('script')
		s.src     = `https://${JITSI_DOMAIN}/libs/external_api.min.js`
		s.onload  = resolve
		s.onerror = () => { _scriptPromise = null; reject(new Error('Jitsi script failed to load')) }
		document.head.appendChild(s)
	})
	return _scriptPromise
}

/** Fetch a signed JWT from the signal server. Returns null on failure. */
async function _fetchJwt({ room, userId, displayName, moderator = false }) {
	const wsUrl = import.meta.env.VITE_SIGNAL_URL
	if (!wsUrl) return null
	const httpBase = wsUrl.replace(/^ws(s?):\/\//, 'http$1://')
	try {
		const res = await fetch(`${httpBase}/api/jitsi-token`, {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body:    JSON.stringify({ room, userId, displayName, moderator }),
		})
		if (!res.ok) return null
		return res.json()   // { token, appId, room }
	} catch (e) {
		console.warn('[JitsiMeet] JWT fetch failed:', e)
		return null
	}
}

export function useJitsiMeet() {
	/**
	 * Join (or create) a Jitsi room via JaaS.
	 * @param {{ room: string, userId: string, displayName: string, avatarUrl?: string, containerEl: HTMLElement }} opts
	 */
	async function join({ room, userId, displayName, avatarUrl, containerEl }) {
		if (!APP_ID) {
			_toast('VITE_JAAS_APP_ID not set — video meetings unavailable', 'warn')
			return
		}

		// Tear down any existing session first
		if (_api.value) leave()

		// Fetch JWT (needed for JaaS rooms to avoid the 5-min demo limit)
		const jwtData = await _fetchJwt({ room, userId, displayName })
		if (!jwtData?.token) {
			_toast('Could not get meeting token — is the signal server running?', 'warn')
			return
		}

		try {
			await _loadScript()
		} catch (e) {
			console.error('[JitsiMeet] Failed to load external_api.js:', e)
			_toast('Could not load Jitsi — check network connection', 'warn')
			return
		}

		// JaaS room names are prefixed with APP_ID
		const fullRoom = `${APP_ID}/${room}`
		roomName.value = room

		_api.value = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
			roomName: fullRoom,
			jwt:      jwtData.token,
			width:    '100%',
			height:   '100%',
			parentNode: containerEl,
			userInfo: {
				displayName,
				avatarURL: avatarUrl || '',
			},
			configOverwrite: {
				startWithAudioMuted:  true,
				disableDeepLinking:   true,
				prejoinPageEnabled:   false,
				enableWelcomePage:    false,
			},
			interfaceConfigOverwrite: {
				SHOW_JITSI_WATERMARK:  false,
				SHOW_BRAND_WATERMARK:  false,
				SHOW_POWERED_BY:       false,
				TOOLBAR_BUTTONS: [
					'microphone', 'camera', 'desktop', 'chat',
					'tileview', 'participants-pane', 'hangup',
				],
			},
		})

		isActive.value = true

		_api.value.addListener('videoConferenceJoined', () => {
			participantCount.value = _api.value?.getNumberOfParticipants?.() ?? 1
		})
		_api.value.addListener('participantJoined', () => {
			participantCount.value = _api.value?.getNumberOfParticipants?.() ?? (participantCount.value + 1)
		})
		_api.value.addListener('participantLeft', () => {
			participantCount.value = Math.max(0,
				_api.value?.getNumberOfParticipants?.() ?? (participantCount.value - 1))
		})
		_api.value.addListener('videoConferenceLeft', _cleanup)
	}

	function leave() {
		_api.value?.dispose()
		_cleanup()
	}

	function _cleanup() {
		_api.value          = null
		isActive.value      = false
		participantCount.value = 0
		roomName.value      = ''
	}

	return { isActive, participantCount, roomName, join, leave }
}

function _toast(message, type = 'info') {
	window.dispatchEvent(new CustomEvent('ava-toast', { detail: { message, type } }))
}
