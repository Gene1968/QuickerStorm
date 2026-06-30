# Feature Gaps — Batch Queue (working front door)

> **This is the curated working surface.** The full detail/history lives in [FEATURE-GAPS.md](FEATURE-GAPS.md).
> **Doc split:** `FEATURE-GAPS.md` = the **archive** — full detail, history, the running **bug log**, and items
> **not yet ready to batch**. **This file** = only items promoted to **⚡ batch-ready** or **🧠 brainstorm-first**.
> Log new bugs/ideas in FEATURE-GAPS.md (or dump raw in the inbox at the very bottom here), then promote up.

## How to batch a sweep (read me first)

To wire up a lot at once, say **"ultracode"** (or "use a workflow") + name a cluster, e.g.
*"ultracode the Inventory-actions cluster"* or *"batch the Right-Click-Menu wires."* That fans out one
subagent per item (TDD + verify each), then I review and you commit.

Rules that keep a sweep fast:
- **Pick from ⚡ BATCH-READY only.** Those are small, well-scoped, and *independent* (don't collide).
- **Skip the ceremony** for these — no per-item brainstorm/spec/plan; implement + test directly. (Say so.)
- **One subsystem per sweep** where possible (shared files don't collide).
- **Batch server edits**, one Bun restart, then client edits over HMR.
- 🧠 **BRAINSTORM-FIRST items are NOT for blind batching** — each needs design (they're structural/risky,
  often touch the live cache/render/cross-region paths). Do those one at a time.

---

## ⚡ BATCH-READY clusters (sweep targets)

Each cluster = independent, small wires. `→` = done-criterion where non-obvious.

### ✅ Inventory write side — SHIPPED 2026-06-27/28 (committed)
create (CreateInventoryCategory cap + subfolder-ingest + auto-rename) · rename (F2/menu) · move (drag) ·
delete→Trash · change permissions · wear/attach (objects) · detach · post-mutation IDB cache flush ·
root relabeled "Inventory" · inline thumbnails removed (traffic). Live-verified osgrid. **Deferred:** generic
create-item (asset-upload cap), clothing-layer wearables (bake pipeline → brainstorm-first Appearance).

### 🔧 Inventory — solidify (finish Inventory before other clusters; order = reliability → features → polish)
**Reliability first (the "solid" bar):**
- **🐛 OpenSim write-back LAG on fresh folders** — cap returns 200 (region cache has it) but flush to grid
  Robust DB lags; a hard-reload minutes later re-fetches before the write lands → folder GONE. OpenSim-side.
  OPTIONS: (a) LogoutRequest on page unload to force flush; (b) confirm self-heal after periodic write-back;
  (c) persist created folders in client IDB + reconcile. (See [[inventory-write-side-shipped]].)
- **🐛 Bad/missing-asset resilience** — 100+ blob 404s on this grid; cap retries/log noise, mark dead assets.
- (Large-inventory load reliability — the 50–150k "spins forever / don't trust the cache" concern — lives in
  🧠 BRAINSTORM-FIRST; it's structural.)

**Missing core features:**
- **Accept inventory offer** (inbound give from another agent).
- **Multi-select move** — drag currently moves only the pointed-at item; should move ALL selected.
- **Double-click "open" semantics per asset type:** texture → preview floater (port FS `floater_preview_texture.xml`);
  sound → play locally; animation → "Play inworld / Play locally" (`floater_preview_animation.xml`);
  gesture → editor (`floater_preview_gesture.xml`). Define the dispatch once, wire per type.
- **"Inspect textures!" item/floater** (per FS) — pairs with the texture-preview work.

**Polish / UX:**
- **Texture preview (hover)** — FS model: 256² floating preview on hover after a short delay, fetched
  on-demand (NOT per-row auto-fetch — 24k-texture accounts = traffic). `useInventoryThumbnail.js` exists to build on.
- **No "(empty)" label** under an open empty folder.
- **Start with one open** - Simply have the first Inventory floater open on page load as Conversations and Nearby already are.
- **"Drop inventory item here" → give to agent** — drop-zone already renders in Profile/IM; wire to transfer-to-agent.
- **Recent / Worn tabs as a tree** (currently flat) + flat tabs lack right-click/F2 (Gap C): give them the tree
  component or wire the row handlers in.
- **Bug B — BulkUpdateInventory reconcile:** on OpenSim the ack arrives over the EventQueue (LLSD), not UDP;
  our decoder is UDP-path-only so S.INV_BULK_UPDATE never fires (optimistic UX works regardless).

### Object Build & Edit Floater — FEATURE-GAPS L170–186
- edit name & description · numeric size/pos/rot input fields (fields editable → modify selected) · Select-Face radio
- texture drag-drop onto faces · Normal/Specular channels (RenderMaterials cap) · sculpt-texture assign
- Link/Unlink prims · Link-number ordering bug (L183) · **create/rez a prim in-world** (Build-tools)
- **🐛 creator/owner names still not resolving** in the floater
- **drag-select multiple objects** while the Edit floater is open · **edit gizmo handles** (move/rotate/scale/copy)
- **texture anim/scripts** (moving water, scrolling text, "cell animation," etc.)
- **"Not for sale" decode** → only show the buy pointer when actually for sale; then **Buy / Buy-for-0**
  ('You don't have enough…' + placeholders for real purchase/currency) — full money system is brainstorm-first.

### Right-click menus (object + avatar) — FEATURE-GAPS L190–207
- avatar: zoom-to · inspect (appearance) · invite to group · save outfit · self menu (Sit/Stand/Fly)
- object: sit-on-object (SitOnObject + RequestObjectPropertiesFamily) · buy/pay · open contents (Xfer)

### Land / Parcel / region (right-click + floaters)
- About Land · Region details · Parcel details · Location profile · Set Home here · Sit here · Build here ·
  Edit terrain (Build-tools bulldozer). (LandContextMenu is the entry surface.)

### Profile — others (FEATURE-GAPS L364–374)
- show **profile photo** + all missing fields · connect the 3 icons (map-locate etc.) like Contacts does ·
  connect feasible bottom buttons · **Notes save** · picks tab · classifieds (view).

### My Profile — self
- show real **About** + **Groups** (currently missing) · **Show-in-search** toggle · **Save / Discard** ·
  **edit About** + save · Set Display Name · copy options · change profile image · Add Picks · Add Classifieds ·
  Edit 1st-Life text & image.

### People Floater (NEW — like FS) — folds in AvatarList
- Create/rig PeopleFloater, enable in BottomBar; tabs shared w/ ConversationsFloater:
  Nearby / Friends / Groups / Recent / Blocked / Contact Sets. Move our **AvatarList → the "Nearby" tab**;
  expose via MenuBar **World ▸ Nearby avatars (Ctrl+Shift+A)** and remove its standalone BottomBar item.

### Nearby Chat + system messages — FEATURE-GAPS L227–234
- scrollback persistence · mute names/words filter · options panel (range/channel/font) · search · tear-off
- **System messages**: "Item placed in folder Objects under My Suitcase [date/time]" etc.
- **Grid/script chat**: e.g. "[11:40] Grid: Teleport completed from … You are now at …" (channel 0/1 from scripts).

### IM / Conversations / Groups — FEATURE-GAPS L238–247, L378–386
- toolbar buttons (Mute/Share/Pay/TP-Offer/Add-Friend/Block/Profile) · typing indicator (IIM type 41)
- IM history persistence · voice button (stub until Voice lands)
- **Group messages** · group list from login (AgentGroupDataUpdate) · group info floater · notices ·
  **group title tag** + title toggle.

### Places + Teleport history — FEATURE-GAPS L297–324
- show on map · copy SLurl · view/edit landmark (Title+Notes) · move to Favorites · rename/delete
- date accordion grouping · favorites reorder + HUD strip · plus-btn menu
- **Teleport history**: date/time stamp per entry · Clear-history + remove-single → top settings-icon menu ·
  per-item button should be a **▸ "Show item info"** (= Show place profile) · 3 bottom buttons: Teleport / Map / Profile.

### Map & Minimap — FEATURE-GAPS L328–339
- **Go Home** (home pos is in login response — quick win, L336) · region snapshot tiles (J2C cap)
- MapItemRequest dots · friends layer · CoarseLocationUpdate forward (L337, also fixes neighbor dots)
- remove arbitrary grid lines · map localStorage cache

### Snapshot (NEW)
- A snapshot/screenshotting system similar to FS (save to disk / inventory / postcard?).

### MenuBar (NEW, small)
- MenuBar filter/search is currently a placeholder — make it functional.

### Movement HUD (NEW, small)
- **Stop Flying** button while flying · **Stand Up** button while sitting (better placement than FS?)
- flying-but-idle: FS raises the avatar slightly + gentle bob (no Z-coord change) after tapping F.

### Floaters framework (NEW) — shared FloaterWindow
- **Minimize** button left of the Close X (FS-style).
- **Resize from any of 4 corners/sides** (currently only br corner, behaves weirdly) → then right-align some.
- **Persist last width/height/position per floater** (incl. all 6 inventories) in IndexedDB; guard against
  off-screen on screen-size change (use per-floater reset).

### Preferences (NEW)
- **QuickPrefs Draw-Distance slider** never connected to the Preferences one — sync them.
- **Grid Manager** in the OpenSim tab (add new grids, save locally) like FS.
- **Privacy ▸ Logs & Transcripts** — decide local-save behavior (vs. retain-N-in-chat); is it accessible?

### ✅ Terrain & Environment visuals — SHIPPED 2026-06-29/30 (committed c87854b, f2487cb)
sun-driven directional light + gradient **sky dome** + **day/night cycle** (SimulatorViewerTimeMessage
Low 150) + global exposure ramp + **procedural drifting clouds** + QuickPrefs day/night toggle &
time-of-day override. 4-detail terrain textures were already wired. **FS-like ocean water** (broad
constant ripple bands + broad sun sheen + sharp horizon, sRGB-encode fix for dark custom shaders).
See [[daynight-environment-shipped]], [[water-fs-glint-fresnel-shipped]].
**Deferred:** wind/cloud LayerData (used procedural clouds instead — sim layers are skipped, not decoded);
dusk/night sky palette only roughly tuned (daytime matched to FS hexes); water reflections/SSR = brainstorm-first.

### Trees / plants — FEATURE-GAPS L160–163 (the one remaining Environment follow-on)
- system trees/plants (PCode TREE 15 / GRASS 20) billboard treatment. **Needs a reference read** of the
  OpenSim/libomv tree-species enum + bundled WebP billboards + a branch in the prim-spawn path. Own pass.

---

## 🧠 BRAINSTORM-FIRST (one at a time — do NOT blind-batch)

- **Inventory load-at-scale & cache trust** — small accounts load fine; 50–150k-item accounts often fail / spin
  forever. HMR is one (dev-only) cause but the cache isn't trusted. Need a genuinely FS-like buffer/cache that's
  workable and **never loses items**. Structural — design the load pipeline + IDB cache before touching.
- **2D / mobile mode** — responsive layout already hides the login iframe on mobile; should also hide the canvas
  at phone sizes and **default to 2D**. Build a useful overhead 2D view (Map-like but richer); default for
  mobile/low-end (detect on entry) + a Preferences option for anyone. Learn from speedlight.io.
- **Render/cache ceilings & LOD** — FEATURE-GAPS L11–57; READ `docs/render-cache-model.md` first. Far-field LOD
  is the big heavy-region lever; sub-items interdependent. (Also the render-pipeline visuals: shaders + small
  cache, transparent water, AO, SSR, mirrors, sun/moon + projectors, realtime vs static reflections.)
- **Environment system** — overhead light/sun/shadows · environment default + custom settings · day/night cycle.
- **Avatars (mesh/anim)** — proper mesh body/clothing/attachment positioning · bones + animation (asset &
  default sequences) + gesture-asset sequences · facial expressions / lip movement · **Jellydoll impostors**
  first (then auto for too-complex / no-render avatars; fixes "red cloud") · Animesh + scripted animations.
- **Appearance / baked textures** — full AgentSetAppearance bake pipeline (L118–123, L285–293) — risky, can
  blank avatars. (Unblocks clothing-layer wearables in Inventory.)
- **Voice (WebRTC)** — current `useAudio` is from the older app and needs a rewrite: controls, perms, positional
  (camera pos), visualizer, noise suppression · voice calls · lip sync.
- **Media / audio streaming** — parcel audio + object audio streaming (perms, positional) · media-on-prim
  (dedupe with the existing FEATURE-GAPS media items — juggle detail there vs. here).
- **Money / commerce** — Buy / Buy-for-0 placeholders can ship small (in Build&Edit), but a real
  currency/purchase system is a brainstorm-first lift.
- **Cold-asset throughput** — FEATURE-GAPS L63–80. ✅ *mesh Tier-2 disk cache SHIPPED 2026-06-27* ([[mesh-disk-tier-shipped]]);
  remaining = client mesh-fetch concurrency, the ~5-min cold stall, idle texture backfill (L60).
- **Cross-region / neighbor sims** — adjacent-region draw + child-agent circuits (L214), **neighbor avatar frozen
  at edge** (L418), cross-sim duplicate avatar (L114), cross-region walk handshake (L108).
- **Stale-scene genuine deletes** — hard fullId/interest-filter piece + FS-style **confirmation-gated preseed**
  (don't paint unconfirmed cache entries). L417. (localId-churn dup half DONE — [[fullid-dedup-shipped]].)
- **Var-region 512/1024 correctness** — terrain stride/sampling + clamps (L61, L215, L213).
- **Movement** — springback type-2 (L112), sit-at-corner 1/1 (L106), walk start-over (L107).

---

## 📋 Meta / project hygiene
- **Retire "Phase 3" terminology** — means nothing to users (readme + UI titles/to-dos). Switch to status labels:
  done / partial / in-progress / soon / exploring-longterm / "no plans · can't in browser". Internally the
  phase naming has gotten fuzzy — decide on a referencing scheme or adopt **versioning**.

---

## Recently shipped (don't re-pick)
- **2026-06-30:** Prim face-UV fix (upside-down caps+sides, GEOM_VERSION→4, commit 6ed408d) · alpha-edge
  foliage halo over water fix (waterMesh.renderOrder, commit cba5e84).
- **2026-06-29/30:** Day/Night Environment system (sun-driven sky dome + exposure cycle + clouds + prefs;
  commit c87854b) + FS-like ocean water & sky/cloud color + custom-shader sRGB-encode fix (commit f2487cb).
  Remaining Environment follow-on = tree/plant billboards. See [[daynight-environment-shipped]],
  [[water-fs-glint-fresnel-shipped]].
- **2026-06-28:** Inventory write side committed (create-via-cap, rename/move/trash/perms/attach, subfolder-ingest,
  auto-rename, drag-move) — see [[inventory-write-side-shipped]]; the drag "weirdness" was DevTools device emulation.
- **2026-06-27:** Mesh Tier-2 disk cache · fullId cache dedup + live reconciliation · PrimMesher full-shape port
  (GEOM_VERSION 2) · live object pipeline verified (rez/modify/derez).

---

## ⬇️ Raw inbox (Gene dumps here; Claude triages up into the clusters above)
*(empty — last batch triaged 2026-06-28)*
