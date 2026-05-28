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
- [x] You see nearby users listed and they show up as simplified avatars (cyan capsules) at the right place
- [x] **Other avatars now turn to face the right way as they walk** (TerseUpdate rotation decode)
- [x] **Real region terrain heightmap** — decoded from LayerData, rendered with topo colors (blue/teal/green/earthy/stone)
- [x] See your region and coordinates in the location bar, and do same-region teleport from there
- [x] Session resume on network blip (15-second circuit hold).  Proper logout disconnect
- [x] UI sounds (teleport whoosh, chat typing, floater pop, menu click, collision bump, etc.)
- [x] Gravity and fall terrain impact
- [x] Bump into other avatars

**🟡 Partially working**
- [~] Movement — 80%.  Inputs send correctly, you see your coords update, dead-reckoning matched to SL physics (3.2 m/s walk, 5.2 m/s run, 11 m/s fly). Initial yaw seeded from sim. Still missing: collision so you don't silently bump into invisible prims.
- [~] Scene — 50%.  Terrain rendering & height color are fairly accurate, but has low detail to be investigated later. Prims still render as 1m cubes with hash-tinted color (each prim distinguishable but only minimal geometry so far). Ocean is flat blue — no ripple. No neighboring sims.
- [~] Nearby chat — 75%.  Sending and receiving works, emojis added. Deliberating: transcript, muted transcript, options and search, tear-off, close
- [~] IM chat — 60%.  Sending and receiving works, emojis added. Need 10+ toolbar buttons, voice
- [~] Menus/floaters — 50%.  Some disabled placeholders as we implement features
- [~] Minimap — 50%.  Good as a compass and sometimes shows avies.
- [~] **Object Edit floater**  - 20% Object Properties + TransformControls + `MultipleObjectUpdate`
- [~] **Instant Messaging (IM)** — `ImprovedInstantMessage` is pure LLUDP, no HTTP cap needed
- [~] **Right-click avatar menu** — IM, View Profile, Face Toward
- [~] **Right-click object menu (subset)** — Inspect, Touch, Sit (no Edit/Take/Delete yet — those need Phase 3 caps)

**🔜 Up next — Phase 2 ("world looks like world")**
- [ ] **Map** — almost ready for the real thing
- [ ] **Real prim geometry** — read PathCurve/ProfileCurve already in the packet → boxes/cylinders/spheres/tori instead of cubes
- [ ] **Child-prim composition** — linked sets (houses, vehicles) currently explode into scatter; ParentID is decoded but unused
- [ ] **Prim colors** — decode TextureEntry default color so prims show their real RGBA without any texture fetch
- [~] **Terrain collision + gravity** — heightmap exists, just sample it under the avatar's feet
- [ ] **Ocean ripple** — small vertex displacement shader on the water plane
- [ ] **Neighboring-sim terrain** — load 4 neighbor regions at the right world offset
- [ ] **Cross-region teleport** — tear down current UDP circuit, open new one to target sim
- [ ] Hovering text on prims (already in the packet, just not surfaced)

**🔜 Up next later — Phase 3 ("real assets + social", HTTP caps)**
- [ ] HTTP-capability client foundation (LLSD-XML over Bun proxy)
- [ ] **Inventory viewing** via `FetchInventoryDescendents2` cap; folder tree + item icons
- [ ] **Texture asset pipeline** — `GetTexture` cap → J2C (JPEG2000) decode in browser → real prim textures
- [ ] **Texture Inspect floater** — per-face UUID, dimensions, repeat/offset
- [ ] **Mesh export/import** via `GetMesh2` cap; GLTF/OBJ on the export side
- [ ] **Friends / Contacts** floater with online status, IM, profile, teleport-to (with rights)
- [ ] **Groups** + **Group IM** (group chat is `ChatSessionRequest` cap + IM hybrid)
- [ ] **Profile floater** via avatar properties cap
- [ ] **Places floater** — landmark list, saved teleport favorites
- [ ] Right-click object **Edit / Take / Copy / Delete / Export** (perms + caps)
- [ ] Web-on-prim (`ObjectMedia` cap)

**⚠️ May be tricky**
- Cross-region teleport — requires tearing down and rebuilding the UDP circuit mid-session
- Avatar appearance — `AgentSetAppearance` with empty bake data destroys appearance globally; very risky to wire without thorough test grid validation
- J2C (JPEG2000) decode in the browser — needs WASM port of OpenJPEG or similar
- Mesh upload — mesh validator + physics LOD + L$ costs; export is much easier than import
- WebRTC proximity voice — peer signaling works; spatial falloff and VAD tuning still ahead
- Inventory at scale — UUID dedup, folder tree sync across login sessions
- LLSD-XML / LLSD-binary parser — every cap response uses it; not just JSON

---

**🔧 Enhancement backlog**
- [ ] Inventory: find/filter duplicates by UUID (might still have different tints, sizes or perms?)
- [ ] Bulk inventory true export probably not possible from here unless you have IAR console access

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
