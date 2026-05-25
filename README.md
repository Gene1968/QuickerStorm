# quickerSTORM 🌩️

## A web-based 3D viewer for OpenSimulator and Second Life

No install. Open a browser tab, log in, and you're in-world.
Testing with OSGrid and NeverWorld so far — all the usual grids are listed for near-future testing.

## Current state · May 2026

**✨ Already better than some other clients:**
- Resumes your grid session after a brief network drop (no re-login)
- Clean avatar logout — actually works

---

**🟢 Working now**
- [x] Log in to various grids — splash page, Home, last location, or any region
- [x] Others see your avatar normally (your viewer sends full avatar data)
- [x] Move around: walk, strafe, fly, jump, crouch (WSAD + standard keys)
- [x] Same-region teleport from location bar
- [x] Nearby / local chat
- [x] Session resume on network blip (15-second circuit hold)

**🔜 Up next**
- [ ] Avatar appearance — currently a capsule placeholder; texture download is the hard part
- [ ] Floater tools (inventory, map, profile, preferences) — shells exist, wiring in progress
- [ ] Standard keyboard shortcuts
- [ ] DM / IM chat
- [ ] More on the minimap (but already useful)

**⚠️ May be tricky**
- Cross-region teleport — requires tearing down and rebuilding the UDP circuit mid-session
- Avatar textures — LLUDP baked-texture pipeline; large assets, cache strategy TBD
- WebRTC proximity voice — peer signaling works; spatial falloff and VAD tuning still ahead
- Inventory at scale — UUID dedup, folder tree sync across login sessions
- Object physics / collision — terrain and gravity are out of scope for now

---

**🔧 Enhancement backlog**
- [ ] Inventory: find duplicates by UUID

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
