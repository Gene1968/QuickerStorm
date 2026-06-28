# Feature Gaps — Batch Queue (working front door)

> **This is the curated working surface.** The full detail/history lives in [FEATURE-GAPS.md](FEATURE-GAPS.md)
> (large — treat it as the archive; line refs below point into it). Add new gaps to FEATURE-GAPS.md as
> usual, then promote the actionable ones up here.

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

### ✅ Inventory actions (write side) — SHIPPED 2026-06-27 (workflow sweep; LIVE-VERIFIED)
rename (F2/menu) · delete→Trash · change permissions · wear/attach (objects) · detach · localStorage cache flush.
Encoders+handlers in lludp-codec.ts/lludp.ts, optimistic store + composable wires. Live-verified osgrid
(folder+item rename/trash/create). Fixed live: item rename sent OLD name. **Deferred:** generic create-item
(asset-upload cap), clothing-layer wearables (bake pipeline). Inline thumbnails REMOVED (traffic — see polish below).

### 🔧 Inventory polish — Gene feedback 2026-06-27 (BATCH-READY where small; some need design)
- **✅ Folder-create via CreateInventoryCategory cap — SHIPPED 2026-06-28.** Was UDP fire-and-forget (didn't
  persist). Now server `handleCreateFolder` posts the LLSD cap (folder_id/parent_id/name/type, ported from
  OpenSim BunchOfCaps.cs); OpenSim re-reads the folder before 200 = persisted. Plus `decodeInvFolders` now
  ingests `categories` (subfolders) so the tree self-heals from live fetches (the login skeleton alone misses
  fresh folders). Cap-first router + UDP fallback; confirm/revert client listeners; auto-rename-on-create
  (FS-style — new folder opens in inline-rename). VERIFIED: folder 7d20a3e2 (cap-created) persists across many
  reloads + reappears via subfolder-ingest.
- **🐛 OpenSim write-back LAG on fresh folders** — a cap-created folder returns 200 (it's in the region
  inventory CACHE — GetFolder passes) but the flush to the grid Robust DB lags. A page reload isn't a clean
  LogoutRequest, so nothing forces the flush → reloading minutes after creation re-fetches from Robust before
  the write lands and the folder is GONE. Evidence (osgrid): 16-min-old folder persists; 6-min & 2-min ones
  vanished (rename irrelevant — a never-renamed one also vanished). OpenSim-side, not a viewer bug. OPTIONS:
  (a) send LogoutRequest on page unload to force a flush; (b) confirm self-heal after the grid's periodic
  write-back (wait ~10min / next-day check); (c) persist created folders in the client IDB cache so they
  survive client reloads + reconcile when the grid catches up.
- **✅ Drag-move — RESOLVED 2026-06-28.** The "weirdness" (highlight offset from cursor, drops missing) was
  **Chrome DevTools device emulation** breaking native HTML5 DnD hit-testing (Chromium doesn't apply the
  emulation scale to drag coords). Works correctly with emulation OFF — verified live. Code is sound:
  shared store drag-state (inventoryStore.dragPayload), and item rows are now drop zones into their parent
  folder (whole folder region is a target, not the 1-line row) with a hover highlight. Move protocol proven
  (= trash path). NOTE for future: if dragging-under-emulation matters for dev, reimplement on Pointer Events
  (SortableJS/dnd-kit style) — pointer coords ARE scaled by emulation; native DnD isn't.
- **Texture preview (replaces inline thumbnails)** — FS model: 256² floating preview on **hover after a short
  delay**, fetched on-demand (not per-row auto-fetch — Gene has 24k textures = traffic; also bad/missing
  assets on this grid = the 100+ blob 404s). Plus **double-click texture → full-size preview floater**
  (port FS `floater_preview_texture.xml`). useInventoryThumbnail.js already exists to build on.
- **Double-click sound → play locally** (and define double-click "open" semantics per asset type generally).
- **"Drop inventory item here" → give item to agent** — the share drop-zone already renders in the Profile
  floater (+ IM); wire it to the transfer-to-agent path (relates to Inventory "Transfer/drop to another agent").
- **Recent / Worn tabs render flat, not as a tree** — Gene expects a tree; also the flat tabs lack right-click/F2
  (= Gap C). Decide: give flat tabs the tree component, or wire the row handlers into the flat list.
- **Bad/missing-asset resilience** — 100+ blob 404s on this grid; cap retries/log noise, mark dead assets.
- ☐ Gene has more notes to add here — co-triage.

### Object Build & Edit Floater — FEATURE-GAPS L170–186
- edit name & description · numeric size/pos/rot input fields · Select-Face radio
- texture drag-drop onto faces · Normal/Specular channels (RenderMaterials cap) · sculpt-texture assign
- Link/Unlink prims · Link-number ordering bug (L183) · create new prim in-world

### Object Build & Edit Floater — FEATURE-GAPS L170–186
- edit name & description · numeric size/pos/rot input fields · Select-Face radio
- texture drag-drop onto faces · Normal/Specular channels (RenderMaterials cap) · sculpt-texture assign
- Link/Unlink prims · Link-number ordering bug (L183) · create new prim in-world

### Right-click menus (object + avatar) — FEATURE-GAPS L190–207
- avatar: zoom-to · inspect (appearance) · invite to group · save outfit · self menu (Sit/Stand/Fly)
- object: sit-on-object (SitOnObject + RequestObjectPropertiesFamily) · buy/pay · open contents (Xfer)

### Nearby Chat polish — FEATURE-GAPS L227–234
- scrollback persistence · mute names/words filter · options panel (range/channel/font) · search · tear-off

### IM / Conversations — FEATURE-GAPS L238–247
- toolbar buttons (Mute/Share/Pay/TP-Offer/Add-Friend/Block/Profile) · typing indicator (IIM type 41)
- IM history persistence · voice button (stub until Voice lands)

### Places Floater — FEATURE-GAPS L297–324
- show on map · copy SLurl · view/edit landmark (Title+Notes) · move to Favorites · rename/delete
- date accordion grouping · favorites reorder + HUD strip · plus-btn menu

### Profile — FEATURE-GAPS L364–374
- edit own fields (about/first-life/web/languages) · picks tab · classifieds (view) · notes on others

### Map & Minimap — FEATURE-GAPS L328–339
- **Go Home** (home pos is in login response — quick win, L336) · region snapshot tiles (J2C cap)
- MapItemRequest dots · friends layer · CoarseLocationUpdate forward (L337, also fixes neighbor dots)
- remove arbitrary grid lines · map localStorage cache

### Terrain & Environment visuals — FEATURE-GAPS L211–223
- sun/moon directional light · sky gradient · day/night cycle · 4 detail terrain textures (corner-blend)
- wind/cloud LayerData consumers (already decoded) · (water reflections/shadows = bigger, defer)

### Groups & Group IM — FEATURE-GAPS L378–386
- group list from login (AgentGroupDataUpdate) · group info floater · group IM · notices · title toggle

### Trees / plants — FEATURE-GAPS L160–163
- system trees/plants (PCode 0x01/0x04) billboard or fixed-geometry treatment

---

## 🧠 BRAINSTORM-FIRST (one at a time — do NOT blind-batch)

- **Render/cache ceilings & LOD** — FEATURE-GAPS L11–57; READ `docs/render-cache-model.md` first. The far-field
  LOD work is the big remaining heavy-region lever. Many sub-items are interdependent.
- **Cold-asset throughput** — FEATURE-GAPS L63–80. ✅ *mesh Tier-2 disk cache SHIPPED 2026-06-27* ([[mesh-disk-tier-shipped]]);
  remaining = client mesh-fetch concurrency, the ~5-min cold stall, idle texture backfill (L60).
- **Cross-region / neighbor sims** — adjacent-region draw + child-agent circuits (L214), **neighbor avatar frozen
  at edge** (L418, avatar-side of the same work), cross-sim duplicate avatar (L114), cross-region walk handshake (L108).
- **Stale-scene genuine deletes** — the hard fullId/interest-filter piece + FS-style **confirmation-gated preseed**
  (don't paint unconfirmed cache entries). L417. (localId-churn dup half is DONE — [[fullid-dedup-shipped]].)
- **Var-region 512/1024 correctness** — terrain stride/sampling + clamps (L61, L215, L213).
- **Movement** — springback type-2 (L112), sit-at-corner 1/1 (L106), walk start-over (L107).
- **Appearance / baked textures** — full AgentSetAppearance bake pipeline (L118–123, L285–293) — risky, can blank avatars.

---

## Recently shipped (2026-06-27, this session — for reference, don't re-pick)
- Mesh Tier-2 disk cache (committed) · fullId cache dedup + live reconciliation (committed) ·
  PrimMesher full-shape port (committed, GEOM_VERSION 2) · live object pipeline verified (rez/modify/derez).


---

## Hey Claude, keep taking the new items I add from here, and triage/batch them properly above where it makes sense.  Is feature-gaps.md now for the items we're not ready to batch, and bugs too?  Group features & details and try to avoid duplication:

Profile - show profile photo and all other missing info.  The 3 icons like "Friend can locate you on the map" are not connected like they are in Contacts.  A few bottom buttons can probably be connected now.   Make sure Notes can be saved, as well as self profile?

My Profile - is not showing my actual About or Groups.  Is missing [ ] Show in search, Save, Discard, ability to edit About.  Set Display Name, copy options, change profile image, Add Picks, Add Classifieds, Edit 1st Life text & image.

Add 'Inspect textures!' item/floater per FS code.

A "Snapshot" screenshotting system similar to FS.

Create and rig up the missing PeopleFloater like FS, enable in BottomBar, shares some of its tabs with ConversationsFloater "Nearby/Friends/Groups/Recent/Blocked/Contact Sets".  Our AvatarList should be moved here as the "Nearby" tab - MenuBar 'World/Nearby avatars' Ctrl+Shift+A and remove its BottomBar item.

MenuBar filter/search is a placeholder.

About land, Region details, Parcel details, Location profile?, Set Home here, Sit here, Build (here), Edit terrain (here)(Build tools bulldozer)

bigger feat:  Responsive layout now hides login iframe on mobile and should also hide canvas at phone sizes and default to 2D.
2D feature needs to be explored and made to work correctly like an overhead view (similar to Map) but more useful - make it the default for mobile screens and low-end if we can detect that on entry, but make it a preferences option for anyone.  Let's discuss learning what we can from speedlight.io.

QuickPrefs Draw Distance slider as never connected to match the one in Preferences?

Preferences - Add the Grid Manager in OpenSim tab like FS allowing users to add new grids, save locally.

FS Preferences Privacy Logs & Transcripts - does this save locally?  Is it accessible or does it just retain some amount in each chat?

Groups messages

System messages like "The item was placed in folder Objects under My Suitcase [date/time]"

Nearby Chat (sys?) messages such as '[11:40] Grid: Teleport completed from … You are now at …' or others (channel 0 or channel 1?) coming from scripts etc.

Accept inventory offer

Inventory - lately I'm testing on a small account with little inventory.  On the other 2 accounts with 50-150k items it would more often fail to load, spin forever.  HMR is one cause of that that won't impact real users, but I still don't trust it.  Do we really have a solid FS-like way to buffer/cache that so it's workable and won't lose anything?

In inventory no need to show '(empty)' below an open empty folder. If you double-click an animation it should open the 'Play inworld / Play locally" (see floater_preview_animation.xml).  Gestures should open their editor (floater_preview_gesture.xml).

Build&Edit floater - we're still not resolving creating/owner names?!

While Edit floater is open, can drag to select multiple objects

Edit gizmo handles should work to adjust position, rotation, scale, copy.

Build tools rezz a prim.

Build/Edit fields editable to modify selected object.

Are we able to decode "Not for sale" yet and show it in the ObjectEditFloater?  If/when we can then we should be more selective about showing the buy pointer.  It must actually be for sale.  'Click to Buy object' doesn't work without that.

Should be able to implement Buy for 0 (and 'You don't have enough…', maybe placeholders for actual purchase/currency), whether we're ready for the full monetary system yet

Texture anim/scripts - moving water, text, "cell animation," etc.

Group title tag

When flying show a "Stop Flying" button.  Better location than FS?
When sitting show a "Stand Up" button
When flying but not moving (such as after tapping F key) in FS avatar raises up slightly and then lightly bobs up and down a bit (doesn't affect Z coord reading).

Teleport history should have date/time stamp.  Clear history and remove from history [single] are supposed to go in the top settings icon buttons along with some other items.  TP button per item should actually be a rt-arrow button title="Show item info" which seems to take you to the same place as "Show place profile".  Three buttons along bottom - Teleport/Map/Profile.

Floaters template can have a Minimize button left of the Close X like FS does.
Floaters - drag any of 4 corners or sides?  If so then I'll go back to right-aligning some.  Those resized very weirdly by just the br corner.
Floaters - last width height and position of each floater (inc 6 inventories) for the user (but make sure none are cut off when noticing screen size has changed, use the individual reset if needed?).  indexedDB?

Animesh, scripts, scripted animations

Overhead light source, sun, shadows
shaders (& small cache), transparent water, ambient occlusion?, screen space reflections?, mirrors?, sun/moon + projectors, reflection realtime or static/dynamic??, reflection full scene??
environment default settings
day/night cycle
environment custom settings

Jellydoll imposter avatars first, and later just when other users' avatars are too complex (or no-render is set on either side).  https://releasenotes.secondlife.com/viewer/6.4.13.555567.html
Red cloud? - Jellydoll seems like better handling for this.
Proper avatar, positioning of mesh body parts & clothing & attachments
Avatar movement.  Bones.  Animation (assets & defaults) sequences.  Gesture assets sequences.
Facial expressions, lip movement.

Voice via WebRTC (our current useAudio is from older app and it's time to fix it), audio controls, perms, from camera position, voice visualizer, noise suppression?
Voice calls.
Voice lip sync?

Parcel Audio streaming, object audio streaming, perms, from camera position
Media-on-prim - we had these items in feature-gaps so maybe dedupe and juggle the right amount of details here and there as we queue.

"Phase 3" means nothing to users in the readme and in the UI/titles/to-dos.  Update readme to just show done, partial, in-progress, soon, and either exploring/longterm/later, and 'no plans / can't in browser'?  For our own references in code and docs it's also gotten broad and fuzzy since I was trying to avoid pushing usable wins to a phase 4.  Better idea how to reference things or if we're ready to start using versioning?

