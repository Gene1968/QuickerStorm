# Audio Controls Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AVAverse-era consent modal / Join Voice / PTT with FS-style top-right audio controls, auto-join voice on login, and a real Sound & Media preferences tab.

**Architecture:** `useAudio.js` owns all volume-channel state (Master + Interface wired, rest stubbed). A new `AudioControlsWidget.vue` replaces the WASD hint in the top bar. Auto-join fires from `WorldView.vue` on `session.connected`. `MovementHelpFloater.vue` takes the displaced WASD text. `PreferencesFloater.vue` Sound & Media tab gets real content.

**Tech Stack:** Vue 3 `<script setup>`, Pinia, Lucide icons, Vitest + jsdom, existing `useAudio.js` / `useProximityVoice.js` / `useRealtimeSocket.js`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/composables/useAudio.js` | Modify | Remove consent, add first-click unlock, add channel volumes |
| `src/components/ui/SoundConsentModal.vue` | **Delete** | Gone entirely |
| `src/views/OfficeView.vue` | Modify | Remove SoundConsentModal import + usage (legacy file) |
| `src/components/ui/ProximityVoiceBar.vue` | Modify | Remove pre-bar, PTT button, LS_AUTOJOIN |
| `src/stores/uiStore.js` | Modify | Add `showMovementHelp`, `preferenceActiveTab`, `openPreferencesOnTab()` |
| `src/components/MovementHelpFloater.vue` | **New** | WASD / shortcut help floater |
| `src/components/AudioControlsWidget.vue` | **New** | Mic + sound icon buttons + hover volume dropdown |
| `src/views/WorldView.vue` | Modify | Replace WASD div with AudioControlsWidget, add auto-join watcher, mount MovementHelpFloater |
| `src/components/PreferencesFloater.vue` | Modify | Implement Sound & Media tab with sub-tabs + sliders |
| `src/__tests__/composables/useAudioChannels.test.js` | **New** | Unit tests for channel state |

---

## Task 1: Rework `useAudio.js` — remove consent, add first-click unlock, add volume channels

**Files:**
- Modify: `src/composables/useAudio.js`
- Create: `src/__tests__/composables/useAudioChannels.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/composables/useAudioChannels.test.js`:

```js
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Stub Audio + AudioContext before module loads
globalThis.Audio = vi.fn(() => ({ play: vi.fn().mockResolvedValue(), volume: 1 }))
globalThis.AudioContext = vi.fn(() => ({ resume: vi.fn().mockResolvedValue(), currentTime: 0 }))
globalThis.window = { AudioContext: globalThis.AudioContext }

const { useAudio, isAllAudioMuted, toggleAllAudioMute } =
  await import('@/composables/useAudio.js')

describe('useAudio — channel volumes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports masterVolume defaulting to 1', () => {
    const { masterVolume } = useAudio()
    expect(masterVolume.value).toBe(1)
  })

  it('exports interfaceVolume defaulting to 1', () => {
    const { interfaceVolume } = useAudio()
    expect(interfaceVolume.value).toBe(1)
  })

  it('exports interfaceMuted defaulting to false', () => {
    const { interfaceMuted } = useAudio()
    expect(interfaceMuted.value).toBe(false)
  })

  it('isAllAudioMuted defaults to false (no localStorage)', () => {
    expect(isAllAudioMuted.value).toBe(false)
  })

  it('toggleAllAudioMute flips isAllAudioMuted', () => {
    const before = isAllAudioMuted.value
    toggleAllAudioMute()
    expect(isAllAudioMuted.value).toBe(!before)
    toggleAllAudioMute() // restore
  })
})
```

- [ ] **Step 2: Run — verify they fail**

```bash
npx vitest run src/__tests__/composables/useAudioChannels.test.js
```

Expected: FAIL — `masterVolume is not a function` or `undefined`

- [ ] **Step 3: Replace `useAudio.js` with the new version**

Overwrite `src/composables/useAudio.js` with:

```js
/**
 * useAudio — procedural sound effects via Web Audio API + file-based MP3 playback.
 *
 * AudioContext is unlocked on the first user click or keydown — no consent modal needed.
 * Volume channels: Master (isAllAudioMuted / masterVolume) and Interface are wired.
 * Ambient / Sounds / Music / Media / Voice channels are stubbed (state only, no routing yet).
 */
import { ref } from 'vue'

const _sfx = import.meta.glob('../assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' })

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_ALL_AUDIO      = 'ava_all_audio_muted'
const LS_VOL_MASTER     = 'ava_vol_master'
const LS_VOL_INTERFACE  = 'ava_vol_interface'
const LS_MUTE_INTERFACE = 'ava_mute_interface'

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

// ── Stub channels (state + persistence; no routing yet) ──────────────────────
export const ambientVolume = ref(1); export const ambientMuted = ref(false)
export const soundsVolume  = ref(1); export const soundsMuted  = ref(false)
export const musicVolume   = ref(1); export const musicMuted   = ref(false)
export const mediaVolume   = ref(1); export const mediaMuted   = ref(false)
export const voiceVolume   = ref(1); export const voiceMuted   = ref(false)

// ── soundOk helpers ───────────────────────────────────────────────────────────
function soundOk()          { return _unlocked && !isAllAudioMuted.value }
function interfaceSoundOk() { return soundOk() && !interfaceMuted.value }

// WHY: kept for backward compat with useOfficeEngine.js which imports hasSoundConsent.
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run src/__tests__/composables/useAudioChannels.test.js
```

Expected: all 5 tests PASS

- [ ] **Step 5: Run full test suite — confirm nothing broken**

```bash
npx vitest run src/
```

Expected: all existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/composables/useAudio.js src/__tests__/composables/useAudioChannels.test.js
git commit -m "feat(audio): remove consent gate, add first-click unlock, add volume channel state"
```

---

## Task 2: Delete `SoundConsentModal.vue` and remove all references

**Files:**
- Delete: `src/components/ui/SoundConsentModal.vue`
- Modify: `src/views/OfficeView.vue` (legacy — remove import + usage only)

- [ ] **Step 1: Delete the modal file**

Delete `src/components/ui/SoundConsentModal.vue`.

- [ ] **Step 2: Remove from OfficeView.vue**

In `src/views/OfficeView.vue`, find and remove:
- The import line: `import SoundConsentModal from '@/components/ui/SoundConsentModal.vue'`
- The `showSoundConsent` ref declaration (search for `showSoundConsent`)
- The usage: `<SoundConsentModal v-if="showSoundConsent" @done="showSoundConsent = false" />`
- Any logic that sets `showSoundConsent = true`

Do not touch any other OfficeView logic.

- [ ] **Step 3: Build check**

```bash
npm run build:staging 2>&1 | head -40
```

Expected: no errors about `SoundConsentModal` or `applyAudioConsent`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(audio): delete SoundConsentModal, remove consent references"
```

---

## Task 3: Strip `ProximityVoiceBar.vue` — remove pre-bar, PTT, LS_AUTOJOIN

**Files:**
- Modify: `src/components/ui/ProximityVoiceBar.vue`

- [ ] **Step 1: Remove pre-voice-bar block from template**

In the `<template>`, delete the entire block from line 165 to 183:
```html
<!-- Join button + mute toggle (pre-voice) -->
<div v-if="!voice.isEnabled.value" class="voice-pre-bar">
  ...entire block...
</div>
```

- [ ] **Step 2: Remove PTT hold-to-talk block from template**

Delete the entire `<div class="flex align-items-center justify-center col hidden lg:block">` section (lines 222–239) containing the `talk-btn`.

- [ ] **Step 3: Remove PTT + LS_AUTOJOIN from script**

In `<script setup>`:

**Remove** the `LS_AUTOJOIN` constant:
```js
const LS_AUTOJOIN = 'ava_voice_autojoin'
```

**Remove** the `_tryAutoJoin`, `_doAutoJoin`, and `_autoJoinTimer` declarations (lines 59–84).

**Remove** the `enableVoice` function entirely (lines 87–99) — auto-join moves to WorldView.vue.

**Remove** from `onMounted`:
```js
window.addEventListener('ava-ptt-start', onPTTStart)
window.addEventListener('ava-ptt-stop',  onPTTStop)
// ...
if (localStorage.getItem(LS_AUTOJOIN) === '1') {
  _tryAutoJoin()
}
```

Replace `onMounted` with only what remains:
```js
onMounted(async () => {
	window.addEventListener('keydown', onKeyDown)
	document.addEventListener('pointerdown', onDocClick)
})
```

**Remove** from `onUnmounted`:
```js
window.removeEventListener('ava-ptt-start', onPTTStart)
window.removeEventListener('ava-ptt-stop',  onPTTStop)
```

Replace `onUnmounted` with:
```js
onUnmounted(() => {
	window.removeEventListener('keydown', onKeyDown)
	document.removeEventListener('pointerdown', onDocClick)
	clearTimeout(_autoJoinTimer)
})
```

Wait — `_autoJoinTimer` is removed. Final `onUnmounted`:
```js
onUnmounted(() => {
	window.removeEventListener('keydown', onKeyDown)
	document.removeEventListener('pointerdown', onDocClick)
})
```

**Remove** the `onPTTStart` / `onPTTStop` functions:
```js
function onPTTStart() { if (voice.isEnabled.value && voice.isMuted.value) voice.startTalking() }
function onPTTStop()  { if (voice.isTalking.value) voice.stopTalking() }
```

**Remove** `onTalkDown` function (line 158–161) — used only by the deleted PTT button.

**Remove** `leaveVoice` localStorage line:
```js
localStorage.removeItem(LS_AUTOJOIN)
```

`leaveVoice` becomes:
```js
function leaveVoice() {
	voice.disable()
	showBar.value    = false
	showDevices.value = false
}
```

**Remove** unused import `useOfficeStore` and `officeStore` if they were only used in `enableVoice`. Keep `presenceStore` (used in `listeners` computed).

**Remove** `useOfficeStore` import line and `const officeStore = useOfficeStore()`.

- [ ] **Step 4: Remove dead CSS from `<style scoped>`**

Delete these CSS blocks (no longer have matching elements):
- `.voice-pre-bar { ... }`
- `.voice-enable-btn { ... }`
- `.pre-mute-btn { ... }`
- `.talk-btn { ... }` and `.talk-btn:hover`, `.talk-btn.active`

- [ ] **Step 5: Build check**

```bash
npm run build:staging 2>&1 | head -40
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ProximityVoiceBar.vue
git commit -m "feat(audio): remove pre-voice bar, PTT, auto-join localStorage from ProximityVoiceBar"
```

---

## Task 4: Extend `uiStore.js` — add `showMovementHelp` and `openPreferencesOnTab`

**Files:**
- Modify: `src/stores/uiStore.js`
- Modify: `src/__tests__/stores/uiStore.test.js`

- [ ] **Step 1: Write failing tests**

Append to `src/__tests__/stores/uiStore.test.js`:

```js
describe('uiStore — movement help + preferences tab', () => {
	it('showMovementHelp defaults to false', () => {
		const store = useUiStore()
		expect(store.showMovementHelp).toBe(false)
	})

	it('toggleMovementHelp flips showMovementHelp', () => {
		const store = useUiStore()
		store.toggleMovementHelp()
		expect(store.showMovementHelp).toBe(true)
		store.toggleMovementHelp()
		expect(store.showMovementHelp).toBe(false)
	})

	it('preferenceActiveTab defaults to "appearance"', () => {
		const store = useUiStore()
		expect(store.preferenceActiveTab).toBe('appearance')
	})

	it('openPreferencesOnTab sets tab and shows preferences', () => {
		const store = useUiStore()
		store.openPreferencesOnTab('sound')
		expect(store.showPreferences).toBe(true)
		expect(store.showQuickPrefs).toBe(false)
		expect(store.preferenceActiveTab).toBe('sound')
	})
})
```

- [ ] **Step 2: Run — verify new tests fail**

```bash
npx vitest run src/__tests__/stores/uiStore.test.js
```

Expected: existing tests PASS, new tests FAIL with `store.showMovementHelp is undefined`

- [ ] **Step 3: Add to `uiStore.js`**

In `src/stores/uiStore.js`, add after `showAO`:

```js
const showMovementHelp   = ref(false)
const preferenceActiveTab = ref('appearance')
```

Add functions after `toggleAO`:

```js
function toggleMovementHelp()        { showMovementHelp.value = !showMovementHelp.value }
function openPreferencesOnTab(tabId) {
	preferenceActiveTab.value = tabId
	showPreferences.value     = true
	showQuickPrefs.value      = false
}
```

Add to the `return {}` object:

```js
showMovementHelp, preferenceActiveTab,
toggleMovementHelp, openPreferencesOnTab,
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npx vitest run src/__tests__/stores/uiStore.test.js
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/uiStore.js src/__tests__/stores/uiStore.test.js
git commit -m "feat(ui): add showMovementHelp and openPreferencesOnTab to uiStore"
```

---

## Task 5: Create `MovementHelpFloater.vue`

**Files:**
- Create: `src/components/MovementHelpFloater.vue`

- [ ] **Step 1: Create the component**

Create `src/components/MovementHelpFloater.vue`:

```vue
<script setup>
import { useUiStore } from '@/stores/uiStore.js'
import FloaterWindow from '@/components/FloaterWindow.vue'

const ui = useUiStore()
</script>

<template>
	<FloaterWindow
		id="movement-help"
		title="Movement &amp; Shortcuts"
		:wrap-style="{ width: '22rem' }"
		:default-pos="{ right: '1rem', top: '3rem' }"
		@close="ui.showMovementHelp = false"
	>
		<div class="p-4 text-xs text-t2 space-y-3">
			<section>
				<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Movement</h3>
				<table class="w-full border-collapse">
					<tbody>
						<tr v-for="row in movementRows" :key="row.keys" class="border-b border-brd/40 last:border-0">
							<td class="py-1 pr-3 font-mono text-accent whitespace-nowrap">{{ row.keys }}</td>
							<td class="py-1 text-t2">{{ row.desc }}</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section>
				<h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm mb-2">Shortcuts</h3>
				<table class="w-full border-collapse">
					<tbody>
						<tr v-for="row in shortcutRows" :key="row.keys" class="border-b border-brd/40 last:border-0">
							<td class="py-1 pr-3 font-mono text-accent whitespace-nowrap">{{ row.keys }}</td>
							<td class="py-1 text-t2">{{ row.desc }}</td>
						</tr>
					</tbody>
				</table>
			</section>
		</div>
	</FloaterWindow>
</template>

<script>
const movementRows = [
	{ keys: 'W / ↑',         desc: 'Move forward' },
	{ keys: 'S / ↓',         desc: 'Move back' },
	{ keys: 'A / ←',         desc: 'Turn left' },
	{ keys: 'D / →',         desc: 'Turn right' },
	{ keys: 'Q',             desc: 'Strafe left' },
	{ keys: 'E',             desc: 'Strafe right' },
	{ keys: 'PgUp',          desc: 'Fly up' },
	{ keys: 'PgDn',          desc: 'Fly down' },
	{ keys: 'Drag',          desc: 'Look around' },
]
const shortcutRows = [
	{ keys: 'Ctrl+M',        desc: 'Toggle map' },
	{ keys: 'Ctrl+P',        desc: 'Preferences' },
	{ keys: 'Shift+Alt+A',   desc: 'Toggle mic mute' },
]
</script>
```

> Note: The two `<script>` blocks (one `setup`, one plain) are intentional — the plain block exports module-level constants without making them reactive. This is valid Vue 3 SFC syntax.

- [ ] **Step 2: Manual verify — mount in WorldView temporarily**

In `WorldView.vue`, temporarily add `<MovementHelpFloater v-if="ui.showMovementHelp" />` and toggle it from the browser console: `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('ui').showMovementHelp = true`. Confirm floater appears with correct content.

Remove the temporary mount — Task 7 will add it properly.

- [ ] **Step 3: Commit**

```bash
git add src/components/MovementHelpFloater.vue
git commit -m "feat(ui): MovementHelpFloater with WASD + shortcut reference"
```

---

## Task 6: Create `AudioControlsWidget.vue`

**Files:**
- Create: `src/components/AudioControlsWidget.vue`

- [ ] **Step 1: Create the component**

Create `src/components/AudioControlsWidget.vue`:

```vue
<script setup>
/**
 * AudioControlsWidget — FS-style top-right audio controls.
 *
 * Two icon buttons: mic mute toggle + sound mute toggle.
 * Hovering the sound button or the dropdown opens a mixer panel with
 * per-channel volume sliders. Master and Interface channels are wired;
 * others are visible stubs.
 */
import { ref } from 'vue'
import {
	Mic, MicOff, Volume2, VolumeX, ChevronDown, Settings, HelpCircle,
} from '@lucide/vue'
import {
	useAudio,
	isAllAudioMuted, toggleAllAudioMute,
} from '@/composables/useAudio.js'
import { useProximityVoice } from '@/composables/useProximityVoice.js'
import { useUiStore } from '@/stores/uiStore.js'

const ui    = useUiStore()
const voice = useProximityVoice()
const {
	masterVolume,
	interfaceVolume, interfaceMuted,
	ambientVolume,   ambientMuted,
	soundsVolume,    soundsMuted,
	musicVolume,     musicMuted,
	mediaVolume,     mediaMuted,
	voiceVolume,     voiceMuted,
} = useAudio()

// ── Hover dropdown ────────────────────────────────────────────────────────────
const showDropdown = ref(false)
let hoverTimer = null

function onEnter() {
	clearTimeout(hoverTimer)
	showDropdown.value = true
}

function onLeave() {
	hoverTimer = setTimeout(() => { showDropdown.value = false }, 150)
}

function openSoundPrefs() {
	showDropdown.value = false
	ui.openPreferencesOnTab('sound')
}

// ── Channel rows ──────────────────────────────────────────────────────────────
// volume ref is 0–1; slider shows 0–100
function toSlider(vol) { return Math.round(vol * 100) }
function fromSlider(e, volRef) { volRef.value = e.target.valueAsNumber / 100 }
</script>

<template>
	<div
		class="relative flex items-center gap-1 pe-3"
		@mouseenter="onEnter"
		@mouseleave="onLeave"
	>
		<!-- Mic mute button -->
		<button
			class="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors"
			:class="voice.isMuted.value ? 'text-red-400' : 'text-white/80'"
			:disabled="!voice.isEnabled.value"
			:style="voice.isEnabled.value ? {} : { opacity: 0.35, cursor: 'default' }"
			:title="voice.isMuted.value ? 'Unmute mic (Shift+Alt+A)' : 'Mute mic (Shift+Alt+A)'"
			@click="voice.isEnabled.value && voice.toggleMute()"
		>
			<MicOff v-if="voice.isMuted.value" :size="15" />
			<Mic    v-else                      :size="15" />
		</button>

		<!-- Sound mute button + dropdown chevron -->
		<button
			class="h-7 flex items-center gap-0.5 px-1.5 rounded hover:bg-white/15 transition-colors"
			:class="isAllAudioMuted ? 'text-red-400' : 'text-white/80'"
			:title="isAllAudioMuted ? 'Unmute sound' : 'Mute sound / Sound settings'"
			@click="toggleAllAudioMute"
		>
			<VolumeX v-if="isAllAudioMuted" :size="15" />
			<Volume2 v-else                 :size="15" />
			<ChevronDown :size="10" class="opacity-60" />
		</button>

		<!-- Help button -->
		<button
			class="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 transition-colors text-white/60 hover:text-white/90"
			title="Movement &amp; shortcuts"
			@click="ui.toggleMovementHelp()"
		>
			<HelpCircle :size="14" />
		</button>

		<!-- Hover dropdown mixer -->
		<Transition name="dd">
			<div
				v-if="showDropdown"
				class="absolute right-0 top-full mt-1 w-56 bg-card border border-brd rounded-lg shadow-2xl p-3 z-[600]"
				@mouseenter="onEnter"
				@mouseleave="onLeave"
			>
				<!-- Channel rows -->
				<div class="flex flex-col gap-2">

					<!-- Master -->
					<div class="flex items-center gap-2">
						<span class="text-xs text-t1 w-20 shrink-0">Master</span>
						<input
							type="range" min="0" max="100"
							:value="toSlider(masterVolume)"
							@input="fromSlider($event, masterVolume)"
							class="flex-1 accent-accent h-1"
						/>
						<button
							class="text-xs w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-white/10 transition-colors"
							:class="isAllAudioMuted ? 'text-red-400' : 'text-t2'"
							@click="toggleAllAudioMute"
						>
							<VolumeX v-if="isAllAudioMuted" :size="11" />
							<Volume2 v-else                 :size="11" />
						</button>
					</div>

					<div class="border-t border-brd my-0.5" />

					<!-- Interface (wired) -->
					<div class="flex items-center gap-2">
						<span class="text-xs text-t1 w-20 shrink-0">Interface</span>
						<input
							type="range" min="0" max="100"
							:value="toSlider(interfaceVolume)"
							@input="fromSlider($event, interfaceVolume)"
							class="flex-1 accent-accent h-1"
						/>
						<button
							class="text-xs w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-white/10 transition-colors"
							:class="interfaceMuted ? 'text-red-400' : 'text-t2'"
							@click="interfaceMuted.value = !interfaceMuted.value"
						>
							<VolumeX v-if="interfaceMuted.value" :size="11" />
							<Volume2 v-else                      :size="11" />
						</button>
					</div>

					<!-- Stub channels -->
					<template v-for="ch in stubChannels" :key="ch.label">
						<div class="flex items-center gap-2 opacity-40">
							<span class="text-xs text-t1 w-20 shrink-0">{{ ch.label }}</span>
							<input
								type="range" min="0" max="100"
								:value="toSlider(ch.vol.value)"
								disabled
								class="flex-1 h-1"
							/>
							<div class="w-5 h-5 shrink-0" />
						</div>
					</template>

				</div>

				<!-- Gear → Preferences Sound & Media -->
				<div class="flex justify-end mt-2 pt-2 border-t border-brd">
					<button
						class="flex items-center gap-1 text-xs text-tm hover:text-t1 transition-colors"
						@click="openSoundPrefs"
					>
						<Settings :size="11" />
						Settings
					</button>
				</div>
			</div>
		</Transition>
	</div>
</template>

<script>
const stubChannels = [
	{ label: 'Ambient', vol: { value: 1 } },
	{ label: 'Sounds',  vol: { value: 1 } },
	{ label: 'Music',   vol: { value: 1 } },
	{ label: 'Media',   vol: { value: 1 } },
	{ label: 'Voice',   vol: { value: 1 } },
]
</script>

<style scoped>
.dd-enter-active { transition: opacity 0.12s, transform 0.12s; }
.dd-leave-active { transition: opacity 0.08s, transform 0.08s; }
.dd-enter-from, .dd-leave-to { opacity: 0; transform: translateY(-0.25rem); }
</style>
```

> **Note:** The stub channel `vol` refs above are plain objects — they display static values. In a future task they'll be replaced with the exported refs from `useAudio`. This keeps stubs visually correct without wiring routing.

- [ ] **Step 2: Manual verify — mount temporarily in WorldView and hover**

Temporarily add `<AudioControlsWidget />` anywhere visible. Open the app, hover the sound button, verify the dropdown appears. Click mic button with voice disabled — should be non-interactive. Remove the temporary mount.

- [ ] **Step 3: Commit**

```bash
git add src/components/AudioControlsWidget.vue
git commit -m "feat(audio): AudioControlsWidget — mic + sound buttons with hover mixer dropdown"
```

---

## Task 7: Update `WorldView.vue` — wire everything together

**Files:**
- Modify: `src/views/WorldView.vue`

- [ ] **Step 1: Add imports**

In `<script setup>`, add:

```js
import { watch }               from 'vue'
import AudioControlsWidget     from '@/components/AudioControlsWidget.vue'
import MovementHelpFloater      from '@/components/MovementHelpFloater.vue'
import { useProximityVoice }   from '@/composables/useProximityVoice.js'
import { usePresenceStore }    from '@/stores/presenceStore.js'
import { useAvatarStore }      from '@/stores/avatarStore.js'

const voice       = useProximityVoice()
const presence    = usePresenceStore()
const avatarStore = useAvatarStore()
```

- [ ] **Step 2: Add auto-join voice watcher**

After the existing computed `show2D`, add:

```js
// WHY: Auto-join voice when the user connects to a region.
// Mic starts muted (isMuted defaults true in useProximityVoice).
// Waits for presenceStore.myUserId since voice.enable() needs a user identity.
watch(
	() => session.connected,
	async (connected) => {
		if (!connected || voice.isEnabled.value) return
		const myId    = String(presence.myUserId || avatarStore.authUserId || 'me')
		const regionId = session.regionName || 'world'
		try { await voice.enable(myId, regionId) } catch { /* mic denied — handled by voice.micError */ }
	},
	{ immediate: true },
)
```

- [ ] **Step 3: Replace WASD div with AudioControlsWidget**

In the 3D world `<template>` section, find:

```html
<!-- Keyboard hint — right side. Temp, potentially Search will wind up here instead -->
<div class="hidden md:flex pe-3 text-white/70 text-xs">
    WASD/↑↓←→ move · A/D turn · Q/E strafe · PgUp/Dn fly · drag to look
</div>
```

Replace with:

```html
<AudioControlsWidget class="hidden md:flex" />
```

- [ ] **Step 4: Mount MovementHelpFloater**

Inside the `<!-- Middle: canvas area with overlays -->` `<div class="flex-1 relative overflow-hidden">`, add after the existing floaters:

```html
<MovementHelpFloater v-if="ui.showMovementHelp" />
```

- [ ] **Step 5: Manual verify**

Run dev server. Log in. Confirm:
- Top-right shows mic + sound icons instead of WASD text
- Hover sound icon → dropdown appears
- Click `?` → MovementHelpFloater opens with correct content
- On world connect, voice auto-joins (check browser console for `[voice]` messages)

- [ ] **Step 6: Commit**

```bash
git add src/views/WorldView.vue
git commit -m "feat(audio): wire AudioControlsWidget + MovementHelpFloater + auto-join voice into WorldView"
```

---

## Task 8: Implement Sound & Media tab in `PreferencesFloater.vue`

**Files:**
- Modify: `src/components/PreferencesFloater.vue`

- [ ] **Step 1: Connect `preferenceActiveTab` from uiStore**

In `<script setup>`, add:

```js
import {
	useAudio,
	isAllAudioMuted, toggleAllAudioMute,
	masterVolume, interfaceVolume, interfaceMuted,
} from '@/composables/useAudio.js'
import { useProximityVoice } from '@/composables/useProximityVoice.js'
```

Change `activeTab`:

```js
// Before:
const activeTab = ref('appearance')

// After — read initial tab from uiStore (set by openPreferencesOnTab):
const activeTab = computed({
	get: () => ui.preferenceActiveTab,
	set: (v) => { ui.preferenceActiveTab = v },
})
```

Add:
```js
const voice = useProximityVoice()

const micDevices = computed(() => voice.audioDevices.value.filter(d => d.kind === 'audioinput'))
const spkDevices = computed(() => voice.audioDevices.value.filter(d => d.kind === 'audiooutput'))
const canSetSink = typeof AudioContext !== 'undefined' && typeof AudioContext.prototype.setSinkId === 'function'

function toSlider(vol) { return Math.round(vol * 100) }
function fromSlider(e, volRef) { volRef.value = e.target.valueAsNumber / 100 }

// Load device list when Sound tab is opened
watch(activeTab, async (tab) => {
	if (tab === 'sound') await voice.loadDevices()
})
```

- [ ] **Step 2: Remove `soon: true` from the sound tab definition**

Find:
```js
{ id: 'sound', icon: '🔊', label: 'Sound & Media', disabled: false, soon: true },
```

Change to:
```js
{ id: 'sound', icon: '🔊', label: 'Sound & Media', disabled: false, soon: false },
```

- [ ] **Step 3: Replace the Sound & Media "coming soon" template with real content**

Find and replace the entire `<template v-else-if="activeTab === 'sound'">` block:

```html
<!-- ── SOUND & MEDIA ── -->
<template v-else-if="activeTab === 'sound'">
    <h2 class="pf-section-heading">Sound &amp; Media</h2>

    <!-- FS-style horizontal sub-tabs -->
    <div class="flex gap-1 mb-4 border-b border-brd pb-2">
        <button
            v-for="st in soundSubTabs" :key="st.id"
            class="px-3 py-1 text-xs rounded-t font-semibold transition-colors"
            :class="activeSoundTab === st.id
                ? 'bg-card2 text-accent border border-brd border-b-card2 -mb-px'
                : 'text-tm hover:text-t2'"
            @click="activeSoundTab = st.id"
        >
            {{ st.label }}
        </button>
    </div>

    <!-- Sounds sub-tab (default) -->
    <template v-if="activeSoundTab === 'sounds'">

        <!-- Volume mixer — mirrors dropdown widget -->
        <div class="flex flex-col gap-3 mb-6">
            <h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm">Volume</h3>

            <!-- Master -->
            <div class="pf-row">
                <div class="pf-row-info">
                    <span class="pf-row-label">Master</span>
                    <span class="pf-row-hint">Overall volume for all sounds.</span>
                </div>
                <div class="flex items-center gap-2">
                    <input type="range" min="0" max="100"
                        :value="toSlider(masterVolume)"
                        @input="fromSlider($event, masterVolume)"
                        class="w-28 accent-accent" />
                    <button
                        class="text-xs w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
                        :class="isAllAudioMuted ? 'text-red-400' : 'text-t2'"
                        @click="toggleAllAudioMute"
                        :title="isAllAudioMuted ? 'Unmute' : 'Mute'"
                    >{{ isAllAudioMuted ? '🔇' : '🔊' }}</button>
                </div>
            </div>

            <!-- Interface (wired) -->
            <div class="pf-row">
                <div class="pf-row-info">
                    <span class="pf-row-label">Interface</span>
                    <span class="pf-row-hint">UI sounds — pops, notifications, teleport.</span>
                </div>
                <div class="flex items-center gap-2">
                    <input type="range" min="0" max="100"
                        :value="toSlider(interfaceVolume)"
                        @input="fromSlider($event, interfaceVolume)"
                        class="w-28 accent-accent" />
                    <button
                        class="text-xs w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
                        :class="interfaceMuted ? 'text-red-400' : 'text-t2'"
                        @click="interfaceMuted.value = !interfaceMuted.value"
                        :title="interfaceMuted ? 'Unmute' : 'Mute'"
                    >{{ interfaceMuted.value ? '🔇' : '🔊' }}</button>
                </div>
            </div>

            <!-- Stub rows -->
            <div v-for="row in soundStubRows" :key="row.label" class="pf-row pf-row--disabled">
                <div class="pf-row-info">
                    <span class="pf-row-label">{{ row.label }}</span>
                    <span class="pf-row-hint">{{ row.hint }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <input type="range" min="0" max="100" value="75" disabled class="w-28" />
                    <span class="pf-chip-soon">soon</span>
                </div>
            </div>
        </div>

        <!-- Audio devices -->
        <div class="flex flex-col gap-3">
            <h3 class="text-[0.6875rem] font-bold uppercase tracking-widest text-tm">Devices</h3>

            <div class="pf-row" v-if="micDevices.length">
                <div class="pf-row-info">
                    <span class="pf-row-label">Microphone</span>
                    <span class="pf-row-hint">Input device for voice chat.</span>
                </div>
                <select
                    class="bg-card2 border border-brd2 rounded text-xs text-t1 px-2 py-1 cursor-pointer focus:outline-none focus:border-accent"
                    :value="voice.selectedMicId.value"
                    @change="voice.setMicDevice($event.target.value)"
                >
                    <option v-for="d in micDevices" :key="d.deviceId" :value="d.deviceId">
                        {{ d.label || `Microphone ${d.deviceId.slice(0,6)}` }}
                    </option>
                </select>
            </div>

            <div class="pf-row" v-if="spkDevices.length">
                <div class="pf-row-info">
                    <span class="pf-row-label">Speaker</span>
                    <span class="pf-row-hint">
                        Output device for voice.
                        <span v-if="!canSetSink" class="text-yellow-500/70"> Use system audio settings.</span>
                    </span>
                </div>
                <select
                    class="bg-card2 border border-brd2 rounded text-xs text-t1 px-2 py-1 cursor-pointer focus:outline-none focus:border-accent"
                    :value="voice.selectedSpkId.value"
                    @change="voice.setSpeakerDevice($event.target.value)"
                    :disabled="!canSetSink"
                    :class="{ 'opacity-40 cursor-not-allowed': !canSetSink }"
                >
                    <option v-for="d in spkDevices" :key="d.deviceId" :value="d.deviceId">
                        {{ d.label || `Speaker ${d.deviceId.slice(0,6)}` }}
                    </option>
                </select>
            </div>

            <div v-if="!micDevices.length && !spkDevices.length" class="text-xs text-tm text-center py-2">
                Open voice to enumerate devices.
            </div>
        </div>

    </template>

    <!-- Music sub-tab (stub) -->
    <template v-else-if="activeSoundTab === 'music'">
        <div class="pf-soon-block">
            <span class="pf-soon-icon">🎵</span>
            <p>Parcel music streaming coming in a future update.</p>
        </div>
    </template>

    <!-- Media sub-tab (stub) -->
    <template v-else-if="activeSoundTab === 'media'">
        <div class="pf-soon-block">
            <span class="pf-soon-icon">📺</span>
            <p>In-world media (video streams) coming in a future update.</p>
        </div>
    </template>

    <!-- Voice sub-tab (stub) -->
    <template v-else-if="activeSoundTab === 'voice'">
        <div class="pf-soon-block">
            <span class="pf-soon-icon">🎙️</span>
            <p>Voice device settings are in the <strong>Sounds</strong> tab above.</p>
            <p class="text-xs mt-1">Extended voice settings coming in a future update.</p>
        </div>
    </template>

</template>
```

- [ ] **Step 4: Add sub-tab state and data to `<script setup>`**

Add after the existing `const activeTab` declaration:

```js
const activeSoundTab = ref('sounds')

const soundSubTabs = [
	{ id: 'sounds', label: 'Sounds' },
	{ id: 'music',  label: 'Music'  },
	{ id: 'media',  label: 'Media'  },
	{ id: 'voice',  label: 'Voice'  },
]

const soundStubRows = [
	{ label: 'Ambient',  hint: 'Environment sounds — wind, water.' },
	{ label: 'Sounds',   hint: 'In-world object sounds.' },
	{ label: 'Music',    hint: 'Parcel music stream.' },
	{ label: 'Media',    hint: 'In-world video / stream.' },
	{ label: 'Voice',    hint: 'Voice chat output.' },
]
```

Also add these to existing imports at top of `<script setup>`:
```js
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
```
(`watch` and `computed` are new additions — check existing imports first and only add what is missing.)

- [ ] **Step 5: Manual verify**

Open Preferences (Ctrl+P), click Sound & Media. Confirm:
- Sub-tabs (Sounds / Music / Media / Voice) render
- Sounds tab shows Master + Interface sliders that move
- Stub rows are greyed with "soon" chip
- Device selectors appear once voice has been joined
- Gear icon in AudioControlsWidget → opens Preferences already on Sound & Media

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run src/
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/PreferencesFloater.vue
git commit -m "feat(audio): implement Sound & Media preferences tab with sub-tabs, volume mixer, device selectors"
```

---

## Done

Eight commits. Verify final state:
- No SoundConsentModal anywhere in the running app
- Top-right: `[🎤] [🔊▾] [?]` — hover sound button → mixer dropdown
- Click `?` → MovementHelpFloater with WASD/shortcut table
- World login → voice auto-joins, mic starts muted
- Preferences → Sound & Media → Sounds tab → sliders work for Master + Interface
- All tests pass: `npx vitest run src/`
