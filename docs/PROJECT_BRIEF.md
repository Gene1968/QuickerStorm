# Project Brief — quickerSTORM

> **Living context document** for goals, constraints, and technical anchors. Update as the product evolves. Include in AI prompts alongside `CONVENTIONS.md` and relevant ADRs.

## Purpose

quickerSTORM is a web-based 3D viewer for OpenSimulator and Second Life. It provides real-time scene rendering, avatar movement, local/IM chat, teleporting, eventually proximity voice, inventory, groups, and object editing — all from a browser tab with no thick-client install.

## Target Users

OpenSim or SL users who want a lighter way into their grid: a browser bookmark instead of a multi-GB client. Useful for quick check-ins, mobile/tablet, shared computers, anywhere a thick client install isn't practical.

## Stack & Infrastructure

| Layer | Choice |
| --- | --- |
| Frontend | Vue 3 (Composition API, `<script setup>`), Vite, Pinia, Vue Router (hash mode) |
| 3D Engine | Three.js r183 — scene, avatar meshes, terrain mesh, GSAP tweening |
| LLUDP bridge | Bun WebSocket server (`server/`) — UDP↔WS relay, holds circuit state |
| Voice | WebRTC (browser native) + Bun WS server for signaling (Phase 3 wire-up) |
| Data | No backend database. State lives client-side (Pinia + localStorage); sim is authoritative for world state. (Phase 3 may add asset-cache IndexedDB for textures/meshes.) |
| Styling | Tailwind utilities + Bootstrap helpers + scoped CSS; light/dark via `useTheme()` |
| Hosting | Vite SPA (static); Bun server runs on the VPS/NAS or locally |

## Key Constraints

- **Hash-based routing** (`createWebHashHistory`) — required for standalone embed (see ADR-0001).
- **All LLUDP traffic goes through the Bun WS server.** Browsers cannot speak UDP. The server is mandatory infrastructure.
- **Sim is authoritative for world state.** Local position is best-effort (dead reckoning matched to SL physics 3.2/5.2/11 m/s); sim corrections via TerseUpdate blend in.
- **Three.js r152+ uses sRGB output color space.** Vertex colors and material colors must be stored in linear space; convert via `Color.convertSRGBToLinear()` or `pow(c, 2.4)`.
- **SL Z-up vs Three.js Y-up.** Always convert with `slToThree()` / `slQuatToThree()` at server boundary.

## Core Features

Phase 1 (shipped):

1. **3D virtual world viewer** — Three.js scene, real terrain mesh with height-color rendering
2. **Login + circuit** — XML-RPC login proxy + LLUDP UseCircuitCode + CompleteAgentMovement + AgentThrottle
3. **Movement** — AgentUpdate at 10 Hz, dead reckoning matched to SL physics, follow camera
4. **Avatar rendering** — own + other avatars as capsules with face indicator, name tags
5. **Local chat** — ChatFromViewer / ChatFromSimulator with emoji
6. **Same-region teleport** — from LocationBar
7. **Session resume** — 15-second circuit hold on network blip; clean logout via LogoutRequest
8. **RebakeAvatarTextures** cap

Phase 2 (shipped May 2026):

9. **Real prim geometry** — PathCurve/ProfileCurve → boxes/cylinders/spheres/tori ✓
10. **Child-prim composition** — linked sets via ParentID ✓
11. **TextureEntry default color** — real prim RGBA without asset fetch ✓
12. **Terrain collision + gravity + ocean ripple** ✓
13. **Cross-region teleport** — circuit tear-down + rebuild on TeleportFinish ✓
14. **IM** — `ImprovedInstantMessage` LLUDP ✓
15. **Right-click avatar + object context menus** (Phase 2 subset) ✓
16. **Places floater** (~65% — landmarks + history wired; some gear-menu items TODO) ✓
17. **Map 2D** — pannable/zoomable world map, snapshot tiles, dbl-click TP ✓
- Deferred from Phase 2: neighboring-sim terrain (ocean horizon accepted as substitute), voice (Phase 2.5/3)

Phase 3 (HTTP capability layer — in progress, May 2026):

18. **HTTP-cap foundation** — LLSD-XML parser, full cap dictionary, server-side proxy ✓
19. **Inventory browse** — folder tree + `FetchInventoryDescendents2` items, search/filter/sort ✓ (~70%)
20. **Social layer** — friends list from login, online/offline status, friend-request toasts, add-by-name, rights ✓ (~45%); Friends floater UI TODO
21. **Saved accounts** — multi-account login dropdown, persist/remove ✓
22. **Appearance / Outfits floater** — color/skin/hair editor, Wearing tab (~35%); no baked textures yet
23. **Notifications floater** + TopRightTray IM/Notification cluster ✓
24. **Texture pipeline** — `GetTexture` cap + J2C (JPEG2000) decode in browser (TODO — next major lever)
25. **Mesh export/import** via `GetMesh2` cap (TODO)
26. **Object Edit floater** + Take/Copy/Delete/Export (perms + caps) (~30%)
27. **Profile floater** (~60%) + (carefully) appearance editing
28. **Groups + Group IM** (TODO)
29. **Web-on-prim** via `ObjectMedia` cap (TODO)

## Out of Scope

- Backend database / multi-user persistence (sim is authoritative)
- Slack / Google / Microsoft / Supabase integrations (removed earlier; do not reintroduce)
- Office-collab / meeting-room features (legacy from prior product; `useOfficeEngine.js` being phased out)
- LSL script editing — write goes to sim caps anyway, but no client-side IDE
- Marketplace / commerce — out of scope; users use thick client for L$ transactions
- Mobile-native app — web-only

## Success Metrics

- Online users have near parity of abilities with thick clients for common day-to-day actions
- Users see their region accurately (terrain, prim geometry, other avatars moving and turning), move around without drift, IM and chat
- Phase 3: users can view inventory, see real prim textures, and edit basic object properties
- Voice chat connects reliably between peers in the same area

## Glossary

| Term | Meaning |
| --- | --- |
| LLUDP | Linden Lab UDP — the binary wire protocol SL/OpenSim sims speak |
| Sim / simulator | One server-side region (256×256 m standard, 512×512+ for var-regions) |
| Var-region | Variable-size region larger than 256×256; uses 32×32 terrain patches instead of 16×16 |
| Cap / capability | Per-session HTTP endpoint URL issued by the sim's seed cap; modern SL/OpenSim uses caps for inventory, textures, mesh, groups, etc. |
| Seed cap | The bootstrap capability URL returned by login; POST returns a list of all other cap URLs |
| Terse update | `ImprovedTerseObjectUpdate` — 10 Hz position+rotation+velocity packet (U16-quantized) |
| Full update | `ObjectUpdate` — full prim/avatar metadata; sent on spawn, region entry, big changes |
| J2C | JPEG2000 codestream — SL/OpenSim's native texture format |
| TE / TextureEntry | Per-face texture+color+repeat+offset+rotation+glow bitfield-packed block on every prim |

## Related Docs

| Doc | Role |
| --- | --- |
| `../README.md` | Public-facing status + roadmap |
| `../CLAUDE.md` | Setup commands, architecture summary, AI session entry point |
| `CONTEXT.md` | Stack, key composables, coordinate transforms |
| `CONVENTIONS.md` | Style, naming, git, AI workflow hooks |
| `tech-debt.md` | Known shortcuts and fragile areas |
| `superpowers/specs/` | Canonical spec — read before implementing |
