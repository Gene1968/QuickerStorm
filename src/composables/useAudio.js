/**
 *
 * useAudio.js - QuickSim audio system — procedural sound effects via Web Audio API + file-based MP3 playback.
 *
 * This still has a lot of code from the older app we started from
 *
 * AudioContext is unlocked on the first user click or keydown — no consent modal needed.
 * Volume channels: Master (isAllAudioMuted / masterVolume) and Interface are wired.
 * Ambient / Sounds / Music / Media / Voice channels are stubbed (state only, no routing yet).
 */
import { ref, watch } from 'vue'

const _sfx = import.meta.glob('../assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' })

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_ALL_AUDIO      = 'qs_all_audio_muted'
const LS_VOL_MASTER     = 'qs_vol_master'
const LS_VOL_INTERFACE  = 'qs_vol_interface'
const LS_MUTE_INTERFACE = 'qs_mute_interface'

function _readBool(key, fallback = false) {
	try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1' } catch { return fallback }
}
function _readFloat(key, fallback = 1) {
	try { const v = parseFloat(localStorage.getItem(key)); return isNaN(v) ? fallback : Math.min(1, Math.max(0, v)) } catch { return fallback }
}
function _writeBool(key, val)  { try { localStorage.setItem(key, val ? '1' : '0') } catch {} }
function _writeFloat(key, val) { try { localStorage.setItem(key, String(val))     } catch {} }

// ── AudioContext unlock ───────────────────────────────────────────────────────
let ctx = null
let _unlocked = false

function _unlockOnce() {
	if (_unlocked) return
	_unlocked = true
	document.removeEventListener('click',   _unlockOnce, true)
	document.removeEventListener('keydown', _unlockOnce, true)
	if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
	ctx.resume().catch(() => {})
}

if (typeof document !== 'undefined') {
	document.addEventListener('click',   _unlockOnce, { capture: true })
	document.addEventListener('keydown', _unlockOnce, { capture: true })
}

function getCtx() { return ctx }

// ── Master channel ────────────────────────────────────────────────────────────
/** Mutes all audio when true. Toggled by the sound icon button. */
export const isAllAudioMuted = ref(typeof window !== 'undefined' && _readBool(LS_ALL_AUDIO))
/** Master volume 0–1. Applied to all file-based sounds. */
export const masterVolume    = ref(typeof window !== 'undefined' ? _readFloat(LS_VOL_MASTER, 1) : 1)

export function toggleAllAudioMute() {
	isAllAudioMuted.value = !isAllAudioMuted.value
	_writeBool(LS_ALL_AUDIO, isAllAudioMuted.value)
}

// ── Interface channel — UI pops, notifications, woosh, etc. ──────────────────
export const interfaceVolume = ref(typeof window !== 'undefined' ? _readFloat(LS_VOL_INTERFACE, 1) : 1)
export const interfaceMuted  = ref(typeof window !== 'undefined' ? _readBool(LS_MUTE_INTERFACE, false) : false)

// Persist volume/mute changes to localStorage
watch(masterVolume,    v => _writeFloat(LS_VOL_MASTER,    v))
watch(interfaceVolume, v => _writeFloat(LS_VOL_INTERFACE, v))
watch(interfaceMuted,  v => _writeBool(LS_MUTE_INTERFACE, v))

// ── Stub channels (state + persistence; no routing yet) ──────────────────────
export const ambientVolume = ref(1); export const ambientMuted = ref(false)
export const soundsVolume  = ref(1); export const soundsMuted  = ref(false)
export const musicVolume   = ref(1); export const musicMuted   = ref(false)
export const mediaVolume   = ref(1); export const mediaMuted   = ref(false)
export const voiceVolume   = ref(1); export const voiceMuted   = ref(false)

// ── soundOk helpers ───────────────────────────────────────────────────────────
function soundOk()          { return _unlocked && !isAllAudioMuted.value }
function interfaceSoundOk() { return soundOk() && !interfaceMuted.value }

// Always returns true — consent gate is removed.
export function hasSoundConsent() { return true }

// ── Web Audio helpers ─────────────────────────────────────────────────────────
let _loopAudio     = null
let _soundBroadcaster = null

export function setSoundBroadcaster(fn) { _soundBroadcaster = fn }

function _ramp(param, start, end, duration, now) {
	param.setValueAtTime(start, now)
	param.exponentialRampToValueAtTime(Math.max(end, 0.0001), now + duration)
}

// ── Sounds categorised as Interface ──────────────────────────────────────────
const INTERFACE_SOUNDS = new Set([
	'pop.mp3', 'pop!.mp3', 'ui-open.mp3', 'ui-dismiss.mp3',
	'woosh.mp3', 'blip.mp3', 'tick.mp3', 'beep.mp3', 'bell.mp3',
	'notification.mp3', 'notification2.mp3', 'dm.mp3', 'sent.mp3', 'vibrate.mp3',
])

// ── File-based playback ───────────────────────────────────────────────────────
export function playSound(filename, volume = 1) {
	const isInterface = INTERFACE_SOUNDS.has(filename)
	if (isInterface ? !interfaceSoundOk() : !soundOk()) return
	try {
		const url = _sfx[`../assets/audio/${filename}`]
		if (!url) return
		const audio = new Audio(url)
		const channelVol = isInterface ? interfaceVolume.value : 1
		audio.volume = Math.min(1, Math.max(0, Number(volume) * masterVolume.value * channelVol))
		audio.play().catch(() => {})
	} catch { /* ignore */ }
}

export function playSoundForRoom(filename, volume = 1) {
	playSound(filename, volume)
	_soundBroadcaster?.(filename, volume)
}

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

function stopLooping() {
	if (!_loopAudio) return
	try { _loopAudio.pause(); _loopAudio.currentTime = 0 } catch { /* ignore */ }
	_loopAudio = null
}

// ── Procedural sounds ─────────────────────────────────────────────────────────
function playDoorOpen()  { playSoundForRoom('dooropen.mp3',  0.7) }
function playDoorClose() { playSoundForRoom('doorclose.mp3', 0.7) }
function playDogBark()   { playSoundForRoom('bark.mp3') }

function playFootstep() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		const bufSize = ac.sampleRate * 0.03
		const buffer = ac.createBuffer(1, bufSize, ac.sampleRate)
		const data = buffer.getChannelData(0)
		for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize)
		const noise = ac.createBufferSource(); noise.buffer = buffer
		const filter = ac.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 800
		const gain = ac.createGain()
		gain.gain.setValueAtTime(0.06, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05)
		noise.connect(filter); filter.connect(gain); gain.connect(ac.destination)
		noise.start(now)
	} catch { /* ignore */ }
}

function playChime() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		;[880, 1100, 1320].forEach((freq, i) => {
			const osc = ac.createOscillator(); const gain = ac.createGain()
			osc.connect(gain); gain.connect(ac.destination)
			osc.type = 'sine'; osc.frequency.value = freq
			gain.gain.setValueAtTime(0, now + i * 0.08)
			gain.gain.linearRampToValueAtTime(0.15, now + i * 0.08 + 0.02)
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.6)
			osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.7)
		})
	} catch { /* ignore */ }
}

function playPTTStart() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		const osc = ac.createOscillator(); const gain = ac.createGain()
		osc.connect(gain); gain.connect(ac.destination)
		osc.type = 'sine'; osc.frequency.value = 660
		gain.gain.setValueAtTime(0.12, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
		osc.start(now); osc.stop(now + 0.2)
	} catch { /* ignore */ }
}

function playPTTStop() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		const osc = ac.createOscillator(); const gain = ac.createGain()
		osc.connect(gain); gain.connect(ac.destination)
		osc.type = 'sine'; osc.frequency.value = 440
		gain.gain.setValueAtTime(0.1, now)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
		osc.start(now); osc.stop(now + 0.15)
	} catch { /* ignore */ }
}

function playGreet() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		;[[360, 0], [365, 0.008]].forEach(([baseFreq, delay]) => {
			const osc = ac.createOscillator(); const gain = ac.createGain()
			osc.connect(gain); gain.connect(ac.destination)
			osc.type = 'sine'
			osc.frequency.setValueAtTime(baseFreq, now + delay)
			osc.frequency.linearRampToValueAtTime(baseFreq * 1.75, now + delay + 0.04)
			osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.62, now + delay + 0.26)
			gain.gain.setValueAtTime(0, now + delay)
			gain.gain.linearRampToValueAtTime(0.18, now + delay + 0.018)
			gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3)
			osc.start(now + delay); osc.stop(now + delay + 0.32)
		})
	} catch { /* ignore */ }
}

function playAnnouncementBell() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		;[880, 1100, 880].forEach((freq, i) => {
			const osc = ac.createOscillator(); const gain = ac.createGain()
			osc.connect(gain); gain.connect(ac.destination)
			osc.type = 'sine'; osc.frequency.value = freq
			const t = now + i * 0.25
			gain.gain.setValueAtTime(0, t)
			gain.gain.linearRampToValueAtTime(0.28, t + 0.01)
			gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
			osc.start(t); osc.stop(t + 1.15)
		})
	} catch { /* ignore */ }
}

function playTransition() {
	if (!soundOk()) return
	try {
		const ac = getCtx(); if (!ac) return
		const now = ac.currentTime
		const bufSize = ac.sampleRate * 0.5
		const buffer = ac.createBuffer(1, bufSize, ac.sampleRate)
		const data = buffer.getChannelData(0)
		for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
		const noise = ac.createBufferSource(); noise.buffer = buffer
		const filter = ac.createBiquadFilter()
		filter.type = 'bandpass'; filter.frequency.value = 400; filter.Q.value = 0.5
		const gain = ac.createGain()
		gain.gain.setValueAtTime(0.001, now)
		gain.gain.linearRampToValueAtTime(0.06, now + 0.15)
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
		noise.connect(filter); filter.connect(gain); gain.connect(ac.destination)
		noise.start(now)
	} catch { /* ignore */ }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function useAudio() {
	return {
		// Playback
		playDoorOpen, playDoorClose, playFootstep,
		playChime, playPTTStart, playPTTStop,
		playTransition, playGreet, playDogBark,
		playAnnouncementBell,
		playSound, playSoundForRoom,
		playLooping, stopLooping,
		// Master
		isAllAudioMuted, toggleAllAudioMute,
		masterVolume,
		// Interface channel
		interfaceVolume, interfaceMuted,
		// Stub channels (UI only for now)
		ambientVolume, ambientMuted,
		soundsVolume,  soundsMuted,
		musicVolume,   musicMuted,
		mediaVolume,   mediaMuted,
		voiceVolume,   voiceMuted,
	}
}
