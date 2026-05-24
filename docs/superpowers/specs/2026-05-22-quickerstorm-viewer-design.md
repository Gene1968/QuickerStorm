# quickerSTORM Viewer — Phase 1 Design Spec

**Date:** 2026-05-22  
**Phase:** 1 — Foundation + Login + Basic 3D  
**Status:** Approved

---

## Purpose

quickerSTORM is a web-based viewer for OpenSimulator and Second Life. Users access their virtual world from any browser — no install required. Inspired by Firestorm Viewer and SpeedLight. Built with Vue 3, Three.js, Bun, and WebRTC.

> ⚠ quickerSTORM is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Linden Research, Inc. Second Life® is a registered trademark of Linden Research, Inc.

---

## Architecture

### Topology

```
Users (anywhere)
    ↕  HTTPS / WSS
Cloudflare Edge  ←── outbound tunnel only, no port forwarding
    ↕  Cloudflare Tunnel (cloudflared container)
Synology DS923+
└── Docker / Portainer
    └── Bun container (single process, port 8787)
        ├── Static SPA serving  (Vue build)
        ├── Login proxy         (XML-RPC → grid login servers over HTTPS)
        ├── HTTP caps proxy     (CORS bypass → grid capability endpoints)
        ├── LLUDP bridge        (UDP socket per session ↔ WS messages)
        └── WebSocket server    (browser ↔ all of the above)
            ↕  UDP 9000+
        Grid simulators (SL agni/aditi, OSGrid, Kitely, Neverworld, …)
```

### Approach

Single Bun process (Approach A — monolithic). One Docker container. Right-sized for personal/small-group use. Horizontal split deferred to Phase 3+ if traffic demands it.

### Credential Flow (stateless — nothing stored server-side)

```
Browser → [username + password] → Bun /api/login
  → XML-RPC POST to grid loginURI (server-side, no CORS issue)
  → Grid returns: session_id, agent_id, sim_ip, sim_port,
                  circuit_code, seed_capability URL
  → Bun discards credentials, forwards token bundle to browser via WS
  → Browser holds token bundle in Pinia sessionStore (memory only,
    never localStorage)
  → Bun opens UDP socket for this session → LLUDP circuit setup
```

---

## Phase 1 Scope

### Strip from AVAverse Codebase

| Remove | Reason |
|--------|--------|
| `src/api/supabase/` | No Supabase — grid is the backend |
| `src/composables/useSlack.js` | External integration N/A |
| `src/composables/useJitsiMeet.js` | Replaced by WebRTC voice via grid |
| `src/composables/useCollabDoc.js`, `useWhiteboard.js`, `useTaskBoard.js` | Office collab N/A |
| `src/composables/useYjsProvider.js`, `usePolls.js` | Office collab N/A |
| `src/composables/useDeliveryBots.js`, `centipede/` | AVA-specific |
| `src/composables/useKudos.js`, `useArrivalChime.js`, `usePoseSync.js` | AVA-specific office behaviour |
| `src/components/collab/` | Office collab N/A |
| `src/components/office/` (office room geometry) | Replace with world engine |
| `src/stores/AuthStore.js`, `docsStore.js` | Replace with grid auth stores |
| `server/supabase.ts` | No Supabase |
| `server/handlers/collab.ts`, `collab-permissions.ts`, `connect4.ts` | Office features N/A |
| `server/state/docs.ts` | Collab state N/A |
| `src/office3d/` | Office prefabs; replace with world engine geometry |
| Giphy, Google, Slack refs in remaining files | N/A |
| AVA branding, logos | Replace with quickerSTORM |

### Keep and Extend

| Keep | Becomes |
|------|---------|
| `server/index.ts` + handler structure | Extend: add UDP bridge, login proxy, caps proxy |
| `src/composables/useOfficeEngine.js` | Rename → `useWorldEngine.js`; replace office geometry with SL terrain + prims |
| `src/composables/useRealtimeSocket.js` | Keep as WS bus; replace AVA message types with LLUDP message types |
| `src/composables/useProximityVoice.js` | Keep WebRTC voice; adapt signaling for SL WebRTC voice protocol |
| `src/composables/usePresence.js` | Replace heartbeat logic with LLUDP AgentUpdate loop |
| `src/composables/useTheme.js` | Keep — light/dark theming unchanged |
| `src/composables/useVersionCheck.js` | Keep unchanged |
| `src/stores/avatarStore.js` | Extend for SL avatar shape params (full morph system later phase) |
| Pinia, Vue Router, Tailwind, Three.js, GSAP | All kept |

### Phase 1 Deliverables

1. Landing page — description, grid selector, login form, disclaimer
2. Login flow — XML-RPC proxy through Bun → session token to browser
3. LLUDP bridge skeleton — `UseCircuitCode`, `CompleteAgentMovement`, `AgentUpdate`, `ObjectUpdate`, `AvatarUpdate`, ack loop
4. Basic Three.js world scene — flat terrain placeholder, avatar capsules at real grid positions, name tags
5. Local chat — `ChatFromSimulator` receive, `ChatFromViewer` send
6. Docker + Cloudflare Tunnel deploy (Portainer stack)
7. Grid list — SL (agni + aditi), OSGrid, Kitely, Neverworld; extensible JSON config from Firestorm `grids.xml` format

---

## Data Flows

### Login

```
1.  Browser POSTs { grid, username, password } to Bun /api/login
2.  Bun reads grid loginURI from grids.json (derived from Firestorm grids.xml)
3.  Bun sends XML-RPC request to grid (HTTPS, server-side)
4.  Grid returns: session_id, agent_id, sim_ip, sim_port,
                  circuit_code, seed_capability URL
5.  Bun discards credentials; forwards token bundle to browser via WS
6.  Browser stores token bundle in Pinia sessionStore (memory only)
7.  Bun opens UDP socket for this session
8.  Bun sends UseCircuitCode to sim_ip:sim_port
9.  Bun sends CompleteAgentMovement
10. Sim acknowledges → session live
```

### LLUDP Bridge (per session)

```
Browser (WS message)
    → Bun WS handler
        → encode to LLUDP binary (message.xml template)
        → UDP send to grid simulator

Grid simulator (UDP packet)
    → Bun UDP socket recv
        → parse LLUDP header + body
        → decode to JSON by message type
        → WS send to browser session

Ack loop: Bun tracks packet sequence numbers,
          sends PacketAck back to sim,
          retransmits reliable packets on timeout.
```

**Key LLUDP messages for Phase 1:**

| Direction | Message | Purpose |
|-----------|---------|---------|
| Bun → Sim | `UseCircuitCode` | Open circuit |
| Bun → Sim | `CompleteAgentMovement` | Announce arrival |
| Bun → Sim | `AgentUpdate` | Avatar movement/camera (~10 Hz) |
| Bun → Sim | `ChatFromViewer` | Send local chat |
| Bun → Sim | `LogoutRequest` | Clean disconnect |
| Sim → Bun | `ObjectUpdate` | Prim/avatar positions, properties |
| Sim → Bun | `AvatarUpdate` | Avatar-specific pose data |
| Sim → Bun | `ImprovedTerseObjectUpdate` | Compressed position updates |
| Sim → Bun | `ChatFromSimulator` | Incoming local chat |
| Sim → Bun | `PacketAck` | Acknowledgement |

### 3D Scene Pipeline

```
Sim → ObjectUpdate (UDP)
    → Bun decodes: position, rotation, scale, prim type
    → WS JSON → browser
    → Pinia worldStore updates object map (UUID → state)
    → useWorldEngine.js watches store
        → Three.js: create / update / remove Mesh
            Basic prim:  BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry
            Avatar:      CapsuleGeometry + CSS2DObject name tag
            Position:    Vector3 from sim coords (Z-up → Y-up conversion on decode)

AgentUpdate loop (~10 Hz, browser → sim):
    → useWorldEngine reads camera + WASD/arrow key state
    → encodes AgentUpdate JSON → WS → Bun → UDP → sim
```

**Coordinate system:** SL/OpenSim uses Z-up; Three.js uses Y-up. Bun bridge normalizes on decode (swap Y/Z, negate as needed).

### HTTP Capabilities (direct browser fetch; Bun proxies only for CORS)

```
seed_capability URL → POST → returns capability URL map
cap[FetchInventory]  → POST → inventory tree (Phase 1: list only)
cap[GetTexture]      → GET  → J2K asset → decode via openjpeg WASM → PNG
cap[EventQueueGet]   → long-poll → server-push events (teleport, IMs, etc.)
```

---

## Components

### Vue Frontend

**Views** (`src/views/`):

| View | Purpose |
|------|---------|
| `LandingView.vue` | Public landing — description, disclaimer, grid selector, login form |
| `WorldView.vue` | Main 3D viewport — Three.js canvas, chat bar, overlays |

**Pinia Stores** (`src/stores/`):

| Store | Purpose |
|-------|---------|
| `gridStore.js` | Grid list from grids.json, selected grid, login state |
| `sessionStore.js` | Session token, agent_id, circuit info, sim connection status |
| `avatarStore.js` | Local avatar identity, display name, appearance (extend existing) |
| `worldStore.js` | Object map (UUID → position / rotation / scale / prim type) |
| `chatStore.js` | Local chat history, nearby voice indicators |
| `uiStore.js` | Panel visibility, minimap toggle, 2D/3D mode flag |

**Composables** (`src/composables/`):

| Composable | Purpose |
|-----------|---------|
| `useGridLogin.js` | Login form logic → WS → Bun login proxy |
| `useWorldEngine.js` | Three.js scene; watches worldStore; renders prims + avatars |
| `useRealtimeSocket.js` | WS singleton (keep; replace AVA message types) |
| `useLLUDP.js` | Client-side LLUDP message encoder (AgentUpdate, chat, etc. → JSON for WS) |
| `useLocalChat.js` | Send/receive local chat |
| `use2DFallback.js` | Detect low-end/mobile → switch to 2D flat map view |
| `useTheme.js` | Keep unchanged |
| `useVersionCheck.js` | Keep unchanged |

**Components** (`src/components/`):

| Component | Purpose |
|-----------|---------|
| `WorldCanvas.vue` | Mounts Three.js renderer, handles resize |
| `ChatBar.vue` | Local chat input + scrolling history overlay |
| `AvatarList.vue` | Nearby users sidebar panel |
| `MinimapOverlay.vue` | 2D SVG minimap — region grid + avatar dots |
| `GridSelector.vue` | Grid picker dropdown on landing page |
| `LoginForm.vue` | Credentials form, wires to `useGridLogin` |
| `SimpleWorldView.vue` | 2D fallback — top-down HTML canvas, avatar dots, chat |
| `HUDLayer.vue` | Coordinates, region name, FPS, connection status overlay |

### Bun Server (`server/`)

```
server/
├── index.ts                 ← keep; add UDP socket manager
├── handlers/
│   ├── login.ts             ← NEW: XML-RPC proxy to grid loginURI
│   ├── caps.ts              ← NEW: HTTP caps CORS proxy
│   ├── lludp.ts             ← NEW: UDP socket per session, encode/decode
│   ├── signaling.ts         ← keep (WebRTC voice signaling)
│   ├── presence.ts          ← remove AVA logic; LLUDP presence replaces
│   └── chat.ts              ← repurpose: relay ChatFromSimulator to browser
├── lib/
│   ├── grids.ts             ← NEW: load + parse grids.json
│   ├── xmlrpc.ts            ← NEW: minimal XML-RPC client (login only)
│   ├── lludp-codec.ts       ← NEW: parse message.xml template; encode/decode packets
│   └── circuit.ts           ← NEW: circuit state, ack tracking, reliable retransmit
└── state/
    └── sessions.ts          ← NEW: Map<sessionId, { udpSocket, circuitInfo, wsSocket }>
```

### Static Config (`src/config/`)

```
grids.json    ← grid list derived from Firestorm grids.xml
              {
                "agni": {
                  "name": "Second Life",
                  "loginURI": "https://login.agni.lindenlab.com/cgi-bin/login.cgi",
                  "slurl_base": "secondlife://",
                  "system": true
                },
                ...
              }
```

---

## Hosting & Infrastructure

### Docker Compose (`deploy/docker-compose.yml`)

```yaml
services:
  app:
    build: .
    ports:
      - "8787:8787"        # internal only; Cloudflare reaches via tunnel
    environment:
      - NODE_ENV=production
      - STATIC_DIR=/app/dist/prod
      - PORT=8787
    volumes:
      - ./data:/app/data   # grids.json, any future local config
    restart: unless-stopped

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    restart: unless-stopped
```

### Dockerfile

```dockerfile
FROM oven/bun:latest
WORKDIR /app
COPY package*.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:prod
EXPOSE 8787
CMD ["bun", "run", "server/index.ts"]
```

### Cloudflare Tunnel Setup (one-time)

```sh
# 1. Create tunnel in Cloudflare dashboard → Zero Trust → Tunnels
# 2. Copy tunnel token → set as CF_TUNNEL_TOKEN in Portainer env
# 3. In dashboard: add public hostname
#      Subdomain: quickerstorm (or app)
#      Domain:    yourdomain.com
#      Service:   http://app:8787
# 4. WSS works automatically — Cloudflare proxies WebSocket upgrades
# No router port forwarding required.
```

No public ports exposed on the Synology or home router.

---

## Landing Page

```
┌─────────────────────────────────────────────────────────────┐
│  quickerSTORM                                    [☀ / 🌙]  │
│  A web-based viewer for OpenSimulator and Second Life        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Grid: [ Second Life (agni)          ▼ ]                  │
│                                                             │
│   Username: [                    ]                          │
│   Password: [                    ]                          │
│                                                             │
│                    [ Log In ]                               │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  ⚠ Not affiliated with Linden Research, Inc.                │
│    Second Life® is a registered trademark of                 │
│    Linden Research, Inc.                                    │
│                                                             │
│  Credentials are transmitted once for login only and are    │
│  never stored. Session token held in browser memory only.   │
│                                                             │
│  Built with Vue 3 · Three.js · Bun · WebRTC                │
│  Inspired by Firestorm Viewer and SpeedLight               │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Feasibility

### Legend
- ✅ High — straightforward, Phase 1 or Phase 2
- 🟡 Medium — feasible, non-trivial, Phase 2–3
- 🔴 Hard — significant engineering, Phase 3+
- ❌ N/A — out of scope or technically blocked

### Table

| Feature | Feasibility | Notes |
|---------|-------------|-------|
| **Foundation** | | |
| Grid list + login (XML-RPC) | ✅ High | Bun proxy; `grids.xml` → `grids.json` |
| Session token handling | ✅ High | Stateless; browser memory only |
| LLUDP bridge (basic) | ✅ High | Bun UDP + WS; well-defined wire protocol |
| Local chat send/receive | ✅ High | `ChatFromSimulator` / `ChatFromViewer` |
| Nearby avatar positions | ✅ High | `ObjectUpdate` / `AvatarUpdate` |
| Basic movement (WASD) | ✅ High | `AgentUpdate` ~10 Hz loop |
| Teleport + SLURL | ✅ High | `TeleportRequest` cap |
| Inventory list/view | ✅ High | HTTP caps; no UDP required |
| Landmarks | ✅ High | Inventory type + teleport |
| 2D fallback view | ✅ High | HTML canvas, avatar dots, chat |
| Cloudflare Tunnel hosting | ✅ High | Docker + cloudflared; proven pattern |
| **3D Rendering** | | |
| Basic prims (box, sphere, cylinder, torus) | ✅ High | Three.js built-in geometries from `ObjectUpdate` |
| Avatar capsules + name tags | ✅ High | `CapsuleGeometry` + `CSS2DObject` sprites |
| Normal maps | ✅ High | `MeshStandardMaterial` built-in |
| Emissive materials | ✅ High | Three.js built-in |
| Transparency / alpha masking | ✅ High | `alphaTest` / `alphaBlend` modes |
| Terrain heightmap | 🟡 Medium | UDP heightmap patches → `PlaneGeometry` displacement |
| Texture loading (J2K → PNG) | 🟡 Medium | openjpeg WASM or Bun-side decode → serve as PNG |
| PBR materials (glTF model) | 🟡 Medium | SL PBR (2023+) maps to `MeshStandardMaterial` / `MeshPhysicalMaterial`; base color, metallic-roughness, occlusion, normal, emissive all supported in Three.js |
| Environment maps / IBL | 🟡 Medium | Three.js `PMREMGenerator`; SL reflection probes → `CubeCamera` |
| Sculpt maps | 🟡 Medium | Texture-driven mesh deform; buildable in Three.js |
| Linkset mesh objects | 🟡 Medium | LLSD binary + zlib → Bun decode → `BufferGeometry` |
| Particle systems | 🟡 Medium | Three.js `Points` / `BufferGeometry` |
| Water / ocean shader | 🟡 Medium | Custom `ShaderMaterial`; SL water is procedural noise |
| Shadows | 🟡 Medium | Three.js shadow maps; needs tuning for large outdoor scenes |
| Windlight sky / atmosphere | 🔴 Hard | SL atmospheric scattering model; Three.js `Sky` addon covers basics only |
| Mirrors / planar reflections | 🔴 Hard | No Three.js built-in; requires custom render-to-texture pass |
| Screen-space reflections (SSR) | 🔴 Hard | Three.js postprocessing addon; expensive; mobile-hostile |
| Volumetric lighting / god rays | 🔴 Hard | Three.js postprocessing; significant performance cost |
| **Communication** | | |
| Group chat | 🟡 Medium | Group messages via caps + LLUDP |
| IM / direct message | 🟡 Medium | `ImprovedInstantMessage` LLUDP message |
| Voice (WebRTC) | 🟡 Medium | SL shipping WebRTC voice natively (2023); `useProximityVoice.js` reusable |
| In-world audio / parcel music | 🟡 Medium | Parcel data contains stream URL → HTML5 Audio |
| **World Interaction** | | |
| HUDs / attachments | 🟡 Medium | Attachment data in `ObjectUpdate`; HUD render layer |
| Object click / touch | 🟡 Medium | Three.js raycast → send `ObjectGrab` to sim |
| Sit on object | 🟡 Medium | `AgentSit` + position offset from sit target |
| Minimap | 🟡 Medium | 2D SVG; avatar dots from worldStore |
| Groups management | 🟡 Medium | Group capability endpoints |
| Importing (OBJ/DAE mesh upload) | 🟡 Medium | Mesh upload cap; format conversion Bun-side |
| Exporting (save local) | 🟡 Medium | Cap download + LLSD decode |
| **Advanced / Later Phases** | | |
| Basic building (rez, move, resize) | 🔴 Hard | Many LLUDP object edit messages |
| Script editor (LSL) | 🔴 Hard | Custom Monaco grammar; script upload cap |
| Script editor (Lua — when SL ships it) | 🔴 Hard | Monaco has built-in Lua support; easier than LSL |
| Full avatar appearance editor | 🔴 Hard | 200+ morph parameters; later phase |
| Physics-accurate movement | 🔴 Hard | Out of scope for browser |
| Vivox voice (SL legacy) | ❌ N/A | Proprietary; no public API; WebRTC path preferred |

### Note on LSL vs Lua

Linden Lab is adding Lua as an additional scripting option (not replacing LSL). Scripts run server-side on simulators regardless of language — the viewer sees effects only (object moves, chat, dialogs), never executes scripts. Impact on viewer:
- **Negligible** for rendering and world interaction
- **Meaningful** for script editor UI: Monaco has full built-in Lua support; LSL requires a custom grammar
- **OpenSim** is unlikely to adopt Lua soon; stays on LSL/OSSL
- Implement LSL editor first; add Lua editor when LL ships it broadly

---

## Future Scaling

Phase 1 runs as a single Bun process on the Synology DS923+ NAS — sufficient for personal use and small groups. If public traffic grows:

| Stage | Action |
|-------|--------|
| 1 — Vertical | DS923+ scales to 32 GB RAM; Bun handles thousands of WS connections per process |
| 2 — Split | Extract LLUDP bridge into separate container(s) behind load balancer; login proxy is stateless and trivially scalable |
| 3 — Cloud LLUDP | Move UDP bridge to cloud VPS (Oracle Free, Fly.io, or paid) closer to SL/OpenSim data centers; reduces round-trip latency vs. home NAS |
| 4 — Asset cache | Texture/mesh CDN layer (Cloudflare R2 or similar) avoids re-fetching assets from grids per user |

No browser client changes required for any of these — only the bridge URL changes in config.

---

## References

- Firestorm source: `indra/llmessage/` (LLUDP protocol), `indra/newview/app_settings/grids.xml` (grid list), `indra/newview/app_settings/message.xml` (message templates)
- Firestorm WebRTC voice: `indra/newview/llvoicewebrtc.h` (2023, production)
- SpeedLight: https://speedlight.io / https://docs.speedlight.io (prior art, open source WS bridge)
- Three.js PBR: `MeshStandardMaterial`, `MeshPhysicalMaterial`, `PMREMGenerator`
- openjpeg WASM: for JPEG2000 texture decode in browser
- Cloudflare Tunnel docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
