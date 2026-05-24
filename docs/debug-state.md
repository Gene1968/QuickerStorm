# Phase 1 viewer debug state
_Last updated: 2026-05-23_

## Status: TESTING CAMERA/LOCATION FIX

### Completed fixes this session

**ObjectUpdate tombstone fix** (previous session) ✓
- 25-byte tombstone entries skipped correctly in `lludp-codec.ts` ~line 309
- Multi-object packets decode cleanly (verified in server-log.txt)
- pcode=47 avatar decoded on first ObjectUpdate after login

**Third-person camera + location bar** (this session) ✓
- `useWorldEngine.js`: removed first-person snap; camera now lerps behind/above avatar
  - `FOLLOW_DIST = 3.5m` behind, `FOLLOW_HEIGHT = 1.8m` above feet
  - Scroll wheel changes `followDist` (zoom), not camera position
  - Alt-orbit pivot uses avatar pos when known (fixes y=0 ground-lock)
  - Explore mode (no avatar yet): WASD moves camera freely as before
- `worldStore.js`: added `avatarPos` ref + `setAvatarPos()`, updated from TerseUpdate and ObjectUpdate for own avatar
- `LocationBar.vue`: reads `worldStore.avatarPos` (sim-authoritative) instead of camera position
  - Scroll wheel no longer changes displayed coords
  - Coords rounded to integers; clamped to [0,256] in worldStore

### Known remaining issues

**Avatar at region edge (1/1/23 or 255/x/x)**
- Root cause: previous sessions ended without proper logout; sim stored edge position
- Symptom: avatar spawns at edge, can't move (physics boundary)
- Detection: warning logged in debugStore when x<10 or x>246 or y<10 or y>246
- Fix: login with "home" destination instead of "last", OR teleport to 128/128 after spawn
- TODO Phase 2: send LogoutRequest on window close; implement local teleport

**Movement sends AgentUpdate but avatar doesn't move (edge position only)**
- When at edge AND BodyRotation faces into boundary → walk animation plays but physics blocked
- Once avatar is at valid interior position, this should work
- BodyRotation formula verified correct: `slAngle = π/2 + yaw`, Z-only quaternion for Y-up→Z-up

**pcode=200 objects appearing**
- Not in documented list (9=Prim, 47=Avatar, 95=Grass, 140=NewTree, 255=Tree)
- Likely avatar attachment or OpenSim-specific object type
- Not causing errors; just decoded and rendered as prim capsule

### Next steps (Phase 1 completion)

1. User tests new third-person camera — confirm avatar visible, movement visible from Firestorm
2. If avatar stuck at edge: user re-logs with "home" destination
3. Verify location bar shows correct coords matching Firestorm
4. Verify scroll zooms (not moves avatar)
5. Task 17: deploy files check
6. Task 18: smoke test sign-off
7. Merge ai/phase1-viewer → main

### Key files

- `server/lib/lludp-codec.ts` — `decodeObjectUpdate()` ~line 286 (tombstone fix at ~309)
- `server/handlers/lludp.ts` — ObjectUpdate handler, AgentUpdate relay
- `src/composables/useWorldEngine.js` — third-person camera, avatarSLPos, control flags
- `src/stores/worldStore.js` — avatarPos (sim-authoritative position)
- `src/components/LocationBar.vue` — reads worldStore.avatarPos

### pcode values
- 9 = Prim
- 47 = Avatar
- 95 = Grass
- 140 = NewTree / 255 = Tree
- 200 = unknown (avatar attachment?)
