# QuickerStorm – Context for AI / Chat Sessions

**Purpose:** Stores context so that AI assistants and future chat sessions retain important information even when chat history is unavailable. Read this file when working on QuickerStorm.

---

## What QuickerStorm Is

A **web-based 3D virtual world viewer for open simulator and Second Life**

- **Production** (`genebiondo.com/main/games/QuickerStorm`) — Vite SPA + ???

Backend is ???

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router |
| 3D Engine | Three.js — scene, avatar meshes, room geometry, GSAP tweening |
| Voice | WebRTC (browser native) + Bun WS server for signaling |
| Styling | Scoped component CSS + Tailwind utilities; light/dark theming via `useTheme()` |
| Hosting | Vite SPA (static) + **Bun WS server ???** |

---

## Environment & Config

`VITE_APP_ENV` selects the config JSON loaded by `src/config/configuration.js`:

| `VITE_APP_ENV` | Typical `.env` | Build output |
|----------------|----------------|--------------|
| `development` | `.env.development.local` | dev server only |
| `production` | `.env.production` | `build:prod` |

Always import config as: `import { config } from ‘@/config/configuration.js’`

---

## Pinia Stores

| Store | Purpose |
|-------|---------|
| `avatarStore` | Current user identity, avatar config, Slack/Google identity |

---

## Key Composables & Files

| Path | Purpose |
|------|---------|
| `src/composables/useRealtimeSocket.js` | Singleton WS connection to server (signaling, presence, privacy) |
| `src/composables/useProximityVoice.js` | WebRTC voice — peers, mic/speaker, VAD, signaling via WS |
| `src/composables/useMessaging.js` | Native DM/group messaging (Supabase Realtime) |
| `src/composables/usePoseSync.js` | Per-room avatar pose relay via WS |
| `src/composables/useTheme.js` | Light/dark toggle, shared `isDark` ref |
| `src/composables/useVersionCheck.js` | Polls `version.json` every 5 min; shows reload banner on new build |
| `server/index.ts` | Bun WS + HTTP server (Railway + local dev via `npm run dev:server`) |
| `src/api/supabase/MessagingRepo.js` | Messaging RPCs + Realtime subscriptions |
| `src/components/office/OfficeCanvas.vue` | Mounts Three.js engine; wires calendar + Jitsi state to screen draws |
| `src/components/office/FloorplanOverlay.vue` | SVG minimap overlay |
| `src/components/ui/ProximityVoiceBar.vue` | Voice bar (mute, mic level, device picker) |
| `src/components/ui/UserPopup.vue` | Click-on-avatar popup (DM, Email, Call Here, Visit) |
| `src/components/ui/SettingsPanel.vue` | User settings (avatar, Google, Slack, audio prefs) |
| `src/components/office/SimpleOfficeView.vue` | 2D flat top-down office map (low-end/mobile) |
| `src/components/sidebar/TheSidebar.vue` | Left sidebar (users, DMs, rooms) |
| `src/components/ConsolePanel.vue` | Dev/admin console panel |

---

## ⚠ Presence System Warning

`usePresence.js` is the most complex module. It manages:
- Upsert / row identity (find-or-create by email or auth UUID), heartbeat intervals
- Avatar state JSON (holding, gesture, soundMuted)
- WS `world`/`enter`/`leave`/`profile` event handling for real-time presence updates
- Dev-mode isolation: synthetic `devtest.xxx@localhost` emails and `dev-xxx` auth IDs (not real UUIDs)

### Multi-device session (do not break when tuning timers)

A per-tab **`sessionId`** is stored on the user’s presence row. **Only one browser tab may “own” the row at a time**; others show `SessionDisplacedModal` (`isDisplaced`).

| Mechanism | Purpose |
| --- | --- |
| `MY_SESSION_ID` (`sessionStorage`) | Stable id for this tab |
| `_serverSessionId` | Last `sessionId` read from the row on `fetchPresence` — blocks `writeHeartbeat` if it no longer matches this tab |
| `PresenceRepo.fetchAvatarStateSessionId` | Small read before a **hidden-tab** heartbeat — required because `fetchPresence()` **returns early when `document.hidden`**, so background tabs would otherwise never see another device’s claim and could overwrite `sessionId` |
| `reclaimSession()` | Clears `_serverSessionId`, clears `isDisplaced`, restarts poll + heartbeat loops |

When **`isDisplaced` is true**, poll and heartbeat timers are **stopped** until the user clicks **Make this the active device** or does a full reload.

### Away / offline timing vs heartbeats

These layers must stay consistent if you change intervals or hidden-tab behavior:

1. **`fetchPresence`** — Derives each peer’s **offline / away** display from `LastSeen` and fixed cutoffs. Changing `POLL_INTERVAL` affects how soon stale peers are swept.
2. **`writeHeartbeat` + `HEARTBEAT_INTERVAL`** — Updates `LastSeen` and row fields; drives how long until others mark this user offline after a crash or hard disconnect.
3. **Hidden tab** — Heartbeats are throttled (`HIDDEN_HEARTBEAT_INTERVAL`); **do not** remove the hidden-tab **session ownership** check without replacing it with another way for hidden tabs to observe the row’s `sessionId`, or multi-device arbitration will regress.
4. **`useIdleDetector.js`** — Sets `avatarStore.status` (e.g. away when idle); `writeHeartbeat` maps `’offline’` to `’away’` for the row so the user is not dropped from the office list while the tab still runs.

**Do not modify usePresence.js without reading the full file first.**

- **3D engine**: `useOfficeEngine.js` renders door meshes, animates open/close, blocks avatar navigation through locked doors.


---

## What to Do When ???

1. Read **`docs/PROJECT_BRIEF.md`**, **`docs/CONVENTIONS.md`**, and **`docs/CONTEXT.md`** (this file).
2. Check **`TODO.md`** in the repository root for current work items.
4. For presence/office behavior read `usePresence.js`, `useOfficeEngine.js`, and `officeLayout.js` — they are the source of truth for room/avatar logic. **Read fully before editing.**
7. For messaging read `useMessaging.js` — native DM/group messaging replacing Slack DMs.
