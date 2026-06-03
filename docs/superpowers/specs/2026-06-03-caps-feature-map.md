# Caps & Server-Call Feature Map

**Date:** 2026-06-03
**Companion to:** `2026-06-03-caps-feature-map-design.md`
**Sources traced:** phoenix-firestorm (client truth), opensim (server truth), libomv via FS.
**Status:** Map assembled from parallel FS→OpenSim tracing. NOT live-verified — exact field
names/offsets are from source reading; verify on first slice.

---

## ⚠️ Cross-Cutting Findings (read first — these reshape every slice)

These are the things we kept guessing wrong. OpenSim ≠ Second Life on the cap surface:

1. **OpenSim has NO AIS3.** No `InventoryAPIv3` / `LibraryAPIv3` anywhere in the codebase.
   Every inventory MUTATION (create/rename/move/copy/delete/link/unlink) is **LLUDP**, not a
   REST cap. FS gates all AIS3 behind `AISAPI::isAvailable()` → false on OpenSim → UDP fallback.
   The AIS3 REST shapes are documented below only for completeness / future SL support.

2. **OpenSim has NO `AgentProfile` cap.** All profile read/write = LLUDP
   (`AvatarPropertiesRequest`/`Update`, `GenericMessage` for picks/notes/classifieds).

3. **OpenSim has NO server-side baking** (`UpdateAvatarAppearance` cap absent;
   `getCentralBakeVersion()==0`). Appearance is **client-bake**: composite locally →
   `UploadBakedTexture` cap → `AgentSetAppearance` LLUDP. Sim requests rebakes via
   `RebakeAvatarTextures`.

4. **OpenSim has NO `RequestTaskInventory` cap** (prim contents). UDP only:
   `RequestTaskInventory` → `ReplyTaskInventory` (filename) → **Xfer** download of a NameValue
   text file. We must implement the Xfer protocol for prim contents.

5. **J2C (JPEG2000) decode is THE keystone blocker.** Textures, mesh skin, map tiles, profile
   images, terrain detail — all return `image/x-j2c`, which browsers can't decode natively.
   Decision needed: **server-side transcode** (openjpeg → PNG, simpler client, CPU on Bun) vs
   **WASM in browser** (openjpeg.wasm, no server CPU, bigger bundle). Recommend server-side
   transcode first — same problem already half-solved for terrain tiles.

6. **`ViewerAsset` is the one unified cap** for textures/mesh/sound/anim/etc. — but it's NOT in
   our `REQUESTED_CAPS` (`login.ts`). Add `ViewerAsset`, `GetMesh`, `RenderMaterials`,
   `ModifyMaterialParams`, `UploadBakedTexture` to the requested list.

7. **Binary over the cap proxy.** `caps.ts` currently forwards `text` only. Asset fetch needs
   binary + `Range` header passthrough + binary WS frames (or base64). Extend the proxy before
   any asset slice.

8. **LLSD Binary parser needed.** `llsd.ts` is XML-only. Mesh headers + several caps use LLSD
   **Binary**. Add a binary decoder.

9. **EventQueue (EQ) delivery.** Neighbor sims (`EnableSimulator`/`EstablishAgentCommunication`),
   `ParcelProperties`, and `BulkUpdateInventory` (after take/buy) arrive via EQ, not bare LLUDP.
   Our [[teleport-debugging]] note (EventQueueGet missing) blocks ALL of these. EQ is a
   prerequisite for clusters C (take/buy), G (neighbors/parcel).

---

## Slice Plan (dependency-ordered login sessions)

| Slice | Cluster(s) | Verifies in one login session | Blocked by |
|-------|-----------|-------------------------------|-----------|
| **0. Plumbing** | binary cap proxy + J2C transcode + LLSD-binary + EQ | a single texture UUID renders | none |
| **1. Asset fetch** | A | prim faces textured; mesh objects render | slice 0 |
| **2. Materials** | D | faces show color/shiny/glow; PBR base color | slice 1 |
| **3. Inventory mgmt** | B | move/rename/delete item in tree persists | none (UDP) |
| **4. Object interaction** | C | open prim contents; take object → appears in inv | 1 (preview), EQ |
| **5. Appearance** | E | other avatars wear correct skin/clothes; we wear an item | 1, 3 |
| **6. Profile** | F | profile shows bio + image; edit bio persists | 1 |
| **7. World/region** | G | neighbor terrain renders; land panel prim count | slice 0 (EQ) |
| **8. Suitcase** | H | HG session shows suitcase subtree | 3 |

---

# Cluster A — Asset Fetch Foundation

> Keystone. `ViewerAsset` cap is the unified entry; `GetTexture`/`GetMesh2` are fallbacks.
> Add `ViewerAsset`, `GetMesh` to `REQUESTED_CAPS`. Extend `caps.ts` for binary GET + Range.

### A1. Texture fetch (`GetTexture` / `ViewerAsset`)
- **Transport:** HTTP cap GET. Preference: `ViewerAsset` > `GetTexture`.
- **FS:** URL build `lltexturefetch.cpp:1401-1414` (`viewerAssetUrl + "/?texture_id=" + uuid`);
  dispatch `:1670-1678`; `Accept: image/x-j2c` `:2742`; range logic `:1612-1628`
  (offset = `cur_size-1`, open-ended `bytes=N-` when end > 20,000,000); first fetch 600 B header.
- **OpenSim:** `GetTextureHandler.cs` / `GetTextureRobustHandler.cs:75`; cap reg
  `GetAssetsModule.cs:347-358`; range `:202-265`; `texture_id` query param.
- **Request:** `GET {cap}/?texture_id={uuid}` + `Range: bytes={off}-{off+size-1}` (or `bytes=N-`)
  + `Accept: image/x-j2c`. No body.
- **Response:** 206/200 `Content-Type: image/x-j2c` + `Content-Range: bytes s-e/total` + raw J2C.
  **404 = also returned when range start ≥ size** (treat as "fully received" if bytes already held).
  Discard levels 0(full)–5(thumb); each is a byte-range prefix.
- **Frontend:** `useTextureFetch.js` (range pipeline) → `textureStore` cache → Three.js
  `CanvasTexture`/`DataTexture`. Server: extend `caps.ts` binary + base64 WS frame.
- **Verify:** prim faces, wearable textures, map tiles show.

### A2. Mesh fetch (`ViewerAsset` / `GetMesh2` / `GetMesh`)
- **Transport:** HTTP cap GET, two-phase (header then LOD by range).
- **FS:** cap select `llmeshrepository.cpp:1464-1516,4754-4757`; `Accept: application/vnd.ll.mesh`
  `:977`; header fetch `:2017-2102` (always `bytes=0-4095`); LOD `:2105`
  (`offset=headerSize+header.mLodOffset[lod]`); skin `:1579`.
- **OpenSim:** `GetMeshHandler.cs:59-153`; unified `GetAssetsHandler.cs:100-194` (`mesh_id`).
- **Request:** `GET {cap}/?mesh_id={uuid}` + `Range: bytes={off}-{off+len-1}` + Accept mesh.
- **Response (header, first 4 KB):** optional 17-byte `<? LLSD/Binary ?>` prefix stripped, then
  **LLSD Binary** map: `version`, `high_lod`/`medium_lod`/`low_lod`/`lowest_lod`/`skin`/
  `physics_convex`/`physics_mesh` each `{offset,size}`. **Offsets relative to END of header**
  (absolute = `headerSize + offset`; headerSize = stream pos after LLSD parse, NOT 4096).
  LOD index map `[0]=lowest,[1]=low,[2]=medium,[3]=high`.
- **Response (LOD/skin):** zlib **deflate-raw** compressed; LOD = SL `LLVolumeFaces` binary
  (pos/normal/UV/index); skin = `unzip_llsd()` map `joint_names`, `inverse_bind_matrix`,
  `bind_shape_matrix`, `weight_influences`.
- **Frontend:** `useMeshFetch.js` → `THREE.BufferGeometry`. Needs LLSD-binary parser + pako/
  DecompressionStream. Mesh UUID comes from ObjectUpdate `SculptTexture` (SculptType=5).
- **Verify:** mesh objects render with LOD geometry.

### A3. `ViewerAsset` unified cap
- **Cap:** `ViewerAsset` (OpenSim config `Cap_GetAsset`, registered string `ViewerAsset` —
  two different strings, don't confuse). `GetAssetsModule.cs:387-398`, handler
  `GetAssetsHandler.cs:51-194`.
- **Query key → type:** `texture_id`→Texture(`image/x-j2c`), `mesh_id`→Mesh(`vnd.ll.mesh`),
  `sound_id`→Sound(`audio/ogg`), `snd_wav_id`→WAV, `animatn_id`→Animation(`vnd.ll.animation`),
  `gesture_id`, `notecard_id`, `lsltext_id`, `lslbyte_id`, `clothing_id`, `bodypart_id`,
  `landmark_id`, `material_id`→GLTF(`application/llsd+xml`). FS: `llviewerassetstorage.cpp:600,
  691-695` (`cap + "/?" + LLAssetType::lookup(atype) + "_id=" + uuid`).
- **Frontend:** single `handleAssetFetch(assetType, uuid, range?)` server fn; lookup order
  ViewerAsset → type-specific fallback.

### A4. J2C decode (client-side, no network)
- **FS:** `LLImageJ2C` (`llimagej2c.cpp`, OpenJPEG) / Kakadu. 600 B = header
  (SOC/SIZ/COD/QCD). Discard 0=full, 5=thumb.
- **Decision:** raw `.j2c` codestream — `createImageBitmap()` rejects it. **Server-side transcode**
  (Bun shells `opj_decompress` or openjp2 binding → PNG) recommended; or `openjpeg.wasm` client.
- **Frontend:** server J2C→PNG → `createImageBitmap` → `CanvasTexture`.

### A5. Sound fetch (`ViewerAsset?sound_id=`)
- 200 `audio/ogg` raw Vorbis. Browser `decodeAudioData()` (Safari needs polyfill).
  `useAudio.js` cache by UUID.

### A6. Animation fetch (`ViewerAsset?animatn_id=`)
- 200 `application/vnd.ll.animation` — SL custom binary (NOT standard BVH): header
  version/priority/duration/loop + per-joint rot/pos keyframes (U16-scaled). Non-trivial JS
  decode → **defer** for Phase 3 (default pose sufficient).

**Cluster A gotchas:** `ViewerAsset`/`GetMesh` missing from REQUESTED_CAPS; 404-not-416 on
range overshoot; open-ended `bytes=N-` must pass verbatim; mesh header is LLSD **Binary** not XML;
LOD offset relative to headerSize; LOD data is `deflate-raw`; skin may be within first 4 KB;
J2C not browser-native; GetMesh v1 uses slower policy class.

---

# Cluster B — Inventory Management

> **OpenSim = LLUDP for all mutations.** Reads use existing `FetchInventoryDescendents2` cap.
> Reduce our `BATCH=40` → 10 (FS max_batch_size), ≤12 concurrent.

### B1. Fetch folder descendents (WORKING — reference pattern)
- **Cap:** `FetchInventoryDescendents2` (agent), `FetchLibDescendents2` (library, `owner_id` =
  library owner UUID). FS `llinventorymodelbackgroundfetch.cpp:1393-1409`; OpenSim
  `FetchInvDescHandler.cs:67`, reg `WebFetchInvDescModule.cs:345`.
- **Request (LLSD):** `{folders:[{folder_id,owner_id,sort_order,fetch_folders,fetch_items}]}`.
- **Response:** `{folders:[{folder_id,owner_id,agent_id,descendents,version,
  categories:[{category_id,parent_id,name,type_default,version}],
  items:[{item_id,parent_id,name,desc,type,inv_type,asset_id|shadow_id,flags,
  permissions:{creator_id,owner_id,group_id,base_mask,owner_mask,group_mask,everyone_mask,
  next_owner_mask},sale_info:{sale_type,sale_price},created_at}]}],bad_folders:[...]}`.
  Sub-folders use key **`category_id`**, top-level uses `folder_id` — parser must handle both.
  Link targets are pre-pended into `items` (don't dedupe).

### B2. Fetch single item — cap `FetchInventory2` / `FetchLib2`
- `POST {cap} {agent_id,items:[{owner_id,item_id}]}` → `{agent_id,items:[<item>]}`.

### B3. Create folder — **LLUDP `CreateInventoryFolder`**
- `[AgentData]{AgentID,SessionID}[FolderData]{FolderID(client-gen),ParentID,Type(S8 LLFolderType),
  Name}`. No callback — generate UUID client-side, add optimistically. OpenSim
  `Scene.PacketHandlers.cs:641`.

### B4. Rename/update item — **LLUDP `UpdateInventoryItem`**
- `[AgentData]{AgentID,SessionID,TransactionID}[InventoryData]{ItemID,FolderID(current parent req),
  CallbackID,Type,InvType,Flags,SaleType,SalePrice,Name,Description,NextOwnerMask,...perms,
  CreationDate}`. Reply: `UpdateCreateInventoryItem`→`BulkUpdateInventory`. OpenSim
  `LLClientView.cs:10165`.

### B5. Rename/update folder — **LLUDP `UpdateInventoryFolder`**
- `[FolderData]{FolderID,ParentID(req),Type,Name}`. No reply. OpenSim `Scene.PacketHandlers.cs:662`.

### B6. Move item — **LLUDP `MoveInventoryItem`**
- `[AgentData]{...,Stamp:BOOL}[InventoryData]{ItemID,FolderID(dest),NewName(""=keep)}`. Reply
  `BulkUpdateInventory`. OpenSim `LLClientView.cs:10211`. (NewName rename-on-move unreliable.)

### B7. Move folder — **LLUDP `MoveInventoryFolder`**
- `[InventoryData]{FolderID,ParentID(new)}`. No reply. OpenSim `LLClientView.cs:10084`.

### B8. Copy item — **LLUDP `CopyInventoryItem`**
- `[InventoryData]{CallbackID,OldAgentID,OldItemID,NewFolderID,NewName}`. Reply
  `UpdateCreateInventoryItem`. OpenSim `LLClientView.cs:10197`.

### B9. Delete (soft = move to Trash) / hard delete
- Soft: `MoveInventoryItem` to Trash UUID (`findCategoryUUIDForType(FT_TRASH)`). Hard:
  **`RemoveInventoryItem`** `[InventoryData]{ItemID}` — OpenSim hard-deletes (`DeleteItems`, no
  server soft-delete). Folders: `MoveInventoryFolder` to trash, then `RemoveInventoryFolder`
  `[FolderData]{FolderID}`.

### B10. Purge (empty trash) — **LLUDP `PurgeInventoryDescendents`**
- `[InventoryData]{FolderID}` (single). No reply; clear store immediately. OpenSim
  `LLClientView.cs:10159`.

### B11. Link / unlink — **LLUDP `LinkInventoryItem`** / `RemoveInventoryItem`
- Link: `[InventoryBlock]{CallbackID,FolderID(e.g.COF),TransactionID(null),OldItemID(linkee),
  Type(AT_LINK=24/AT_LINK_FOLDER=25),InvType,Name,Description}`. Reply
  `UpdateCreateInventoryItem`; link's `assetId`=OldItemID. Unlink = `RemoveInventoryItem` with
  the **link's** UUID (not target). OpenSim `LLClientView.cs:10115`.

**Cluster B gotchas:** NO AIS3 on OpenSim; delete=move-to-trash client-driven; link UUID vs target
UUID; `category_id` vs `folder_id` keys; lib uses library-owner UUID; COF has no atomic
slam (send individual link/move/remove); batch ≤10.

*(AIS3 REST verbs for future SL support: `POST /category/{parent}?tid=`, `PATCH /item/{id}`,
`DELETE /item/{id}`, `PUT /category/{cof}/links?tid=`, `GET /category/current/links`, envelope
`{_created_items,_updated_category_versions,_embedded:{items,categories,links}}`.)*

---

# Cluster C — Object Interaction

> Selection/properties = LLUDP. Prim contents = UDP + **Xfer**. Take/buy → inventory via **EQ**.

### C1. Select / deselect — `ObjectSelect`(Low110)/`ObjectDeselect`(Low111), SEND_INDIVIDUALS
- `[AgentData]{AgentID,SessionID}[ObjectData]{ObjectLocalID}` (all prims). Sim async-sends
  `ObjectProperties`(Med9). FS `llselectmgr.cpp:523,5532`; OpenSim `LLClientView.cs:9440`.

### C2. ObjectProperties (reply, Med9) + ObjectPropertiesFamily (Med10)
- Full props: `ObjectID,CreatorID,OwnerID,GroupID,CreationDate(U64),Base/Owner/Group/Everyone/
  NextOwnerMask,SaleType(U8),SalePrice,Category,InventorySerial(S16),ItemID,LastOwnerID,
  Name,Description,TouchName,SitName,TextureID(packed UUIDs)`. Family (hover, Med5 request →
  Med10): lighter, uses **full ObjectID UUID not LocalID**. FS `:6178,6410`.

### C3. Task inventory (prim contents) — **UDP + Xfer** (no cap on OpenSim)
- Request `RequestTaskInventory`(Low289) `[InventoryData]{LocalID}`. Reply
  `ReplyTaskInventory`(Low290) `{TaskID,Serial(S16),Filename}`. Empty filename = no contents.
  Then `RequestXfer`→`SendXferPacket` streams a NameValue **text** file (not LLSD): per-item
  `item_id,parent_id,permissions{...},asset_id,type,inv_type,flags,sale{...},name|,desc|,
  creation_date` (**strip trailing `|`**). FS synthesizes virtual "Contents" category
  `llviewerobject.cpp:3341,3453,3590`. OpenSim `Scene.Inventory.cs:1284`,
  `SceneObjectPartInventory.cs:1453`.
- **Frontend:** must implement Xfer protocol. `objectStore.taskInventory[primUUID]`.

### C4. Task inv mutations — `UpdateTaskInventory`(286)/`RemoveTaskInventory`(287)/`MoveTaskInventory`(288)
- Move (take item out): `[AgentData]{...,FolderID(dest)}[InventoryData]{LocalID,ItemID}` → reply
  `BulkUpdateInventory`. FS `llviewerobject.cpp:2928,3672,3750`.

### C5. DeRezObject (take/take-copy/delete/return) — `DeRezObject`(Low291), SEND_ONLY_ROOTS
- `[AgentBlock]{GroupID,Destination(U8 DeRezAction),DestinationID(folder|Zero),TransactionID,
  PacketCount,PacketNumber}[ObjectData]{ObjectLocalID}`. **DeRezAction:** 0=SaveToExisting,
  1=TakeCopy, 4=Take, 6=Delete(→Trash UUID), 9=Return. Multi-packet for big selections (same
  TransactionID, ≤~50 roots/packet). Result via **EQ `BulkUpdateInventory`**. FS
  `llselectmgr.cpp:4440,5825`; OpenSim `LLClientView.cs:8908`, `Scene.Inventory.cs:2217`.

### C6. ObjectBuy — `ObjectBuy`(Low102), SEND_ONLY_ROOTS
- `[AgentData]{...,GroupID,CategoryID(Objects folder)}[ObjectData]{ObjectLocalID,SaleType,
  SalePrice}`. Sim **validates price/type against live props** → `AgentAlertMessage` on mismatch.
  Populate from latest ObjectProperties. OpenSim `LLClientView.cs:11135`.

### C7. Link / unlink prims — `ObjectLink`(Low115, SEND_ONLY_ROOTS)/`ObjectDelink`(Low116, INDIVIDUALS)
- `[ObjectData]{ObjectLocalID...}`. For Link: index[0]=new root, [1..N]=children. Same owner +
  same region required. Sim sends ObjectUpdate with new ParentID. FS `:5441,5457`; OpenSim
  `LLClientView.cs:9309,9327`, `SceneGraph.cs:1933,2016`.

**Cluster C gotchas:** task inv = UDP+Xfer on OpenSim (no cap); strip `|` from name/desc;
Take needs CanTake, TakeCopy needs PERM_COPY (read OwnerMask first); DeRez multi-packet reassembly;
ObjectLink root = index[0]; PropertiesFamily uses UUID not LocalID; ObjectBuy strict validation;
`BulkUpdateInventory` via **EQ** (needs EQ working).

---

# Cluster D — Materials / PBR

> TextureEntry byte layout is what bit us. Documented exactly below.

### D1. TextureEntry (TE) decode — inside ObjectUpdate/Compressed/Cached
- 11 fields, each: `DEFAULT_VALUE [FACE_BITMAP VALUE]... 0x00`. **FACE_BITMAP** = variable-length
  LE, 7 bits/byte, MSB(0x80)=continuation; bit n = face n; lone `0x00` terminates field.
  Unpack: read default → fill all faces → loop(read bitmap; if 0 stop; read value; apply to set bits).
- **Field order/types:** (1)`texture_id` UUID 16B; (2)`color` RGBA 4×U8 **INVERTED wire=255-actual**
  (default wire `0,0,0,0`=white); (3)`scale_s` F32; (4)`scale_t` F32; (5)`offset_s` S16
  (`/0x7FFF`); (6)`offset_t` S16; (7)`rotation` S16 (`(wire/32768)*2π`); (8)`bump` U8
  (`[7:6]=Shiny [5]=Fullbright [4:0]=Bump`); (9)`media_flags` U8 (`[2:1]=TexGen [0]=HasMedia`);
  (10)`glow` U8 (`/255`); (11)`material_id` UUID 16B (legacy LLMaterial; **optional** — blob may end).
- **FS:** pack `llprimitive.cpp:1215,1301`; unpack `:1385,1455,1486`; helpers `:1062,1138`.
  OpenSim uses libomv `Primitive.TextureEntry.GetBytes(9)`.
- **Frontend (Three.js):** `MeshBasicMaterial.map`+`.color.setRGB`+`.opacity`/`transparent`;
  Fullbright→`emissive`; Shiny→upgrade to Standard/Phong; TexGen PLANAR→UV reproject; UV matrix
  from scale/offset/rotation. **sRGB decode** for color.

### D2. Legacy materials — `RenderMaterials` cap (GET/POST fetch by ID, POST/PUT to set)
- FS `llmaterialmgr.cpp` (POST `:694`, parse `:418,459`); material `llmaterial.cpp:335,371`.
  OpenSim `MaterialsModule.cs:238,479,559`; OSD `SOPMaterial.cs:253,164`.
- **Fetch (POST):** body `{Zipped: <zlib LLSD array of 16-byte material IDs>}` (≤50). **Response:**
  zlib LLSD array of `{ID(16B), Material:{NormMap,NormOffset/Repeat/Rotation X/Y(int /10000),
  SpecMap,SpecOffset/Repeat/Rotation,SpecColor[RGBA U8],SpecExp,EnvIntensity,DiffuseAlphaMode
  (0none/1blend/2mask/3emissive),AlphaMaskCutoff}}`.
- **Link:** TE field 11 `material_id` non-zero → fetch from this cap.
- **Frontend:** `MeshStandardMaterial.normalMap` (+ roughness/metalness approx) or Phong+specularMap.

### D3. GLTF PBR material — fetched as `ViewerAsset?material_id=` (AT_MATERIAL)
- UUID from ExtraParam **`0x80` (MaterialsEP)**: `[count U8][te_index U8][asset_UUID 16B]×count`
  (`PrimitiveBaseShape.cs:1367`). Asset LLSD wrapper `{version:"1.1",type:"GLTF 2.0",
  data:"<gltf json ≤2048B>"}`. FS `llgltfmateriallist.cpp:521`, `llgltfmaterial.cpp:185,220,309`.
- **GLTF JSON:** standard `materials[0]` with `pbrMetallicRoughness{baseColorTexture,
  metallicRoughnessTexture,baseColorFactor[RGBA],metallicFactor,roughnessFactor}`, `normalTexture`,
  `emissiveTexture`, `emissiveFactor[RGB]`, `alphaMode`, `alphaCutoff`, `doubleSided`;
  `KHR_texture_transform{offset[uv],scale[uv],rotation}`; `images[].uri` = texture UUID strings.
  TextureInfo idx 0=base,1=normal,2=metallicRoughness(==occlusion ORM),3=emissive.
- **Frontend:** `MeshStandardMaterial`/`MeshPhysicalMaterial` — full PBR map set; ORM packing
  (R=ao,G=rough,B=metal); alphaMode→transparent/alphaTest.

### D4. GLTF material overrides — `GenericStreamingMessage`(0x1F, method `0x4175`) + `ModifyMaterialParams` cap
- Sim→viewer LLUDP: `method U16=0x4175, length U16, data` = LLSD **Notation** string
  `{id:i<localid>, te:[face...], od:[override...]}`. Override fields: `tex[4]UUID, bc[4], ec[3],
  mf, rf, am, ac, ds, ti[4]{o[uv],s[uv],r}`. Viewer→sim: POST `ModifyMaterialParams` LLSD array
  `{object_id,side,asset_id,gltf_json}`. FS `llgltfmateriallist.cpp:171,432`,
  `llgltfmaterial.cpp:684,756`; OpenSim `MaterialsModule.cs:890`, `LLClientView.cs:5522-5577`.

**Cluster D gotchas:** face-bitmap 7-bit varlen (lone 0x00 = terminator not face-0); color
inverted on wire; rotation `/32768*2π`; material_id optional; default = last-face packed first
(face 0 NOT special); last field has no trailing 0x00 (FS appends synthetic); sRGB vs linear;
PBR(ExtraParam 0x80) > legacy(material_id) > TE-only precedence; MaterialsEP type `0x80` low-byte;
GLTF ≤2048 B; ORM single texture.

---

# Cluster E — Avatar Appearance

> OpenSim = client-bake only. Visual params are positional (no IDs). 11 baked TE slots.

### E1. AvatarAppearance (inbound, Low158, zerocoded) — other avatars
- `[SenderData]{Sender UUID,IsTrial U8}[ObjectData]{TextureEntry len U16+bytes}
  [VisualParam]{Count U8, ParamValue U8×count}[AppearanceData(optional)]{AppearanceVersion U8,
  CofVersion S32}[AppearanceHover(opt)]{HoverHeight Vec3}[Attachment(opt)]{ID,AttachmentPoint}`.
- **Baked TE slots (indices):** 8=head,9=upper,10=lower,11=eyes,19=skirt,20=hair,
  40=leftarm,41=leftleg,42-44=aux (11 total post-BOM; legacy=6). Full TE count 45.
- **Visual params:** positional, ordered by `avatar_lad.xml` (`getFirst/NextVisualParam`, skip
  NO_TRANSMIT). Legacy count 218. Each U8 = `F32_to_U8(weight,min,max)`. Param 11000=AppearanceVersion,
  11001=hover.
- **FS:** parse `llvoavatar.cpp:10710`, process `:10887`; OpenSim send `LLClientView.cs:4405`,
  `ScenePresence.cs:4290`.
- **Frontend:** decode TE → baked UUIDs → fetch J2C → apply to avatar mesh; decode params → morphs.

### E2. AgentWearablesRequest → AgentWearablesUpdate (own, on login)
- Request `{AgentID,SessionID}`. Response `[AgentData]{AgentID,SerialNum,SessionID}
  [WearableData]{WearableType U8, AssetID, ItemID}×n`. **Wearable types:** 0Shape 1Skin 2Hair
  3Eyes 4Shirt 5Pants 6Shoes 7Socks 8Jacket 9Gloves 10Undershirt 11Underpants 12Skirt 13Alpha
  14Tattoo 15Physics 16Universal (WT_COUNT=17). FS `llagentwearables.cpp:1952,1976`; OpenSim
  `LLClientView.cs:9011,4363`.

### E3. AgentIsNowWearing (outbound — set worn)
- `[WearableData]{WearableType U8, ItemID(null=unworn)}` ×17 (FS sends all slots). FS `:1912`;
  OpenSim `LLClientView.cs:9050`. (Sends base ItemID via `getLinkedUUID()`, not link UUID.)

### E4. AgentSetAppearance (outbound, client-bake) — the OpenSim path
- `[AgentData]{AgentID,SessionID,Size Vec3,SerialNum}[ObjectData]{TextureEntry baked UUIDs}
  [WearableData]{CacheID(MD5 hash), TextureIndex U8}×bakes[VisualParam]{ParamValue U8}×params`.
  FS `llagent.cpp:6497`; OpenSim `LLClientView.cs:9017`, `AvatarFactoryModule.cs:175`
  (SetVisualParams→SetTextureEntries→UpdateBakedTextureCache→queue save+broadcast).

### E5. UploadBakedTexture cap (2-step)
- Step1: empty POST `{cap}` → `{state:"upload", uploader:"<url>"}`. Step2: POST raw J2C to
  uploader (`application/octet-stream`) → `{state:"complete", new_asset:"<uuid>"}`. UUID then goes
  in AgentSetAppearance TE + CacheID. FS `llviewertexlayer.cpp:698`; OpenSim
  `UploadBakedTextureModule.cs:100,116` (Temporary+Local, 30s uploader timeout).

### E6. COF (Current Outfit Folder)
- `findCategoryUUIDForType(FT_CURRENT_OUTFIT)`. Contains **links** (AT_LINK=24), not items;
  `linked_id`→real item. On OpenSim (no AIS3) manage via `LinkInventoryItem`/`MoveInventoryItem`/
  `RemoveInventoryItem` (no atomic slam). One body-part link per type. FS `llaisapi.cpp:685`,
  `llviewerinventory.cpp:1484`.

### E7. Outfit save/load
- Save: new FT_OUTFIT folder in Clothing, copy COF links in. Load: clear COF, copy target folder's
  links into COF → `updateAppearanceFromCOF()` → AgentSetAppearance. FS `llappearancemgr.cpp`.

### E8. Rigged mesh avatar + skin weights
- Mesh body = ObjectUpdate prim SculptType=5 + mesh UUID → fetch via GetMesh2 (cluster A2). Skin
  LLSD: `joint_names[], inverse_bind_matrix[][16], bind_shape_matrix[16], pelvis_offset`.
  `LLMeshSkinInfo` (`llmodel.cpp:1671`). ~26 standard SL bones (Bento adds ~130). Three.js
  `SkinnedMesh`+`Skeleton`; up to 4 weighted joints/vertex.

**Cluster E gotchas:** OpenSim client-bake only (no UpdateAvatarAppearance; sim sends
`RebakeAvatarTextures`); params positional not ID-tagged (order = avatar_lad); legacy 6 vs BOM 11
bakes; CofVersion usually 0/absent on OpenSim; COF = links not items; AppearanceData block
optional (absent → version -1 → legacy); UploadBakedTexture 2-step ephemeral uploader; mesh
byte-range skin fetch; joint-name → Three.js skeleton mapping.

**Key files:** `llvoavatar.cpp:10887,10710`; `llagent.cpp:6497`; `llagentwearables.cpp:1952,1976`;
`llappearancemgr.cpp:4260,4428`; `llaisapi.cpp:685`; `llviewertexlayer.cpp:698`;
`llmeshrepository.cpp:1579`; OpenSim `LLClientView.cs:4405,9017`, `AvatarFactoryModule.cs:175`,
`UploadBakedTextureModule.cs:100`, `GetMeshHandler.cs:64`.

---

# Cluster F — Profile

> OpenSim = LLUDP (no `AgentProfile` cap). `UserProfileModule` is OPTIONAL (needs ProfileServiceURL)
> — requests may silently never reply; implement timeouts.

### F1. Read properties (WIRED already) — `AvatarPropertiesRequest`(Low169)→`AvatarPropertiesReply`(Low171)
- Request `[AgentData]{AgentID,SessionID,AvatarID}`. Reply `[PropertiesData]{ImageID,FLImageID,
  PartnerID,AboutText(V2 ≤1024),FLAboutText(V1 ≤256),BornOn(str "M/D/YYYY"),ProfileURL,
  CharterMember(1B=caption idx / >1B=text),Flags U32}`. **Flags:** 0x01 AllowPublish, 0x02 Mature,
  0x04 Identified, 0x08 Transacted, 0x10 Online, 0x20 AgeVerified. Auto-sends `AvatarInterestsReply`
  (172) + `AvatarGroupsReply` (173). FS `llavatarpropertiesprocessor.cpp:162`; OpenSim
  `UserProfileModule.cs:432`, `LLClientView.cs:3210`. **QuickerStorm: wired** (`useSocial.js:64`).

### F2. Picks list — `GenericMessage`(Low261) "avatarpicksrequest" → `AvatarPicksReply`(Low193)
- GenericMessage: `[AgentData]{AgentID,SessionID,TransactionID}[MethodData]{Method,Invoice=Zero}
  [ParamList]{Parameter=target_id_str}`. Reply `[Data]{PickID,PickName}×n`. **NOT impl.** Need
  `encodeGenericMessage` + decoder. OpenSim `UserProfileModule.cs:445,882`.

### F3. Pick detail — `GenericMessage` "pickinforequest" [creator_id, pick_id] → `PickInfoReply`(Low194)
- Reply `{PickID,CreatorID,TopPick,ParcelID,Name,Desc,SnapshotID(texture),User,OriginalName,
  SimName,PosGlobal,SortOrder,Enabled}`. **NOT impl.**

### F4. Picks write — `PickInfoUpdate`(Low302) / `PickDelete`(Low303). **NOT impl** (self-edit, Phase 3).

### F5. Notes — read `GenericMessage` "avatarnotesrequest" → `AvatarNotesReply`(Low177); write
`AvatarNotesUpdate`(Low303?) `{TargetID,Notes V1}`. **PARTIAL** (localStorage only, not grid-wired).
Notes keyed by (requester, target) — private. OpenSim `UserProfileModule.cs:451,1405,1446`.

### F6. Interests — read auto via `AvatarInterestsReply`(Low172) `{WantToMask,WantToText,SkillsMask,
SkillsText,LanguagesText}` (**WIRED**); write `AvatarInterestsUpdate`(Low270) (**NOT impl**).

### F7. Edit own profile — UDP `AvatarPropertiesUpdate`(Low170)
- `[PropertiesData]{ImageID,FLImageID,AboutText(V2 ≤1024 TRUNCATES),FLAboutText(V1 ≤256),
  AllowPublish,MaturePublish,ProfileURL}`. No reply (re-request to confirm). **NOT wired**
  (current `saveBio()` = Supabase only). FS `:205`; OpenSim `UserProfileModule.cs:435,1729`.

### F8. Profile image upload — `UploadAgentProfileImage` cap **NOT in OpenSim** — set via existing
asset UUID in `AvatarPropertiesUpdate.ImageID`.

### F9. Classifieds — `GenericMessage` "avatarclassifiedsrequest"→`AvatarClassifiedsReply`(Low198);
detail `ClassifiedInfoRequest`(190)→`ClassifiedInfoReply`(191). **NOT impl.**

### F10. Profile images — `GetTexture?texture_id={imageId|flImageId|snapshot_id}` → J2C (cluster A).
Check null UUID before fetch (404). **Texture proxy not yet wired to frontend** (shows 👤).

**Cluster F gotchas:** no AgentProfile cap on OpenSim; UDP update TRUNCATES bio (show counter);
auto-delivered interests/groups after properties; picks/notes/classifieds all share GenericMessage;
notes per-requester; UserProfileModule optional → timeouts; null image UUID; CharterMember 1B vs
text; no reply to PropertiesUpdate; GetTexture cap URL server-side only (CORS → proxy bytes).

---

# Cluster G — World / Region

> Neighbors + ParcelProperties arrive via **EventQueue** — blocked until EQ works ([[teleport-debugging]]).

### G1. Neighbor sim — `EnableSimulator` (EQ event)
- `{message:"EnableSimulator", body:{SimulatorInfo:[{Handle U64, IP binary[4], Port, RegionSizeX,
  RegionSizeY}]}}`. Viewer: open LLUDP circuit to IP:Port → send `UseCircuitCode{Code,SessionID,
  ID(AgentID)}` → `LLWorld::addRegion`. FS `llworld.cpp:1584`; OpenSim
  `EventQueueGetHandlers.cs:75`, `EntityTransferModule.cs:1728`. Legacy UDP `InformClientOfNeighbour`
  lacks RegionSize → defaults 256.

### G2. EstablishAgentCommunication (EQ event) — neighbor seed cap
- `{body:{agent-id, sim-ip-and-port:"ip:port", seed-capability:"<url>"}}`. Must follow
  EnableSimulator (else dropped). POST cap list to seed → neighbor cap map. FS `llworld.cpp:1655`;
  OpenSim `EventQueueGetHandlers.cs:92`.

### G3. RegionHandshake (Low148) — terrain textures + water + flags
- Key fields: `RegionFlags U32, SimAccess U8, SimName, SimOwner, WaterHeight F32, CacheID,
  TerrainDetail0..3 (UUID×4), TerrainStartHeight00/01/10/11 F32, TerrainHeightRange00/01/10/11 F32,
  RegionID(Info2), ProductName(Info3), RegionFlagsExtended U64 + RegionProtocols U64 (Info4)`.
  `TerrainBase0..3` dead (zero). PBR: `TerrainPBR1..4` in same slots if `SupportTerrainPBR`.
- **Reply** `RegionHandshakeReply{AgentData, RegionInfo:{Flags U32}}` — bit0=request cached objs,
  bit1=no cache (send all), bit2=self-appearance. Send `0x2` if no VO cache.
- FS `llviewerregion.cpp:3241`; OpenSim `LLClientView.cs:878`.
- **Frontend:** `regionStore.waterHeight`; `terrainStore` 4 UUIDs + 8 elevation floats → regen mesh.

### G4. Terrain detail blend — per corner (SW00/NW01/SE10/NE11): tex n full at `StartHeight_n`,
transition over `HeightRange_n`, bilinear across patch. Defaults start=10 m, range=60 m. Fetch
detail textures via GetTexture (cluster A).

### G5. RegionInfo — `RequestRegionInfo`(just AgentData) → `RegionInfo`
- `{SimName,SimAccess,RegionFlags,MaxAgents U8,ObjectBonusFactor F32,WaterHeight,TerrainRaise/
  LowerLimit,UseEstateSun,SunHour,ParentEstateID,HardMaxAgents,HardMaxObjects,MaxAgents32,
  ProductName,RegionFlagsExtended U64}`. FS `llfloaterregioninfo.cpp:374,448`; OpenSim
  `LLClientView.cs:11027,6373`.

### G6. Parcel properties — `ParcelPropertiesRequest`(area) / `...ByID` → **EQ event `ParcelProperties`**
- Area request `[ParcelData]{SequenceID S32 (-2 selected/-3 hovered/0 agent),West,South,East,North
  F32,SnapSelection}`. ByID `[ParcelData]{SequenceID,LocalID S32}` (block name `AgentID` not
  AgentData). **EQ response key fields:** `SequenceID,RequestResult,LocalID,OwnerID,IsGroupOwned,
  Area,AABBMin/Max,MaxPrims(=parcel capacity, already computed),TotalPrims,Owner/Group/OtherPrims,
  SimWideMaxPrims(region-wide),SimWideTotalPrims,ParcelPrimBonus F32(raw multiplier — don't
  re-multiply),ParcelFlags,Status,Name,Desc`. FS `llviewerparcelmgr.cpp:578,1585`; OpenSim
  `LandManagementModule.cs:1535`, `LLClientView.cs:6494,6511`.
- **Frontend:** `parcelStore` → Land Info panel; re-request on position change.

### G7. RemoteParcelRequest cap → parcel UUID by global pos
- POST `{location:[x,y,z], region_id:UUID | region_handle:binary[8]}` → `{parcel_id:UUID}`. Then
  `ParcelInfoRequest`(UUID)→`ParcelInfoReply`. FS `llremoteparcelrequest.cpp:182`; OpenSim
  `LandManagementModule.cs:1978,2105`. Resolves cross-region (synthetic FakeID).

### G8. ParcelInfoReply (Low) — `{ParcelID,OwnerID,Name,Desc,ActualArea,BillableArea,Flags U8,
GlobalX/Y/Z,SimName,SnapshotID,Dwell,SalePrice,AuctionID}`. FS `:85,160`; OpenSim
`LLClientView.cs:10513,3645`.

### G9. Map tile — `MapBlockRequest`→`MapBlockReply` (map shipped; tile UUID fetch is the gap)
- Request `[PositionData]{MinX,MinY,MaxX,MaxY U16}` (grid units, 1=256 m; Flags=2 terrain layer,
  0x10000=return null sims). Reply `[Data]{X,Y U16,Name,Access U8(255=null sim),RegionFlags,
  WaterHeight U8,Agents U8,MapImageID UUID}[Size]{SizeX,SizeY}(var-region)`. **MapImageID:**
  Flags=2→TerrainImage, Flags=0→ParcelImage. Fetch as J2C. FS `llworldmapmessage.cpp:143,169`;
  OpenSim `LLClientView.cs:10379`, `WorldMapModule.cs:1074,1140`.

### G10. MapItemRequest→MapItemReply — agent dots etc. (deferred per [[minimap-map-avatar-dots-and-deferred-server-work]])
- Request `[RequestData]{ItemType U32 (1=AgentLocations,3=Telehubs,7=LandForSale),RegionHandle U64}`.
  Reply `[Data]{X U32,Y U32,Name,ID,Extra(agent count),Extra2}`. FS `:61,300`.

### G11. LandStatRequest→LandStatReply — top scripts/colliders (estate-manager only, low priority).

**Cluster G gotchas:** child vs root agent (child can't select/take); EQ ordering Enable→EAC
(EAC dropped if region unknown); var-region needs EQ path (legacy UDP lacks RegionSize);
RegionHandshakeReply 0x2 if no cache; TerrainBase dead; PBR terrain branch; ParcelProperties via
**EQ** not UDP; MaxPrims pre-computed (don't re-multiply bonus); SimWideTotalPrims = whole region;
RemoteParcelRequest cross-region FakeID; null-sim Access=255; var-region Size block.

---

# Cluster H — HyperGrid Suitcase

> OpenSim-specific. Server-side filtered; viewer mostly transparent. Detect via `type_default==100`.

### H1. Suitcase folder type — `FolderType.Suitcase = 100`; name "My Suitcase"
- `InventoryFolderBase.SUITCASE_FOLDER_NAME` (`InventoryFolderBase.cs:38`); SLUtil
  `{"suitcase",FolderType.Suitcase}` (`SLUtil.cs:210`). FS `FT_MY_SUITCASE=100`
  (`llfoldertype.h:104`, FS-only ext), display `llviewerfoldertype.cpp:188`. Arrives over wire
  with `type_default=100` (`SetAsNormalFolder()` is a no-op stub).

### H2. Two services — `HGSuitcaseInventoryService` (recommended, filters) vs `HGInventoryService`
(HG1.5, returns empty skeleton). Config `[HGInventoryService] LocalServiceModule`. Suitcase
service gates every op on `IsWithinSuitcaseTree()`.

### H3. Skeleton diff — HG-outbound login returns ONLY suitcase subtree; `inventory-root` = suitcase
UUID. Native = full "My Inventory". Login always calls `GetRootFolder` (creates suitcase + full
system folder set on first call). `HGSuitcaseInventoryService.cs:114,158,176`.

### H4. Transport — POST `{InventoryServerURI}/xinventory` (home grid Robust :8002), routed by
`HGInventoryBroker` (foreign detection via `IsLocalGridUser`; URL from
`AgentCircuitData.ServiceURLs["InventoryServerURI"]`; 60s cache). `HGInventoryBroker.cs:220`.

### H5. Request/response (form-encoded → XML):
- `METHOD=GETINVENTORYSKELETON&PRINCIPAL={uuid}` → `<FOLDERS><folder_n>{ParentID,Type,Version,
  Name,Owner,ID}</folder_n></FOLDERS>` (suitcase + recursive descendants only).
- `METHOD=GETROOTFOLDER` → single suitcase folder (Type 100).
- `METHOD=GETFOLDERCONTENT&FOLDER={uuid}` → `<FID><VERSION><FOLDERS><ITEMS>{full item fields}`.
  Returns empty if `!IsWithinSuitcaseTree`.
- `METHOD=GETFOLDERFORTYPE&TYPE={int}` → folder of that type **under suitcase** only.
- ADDITEM/UPDATEITEM → false if outside suitcase. **DELETEFOLDERS/PURGEFOLDER/DELETEITEMS →
  always false** (NOGO). MOVE → only if both src+dst in suitcase.

### H6. FetchInventoryDescendents2 cap still used in foreign session — served by foreign sim,
routed to home `HGSuitcaseInventoryService` via broker. No special cap-side filtering — all
server-side. Same LLSD shape as B1.

### H7. GetItem appearance exception — items outside suitcase still returned if
`IsPartOfAppearance()` (so wearables/attachments fetch). CurrentOutfit also added to allowed set.

### H8. Client-side "(Unavailable)" labels — when `RestrictInventoryAccessAbroad=true` and user
HG-TPs out, `HGInventoryAccessModule` renames non-suitcase/non-COF folders with " (Unavailable)"
via BulkUpdateInventory (cosmetic only). Restored on return. `HGInventoryAccessModule.cs:503,476`.

### H9. Frontend wire — detect HG session: root folder `type_default==100` OR name "My Suitcase"
→ set `inventoryStore.isHGSession`, label root "My Suitcase", dim " (Unavailable)" folders,
disable delete/purge (server rejects).

**Cluster H gotchas:** type_default=100 on wire (don't skip); HGInventoryService returns empty
skeleton; CurrentOutfit accessible outside suitcase; deletes/purge silently dropped (no optimistic
remove); InventoryServerURI = Robust :8002 not sim; HG detection server-side only (config-dependent);
5-min suitcase-tree cache; GetFolderForType searches within suitcase only.

---

## Implementation prerequisites summary (build before slices)

1. **`caps.ts`**: binary GET, `Range` passthrough, binary/base64 WS frames.
2. **`llsd.ts`**: add LLSD **Binary** decoder (mesh headers, some caps) + LLSD **Notation**
   (material overrides).
3. **J2C transcode** path (server openjpeg → PNG) — unblocks A,D,E,F,G.
4. **EventQueue (EQ)** working — unblocks neighbors (G1/G2), ParcelProperties (G6), take/buy
   inventory delivery (C5/C6). See [[teleport-debugging]].
5. **Xfer protocol** — prim contents (C3).
6. **REQUESTED_CAPS** add: `ViewerAsset`, `GetMesh`, `RenderMaterials`, `ModifyMaterialParams`,
   `UploadBakedTexture`.
7. **`encodeGenericMessage`** LLUDP codec — picks/notes/classifieds (F2/F3/F5/F9).
