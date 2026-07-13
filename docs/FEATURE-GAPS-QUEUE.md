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

### ✅ Inventory — remaining polish SHIPPED 2026-07-02 (committed; NOT live-verified)
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

### ✅ Drag-drop robustness — SHIPPED 2026-07-03 (committed; NOT live-verified — DnD hard to drive via MCP)
Swept in the 2026-07-03 ultracode batch (Package E + reviewer + fix round; tests green):
- **Rez drop raycasts prims too** — new `screenToDropPoint()` (prim meshes incl. InstancedMesh pool first,
  terrain fallback); toast on rejected drop. FS-style sim-raycast (rayStart=camera, BypassRaycast=0 +
  RayTargetID) is wired as `rezObject(itemId, pos, opts)` hook (Package D) — client-side pick is the default.
  **2026-07-04 follow-up (Gene: "rez-on-ground very imprecise"):** (a) drop ray now SKIPS invisible prims
  (`!mesh.visible`, opacity≤0.05 transparents, hidden instanced) — alpha-0 skirt/trigger prims between camera
  and terrain were intercepting ground drops onto unseen surfaces; (b) canvas drops now use the FS sim-raycast
  path by default (rayStart=camera + RayTargetID=hit prim + BypassRaycast=0, lltooldraganddrop.cpp:1963-2003)
  — the sim lands the object ON the first surface offset by its extents instead of embedding center-AT-point.
  ⬜ re-test ground + on-object drops (on-object placement semantics changed from embed-at-hit to sit-on-surface).
- **Multi-cargo drop = FS refuse** — reviewer caught the misread: FS REFUSES >1-cargo drops on land/objects
  (`ACCEPT_YES_SINGLE`, lltooldraganddrop.cpp:2491/:2560/:674-681) → any multi-item/folder drag is rejected
  with "Only one item can be dragged here at a time." toast (TooltipMustSingleDrop parity).
- **Give feedback** — nothing-sent cases (unfound/no-transfer/missing targetId) now toast.
- **`@dragenter.prevent`** added on all three drop zones (WorldCanvas / Profile / Conversations).
- If drag "deadness" recurs in Chrome: check DevTools device emulation first (known Chromium DnD
  hit-test bug, already bitten twice) and stale Bun/Vite processes.
- ⬜ live-verify by hand: drop an object on a prim floor (should rez ON it), multi-drag toast, give toasts.

### Object Build & Edit Floater — FEATURE-GAPS L170–186
- ✅ edit name & description (audited 2026-07-04: full round-trip live) · numeric size/pos/rot input fields
  → **Object edit — manipulation** cluster below · Select-Face radio
- texture drag-drop onto faces · Normal/Specular channels (RenderMaterials cap) · sculpt-texture assign
- Link/Unlink prims · Link-number ordering bug (L183) · **create/rez a prim in-world** (Build-tools)
- **✅ ObjectProperties-data BATCH — SHIPPED 2026-07-03 (committed; core LIVE-VERIFIED osgrid):**
  whole-linkset ObjectSelect (≤254-id chunks) → per-prim props into worldStore + `objectPermissions.js`
  (selectGetPerm-port `aggregateBit` + `canTakeObject`/`canTakeCopyObject` mirroring PermissionsModule.cs).
  · **Take / Take copy perm gating** ✅ LIVE-VERIFIED — greyed on a no-everyone-perms mailbox, enabled on a
    takeable build; unknown-perms → enabled (sim authoritative, take-watchdog toasts refusals).
  · **creator/owner names** ✅ LIVE-VERIFIED — reused existing NAME_REQ/UUIDNameReply plumbing; Creator
    "Hiro Lecker" (non-friend) + Owner/LastOwner resolved. Group names still UUIDs (separate lookup, open).
  · **Link numbers** — FS `mChildList` arrival-order convention (llfloatertools.cpp:623-647) via
    `linksetMembers`/`linkNumberOf`; Object tab showed root + Link Count 18 live. ⬜ compare child link #s
    vs FS on the known 154-prim linkset (old 47-vs-67 report) before closing L183.
  · **TRI-STATE perm checkboxes** — `aggregateBit` on/off/mixed/unknown + indeterminate rendering
    (PermCheckbox.vue); Gene's hunch partly confirmed: floater had a real **perm-bit swap** (permLetters
    tested M=1<<13/C=1<<14/T=1<<15 — all shifted one bit; also Locked tested MODIFY not MOVE). Fixed via
    shared constants. ⬜ live-verify mixed state on a perm-disagreeing linkset.
  · **rezzed copies LOSE perms** — ROOT-CAUSED sim-side: OpenSim ignores ALL packet perm fields on rez
    (InventoryAccessModule.cs:1151-1301); client packing audited CLEAN. Real risk = stale masks=0 IDB rows
    from pre-2026-07-02 poisoning service rows on rename/perms-edit writes (see FEATURE-GAPS.md watch entry).
  NOTE: Gene reworked **ObjectEditFloater layout** (2026-07-03) toward the editable-fields end state —
  build the "numeric size/pos/rot editable fields" task ON his layout, don't restructure it. (Batch complied.)
  **✅ ACTUAL "no response" root cause FIXED 2026-07-03**: DeRezObject must reference the linkset **ROOT**
  prim — OpenSim silently `continue`s on child-prim ids BEFORE any perm check (Scene.Inventory.cs:2258-2260)
  and FS always sends the root via selection. We sent the CLICKED prim → every multi-prim build no-op'd
  (18/20; the 2 single-prim ones worked). Fix = `linksetRootLocalId()` resolver in useLLUDP
  takeObject/takeObjectCopy/sendDelete (also fixes latent linkset-DELETE no-op). Perm refusals, when they
  DO happen, are still silent upstream (PermissionsModule.cs:2019 alert commented out; take-copy of
  others' objects needs everyone Copy+Transfer folded over every prim + contents, :1045/:2017/:2023) —
  covered by the 10s **take-watchdog** toast (useTakeWatch.js).
- drag-select multiple objects + gizmo handles → **Object edit — manipulation** cluster below
- texture anim/scripts → **Scripted motion & TextureAnim** cluster below
- **"Not for sale" decode** → only show the buy pointer when actually for sale; then **Buy / Buy-for-0**
  ('You don't have enough…' + placeholders for real purchase/currency) — full money system is brainstorm-first.

### 🛠️ Object edit — manipulation — ✅ M-1/M-2/M-3 SHIPPED 2026-07-05 (committed; LIVE-VERIFIED)
**M-1** encodeMultipleObjectUpdate + handler + useLLUDP sendPosition/sendScale/sendRotation (golden-byte
tests vs the OpenSim type table; ⚠ impl unreviewed — spend limit). **M-2/M-3** (done by hand after the
sweep): editable Pos/Size/Rot inputs on Gene's floater layout + ±0.05 m/±0.5° steppers + ↑/↓ keys,
focused-field echo guard, Euler↔quat in src/utils/eulerQuat.js (round-trip vitest). **LIVE-VERIFIED
osgrid:** stepper +0.05 and typed-value commits both round-tripped with exact sim echo (obj 647648750).
ROOT prims only (child pos/rot are parent-relative → gated w/ tooltip until "Edit linked parts").
**Still needs-design:** gizmo drag · drag-select marquee · shift-copy (see original scout notes below).
Audit findings: the gizmo is **visual-only** (arrows/rings/handles render + mode-switch + click-through guard,
useWorldEngine.js:1855–2038, but zero drag interaction; no TransformControls import); Pos/Size/Rot in the
Object tab are read-only `<span>`s (ObjectEditFloater.vue:901–923; `quatToEulerDeg` exists :209, no inverse);
**no MultipleObjectUpdate encoder exists anywhere** — that's the shared prerequisite.
**Batch-ready (one small sweep):**
- **M-1 MultipleObjectUpdate encoder + wire** — encode per FS llselectmgr.cpp:4922 packMultipleUpdate:
  per-block LocalID U32 + Type U8 + Data (order strictly pos12 → rot12(quat packed to 3 floats) → scale12,
  only flagged fields; UPD_POSITION 0x01 / ROTATION 0x02 / SCALE 0x04 / LINKED_SETS 0x08 / UNIFORM 0x10 —
  llselectmgr.h:60). OpenSim decode table: LLClientView.cs:12298 HandleMultipleObjUpdate (types 1–5, 9–0x0D,
  0x14/0x15). New protocol consts OBJECT_MOVE/SCALE/ROTATE + handler + `sendPosition/Scale/Rotation` in useLLUDP.
- **M-2 Numeric Pos/Size/Rot inputs** — replace spans with inputs (blur/Enter commit, FS-style rot-sends-with-pos:
  llpanelobject.cpp:2187 UPD_ROTATION|UPD_POSITION, scale clamps 0.01→region max :2204) + Euler→quat inverse.
  **Build on Gene's 2026-07-03 floater layout — don't restructure.** → type X → prim moves on sim, echo updates fields.
- **M-3 Nudge steppers** — ±0.05 m / ±0.5° buttons on each axis, same send path.
**Needs-design (own pass each, after M-1 lands):**
- **gizmo drag** (pointer capture on handles, axis-plane projection math per llmaniptranslate.cpp:1079 /
  llmaniprotate.cpp:488 / llmanipscale.cpp:414 — all send on mouse-up; live local preview during drag;
  SL↔Three Y/Z swap care) · **drag-select marquee** (needs multi-object selection state — today only single
  `ui.editObjectId`; FS lltoolselectrect.cpp:72) · **shift-copy** (ObjectDuplicate Low 92, needs gizmo drag first).

### 🎬 Scripted motion & TextureAnim — ✅ SHIPPED 2026-07-05 (committed; NOT live-verified)
Full A–G swept 2026-07-05 ultracode. Server wire (E/F decode + forward) REVIEWED-PASS (all cites verified,
251 server tests green). Client (all A–G in useWorldEngine + src/lib/scriptedMotion.js pure-math port)
⚠ UNREVIEWED — the org spend limit killed its reviewer mid-workflow; code self-audited only. KEY UPGRADE
found during impl: terse child pos/rot are PARENT-RELATIVE on the wire (OpenSim LLClientView.cs:6791
part.RelativePosition — verified), so G applies them as parent-local, not worldToLocal. ⬜ live-verify:
waves scroll (child 647644744, slow −0.02), falls (0.15), a spinning llTargetOmega prim, vehicle glide,
moving-linkset children, sculpt-foliage striping gone. Original scouted spec below for reference:
Server already decodes + forwards `textureAnim` (lludp-codec.ts:916 parseTextureAnim, fwd :1285/:1638);
worldStore holds it; **nothing in the render path consumes it**. Live probe (osgrid 2026-07-04): 18 objects
in-region carry active anims — ALL mode 0x13 = ON|LOOP|SMOOTH (water rate −0.02, falls/streams 0.15),
incl. wave-surface child 647644744. Hook site = `animate()` (useWorldEngine.js:4674) before `renderer.render`.
⚠ Two render-side traps: (1) `xformCache` clones textures with STATIC repeat/offset keys
(useTextureFetch.js:64/:431) — animated objects need an uncached per-object clone; (2) animated prims must be
excluded from / auto-promoted out of the InstancedMesh pool (poolKey snapshots static UV — useWorldEngine.js:3819–3829).
**Wave 1 — fully independent, ONE sweep (A+E+F+G):**
- **A. TE-repeat bypass when ANIM_ON** — apply identity UV (not TE repeats) on faces with `mode & 0x01`;
  fixes striping visible TODAY on static-UV-trick prims (garbage repeats like V=−256 on sculpt foliage).
  Hook `uvXform` call sites (useWorldEngine.js:2367 + faceXform :4385). FS: llface.cpp:1739–1759 (bypass),
  llvovolume.cpp:723 animateTextures. → sculpt foliage stops striping; normal prims unregressed.
- **E. Omega spin (llTargetOmega)** — decode AngVel (compressed ObjectUpdate 12B discarded at codec:1150;
  terse 6B skipped at :1753), forward, integrate per frame `quat *= ΔQ(axis, |ω|·dt)`. Port of FS
  llviewerobject.cpp:7397 applyAngularVelocity (called idleUpdate :2552). → fans/wheels spin at sim rate.
- **F. Velocity dead-reckoning for prims** — decode terse Vel (skipped at codec:1753), advance pos by `vel·dt`
  between ~10 Hz terse updates (own-avatar DR already exists as the model). → vehicles/trains glide, no teleport-stutter.
- **G. Child-prim terse coordinate-frame fix 🐛** — onTerseUpdate (useWorldEngine.js:2903) sets ABSOLUTE
  world coords as LOCAL position on meshes parented under a root → children of moving linksets jump/drift.
  Convert via `parent.worldToLocal()`. Likely THE "some scripted motion works, some doesn't" root cause.
**Wave 2 — after A lands (B+C+D share one frame-loop + timer):**
- **B. SMOOTH scroll** (sizeX=sizeY=0): `off += rate·dt`, fmod-wrap — moving water/scrolling text. THE waves item.
- **C. Cell animation** (sizeX/Y>0): FS formula llviewertextureanim.cpp:78–233 — `repeat=1/size`,
  frame = floor(elapsed·rate), x=f%sizeX, y=floor(f/sizeX), offsets centered −0.5+0.5/size; LOOP/PING_PONG/REVERSE.
- **D. ROTATE / SCALE modes** (0x20/0x40): `map.rotation = frame_counter` (center 0.5,0.5) / repeat=counter.

### 📦 Object Contents — ✅ ALL 6 STEPS SHIPPED 2026-07-05 (committed; list LIVE-VERIFIED)
Steps 1–3 (server: Xfer subsystem + RequestTaskInventory/Reply + legacy parser + TASK_INV wire +
MoveTaskInventory encode; ⚠ impl unreviewed — spend limit; unit tests green). Steps 4–6 done by hand:
`useTaskInventory` composable (module-singleton state, KILL_OBJECT invalidate, 35s no-reply timeout) +
real Content tab (request-on-activate, type icons + perm letters, loading/error/empty states, Refresh) +
**Open** on ObjectContextMenu and the Content tab (FS llfloateropenobject copy-to-named-folder via
MoveTaskInventory per item; toasts every outcome). **LIVE-VERIFIED osgrid:** Content tab listed a real
prim's 4 items (3 animations + a script) through the full Xfer pipeline. ⬜ live-verify the Open click
itself (creates folder + copies items — left for Gene). New Script / Edit buttons stay disabled
(no script editor yet — FEATURE-GAPS scripts).
**Follow-ups (Gene 2026-07-05, after his layout/button pass on the tab):**
- FS treats contents as a single FOLDER of an inventory tree w/ drag & drop (llpanelobjectinventory =
  a filtered inv panel) — either reuse our inventory tree component scoped to the task folder, or faux it here.
- Per-item context menu (FS: Open / Properties / Rename / Delete) — where FS "Open" = preview-by-type /
  edit-script; our copy-to-inventory action is deliberately labeled differently to keep the two apart.
- "xfer timeout" robustness FIXED 2026-07-05: deep-duplicate re-confirm (highest-accepted) + watchdog
  re-arms on ANY transfer traffic (OpenSim bursts ≤33 chunks, stall-resends ≤4×10s — XferModule.cs:396/:458;
  we could time out mid-recovery on lossy/busy links). If timeouts persist → add ONE auto re-request retry.
**SEQUENTIAL mini-program** (steps feed each other — one session/pipelined workflow, not a blind-parallel sweep).
All 9 UDP messages already in message_template.msg (Xfer :3541–3586, task-inv :6421–6508); **zero Xfer machinery
exists** in our server. OpenSim has NO RequestTaskInventory HTTP cap → must build the UDP+Xfer path
(FS falls back the same way, llviewerobject.cpp:3051). Content tab stub already in ObjectEditFloater.vue:1308–1324.
1. **Xfer subsystem** (`server/lib/xfer.ts`): encodeRequestXfer (Low 156) · SendXferPacket decode (High 18,
   U64 XferID + U32 packet#, high bit = EOF, packet 0 prepends U32 total-len) · ConfirmXferPacket (High 19) ·
   AbortXfer · keyed reassembly + timeout. OpenSim: XferModule.cs:161 AddNewFile / :425 1KB chunks.
   → unit test: 3-chunk mock reassembles.
2. **RequestTaskInventory (Low 289) + ReplyTaskInventory decode (Low 290)** — TaskID/Serial/Filename;
   empty filename = empty prim → `TASK_INV_EMPTY`. FS: llviewerobject.cpp:3344 processTaskInv → :3432 requestFile.
   OpenSim: SceneObjectPartInventory.cs:1453 RequestInventoryFile.
3. **Legacy task-inv file parser** — tab-indented `inv_object`/`inv_item` text blocks (perms sub-block hex masks,
   names end `|`, asset_id zeroed when perms deny). Format: InventoryStringBuilder (SceneObjectPartInventory.cs:1637);
   FS parser loadTaskInvFile (llviewerobject.cpp:3524). → parse script+notecard+texture fixture correctly.
4. **Client store** — `taskInventory: Map<localId, items[]>` + TASK_INV/TASK_INV_EMPTY handlers + KillObject invalidate.
5. **Content tab UI** — request on tab-activate, list w/ type icons + perm letters (reuse inventory constants),
   loading spinner; enable New Script/Open/Edit buttons appropriately. FS: llpanelobjectinventory.cpp:1870/:1742.
6. **"Open" flow** — ObjectContextMenu Open + Content-tab button: create agent folder named after object →
   MoveTaskInventory (Low 288) per item → confirm via UpdateCreateInventoryItem (already decoded).
   FS: llfloateropenobject.cpp:155 moveToInventory, llinventorybridge.cpp:3624. → items land in Objects folder.
   (Unblocks the FEATURE-GAPS "UNBOX perms re-check" watch item.)

### 🔊 Sound — ✅ SHIPPED 2026-07-05 (committed; NOT live-verified)
S-1…S-8 all swept 2026-07-05 ultracode (server wire REVIEWED-PASS; client useSoundEngine.js REVIEWED with
ONE blocker — llStopSound could never stop loops because the codec omitted zero-UUID sound fields — FIXED
by hand same day: codec now emits an id:null STOP marker when Sound=Zero + flags/gain set
(SoundModule.cs:269-276 stop path), regression-tested. 35 sound tests green.) ⬜ live-verify: llTriggerSound
plays + attenuates with distance, looping fountain starts/stops, llStopSound kills a loop, FS-UI-sounds
toggle, Sounds slider. Original scouted spec below:
Surprising head start: **server OGG asset fetch already works end-to-end** (assets.ts:83 `'sound'` spec →
ViewerAsset cap → base64 to client) and **37 FS UI sounds (OGG) already sit unwired in src/assets/audio/sl-fs/ NO ONE TOLD YOU TO CONNECT THESE WHEN WE HAVE OTHERS**
(glob only picks up *.mp3). Gap = packet handlers (all four sound packets currently logged-once-and-dropped)
+ a client player. Web-audio engine + channel state refs exist (useAudio.js; ambient/sounds/music/media/voice
are "state only, no routing yet").
- **S-1 SoundTrigger decode+forward** (High 29: SoundID/Owner/Object/Parent/Handle/Position/Gain) → `SOUND_TRIGGER`.
  FS: llviewermessage.cpp:4871 process_sound_trigger. OpenSim: SoundModule.cs:166 TriggerSound.
- **S-2 AttachedSound + GainChange decode+forward** (Medium 13/14). FS: llviewermessage.cpp:5049/:5106
  (note FS's postponed_sounds map for objects not yet arrived).
- **S-3 Extract sound fields from ObjectUpdate** — currently SKIPPED (codec:1195 `off += 25` compressed;
  :1597–1601 full tail): soundId/gain/flags/radius → object payload + store.
- **S-4 Client OGG player** — on SOUND_TRIGGER: ASSET_FETCH sound → decodeAudioData → BufferSource once;
  master volume. → llTriggerSound audibly plays in browser.
- **S-5 Positional attenuation** — PannerNode (distanceModel 'inverse', refDistance 1, rolloff 1 = FS OpenAL
  defaults, llaudioengine_openal.cpp:272); listener = camera. → 20 m clearly quieter than 1 m.
- **S-6 Looping attached sounds** — from S-3 fields: loop when `flags & 0x01`, Map by objectId, stop on
  KillObject, gain updates from S-2. → fountain loops, fades with distance, dies cleanly.
- **S-7 Wire the 37 FS OGG UI sounds** — extend glob to sl-fs/*.ogg, map FS names (click, window open/close,
  snapshot, teleport…) onto existing trigger points; user toggle FS-vs-current sounds. FS: llui.cpp:156
  make_ui_sound + settings.xml UISnd* UUIDs.
- **S-8 Route the "Sounds" channel for real** — in-world playback through a sounds GainNode (separate from
  interface + master). → slider/mute audibly works.

### 🧍 Avatar first slices — batch-able forerunners of the 🧠 avatar program (SCOUTED 2026-07-04)
- **AV-1 SKIN-block decode → attachments positioned right (MEDIUM risk)** — mesh LLSD SKIN block
  (mJointNames/mInvBindMatrix/mAlternateBindMatrix/mBindShapeMatrix/mPelvisOffset — FS llmodel.h:46–77) is
  currently not parsed AT ALL; rigged clothing lands at bind-pose origin. Slice = decode server-side + apply
  static root-joint/bind offset client-side when parent is an avatar (no skeleton, no GPU skinning yet).
  Matches the FEATURE-GAPS "bind-pose placement first, then hide arm tubes on torso-coverage" plan.
- **AV-2 Appearance-state enum + jellydoll colored-capsule (LOW risk)** — AOA_NORMAL/JELLYDOLL/INVISIBLE
  equivalent (FS llvoavatar.cpp:12964 getOverallAppearance) + distinct per-UUID jellydoll color; the honest
  "can't render this yet" state and the scaffold Stage-3 skeleton work hangs off. Billboard-impostor render
  itself stays 🧠.

### ✅ Right-click menus (object + avatar) — SHIPPED 2026-07-13 (NOT live-verified)
Full sweep (4-stage workflow, reviewed w/ 2 integration fixes applied; 265 server + 69 targeted client
tests green, staging build green):
- **Sit on object** — AvatarSitResponse (High 21) decoded+forwarded (`S.SIT_RESPONSE`, fly forced off per
  FS llviewermessage.cpp:5489); THE avatar reparent gap FIXED (avatars whose ParentID changes now
  attach/detach into/out of the seat prim, own + remote; parent-local pos handling; own-avatar DR/gravity/yaw
  gated while seated; camera + LocationBar read world pos via getWorldPosition).
  Context-menu row swaps Sit here ↔ Stand Up; sitName label. OpenSim quirks honored (free-sit >10 m =
  silent refusal; ground-sit sets NO ParentID → tracked optimistically).
- **Stand up / Sit on ground / Fly** — CTRL_STAND_UP 0x10000 / CTRL_SIT_ON_GROUND 0x20000 (indra_constants.h:338-342)
  + immediate out-of-cycle AgentUpdate send; wired: AvatarContextMenu self, MenuBar ▸ Movement (incl. Force
  ground Sit, gated while object-seated), MoveControlsFloater Stand Up / Stop Flying conditional buttons.
- **Zoom in** (object + avatar menus) → enterOrbitAt via qs:zoom-to-object.
- **Buy** — ObjectBuy (Low 102) FS-parity bytes; BuyObjectDialog (title-by-saleType, owner, perm letters,
  insufficient-funds gate, 10s silent-refusal watchdog — stock OpenSim DROPS ObjectBuy w/o money module,
  BlueBox-refuses priced buys, only L$0 works); menu gate = saleType>0 ∧ owner known ∧ not self (stricter
  than Take on unknown, deliberate); hover Buy badge now suppressed when not actually for sale.
- **Pay** — MoneyTransferRequest (Low 311; TRANS_GIFT 5001 / TRANS_PAY_OBJECT 5008); PayFloater (FS fast-pay
  1/5/10/20 + amount). NOTE: viewer Pay is a sim-side NO-OP on stock OpenSim (SampleMoneyModule.MoneyTransferAction
  is empty) — needs a real currency module to do anything.
- **Money balance** — MoneyBalanceRequest/Reply + `useMoney` (stock grids always report L$0).
- **Invite to group** — InviteGroupRequest (Low 349), submenu from real group list; silent server-side if
  grid groups are off.
- **Inspect avatar** — InspectAvatarFloater (born/age/About via existing profile plumbing).
- **Deliberately left out (gated on 🧠 programs):** Save outfit (appearance), Call (voice).
- **FIX ROUND 2026-07-13 (Gene's live-test feedback — "just match what the FS code does"):**
  (a) movement-key-stands REMOVED — FS ground truth: llagent.cpp:763-914 moveAt/moveLeft/moveUp have NO
  isSitting branch/standUp(); flags are sent, sim ignores them (Gene was right, my spec invented it);
  (b) 10s buy "No response" watchdog toast REMOVED — FS onClickBuy is fire-and-forget with zero timeout
  detection (llfloaterbuy.cpp:321-333); success = item appears in inventory + MoneyBalanceReply description
  toast when the grid sends one; sim refusals still auto-toast via AlertMessage;
  (c) Stand/Stop-Flying → standalone bottom-center StandStopFlying.vue (FS LLPanelStandStopFlying is
  independent of the Move floater, llmoveview.cpp:157-182/569-589; shows for ground-sit too; Stand wins
  over Stop-Flying) — was buried in MoveControlsFloater, invisible when closed;
  (d) LEFT-CLICK ClickAction dispatch (FS lltoolpie.cpp:350-443): Sit(1)→sit w/ pick offset, Buy(2)→select
  root + BuyObjectDialog, Pay(3)→PayFloater, Zoom(7)→camera, 4/5/6 eaten (no OpenObject floater/media yet),
  8 eaten; modifier keys bypass (mask==MASK_NONE gate) — fixes "clicking a for-sale object does nothing";
  (e) sit OFFSET now sent — FS pick.mObjectOffset (object-local click point, llviewermenu.cpp:6013) through
  sendSit→server→AgentRequestSit; free-sit prims seat AT the clicked spot, not the prim origin. Scripted
  (incl. child/multiple) sit targets were always sim-side (FindNextAvailableSitTarget walks the linkset,
  ScenePresence.cs:3247-3286) — nothing client-side to do there;
  (f) hover Buy badge = Gene's rule (only when KNOWN for-sale, saleType>0) — made workable by wiring the
  hover-driven RequestObjectPropertiesFamily (Medium 5) / ObjectPropertiesFamily (Medium 10) pair (the
  template's own "driven by mouse hovering" message; FS fills node->mSaleInfo the same way,
  llselectmgr.cpp:6421-6481): hovering a ClickAction=Buy object with unknown sale info fires one request,
  reply merges into worldStore via applyObjectProperties → badge appears iff genuinely for sale;
  (g) reload-while-seated 0/0 FIXED — identify-own no longer reads a parked-orphan's parent-local pos as
  world; avatarSLPos defers until the seat prim streams in, then derives from the real world transform
  (orphan-attach hook), isSitting set on arrive-parented too.
- **Follow-ups:** (1) sit CameraEyeOffset/CameraAtOffset not applied (normal orbit cam kept — fine v1);
  (2) own-avatar sitRotation offset not applied (seat carries the pose; exact pose = avatar program);
  (3) SIT_ON_GROUND sent edge-triggered (right for OpenSim; FS holds bit — matters only vs SL-proper);
  (4) useMoney balance re-request on reconnect (floaters re-request on open);
  (5) RECEIVE side of group invites (IM dialog 22 → accept/decline 23/24) → IM/Groups cluster;
  (6) LandContextMenu "Sit Here" (walk-to-point + ground-sit chain) → Land cluster;
  (7) ClickAction OPEN(4) needs a non-destructive LLFloaterOpenObject equivalent (our task-inv "Open"
  copies immediately — wrong for a left-click); PLAY(5)/OPEN_MEDIA(6) → media program;
  (8) sit visual pose (avatar bends/sits) + AvatarAnimation decode → 🧠 avatar program — until then a
  seated avatar stands-on-the-seat-spot; full sit verification blocked on that.
- ⬜ live-verify list is in the 2026-07-13 session notes (chair sit/stand/W-stands, ground sit, fly toggles,
  zoom, buy L$0 + watchdog, pay no-op, invite, seated-remote-avatar-before-TP-in regression).

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
- **Avatars (mesh/anim)** — STAGED 2026-07-04 (scout report; stages 1–2 promoted to ⚡ "Avatar first slices"):
  **Stage 1** SKIN-block decode → attachment/clothing positioning (⚡ AV-1) · **Stage 2** appearance-state enum +
  jellydoll colored-capsule (⚡ AV-2; billboard impostor render stays here — render-to-texture + update-period
  design, FS llvoavatar.cpp:5206) · **Stage 3** skeleton + default locomotion anims — THREE.SkinnedMesh w/ SL
  joint names (avatar_skeleton.xml), decode+forward AvatarAnimation (server drops it today; FS
  llviewermessage.cpp:5231 process_avatar_animation → mSignaledAnimations reconcile), SL-BVH parser +
  AnimationMixer w/ priority system — HIGH risk, brainstorm-first · **Stage 4** bake pipeline (below) ·
  then facial/lip, Animesh, gestures. Today's state: capsule+tubes placeholder, avatar TE/baked-UUIDs arrive
  but are never fetched (texture paths explicitly skip avatars — useWorldEngine.js:2358/:4482), server rot
  ignored for avatars, no skeleton/anim/skin code at all.
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
- **Stale-scene genuine deletes + mutation staleness** — hard fullId/interest-filter piece + FS-style
  **confirmation-gated preseed** (don't paint unconfirmed cache entries). L417. WIDENED 2026-07-12: other
  users' **resizes/rotates** also stay stale (not just deletes) — FS validates cache by **CRC probe on region
  entry** (mismatch → fresh full ObjectUpdate); design the validate-on-entry pass to cover both.
  (localId-churn dup half DONE — [[fullid-dedup-shipped]].)
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
- **2026-07-02 eve (committed):** Post-live-test follow-ups — (1) **Take Copy "no response" root-caused**:
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
- **2026-07-02 pm (committed, NOT live-verified):** Inventory remaining-polish ultracode sweep — Take/Take
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

**2026-07-12 (Gene):**
- 🐛 **Double message when an inventory share is offered TO me** — recipient side shows the offer twice.
  Note: the 2026-07-02 "duplicate IM/offer toasts" fix added keyed socket dedup (`on(type,cb,key)`) — so this
  is either a recurrence (HMR/remount stacking again?) or a *different* double: OpenSim sends offers via BOTH
  UDP ImprovedInstantMessage and the EventQueue (FS dedups by IM session/transaction id), or our inline-IM
  Accept/Decline row + toast both rendering as "messages." Repro + trace both inbound paths before fixing.
- 🐛 **Objects changed by ANOTHER user (deleted / resized / rotated) stay stale in our cache** — sometimes
  correct after a later login, usually NOT even on hard reload. FS catches these because its cache is
  **CRC-validated**: on region entry it sends RequestMultipleObjects/CRC probes and the sim compares — any
  mismatch (resize/rotate bumps the CRC) triggers a fresh full ObjectUpdate; deletes come back as misses.
  Our preseed paints cached objects and trusts them. The DELETE half = the existing 🧠 **Stale-scene genuine
  deletes** item (confirmation-gated preseed); this report widens it to **mutation staleness** → same design
  pass: validate-on-entry (CRC probe or equivalent) + replace outdated cache rows. Even objects that get a live update and look right for a while later go back to stale state on later load from cache.  Related: ghost-reconcile
  (2026-07-02) only culls server-side-known deletes; crcMap poisoning history in [[crc-probe-audit-resolved]].

**2026-07-05 (from live-verifying the motion sweep):**
- 🐛 **All scripted motion pauses when the window loses focus** — pre-existing: `animate()` early-returns on
  `!document.hasFocus()` (useWorldEngine.js:4936, GPU/battery saver), which now freezes omega/DR/texture anims
  too. Gene: pausing makes sense for hidden/minimized, looks weird on mere focus-out. Candidate fix: gate on
  `document.hidden` instead (or step motion at low rate while unfocused-but-visible). Discuss before changing.
- 🐛 **Scripted pos-motion objects needed a touch to first start** (already moving in FS) — motion only arms
  from live raw updates (`_noteMotionUpdate`; cached linear vel deliberately untrusted). Investigate whether
  initial scene paint comes from cache preseed with no live terse until interest/select. Live-verify item.

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
- ✅ **Should be able to RIGHT-CLICK → Open a box** — PROMOTED 2026-07-04 → ⚡ **📦 Object Contents** cluster
  (full 6-step Xfer→parser→tab→Open pipeline scoped w/ FS+OpenSim cites).
- **Create tool NEEDED soon** (rez/create a prim in-world) → Object Build & Edit (Build-tools).
- ✅ **Drag world to select multiple & coalesced/multiple take/copy** — PROMOTED 2026-07-04 → 🛠️ Object edit —
  manipulation (needs-design: marquee + multi-selection state; multi-take already server-chunk-ready).
- ✅ **Working GIZMO handles NEEDED soon** — PROMOTED 2026-07-04 → 🛠️ Object edit — manipulation
  (M-1 encoder + M-2/M-3 fields batch-ready now; gizmo drag needs-design after M-1).
- ✅ **Scripted motion / scripted texture anim** — INVESTIGATED + PROMOTED 2026-07-04 → 🎬 Scripted motion &
  TextureAnim cluster. Root-cause candidates for "some works, some doesn't": omega ignored (E), no velocity DR (F),
  child-prim terse coords applied as local (G — the likely big one), TextureAnim unconsumed (A–D).
- **Neighboring regions** should be prioritized, THEN crossings → 🧠 Cross-region / neighbor sims (bump priority).
- ✅ **More SOUND** — PROMOTED 2026-07-04 → 🔊 Sound cluster (S-1…S-8; parcel/object *streaming* media stays 🧠).

*(Triaged pointers above; promote into clusters when a sweep targets them.)*
