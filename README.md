# quickerSTORM 🌩️

A web-based 3D viewer for OpenSimulator and Second Life. Open a browser tab, log in, and you're in-world. No install needed.

Tested so far on OSGrid, NeverWorld, DigiWorldz and others.

## Current state · July 2026 · **v0.3** · **~53% of a complete viewer**

Login, movement, terrain, cross-region teleport, 1 500–1 800 prim rendering per region, Map 2D, IM,
inventory, object build/edit, and context menus all work — enough for solo/small-group exploration on any
grid you point it at.

The asset pipeline is the mature part: server-side J2C→WebP transcode, IndexedDB texture + geometry-bake
caches, worker-thread mesh bake, warm reloads that skip re-fetching, and a Firestorm-style CRC object cache
that restores the full scene from disk without re-asking the sim. Inventory is data-loss-proof through
OpenSim's write-back lag.

**Next milestone — v0.4 "Beta-1":** the bar to open to outside testers. The single biggest blocker is
**avatars** (still robot-tube placeholders); after that it's polishing the build / inventory / chat / social
loop and going publicly hosted. Voice, groups, media, and appearance-bake are **Beta-2 (v0.5)**.

**Full remaining work is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md)** (open items only, grouped into
18 area bundles with a transparent weighted completion %). Shipped work lives in
[`docs/CHANGELOG.md`](docs/CHANGELOG.md).

**✨ Standouts:**
- Camera-driven interest streaming: the relay forwards only objects inside a camera-centred volume and streams them in/out as you move, so heavy regions (tested ~24k objects on Aspen) hold a bounded working set — the browser tab stays around ~10% heap instead of OOMing on the full region
- Session resumes on network blip (15-second circuit hold); clean logout that actually works
- Persistent CRC object cache — full scene from IDB on reload, zero sim re-fetch
- Scenery loading badge gives better insight into redraws as you navigate new areas
- Warm reload: geometry and textures load from disk in seconds, not minutes
- Near-first loading: the scene around your avatar builds and textures before distant objects
- Heavy-region texture loading no longer death-spirals on the single main thread (cached reads stop false-missing into a network-refetch storm)
- Multi-floater inventory browsing with accurate counts, search, and filter

---

## Feature status

Status: ✅ done · 🟡 partial · 🔨 in-progress · 🔜 soon · 🔭 exploring (brainstorm-first). Milestone = the
release each bundle is targeted at. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the open items in each.

| Bundle | Status | Milestone |
|---|---|---|
| World & Movement (walk/fly/sit/collision) | 🟡 ~85% | v0.4 |
| Rendering: prims, linksets, mesh, per-face textures | 🟡 ~78% | v0.4 |
| Rendering: environment (sky, day/night, ocean; trees/shadows todo) | 🟡 ~65% | v0.5 |
| Object Build & Edit floater | 🟡 ~50% | v0.4 |
| Object interaction & contents (right-click, take/buy, Xfer) | 🟡 ~72% | v0.4 |
| Inventory (browse/manage/give/rez/take) | 🟡 ~75% | v0.4 |
| **Avatars & Appearance** (robot-tube today — #1 beta blocker) | 🟡 ~15% | v0.4/v0.5 |
| Chat & Instant Messaging | 🟡 ~70% | v0.4 |
| Groups & Group IM | 🟡 ~8% | v0.5 |
| Friends & Profile | 🟡 ~62% | v0.4 |
| Places, Map, Minimap & Parcel | 🟡 ~68% | v0.4 |
| Voice (WebRTC — signaling done, gateway todo) | 🟡 ~8% | v0.5 |
| Media & audio (sound done; parcel/web-on-prim todo) | 🟡 ~45% | v0.5 |
| Scripting behaviors (browser reflects, can't run LSL) | 🟡 ~10% | v0.6 |
| Cross-region / neighbor sims | 🔭 ~15% | v0.5 |
| Performance & scale (interest streaming, caches) | 🟡 ~70% | ongoing |
| UI / floaters / preferences | 🟡 ~55% | v0.4 |
| Publicly hosted beta + 2D/mobile mode | 🔜 ~12% | v0.4 |

Infrastructure that's already solid: multi-grid login & saved accounts, cross-region teleport, CRC object
cache, camera-driven interest streaming (bounded heap on ~24k-object regions), texture/geometry/mesh IDB
caches, warm reloads.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for open work and [`docs/CHANGELOG.md`](docs/CHANGELOG.md) for what's shipped.

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
