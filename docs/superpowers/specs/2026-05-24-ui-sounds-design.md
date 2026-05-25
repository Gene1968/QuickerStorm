# UI Sounds — Floater Pop + Teleport Whoosh

**Date:** 2026-05-24  
**Status:** Approved  
**Scope:** Local UI sounds only — no network audio, no parcel streaming, no proximity voice

---

## Problem

Floaters open/close silently. Teleports give no audio feedback. Both make the UI feel less alive. Assets and infrastructure already exist; wiring is missing.

---

## Existing Infrastructure

| Asset / API | Location | Notes |
|---|---|---|
| `pop.mp3` | `src/assets/audio/pop.mp3` | Floater open/close sound |
| `woosh.mp3` | `src/assets/audio/woosh.mp3` | Teleport sound |
| `playSound(file, vol?)` | `useAudio.js` line 250 | Consent-gated, plays any asset MP3 |
| `useModalAudio()` | `src/composables/useModalAudio.js` | open/dismiss sounds for modals (NOT floaters) |
| `FloaterWindow.vue` | `src/components/FloaterWindow.vue` | Shared wrapper for all floaters |
| `C.TELEPORT` WS message | `shared/protocol.js` line 14 | Client→Server: `{ x, y, z }` |
| `S.TELEPORT_FINISH` | `shared/protocol.js` line 27 | Server→Client: cross-region TP result |

---

## Design

### Feature 1 — Floater Pop Sounds

**Change:** `FloaterWindow.vue` adds `playSound('pop.mp3', 0.7)` on mount and unmount.

```js
import { useAudio } from '@/composables/useAudio.js'
const { playSound } = useAudio()

onMounted(() => playSound('pop.mp3', 0.7))
onUnmounted(() => playSound('pop.mp3', 0.7))
```

- Same sound for open and close (symmetric pop).
- Zero changes to individual floater components — all 14+ inherit automatically.
- Mute/consent gate respected — `playSound` calls `soundOk()` internally; muted users hear nothing.
- Does NOT affect modals (they use `useModalAudio()` separately).

---

### Feature 2 — Teleport Whoosh via `useTeleport.js`

**New file:** `src/composables/useTeleport.js`

**Responsibilities:**
- `requestTeleport({ x, y, z })` — validates/clamps coords, sends `C.TELEPORT` via `useRealtimeSocket`, plays `woosh.mp3`
- `TELEPORT_SOURCES` — exported const tracking all TP entry points and their implementation status
- Future: TP-in-progress state for overlay/progress UI (out of scope here)

**LocationBar.vue change:** Replace `emit(C.TELEPORT, coords)` (and any parent handler that sends via socket) with a direct call to `useTeleport().requestTeleport(coords)`. The composable owns the WS send.

**All future TP sources** call `requestTeleport()` — sound is automatic at the composable boundary.

#### Coord validation (mirrors existing LocationBar logic)

```js
x: Math.max(1, Math.min(255, x))
y: Math.max(1, Math.min(255, y))
z: Math.max(0.5, z)
```

#### Teleport Entry Point Tracker

```js
// src/composables/useTeleport.js
export const TELEPORT_SOURCES = {
  LOCATION_BAR:    { label: 'LocationBar',         status: 'implemented' },
  MAP_FLOATER:     { label: 'MapFloater',           status: 'stub'        },  // Phase 2
  MINIMAP:         { label: 'Minimap',              status: 'placeholder' },
  LANDMARK:        { label: 'Landmark',             status: 'placeholder' },
  DOUBLE_CLICK:    { label: 'Double-click land',    status: 'placeholder' },
}
```

This const is the canonical list for tracking TP completion across sessions.

---

## Out of Scope

- Arrival sound on `S.TELEPORT_FINISH` (future)
- Cross-region TP progress overlay (future)
- Network/parcel/proximity audio (separate feature)
- Same-region TeleportLocal audio distinction (future)

---

## Files Changed

| File | Change |
|---|---|
| `src/components/FloaterWindow.vue` | Add `playSound('pop.mp3', 0.7)` on mount/unmount |
| `src/composables/useTeleport.js` | **New** — `requestTeleport()`, `TELEPORT_SOURCES` |
| `src/components/LocationBar.vue` | Replace emit+parent-handler with `useTeleport().requestTeleport()` |
| Parent component that handled `C.TELEPORT` emit | Remove that handler |

---

## Testing

- Open any floater → hear pop
- Close any floater → hear pop
- Mute audio → open/close floater → silence
- Enter coords in LocationBar → hear whoosh
- Muted → teleport → silence
