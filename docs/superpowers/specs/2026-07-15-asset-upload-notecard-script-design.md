# Asset upload framework — notecard & script (v1)

**Date:** 2026-07-15 · **Bundle:** ROADMAP §"Caps still needed" item 1 (asset upload) → unblocks bundles 6, 14.
**Scope (approved):** notecard + script end-to-end (create blank · open/read · edit · save). Sound/texture/
snapshot/bake are **deferred** thin-follow-ons on the same framework (texture/snapshot need J2C **encode**,
which we don't have — separate spike).

## Protocol (ported from OpenSim BunchOfCaps.cs / UpdateItemAsset.cs + Firestorm llviewerassetupload.cpp)

Two distinct mechanisms — the family needs both:

**A. Create a blank item = `CreateInventoryItem` UDP (Low 305). NOT a cap.**
Block `InventoryBlock`: CallbackID U32, FolderID, TransactionID(=zero), NextOwnerMask U32, Type S8,
InvType S8, WearableType U8(=0), Name Var1, Description Var1. Zero TransactionID → sim mints an empty
default asset + item and replies `UpdateCreateInventoryItem` (Low 267). Notecard = Type 7 / InvType 7;
script = Type 10 / InvType 10.
→ **Already implemented:** `encodeCreateInventoryItem` (lludp-codec.ts:136); the `CREATE_LANDMARK` handler
(lludp.ts:1533) is the exact template; the reply is decoded at lludp.ts:1087 → `S.INV_ITEM_CREATED` →
client `addCreatedItems` (inventoryStore.js:613). New work = a `C.CREATE_INV_ITEM` handler block that passes
type/invType through.

**B. Put bytes into an asset = 2-step HTTP cap.**
- **New file:** `NewFileAgentInventory`. Step-1 LLSD POST `{folder_id, asset_type, inventory_type, name,
  description, next_owner_mask, group_mask, everyone_mask, expected_upload_cost}` → resp `{uploader:URL,
  state:"upload", upload_price}`. Step-2 POST raw bytes to `uploader` → resp `{new_asset, new_inventory_item,
  state:"complete"}`. (Used later for sound/texture/bake. NOT used for notecard/script content.)
- **Save into existing item:** `UpdateNotecardAgentInventory` / `UpdateScriptAgentInventory`. Step-1 LLSD POST
  `{item_id, task_id:zero}` → `{uploader}`. Step-2 raw bytes → `{new_asset, new_inventory_item, state}`.
  Same-IP check between step 1 & 2 — satisfied because **Bun** makes both POSTs. Uploads are **free** on
  stock OpenSim (SampleMoneyModule.UploadCharge=0); `expected_upload_cost` is ignored server-side but sent
  for wire-compat. No pre-upload cost gate.

**Read (open an existing notecard/script):** `ViewerAsset` cap, `?notecard_id=<uuid>` (AssetType.Notecard) /
`?lsltext_id=<uuid>` (AssetType.LSLText) — confirmed GetAssetsHandler.cs:60-61. Returns raw asset bytes,
no transcode.

**Payload bytes:**
- Script = raw UTF-8 source, no wrapper.
- Notecard = text wrapped in the `Linden text version 2 { … }` envelope (LLEmbeddedItems count 0; `Text
  length` = UTF-8 byte count). Serializer: `src/lib/assetSerialize.js` (`notecardToAsset`/`notecardFromAsset`).

## Framework

**Server**
- `server/lib/caps/assetUpload.ts` (new, injectable-fetch, unit-tested):
  - `uploadNewAsset(capUrl, {assetTypeStr, invTypeStr, name, description, folderId, perms}, bytes, fetchFn?)`
  - `updateItemAsset(capUrl, {itemId, taskId?}, bytes, fetchFn?)`
  - Both: encodeLLSD step-1 → `parseLLSD` the `uploader` → raw `fetch(uploader, {POST, octet-stream, body:Buffer})`
    → parseLLSD `{new_asset, new_inventory_item, state}`. Return `{ok, assetId, itemId, error}`.
- `server/handlers/assetUpload.ts` (new): `C.ASSET_UPLOAD` handler. msg.d = `{id, mode:'update'|'new', cap,
  itemId?|newMeta?, dataB64}`. Base64-decode → resolve cap URL from session → dispatch → reply
  `S.ASSET_UPLOAD_RESULT {id, ok, assetId, itemId, error}`. Mirrors the ASSET_FETCH binary pattern.
- `server/handlers/assets.ts`: add `assetRequestSpec` cases `notecard`→`{ViewerAsset, notecard_id, transcode:false, mime:'text/plain'}`, `lsltext`→`{…, lsltext_id, …}`.
- `server/handlers/lludp.ts`: new `C.CREATE_INV_ITEM` block (mirror CREATE_LANDMARK; type/invType from msg.d).
- `shared/protocol.js`: `C.CREATE_INV_ITEM`, `C.ASSET_UPLOAD`, `S.ASSET_UPLOAD_RESULT` (create reply reuses `S.INV_ITEM_CREATED`).
- `server/index.ts`: wire `C.ASSET_UPLOAD` → `handleAssetUpload` (CREATE_INV_ITEM routes through the existing lludp client-message dispatch).

**Client**
- `src/lib/assetSerialize.js` — pure envelope + type maps (built + tested).
- `src/composables/useAssetUpload.js` (new): `createBlankItem({kind, name, folderId})` (C.CREATE_INV_ITEM);
  `saveAsset({kind, itemId, text})` — serialize → C.ASSET_UPLOAD (update cap by kind); promise keyed on id
  over S.ASSET_UPLOAD_RESULT. `openAssetText({kind, assetId})` — fetch via existing ASSET_FETCH ('notecard'/
  'lsltext') → base64→utf8 → `notecardFromAsset`/identity.
- `src/components/TextAssetEditorFloater.vue` (new, shared notecard+script modes): open → fetch+parse → edit
  textarea → **Save** (`saveAsset`) → toast + close. Script mode = monospace, no syntax highlight v1.
- Wires: inventory **New ▸ Notecard / New ▸ Script** (InventoryContextMenu + gear menu) → `createBlankItem`;
  double-click open dispatch for notecard/script → `TextAssetEditorFloater`.

## Deliberate cuts (v1)
- No embedded inventory items in notecards (count 0). No LSL **compile** feedback (that's the script-task
  `UpdateScriptTaskInventory` compiled/errors path — later, bundle 14). No cost dialog (free on OpenSim).
- Sound/texture/snapshot/bake upload = follow-ons on `uploadNewAsset` (texture/snapshot gated on J2C-encode).
- No task-inventory (in-object) script save — agent inventory only.

## Test plan
- `assetSerialize.test.js` — envelope round-trip incl. UTF-8 byte length (built by subagent).
- `assetUpload.test.ts` — 2-step handshake with a mock fetch: step-1 body has the right LLSD fields, uploader
  URL parsed, step-2 posts the exact bytes, completion `new_asset`/`new_inventory_item` parsed; error paths
  (step-1 state:"error", step-2 non-complete).
- Live-verify (hand off to Gene): New Notecard → appears in inventory → open → type → Save → reopen → text
  persists; same for a script.
