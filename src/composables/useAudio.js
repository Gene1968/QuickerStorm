/**
 * useAudio — procedural sound effects via Web Audio API.
 * No external files needed; all sounds are synthesized.
 */
import { ref } from 'vue'

const _sfx = import.meta.glob('../assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' })

const LS_ALL_AUDIO   = 'ava_all_audio_muted'
const LS_CONSENTED   = 'ava_sound_consented'

function readAllAudioMuted() {
	try {
		return localStorage.getItem(LS_ALL_AUDIO) === '1'
	} catch {
		return false
	}
}

/** When true, procedural SFX and remote voice output are silenced (mic transmit unchanged). */
export const isAllAudioMuted = ref(typeof window !== 'undefined' && readAllAudioMuted())

/** True once the user has responded to the sound consent prompt. */
export function hasSoundConsent() {
	try { return localStorage.getItem(LS_CONSENTED) === '1' } catch { return false }
}

/**
 * Called by the consent modal. Records consent, sets mute preference,
 * and resumes the AudioContext (the button click is the required user gesture).
 */
export function applyAudioConsent(wantSound) {
	isAllAudioMuted.value = !wantSound
	try {
		localStorage.setItem(LS_ALL_AUDIO,  wantSound ? '0' : '1')
		localStorage.setItem(LS_CONSENTED, '1')
	} catch { /* ignore */ }
	// Create + unlock the AudioContext inside the user-gesture click handler
	if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
	ctx.resume().catch(() => {})
}

export function toggleAllAudioMute() {
	isAllAudioMuted.value = !isAllAudioMuted.value
	try {
		localStorage.setItem(LS_ALL_AUDIO, isAllAudioMuted.value ? '1' : '0')
	} catch { /* ignore */ }
}

function soundOk() { return hasSoundConsent() && !isAllAudioMuted.value }

let ctx = null
let _loopAudio = null
let _soundBroadcaster = null

/** Registered by usePoseSync when a room channel is active. */
export function setSoundBroadcaster(fn) { _soundBroadcaster = fn }

function getCtx() {
	// Never create the AudioContext here — creation outside a user gesture triggers
	// "AudioContext was not allowed to start".  ctx is created only by:
	//   • applyAudioConsent()  — inside the consent button click
	//   • the unlock listener below — inside the first click/keydown for returning users
	// Until then, return null; all callers are wrapped in try/catch so they fail silently.
	return ctx
}

// Returning users skip the consent modal so applyAudioConsent never fires again.
// Resume the AudioContext on their first interaction instead.
if (typeof window !== 'undefined' && hasSoundConsent()) {
	const unlock = () => {
		if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
		ctx.resume().catch(() => {})
	}
	window.addEventListener('click',   unlock, { once: true, capture: true })
	window.addEventListener('keydown', unlock, { once: true, capture: true })
}

function _ramp(param, start, end, duration, now) {
	param.setValueAtTime(start, now)
	param.exponentialRampToValueAtTime(Math.max(end, 0.0001), now + duration)
}

function playDoorOpen()  { playSoundForRoom('dooropen.mp3', 0.7) }
function playDoorClose() { playSoundForRoom('doorclose.mp3', 0.7) }

/** Soft footstep click */
function playFootstep() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		const now = ac.currentTime
		const bufSize = ac.sampleRate * 0.03
		const buffer = ac.createBuffer(1, bufSize, ac.sampleRate)
		const data = buffer.getChannelData(0)
		for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)

		const noise = ac.createBufferSource()
		noise.buffer = buffer
		const filter = ac.createBiquadFilter()
		filter.type = 'highpass'
		filter.frequency.value = 800
		const gain = ac.createGain()
		gain.gain.setValueAtTime(0.06, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)

		noise.connect(filter)
		filter.connect(gain)
		gain.connect(ac.destination)
		noise.start(now)
	} catch { /* ignore */ }
}

/** Soft notification chime */
function playChime() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		const now = ac.currentTime
		const freqs = [880, 1100, 1320]

		freqs.forEach((freq, i) => {
			const osc = ac.createOscillator()
			const gain = ac.createGain()
			osc.connect(gain)
			gain.connect(ac.destination)
			osc.type = 'sine'
			osc.frequency.value = freq
			gain.gain.setValueAtTime(0, now + i * 0.08)
			gain.gain.linearRampToValueAtTime(0.15, now + i * 0.08 + 0.02)
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6)
			osc.start(now + i * 0.08)
			osc.stop(now + i * 0.08 + 0.7)
		})
	} catch { /* ignore */ }
}

/** Space-to-talk PTT start bip */
function playPTTStart() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		const now = ac.currentTime
		const osc = ac.createOscillator()
		const gain = ac.createGain()
		osc.connect(gain)
		gain.connect(ac.destination)
		osc.type = 'sine'
		osc.frequency.value = 660
		gain.gain.setValueAtTime(0.12, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
		osc.start(now)
		osc.stop(now + 0.2)
	} catch { /* ignore */ }
}

/** Space-to-talk PTT stop bip (lower) */
function playPTTStop() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		const now = ac.currentTime
		const osc = ac.createOscillator()
		const gain = ac.createGain()
		osc.connect(gain)
		gain.connect(ac.destination)
		osc.type = 'sine'
		osc.frequency.value = 440
		gain.gain.setValueAtTime(0.1, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
		osc.start(now)
		osc.stop(now + 0.15)
	} catch { /* ignore */ }
}

/** Squishy bwoop for greetings — bounce up then drop */
function playGreet() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		if (!ac) return
		const now = ac.currentTime
		// Layer two slightly detuned oscillators for a fuller bloop
		;[[360, 0], [365, 0.008]].forEach(([baseFreq, delay]) => {
			const osc  = ac.createOscillator()
			const gain = ac.createGain()
			osc.connect(gain)
			gain.connect(ac.destination)
			osc.type = 'sine'
			// Squish: mid → up → down  gives the rubbery bounce feel
			osc.frequency.setValueAtTime(baseFreq, now + delay)
			osc.frequency.linearRampToValueAtTime(baseFreq * 1.75, now + delay + 0.04)
			osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.62, now + delay + 0.26)
			gain.gain.setValueAtTime(0, now + delay)
			gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.018)
			gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3)
			osc.start(now + delay)
			osc.stop(now + delay + 0.32)
		})
	} catch { /* ignore */ }
}

/** Triple bell ding for announcements (880 → 1100 → 880 Hz) */
function playAnnouncementBell() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		const now = ac.currentTime
		const freqs = [880, 1100, 880]

		freqs.forEach((freq, i) => {
			const osc = ac.createOscillator()
			const gain = ac.createGain()
			osc.connect(gain)
			gain.connect(ac.destination)
			osc.type = 'sine'
			osc.frequency.value = freq
			const t = now + i * 0.25
			gain.gain.setValueAtTime(0, t)
			gain.gain.linearRampToValueAtTime(0.28, t + 0.01)
			gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
			osc.start(t)
			osc.stop(t + 1.15)
		})
	} catch { /* ignore */ }
}

function playDogBark() { playSoundForRoom('bark.mp3') }

/** Start a looping MP3 from src/assets/audio/ — idempotent */
function playLooping(filename) {
	if (!soundOk() || _loopAudio) return
	try {
		const url = _sfx[`../assets/audio/${filename}`]
		if (!url) return
		_loopAudio = new Audio(url)
		_loopAudio.loop = true
		_loopAudio.play().catch(() => {})
	} catch { /* ignore */ }
}

/** Stop the current looping sound */
function stopLooping() {
	if (!_loopAudio) return
	try { _loopAudio.pause(); _loopAudio.currentTime = 0 } catch { /* ignore */ }
	_loopAudio = null
}

/** Play a named MP3 from src/assets/audio/ */
export function playSound(filename, volume = 1) {
	if (!soundOk()) return
	try {
		const url = _sfx[`../assets/audio/${filename}`]
		if (!url) return
		const audio = new Audio(url)
		audio.volume = Math.min(1, Math.max(0, Number(volume) || 0))
		audio.play().catch(() => {})
	} catch { /* ignore */ }
}

/** Play locally and broadcast to all peers in the same room. */
function playSoundForRoom(filename, volume = 1) {
	playSound(filename, volume)
	_soundBroadcaster?.(filename, volume)
}

/** Soft ambient whoosh for room transitions */
function playTransition() {
	if (!soundOk()) return
	try {
		const ac = getCtx()
		const now = ac.currentTime
		const bufSize = ac.sampleRate * 0.5
		const buffer = ac.createBuffer(1, bufSize, ac.sampleRate)
		const data = buffer.getChannelData(0)
		for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1

		const noise = ac.createBufferSource()
		noise.buffer = buffer

		const filter = ac.createBiquadFilter()
		filter.type = 'bandpass'
		filter.frequency.value = 400
		filter.Q.value = 0.5

		const gain = ac.createGain()
		gain.gain.setValueAtTime(0.001, now)
		gain.gain.linearRampToValueAtTime(0.06, now + 0.15)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)

		noise.connect(filter)
		filter.connect(gain)
		gain.connect(ac.destination)
		noise.start(now)
	} catch { /* ignore */ }
}

export function useAudio() {
	return {
		playDoorOpen,
		playDoorClose,
		playFootstep,
		playChime,
		playPTTStart,
		playPTTStop,
		playTransition,
		playGreet,
		playDogBark,
		playAnnouncementBell,
		playSound,
		playSoundForRoom,
		playLooping,
		stopLooping,
		isAllAudioMuted,
		toggleAllAudioMute,
	}
}
