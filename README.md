# quickerSTORM 🌩️

## A web-based 3D viewer for OpenSimulator and Second Life

No install. Open a browser tab, log in, and you're in-world.
Testing with OSGrid and NeverWorld so far — all the usual grids are listed for near-future testing.

## Current state · May 2026

**✨ Parts already better than some other clients:**
- Resumes your grid session after a brief network drop (no re-login)
- Clean avatar logout — actually works. Takes so 2-way comm but not sure why others never had it.

---

**🟢 Working now**
- [x] Log in to various grids — splash page, Home, last location, or any region
- [x] Others on Firestorm see your avatar appearance and movement normally (outbound AgentUpdate working)
- [x] You see nearby users listed (and simplified prims for their avies)
- [x] See your region and coordinates in the location bar, and do same-region teleport from there
- [x] Session resume on network blip (15-second circuit hold).  Proper logout disconnect.
- [x] UI sounds (teleport whoosh, chat typing, floater pop, menu click, etc.)

**🟡 Partially working**
- [~] Movement — 70%; your inputs send correctly; you can move and see your coords in the location bar, but don't really see others move. World is currently a placeholder scene — region geometry (terrain, prims) not yet rendered.
- [~] Nearby chat — 70%. Sending and receiving works; guess I should add emojis. Transcript, muted transcript, options and search, tear-off, close?

**🔜 Up next**
- [ ] Inbound movement — render your others' position updates in the 3D scene
- [ ] Region geometry — even a wireframe or simplified terrain would be a big step up from the placeholder
- [ ] Avatar appearance — currently capsule placeholders; baked texture download is the hard part
- [ ] Floater tools (inventory, map, profile, preferences) — shells exist, wiring in progress. Heavy data?
- [ ] DM / IM chat
- [ ] Object and avatar context menus
- [ ] Import/export of assets?

**⚠️ May be tricky**
- Cross-region teleport — requires tearing down and rebuilding the UDP circuit mid-session
- Avatar textures — LLUDP baked-texture pipeline; large assets, cache strategy TBD
- WebRTC proximity voice — peer signaling works; spatial falloff and VAD tuning still ahead
- Inventory at scale — UUID dedup, folder tree sync across login sessions
- Object physics / collision — terrain and gravity are out of scope for now

---

**🔧 Enhancement backlog**
- [ ] Inventory: find duplicates by UUID
- [ ] Inventory true export probably not possible from here unless you have console access

---

### Tech stack

- **Vue 3** (Composition API) · **Vite** · **Pinia** · **Vue Router**
- **Three.js** — 3D scene, avatar meshes, coordinate transform (SL Z-up → Three.js Y-up)
- **Bun WebSocket server** — LLUDP bridge, presence relay, chat, WebRTC signaling (`server/`)
- **WebRTC** — proximity voice; peer connections brokered by the WS server
- **Tailwind CSS** + **Bootstrap 5**

---

### Getting started

```sh
# 1. Install deps
npm install

# 2. Copy env file and point at your WS server
cp .env.development.local-example .env.development.local

# 3. Terminal 1 — Vite frontend (port 5173)
npm run dev

# 4. Terminal 2 — Bun WS server (port 8787)
npm run dev:server
```

---

### Documentation

See `docs/README.md` for the full tree — including `docs/PROJECT_BRIEF.md`, `docs/CONVENTIONS.md`, and `docs/CONTEXT.md`.
