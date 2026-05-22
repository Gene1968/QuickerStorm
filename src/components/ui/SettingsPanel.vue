<script>
// Module-level — persists across SettingsPanel mounts/unmounts so stale-listener
// cleanup works even if the modal was closed and reopened between OAuth attempts.
let _slackMsgListener = null
let _slackPollTimer   = null

function _slackCleanup() {
	if (_slackMsgListener) window.removeEventListener('message', _slackMsgListener)
	_slackMsgListener = null
	clearInterval(_slackPollTimer)
	_slackPollTimer = null
}
</script>

<script setup>
/**
 * SettingsPanel — modal for user-facing app preferences.
 * Currently: theme toggle, Google account index.
 */
import { computed, ref, onUnmounted } from 'vue'
import { useAvatarStore } from '@/stores/avatarStore.js'
import { useTheme } from '@/composables/useTheme.js'
import { X as XMarkIcon } from '@lucide/vue'
import { useGoogleCalendar } from '@/composables/useGoogleCalendar.js'
import { useModalAudio } from '@/composables/useModalAudio.js'
useModalAudio()

defineEmits(['close'])

const avatarStore = useAvatarStore()
const theme = useTheme()

const googleIdx     = computed(() => avatarStore.googleAccountIndex)
const slackLinked   = computed(() => !!avatarStore.slackUserToken)
const { isAuthed: calendarAuthed, connectGoogle: connectGoogleCalendar } = useGoogleCalendar()
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const slackError  = ref('')

const SLACK_CLIENT_ID = import.meta.env.VITE_SLACK_CLIENT_ID || ''
const SLACK_REDIRECT  = import.meta.env.VITE_SLACK_OAUTH_REDIRECT || ''

// Clean up if the panel is closed before the OAuth completes
onUnmounted(_slackCleanup)

function connectSlack() {
	slackError.value = ''
	_slackCleanup()   // remove any stale listener from a previous attempt

	const scope = 'chat:write,im:write,channels:read,channels:history,groups:read,groups:history,im:read,im:history,mpim:read,mpim:history,users.profile:write'
	const oauthUrl =
		`https://slack.com/oauth/v2/authorize` +
		`?client_id=${SLACK_CLIENT_ID}` +
		`&user_scope=${encodeURIComponent(scope)}` +
		`&redirect_uri=${encodeURIComponent(SLACK_REDIRECT)}`

	// No noopener — the Railway callback needs window.opener to postMessage the token back.
	// Don't call popup.focus() — it can prevent the popup from rendering on iOS Safari.
	const popup = window.open(oauthUrl, 'slack-oauth', 'width=600,height=700')
	if (!popup) { slackError.value = 'Popup blocked — allow popups for this site'; return }

	_slackMsgListener = function onMessage(e) {
		// Guard: token must be present — avoids clearing an existing token on a
		// Railway "ping" message that has the right type but no token field.
		if (e.data?.type === 'slack-oauth-success' && e.data.token) {
			avatarStore.setSlackUserToken(e.data.token, e.data.teamId)
			_slackCleanup()
		} else if (e.data?.type === 'slack-oauth-error') {
			slackError.value = e.data.error || 'OAuth failed'
			_slackCleanup()
		}
	}
	window.addEventListener('message', _slackMsgListener)

	// Clean up listener when the popup closes (user dismissed without completing)
	_slackPollTimer = setInterval(() => {
		try { if (popup.closed) _slackCleanup() } catch { _slackCleanup() }
	}, 500)
}
</script>

<template>
	<div class="settings-backdrop" @click.self="$emit('close')">
		<div class="settings-panel">
			<div class="sp-header">
				<span class="sp-title">Settings</span>
				<button class="sp-close" @click="$emit('close')">
					<XMarkIcon style="width:1rem;height:1rem" />
				</button>
			</div>

			<div class="sp-body">
				<!-- Theme -->
				<div class="sp-section">
					<div class="sp-section-label">Appearance</div>
					<div class="sp-row">
						<span class="sp-row-label">Theme</span>
						<button
							class="theme-toggle"
							:class="{ dark: theme.isDark.value }"
							@click="theme.toggle()"
							:title="theme.isDark.value ? 'Switch to light mode' : 'Switch to dark mode'"
						>
							<span class="theme-knob" />
							<span class="theme-label">{{ theme.isDark.value ? '🌙 Night' : '☀️ Day' }}</span>
						</button>
					</div>
				</div>

				<!-- Integrations header -->
				<div>
					<div class="sp-section-label">Integrations</div>
					<p class="sp-row-hint text-warning">You may have to reconnect these periodically, as we enhance our services and redeploy them.</p>
				</div>

				<!-- Slack account (hidden — native messaging replaces Slack) -->
				<div v-if="false" class="sp-section">
					<div class="sp-row">
						<div class="sp-row-info">
							<span class="sp-row-label">Send DMs as yourself</span>
							<span class="sp-row-hint">Connect your Slack account so that your messages come from you rather than from &#8220;quickerSTORM&#8221;. For now you'll also need to keep Slack open; in the future we may duplicate the majority of Slack functionality here.</span>
						</div>
						<div class="slack-auth">
							<div v-if="slackLinked" class="slack-linked">
								<span class="slack-linked-label">✓ Connected</span>
								<button class="slack-unlink-btn" @click="avatarStore.setSlackUserToken('')">Disconnect</button>
							</div>
							<button v-else-if="SLACK_CLIENT_ID" class="slack-connect-btn" @click="connectSlack">
								Connect Slack
							</button>
							<div v-if="slackError" class="slack-error">{{ slackError }}</div>
						</div>
						<div v-if="!SLACK_CLIENT_ID && !slackLinked" class="slack-dev-notice">
							⚙️ Set <code>VITE_SLACK_CLIENT_ID</code> in <code>.env.development.local</code> and restart the dev server.
						</div>
					</div>
				</div>

				<!-- Google account -->
				<div class="sp-section">
					<!-- <div class="sp-section-label">Integrations</div> -->
					<div class="sp-row">
						<div class="sp-row-info">
							<span class="sp-row-label">Google Calendar</span>
							<span class="sp-row-hint">Shows today's meetings for you on your office calendar and on the conference-room projector screen, and alerts you when a meeting is about to start. <span class="text-warning">Be sure to use your AVA work Google account here, not your personal one.</span>
							</span>
						</div>
						<div class="slack-auth">
							<div v-if="calendarAuthed" class="slack-linked">
								<span class="slack-linked-label">✓ Connected</span>
							</div>
							<button
								v-else-if="GOOGLE_CLIENT_ID"
								class="slack-connect-btn"
								@click="connectGoogleCalendar"
							>
								Connect Google
							</button>
						</div>
						<div v-if="!GOOGLE_CLIENT_ID" class="slack-dev-notice">
							⚙️ Set <code>VITE_GOOGLE_CLIENT_ID</code> in <code>.env.development.local</code> and restart.
						</div>
					</div>
					<div class="sp-row">
						<div class="sp-row-info">
							<span class="sp-row-label">Google account index</span>
							<span class="sp-row-hint">
								Set this to match the # used for your Google work account.<br>
								0 = first acct, typically your personal one.<br />1 = second account (default), etc.
							</span>
						</div>
						<div class="g-idx-ctrl">
							<button
								class="g-idx-btn"
								@click="avatarStore.setGoogleAccountIndex(googleIdx - 1)"
								:disabled="googleIdx === 0"
							>−</button>
							<span class="g-idx-val">{{ googleIdx }}</span>
							<button
								class="g-idx-btn"
								@click="avatarStore.setGoogleAccountIndex(googleIdx + 1)"
								:disabled="googleIdx >= 9"
							>+</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.settings-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(4, 10, 20, 0.6);
	backdrop-filter: blur(4px);
	z-index: 600;
	display: flex;
	align-items: center;
	justify-content: center;
}

.settings-panel {
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	width: clamp(18rem, 28vw, 26rem);
	box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
	display: flex;
	flex-direction: column;
	overflow: hidden;
}

.sp-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.875rem 1rem 0.75rem;
	border-bottom: 1px solid var(--color-brd);
}

.sp-title {
	font-size: 0.9375rem;
	font-weight: 700;
	color: var(--color-t1);
	letter-spacing: 0.01em;
}

.sp-close {
	background: none;
	border: none;
	cursor: pointer;
	color: var(--color-tm);
	display: flex;
	align-items: center;
	padding: 0.25rem;
	border-radius: 0.25rem;
	transition: color 0.15s;
}
.sp-close:hover { color: var(--color-t1); }

.sp-body { padding: 0.75rem 1rem 1rem; display: flex; flex-direction: column; gap: 1.25rem; }

.sp-section { display: flex; flex-direction: column; gap: 0.5rem; }

.sp-section-label {
	font-size: 0.625rem;
	font-weight: 700;
	color: var(--color-tm);
	letter-spacing: 0.08em;
	text-transform: uppercase;
}

.sp-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}

.sp-row-info { display: flex; flex-direction: column; gap: 0.25rem; }
.sp-row-label { font-size: 0.8125rem; color: var(--color-t1); font-weight: 500; }
.sp-row-hint { font-size: 0.625rem; color: var(--color-tm); line-height: 1.4; }

/* Theme toggle */
.theme-toggle {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 2rem;
	padding: 0.3125rem 0.75rem 0.3125rem 0.3125rem;
	cursor: pointer;
	transition: background 0.2s, border-color 0.2s;
	flex-shrink: 0;
}
.theme-toggle:hover { border-color: var(--color-accent); }

.theme-knob {
	width: 1.125rem;
	height: 1.125rem;
	border-radius: 50%;
	background: var(--color-tm);
	transition: background 0.2s;
	flex-shrink: 0;
}
.theme-toggle.dark .theme-knob { background: var(--color-accent3); }

.theme-label {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--color-t2);
	white-space: nowrap;
}

/* Slack auth */
.slack-auth { display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem; flex-shrink: 0; }

.slack-connect-btn {
	background: #4a154b;
	border: none;
	border-radius: 0.375rem;
	color: #fff;
	font-size: 0.75rem;
	font-weight: 600;
	padding: 0.375rem 0.875rem;
	cursor: pointer;
	transition: background 0.15s;
	white-space: nowrap;
}
.slack-connect-btn:hover { background: #611f69; }

.slack-linked { display: flex; align-items: center; gap: 0.5rem; }
.slack-linked-label { font-size: 0.75rem; font-weight: 600; color: var(--color-green); white-space: nowrap; }

.slack-unlink-btn {
	background: none;
	border: 1px solid var(--color-brd2);
	border-radius: 0.3125rem;
	color: var(--color-tm);
	font-size: 0.6875rem;
	padding: 0.1875rem 0.5rem;
	cursor: pointer;
	transition: color 0.12s, border-color 0.12s;
}
.slack-unlink-btn:hover { color: var(--color-red); border-color: var(--color-red); }

.slack-error { font-size: 0.625rem; color: var(--color-red); max-width: 10rem; text-align: right; }

.slack-dev-notice {
	font-size: 0.6875rem; color: var(--color-tm);
	background: var(--color-card2); border: 1px solid var(--color-brd);
	border-radius: 0.375rem; padding: 0.5rem 0.625rem;
	line-height: 1.5; margin-top: 0.5rem;
}
.slack-dev-notice code {
	font-family: monospace; font-size: 0.625rem;
	background: var(--color-brd); border-radius: 0.2rem;
	padding: 0.1rem 0.3rem; color: var(--color-t2);
}

/* Google account index */
.g-idx-ctrl {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	flex-shrink: 0;
}

.g-idx-btn {
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.3125rem;
	color: var(--color-t2);
	font-size: 1rem;
	line-height: 1;
	width: 1.75rem;
	height: 1.75rem;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 0.12s, color 0.12s;
}
.g-idx-btn:hover:not(:disabled) { background: var(--color-brd2); color: var(--color-t1); }
.g-idx-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.g-idx-val {
	font-size: 1rem;
	font-weight: 700;
	color: var(--color-t1);
	min-width: 1.5rem;
	text-align: center;
}
</style>
