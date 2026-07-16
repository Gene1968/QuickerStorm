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
