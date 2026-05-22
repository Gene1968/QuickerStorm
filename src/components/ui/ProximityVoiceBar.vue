<script setup>
/**
 * ProximityVoiceBar — fixed bottom bar for proximity voice chat.
 * Zoom-style: muted by default, click mic to toggle, hold SPACE/button to talk while muted.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useProximityVoice, connectedPeerIds, roomLocked } from '@/composables/useProximityVoice.js'
import { useAudio }          from '@/composables/useAudio.js'
import { useAvatarStore }    from '@/stores/avatarStore.js'
import { usePresenceStore }  from '@/stores/presenceStore.js'
import { useOfficeStore }    from '@/stores/officeStore.js'
import { Mic as MicrophoneIcon, Lock as LockClosedIcon } from '@lucide/vue'

const voice       = useProximityVoice()
const { isAllAudioMuted, toggleAllAudioMute } = useAudio()
const avatarStore = useAvatarStore()
const presenceStore = usePresenceStore()
const officeStore = useOfficeStore()

const showBar    = ref(false)
const showDevices = ref(false)

const LS_AUTOJOIN = 'ava_voice_autojoin'

const isDev = import.meta.env.DEV
const devVoiceHint = isDev ? 'Requires localhost + `npm run signal` on port 8787' : null

// ── Space-to-talk + Shift+Alt+A mute toggle ──────────────────────────
function onKeyDown(e) {
	if (e.shiftKey && e.altKey && e.code === 'KeyA') {
		const tag = document.activeElement?.tagName
		if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
		e.preventDefault()
		if (voice.isEnabled.value) voice.toggleMute()
	}
}

onMounted(async () => {
	window.addEventListener('ava-ptt-start', onPTTStart)
	window.addEventListener('ava-ptt-stop',  onPTTStop)
	window.addEventListener('keydown', onKeyDown)
	document.addEventListener('pointerdown', onDocClick)

	if (localStorage.getItem(LS_AUTOJOIN) === '1') {
		_tryAutoJoin()
	}
})
onUnmounted(() => {
	window.removeEventListener('ava-ptt-start', onPTTStart)
	window.removeEventListener('ava-ptt-stop',  onPTTStop)
	window.removeEventListener('keydown', onKeyDown)
	document.removeEventListener('pointerdown', onDocClick)
})

function onPTTStart() { if (voice.isEnabled.value && voice.isMuted.value) voice.startTalking() }
function onPTTStop()  { if (voice.isTalking.value) voice.stopTalking() }

// ── Auto-rejoin: wait for presence to resolve myUserId ───────────────
let _autoJoinTimer = null
function _tryAutoJoin () {
	// If presence already resolved, join immediately
	if (presenceStore.myUserId) {
		_doAutoJoin()
		return
	}
	// Otherwise wait for myUserId to be set (presence.start() runs in parent onMounted)
	const stop = watch(() => presenceStore.myUserId, (id) => {
		if (!id) return
		stop()
		clearTimeout(_autoJoinTimer)
		_doAutoJoin()
	})
	// Safety timeout — don't wait forever if presence fails
	_autoJoinTimer = setTimeout(() => {
		stop()
		console.warn('[voice] auto-rejoin timed out waiting for presenceStore.myUserId')
	}, 10_000)
}
async function _doAutoJoin () {
	try {
		const perm = await navigator.permissions.query({ name: 'microphone' }).catch(() => null)
		if (!perm || perm.state === 'granted') await enableVoice()
	} catch { /* ignore */ }
}

// ── Join / leave ─────────────────────────────────────────────────────
async function enableVoice() {
	const myId = String(presenceStore.myUserId || avatarStore.authUserId || 'me')
	// Join the voice channel that matches our current office room, not a
	// hard-coded lobby. Critical for knock-admitted users: they're physically
	// in roomX, so their voice must also join roomX (useProximityVoice passes
	// admitted=true on join when we were just admitted to this room).
	const roomId = officeStore.currentRoomId || 'lobby'
	await voice.enable(myId, roomId)
	if (!voice.micError.value) {
		localStorage.setItem(LS_AUTOJOIN, '1')
		showBar.value = true
	}
}

function leaveVoice() {
	localStorage.removeItem(LS_AUTOJOIN)
	voice.disable()
	showBar.value  = false
	showDevices.value = false
}

// ── Device picker ────────────────────────────────────────────────────
const devicePanelRef = ref(null)

async function toggleDevices() {
	showDevices.value = !showDevices.value
	if (showDevices.value) await voice.loadDevices()
}

function onDocClick(e) {
	if (showDevices.value && devicePanelRef.value && !devicePanelRef.value.contains(e.target)) {
		showDevices.value = false
	}
	if (showListeners.value && listenersPanelRef.value && !listenersPanelRef.value.contains(e.target)) {
		showListeners.value = false
	}
}

const micDevices = computed(() => voice.audioDevices.value.filter(d => d.kind === 'audioinput'))
const spkDevices = computed(() => voice.audioDevices.value.filter(d => d.kind === 'audiooutput'))
const canSetSink = typeof AudioContext !== 'undefined' && typeof AudioContext.prototype.setSinkId === 'function'

// ── Listeners (who can hear me) ─────────────────────────────────────
const showListeners = ref(false)
const listenersPanelRef = ref(null)

const listeners = computed(() => {
	const ids = connectedPeerIds.value
	if (!ids.size) return []
	return [...ids]
		.map(id => {
			const user = presenceStore.users.find(u => String(u.id) === String(id))
			if (!user) return null
			return {
				id,
				name: user.name || user.title || `User ${id}`,
				title: user.title || '',
			}
		})
		.filter(Boolean)
})

function toggleListeners() { showListeners.value = !showListeners.value }

// ── Level bars ──────��────────────────────────────────────────────────
// 5 bars; each lights when level exceeds its threshold
const BAR_THRESHOLDS = [0.05, 0.18, 0.35, 0.55, 0.75]
function barActive(i) {
	return !voice.isMuted.value && voice.audioLevel.value >= BAR_THRESHOLDS[i]
}

function onTalkDown(e) {
	e.currentTarget.setPointerCapture(e.pointerId)
	voice.startTalking()
}
</script>

<template>
	<!-- Join button + mute toggle (pre-voice) -->
	<div v-if="!voice.isEnabled.value" class="voice-pre-bar">
		<div
			class="voice-enable-btn hud-btn"
			:title="devVoiceHint"
			@click="enableVoice"
		>
			<MicrophoneIcon style="width:14px;height:14px" />
			Join Voice
		</div>
		<button
			class="pre-mute-btn vb-ctrl text-lg px-1 xl:px-3"
			:title="(isAllAudioMuted ? 'Unmute' : 'Mute') + ' all sound'"
			@click="toggleAllAudioMute"
		>
			<div class="sound-wrap" :class="{ muted: isAllAudioMuted }">🔊</div>
		</button>
		<p class="bg-danger text-white fw-bold p-2 pxx-4 rounded-5">👈 You can't participate in audio conversations until you join.</p>
	</div>

	<!-- Active voice bar -->
	<Transition name="slide-up">
		<div v-if="voice.isEnabled.value" class="voice-bar flex align-items-center justify-between">

			<!-- Mic toggle + level -->
			<div class="vb-mic col text-nowrap">
				<button
					class="vb-mic-btn vb-ctrl text-lg px-1 xl:px-3 focus:outline-none"
					:class="{ muted: voice.isMuted.value, talking: voice.isTalking.value }"
					:title="(voice.isMuted.value ? 'Unmute (Shift+Alt+A) · Hold SPACE to talk while muted' : 'Mute (Shift+Alt+A)')"
					@click="voice.toggleMute"
				>
					<div class="mic-wrap" :class="{ muted: voice.isMuted.value, talking: voice.isTalking.value }">
						<MicrophoneIcon class="mic-svg" />
					</div>
				</button>

				<!-- Level bars -->
				<div class="level-bars" :class="{ live: !voice.isMuted.value }">
					<div
						v-for="i in 5" :key="i"
						class="level-bar"
						:class="{ active: barActive(i - 1) }"
						:style="{ height: (40 + i * 12) + '%' }"
					/>
				</div>
				<!-- Status / hint -->
				<div class="flex align-items-center justify-start">
					<span v-if="voice.isTalking.value" class="status-talking">Transmitting…</span>
					<span v-else class="status-live">Connected</span>
					<span v-if="voice.isMuted.value" class="status-muted">
						<span class="mx-2 xl:mx-4">·</span>👈 <span class="hidden xl:inline">Your</span> mic<span class="hidden lg:inline"> is</span>&#160;<strong>muted</strong>
					</span>
				</div>
			</div>


			<div class="flex align-items-center justify-center col hidden lg:block">
				<div class="flex align-items-center text-nowrap text-xs text-gray-700">
					<span v-if="voice.isMuted.value">Hold<kbd class="mx-1">SPACEBAR</kbd>or</span>
					<button
						class="talk-btn mx-1 lh-sm"
						:class="{ active: voice.isTalking.value }"
						@pointerdown.prevent="onTalkDown"
						@pointerup="voice.stopTalking"
						@touchstart.prevent="voice.startTalking"
						@touchend.prevent="voice.stopTalking"
					>
						<MicrophoneIcon style="width:13px;height:13px" />
						{{ voice.isTalking.value ? 'Talking' : 'Press here' }}
					</button>
					<span v-if="!voice.isTalking.value">to briefly unmute</span>
					<span v-else> / unmuted</span>
				</div>
			</div>

			<!-- Who can hear me — button + popup -->
			<div class="listeners-wrap" ref="listenersPanelRef">
				<button
					class="listeners-btn lh-sm"
					:class="{ locked: roomLocked, 'has-peers': listeners.length > 0 }"
					@click="toggleListeners"
					:title="listeners.length
						? listeners.map(l => l.name || l.title).join(', ') + ' can hear you'
						: 'No one can hear you'"
				>
					<LockClosedIcon v-if="roomLocked" class="listeners-lock-icon" />
					<span class="listeners-count">{{ listeners.length }}</span>
					<span class="listeners-label">{{ listeners.length === 1 ? 'listener' : 'listeners' }}</span>
				</button>

				<Transition name="popup">
					<div v-if="showListeners" class="listeners-panel">
						<div class="lp-header">
							<LockClosedIcon v-if="roomLocked" class="lp-lock-icon" />
							<span class="lp-title">{{ roomLocked ? 'Private Room' : 'Who Can Hear You' }}</span>
						</div>
						<div v-if="listeners.length" class="lp-list">
							<div v-for="l in listeners" :key="l.id" class="lp-user">
								<span class="lp-dot"></span>
								<div class="lp-info">
									<span class="lp-name">{{ l.name }}</span>
									<span v-if="l.title" class="lp-title-sub">{{ l.title }}</span>
								</div>
							</div>
						</div>
						<div v-else class="lp-empty">No one else is on voice in this room.</div>
					</div>
				</Transition>
			</div>

			<!-- Right: Device settings + leave -->
			<div class="flex align-items-center justify-end col text-nowrap">
				<div class="device-wrap" ref="devicePanelRef">
					<button
						class="vb-ctrl text-lg px-1 xl:px-3"
						:title="(isAllAudioMuted ? 'Unmute' : 'Mute') + ' all sound (voice + effects)'"
						@click="toggleAllAudioMute"
					>
						<div class="sound-wrap" :class="{ muted: isAllAudioMuted }">🔊</div>
					</button>
					<button class="vb-ctrl text-lg px-1 xl:px-3" title="Audio devices" @click="toggleDevices">⚙</button>

					<Transition name="popup">
						<div v-if="showDevices" class="device-panel">
							<div class="dp-section">
								<label class="dp-label">Microphone</label>
								<select
									class="dp-select"
									:value="voice.selectedMicId.value"
									@change="voice.setMicDevice($event.target.value)"
								>
									<option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">
										{{ d.label || `Microphone ${d.deviceId.slice(0,6)}` }}
									</option>
								</select>
							</div>
							<div class="dp-section" v-if="spkDevices.length">
								<label class="dp-label">Speaker</label>
								<select
									class="dp-select"
									:value="voice.selectedSpkId.value"
									@change="voice.setSpeakerDevice($event.target.value)"
									:disabled="!canSetSink"
									:title="canSetSink ? '' : 'Speaker routing not supported in this browser'"
								>
									<option v-for="d in spkDevices" :key="d.deviceId" :value="d.deviceId">
										{{ d.label || `Speaker ${d.deviceId.slice(0,6)}` }}
									</option>
								</select>
								<p v-if="!canSetSink" class="dp-note">Speaker routing: use system audio settings</p>
							</div>
						</div>
					</Transition>
				</div>

				<button class="vb-ctrl leave ms-1 px-1 xl:px-3" @click="leaveVoice" title="Leave voice">✕</button>
			</div>
		</div>
	</Transition>

	<!-- Mic error -->
	<div v-if="voice.micError.value" class="mic-error">
		🎤 {{ voice.micError.value }}
	</div>

<Teleport to="body">
	<div v-if="showDevices" class="device-backdrop" @pointerdown.stop="showDevices = false" />
</Teleport>
</template>

<style scoped>
.voice-pre-bar {
	position: fixed;
	bottom: 1rem;
	left: calc(var(--canvas-left) + 1rem);
	z-index: 50;
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.voice-enable-btn {
	cursor: pointer;
}

.pre-mute-btn {
	font-size: 0.875rem;
	padding: 0.25rem 0.4375rem;
}

/* ── Bar ── */
.voice-bar {
	position: fixed;
	bottom: 0;
	left: var(--canvas-left);
	right: 0;
	background: #0a101af2;
	border-top: 1px solid var(--color-brd);
	gap: 1.25rem;
	padding: 0 0.5rem 0 0.125rem;
	height: 3.25rem;
	backdrop-filter: blur(8px);
	z-index: 525;
	user-select: none;
	transition: left 0.25s, width 0.25s;
}

/* ── Mic button + level ── */
.vb-mic {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.vb-mic-btn {
	background: none;
	border: none;
	cursor: pointer;
	padding: 0;
	display: flex;
	align-items: center;
}

.mic-wrap,
.sound-wrap {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 50%;
	width: 2rem;
	height: 2rem;
	transition: background 0.15s, border-color 0.15s;
}
.mic-wrap.talking {
	background: rgba(0, 200, 83, 0.18);
	border-color: var(--color-green);
}
.mic-wrap.muted,
.sound-wrap.muted {
	background: rgba(244, 67, 54, 0.12);
	border-color: rgba(244, 67, 54, 0.4);
}

.mic-svg {
	width: 1rem;
	height: 1rem;
	color: var(--color-tm);
	transition: color 0.15s;
}
.mic-wrap.talking .mic-svg { color: var(--color-green); }
.mic-wrap.muted   .mic-svg { color: var(--color-red); }



/* Red diagonal slash when muted */
.mic-wrap.muted::after,
.sound-wrap.muted::after {
	content: '';
	position: absolute;
	top: 50%;
	left: 50%;
	width: 130%;
	height: 0.125rem;
	background: var(--color-red);
	transform: translate(-50%, -50%) rotate(-45deg);
	border-radius: 0.0625rem;
	pointer-events: none;
}

/* ── Level bars ── */
.level-bars {
	display: flex;
	align-items: flex-end;
	gap: 0.1875rem;
	height: 1rem;
	opacity: 0.35;
	transition: opacity 0.2s;
}
.level-bars.live { opacity: 1; }

.level-bar {
	width: 0.1875rem;
	border-radius: 0.125rem;
	background: var(--color-brd2);
	transition: background 0.08s, height 0.08s;
	min-height: 20%;
}
.level-bar.active {
	background: var(--color-green);
}

/* ── Status text ── */
.status-muted  { color: var(--color-tm); }
.status-live   { color: var(--color-tm); }
.status-talking { color: var(--color-green); font-weight: 700; }
kbd {
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.25rem;
	padding: 0.0625rem 0.3125rem;
	font-size: 0.625rem;
	font-family: inherit;
	color: var(--color-t2);
}

/* ── Hold to talk button ── */
.talk-btn {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 1.25rem;
	color: var(--color-t2);
	font-size: 0.75rem;
	font-weight: 700;
	padding: 0.375rem 0.6rem;
	cursor: pointer;
	user-select: none;
	transition: background 0.15s, border-color 0.15s, color 0.15s;
	white-space: nowrap;
}
.talk-btn:hover { background: rgba(255,255,255,0.06); color: var(--color-t1); }
.talk-btn.active {
	background: rgba(0, 200, 83, 0.2);
	border-color: var(--color-green);
	color: var(--color-green);
}


.vb-ctrl {
	background: none;
	border: 1px solid transparent;
	border-radius: 0.375rem;
	padding: 0.375rem;
	color: var(--color-tm);
	cursor: pointer;
	font-size: 0.75rem;
	font-weight: 600;
	transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.vb-ctrl:hover { background: rgba(255,255,255,0.05); color: var(--color-t1); }
.vb-ctrl.leave { color: var(--color-red); }
.vb-ctrl.leave:hover { background: rgba(244, 67, 54, 0.1); }

/* ── Device panel ── */
.device-wrap { position: relative; z-index: 40; }
.device-backdrop { position: fixed; inset: 0; z-index: 29; }

.device-panel {
	position: absolute;
	bottom: calc(100% + 0.5rem);
	right: 0;
	width: 17rem;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	padding: 0.875rem;
	box-shadow: 0 0.5rem 2rem rgba(0,0,0,0.5);
	z-index: 40;
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
}

.dp-section { display: flex; flex-direction: column; gap: 0.25rem; }
.dp-label { font-size: 0.6875rem; font-weight: 600; color: var(--color-tm); text-transform: uppercase; letter-spacing: 0.06em; }
.dp-select {
	background: var(--color-card2);
	border: 1px solid var(--color-brd2);
	border-radius: 0.375rem;
	color: var(--color-t1);
	font-size: 0.75rem;
	padding: 0.375rem 0.5rem;
	cursor: pointer;
	outline: none;
}
.dp-select:focus { border-color: var(--color-accent); }
.dp-select:disabled { opacity: 0.45; cursor: not-allowed; }
.dp-note { font-size: 0.625rem; color: var(--color-tm); margin: 0; }

/* ── Mic error ── */
.mic-error {
	position: fixed;
	bottom: 4rem;
	left: calc(var(--canvas-left) + 1rem);
	background: rgba(244, 67, 54, 0.15);
	border: 1px solid var(--color-red);
	border-radius: 0.4375rem;
	color: var(--color-red);
	font-size: 0.75rem;
	padding: 0.5rem 0.875rem;
	z-index: 30;
}

/* ── Listeners button + popup ── */
.listeners-wrap {
	position: relative;
}

.listeners-btn {
	display: flex;
	align-items: center;
	gap: 0.3125rem;
	background: rgba(0, 180, 216, 0.08);
	border: 1px solid rgba(0, 180, 216, 0.25);
	border-radius: 1.25rem;
	color: var(--color-t2);
	font-size: 0.6875rem;
	font-weight: 600;
	padding: 0.3125rem 0.75rem 0.3125rem 0.5rem;
	cursor: pointer;
	transition: background 0.15s, border-color 0.15s, color 0.15s;
	white-space: nowrap;
}
.listeners-btn:hover {
	background: rgba(0, 180, 216, 0.14);
	border-color: rgba(0, 180, 216, 0.4);
	color: var(--color-t1);
}
.listeners-btn.has-peers {
	background: rgba(0, 180, 216, 0.12);
	border-color: rgba(0, 180, 216, 0.35);
	color: var(--color-t1);
}
.listeners-btn.locked {
	border-color: rgba(239, 68, 68, 0.45);
	background: rgba(239, 68, 68, 0.1);
}
.listeners-btn.locked:hover {
	background: rgba(239, 68, 68, 0.16);
}

.listeners-lock-icon {
	width: 0.6875rem;
	height: 0.6875rem;
	color: var(--color-red, #ef4444);
}

.listeners-count {
	font-weight: 700;
	font-size: 0.8125rem;
	color: var(--color-accent, #00b4d8);
}
.listeners-btn.has-peers .listeners-count {
	color: var(--color-accent3, #90e0ef);
}
.listeners-btn.locked .listeners-count {
	color: var(--color-red, #ef4444);
}

.listeners-label {
	color: inherit;
	opacity: 0.8;
}

/* ── Listeners panel ── */
.listeners-panel {
	position: absolute;
	bottom: calc(100% + 0.5rem);
	left: 50%;
	transform: translateX(-50%);
	width: 16rem;
	background: var(--color-card);
	border: 1px solid var(--color-brd2);
	border-radius: 0.75rem;
	padding: 0.875rem;
	box-shadow: 0 0.5rem 2rem rgba(0,0,0,0.5);
	z-index: 40;
}

.lp-header {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	margin-bottom: 0.25rem;
	padding-bottom: 0.25rem;
	border-bottom: 1px solid var(--color-brd2);
}

.lp-lock-icon {
	width: 0.8125rem;
	height: 0.8125rem;
	color: var(--color-red, #ef4444);
}

.lp-title {
	font-size: 0.6875rem;
	font-weight: 700;
	color: var(--color-accent, #00b4d8);
	text-transform: uppercase;
	letter-spacing: 0.04em;
}

.lp-list {
	display: flex;
	flex-direction: column;
	max-height: 14rem;
	overflow-y: auto;
}

.lp-user {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.25rem 0;
}

.lp-dot {
	width: 0.4375rem;
	height: 0.4375rem;
	border-radius: 50%;
	background: var(--color-accent3, #90e0ef);
	flex-shrink: 0;
	box-shadow: 0 0 4px rgba(0, 180, 216, 0.4);
}

.lp-info {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.lp-name {
	font-size: 0.75rem;
	font-weight: 600;
	color: var(--color-t1);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.lp-title-sub {
	font-size: 0.625rem;
	color: var(--color-accent, #00b4d8);
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.lp-empty {
	font-size: 0.75rem;
	color: var(--color-tm);
	text-align: center;
	padding: 0.375rem 0;
}

/* ── Transitions ── */
.slide-up-enter-active, .slide-up-leave-active { transition: transform 0.25s, opacity 0.25s; }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity: 0; }

.popup-enter-active { transition: opacity 0.15s, transform 0.15s; }
.popup-leave-active { transition: opacity 0.1s, transform 0.1s; }
.popup-enter-from, .popup-leave-to { opacity: 0; transform: translateY(0.25rem); }
</style>
