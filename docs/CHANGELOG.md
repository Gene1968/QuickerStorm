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

*(New shipped entries go above this line, newest first.)*
