# ObjectUpdate decode debug state
_Last updated: 2026-05-23_

## Status: TESTING FIX

### Root cause (confirmed from log 18:13)
OpenSim inserts **25-byte tombstone entries** between real objects in multi-object ObjectUpdate packets.
Format: `localId(4, zeros) + state(1, 0) + fullId(16, zeros) + CRC(4, zeros)` = 25 bytes.
These are NOT full ObjectData records. count field includes them.
Our loop was reading them as real objects, misaligning every subsequent parse.

### Fix applied (lludp-codec.ts ~line 309)
```typescript
if (localId === 0) { off += 21; continue }
```
After reading localId=0 (4 bytes), skip remaining 21 bytes (state+fullId+CRC), continue loop.

### How to verify fix works
Start server + login. Check server-log.txt for:
- Multi-object packets now decoding ALL real objects (pcodes should all be 9 or valid)
- No more "partial decode error" lines
- ObjectUpdate lines showing multiple valid pcodes e.g. `ObjectUpdate: 3 objects (pcodes: 9,9,9)`
- pcode=47 avatar object appears in some packet

### Next steps after fix confirmed
1. Find pcode=47 (avatar) in decoded objects → set `ownAvatarLocalId` in useWorldEngine.js
2. Camera snap to sim-authoritative avatar position from decoded pos field
3. Location bar showing real sim coords
4. Task 15: Three.js world engine
5. Task 16: World view + UI components
6. NO COMMITS until user approves

### Key files
- `server/lib/lludp-codec.ts` — `decodeObjectUpdate()` ~line 286
- `server/handlers/lludp.ts` — `handleUdpMessage()`, ObjectUpdate handler ~line 140
- `src/composables/useWorldEngine.js` — world state, sets ownAvatarLocalId

### pcode values
- 9 = Prim
- 47 = Avatar (own avatar)
- 95 = Grass
- 140 = NewTree / 255 = Tree

### Packet structure reference (verified)
ObjectUpdate High#12:
- Header: 7 bytes (flags+seq+extra)
- RegionHandle(8)+TimeDilation(2) = 10 bytes  → dataOffset=7, regionData ends at 17
- count(1) = 1 byte → objects start at 18
- Per object: fixed(41) + od(odLen) + 31 + variable fields + tail(66)
  - fixed = localId(4)+state(1)+fullId(16)+CRC(4)+pcode(1)+material(1)+clickAction(1)+scale(12)+odLen(1)
  - 31 = parentId(4)+updateFlags(4)+path/profile(23)
  - variable = TE(V2)+TA(V1)+NV(V2)+Data(V1)+Text(V1)+TextColor(4fixed)+MediaURL(V1)+PSBlock(V1)+ExtraParams(V1)
  - tail = Sound(16)+OwnerID(16)+Gain(4)+Flags(1)+Radius(4)+JointType(1)+JointPivot(12)+JointAxisOrAnchor(12)=66
- Tombstone entry: localId=0(4)+state(1)+fullId(16)+CRC(4)=25 bytes → skip with `off+=21; continue`
