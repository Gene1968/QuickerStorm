# Phase 3 debug state
_Last updated: 2026-05-31_

## Status: Phase 3 active — social + appearance shipped, texture pipeline next

### Shipped this phase (not yet live-verified)
- Friends/Contacts tab in ConversationsFloater — full UI wired, needs live session test
- var-region terrain 32×32 patch codec — fixed 2026-05-30, needs NeverWorld confirmation
- Appearance/Outfits floater shell

### Active known issues
- CoarseLocationUpdate dropped at server/handlers/lludp.ts:630 — minimap dots limited to ObjectUpdate range
- `[PrimDiag]` heartbeat logging still active in lludp.ts:264 — harmless but noisy

### Next up
- J2C texture pipeline (GetTexture cap → WASM openjpeg → real prim textures)
- Friends/Contacts live-test
- Shear deformation in useWorldEngine.js:applyShapeDeformation (~1h)

### Key files for Phase 3 debugging
- `src/composables/useSocial.js` — friend management pipeline
- `src/stores/gridSocialStore.js` — friends/groups/names
- `src/stores/notificationStore.js` — toast queue
- `src/components/ConversationsFloater.vue` — IM + contacts UI
- `server/handlers/lludp.ts:630` — CoarseLocationUpdate (forwarding TODO)
- `server/lib/terrain-codec.ts` — 32×32 patch support (verify on NeverWorld)

### pcode values
- 9 = Prim / 47 = Avatar / 95 = Grass / 140 = NewTree / 255 = Tree / 200 = attachment (unknown)
