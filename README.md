# quickerSTORM 🌩️

## A web-based 3D viewer for OpenSimulator and Second Life

No install. Open a browser tab, log in, and you're in-world.
Testing with OSGrid and NeverWorld so far — all the usual grids are listed for near-future testing.

## Current state · May 2026

**✨ Parts already better than some other clients:**
- Resumes your grid session after a brief network drop or page reload. (no re-login). Useful 'Recsync World' feature
- Clean avatar logout — actually works. Takes some 2-way comm but not sure why others never had this
- More sensible multi- inventory floaters (not that they can be used yet)

---

**🟢 Working now**
- [x] Log in to various grids — splash page, Home, last location, or any region. Tested on OSGrid and NeverWorld
- [x] Others on Firestorm see your avatar appearance and movement normally (outbound AgentUpdate stream)
- [x] You see nearby users listed and they show up as simplified avatars (capsules w prim attachments) at the right places
- [x] **Other avatars turn to face the right way as they walk** (TerseUpdate rotation decode)
- [x] **Real region terrain heightmap** — decoded from LayerData, rendered with topo colors (blue/teal/green/earthy/stone). North-south orientation correct; OSGrid sea-floor layer (0x37) no longer clobbers land
- [x] **Real prim geometry** — Box / Cylinder / Sphere / Prism / Torus from PathCurve / ProfileCurve; Twist + Taper deformation applied
- [x] **Child-prim composition** — ParentID linked sets compose correctly (houses, vehicles no longer scatter)
- [x] **Prim default color** — TextureEntry default RGBA decoded; prims show their authored tint without any HTTP texture fetch
- [x] **Hovering text** — floating CSS2D labels on prims that set them
- [x] **Cross-region teleport** — tear-down + new circuit handshake on TeleportFinish; scene rebuilds on new sim
- [x] **Ocean to horizon** — single 8 km water plane, world-space shader ripples that fade with distance; no abrupt region-edge cutoff
- [x] **Terrain collision + gravity** — bilinear-sampled foot height; clamps avatar Z above ground, real falls and impacts
- [x] See your region and coordinates in the location bar, and do same-region teleport from there
- [x] Session resume on network blip (15-second circuit hold).  Proper logout disconnect
- [x] UI sounds (teleport whoosh, chat typing, floater pop, menu click, collision bump, new IM chime, disconnect "complication," etc.)
- [x] Bump into other avatars
- [x] Always Run toggle, terrain step-up tolerance, anti-fall safety

**🟡 Partially working**
- [~] Movement — 90%.  Inputs send correctly, you see your coords update, dead-reckoning matched to SL physics (3.2 m/s walk, 5.2 m/s run, 11 m/s fly). Initial yaw seeded from sim. Still missing: collision & objects so you don't silently bump into invisible prims.
- [~] Nearby chat — 75%.  Sending and receiving works, emojis added. Deliberating: transcript, muted transcript, options and search, tear-off, close
- [~] **Instant Messaging (IM)** — 60%.  Sending and receiving works, emojis added. Need 10+ toolbar buttons, voice. `ImprovedInstantMessage` is pure LLUDP, no HTTP cap needed
- [~] Scene — 60%.  Terrain rendering & height color are accurate, ocean w ripples to horizon! No neighboring sims yet. No environment settings or light sources
- [~] Avatars and objects — 10%.  Avatars get prims for attachments but it looks quite strange.  Objects rarely show up, based on late-stage server updates, and are incorrect white prims.
- [~] Menus/floaters — 60%.  Some disabled placeholders as we implement features
- [~] Minimap — 60%.  Good as a compass and sometimes shows avies.
- [~] **Object Edit floater**  - 20% Object Properties + TransformControls + `MultipleObjectUpdate`
- [~] **Right-click object menu (subset)** — 30% Edit (basic), Inspect (mock), Touch, Sit?? (no Take/Delete yet — those need Phase 3 caps)
- [~] **Right-click avatar menu** —  40% IM, View Profile, Face Toward. No zoom, call, invite, inspect

**🔜 Phase 2 finishing items**
- [ ] **Map** — almost ready for the real thing
- [ ] **Neighboring-sim terrain** — render adjacent regions at ±regionSize offset (EnableSimulator + second circuit / cap fetch)
- [ ] **Object face raycast picking** — currently picks bounding box; need per-triangle for correct Edit selection
- [ ] **Region size on cross-region TP** — RegionHandshake lacks size; needs cap fetch so var-region warps stop assuming 256×256
- [ ] **Voice (WebRTC ↔ sim VoIP)** — peer signaling works; gateway wire-up + spatial pan still TODO
- [ ] **Hollow / PathScale / Shear / Skew / RadiusOffset** prim params decoded but not yet applied to geometry (Sculpt prims still bounding-box; full sculpt is Phase 3)

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
