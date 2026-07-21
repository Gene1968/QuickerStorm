# quickerSTORM — Changelog (what's done)

> **Append-only record of shipped work.** When a feature ships, its writeup lands here (newest first) and the
> line is deleted from [`ROADMAP.md`](ROADMAP.md). This file is **never re-read for planning** — it exists so
> the roadmap can stay short and you don't scroll past done-lines to see what's left.
>
> **Full pre-2026-07-14 detail** (every root-cause, cite, and fix note) is frozen in
> [`archive/FEATURE-GAPS-archived-2026-07-14.md`](archive/FEATURE-GAPS-archived-2026-07-14.md) and
> [`archive/FEATURE-GAPS-QUEUE-archived-2026-07-14.md`](archive/FEATURE-GAPS-QUEUE-archived-2026-07-14.md).
> Those files are **closed** — don't append to them.

## Format

```
## YYYY-MM-DD — <short title>  [committed <sha> | uncommitted]
- <what shipped, one line each>
```

Keep entries terse. Deep detail (root causes, FS/OpenSim cites) belongs in the commit body or an
`ai-sessions/` note, not here.

---

## Shipped to date (summary through 2026-07-14)

Condensed from the archive. Milestone **v0.3**.

### Foundation & networking
- Template-driven LLUDP codec (`server/lib/protocol/`) — encode/decode by message name from `message_template.msg`; caught 7 silently-wrong outbound encoders.
- Data-driven HTTP **caps** framework (call-by-name) — ViewerAsset, GetTexture/GetMesh(2), FetchInventoryDescendents2, CreateInventoryCategory, RenderMaterials, UploadBakedTexture, EventQueueGet long-poll (~20 more requested at login, handlers pending).
- Auto-login, 15 s circuit hold + session resume, clean logout, cross-region teleport.

### Rendering & assets
- PrimMesher port (full shape tessellation, GEOM_VERSION 4) · per-face TextureEntry · linksets.
- Mesh pipeline (GetMesh, worker-thread bake, IDB LRU) · sculpts · J2C→WebP transcode.
- **Camera-driven interest streaming** (bounded heap on ~24k-object regions) · **CRC object cache** (full scene from IDB on reload, zero sim re-fetch) · near-first load · warm-reload · texture/mesh/geom cache watchdogs · draw-distance governor.
- Terrain (var-region collision sizing) · ocean to horizon · day/night sky dome + exposure + procedural clouds · FS-like water.
- Particle systems (v1) · scripted motion & TextureAnim (omega, velocity DR, child-prim frame fix, cell/scroll anim).

### World interaction
- Object Build & Edit: create-prim, gizmo drag, link/unlink, texture drop, numeric pos/size/rot, editable prim-shape params, marquee select, multi-select drag.
- Right-click menus (object + avatar): sit/stand/ground-sit/fly, zoom, take/take-copy (perm-gated), buy/pay, invite-to-group, inspect · ClickAction left-click dispatch.
- Object contents (Xfer → task-inventory → Open) · ObjectProperties data (creator/owner names, link numbers, tri-state perms).
- Sound: triggers, attached loops, positional attenuation, 37 FS UI sounds, channel routing.

### Inventory
- Browse / filter / search / sort · rename / move / trash / perms · rez-to-world · give & accept-offer · take / copy · Ctrl-X/C/V · multi-select + folder/mixed drag · multi-instance texture preview · **data-loss-proof cache** (move-reconciliation state machine + non-shrinking save).

### Social & navigation
- Friends / contacts (rights table, add-by-name, notifications) · profile floater · saved multi-grid accounts.
- Nearby chat · Instant Messaging (direct) · Map 2D · rotating minimap with avatar dots.

### 2026-07-13 — Build-tools + right-click sweeps  [uncommitted / partially committed]
- See ROADMAP test-debt list; details in the archived queue file.

---

## 2026-07-21 — Finish-7·D A: jellydoll persistence + mesh-fetch retry  [uncommitted]
- **Missing body parts / attachments after load — root cause fixed.** `useMeshFetch`'s `failed` set was
  PERMANENT: one transient timeout under the 8–10 min cold-load (sim cap endpoint or client fetch aging out
  while thousands queue) stranded that mesh's part until a relog cleared module state. Now failures are
  retryable — `failed` is a Map of `{tries, at}`; `getMesh` re-fetches after a 15 s cooldown up to 6 tries,
  then gives up only if still failing (genuinely dead asset). The worn-mesh sweep's own cap was raised
  (5→40) so it spans getMesh's ~90 s retry window instead of retiring the mesh first. (Texture fetches
  already separated hard-fail from retryable soft-timeouts — left as-is; most of the `✗` count is the ~63
  known-dead textures pre-seeded from IDB.)
- **Jellydoll persists until a REAL body renders** (Gene: "disappears for a minute / only hair floating").
  Body-mode `covered` now requires a torso-covering mesh that's a live SkinnedMesh, visible, past
  geometry-reveal, with real triangles — not a placeholder/failed one. Settle 2 s→4 s. The 3 s sweep
  re-evaluates body mode so the doll returns if coverage later regresses. (True top+bottom gating isn't
  reliable from joint names — a shirt's rig lists leg joints — so gated on "a real body is rendered".)

## 2026-07-21 — Resync re-requests fresh state from the sim (no relog)  [uncommitted]
- **Root gap:** "Resync World" / "Rebuild Scene" only replayed the SERVER's CACHED updates + the CLIENT's
  cached worldStore — neither re-asked the sim. So state that went stale relative to the sim while it was
  out of our interest set (a peer avatar re-outfitted/moved — the "Gene@OS in Nearby, invisible" case) or a
  stuck inventory stayed broken until a full relog. Now resync recovers on the live circuit.
- **Objects (server + client):** `OBJ_CACHE_MISS` gains a `force` flag — it bypasses the `objCache.has`
  skip and routes ids to the CacheMissType=1 (full) `RequestMultipleObjects` drain, so the sim re-sends
  fresh ObjectUpdates even for objects we already cache. `rebuildScene` now force-re-requests every known
  avatar (the no-other-recovery case; prims still recover via the probe path); the fresh update rebuilds
  the mesh through `onObjectUpdate`. Pairs with the zombie-avatar reconcile for full coverage.
- **Inventory (client):** `resyncInventory()` (useInventory) drops all `fetched` markers (`inventoryStore
  .resyncFetched`), resets the retry/degraded latches, re-issues expanded folders, and restarts the walk —
  recovering a stuck inventory (folders that gave up as "fetched-empty" and told the user to relog) without
  a relog. Wired into MenuBar ▸ Resync World + Rebuild Scene and the ResyncBanner.

## 2026-07-21 — 7·D reload fixes: worn-mesh re-skin recovery + self-menu targeting  [uncommitted]
- **"Strange-size hair/clothing after reload" (recurring) fixed.** On the reload/probe path worn children
  build (baked, wrong size) before their avatar's skeleton exists; the only re-skin trigger was a later
  `mountChild`, and — the real sticking point — a *failed/empty* skin fetch left `skinRefetched=true`
  forever, so a transient miss (or the cold `:skin4` cache re-fetches failing under load) stayed wrong
  until relog. `refetchWornSkin` now only latches on a definite outcome (skinned, or genuinely rigid);
  fetch failure / no-skeleton-yet clears it for retry, with a per-mesh attempt cap. Added a throttled
  frame-loop **sweep** (`sweepUnskinnedWornMeshes`, 3 s) that re-drives skinning for any un-skinned mesh
  under an avatar that now has a skeleton — self-terminating (skinned skip, rigid latch, cap retires).
- **Appearance unreachable from own-avatar right-click — root-caused & fixed.** The avatar right-click
  raycast walked up only to the first mesh with a `localId`, which on a clothed avatar is a worn
  hair/clothing attachment — so `isSelf` compared the *attachment's* localId (≠ own) → the "other avatar"
  menu (no Appearance), and `agentId` was the attachment UUID. Now walks up to the `isAvatar` node, so the
  self menu (incl. Appearance ▸ Now-wearing/Outfits) shows and profile/IM/pay target the right avatar.
  (MenuBar ▸ Now-wearing/Outfits + Ctrl+O already worked.)
- Pre-existing reds noted (not from this work): `AvatarContextMenu.rightclick-sweep` (8, fully red on the
  committed tree) and `geomCache IDB FLUSH_MAX hard-flush` (1, timing) → docs/tech-debt.md.

## 2026-07-19 — 7·D: mesh-body joint-position overrides + pelvis fixup  [committed 50ec2ec]
- **Mesh bodies now reposition the skeleton to their own joint layout.** A rigged mesh ships its intended
  LOCAL joint positions in the skin block's `alt_inverse_bind_matrix` (translation column) + a
  `pelvis_offset`; we were ignoring both and skinning every body to the DEFAULT SL joint layout, so a body
  rigged with a lower pelvis / longer legs / wider hips rendered mis-proportioned. Ported from FS
  `llvoavatar.cpp` `addAttachmentOverridesForObject` (7719-7806) + `LLJoint::addAttachmentPosOverride`.
- **Server** (`meshDecode.ts` / `mesh.ts`) — decode `alt_inverse_bind_matrix` into `SkinInfo.altInverseBindMatrix`
  and forward it (+ `lockScaleIfJointPosition`) on the skin lane; cache lane bumped `:skinv4`→`:skinv5` so
  worn meshes re-decode with the new field; `skinDbg` now reports override + pelvis-offset counts.
- **Client** (`slSkeleton.js`) — `applyMeshJointOverrides(skel, skin, meshId)`: per joint, `jointPos` =
  alt matrix translation (row-major floats 12/13/14), applied to `bone.position` **and** `bone.userData.restPos`
  (so the AnimPlayer re-anchors to the mesh layout) only when above FS's 0.1 mm `aboveJointPosThreshold`;
  first mesh to claim a joint wins (a body sets the full set, a later shoe won't fight it). `pelvis_offset`
  lifts the whole avatar via the skeleton **root** (SL +Z → Three +Y), so a re-skin can't wipe it. Wired into
  `applySkinnedRig`. Pure translation — no `bone.scale`, so nothing fights THREE's scale cascade.
- **Sanity clamp (live-caught):** OSGrid hand/glove meshes ship a garbage `mPelvis` alt "position" ~9.6 m
  off default (hand joints themselves sane at mm-scale). FS trusts the exporter and would fling the joint;
  we reject per-joint deviations > 2 m (and non-finite) as malformed so one bad attachment can't wreck the
  skeleton. `applyMeshJointOverrides` now returns `{has,applied,below,rejected,claimed,pelvis}` and the
  engine logs `[AV] jointOvr …` whenever a rig carries override data (observable apply path).
- 8 client tests (`slSkeletonOverrides.test.js`): threshold gate, translation extraction, first-wins,
  idempotent re-apply, pelvis root-lift, safe no-op on absent/mismatched, **garbage-deviation reject**,
  **non-finite reject**.
- **Live smoke (MCP, OSGrid, 2026-07-20):** server runs the new code (363 `:skinv5` disk entries; `decodeSkinBlock`
  captured alt matrices on the 2 assets that carry them, 25j/28j); client receives them (`dbg=rig(25j,25ovr)`);
  needed a **client cache-lane bump** `:skin3`→`:skin4` (caught here — populated clients were serving stale
  skin without the field). No regressions: 3 avatars, 4668 objs, `upsertFails/placeholders/geoNaN=0`, 0 errors.
  **Bone-apply not visually demonstrated** — this account/region has NO body content with clean joint
  overrides (only the 2 malformed hand meshes in the whole cache), so `applied` stayed 0. Confirm the visible
  correction on a body that ships joint positions (SL Maitreya/Legacy/etc.) — the `[AV] jointOvr` log will show it.
- **Deferred (evidence-backed):** VisualParam *scale* deforms (Height/Thickness/Muscle/limb-length — the
  actual body-shape morphs) stay out because THREE cascades `bone.scale` to descendants while FS builds each
  joint's world matrix from its OWN scale (`LLXformMatrix::updateMatrix`) — a faithful port needs an invasive
  skinning workaround. VisualParam *position* offsets also deferred: parsed from `avatar_lad.xml` (transmit
  order = ascending-ID, validated idx25=id33 Height), only 6 transmitted params carry offsets and they move
  **wings/tail/hands** (mostly zeros), not body proportions — near-zero visible value without the scale path.

## 2026-07-19 — 7·D: runtime skeleton + AvatarAnimation playback  [uncommitted]
- **Live SL skeleton per avatar** — full Bento THREE.Bone hierarchy (133 bones + 26 collision
  volumes) generated from FS `avatar_skeleton.xml` (`shared/slSkeletonDef.js`, cross-checked exactly
  against the AV-1 `jointRestWorld` table); bones sit in the SL frame, one root conversion
  (`src/lib/slSkeleton.js`), built sync at avatar creation.
- **Runtime skinning replaces the AV-1 server bake** — the `:skin` mesh lane now ships RAW bind-space
  geometry + 4-influence joint indices/weights + the rig block (`skinv4` server / `skin3` client cache
  keys); client builds a THREE.SkinnedMesh bound to the live skeleton (row-major SL matrices land via
  `fromArray` = the row→column-vector transpose; `bindMode 'attached'` keeps placement 100% bone-driven).
  Zero-weight verts keep the FS joint-0 fallback. `meshSkin.ts` (bake) stays as tested reference.
- **Attachment points ride bones** — point groups parent to their SL joint's bone
  (`attachPointBoneLocal`: raw SL offset + point rot with the root conversion factored out), so rigid
  attachments and linkset-child proxies follow animation; id 40 (Avatar Center/mRoot) keeps the
  legacy avatar-node mount.
- **AvatarAnimation (High 20) decoded + forwarded** (`S.AVATAR_ANIMATION`) — full-state signaled set
  per avatar (FS `process_avatar_animation` semantics: same id + new seq = restart); cached per
  session and replayed on resync/probe-resync (like appearance) so nobody freezes at rest after reload.
- **.anim asset parser** (`shared/animDecode.js`, ported from FS `LLKeyframeMotion::deserialize`,
  bun-tested incl. legacy 0/1 format + constraint skip) + client fetch via the existing generic
  `ASSET_FETCH assetType:'animation'` path (`useAnimFetch.js`).
- **AnimPlayer** (`src/lib/animPlayer.js`) — hand-rolled sampler (NOT AnimationMixer): per-joint
  priority masking in ascending order, cubic-step ease in/out, loop-in/out cycling, seq restarts;
  writes bone locals each frame. 11 new client tests pin frames/blend/loop (`slSkeletonAnim.test.js`).
- Worn rigged meshes now walk/sit/fly with the avatar in OUR renderer (they were frozen at rest pose);
  jellydoll body keeps its GLB locomotion clips for now (retarget/retire = follow-up).
- **Pelvis pos-key fix (live-caught: whole body ~1m low)** — mPelvis pos keys are authored relative to
  the AVATAR ROOT (decoded live stand/walk assets: pelvis keys ≈ 0, not ~1.067), so they anchor at the
  pelvis REST position; every other joint's keys replace its local offset (wing-fold anims carry
  rest-magnitude values). **LIVE-VERIFIED (MCP, 2026-07-19): worn shirt/pants/hair at correct heights,
  animesh wings flapping frame-to-frame, own mesh body skinning in; zero client errors.**
- **Jellydoll = render MODE** (same day) — 'loading' (doll + attachments as they land) → 'body'
  (torso-covering skinned mesh in + 2s settle → doll hides, real outfit shows) ⇄ 'muted' (complexity
  proxy > `ui.avatarMaxComplexity` triangles, or Advanced/Dev ▸ **"Jellydoll all avatars"** → doll
  shown, worn hidden, FS complexity semantics). LIVE-VERIFIED: own avatar's full textured outfit
  (wings/hair/jacket/pants) replaces the doll after load.
- Follow-ups: complexity slider UI + FS ARC formula · skinned-mesh raycast/bounds precision ·
  VisualParam bone scaling (proportions) · alt inverse-bind joint offsets · constraints/IK ·
  classic/system bodies → **7·E**.

## 2026-07-19 — 7·C: login attachment rez (peers can finally see us)  [uncommitted]
- **Root cause of "invisible with floating label"** (as seen from FS): real viewers rez their COF
  attachments grid-side at login; QS never did, so the sim held ZERO attachments for us. Peers'
  viewers cleared the cloud on our AgentSetAppearance echo (valid params/bakes), and with a
  mesh-body outfit (FULL BODY ALPHA hides the system body) there was nothing left to draw.
- **`RezMultipleAttachmentsFromInv`** (Low 396) encoder + `C.INV_REZ_ATTACHMENTS` — chunked ≤4
  ObjectData per packet, shared CompoundMsgID. Client one-shot per login (armed in onCapsReady,
  12s settle): once the COF is readable and the sim demonstrably streamed no own-attachments,
  rez the COF's attachment links (deduped targets). A sim that auto-reattached is left untouched.
- LIVE: 16 attachments rezzed in 4 packets → sim streamed all 16 back parented to own avatar →
  **own outfit now assembles on the jellydoll in QS**, and the worn ZHAO AO's script BOOTED and
  spoke in local chat — grid-side rez confirmed. Peer-side FS visual check with Gene.

## 2026-07-19 — 7·B-5: attachment placement fixes + peer-avatar resync  [uncommitted]
- **Ancestor-aware worn-mesh skinning** — `isWornMeshAttachment` now matches ANY mesh descendant of
  an avatar, not just attachment roots: a Bento body linkset's 246 child meshes were taking the
  plain lane and rendering unskinned at the proxy (Gene's "7-8m pants beside the jellydoll"). Plus
  **skin recovery for the ordering race**: on the IDB/probe reload path children usually build
  before their avatar chain is known — `refetchWornSkin` re-fetches via the :skin lane when a mesh
  joins an avatar subtree (one-shot, rigid meshes no-op and keep their point/proxy placement).
  LIVE: DW body went 7 → 196+/246 skinned, outfit assembles on the avatar.
- **Skin-lane concurrency gate** — the :skin lane bypasses the budgeted geometry pump by design, so
  246 simultaneous full-LOD fetch+bakes blew the JS heap to 97% and the soft-heap brake froze the
  whole scene at 547 objs. `enqueueSkinFetch` caps it at 4 in flight (heap now stable ~1GB through
  a full rebuild).
- **Attach-point euler order** — SL composes fixed-axis X→Y→Z (`q = qz·qy·qx`) = three.js `'ZYX'`,
  not `'XYZ'`; wrong order visibly mis-rotated Chest/Spine mounts (the "shirt rotated 90° forward").
- **Peer avatars replayed on probe-resync** — peers are never client-cached and the sim won't
  re-blast them, so a reloaded client had an empty Nearby until a manual rebuild (Gene, live).
  Cached avatar ObjectUpdates now re-send at the engine-ready moment; attachments re-adopt via
  orphansByParent. LIVE: Nearby populates immediately after reload.
- Dev aid: `window.__qs = { meshMap }` (DEV only) for live scene forensics alongside the Pinia
  console pattern.

## 2026-07-18 — Bundle 7·B-4: COF write side (wear/unwear)  [uncommitted]
- **COF link maintenance** — wear/detach now keep the Current Outfit Folder truthful, viewer-managed
  per FS/OpenSim (no AIS3 slam): wear = `LinkInventoryItem` (Low 426, new encoder; ack lands via the
  normal UpdateCreateInventoryItem→INV_ITEM_CREATED path), unwear = `RemoveInventoryItem` with the
  LINK's id. Central in `useInventory` (`createCofLink`/`cofLinkFor`), so attachments wear/detach
  from ANY surface maintain their links too.
- **Clothing/body-part wear** — new `AgentIsNowWearing` (Low 383) encoder + `C.AGENT_WEARING`: the
  FULL worn wearables set (classic one-slot-per-type; layering UI later). `wearWearable` (replace
  same type) + `takeOffWearable` (clothing only — body parts replace-only, FS parity). No visual
  change until the bake pipeline; keeps COF, sim wearables table, and "Now wearing" truthful.
- **Surfaces** — Appearance floater Wearing tab rows get hover ✕ (Detach / Take off); inventory
  context menu "Wear" now ENABLED for clothing/body parts (was disabled "needs appearance bake").
- LIVE-verified on OSGrid: take-off → `RemoveInventoryItem` + `AgentIsNowWearing (8)`, floater count
  10→9; re-wear via context menu → `LinkInventoryItem` + `AgentIsNowWearing (9)`, link ack row back
  in the COF. Note: OpenSim COFs contain BOTH links and real item copies — the read model handles both.

## 2026-07-18 — Bundle 7·B: attachment-point mounting + linkset decouple + locomotion  [uncommitted]
- **Attachment-point mounting (7·B-1)** — rigid (non-rigged) attachments mount at their named SL
  attachment point instead of piling at the feet. Server forwards the ObjectUpdate `State` byte
  (attachment-point id in the high nibble); new `src/lib/attachmentPoints.js` carries the full FS
  `avatar_lad.xml` point table (ids 1-55 incl. Bento; joint + offset + rotation) + the
  `ATTACHMENT_ID_FROM_STATE` nibble swap + SL default-skeleton rest positions (from the AV-1
  `avatarSkeleton.ts` table). Points materialize as per-avatar Groups; the wire pos/rot of an attached
  root are point-local (FS `llviewerjointattachment.cpp` composition), so existing child-transform
  writes land correctly. HUD points (31-38, `mScreen`) are parked hidden — never world-rendered.
  Rest-pose mounting: points don't follow the idle animation yet (comes with real SL animations).
- **Linkset-attachment child prims (7·B-2)** — a rigged root's linkset children no longer fall to the
  pile: the skinned mesh keeps the AV-1 bind-pose contract while a proxy Group parked at the root's
  sim transform (inside its attachment-point group) carries the children; the root's suppressed
  pos/rot updates drive the proxy. Rigged meshes routed into a point group before their skin decode
  are hoisted back to the avatar node (AV-1 contract preserved).
- **Locomotion (7·B-3 core)** — jellydolls play `Walk_Loop` when actually moving (world-space speed
  > 0.35 m/s), `Sitting_Idle_Loop` when parented to a prim, `Idle_Loop` otherwise (0.2s crossfades).
  LIVE: peers' hair/shoes mount at head/feet on OSGrid; no console errors through login+movement.
  *Remaining in ROADMAP 7·B: capsule LOD fallback, tube-retirement gate, COF write side.*

## 2026-07-18 — Bundle 7·A appearance read-model + 7·C AgentSetAppearance echo  [uncommitted]
- **VisualParams decode (7·A)** — server parses the `AvatarAppearance` (Low 158) VisualParam byte array
  (ascending-ID tweakable sequence, no ids on the wire — FS `llvoavatar.cpp parseAppearanceMessage`) and
  estimates avatar **height** via the OpenSim `AvatarAppearance.SetHeight()` formula (`server/lib/appearance.ts`,
  param indices per OpenSim `VPElement`). Forwarded as `params`+`height` on `S.AVATAR_APPEARANCE`; stored
  per-avatar in `worldStore._appearance`. LIVE: 218 params / 1.691 m decoded for own avatar on OSGrid.
- **Shape → placeholder (7·A)** — jellydoll scales to the decoded height (feet at −height/2), re-applied
  when appearance arrives late (`applyJellydollShape` in `useWorldEngine.js`). Avatars stop being uniform 1.8 m.
- **COF read → real "Now wearing" (7·A)** — new `useCurrentOutfit.js` reads the Current Outfit Folder
  (type 46), resolves link items (assetType 24 → target via `assetId`), classifies body-part/clothing/
  attachment per FS (`AT_BODYPART`/`AT_CLOTHING`/`AT_OBJECT`; wearable sub-type = flags & 0xff,
  `LLWearableType::inventoryFlagsToWearableType`). `AppearanceFloater.vue` Wearing tab now shows the real
  outfit (was hardcoded from the legacy social avatarStore); refetches on own CofVersion bump. LIVE:
  8 body parts / 10 clothing / 32 attachments with real item names.
- **AgentSetAppearance echo (7·C first pass)** — when our OWN inbound `AvatarAppearance` arrives, the server
  re-sends `AgentSetAppearance` with the echoed VisualParams + bake TextureEntry, computed Size.Z, and a
  monotonic SerialNum (shared with the movement-complete stub; dedup key breaks the sim-rebroadcast loop).
  The sim now holds a REAL ScenePresence.Appearance → peers can resolve us past the red cloud. LIVE: echo
  sent+acked (serial=2, 218 params, 155 B TE); **peer-visual check from a second viewer still pending**.
- **Codec fix: absent trailing blocks** — `protocol/codec.ts decode()` treated a missing trailing block
  (older OpenSim omits `AppearanceData`/`AppearanceHover`/`AttachmentBlock` — e.g. OSGrid) as a thrown
  range error, dropping the WHOLE message — every `AvatarAppearance` on OSGrid was silently lost (bakes
  included; jellydolls only worked on sims sending the newer tail). Now past-the-end = "block not sent".
- **Appearance resync replay** — per-avatar appearance payloads cached server-side (`session.appearanceCache`)
  and replayed on `replayCachedWorld` + probe-resync, so peers (and own height) don't re-cloud after reload.
  Cleared on region cross (destination sim re-broadcasts). LIVE-verified across reload.

## 2026-07-17 — Jellydoll humanoid avatar placeholder  [uncommitted]
- **Avatars are a rigged humanoid now, not a tube.** A shared low-poly rigged-humanoid GLB
  (`src/assets/3d/avatar-default.glb` — 67-bone skeleton, 11 baked clips) stands in for every avatar
  until we decode real shape/skin/attachments — mirroring FS, which renders unresolved/too-complex
  avatars as the muted system-avatar humanoid ("jellydoll").
- Loaded once, cloned per avatar via `SkeletonUtils.clone` (shared geometry, per-clone material), scaled
  to 1.8m with feet on the `−RIG_FOOT_OFFSET` contract (lines up with rigged attachments), tinted
  per-UUID via `applyAvatarLook` (self=green, peers=jellydoll color, translucent while 'cloud'), and
  **idle-animated** (one `AnimationMixer` per avatar, `Idle_Loop`, advanced in the render loop).
- Capsule/arms/face-box kept hidden as a fallback if the GLB fails to load. Cleanup wired: mixer stopped
  + per-clone material disposed on removal, shared geometry preserved. `src/lib/avatarModel.js` (new) +
  `useWorldEngine.js`. Also corrected an earlier misconception: there was never a "humanoid-tee" — the
  only prior placeholder was the tube; cloud/jellydoll were always just its translucent/solid states.

## 2026-07-17 — AV-1 followup: avatar facing (+X-forward reconcile)  [uncommitted]
- **Avatars now face the right way.** Reconciled the split forward-axis convention onto SL-native **+X-forward**
  everywhere. Was: own avatar/camera used −Z-forward while peers + rigged meshes used +X (SL `bodyRot`), so the
  own avatar's rigged clothing sat 90° off its capsule, and peers' face indicator pointed 90° off their heading.
- Client-only (`useWorldEngine.js`): placeholder geometry authored in the +X frame (face box local −Z → +X;
  arm tubes ±X → ±Z sides); own-avatar node `rotation.y = yaw + π/2` so its local +X tracks camera/heading;
  rigged mesh stays identity (**no per-mesh rotation hack**). Peers needed no change — the fix corrected their
  face box for free. Own spawn heading already seeded from the login `bodyRot`.
- Verified live against the 1–2 aligned rigged meshes available. Camera/movement math read `yaw` independently,
  so input-driven controls are untouched.

## 2026-07-15 — AV-2: per-UUID jellydoll avatars + AvatarAppearance decode  [uncommitted]
- **Peer avatars are now visually distinct.** Each gets a deterministic per-UUID color ported from Firestorm
  `LLVOAvatar::calcMutedAVColor` (first UUID byte → 7-stop spectrum lerp, normalized, brightness-scaled) —
  `src/lib/avatarColor.js` (6 unit tests). Replaces the uniform hardcoded cyan capsule; self stays green.
- **Honest appearance-state.** An avatar with no `AvatarAppearance` yet renders **translucent** ('cloud' — we
  genuinely don't know their look); once the sim's bakes arrive it goes **solid** ('jellydoll'). State +
  baked-texture UUIDs cached in `worldStore` (`setAvatarAppearance`/`avatarAppearance`) for the bake pipeline.
- **Server decodes `AvatarAppearance` (Low 158)** — previously dropped at the unhandled-packet fallthrough.
  New handler in `lludp.ts` forwards `S.AVATAR_APPEARANCE { avatarId, bakes{head,upper,lower,eyes,skirt,hair},
  appearanceVersion, cofVersion }`. Bake face indices verified against FS `llavatarappearancedefines.h`
  (HEAD8/UPPER9/LOWER10/EYES11/**SKIRT19/HAIR20** — not 12/13). Bakes are captured, not yet composited/rendered
  (that's the bake pipeline, bundle 7 · Beta-2).

## 2026-07-15 — Texture / image upload → inventory (J2C encode)  [uncommitted]
- **Upload Image (Texture)** from disk (png/jpg/gif/webp/bmp) via `NewFileAgentInventory` — wired on **every**
  surface through the shared `useUploadActions.uploadTexture()`: inventory **+** menu, MenuBar ▸ Build ▸ Upload,
  MenuBar ▸ quickerSTORM ▸ Import. (The last disabled "needs J2C encode" upload entries are now live.)
- **Server-side J2C encode** (`server/lib/j2c.ts` `encodeJ2C`) — the browser can't emit J2C, so the client
  decodes the image (`createImageBitmap`→canvas), scales to power-of-two ≤1024 (FS parity), strips alpha when
  fully opaque (SL 3-comp convention), and ships raw pixels; Bun encodes to a **raw J2C codestream** and runs
  the 2-step cap upload. GOTCHA locked in a test: magick's `J2c` format is a JP2 *container* — SL wants the raw
  codestream magick calls `J2k` (SOC/SIZ `FF 4F FF 51`). Byte-exact lossless round-trip + alpha preservation
  verified (`server/__tests__/j2c.test.ts`).
- `useAssetUpload.uploadNewImage(pixels,w,h,channels)` is the reusable pixels→inventory primitive; snapshot→
  inventory (bundle 17) rides it directly (supply canvas pixels instead of a decoded file).

## 2026-07-15 — Sound upload (all surfaces) + sound preview  [uncommitted]
- **Upload Sound (OGG)** from disk via `NewFileAgentInventory` — wired on **every** surface through one shared
  `useUploadActions.uploadSound()`: inventory **+** menu, MenuBar ▸ Build ▸ Upload, MenuBar ▸ quickerSTORM ▸
  Import/Upload. (Image/Animation/etc. stay disabled with a "needs J2C encode" tooltip.)
- Uploads route to the **Sounds** system folder when nothing's selected (was landing at root); the new item
  shows immediately (optimistic `addCreatedItems`, de-duped) instead of only after a hard reload.
- **Sound preview** — double-clicking a sound now plays it (`useSoundEngine.previewSound`: fetch + decode +
  play once, non-positional, full gain), replacing the "not supported yet" toast.

## 2026-07-15 — Asset-upload framework + notecard/script editor  [uncommitted]
- **Reusable 2-step HTTP-cap uploader** (`server/lib/caps/assetUpload.ts`): `uploadNewAsset`
  (NewFileAgentInventory) + `updateItemAsset` (Update{Notecard,Script}AgentInventory), injectable-fetch,
  unit-tested. Client `C.ASSET_UPLOAD`→`S.ASSET_UPLOAD_RESULT` binary transport (base64 over WS).
- **Create blank notecard/script** — `C.CREATE_INV_ITEM` (CreateInventoryItem Low 305, type/invType per kind);
  the sim's `UpdateCreateInventoryItem` reply lands it, then it auto-selects + opens inline rename.
- **Notecard/script editor** (`TextAssetEditorFloater.vue`) — open (ViewerAsset `notecard_id`/`lsltext_id`) →
  edit → **Save** (uploads via the update cap) → reopen shows saved text. Description row, live byte count,
  Ctrl+S, Delete-to-Trash. Titlebar tracks live inventory renames.
- Wires: inventory **+** menu and folder right-click **New Notecard/Script** (were dead-disabled); double-click
  open dispatch for notecard/script.
- Fixes: added the upload caps to the login seed-request (`login.ts`) — was the `cap_unavailable` cause;
  new items now create in the selected folder (`resolveTargetFolder`); save repoints the item's `assetId` to
  the sim's new immutable asset (`setItemAssetId`) so reopen isn't stale.
- `src/lib/assetSerialize.js` — Linden-text-v2 notecard envelope + type maps (11 tests). Spec:
  `docs/superpowers/specs/2026-07-15-asset-upload-notecard-script-design.md`.

*(New shipped entries go above this line, newest first.)*
