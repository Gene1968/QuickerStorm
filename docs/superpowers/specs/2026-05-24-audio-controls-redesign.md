# Audio Controls Redesign

**Date:** 2026-05-24  
**Status:** Approved  
**Scope:** Remove AVAverse-era consent/PTT/join-voice UI; add FS-style audio controls to top-right; auto-join voice; wire Master + Interface volume channels; move WASD help to floater.

---

## Motivation

`SoundConsentModal`, "Join Voice" button, and PTT are AVAverse office-collab artifacts that don't belong in an OpenSim viewer. FS places small audio controls top-right with a hover mixer. WASD hint text should be in a Help floater, not hardcoded in the world view.

---

## What Gets Removed

| Item | File | Action |
|---|---|---|
| `SoundConsentModal.vue` | `src/components/ui/SoundConsentModal.vue` | Delete file + all imports |
| `hasSoundConsent()` gate | `useAudio.js` `soundOk()` | Remove — consent no longer required |
| "Join Voice" pre-bar section | `ProximityVoiceBar.vue` | Delete `.voice-pre-bar` block |
| PTT hold-to-talk button | `ProximityVoiceBar.vue` | Delete `.talk-btn` + PTT event listeners |
| `ava-ptt-start/stop` global events | `ProximityVoiceBar.vue` | Remove listeners |
| `LS_AUTOJOIN` localStorage opt-in | `ProximityVoiceBar.vue` | Remove — replaced by always-auto-join |
| WASD hint `<div>` | `WorldView.vue` top-right | Remove — moved to `MovementHelpFloater` |

---

## Section 1 — AudioContext Unlock (No Consent Modal)

`useAudio.js` adds a module-level `_unlocked = false` flag and a `_unlockOnce()` function:

```js
function _unlockOnce() {
  if (_unlocked) return
  _unlocked = true
  document.removeEventListener('click',   _unlockOnce)
  document.removeEventListener('keydown', _unlockOnce)
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  ctx.resume().catch(() => {})
}
document.addEventListener('click',   _unlockOnce, { once: false })
document.addEventListener('keydown', _unlockOnce, { once: false })
```

`soundOk()` becomes:
```js
function soundOk() { return _unlocked && !isAllAudioMuted.value }
```

`applyAudioConsent()` and `hasSoundConsent()` are removed. `SoundConsentModal.vue` is deleted.  
All existing callers of `applyAudioConsent` / `hasSoundConsent` are removed.

---

## Section 2 — Auto-Join Voice

`WorldView.vue` adds a watcher on `session.connected`:

```js
watch(() => session.connected, (connected) => {
  if (!connected) return
  const myId   = presenceStore.myUserId
  const roomId = session.regionName   // or regionHandle — whichever voice uses
  if (myId && roomId) voice.enable(myId, roomId)
}, { immediate: true })
```

`useProximityVoice.js` — `isMuted` initialises to `true` so mic is silent until user explicitly unmutes. No other changes to the voice composable.

`ProximityVoiceBar.vue` retains only the active-voice bar (mic mute button + talking indicator + nearby users list). All pre-voice-bar UI is removed. The component is now only rendered when `voice.isEnabled`.

---

## Section 3 — Audio Controls Widget

**New file:** `src/components/AudioControlsWidget.vue`

Replaces the WASD `<div>` in `WorldView.vue` top-right.

### Layout

```
[ MicIcon ]  [ Volume2Icon ▾ ]
```

Both buttons are small (`h-7 w-7`), icon-only, rounded, `bg-white/10 hover:bg-white/20` on dark backgrounds. Sit flush against the top-right edge with `gap-1`.

### Mic button

- Icon: `MicIcon` when unmuted, `MicOffIcon` (red tint `text-red-400`) when muted
- Click → `voice.toggleMute()`
- Disabled + `opacity-40` when `!voice.isEnabled`
- Tooltip: "Mute mic (M)" / "Unmute mic (M)"

### Sound button

- Icon: `Volume2Icon` when unmuted, `VolumeXIcon` (red tint) when `isAllAudioMuted`
- Click → `toggleAllAudioMute()`
- Small `ChevronDownIcon` (10px) inline after the volume icon
- Tooltip: "Sound settings"

### Hover dropdown

Triggered by `mouseenter` on the sound button or the dropdown panel itself. Hidden on `mouseleave` from the whole widget with a 150 ms debounce (so cursor can travel to the panel). Implemented with a `showDropdown` ref + `hoverTimer`.

Panel: `absolute right-0 top-full mt-1`, `bg-card border border-brd rounded-lg shadow-2xl p-3 w-56`.

#### Dropdown rows (Master + Interface wired; rest stubbed)

```
Master      [slider 0-100]  [🔊/🔇]
────────────────────────────────────
Interface   [slider 0-100]  [🔊/🔇]
Ambient     [slider 0-100]  [🔊/🔇]   ← stub (slider visible, no-op)
Sounds      [slider 0-100]  [🔊/🔇]   ← stub
Music       [slider 0-100]  [🔊/🔇]   ← stub
Media       [slider 0-100]  [🔊/🔇]   ← stub
Voice       [slider 0-100]  [🔊/🔇]   ← stub
────────────────────────────────────
                              [⚙ Settings]
```

Each row: `<label class="text-xs w-20 text-t1">`, `<input type="range" min="0" max="100">`, mute icon button.  
Stub rows: label rendered at `opacity-50`, slider `disabled` attribute, mute button `disabled`.  
Gear/Settings button → `ui.showPreferences = true` + sets Preferences active tab to `'sound'`.

---

## Section 4 — Volume Channel State (`useAudio.js`)

New exported refs and persistence:

| Channel | Volume ref | Muted ref | localStorage key (vol) | localStorage key (mute) | Wired? |
|---|---|---|---|---|---|
| Master | `masterVolume` | `isAllAudioMuted` (existing) | `ava_vol_master` | `ava_all_audio_muted` (existing) | ✅ |
| Interface | `interfaceVolume` | `interfaceMuted` | `ava_vol_interface` | `ava_mute_interface` | ✅ |
| Ambient | `ambientVolume` | `ambientMuted` | `ava_vol_ambient` | `ava_mute_ambient` | stub |
| Sounds | `soundsVolume` | `soundsMuted` | `ava_vol_sounds` | `ava_mute_sounds` | stub |
| Music | `musicVolume` | `musicMuted` | `ava_vol_music` | `ava_mute_music` | stub |
| Media | `mediaVolume` | `mediaMuted` | `ava_vol_media` | `ava_mute_media` | stub |
| Voice | `voiceVolume` | `voiceMuted` | `ava_vol_voice` | `ava_mute_voice` | stub |

All default: `volume = 1.0`, `muted = false`.

**`isAllAudioMuted` is the master mute** — it already exists and is what the sound button toggles. The Master row in the dropdown binds directly to `isAllAudioMuted` (the mute toggle) and `masterVolume` (the slider). No separate `masterMuted` ref; drop that duplication.

**`soundOk()` updated:**
```js
function soundOk() {
  return _unlocked && !isAllAudioMuted.value
}
```

**`interfaceSoundOk()` — new internal helper:**
```js
function interfaceSoundOk() {
  return soundOk() && !interfaceMuted.value
}
```

**`playSound(filename, volume = 1)` updated** to apply channel volumes:
```js
// Determine if this filename is an interface sound
const INTERFACE_SOUNDS = new Set(['pop.mp3','pop!.mp3','ui-open.mp3','ui-dismiss.mp3',
  'woosh.mp3','blip.mp3','tick.mp3','beep.mp3','bell.mp3',
  'notification.mp3','notification2.mp3','dm.mp3','sent.mp3'])

function playSound(filename, volume = 1) {
  const isInterface = INTERFACE_SOUNDS.has(filename)
  if (isInterface && !interfaceSoundOk()) return
  if (!isInterface && !soundOk()) return
  const channelVol = isInterface ? interfaceVolume.value : 1
  const finalVol = volume * masterVolume.value * channelVol
  // ... existing Audio element play logic with finalVol
}
```

All refs exported from `useAudio()` return value for use by `AudioControlsWidget`.

---

## Section 5 — Movement Help Floater

**New file:** `src/components/MovementHelpFloater.vue`

- Wraps `<FloaterWindow id="movement-help" title="Movement & Shortcuts">` 
- Content: the full WASD hint text + keyboard shortcut table

**`uiStore.js`** — add:
```js
showMovementHelp: ref(false),
```

**Trigger:** Add a "?" or "Help" icon button somewhere accessible (bottom toolbar or inside the existing `?` area). For now: a small `?` icon button at the end of the audio controls widget (`[ 🎤 ] [ 🔊 ▾ ] [ ? ]`) toggles `ui.showMovementHelp`.

**Shortcut table content:**
```
WASD / ↑↓←→   Move forward/back/left/right
A / D          Turn left/right
Q / E          Strafe left/right
PgUp / PgDn    Fly up/down
Drag           Look around
Ctrl+M         Toggle map
Ctrl+P         Preferences
Shift+Alt+A    Toggle mic mute
```

---

## Section 6 — Preferences → Sound & Media Tab

`PreferencesFloater.vue` Sound & Media tab (`id: 'sound'`) replaces "coming soon" with real content.

### Sub-tab structure (horizontal tabs, FS-style)

```
[ Sounds ] [ Music ] [ Media ] [ Voice ]
```

### Sounds sub-tab (default)

Mirrors the dropdown mixer — full channel rows (Master through Voice), same slider + mute layout but wider (`w-full`). Wired/stub same as dropdown.

Also includes:
- **Mic device** selector: `<select>` bound to `voice.selectedMicId`, options from `voice.audioDevices.filter(d => d.kind === 'audioinput')`
- **Speaker device** selector: bound to `voice.selectedSpkId`, options from `audiooutput` devices

### Music sub-tab
Stub — "Music streaming coming soon"

### Media sub-tab
Stub — "In-world media coming soon"

### Voice sub-tab
Stub — "Voice device settings moved to Sounds tab" (or repeat mic/speaker selectors here in future)

---

## Files Changed

| File | Action |
|---|---|
| `src/components/ui/SoundConsentModal.vue` | **Delete** |
| `src/composables/useAudio.js` | Rework unlock, remove consent, add 7-channel state, update `playSound` |
| `src/components/ui/ProximityVoiceBar.vue` | Remove pre-bar, PTT, auto-join localStorage logic |
| `src/views/WorldView.vue` | Remove WASD div; add `<AudioControlsWidget>`; add voice auto-join watcher |
| `src/components/AudioControlsWidget.vue` | **New** — mic + sound buttons, hover dropdown mixer |
| `src/components/MovementHelpFloater.vue` | **New** — WASD/shortcut help floater |
| `src/stores/uiStore.js` | Add `showMovementHelp` ref |
| `src/components/PreferencesFloater.vue` | Implement Sound & Media tab with sub-tabs, sliders, device selectors |

---

## Out of Scope

- Ambient, Sounds, Music, Media, Voice channel routing (future)
- Music/Media streaming (future)
- Voice device hot-swap without reload (future)
- Spatial audio volume falloff on Voice channel (future)
- PTT (future, when needed)
