# quickerSTORM 🌩️

A web-based 3D viewer for OpenSimulator and Second Life. Open a browser tab, log in, and you're in-world. No install needed.

Tested on OSGrid, NeverWorld, GBG, and DigiWorldz.

## Current state · June 2026

**Phases 1 and 2 complete.** Login, movement, terrain, cross-region teleport, 1 500–1 800 prim rendering per region, Map 2D, IM, and avatar/object context menus all ship.

**Phase 3 ~70% complete.** Full asset pipeline live: server-side J2C→WebP transcode, IndexedDB texture + geometry-bake caches, worker-thread mesh bake. Warm reloads skip all re-fetching. Firestorm-style CRC object cache restores the full scene from disk on reload without re-asking the sim. Inventory browse, friends/contacts, saved accounts, and profile floater wired. Remaining: inventory management, appearance/bake, groups, voice gateway, environment.

**✨ Standouts:**
- Session resumes on network blip (15-second circuit hold); clean logout that actually works
- Persistent CRC object cache — full scene from IDB on reload, zero sim re-fetch
- Warm reload: geometry and textures load from disk in seconds, not minutes
- Multi-floater inventory browsing with accurate counts, search, and filter

---

## Feature status

| Feature | Status |
|---|---|
| Login (multi-grid, saved accounts) | ✅ |
| Movement + terrain collision + gravity | ✅ ~90% |
| Region terrain + ocean to horizon | ✅ |
| Prim geometry + linksets + per-face textures | ✅ ~80% |
| Mesh geometry (GetMesh, worker bake, IDB cache) | ✅ ~70% |
| CRC object cache (instant scene reload) | ✅ |
| Texture + geometry IDB cache | ✅ |
| Cross-region teleport | ✅ |
| Map 2D | 🟡 ~80% |
| Minimap | 🟡 ~75% |
| Nearby chat | 🟡 ~75% |
| Instant Messaging | 🟡 ~70% |
| Inventory (view/browse) | 🟡 ~70% |
| Friends / Contacts | 🟡 ~70% |
| Profile floater | 🟡 ~60% |
| Places floater | 🟡 ~65% |
| Object Build & Edit | 🟡 ~40% |
| Appearance / Outfits | 🟡 ~35% |
| Voice (WebRTC) | 🔜 signaling done, gateway TODO |
| Neighboring-sim terrain | 🔜 |
| Groups + Group IM | 🔜 |
| Environment (sky, day/night) | 🔜 |
| Media (sounds, parcel audio, video) | 🔜 |
| Web-on-prim | 🔜 |

See [`docs/FEATURE-GAPS.md`](docs/FEATURE-GAPS.md) for detailed per-feature gap tracking.

---

## Tech stack

- **Vue 3** (Composition API) · **Vite** · **Pinia** · **Vue Router** (hash mode)
- **Three.js r183** — 3D scene, avatar meshes, terrain mesh, GSAP tweening
- **Bun WS server** — LLUDP bridge, asset proxy, J2C→PNG transcode (`server/`)
- **WebRTC** — proximity voice; peer connections brokered by the WS server
- **Tailwind CSS v4**

---

## Getting started

```sh
npm install
cp .env.development.local-example .env.development.local
# Terminal 1 — Vite frontend (port 5173)
npm run dev
# Terminal 2 — Bun WS server (port 8787)
npm run dev:server
```

See [`docs/README.md`](docs/README.md) for the full documentation tree — including `docs/PROJECT_BRIEF.md`, `docs/CONVENTIONS.md`, and `docs/CONTEXT.md`.
