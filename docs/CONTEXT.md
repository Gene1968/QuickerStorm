# quickerSTORM – Context for AI / Chat Sessions

**Purpose:** Stores context so that AI assistants and future chat sessions retain important information even when chat history is unavailable. Read this file when working on quickerSTORM.

---

## What quickerSTORM Is

A **web-based 3D viewer for OpenSimulator and Second Life**. Users log in, see their avatar in a Three.js scene, walk around, chat, IM, and (eventually) edit objects and use inventory — all without installing a thick client.

Testing primarily against **OSGrid** and **NeverWorld** so far. Other grids planned.

---

## Architecture

```
┌───────────────────┐    WebSocket    ┌────────────────────┐    LLUDP    ┌─────────────┐
│  Vue 3 SPA        │ ◄─────────────► │  Bun WS server     │ ◄─────────► │  Grid sim   │
│  (Vite, Three.js) │                 │  (server/*.ts)     │             │  (OpenSim)  │
└───────────────────┘                 └────────────────────┘             └─────────────┘
                                             │
                                             ├── XML-RPC login proxy → grid login URI (also parses inventory skeleton)
                                             └── HTTP capability proxy → seed-cap dict + LLSD caps (FetchInventoryDescendents2, GetTexture, …)
```

- **Frontend**: Vue 3 SPA, hash-based routing for standalone embed.
- **Bun WS server**: bridges LLUDP UDP packets to/from the browser via JSON messages; holds circuit state (`server/state/sessions.ts`).
- **No backend database**. No Supabase. Earlier scaffolding for those was removed per the `docs/superpowers/specs/` spec.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router (hash mode) |
| 3D Engine | Three.js r183 — scene, avatar meshes, terrain mesh, GSAP tweening |
| Voice (Phase 3) | WebRTC (browser native) + Bun WS server for signaling |
| LLUDP bridge | Bun WebSocket server (`server/`); typed handlers under `server/handlers/` |
| Styling | Tailwind utilities + helpers + `<style scoped>`; light/dark via `useTheme()` |
| Hosting | Vite SPA (static); Bun server runs on the VPS/NAS or locally on port 8787 |

---

## Environment & Config

`VITE_APP_ENV` selects the config JSON loaded by `src/config/configuration.js`:

| `VITE_APP_ENV` | Typical `.env` | Build output |
|----------------|----------------|--------------|
| `development` | `.env.development.local` | dev server only |
| `staging` | `.env.staging` | `build:staging` |
| `production` | `.env.production` | `build:prod` |

`VITE_SIGNAL_URL` points at the WS server (local: `ws://localhost:8787`, prod: VPS/NAS URL).

Always import config as: `import { config } from '@/config/configuration.js'`

---

## Pinia Stores

| Store | Purpose |
|-------|---------|
| `avatarStore` | Local identity, avatar config (colors/hair/skin placeholder) |
| `sessionStore` | Login session: agentId, sessionId, circuit code, region size, grid info, `regionAccess` (RegionHandshake) |
| `worldStore` | Scene state: `objects` (Map of localId → ObjectData), `terrainHeights` (Float32Array 513×513), `avatarPos`, `spawnPos` |
| `mapStore` | World Map cache: `regions` (Map keyed `"x,y"` of MapBlockReply records), `viewCenterX/Y`, `viewZoom` (1..8 float), `queriedChunks` (60s TTL dedup) |
| `gridStore` | Grid selection, loginState (`disconnected | reconnecting | live`) |
| `uiStore` | Floater stack, cameraYaw, debug toggles, multi-instance inventory floater state |
| `inventoryStore` | Inventory tree: `folders` (Map from login skeleton), `items` (Map folderId→items, fetched via cap), `caps`/`capsReady`, filter/type/sort/selection, recursive `descendantCounts`, agent-scoped totals |
| `gridSocialStore` | Friends list (from login buddy-list + live FRIEND_STATUS), groups, agent name cache, profile/parcel fragments, own-agent data |
| `notificationStore` | In-session toast queue + Notifications floater tab history (system / friend-requests / IMs) |
| `accountsStore` | Saved login accounts (grid + username pairs) persisted to localStorage; used by LoginForm dropdown |
| `debugStore` | Live ring buffer of debug messages for the in-page debug panel |
| `theme` | Light/dark toggle, shared `isDark` ref |

---

## Key Composables & Files

| Path | Purpose |
|------|---------|
| `src/composables/useWorldEngine.js` | **Owns the Three.js scene.** Mesh creation, avatar/prim spawning, terrain mesh, follow camera, dead-reckoning, input. |
| `src/composables/useRealtimeSocket.js` | Singleton WS connection; dispatches typed messages to handlers. **Dispatch passes `msg.d` directly to handler, not full envelope** — handlers receive payload, not `{t,d}` |
| `src/composables/useTeleport.js` | `requestTeleport` (same-region) + `requestRegionTeleport` (cross-region via MapNameRequest→MAP_TELEPORT). Plays woosh on dispatch |
| `src/composables/useLLUDP.js` | Client→server WS emit wrappers (move, chat, teleport, map query, etc) |
| `src/components/MapFloater.vue` | World Map 2D — SVG render, pan/zoom-toward-cursor, click-select, dbl-click TP |
| `src/composables/useProximityVoice.js` | WebRTC voice (Phase 3 wire-up pending) |
| `src/composables/useTheme.js` | Light/dark toggle |
| `src/composables/useVersionCheck.js` | Polls `version.json` every 5 min; shows reload banner on new build |
| `src/composables/useInventory.js` | Inventory cap driver: lazy folder fetch on expand + paced background bulk load (`fetchAll`); handles `S.INV_FOLDER`/`S.CAPS_READY` |
| `src/components/InventoryFloater.vue` | Inventory UI — tabs, filter/type/sort, footer totals, cog menu. Tree rows via recursive `InventoryTreeNode.vue`. Right-click `InventoryContextMenu.vue` + `InventoryItemProperties.vue` |
| `src/composables/useSocial.js` | Social pipeline: routes FRIEND_STATUS/AVATAR_PROPS/NAME_REPLY into gridSocialStore; outbound friend offer/respond/remove/rights; add-by-name avatar picker |
| `src/composables/useNotifications.js` | Notification dispatch helper; writes to notificationStore; drives toast queue |
| `src/components/ConversationsFloater.vue` | IM conversation tabs — per-agent threads, emoji picker; `ImprovedInstantMessage` LLUDP |
| `src/components/NotificationsFloater.vue` | Notifications floater — system / friend-request / IM history tabs |
| `src/components/AppearanceFloater.vue` | Appearance/Outfits floater — avatar color/skin/hair editor, Wearing tab, Outfits tab shell |
| `src/components/TopRightTray.vue` | Top-right HUD cluster: IM badge + Notifications badge; opens ConversationsFloater/NotificationsFloater |
| `server/index.ts` | Bun WS + HTTP server entry |
| `server/handlers/inventory.ts` | `FetchInventoryDescendents2` cap (batched folders) → typed item JSON. Cap URL resolved server-side; never sent to client |
| `server/handlers/caps.ts` | Generic CORS cap-fetch proxy (`C.CAPS_FETCH` → `S.CAPS_RESULT`) |
| `server/lib/llsd.ts` | LLSD-XML parser (map/array/all leaf types) for cap responses |
| `server/lib/xmlrpc.ts` | Login proxy + login-response parse, incl. `parseInventorySkeleton`/`parseInventoryRoot` (folder tree comes free at login) |
| `server/handlers/lludp.ts` | UDP → WS relay: decodes incoming LLUDP, forwards to browser; receives outgoing messages |
| `server/lib/lludp-codec.ts` | Wire-format encoders/decoders for every LLUDP message we speak |
| `server/lib/terrain-codec.ts` | LayerData terrain patch decoder (libomv BitPack format, prefix-code coefficients) |
| `server/lib/circuit.ts` | Reliable-ack tracking, retransmit, seq counters |
| `shared/protocol.js` | Shared `S` (server→client) / `C` (client→server) WS message constants |

---

## Coordinate Transform

SL is Z-up, Three.js is Y-up. Every position/rotation from the server is in SL space and converted on the client:

```javascript
// Position
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }
// Quaternion: same axis remap on (x,y,z); w invariant
function slQuatToThree(x, y, z, w) { return new THREE.Quaternion(x, z, -y, w) }
```

---

## What to Do When Starting a Session

1. Read **`docs/PROJECT_BRIEF.md`**, **`docs/CONVENTIONS.md`**, and **`docs/CONTEXT.md`** (this file).
2. Read **`docs/superpowers/specs/`** for the canonical spec before implementing anything (per `memory/read-specs-first.md`).
3. Check **`docs/FEATURE-GAPS.md`** for the current priority queue and the specific gaps in whatever feature area you're working on.
4. For terrain bugs: `server/lib/terrain-codec.ts` + `memory/terrain-rendering-next.md`.
5. For LLUDP decode bugs: `server/lib/lludp-codec.ts` + `memory/lludp-decode-gotchas.md`.
6. For circuit/login bugs: `server/handlers/lludp.ts` + `server/lib/circuit.ts` + `memory/opensim-circuit-lifecycle.md`.
7. For social/friends bugs: `src/composables/useSocial.js` + `src/stores/gridSocialStore.js` + `memory/phase3-social-shipped.md`.
8. For inventory bugs: `src/composables/useInventory.js` + `server/handlers/inventory.ts` + `memory/phase3-inventory-and-cap-state.md`.

---

## What This Project Is *Not*

Removed earlier in development (don't reintroduce):
- Supabase backend
- Third-party auth / social integrations
- Calendar / video-conferencing integration

If old code or doc references these, treat as stale and remove on touch.
