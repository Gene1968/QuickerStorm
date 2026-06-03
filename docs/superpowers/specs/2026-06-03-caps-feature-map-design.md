# Caps & Server-Call Feature Map — Design

**Date:** 2026-06-03
**Status:** Design approved; map research in progress
**Branch:** phase3

## Problem

Every feature so far shipped partial (stops short of later server needs) and buggy
(TP timeout, grandchild -Z misplacement, deferred-prim dropout). Each packet/cap
decode cost hours of relog-debug cycles. Root cause: we guessed at server
shapes instead of tracing the known-correct Firestorm C++ first, and we built
wide-but-partial instead of thin-but-complete-and-verified.

## Rejected Approach: Big-Bang Decoder Prep

Pre-writing all cap/packet decoders now, frontend later. **Rejected** because:

- Decoders can't be verified without a live consumer. 15 untested decoders =
  15 future debug cycles, all at once, on a giant pile. Amplifies the exact
  partial+buggy failure mode.
- Most HTTP caps need a live round-trip (real seed cap + real asset UUIDs) to
  test. Can't meaningfully "prepare" in isolation.
- **The transport is already done and generic** — `server/handlers/caps.ts` is a
  CORS proxy forwarding any URL/body; `server/lib/llsd.ts` parses LLSD;
  `useInventory.js` + `inventoryStore` are one working end-to-end consumer
  (FetchInventoryDescendents2). Per-feature, the only unknowns are the *shapes*
  (cap name, request LLSD, response LLSD) and the frontend wiring. Shapes are
  cheap to document, expensive to guess wrong.

## Chosen Approach: Reference Map + Slice Plan

Two artifacts, **no unverified code**:

1. A full-depth reference map tracing every upcoming feature to its exact FS C++
   source, OpenSim server handler, cap name, and request/response LLSD shapes.
2. A dependency-ordered slice plan grouping features into login sessions to
   minimize relog cycles.

Then build slice-by-slice: each slice server→frontend→**verify-live-once**,
thin-but-complete.

### Reference sources

- **Primary (client truth):** `C:/Users/gene1/Downloads/Pages/git/phoenix-firestorm`
- **Server truth:** `C:/Users/gene1/Downloads/Pages/git/opensim`
- **libopenmetaverse:** not cloned locally — reference from memory/web when a
  packet struct needs confirming.

### Existing foundation (build on, don't rebuild)

| Piece | File | Role |
|-------|------|------|
| Cap proxy | `server/handlers/caps.ts` | Generic CORS fetch forwarder |
| LLSD parser | `server/lib/llsd.ts` | XML LLSD → JS |
| Cap dict | `inventoryStore` (`setCaps`) | Holds seed-cap → URL map |
| Working consumer | `useInventory.js` | Batched FetchInventoryDescendents2 pattern to copy |
| LLUDP decode | `server/handlers/lludp.ts` | Packet path |

## Artifact 1: Reference Map

One row per feature, full depth. Columns:

- **Feature**
- **Transport** — HTTP cap / LLUDP packet / both
- **Cap name(s)** — e.g. `GetTexture`, `ViewerAsset`, `FetchInventoryDescendents2`
- **FS source** — exact file:line in phoenix-firestorm (impl to port)
- **OpenSim source** — handler file confirming server response shape
- **Request shape** — full LLSD/packet fields to send
- **Response shape** — full fields returned + how to decode
- **Frontend wire** — store + composable + UI that consumes it
- **Verify** — what you SEE in-world that proves it works
- **Login-group** — which session this verifies in (Artifact 2)
- **Deps** — what must work first

## Artifact 2: Slice Plan (dependency-ordered)

1. **Asset fetch foundation** — `GetTexture`/`GetMesh`/`ViewerAsset` caps. Keystone;
   unblocks every texture/preview/mesh feature.
2. **Inventory management** — move/rename/copy/delete/link/unlink
   (`UpdateInventoryItem`, `MoveInventoryFolder`, `CopyInventoryItem`,
   `RemoveInventoryObjects`, `CreateInventoryCategory`). Builds on existing tree.
3. **Object interaction** — task inventory (contents), take/copy, link/unlink
   (`ObjectLink`), PBR/`RenderMaterials`. Needs asset fetch.
4. **Appearance** — `AgentWearablesRequest`, Current Outfit Folder (COF), wear,
   outfits, `AgentSetAppearance`, mesh avatar, `UploadBakedTexture`. Needs asset
   fetch + inventory.
5. **Profile** — `AvatarPropertiesRequest`, profile textures, edit
   (`AvatarPropertiesUpdate` / web-profile cap). Needs asset fetch.
6. **World/region** — neighbor regions
   (`EnableSimulator`/`EstablishAgentCommunication`), land capacity
   (`ParcelPropertiesRequest`/`RemoteParcelRequest`/`LandStatReport`), region
   textures. Semi-independent.
7. **Suitcase** — HG-specific inventory. Needs inventory management.

## Research Clusters (parallel, read-only)

One agent per cluster traces FS→OpenSim and returns full-depth map rows:

| # | Cluster | Features |
|---|---------|----------|
| A | Asset foundation | GetTexture, GetMesh, ViewerAsset, J2C decode, sound/anim asset play |
| B | Inventory mgmt | descendents (existing), move/rename/copy/delete, link/unlink, create folder, FetchLib |
| C | Object interaction | task inventory/contents, take/copy, ObjectLink/unlink, ObjectProperties |
| D | Materials/PBR | RenderMaterials, GLTF/PBR materials, texture-entry decode |
| E | Appearance | AgentWearablesRequest, COF, wear/outfits, AgentSetAppearance, mesh avatar, baked textures |
| F | Profile | AvatarPropertiesRequest/Update, profile/picks textures, web-profile cap |
| G | World/region | neighbor sims, EstablishAgentCommunication, land capacity, parcel props, region/map textures |
| H | Suitcase/HG | HG inventory, suitcase folder semantics |

Each agent returns markdown map rows. Main session assembles into the map doc.
User reviews assembled map + slice order, adjusts, THEN slices proceed one at a
time with live verify each.

## Out of Scope

- Writing any cap/packet decoder code (deferred to slices).
- Committing (user commits manually per their workflow).
- Cross-grid teleport (separate track; [[teleport-debugging]]).
