# quickerSTORM – Context for AI / Chat Sessions

**Purpose:** Stores context so that AI assistants and future chat sessions retain important information even when chat history is unavailable. Read this file when working on quickerSTORM.

---

## What quickerSTORM Is

A **web-based 3D viewer for OpenSimulator and Second Life**. Users log in, see their avatar in a Three.js scene, walk around, chat, IM, and (eventually) edit objects and use inventory — all without installing a thick client.

Testing primarily against **OSGrid** and **NeverWorld** so far. Other grids planned.

---

## Architecture

```
┌───────────────────┐    WebSocket    ┌────────────────────┐    LLUDP    ┌─────────────┐
│  Vue 3 SPA        │ ◄─────────────► │  Bun WS server     │ ◄─────────► │  Grid sim   │
│  (Vite, Three.js) │                 │  (server/*.ts)     │             │  (OpenSim)  │
└───────────────────┘                 └────────────────────┘             └─────────────┘
                                             │
                                             ├── XML-RPC login proxy → grid login URI
                                             └── (Phase 3) HTTP capability proxy → seed cap URLs
```

- **Frontend**: Vue 3 SPA, hash-based routing for SharePoint/standalone embed.
- **Bun WS server**: bridges LLUDP UDP packets to/from the browser via JSON messages; holds circuit state (`server/state/sessions.ts`).
- **No backend database**. No Supabase, no Slack, no Google. Earlier scaffolding for those was removed per the `docs/superpowers/specs/` spec.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router (hash mode) |
| 3D Engine | Three.js r183 — scene, avatar meshes, terrain mesh, GSAP tweening |
| Voice (Phase 2) | WebRTC (browser native) + Bun WS server for signaling |
| LLUDP bridge | Bun WebSocket server (`server/`); typed handlers under `server/handlers/` |
| Styling | Tailwind utilities + Bootstrap helpers + `<style scoped>`; light/dark via `useTheme()` |
| Hosting | Vite SPA (static); Bun server runs on Railway (staging) or locally on port 8787 |

---

## Environment & Config

`VITE_APP_ENV` selects the config JSON loaded by `src/config/configuration.js`:

| `VITE_APP_ENV` | Typical `.env` | Build output |
|----------------|----------------|--------------|
| `development` | `.env.development.local` | dev server only |
| `staging` | `.env.staging` | `build:staging` |
| `production` | `.env.production` | `build:prod` |

`VITE_SIGNAL_URL` points at the WS server (local: `ws://localhost:8787`, staging: Railway URL).

Always import config as: `import { config } from '@/config/configuration.js'`

---

## Pinia Stores

| Store | Purpose |
|-------|---------|
| `avatarStore` | Local identity, avatar config (colors/hair/skin placeholder) |
| `sessionStore` | Login session: agentId, sessionId, circuit code, region size, grid info |
| `worldStore` | Scene state: `objects` (Map of localId → ObjectData), `terrainHeights` (Float32Array 513×513), `avatarPos`, `spawnPos` |
| `gridStore` | Grid selection, loginState (`disconnected | reconnecting | live`) |
| `uiStore` | Floater stack, cameraYaw, debug toggles |
| `debugStore` | Live ring buffer of debug messages for the in-page debug panel |
| `theme` | Light/dark toggle, shared `isDark` ref |

---

## Key Composables & Files

| Path | Purpose |
|------|---------|
| `src/composables/useWorldEngine.js` | **Owns the Three.js scene.** Mesh creation, avatar/prim spawning, terrain mesh, follow camera, dead-reckoning, input. Replaces the older `useOfficeEngine.js`. |
| `src/composables/useRealtimeSocket.js` | Singleton WS connection; dispatches typed messages to handlers |
| `src/composables/useProximityVoice.js` | WebRTC voice (Phase 2 wire-up pending) |
| `src/composables/useTheme.js` | Light/dark toggle |
| `src/composables/useVersionCheck.js` | Polls `version.json` every 5 min; shows reload banner on new build |
| `server/index.ts` | Bun WS + HTTP server entry |
| `server/handlers/lludp.ts` | UDP → WS relay: decodes incoming LLUDP, forwards to browser; receives outgoing messages |
| `server/lib/lludp-codec.ts` | Wire-format encoders/decoders for every LLUDP message we speak |
| `server/lib/terrain-codec.ts` | LayerData terrain patch decoder (libomv BitPack format, prefix-code coefficients) |
| `server/lib/circuit.ts` | Reliable-ack tracking, retransmit, seq counters |
| `shared/protocol.js` | Shared `S` (server→client) / `C` (client→server) WS message constants |

---

## Coordinate Transform

SL is Z-up, Three.js is Y-up. Every position/rotation from the server is in SL space and converted on the client:

```javascript
// Position
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }
// Quaternion: same axis remap on (x,y,z); w invariant
function slQuatToThree(x, y, z, w) { return new THREE.Quaternion(x, z, -y, w) }
```

---

## What to Do When Starting a Session

1. Read **`docs/PROJECT_BRIEF.md`**, **`docs/CONVENTIONS.md`**, and **`docs/CONTEXT.md`** (this file).
2. Read **`docs/superpowers/specs/`** for the canonical spec before implementing anything (per `memory/read-specs-first.md`).
3. Check **`README.md`** for the current Phase 2/3 roadmap.
4. For terrain bugs: `server/lib/terrain-codec.ts` + `memory/terrain-rendering-next.md` (recent rewrite to libomv BitPack format).
5. For LLUDP decode bugs: `server/lib/lludp-codec.ts` + `memory/lludp-decode-gotchas.md`.
6. For circuit/login bugs: `server/handlers/lludp.ts` + `server/lib/circuit.ts` + `memory/opensim-circuit-lifecycle.md`.

---

## What This Project Is *Not*

Removed earlier in development (don't reintroduce):
- Supabase backend
- Google / Slack auth
- Office-collab / meeting-room scaffolding (`useOfficeEngine.js` is being phased out)
- Calendar / Jitsi integration

If old code or doc references these, treat as stale and remove on touch.
