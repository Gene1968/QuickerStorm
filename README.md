# quickerSTORM 🌩️

## A web-based 3D viewer for OpenSimulator and Second Life

No install. Open a browser tab, log in, and you're in-world.
Testing with OSGrid and NeverWorld so far — all the usual grids are listed for near-future testing.

## Current state · May 2026

**Phase 2 ship status:** nearly done. Prim rendering resolved (1500–1800 prims/region), Map 2D + cross-region TP shipped, terrain + ocean horizon stable. Last remaining must-have item is neighbor-sim terrain (currently accepting seamless 8 km ocean horizon as substitute).

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
- [x] **Prim default color** — TextureEntry default RGBA decoded; prims show their authored tint without any HTTP texture fetch?  - pastels since they were all white
- [x] **Hovering text** — floating CSS2D labels on prims that set them
- [x] **Cross-region teleport** — tear-down + new circuit handshake on TeleportFinish; scene rebuilds on new sim
- [x] **Ocean to horizon** — single 8 km water plane, world-space shader ripples that fade with distance; no abrupt region-edge cutoff
- [x] **Terrain collision + gravity** — bilinear-sampled foot height; clamps avatar Z above ground, real falls and impacts
- [x] See your region and coordinates in the location bar, and do same-region or **cross-region** teleport from there (paste `hop://` or `secondlife://` URL, or `Region Name X Y Z`)
- [x] **Region maturity badge** in LocationBar — G/Moderate/Adult/Offline from RegionHandshake (was incorrectly showing agent's account level)
- [x] Session resume on network blip (15-second circuit hold).  Proper logout disconnect
- [x] UI sounds (teleport whoosh, chat typing, floater pop, menu click, collision bump, new IM chime, disconnect "complication," etc.)
- [x] Bump into other avatars
- [x] Always Run toggle, terrain step-up tolerance, anti-fall safety

**🟡 Partially working**
- [~] Movement — 90%.  Inputs send correctly, you see your coords update, dead-reckoning matched to SL physics (3.2 m/s walk, 5.2 m/s run, 11 m/s fly). Initial yaw seeded from sim. Still missing: collision & objects so you don't silently bump into invisible prims.
- [~] **Map** — 80%. Pannable, smooth wheel zoom (zoom-toward-cursor, zoom 1–8 = 2–256 regions across), click to select (red disc + zoom-immune label), dbl-click TP, hovertip, search w/auto-retry, G/M/A maturity badges, ground-aware Z (flying preserves altitude). Real region snapshot tiles, agent dots on map, friends layer, Go Home, landmarks — Phase 3 cap-dependent.
- [~] Nearby chat — 75%.  Sending and receiving works, emoji picker/recent added. Deliberating: transcript, muted transcript, options and search, tear-off, close
- [~] **Instant Messaging (IM)** — 60%.  Sending and receiving works, emoji picker/recent added. Need some of the 10+ toolbar buttons, voice. `ImprovedInstantMessage` is pure LLUDP, no HTTP cap needed
- [~] Scene — 55%.  Terrain & ocean to horizon are great. No neighboring sims yet. No environment / light sources
- [~] Menus/floaters — 60%.  Some disabled placeholders as we implement features
- [~] Minimap — 65%.  Good as a compass, shows avies, dbl-click teleports within current region
- [~] Objects (prims) — 55%.  Cache-miss + ObjectUpdateCompressed decode now surface ~1500-1800 prims per region (14× pre-fix). Compressed prims default to cube until full shape decode lands. ~200-400 sim-silent prims still missing per region — sim's interest-list cap, not our bug?! - but it works in other clients!  Tiny color?  Linksets are not honored for selection, name...
- [~] Avatars — 30%.  Capsule + face indicator + arm tubes. Clothing/attachments make you a blocky robot at best. No appearance/baked textures yet
- [~] **Right-click avatar menu** —  30%.  IM, View Profile, Face Toward.  No zoomto, call, invite, inspect, save.  Self - no appearance, community, sit/stand, fly/land
- [~] **Right-click object menu (subset)** — 30%.  Edit (basic), Inspect (mock), Touch, Sit?? (no Take/Delete yet — those need Phase 3 caps)
- [~] **Object Edit floater** - 30%.   Object Properties + TransformControls + `MultipleObjectUpdate`

**🔜 Phase 3 finishing items**
- [ ] **Hollow / PathScale / Shear / Skew / RadiusOffset** prim params decoded but not yet applied to geometry (Sculpt prims still bounding-box; full sculpt is Phase 3)
- [ ] **Neighboring-sim terrain** — render adjacent regions at ±regionSize offset (EnableSimulator + second circuit / cap fetch)
- [ ] **Object face raycast picking** — currently picks bounding box; need per-triangle for correct Edit selection
- [ ] **Region size on cross-region TP** — RegionHandshake lacks size; needs cap fetch so var-region warps stop assuming 256×256
- [ ] **Voice (WebRTC ↔ sim VoIP)** — peer signaling works; gateway wire-up + spatial pan still TODO

**🔜 Up next later — Phase 3 ("real assets + social", HTTP caps)**
- [ ] **Inventory viewing** via `FetchInventoryDescendents2` cap; folder tree + item icons
- [ ] **Friends / Contacts** floater with online status, IM, profile, teleport-to (with rights)
- [ ] **Media** sound assets first, object/script sounds, parcel media, stream audio, object texture video media
- [ ] Object script basics - touch, hovertext, rotate, general LSL functions
- [ ] Scripting textures behavior and advanced
- [ ] HTTP-capability client foundation (LLSD-XML over Bun proxy)
- [ ] **Texture asset pipeline** — `GetTexture` cap → J2C (JPEG2000) decode in browser → real prim textures
- [ ] **Texture Inspect floater** — per-face UUID, dimensions, repeat/offset
- [ ] **Mesh export/import** via `GetMesh2` cap; Both Dae and GLTF/OBJ on the export side
- [ ] **Groups** + **Group IM** (group chat is `ChatSessionRequest` cap + IM hybrid)
- [ ] **Profile floater** via avatar properties cap
- [ ] **Places floater** — Favorites, drag, manages favorites bar.  Landmark list, add, delete, sort by date.  Teleport history (alt+h toggle), TP, copy SLurl, remove, clear, position, date.  Filter, detail view/Back, TP, show on map, region image
- [ ] Right-click object **Edit / Take / Copy / Delete / Export** (perms + caps)
- [ ] Web-on-prim (`ObjectMedia` cap)
- [ ] Transfer inventory, drop, folder of 42, CMT?

**⚠️ May be tricky**
- Cross-region teleport — requires tearing down and rebuilding the UDP circuit mid-session
- Avatar appearance — `AgentSetAppearance` with empty bake data destroys appearance globally; very risky to wire without thorough test grid validation
- J2C (JPEG2000) decode in the browser — needs WASM port of OpenJPEG or similar
- Mesh upload — mesh validator + physics LOD + L$ costs; export is much easier than import
- WebRTC proximity voice — peer signaling works; spatial falloff and VAD tuning still ahead
- Inventory at scale — ?folder tree sync across login sessions
- LLSD-XML / LLSD-binary parser — every cap response uses it; not just JSON
- Currency?  Hard to care about it

---

**🔧 Enhancement ideas**
- [ ] Inventory: find/filter duplicates by UUID (might still have different tints, sizes, next perms, ...)
- [ ] Bulk inventory true export probably not accurate from here and needs IAR console access (scripts and ?)

---

### Tech stack

- **Vue 3** (Composition API) · **Vite** · **Pinia** · **Vue Router**
- **Three.js** — 3D scene, avatar meshes, coordinate transform (SL Z-up → Three.js Y-up)
- **Bun WebSocket server** — LLUDP bridge, presence relay, chat, WebRTC signaling (`server/`)
- **WebRTC** — proximity voice; peer connections brokered by the WS server
- **Tailwind CSS**

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
