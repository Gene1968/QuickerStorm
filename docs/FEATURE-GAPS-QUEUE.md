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

### ✅ Inventory — solidify SHIPPED 2026-07-01 (committed; NOT live-verified)
Full FS-parity pass (5 waves + a dedicated data-loss fix).
- **Reliability / data:** item **move-reconciliation state machine** + folder **dirty-flag** + **non-shrinking
  cache save** → created/moved items survive OpenSim grid write-back lag with **no loss / duplicate / stuck /
  resurrection** (meets the "never lose items" cache-trust bar). Perms decode **all** masks + enrich on the
  **receive** path (fixes NM/NC/NT-until-reload); `itemServerFields` round-trips all masks so rename/perms edits
  no longer relax next-owner/group/everyone.
- **Features:** accept inventory offer (dialog 4/5/6; inline IM Accept/Decline + toast) · give/send inventory
  (Profile + IM drop-zones + Gift/context-menu; transfer-perm gated) · rez object (RezObject Low 293 + CRC;
  context-menu + drag-to-canvas raycast) · double-click **open-by-type** dispatch · **multi-instance texture
  preview** (full-res fetch + true asset dims + aspect-ratio dropdown + auto-open-on-receive + 5/10s throttle) ·
  folder + **mixed** multi-drag · context-menu acts on **full selection** · **Ctrl+X/C/V** (cut=move, copy=
  CopyInventoryItem).
- **Polish:** gear/cog menu FS-parity + **Filters side panel** + sort default = **most recent** + Collapse clears
  search + Item Properties **real checkboxes**. (Start-with-one-open + Gap-C flat-tab right-click/F2 were already
  shipped.)
- **Deferred followups (small, own passes):** sound/animation/gesture preview floaters (need those client
  pipelines) · folder-give (category bucket) · arbitrary-recipient avatar picker · rez-failed toast (no-build
  parcel) · texture-preview auto-open focus-steal + on-screen-nudge persistence (FloaterWindow pos ownership) ·
  FS filter subsets (permission/date/links filters, Empty Trash) · bad/missing-asset resilience (100+ blob 404s;
  mark dead assets, retry/log noise) · "Inspect textures" floater.

### ✅ Inventory — remaining polish SHIPPED 2026-07-02 (uncommitted; NOT live-verified)
Full cluster swept via ultracode workflow (5 impl agents + per-diff FS-parity reviewers; all citations
re-verified against the local FS/OpenSim checkouts, all suites green, staging build green).
- **Take / Take copy** — DeRezObject Take(4)/TakeCopy(1) (values verified vs OpenSim `DeRezAction` +
  FS `EDeRezDestination`); wire contract `OBJECT_TAKE`/`OBJECT_TAKE_COPY` + `takeObject`/`takeObjectCopy`;
  surfaces: ObjectContextMenu (FS pie position) + MenuBar quickerSTORM ▸ Selected objects + Build ▸ Object.
  Take → Objects folder (type 6, zero-UUID fallback → sim routes FromFolderID/Lost&Found); server chunks
  >255-object selections. Multi-select-take-ready server-side.
- **Trash context menu** — FS short menu (Empty Trash / Expand-Collapse / Properties); Empty Trash =
  confirm → `PurgeInventoryDescendents` (Low 285) + authorized local cache shrink (pendingMoves retired,
  purged folders marked FETCHED, IDB folder-cache eviction + immediate snapshot save → no resurrection,
  test-proven); disabled when empty or a worn attachment sits in Trash.
- **Create folder from selected** — live on item+folder menus; FS `new_folder_from_selected` semantics
  (single-common-parent rule, all-items/all-folders gating); routes through existing createFolder + move
  machinery (state machine intact); inline-rename instead of FS's name modal (deliberate).
- **Worn attachment → "Detach from yourself"** — two-source worn tracking (session wear/detach calls +
  AttachItemID NameValue scan of scene ObjectUpdates).
- **Search-clear keeps selection** (re-expands ancestors + scrolls into view; Collapse-All still collapses) ·
  **Del → select next row** (FS getNextUnselectedItem order + keyboard-focus hand-off so repeat-Del works;
  isInTrash no-op guard intact) · **EyeIcon viz dropdown** (shares state with Filters panel) ·
  **single-folder flat list mode** (breadcrumb/back, reuses InventoryFlatRow, persisted `qs_inv_viewmode`).
- **Perms false NM/NC/NT (inbox 🐛)** — shared `_enrichItem()` choke point on EVERY item-row write incl.
  cache load + move-reconciliation re-place; also fixed applyBulkUpdate MIGRATE dropping masks on move acks.
  Needs live verify on receive/move/unbox.
- **Deferred followups (logged, small):** multi-select Del only deletes the focused row (FS deletes the whole
  selection) · list-view rows lack keyboard handlers + drag-source/drop-target · eye menu shows type-visibility
  (FS's is search *scopes*: outfit/trash/library/links) · optimistic worn flag has no rollback on sim reject ·
  worn-in-Trash guard + Empty-Trash enable only see folders fetched this session (no auto-fetch trigger).
- 🧠 **Postponed — need the WEAR/appearance pipeline (brainstorm-first Appearance):** double-click-to-wear ·
  wear · folder-wear · folder "replace current outfit" · **Worn** tab · attachment points · LINK inventory
  type · Find-all-links · Replace-links · **wearing an item doesn't update the Appearance floater**. (All
  gated on AgentSetAppearance bake — see 🧠 Appearance / baked textures below.)

### Drag-drop robustness (NEW 2026-07-02, from the drag-rez/share diagnosis) ⚡ batch-ready
The 2026-07-01 "drag-to-rez/share dead" report predates the 2026-07-02 `copyMove` fix (which was
live-verified working) — the code chain is coherent end-to-end. Real remaining gaps that make drops
LOOK dead, all small:
- **Rez drop raycasts terrain only** (`screenToGround` → terrainMesh, non-recursive) — dropping on a prim
  floor/platform rezzes at ground far below or silently no-ops. Raycast prims too (or FS-style sim raycast:
  rayStart=camera, BypassRaycast=0 + RayTargetID — lltooldraganddrop.cpp:1963-2008); toast on rejected drop.
- **WorldCanvas rez gate rejects silently** — multi-select containing a folder → kind 'mixed' → no
  preventDefault → no-drop cursor with zero feedback. Accept any payload whose anchor resolves to an
  object item; hint when rejected.
- **Give with zero feedback** — giveInventory skips unfound/no-transfer items silently when nothing sends;
  ProfileFloater onGiveDrop returns silently on missing targetId. Toast the nothing-sent case.
- **Add `@dragenter.prevent`** to the three drop zones (WorldCanvas / Profile / Conversations) — Chrome
  tolerates dragover-only; stricter engines may not.
- If drag "deadness" recurs in Chrome: check DevTools device emulation first (known Chromium DnD
  hit-test bug, already bitten twice) and stale Bun/Vite processes.

### Object Build & Edit Floater — FEATURE-GAPS L170–186
- edit name & description · numeric size/pos/rot input fields (fields editable → modify selected) · Select-Face radio
- texture drag-drop onto faces · Normal/Specular channels (RenderMaterials cap) · sculpt-texture assign
- Link/Unlink prims · Link-number ordering bug (L183) · **create/rez a prim in-world** (Build-tools)
- **🐛 creator/owner names still not resolving** in the floater
- **⚡ ObjectProperties-data BATCH (2026-07-03, from Gene — one pass, shared data plumbing):** all of
  these are fed by getting per-object ObjectProperties/linkset data (ownerId, creatorId, perm masks,
  link order) into worldStore on select:
  · **Take / Take copy perm gating** — grey out when the sim would refuse (FS enable_take)
  · **🐛 creator/owner names** (line above)
  · **Link-number ordering bug (L183)** — match FS linkset child-prim link #s order
  · **FS perms-checkbox TRI-STATE** — FS's Edit-floater perm checkboxes have a third look (faded /
    different-color check, independent of enabled) = the linkset's prims/contents DISAGREE on that bit
    ("mixed"/tentative state). Gene reads our missing tri-state as a clue that perms bits are being
    folded/lost somewhere on our side — reproduce FS's per-bit aggregate before painting checkboxes.
  · **🐛 rezzed copies often LOSE perms vs the inventory item** — suspect our REZ_OBJECT perm-mask
    round-trip (client sends all five masks; verify against FS RezObject packing + what the rezzed
    object reports) — investigate in this batch while the mask plumbing is open.
  NOTE: Gene reworked **ObjectEditFloater layout** (2026-07-03) toward the editable-fields end state —
  build the "numeric size/pos/rot editable fields" task ON his layout, don't restructure it.
  **✅ ACTUAL "no response" root cause FIXED 2026-07-03**: DeRezObject must reference the linkset **ROOT**
  prim — OpenSim silently `continue`s on child-prim ids BEFORE any perm check (Scene.Inventory.cs:2258-2260)
  and FS always sends the root via selection. We sent the CLICKED prim → every multi-prim build no-op'd
  (18/20; the 2 single-prim ones worked). Fix = `linksetRootLocalId()` resolver in useLLUDP
  takeObject/takeObjectCopy/sendDelete (also fixes latent linkset-DELETE no-op). Perm refusals, when they
  DO happen, are still silent upstream (PermissionsModule.cs:2019 alert commented out; take-copy of
  others' objects needs everyone Copy+Transfer folded over every prim + contents, :1045/:2017/:2023) —
  covered by the 10s **take-watchdog** toast (useTakeWatch.js).
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

- **Inventory load-at-scale (large accounts)** — the **"never loses items" cache-trust bar is now MET**
  (2026-07-01 move-reconciliation state machine + non-shrinking cache save; see ✅ Inventory — solidify above).
  REMAINING is throughput, not correctness: 50–150k-item accounts still often spin/fail on the **initial full
  walk** (HMR is one dev-only cause). Design the load pipeline (paced walk + trusted incremental cache) before touching.
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
- **🐛 Fix the pre-existing broken tests / errors (STOP saying "not my bug")** — Gene's rule: don't keep waving
  off known-red tests. Schedule a hygiene pass: (a) **ESLint flat-config** so `npm run lint` runs repo-wide again;
  (b) the ~22 `src/__tests__/lib/*` + `utils/*` suites that FAIL TO COLLECT under vitest because they
  `import from 'bun:test'` (either move them to run under `bun test`, or make them vitest-compatible) so the vitest
  run is actually green; (c) `useTeleport.test.js` (5 fails: Pinia-not-active setup + stale `TELEPORT_SOURCES`
  status/coord-clamp assertions — code moved, test didn't). Green baseline = we stop hand-waving failures.
- **Retire "Phase 3" terminology** — means nothing to users (readme + UI titles/to-dos). Switch to status labels:
  done / partial / in-progress / soon / exploring-longterm / "no plans · can't in browser". Internally the
  phase naming has gotten fuzzy — decide on a referencing scheme or adopt **versioning**.

---

## Recently shipped (don't re-pick)
- **2026-07-02 eve (uncommitted):** Post-live-test follow-ups — (1) **Take Copy "no response" root-caused**:
  OpenSim refuses take-copy without the everyone-copy bit ("full perm" = next-owner perms, not everyone);
  refusals arrived as **AlertMessage (Low 134) we dropped** → now decoded + surfaced as toast + "Grid:"
  nearby-chat line (also catches every future sim refusal/notice). GAP queued: grey out Take/Take copy
  client-side (needs per-object owner/perms in worldStore from ObjectProperties — same data as the
  creator/owner-names bug). (2) **Trash-row context menu** = FS Purge Item / Restore Item
  (llinventorybridge.cpp:1151-1169; restore → asset-type default folder via move machinery; folder purge =
  PurgeInventoryDescendents + new INV_REMOVE_FOLDER; worn-gate on purge). (3) **EyeIcon menu redone as FS
  search-visibility scopes** (Search outfit folders / Trash / Library; type-checkbox duplicate removed;
  Include-links omitted until links exist). (4) **Recent + Worn tabs are TREES** (FS filtered
  inventory-panel style, via new InventoryScopedTree shadowed-invFilter wrapper; view-mode "list" keeps the
  old flat rows). NOTE: two subagents were killed mid-flight by the org spend limit — their partial work
  (eye scopes, purgeItem) landed in d3f950e and was completed by hand.
- **2026-07-02 pm (uncommitted, NOT live-verified):** Inventory remaining-polish ultracode sweep — Take/Take
  copy (all surfaces + wire contract) · Trash menu + Empty Trash (purge + authorized cache shrink) · create
  folder from selected · worn→Detach · search-clear keeps selection · Del→select-next (with focus hand-off) ·
  eye viz dropdown · single-folder list mode · shared `_enrichItem()` perms fix · drag-rez/share diagnosis
  (stale report; robustness cluster filed). ~30 new tests; per-diff FS-parity reviews.
- **2026-07-02 (committed):** Inventory-share + object-delete + ghost-reconcile session — (1) **perms NM/NC/NT**
  fixed: OpenSim EQ BulkUpdate sends masks as base64 `<binary>`, decoded to 0 → received/moved items showed
  no-perms; now base64-decoded (`fix(inv): decode base64 perm masks in EQ ack`). (2) **drag rez + give** worked:
  drag source `effectAllowed='move'` vs drop-zone `dropEffect='copy'` spec-blocked the drop → `copyMove`.
  (3) **share notifications** FS-parity: "Items successfully shared." on send + "[recipient] received your
  inventory offer." on OpenSim dialog-5 ack (ack carries giver's name → recipient resolved from give record).
  (4) **folder-share** shipped: multi-entry bucket `[AT_FOLDER][folderUUID]+[assetType][itemUUID]` per direct
  item; OpenSim copies subfolders server-side. (5) **rez sound** (`rezz.mp3`). (6) **object delete** fixed:
  OpenSim ignores `ObjectDelete` (Low 89) → switched to `DeRezObject` (Low 291, Destination=Delete→Trash) +
  wired MenuBar delete (MenuDropdownItem `disabled` now accepts a function). (7) **duplicate IM/offer toasts**
  fixed: socket `on(type,cb,key)` keyed-dedup stops HMR/remount handler stacking. (8) **ghost objects after
  delete** SHIPPED (built the approved 2026-06-27 stale-scene design — LIVE-VERIFIED 151 ghosts culled,
  permanent). See [[ghost-reconcile-shipped]], [[inventory-share-perms-fixes-2026-07-02]].
- **2026-07-01 (follow-up):** texture-preview KEY fix — `openTexturePreview(assetId,name,desc,key)`; the desc arg
  had shifted into the key slot so different textures with same/empty desc collided → "focus existing" instead of
  a new floater (Gene's report). Also wired the context-menu **Open** → open-by-type dispatch (was disabled).
- **2026-07-01:** **Inventory FS-parity program committed** — accept-offer · give · rez · open-by-type ·
  multi-instance full-res texture preview (aspect dropdown + auto-open + 5/10s throttle) · perms all-masks +
  receive-path enrich · folder+mixed multi-drag · ctx-menu multi-select · Ctrl+X/C/V · gear menu + Filters panel +
  sort-default-recent + collapse-clears-search · Properties checkboxes · **item data-loss fix** (move-reconciliation
  state machine + non-shrinking cache save — created/moved items survive write-back lag, no loss/dup/stuck).
  NOT live-verified. See [[inventory-dataloss-rootcause]], [[inventory-fs-parity-gaps-2026-06-30]].
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

**2026-07-01 dump (from Gene — file for when we reach each feature/fix):**
- ✅ **Perms false NM/NC/NT** — ADDRESSED 2026-07-02 sweep: shared `_enrichItem()` on every insert path
  (incl. move-reconciliation re-place + cache load + BulkUpdate MIGRATE mask-drop fix). Live-verify on
  receive/move; the UNBOX path (Xfer object-contents) is still unbuilt — re-check when Open-box ships.
- ✅ **Drag-to-REZZ / drag-to-SHARE "dead"** — DIAGNOSED 2026-07-02: the report predates the same-day
  `copyMove` fix (live-verified working after). Chain is coherent; real silent-failure gaps promoted to the
  **Drag-drop robustness** cluster above. If it recurs: DevTools emulation / stale Bun/Vite first.
- **🐛 GHOST objects persist after delete** — as a FS user rezzes/deletes his own objects, ghosts stay in our
  object cache even after a HARD reload. Selectable but show NO name/desc/etc → that's the tell for "not real."
  FS confirms deletion / polls for realness somehow (KillObject we may be missing, or a RequestObjectProperties
  "~check" — no reply = stale → cull). Add a context-menu re-check / cull-unconfirmed. → 🧠 Stale-scene genuine
  deletes (brainstorm-first) — this is the confirmation-gated piece.
- **Should be able to RIGHT-CLICK → Open a box** (open object contents / Xfer) → Right-click menus (object) +
  Object Build&Edit.
- **Create tool NEEDED soon** (rez/create a prim in-world) → Object Build & Edit (Build-tools).
- **Working GIZMO handles NEEDED soon** (move/rotate/scale/copy) → Object Build & Edit.
- **Scripted motion**: some works now, some doesn't — investigate which ObjectUpdate/TerseUpdate motion paths we
  handle vs miss. **Scripted texture pos/anim** (TextureAnim: moving water, scrolling text, cell-anim) would help
  tie it together → Object Build & Edit (texture anim/scripts).
- **Neighboring regions** should be prioritized, THEN crossings → 🧠 Cross-region / neighbor sims (bump priority).
- **More SOUND** — UI sounds + media (parcel/object audio) → Media/audio streaming + UI sounds.

*(Triaged pointers above; promote into clusters when a sweep targets them.)*
