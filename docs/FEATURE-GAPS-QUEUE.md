# Feature Gaps — Batch Queue (working front door)

> **This is the curated working surface.** The full detail/history lives in [FEATURE-GAPS.md](FEATURE-GAPS.md)
> (large — treat it as the archive; line refs below point into it). Add new gaps to FEATURE-GAPS.md as
> usual, then promote the actionable ones up here.

## How to batch a sweep (read me first)

To wire up a lot at once, say **"ultracode"** (or "use a workflow") + name a cluster, e.g.
*"ultracode the Inventory-actions cluster"* or *"batch the Right-Click-Menu wires."* That fans out one
subagent per item (TDD + verify each), then I review and you commit.

Rules that keep a sweep fast:
- **Pick from ⚡ BATCH-READY only.** Those are small, well-scoped, and *independent* (don't collide).
- **Skip the ceremony** for these — no per-item brainstorm/spec/plan; implement + test directly. (Say so.)
- **One subsystem per sweep** where possible (shared files don't collide).
- **Batch server edits**, one Bun restart, then client edits over HMR.
- 🧠 **BRAINSTORM-FIRST items are NOT for blind batching** — each needs design (they're structural/risky,
  often touch the live cache/render/cross-region paths). Do those one at a time.

---

## ⚡ BATCH-READY clusters (sweep targets)

Each cluster = independent, small wires. `→` = done-criterion where non-obvious.

### Inventory actions (write side) — FEATURE-GAPS L264–281  ⭐ also unlocks object take/delete
Read-only fetch exists; build the write side. Unlocks the `DeRezObject` family (take/delete/return) +
the "can't delete a friend's object" gap (needs Trash-folder destination + create-from-object).
- create folder · create item · rename (F2) · drag/move to folder · change permissions
- wear/attach · detach/remove wearable · thumbnails (GetTexture) · inventory localStorage cache

### Object Build & Edit Floater — FEATURE-GAPS L170–186
- edit name & description · numeric size/pos/rot input fields · Select-Face radio
- texture drag-drop onto faces · Normal/Specular channels (RenderMaterials cap) · sculpt-texture assign
- Link/Unlink prims · Link-number ordering bug (L183) · create new prim in-world

### Right-click menus (object + avatar) — FEATURE-GAPS L190–207
- avatar: zoom-to · inspect (appearance) · invite to group · save outfit · self menu (Sit/Stand/Fly)
- object: sit-on-object (SitOnObject + RequestObjectPropertiesFamily) · buy/pay · open contents (Xfer)

### Nearby Chat polish — FEATURE-GAPS L227–234
- scrollback persistence · mute names/words filter · options panel (range/channel/font) · search · tear-off

### IM / Conversations — FEATURE-GAPS L238–247
- toolbar buttons (Mute/Share/Pay/TP-Offer/Add-Friend/Block/Profile) · typing indicator (IIM type 41)
- IM history persistence · voice button (stub until Voice lands)

### Places Floater — FEATURE-GAPS L297–324
- show on map · copy SLurl · view/edit landmark (Title+Notes) · move to Favorites · rename/delete
- date accordion grouping · favorites reorder + HUD strip · plus-btn menu

### Profile — FEATURE-GAPS L364–374
- edit own fields (about/first-life/web/languages) · picks tab · classifieds (view) · notes on others

### Map & Minimap — FEATURE-GAPS L328–339
- **Go Home** (home pos is in login response — quick win, L336) · region snapshot tiles (J2C cap)
- MapItemRequest dots · friends layer · CoarseLocationUpdate forward (L337, also fixes neighbor dots)
- remove arbitrary grid lines · map localStorage cache

### Terrain & Environment visuals — FEATURE-GAPS L211–223
- sun/moon directional light · sky gradient · day/night cycle · 4 detail terrain textures (corner-blend)
- wind/cloud LayerData consumers (already decoded) · (water reflections/shadows = bigger, defer)

### Groups & Group IM — FEATURE-GAPS L378–386
- group list from login (AgentGroupDataUpdate) · group info floater · group IM · notices · title toggle

### Trees / plants — FEATURE-GAPS L160–163
- system trees/plants (PCode 0x01/0x04) billboard or fixed-geometry treatment

---

## 🧠 BRAINSTORM-FIRST (one at a time — do NOT blind-batch)

- **Render/cache ceilings & LOD** — FEATURE-GAPS L11–57; READ `docs/render-cache-model.md` first. The far-field
  LOD work is the big remaining heavy-region lever. Many sub-items are interdependent.
- **Cold-asset throughput** — FEATURE-GAPS L63–80. ✅ *mesh Tier-2 disk cache SHIPPED 2026-06-27* ([[mesh-disk-tier-shipped]]);
  remaining = client mesh-fetch concurrency, the ~5-min cold stall, idle texture backfill (L60).
- **Cross-region / neighbor sims** — adjacent-region draw + child-agent circuits (L214), **neighbor avatar frozen
  at edge** (L418, avatar-side of the same work), cross-sim duplicate avatar (L114), cross-region walk handshake (L108).
- **Stale-scene genuine deletes** — the hard fullId/interest-filter piece + FS-style **confirmation-gated preseed**
  (don't paint unconfirmed cache entries). L417. (localId-churn dup half is DONE — [[fullid-dedup-shipped]].)
- **Var-region 512/1024 correctness** — terrain stride/sampling + clamps (L61, L215, L213).
- **Movement** — springback type-2 (L112), sit-at-corner 1/1 (L106), walk start-over (L107).
- **Appearance / baked textures** — full AgentSetAppearance bake pipeline (L118–123, L285–293) — risky, can blank avatars.

---

## Recently shipped (2026-06-27, this session — for reference, don't re-pick)
- Mesh Tier-2 disk cache (committed) · fullId cache dedup + live reconciliation (committed) ·
  PrimMesher full-shape port (committed, GEOM_VERSION 2) · live object pipeline verified (rez/modify/derez).
