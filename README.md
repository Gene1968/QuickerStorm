# quickerSTORM 🌩️

## A web-based 3D viewer for OpenSimulator and Second Life

No install. Open a browser tab, log in, and you're in-world.
Testing with OSGrid and NeverWorld so far — all the usual grids are listed for near-future testing.

## Current state · June 2026

**Phase 2 ship status:** done. Prim rendering resolved (1500–1800 prims/region), Map 2D + cross-region TP shipped, terrain + ocean horizon stable. Avatar/object right-click menus + IM + child-prim linksets + hovertext all in. Only deferred must-have is neighbor-sim terrain (accepting seamless 8 km ocean horizon as substitute) + voice (Phase 2.5).

**Phase 3 in progress:** HTTP-capability foundation live (LLSD-XML parser, full cap dictionary, server-side cap proxy). Inventory browse-complete (folder tree + items via `FetchInventoryDescendents2`). Social layer shipped: friends/contacts store + live status + friend-request toasts + Notifications floater. Saved-accounts system shipped. Appearance/Outfits floater shell shipped. Textures (`GetTexture` → J2C) is the next major lever.

**✨ Parts already better than some other clients:**
- Often can truly resume your grid session after a brief network drop or page reload with no re-login needed. Useful 'Resync World' feature if view bugs out
- Clean avatar logout — it actually works. Takes some 2-way comm but not sure why others never had this for switching to your alts
- Somewhat more sensible multi-floaters for inventory (can view now, working on asset management and usage)

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
- [x] **Saved accounts** — multiple grid accounts persist across sessions; login dropdown with remove; auto-reconnect on page load
- [x] **Friend requests** — inbound toast notifications; accept/decline; friendship offer from avatar menu

**📦 Inventory — view/browse (Phase 3, ~70%)**
- [x] Folder tree from the login skeleton (instant, no cap) — FS sort order (system folders to top, then alphabetical)
- [x] Folder contents (items) via `FetchInventoryDescendents2` cap — lazy on expand + paced background bulk load of the whole inventory
- [x] **Accurate total** — `N,NNN Elements` footer once bulk load completes; per-folder `(items/folders)` count on the selected folder
- [x] Type icons (textures, scripts, objects, landmarks, animations, …); folder-type icons
- [x] Search filter (folder + item names) — **searchable permission tags** ("no copy/modify/transfer")
- [x] Type filter dropdown; sort by Name/Date/Type in the cog menu
- [x] Favorites / Worn (Current Outfit) / Recent tabs from system folders
- [x] Right-click menu — Properties, Copy Item/Asset/Folder UUID; Properties popover (type, UUIDs, perms, created date)
- [ ] Drag/move, rename/F2, wear/attach, thumbnails (need move + texture caps)
- [ ] Create, create folder, change perms?


**🟡 Partially working**
- [~] Movement — 90%.  Inputs send correctly, you see your coords update, dead-reckoning matched to SL physics (3.2 m/s walk, 5.2 m/s run, 11 m/s fly). Initial yaw seeded from sim. Still missing?: invisible objects w/wo collision, and some stray bumps as well.  Some kind of start-over bug when walking in a busy area, probably a late-realized obstacle.
- [~] **Map** — 80%. Pannable, smooth wheel zoom (zoom-toward-cursor, zoom 1–8 = 2–256 regions across), click to select (red disc + zoom-immune label), dbl-click TP, hovertip, search w/auto-retry, G/M/A maturity badges, ground-aware Z (flying preserves altitude). Real region snapshot tiles, agent dots on map, friends layer, Go Home, landmarks — Phase 3 cap-dependent.
- [~] Minimap — 75%.  Heading-up rotating radar view, avatar dots, dbl-click teleports within current region. Missing: CoarseLocationUpdate forwarding for reliable region-wide dots (needs server), land markers
- [~] Nearby chat — 75%.  Sending and receiving works, emoji picker/recent added. Deliberating: transcript, muted transcript, options and search, tear-off, close
- [~] **Instant Messaging (IM / Conversations)** — 70%.  Sending and receiving works, emoji picker/recent added. ConversationsFloater with tabs. Need more of the 10+ toolbar buttons, voice. `ImprovedInstantMessage` is pure LLUDP, no HTTP cap needed
- [~] Menus/floaters — 70%.  TopRightTray (IM + Notifications cluster), QuickPrefs & Notifications popovers, docking. Some disabled placeholders as we implement features
- [~] **Friends / Contacts** — 70%.  ConversationsFloater contacts tab: search, online/offline list, per-friend rights toggles (Online/Map/Modify), add-by-name picker, remove with confirm, IM from contact. Buddy list from login, live status via FRIEND_STATUS. Not yet live-tested
- [~] **Appearance / Outfits** — 35%.  AppearanceFloater: edit avatar colors/skin/hair, Wearing tab (inventory wearables), Outfits tab shell. No baked textures / real SL clothing layers yet
- [~] Terrain scene — 55%.  Terrain & ocean to horizon are good. No neighboring sims yet. Need to Render the 4 terrain detail textures (J2C) using the corner blend bands — we now have the UUIDs.  Need sun/moon light source, gradient sky, reflections on water etc, shadows
- [~] Objects: prims — 55%.  Cache-miss + ObjectUpdateCompressed decode now surface ~1500-1800 prims per region (14× pre-fix). Compressed prims default to cube until full shape decode lands. ~200-400 sim-silent prims still missing per region — sim's interest-list cap, "not our bug" - but it works in other clients!?  Tiny color?  Linksets are not honored for selection, name...
- [~] Avatars — 30%.  Capsule + face indicator + arm tubes. Clothing/attachments make you a blocky robot at best. No appearance/baked textures yet
- [~] **Right-click avatar menu** —  30%.  IM, View Profile, Face Toward.  No zoomto, call, invite, inspect, save.  Self - no appearance, community, sit/stand, fly/land
- [~] **Right-click object menu (subset)** — 30%.  Edit (basic), Inspect (mock), Touch, Sit?? Needs: Take/Delete(those need Phase 3 caps)
- [~] **Object Build & Edit floater** - 35%.   Object Properties + TransformControls + `MultipleObjectUpdate`. Needs many features: editing name, desc, perms, size, pos, rot, contents, textures drag&drop, textures pos, sculpt textures, Edit linked, Select Face, create prims, link/unlink

**🔜 Phase 3 ("real assets + social", HTTP caps)**
- [x] **HTTP-capability client foundation** — LLSD-XML parser, full cap dictionary from seed cap, server-side cap proxy (cap URLs never leave the server)
- [~] **Profile floater** - 60%.  via avatar properties cap
- [~] **Places floater** — 65%.  Favorites, Landmarks, TP history.  Gear menu needs Teleport, Show on map,, share, view/edit lm, move to Favorites (if not), copy slurl, create pick?,, cut, copy, paste, rename, delete,, expand (folders only),, Remove from history (h only).  History gets accordion menu for Today and a few time periods (manual close),  Buttons at bottom persist for Teleport, Map, [Place] Profile. Items need drag, Favs appear in top favorites bar.  Needs to retrieve names, LM view w thumbnail & Edit btn (Title, My Notes), plus btn menu to LM curr loc or create folder,  delete, sort by date.  Teleport history (alt+h toggle), TP, copy SLurl, remove, clear, position, date.  Filter, detail view/Back, TP, show on map, region image
- [~] Right-click object **Edit / Take / Copy / Delete / Export** (perms + caps)
- [~] **Friends / Contacts** — contacts tab in ConversationsFloater; needs live-test (see Partially working above)
- [ ] **Hollow / PathScale / Shear / Skew / RadiusOffset** prim params decoded but not yet applied to geometry (Sculpt prims still bounding-box; full sculpt is Phase 3).  This is just for rendering objects?
- [ ] Objects: mesh — 5%.  Not yet decoding vertices and so forth, then on to texturing.
- [ ] Objects: trees, plants, system plants — 0%.  Do these need some sort of special treatment?
- [ ] Build and Edit inworld - many features - editing size, pos, rot, textures drag&drop, open/unpack boxes
- [ ] Transfer inventory, drop, folder of 42, CMT?
- [ ] Play inventory assets - sounds, animations, gestures - options for locally and in-world.
- [ ] **Neighboring-sim terrain** — render adjacent regions at ±regionSize offset (EnableSimulator + second circuit / cap fetch)
- [ ] **Object face raycast picking** — currently picks bounding box; need per-triangle for correct Edit selection
- [ ] **Region size on cross-region TP** — RegionHandshake lacks size; needs cap fetch so var-region warps stop assuming 256×256
- [ ] **Voice (WebRTC ↔ sim VoIP)** — peer signaling works; gateway wire-up + spatial pan still TODO
- [ ] **Media** sound assets first, object/script sounds, parcel media, stream audio, object texture video media
- [ ] Object script basics - touch, hovertext, rotate, general LSL functions
- [ ] Scripting textures behavior and advanced
- [ ] **Texture asset pipeline** — `GetTexture` cap → J2C (JPEG2000) decode in browser → real prim textures + inventory thumbnails (next up; cap already in the dictionary).  Cache??
- [ ] **Texture Inspect floater** — per-face UUID, dimensions, repeat/offset
- [ ] **Mesh export/import** via `GetMesh2` cap; Both Dae and GLTF/OBJ on the export side
- [ ] **Groups** + **Group IM** (group chat is `ChatSessionRequest` cap + IM hybrid)
- [ ] Web-on-prim (`ObjectMedia` cap) HTML
- [ ] Environment - 0%.  No environment settings yet.  Day/night, sky colors, wind?

**⚠️ May be tricky / late Phase 3**
- Avatar appearance — `AgentSetAppearance` with empty bake data destroys appearance globally; very risky to wire without thorough test grid validation
- J2C (JPEG2000) decode in the browser — needs WASM port of OpenJPEG or similar; blocks real prim textures + inventory thumbnails
- Mesh upload — mesh validator + physics LOD + L$ costs; export is much easier than import
- WebRTC proximity voice — peer signaling works; spatial falloff, VAD tuning, and gateway wire-up still ahead
- Inventory at scale — folder tree sync across login sessions; localStorage cache
- Neighboring-sim terrain — second UDP circuit + EnableSimulator handshake; blocks seamless region-edge walk
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
