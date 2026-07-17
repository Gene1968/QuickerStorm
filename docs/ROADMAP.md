# quickerSTORM — Roadmap (what's left)

> **This is the only planning file.** It lists **open work only**, grouped into area-complete bundles.
> When something ships, its writeup moves to [`CHANGELOG.md`](CHANGELOG.md) and the line here is deleted
> (not checkmarked in place — that's what bloated the old docs).
> Full pre-2026-07-14 history is frozen in [`archive/`](archive/) (the old `FEATURE-GAPS*.md`, closed).
>
> **Replaces "Phase 3."** Progress is tracked by **status label per bundle** + **milestone version**. There is
> no "Phase N" anymore — it meant nothing to users.

## Status labels

| | Meaning |
|---|---|
| ✅ | **done** — works in the app; you can use it |
| 🟡 | **partial** — usable, but named gaps remain |
| 🔨 | **in-progress** — actively being built this stretch |
| 🔜 | **soon** — queued, not started, no blocker |
| 🔭 | **exploring** — brainstorm-first / risky / long-term (do NOT blind-batch) |
| 🚫 | **can't-in-browser** — infeasible or out of scope for a web viewer |

**On "done":** if it's in the running app and you can use it, it's ✅ **done** — your use *is* the verification.
Paths I built but haven't driven end-to-end go on the **[Test-debt list](#test-debt-my-side-not-a-feature-status)**
at the bottom — that's *my* bookkeeping, it never parks a bundle in limbo or drags its %. No more
"pending live-verify" as a feature status.

---

## Milestones toward public beta

| Version | Name | The bar it clears |
|---|---|---|
| **v0.3** | *(today)* | Solo/small-group exploration on a grid you point it at. Robot-tube avatars. |
| **v0.4** | **Beta-1 — usable social sandbox** | Safe to hand to outside testers: avatars don't look broken (jellydoll + positioned attachments + wear works), the build/inventory/chat/social loop is solid, and it's **publicly hosted**. |
| **v0.5** | **Beta-2 — richer world** | Voice, groups, appearance bake, media / web-on-prim, neighboring sims. |
| **v0.6 → v1.0** | **depth & polish** | PBR materials, scripting behaviors, LOD & heavy-region scale, cross-region *walk*, mobile 2D. |

**The single biggest Beta-1 blocker is avatars** (bundle 7, ~15%). Everything else on the social loop is
already 🟡. Voice / groups / media are deliberately **Beta-2**, not Beta-1.

---

## Completion — the honest number

Weighted by how much each bundle matters to "a usable general-purpose viewer" (not by line count — a
one-line fix ≠ Voice). **Headline: ~53% of a complete viewer.** (The old README's "Phase 3 ~75%" measured
only the asset-pipeline slice, not the whole product.)

| Bundle | Weight | % | Milestone |
|---|--:|--:|---|
| 1. World & Movement | 10 | 85 | v0.4 |
| 2. Rendering: Prims & Mesh | 10 | 78 | v0.4 |
| 3. Rendering: Environment | 5 | 65 | v0.5 |
| 4. Object Build & Edit | 7 | 50 | v0.4 |
| 5. Object Interaction & Contents | 6 | 72 | v0.4 |
| 6. Inventory | 9 | 75 | v0.4 |
| 7. Avatars & Appearance | 10 | 15 | v0.4/v0.5 |
| 8. Chat & IM | 7 | 70 | v0.4 |
| 9. Groups & Group IM | 4 | 8 | v0.5 |
| 10. Friends & Profile | 5 | 62 | v0.4 |
| 11. Places, Map & Minimap | 5 | 68 | v0.4 |
| 12. Voice | 5 | 8 | v0.5 |
| 13. Media & Audio | 5 | 45 | v0.5 |
| 14. Scripting behaviors | 2 | 10 | v0.6 |
| 15. Cross-region / neighbor sims | 4 | 15 | v0.5 |
| 16. Performance & Scale (infra) | 6 | 70 | ongoing |
| 17. UI / Floaters / Preferences | 5 | 55 | v0.4 |
| 18. Beta hosting / 2D-mobile | 5 | 12 | v0.4 |
| **Weighted total** | **110** | **~53%** | |

> Weights are editable — if you disagree that (say) Voice is a 5 or Avatars a 10, change them and the headline
> re-rolls. The point is one transparent number, not a vibe.

---

## The bundles

Each bundle is an *area to finish*, not a slice. Open items only; follow-ups folded into their home bundle.

### 1. World & Movement — 🟡 ~85% · v0.4
- 🔭 Sit-on-object lands avatar at region corner 1/1 — client must parent avatar mesh to seat & render sit offset relative (packets verified correct; client rendering gap). *Blocks full sit visual.*
- 🟡 Springback type-1 & type-2 — client-predict vs sim snap-back, coupled to floor-drop under load; recurs.
- 🔭 Cross-region boundary **walk** — DisableSimulator + new UseCircuitCode handshake not wired (see bundle 15). → v0.5
- 🟡 Walk "start-over" reset mid-walk in busy areas (late-obstacle race).
- 🟡 Collision robustness — residual standard-256 drop-through to re-confirm; own-avatar live pos not in worldStore (`avatarPos` empty → weak reconciliation).

### 2. Rendering: Prims & Mesh — 🟡 ~78% · v0.4
- 🔜 Prim tessellation **LOD** (sides/steps fixed at High=24; no screen-size reduction; high-rev torus ~4.6k tris).
- 🔜 Mesh **LOD** selection (always highest submesh; select by screen-space size).
- 🟡 Per-face materials on hollow/cut **interior faces** (PrimMesher face numbering ≠ SL TE indices there).
- 🟡 Delivery variance — occasional missing prims on heavy regions.
- 🔜 Object **hover info tip** (FS-style: name, owner, phantom, prims/LI, pos, dist after ~1–3 s; cache it).
- 🔜 Linkset root-name in hover/selection.
- 🔭 Rigged / skinned mesh (SkinWeights + JointNames bind pose) — shares the skeleton work in bundle 7.

### 3. Rendering: Environment — 🟡 ~65% · v0.5
- 🔜 System **trees & plants** (PCode TREE 15 / GRASS 20) — billboard/fixed-geometry treatment; needs species-enum + WebP billboards read. *(The last Environment follow-on.)*
- 🔭 Water reflections / SSR · shadows · sun-moon projectors — brainstorm-first (render-pipeline visuals).
- 🔜 Wind-field & cloud-layer visual consumers (LayerData 0x57/0x43 decoded, no renderer; we use procedural clouds now).
- 🟡 Dusk/night sky palette only roughly tuned.
- 🔜 4-detail terrain corner-blend shader polish.

### 4. Object Build & Edit — 🟡 ~50% · v0.4
Big floater. Create-prim / gizmo drag / link-unlink / texture-drop / numeric pos-size-rot / prim-shape params
all ✅. Remaining (most machinery already built this cycle — thin wires):
- 🔜 **B-1 quick wins:** Select-Face radio · Copy / Rotate-copy / shift-drag-copy (ObjectDuplicate wired, no callers) · xform copy/paste buttons · Stretch-both-sides · Show-highlight toggle.
- 🔜 **B-2 Texture-tab write side:** repeats/offsets/rotation spinners · Mapping select · default-texture pickers (all one `setObjectTexture()` away; biggest bang-for-buck).
- 🔜 **B-3 Edit-tool options:** grid snap · stretch-textures · edit-axis-at-root · Align tool.
- 🔜 **B-4 Focus/Move tools:** camera Zoom/Orbit/Pan radios + zoom slider · object grab-move without gizmo (ObjectGrab in template, undecoded).
- 🔜 **B-5 Features/physics tab:** Flexible / Light / Animated-mesh / Reflection-probe / Dynamic (read decodes exist; write = ObjectExtraParams Low 99 encoder).
- 🔨 **Normal / Specular / PBR materials** — RenderMaterials cap infra exists, not consuming yet ("PBR not seen"). Needs a materials encoder + shader path.
- 🔜 Sculpt-texture assignment.
- 🔜 8 corner scale handles (grey) in addition to 6 gizmo faces.
- 🔜 Alt-hold → temp Focus tool; focus slider bound to per-focus zoom range.
- 🟡 Link-number ordering (L183) — compare child link #s vs FS on the 154-prim linkset; decode `ObjectProperties.LinkNumber` (U32) instead of LocalID sort.
- 🔜 Unlink ≥N confirm dialog (FS ConfirmUnlink).
- Land tab → bundle 11 (Parcel). Media tab → bundle 13.

### 5. Object Interaction & Contents — 🟡 ~72% · v0.4
Right-click menus (sit/stand/fly/zoom/take/buy/pay/invite/inspect), take/take-copy perm gating, object
contents (Xfer → task-inv → Open) all ✅. Remaining:
- 🔜 Object contents as a **drag-and-drop inv tree** in the Edit floater (FS treats it as one folder).
- 🔜 **Drag an inventory item (script/notecard/texture/object) onto a prim** → drop into the prim's TASK
  inventory (RezScript Low + UpdateTaskInventory write side; ScenePresence perms). Pairs with the DnD inv
  tree above. (2026-07-15 — can't drag a script onto a prim yet.)
- 🔜 Per-item contents context menu (Open / Properties / Rename / Delete) + New Script / Edit (needs script editor, bundle 14).
- 🟡 Buy/Pay are real but **no-op on stock OpenSim** (no money module) — needs 🔭 currency system for anything beyond L$0.
- 🔜 ClickAction OPEN(4) non-destructive open (our task-inv "Open" copies immediately — wrong for left-click).
- 🔜 Sit camera eye/at offsets + own-avatar sit rotation (full sit pose gated on bundle 7).

### 6. Inventory — 🟡 ~75% · v0.4
Browse / filter / rename / move / trash / perms / rez / give / accept-offer / take / copy / multi-select /
texture-preview / data-loss-proof cache all ✅. Remaining:
- 🔨 **Create new item** (notecard / script / clothing) — **needs the asset-upload cap** (see [Caps still needed](#caps-still-needed)). Landmark create already works.
- 🔜 **Folder deep-copy** (recursive category copy / `copy_inventory_category` cap) — item-copy works, folder-copy disabled.
- 🔜 **Give a whole folder** (folder-bucket encode + walk contents) + arbitrary-recipient **avatar picker** for give.
- 🟡 Preview by type: **sound** = double-click plays it (shipped 2026-07-15). Still 🔜: **animation** (.anim BVH playback) + **gesture** (step interpreter) previews, and a fuller sound preview *floater* (Play/Stop/loop) vs the current play-once.
- 🔜 Find/filter duplicate UUIDs · FS filter subsets (permission/date/links) · list-view keyboard + drag.
- 🔭 **Inventory load-at-scale** (50–150k accounts still spin on the initial full walk) — correctness bar is met; this is throughput. Design the paced walk + trusted incremental cache first.
- 🔜 Wear clothing-layer wearables → gated on bundle 7 (bake).

### 7. Avatars & Appearance — 🟡 ~30% · v0.4 (jellydoll/attachments) → v0.5 (bake) · **#1 beta blocker**
Today: per-UUID jellydoll capsule + tube placeholder; AvatarAppearance decoded (bakes cached, not composited); **rigged mesh now skins to the avatar at rest pose (AV-1)** and **faces correctly (+X-forward reconcile)** — but only single rigged meshes place cleanly; linkset child prims scatter, no cohesive body placeholder yet. No animation.
Staged (from the 2026-07-04 scout):
- ✅ **AV-1 rigged-mesh rest-pose skinning** — shipped 2026-07-17, live-confirmed. Server decodes the mesh skin block (bind_shape + inverse_bind + per-vertex Weights) + bundles the SL default skeleton (bones **and** collision volumes, for fitted/"Liquid" mesh) and bakes REST-POSE skinned positions; client places the mesh at the avatar root (`RIG_FOOT_OFFSET`). Single rigged meshes (pants/shoe/hair/body) render correctly on the avatar. (→ CHANGELOG). **AV-1 followups (still scattered/not user-ready):**
  - 🔜 **Linkset-attachment child prims fall to the pile** — a rigged root is placed at the avatar root (bind pose), so its linkset's child prims (offset relative to the SL root prim's *attachment point*) land wrong. Fix = decouple the skinned render node from the child-carrying prim node, OR ancestor-aware skinning (a rigged child of a rigged root skins to the avatar; a rigid child keeps the attachment transform).
  - 🔜 **Cohesive avatar / better placeholder** — scattered rigged parts with no body read as "5–10% of an avatar" (too scary for users). Need the humanoid-tee / jellydoll / cloud placeholder to show **consistently** (currently not seen live — investigate why AV-2 states aren't rendering), then **eliminate the tubes** once a better placeholder is reliable. Gate tube-hide on a torso/body item loaded+placed (not attachment count).
  - ✅ **Avatar facing** — shipped 2026-07-17, live-confirmed. Reconciled the forward-axis convention onto SL-native **+X-forward** everywhere: placeholder geometry (face box → +X, arms → ±Z sides) authored in the +X frame; own-avatar node `rotation.y = yaw + π/2` so its +X points along camera/heading; peers unchanged (already +X via `slQuatToThree(bodyRot)` — the fix corrected their −Z face box for free); rigged mesh stays identity (no per-mesh hack). Own spawn heading tracks the sim via the existing login-`bodyRot` seed. Verified against the 1–2 aligned rigged meshes available. (→ CHANGELOG)
- ✅ **AV-2 Appearance-state + jellydoll colored capsule** — shipped 2026-07-15 (COMMITTED 4bb9988). Peers get a deterministic per-UUID color (FS `calcMutedAVColor` port); translucent 'cloud' until `AvatarAppearance` (Low 158) arrives → solid 'jellydoll'; bakes cached in worldStore for the bake pipeline. ⚠️ Gene reports NOT seeing cloud/jellydoll/humanoid-tee states live — verify these actually render (part of the placeholder followup above). (→ CHANGELOG)
- 🔭 **Skeleton + default locomotion anims** — THREE.SkinnedMesh w/ SL joint names, AvatarAnimation decode/forward (dropped today), SL-BVH parser + AnimationMixer w/ priority. HIGH risk. *Beta-1/2.*
- 🔭 **Bake pipeline** (AgentSetAppearance) — risky, can blank avatars globally; needs test-grid. Unblocks clothing-layer wearables + "save outfit." *Beta-2.*
- 🔜 COF (Current Outfit Folder) sync · Wearing tab wear/unwear · Outfits save/apply/delete · Appearance floater updates on wear.
- 🔭 Billboard impostor render (render-to-texture) · facial/lip · Animesh · gestures. *Later.*

### 8. Chat & IM — 🟡 ~70% · v0.4
- 🔜 Nearby chat: scrollback persistence · mute names/words · options panel (range/channel/font) · search · tear-off · reopen-without-losing-history.
- 🔜 **System messages** ("Item placed in folder Objects…", "Grid: Teleport completed…" channel 0/1).
- 🔜 IM toolbar buttons (Mute/Share/Pay/TP-Offer/Add-Friend/Block/Profile) · **typing indicator** (IIM type 41) · IM history persistence across reloads · conference/ad-hoc chats.
- 🔜 Voice button in IM (stub until bundle 12).

### 9. Groups & Group IM — 🟡 ~8% · v0.5
- 🔜 Group list from login (AgentGroupDataUpdate) · group info floater (charter/members/roles/land/notices).
- 🔜 Group IM (ChatSessionRequest cap + ImprovedInstantMessage hybrid) · notices (inbox + send) · roles/membership mgmt · active title toggle & tag · group search.
- 🔜 Receive side of group invites (IM dialog 22 → accept/decline 23/24) — send side ✅.

### 10. Friends & Profile — 🟡 ~62% · v0.4
- 🔜 Friends: map-permission toggle · modify-objects toggle · offer TP / TP-to-friend · per-friend online-notify · call (bundle 12).
- 🔜 Profile (others): show photo + all fields · connect the 3 icons (map-locate etc.) · connect bottom buttons · Notes save · Picks tab · Classifieds (view).
- 🔜 Profile (self): real About + Groups · show-in-search toggle · Save/Discard · edit About · Set Display Name · change image · Add Picks/Classifieds · 1st-Life text & image.

### 11. Places, Map, Minimap & Parcel — 🟡 ~68% · v0.4
- 🔜 Places: Show-on-Map · Share/Copy-SLurl · View/Edit landmark (thumb + Title + Notes) · Move-to-Favorites · Cut/Copy/Paste/Rename/Delete · date-accordion grouping · Favorites reorder + HUD strip · plus-btn menu.
- 🔜 Teleport history: per-entry stamp · Clear/remove-single · "Show item info" · Teleport/Map/Profile buttons.
- 🔜 **Go Home** (home pos is in login response — quick win) · region snapshot **tiles** (J2C cap) · MapItemRequest dots · friends layer · **CoarseLocationUpdate forward** (fixes neighbor+friend dots) · remove arbitrary grid lines · map localStorage cache · minimap parcel overlay.
- 🔜 **Parcel / Land** (LandContextMenu + About Land floater): region/parcel details · Set Home · Sit-here (walk-to + ground-sit) · Build-here · Edit terrain (bulldozer) · 7 land-tab radios + Show-owners.

### 12. Voice (WebRTC) — 🟡 ~8% · v0.5
Signaling done; needs a full rewrite of the old `useAudio`.
- 🔭 Gateway wire-up (Vivox / FreeSWITCH or Opus-native SIP) — **needs voice-provisioning caps** (see below).
- 🔜 Spatial pan (distance+direction from avatar) · VAD tuning · per-region/parcel enable from sim flags · per-speaker mute/volume · active indicator on avatars + minimap · lip sync.

### 13. Media & Audio — 🟡 ~45% · v0.5
Sound (S-1…S-8: triggers, attached loops, positional attenuation, 37 FS UI sounds, channels) all ✅.
- 🔭 Parcel ambient audio stream (parcel media URL) · object audio streaming (perms, positional).
- 🔭 **Media / web-on-prim** — ObjectMedia cap decode (media URL per face) · HTML on prim face (CSS3D/canvas texture) · object texture video (mp4/stream). **Needs the ObjectMedia cap.**
- 🟡 UI sounds ~25% → finish wiring FS UI sound events onto trigger points; FS-vs-current toggle.

### 14. Scripting behaviors — 🟡 ~10% · v0.6
Mostly server-authoritative; the browser can only *reflect* script effects, not run LSL.
- 🔭 Touch handler dispatch (llTouch → script event) · general LSL event surface (touch/collision/sensor/timer).
- 🔜 Script-driven texture/pose changes are already reflected via the ✅ Scripted-motion & TextureAnim work.
- 🚫 Running LSL client-side — out of scope (scripts run on the sim).
- 🟡 **Notecard/script editor** (create/open/edit/save shipped 2026-07-15 — see CHANGELOG). Remaining follow-ons:
  - 🔜 **Compile feedback on script save** — running a script IN a prim uses `UpdateScriptTaskInventory`,
    whose reply carries `compiled` + an `errors` array (the FS compile-error list). Agent-inventory script
    save has nothing to compile; feedback belongs with the in-prim/task-inventory script path here.
  - 🔜 **Find/Replace bar** in the editor (in-browser; deferred — usefulness TBD, Gene 2026-07-15).
  - 🚫 External "Edit…" (open in the OS-associated editor + sync the temp file back) — can't-in-browser
    (no filesystem/launch-app access); deliberately NOT stubbed.
  - 🔜 Editable Description (save via UpdateInventoryItem) — shown read-only today.

### 15. Cross-region / neighbor sims — 🔭 ~15% · v0.5
- 🔭 Neighboring-sim terrain (adjacent ±regionSize; EnableSimulator + second circuit or cap fetch). **Bump priority — you asked for neighbors before crossings.**
- 🔭 Child-agent circuits · cross-sim duplicate-avatar-at-edge · cross-region walk handshake (bundle 1).
- 🔭 Region size on cross-region TP (RegionHandshake lacks size; var-region assumes 256).

### 16. Performance & Scale (infra) — 🟡 ~70% · ongoing
Camera-driven interest streaming, CRC object cache, warm-reload, near-first, texture/mesh watchdogs,
draw-distance governor all ✅. See [`render-cache-model.md`](render-cache-model.md).
- 🔭 Render/cache ceilings & far-field **LOD** (the big heavy-region lever; sub-items interdependent).
- 🔭 **Stale-scene validate-on-entry** — other users' deletes/resizes/rotates stay stale; FS validates cache by CRC probe on region entry → fresh ObjectUpdate on mismatch. Widened 2026-07-12 (mutation staleness, not just deletes).
- 🔭 Cold-asset throughput — client mesh-fetch concurrency, ~5-min cold stall, idle texture backfill.
- 🟡 Circuit drop on heavy/slow load (DisableSimulator ~3 min; saturation starves AgentUpdate/keepalive).
- 🐛 Scripted motion pauses on window **focus-out** — gate on `document.hidden` not `!hasFocus()` (discuss before changing).
- 🐛 Scripted pos-motion objects need a touch to first start (cache preseed has no live terse until interest/select).

### 17. UI / Floaters / Preferences — 🟡 ~55% · v0.4
- 🔜 **Floaters framework:** Minimize button · resize from any corner/side (only br works, oddly) · **persist per-floater width/height/pos** in IDB (incl. all 6 inventories) + off-screen guard.
- 🔜 **People Floater** (FS-style: Nearby/Friends/Groups/Recent/Blocked/Contact-Sets tabs) — fold AvatarList into "Nearby"; expose via World ▸ Nearby avatars (Ctrl+Shift+A).
- 🔜 **Snapshot** system (save to disk / inventory / postcard — inventory save needs asset-upload cap).
- 🔜 **Preferences:** wire the QuickPrefs **draw-distance slider** to `ui.drawDistance` (it's a disabled stub today) · relabel & re-cap the **geometry-cache-RAM** slider (it's an in-heap sub-budget, not total; cap max at the probed heap limit) · **Grid Manager** (add/save grids like FS) · Privacy ▸ Logs & Transcripts behavior.
- 🔜 Movement HUD: flying-but-idle gentle bob · better Stand/Stop-Fly placement.
- 🔜 MenuBar filter/search is a placeholder — make it functional.

### 18. Beta hosting & 2D / mobile — 🔜 ~12% · v0.4
- 🔨 **Publicly live for beta** (NAS or VPS backend) — server-side Tier-2 asset cache is viable there. *This is the v0.4 gate.*
- 🔭 **2D / mobile mode** — hide canvas at phone sizes, default to a useful overhead 2D view (Map-like but richer); detect low-end on entry + a Preferences opt-in. Learn from speedlight.io. → mostly v0.6.
- 🔜 Onboarding / account flow polish for external testers.

---

## Caps still needed

The HTTP-cap layer is data-driven — framework in `server/lib/caps/`, client `useCaps.js`. **Good news:** the
seed request at login (`server/handlers/login.ts:18-62`) already *asks the grid for ~20 caps* — most of what
remaining features need **already arrives; it just has no handler wired yet.** So the work is mostly
"wire a handler to an already-requested cap," not "discover a new cap." Very few features are truly cap-blocked.

**Fully wired today:** `ViewerAsset` (texture/mesh/sound/material) + `GetTexture`/`GetMesh(2)` fallbacks ·
`FetchInventoryDescendents2` (+ lib variants) · `CreateInventoryCategory` · `RenderMaterials` handler ·
`EventQueueGet` long-poll. Inventory *mutations* use LLUDP (OpenSim has no AIS3). Note: `UploadBakedTexture`'s
cap URL is *requested* but **there is no 2-step upload code at all** — only `RebakeAvatarTextures` (a single
empty POST) is wired. The generalized 2-step uploader is being built (§ item 1 below) and unblocks it too.

**Needs building / finishing (by leverage):**
1. 🟡 **Asset upload** — the reusable 2-step uploader (`uploadNewAsset`/`updateItemAsset`) + `CreateInventoryItem`
   + read-side fetch **shipped 2026-07-15** (see CHANGELOG); notecard/script create+edit+save live. Remaining
   thin call sites on the same framework:
   - ✅ **Sound-from-file upload** (`NewFileAgentInventory`, OGG) — shipped 2026-07-15 on all surfaces
     (inventory + menu, MenuBar Build▸Upload, quickerSTORM▸Import) via shared `useUploadActions`. (→ CHANGELOG)
   - ✅ **Texture / image upload** (`NewFileAgentInventory`, server-side J2C encode) — shipped 2026-07-15 on all
     surfaces via `useUploadActions.uploadTexture()`. Snapshot→inventory rides `uploadNewImage` (capture UI = bundle 17).
   - 🔜 **Bake-texture upload** (`UploadBakedTexture`) for the appearance work (bundle 7).
   - 🔜 `InventoryThumbnailUpload` (rides the same uploader).
2. **PBR materials** — **not cap-blocked.** `RenderMaterials` fetch handler exists; finish the declared-but-
   handlerless `ModifyMaterialParams` (set GLTF overrides) + the client shader/edit path. Unblocks bundle 4 ("PBR not seen").
3. **`ObjectMedia` / `ObjectMediaNavigate`** — *requested, no handler.* Media & web-on-prim (13).
4. **Voice** — `ParcelVoiceInfoRequest` *requested, no handler*; add `ProvisionVoiceAccountRequest` + the gateway (12).
5. **Handler wires for already-requested caps** (small, unblock polish): `GetDisplayNames` (display names) ·
   `SimulatorFeatures` (region PBR/cap flags) · `GetObjectCost` + `ResourceCostSelected` (land-impact in the
   build floater) · `RemoteParcelRequest` (SLurl resolve, places) · `ParcelPropertiesUpdate` (parcel edit, 11) ·
   `CopyInventoryFromNotecard` + `IncrementCOFVersion` (outfits/COF, 7).

Everything else (groups, map tiles, most of places) rides existing caps + UDP or plain URLs.

---

## 🔭 Brainstorm-first (design before touching — do NOT blind-batch)

These are structural/risky and touch live cache/render/cross-region paths. One at a time, own design pass each:
Inventory load-at-scale · 2D/mobile mode · Render/cache ceilings & LOD · Environment reflections/shadows ·
Avatars (skeleton/anim/bake) · Voice · Media/web-on-prim · Money/commerce · Cold-asset throughput ·
Cross-region/neighbors · Stale-scene validate-on-entry (CRC) · Var-region 512/1024 correctness · Movement springback.

---

## Test-debt (my side — not a feature status)

Built but not yet driven end-to-end by me (MCP) *or* confirmed by you in-app. These do **not** block any
bundle's status; they're a list to burn down in a live session:
- Build-tools sweep (create-prim visual placement, gizmo drag, link/unlink, texture-drop) — 2026-07-13, uncommitted.
- Inventory solidify + remaining-polish sweeps — 2026-07-01/02, committed, not MCP-verified.
- Right-click menus sweep — 2026-07-13.
- Scripted motion & TextureAnim, Sound, Object Contents — 2026-07-05, committed.
- Prim shape params editable (FIX ROUND 4) — 2026-07-13, uncommitted.

## Project-hygiene debt
- **ESLint flat-config** so `npm run lint` runs repo-wide again.
- ~22 `src/__tests__/lib|utils/*` suites fail to collect under vitest (they `import from 'bun:test'`) — run under `bun test` or make vitest-compatible.
- `useTeleport.test.js` — 5 stale asserts (Pinia-not-active + moved `TELEPORT_SOURCES`).

---

## Raw inbox (dump here; triaged into bundles above)

- Land context menu 'Build' can be enabled - should open ObjectEditFloater directly to Create section.
- Still getting ghost items left behind when FS user deletes them.  Will probably clear on next login, but unsure why we can't be as good as FS at clearing those, especially since when I edit them I find they have no name or description, so there are clues that they are ghost items.
- Where/when will Inspect Textures floater be bundled?
- Did we capture the gap mentioned before for adding a full-canvas single pixel ray through each of the 3 gizmo axes for movement alignment?

*(empty — 2026-07-14 items triaged into bundles 1–18; 2026-07-13/12/05 bug items folded into their bundles.)*
