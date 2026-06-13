# Feature Gaps & Priority Queue — quickerSTORM

> Living tracker. Add items freely during sessions, grouped by feature area.
> Both Gene and Claude read this before prioritizing work — completeness here means nothing gets forgotten.
> Status: `[ ]` not started · `[~]` partial · `[!]` needs live-test on a real grid

---

## Current Priority Queue

### Render / Cache (near-term)

| # | Item | Status |
|---|------|--------|
| 1 | CRC probe audit | ✅ done 2026-06-12 |
| 2 | Storage budget (qs-geom 0.3/4GB, qs-mesh LRU 1GB) | ✅ done 2026-06-12 |
| 3 | Texture bulletproofing (watchdog + onabort everywhere) | ✅ done 2026-06-12 |
| 4 | Lit shading viability + render quarantine | ✅ done 2026-06-12 |
| 5 | OOM heap creep | ✅ suspect fixed; long-soak still needed |
| 6 | Draw-call instancing / merging | 🔜 NEXT — ~9k draw calls, 30-43ms frames |
| 7 | Watch items / small debts | 🔜 planar-repeat striping, IDB version handlers, log spam |
| 8 | Prim geometry: ONE batched GEOM_VERSION bump | 🔜 hollow + path/profile cut + dimple + shear + revolutions, all at once |

⚠ **Cache discipline rule:** All geometry-output changes land in ONE GEOM_VERSION bump (item 8) to avoid repeated user cache wipes. Do not land hollow alone, then cut, then shear — port the full PrimMesher.cs in one shot.

**Still open:** NoToneMapping A/B vs Firestorm — needs Gene's visual review.

### Phase 3 Feature Priority

1. Inventory management — move/rename/wear/attach (LLUDP, no AIS3 in OpenSim)
2. Friends live-test — verify contacts tab against a real grid; close the debt row
3. Places floater completion — gear menu actions, TP history accordion, Favorites bar
4. Object interaction: Take / Delete / Copy (perms + caps)
5. Profile: live-test + edit own fields
6. Neighboring-sim terrain (EnableSimulator + second circuit)
7. Voice gateway wire-up (spatial pan, VAD, per-region enable)
8. Prim geometry completeness — the single GEOM_VERSION bump (render item 8)
9. Groups + Group IM (ChatSessionRequest + LLUDP hybrid)
10. Appearance / bake pipeline — risky, needs test-grid validation first
11. Environment (WindLight/EEP sky, day cycle, reflections, shadows)
12. Media (sounds, parcel audio, object texture video)

---

## Feature Gaps by Area

---

### Movement & Physics

- [ ] Invisible-object phantom collisions — stray bumps with no visible object
- [ ] Walk "start-over" bug in busy areas — avatar resets mid-walk, likely a late-obstacle detection race
- [ ] Cross-region boundary walk — DisableSimulator + new UseCircuitCode handshake not wired; map dot lags; no scene continuity on walk

---

### Avatar Rendering

- [ ] Baked skin / clothing textures — full AgentSetAppearance bake pipeline; ⚠ sending empty bake data destroys appearance globally, needs test-grid validation before wiring
- [ ] Rigged mesh skeleton (skin block decode) — bone transforms ignored; clothing meshes land at wrong positions
- [ ] Clothing / attachment rendering — currently blocky robot; bind-pose placement first, then hide arm tubes only on torso-coverage signal (not on attachment count)
- [ ] Own-avatar appearance mesh from baked textures

---

### Objects: Prims

All shape params already decoded server-side. The following are geometry-generation gaps only.

- [ ] Hollow (ProfileHollow) — renders solid where it should be open; hollow cylinder localId 1051985899 fills in open-water deck mesh
- [ ] Path cut (PathBegin/End)
- [ ] Profile cut (ProfileBegin/End)
- [ ] Dimple
- [ ] Shear
- [ ] Revolutions / skew
- [ ] Hole-shape variants (interior face geometry and UV)
- ⚠ All items above → one GEOM_VERSION bump (priority queue item 8)
- [ ] Per-face materials on hollow/cut interior faces
- [ ] Delivery variance — occasional missing prims on heavy regions
- [ ] Linkset root-name polish (root prim name shown in hover / selection)

---

### Objects: Mesh

- [ ] LOD selection — always uses highest-LOD submesh; should select by screen-space size
- [ ] Rigged / skinned mesh (SkinWeights + JointNames block, bind pose)
- [!] qs-mesh LRU at 1GB cap — confirm eviction and re-bake work correctly on a long session

---

### Objects: Trees / Plants / Particles

- [ ] System trees and plants (PCode 0x01 / 0x04) — 0%; need billboard or fixed geometry treatment
- [ ] Particle systems (PSBlock) — fields decoded but skipped; need THREE.Points emitter per object; extended 192-byte OpenSim format causes tail-OOB on some prims

---

### Object Build & Edit Floater

Working: Object Properties, in-scene TransformControls drag, MultipleObjectUpdate, per-face texture mapping display with Repeats-per-meter.

- [ ] Edit name and description
- [ ] Edit permissions
- [ ] Numeric size / pos / rot input fields (in-scene drag works; text input TODO)
- [ ] Texture drag and drop onto faces
- [ ] Select Face radio (target individual face for texture/material edits)
- [ ] Normal / Specular channels (RenderMaterials cap exists; not consuming yet)
- [ ] Sculpt texture assignment
- [ ] Create new prim in-world
- [ ] Link / Unlink prims
- [ ] Object face raycast picking — currently picks bounding box; need per-triangle for correct face selection
- [ ] Open / unpack box contents (RequestTaskInventory + Xfer)
- [ ] Take, Delete, Copy to inventory (perms + Phase 3 caps)

---

### Right-Click Menus

**Avatar menu (~30% — IM, View Profile, Face Toward done):**
- [ ] Zoom to avatar
- [ ] Call (voice)
- [ ] Invite to group
- [ ] Inspect (appearance info)
- [ ] Save outfit
- [ ] Self: open AppearanceFloater, Sit/Stand, Fly/Land, community actions

**Object menu (~30% — Edit, Inspect, Touch done):**
- [ ] Sit on object (SitOnObject + RequestObjectPropertiesFamily)
- [ ] Take, Delete (Phase 3 caps)
- [ ] Buy / Pay (if object is for sale / L$ enabled)
- [ ] Create copy to inventory
- [ ] Open (object contents via Xfer)

---

### Terrain & Environment

- [ ] Neighboring-sim terrain — adjacent ±regionSize regions (EnableSimulator + second circuit or cap fetch)
- [ ] Region size on cross-region TP — RegionHandshake lacks size; var-region warps assume 256×256; needs cap fetch
- [ ] 4 detail terrain textures — UUIDs already in hand; need J2C fetch + corner-blend shader application
- [ ] Sun / moon directional light (position derived from environment time-of-day)
- [ ] Sky gradient (horizon/zenith colors from WindLight/EEP)
- [ ] Water reflections
- [ ] Shadows
- [ ] Day / night cycle (time-of-day state from sim EstateCovenantReply or EEP)
- [ ] Wind field visual consumer (LayerData 0x57 already decoded; no renderer yet)
- [ ] Cloud layer visual consumer (LayerData 0x43 already decoded)

---

### Nearby Chat

- [ ] Chat transcript / scrollback persistence (session storage)
- [ ] Muted names / words filter
- [ ] Options panel (chat range, channel override, font size)
- [ ] Search within history
- [ ] Tear-off to separate draggable floater
- [ ] Close / re-open without losing history

---

### Instant Messaging / Conversations

Working: send + receive, emoji picker + recent, per-agent tabs.

- [ ] Standard toolbar buttons — Mute, Share, Pay, TP Offer, Add Friend, Block, Profile, and several more
- [ ] Voice button in IM window
- [ ] Group IM tabs (distinct from direct IM — see Groups section)
- [ ] Conference / ad-hoc multi-agent chats
- [ ] Typing indicator (ImprovedInstantMessage type 41)
- [ ] IM history persistence across page reloads

---

### Friends / Contacts

Working: contacts tab, search, online/offline list, rights toggles, add-by-name, remove, IM from contact.

- [!] Not live-tested — verify on a real grid; remove `friends-live-verify` from tech-debt.md after
- [ ] Map-permission toggle (see friend on map / let friend see you)
- [ ] Modify-objects permission toggle
- [ ] Call friend (voice)
- [ ] Teleport to friend / Offer TP
- [ ] Per-friend online-notification option

---

### Inventory

Working: folder tree, lazy expand + background bulk load, item browse, count footer, type icons, search, filter/sort tabs, right-click properties.

- [ ] Drag / move items to another folder
- [ ] Rename item (F2 or context menu)
- [ ] Wear / attach from inventory (calls to sim)
- [ ] Detach / remove wearable
- [ ] Thumbnails (GetTexture for asset preview image)
- [ ] Create new item
- [ ] Create folder
- [ ] Change permissions
- [ ] Transfer / drop to another agent
- [ ] "Folder of 42" / CMT batch operations
- [ ] Play inventory assets inline (sounds, animations, gestures — locally and in-world options)
- [ ] Find / filter duplicate UUIDs
- [ ] Inventory localStorage cache (persist folder tree across login sessions)

---

### Appearance / Outfits

Working: edit avatar colors/skin/hair (local display only), Wearing tab, Outfits tab shell.

- [ ] Baked textures / clothing layers (full AgentSetAppearance bake pipeline) — ⚠ risky, needs test-grid
- [ ] COF (Current Outfit Folder) sync with wearables store
- [ ] Client-side texture bake (compose layers on canvas 2D → upload)
- [ ] Wear / unwear items from Wearing tab
- [ ] Outfits: save, apply, delete

---

### Places Floater

Working: Favorites list, Landmarks, TP history, basic Teleport button.

**Gear / context menu gaps:**
- [ ] Show on Map
- [ ] Share landmark
- [ ] View / Edit landmark (thumbnail + Title + My Notes)
- [ ] Move to Favorites
- [ ] Copy SLurl
- [ ] Cut, Copy, Paste, Rename, Delete
- [ ] Expand folder
- [ ] Remove from history (history entries only)

**History tab gaps:**
- [ ] Accordion grouping by date (Today, Yesterday, This Week…) with manual collapse
- [ ] alt+H toggle
- [ ] Per-entry: Copy SLurl, Remove, Clear all, show position + date

**Favorites / Landmarks gaps:**
- [ ] Drag to reorder Favorites
- [ ] Favorites Bar strip in the main HUD
- [ ] Landmark detail view + Edit (Title + My Notes)
- [ ] Plus-btn menu: LM current location, Create folder, Sort by date

**List UI gaps:**
- [ ] Filter bar
- [ ] Detail view with Back button, Teleport, Show on Map, region image

---

### Map & Minimap

Working: pan, zoom-toward-cursor, click-select, dbl-click TP, search with auto-retry, maturity badges, heading-up rotating minimap.

- [ ] Real region snapshot tiles (J2C fetch via cap)
- [ ] Remove the arbitary grid lines
- [ ] MapItemRequest for agent / event / landmark dots
- [ ] Friends layer (online friends shown on map)
- [ ] Go Home wired to home position from login response - why not already?
- [!] Minimap CoarseLocationUpdate forwarding (dropped at lludp.ts:630) — region-wide dots unreliable beyond draw distance; needs server work
- [ ] Minimap land markers (parcel bitmask overlay)
- [ ] Map localStorage cache (persist region records between sessions)

---

### Voice (WebRTC)

Working: peer signaling, WS proxy layer.

- [ ] Gateway wire-up (Vivox / Freeswitch or Opus-native SIP)
- [ ] Spatial audio pan (distance + direction from avatar position)
- [ ] VAD (voice activity detection) tuning
- [ ] Per-region / per-parcel voice enable from sim flags
- [ ] Per-speaker mute and volume slider
- [ ] Voice active indicator on avatars and minimap dots

---

### Media

- [ ] Object / script sound triggers (SoundTrigger, AttachedSoundGainChange packets)
- [ ] Parcel ambient audio stream (parcel media URL)
- [ ] Object texture video (mp4 / stream on prim face via ObjectMedia cap)

---

### Profile

Working: profile floater via avatar-properties cap (~60%).

- [!] Not live-tested on a real grid ?
- [ ] Edit own profile fields (about, first life, web URL, languages)
- [ ] Upload / change profile photo
- [ ] Picks tab (create / edit / delete picks)
- [ ] Classifieds tab (view)
- [ ] Notes about other agents
- [ ] Resident-since / payment-info flags

---

### Groups & Group IM

- [ ] Group list from login (AgentGroupDataUpdate)
- [ ] Group info floater (charter, members, roles, land, notices)
- [ ] Group IM (ChatSessionRequest cap + ImprovedInstantMessage hybrid)
- [ ] Group notices (inbox + send)
- [ ] Group roles / membership management
- [ ] Active group title toggle
- [ ] Group search

---

### Scripting & Object Behaviors

- [ ] Touch handler dispatch to script (llTouch → script event)
- [ ] Animated rotation scripts (spinning prims via ObjectUpdate pose stream)
- [ ] Script-driven texture changes
- [ ] General LSL event dispatch (touch, collision, sensor, timer…)
- [ ] High-use LSL functions (llGiveInventory, llTeleportAgent, llDialog…)

---

### Web-on-Prim

- [ ] ObjectMedia cap decode (media URL per face)
- [ ] HTML iframe rendered on prim face (CSS3D plane or canvas texture)

---

### Cross-Cutting / Misc

- [!] NoToneMapping A/B vs Firestorm — Gene same it seems okay but we don't have real lighting
- [!] Heap long-soak — OOM suspect fixed 2026-06-12; needs ~2-hour session to confirm flat
- [!] Var-region terrain live-verify (NeverWorld 512m fix committed 2026-05-30, not yet confirmed on a running grid)
- [ ] CoarseLocationUpdate server forwarding (lludp.ts:630 drop — affects map + minimap dots)
- [ ] Springback investigation (avatar snaps back when walking or flying, perhaps gets ahead of server, fixed a few times but it comes back)
- [ ] RenderMaterials normal/specular on prims (cap infrastructure exists; not consuming yet)
- [ ] Enhancement: find/filter inventory items by duplicate UUID
