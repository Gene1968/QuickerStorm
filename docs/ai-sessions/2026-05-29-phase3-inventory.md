# 2026-05-29 — Phase 3 start: HTTP-cap foundation + Inventory

**Tool:** Claude Code · **Model:** Opus 4.8 (1M) · **Reviewer:** Gene · **Branch:** `phase3`

## Summary
Closed out remaining Phase 2 verification gaps, then began Phase 3 — built the HTTP-capability foundation and the first payload (Inventory), browsing-complete.

## Phase 2 wrap (found already-built, verified + fixed)
- Avatar/object right-click menus, IM, hovertext, child-prim linksets — confirmed wired.
- **Bug fixed:** right-click `ObjectSelect` leaked (no paired `ObjectDeselect`). Added one reconciling watcher in `useWorldEngine.js` (derives sim selection from `editObjectId`/`objectMenu`/`showObjectEdit`, emits select/deselect deltas).
- **Linksets:** added KillObject cascade (root kill removes children from `meshMap`+`worldStore`) and `normalizeChildTransform` (divides parent prim scale out of children — Three.js multiplies ancestor scale; SL child offsets are absolute metres).
- **Places:** built-ins → Landmarks tab; real teleport History via standalone `useTeleportHistory.js` recorded in `useTeleport.requestTeleport` (single TP source of truth; fixes double-click-land bypass).
- **FloaterWindow:** `min-h-0` on content slot (inner scroll regions actually scroll, footer no longer clipped); ResizeObserver persists manual resize across re-renders (focus/z-index no longer resets size).

## Phase 3a — cap foundation
- `server/lib/llsd.ts` — LLSD-XML parser (map/array/string/uuid/integer/real/boolean/date/uri/binary/undef). Tests in `llsd.test.ts`.
- `server/handlers/login.ts` — seed-cap POST requests the full cap list, parses the LLSD map into `session.caps`, emits `S.CAPS_READY`. Resume path re-emits caps.
- `server/handlers/caps.ts` — generic CORS proxy already present; cap URLs stay server-side.
- **Design:** server-centric. Client sends semantic requests; server resolves cap URL + speaks LLSD; client gets typed JSON. Mirrors the LLUDP-decode→JSON pattern.

## Phase 3b — Inventory (browsing-complete)
- Folder **tree** comes free from the login XML-RPC `inventory-skeleton` (`parseInventorySkeleton` in `xmlrpc.ts`) — no cap needed. FS sort order (system folders to top, then alphabetical).
- **Items** via `FetchInventoryDescendents2` (`server/handlers/inventory.ts`), batched many-folders-per-POST. Lazy on expand + paced background `fetchAll` for an exact grand total (`N,NNN Elements`).
- UI (`InventoryFloater.vue` + recursive `InventoryTreeNode.vue`): type/folder icons, search filter (incl. searchable permission tags), type-filter dropdown, sort (Name/Date/Type) in the cog menu, Favorites/Worn/Recent tabs, per-folder count on selection, right-click menu (Properties / Copy UUIDs) + Properties popover, tab-strip wheel-scroll + overflow arrows.
- **Cap-name hardening:** accept `WebFetchInventoryDescendents` alias. **Fix that made counts work:** request `fetch_folders=1` (sim gated items on it). Live-verified populating.

## State / next
- Inventory view/browse done; drag/move/rename/wear need move + texture caps.
- **Next lever: 3c textures** — `GetTexture` (already in the cap dict) → J2C WASM decode → real prim textures + inventory thumbnails. Blocker is the OpenJPEG WASM port.
- Detail + file map in `memory/phase3-inventory-and-cap-state.md`.
