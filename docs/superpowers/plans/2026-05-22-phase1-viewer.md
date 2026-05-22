# QuickerStorm Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip AVAverse to a shell, implement grid login via Bun LLUDP bridge, render a basic Three.js world with real avatar positions and local chat, deploy via Docker + Cloudflare Tunnel on Synology DS923+.

**Architecture:** Single Bun process bridges browser WebSockets to per-session UDP sockets (LLUDP). Browser authenticates via XML-RPC proxy in Bun (stateless — credentials discarded after login). Three.js scene driven by ObjectUpdate/AvatarUpdate messages decoded from UDP. Hosted in Docker on Synology, exposed via Cloudflare Tunnel (no port forwarding).

**Tech Stack:** Vue 3 (`<script setup>`), Pinia, Vue Router (hash history), Three.js, Bun WS + Node `dgram` UDP, Tailwind CSS (existing tokens), Vitest + jsdom (frontend tests), `bun test` (server tests)

**Message ID reference:** Verify all LLUDP message IDs against `C:\Users\gene1\Downloads\Pages\git\phoenix-firestorm\indra\newview\app_settings\message.xml` — comments below flag which need verification.

---

## File Map

### Delete entirely
```
src/api/supabase/
src/composables/useSlack.js
src/composables/useJitsiMeet.js
src/composables/useGoogleCalendar.js
src/composables/useGmailNotify.js
src/composables/useCollabDoc.js
src/composables/useWhiteboard.js
src/composables/useTaskBoard.js
src/composables/useYjsProvider.js
src/composables/usePolls.js
src/composables/useDeliveryBots.js
src/composables/useKudos.js
src/composables/useArrivalChime.js
src/composables/usePoseSync.js
src/composables/centipede/
src/components/collab/
src/components/office/
src/office3d/
src/stores/AuthStore.js
src/stores/docsStore.js
src/views/HomeView.vue
src/views/MetricsView.vue
src/views/TeamView.vue
server/supabase.ts
server/handlers/collab.ts
server/handlers/collab-permissions.ts
server/handlers/connect4.ts
server/state/docs.ts
```

### Create
```
src/config/grids.json
src/stores/gridStore.js
src/stores/sessionStore.js
src/stores/worldStore.js
src/stores/chatStore.js
src/stores/uiStore.js
src/composables/useGridLogin.js
src/composables/useWorldEngine.js
src/composables/useLLUDP.js
src/composables/useLocalChat.js
src/composables/use2DFallback.js
src/views/LandingView.vue
src/views/WorldView.vue
src/components/WorldCanvas.vue
src/components/ChatBar.vue
src/components/AvatarList.vue
src/components/MinimapOverlay.vue
src/components/GridSelector.vue
src/components/LoginForm.vue
src/components/SimpleWorldView.vue
src/components/HUDLayer.vue
server/lib/grids.ts
server/lib/xmlrpc.ts
server/lib/lludp-codec.ts
server/lib/circuit.ts
server/handlers/login.ts
server/handlers/caps.ts
server/handlers/lludp.ts
server/state/sessions.ts
server/__tests__/lludp-codec.test.ts
server/__tests__/xmlrpc.test.ts
server/__tests__/circuit.test.ts
src/__tests__/stores/gridStore.test.js
deploy/Dockerfile
deploy/docker-compose.yml
deploy/cloudflare-tunnel.md
deploy/synology-setup.md
```

### Modify
```
shared/protocol.js          — replace AVA types with LLUDP envelope types
src/router/index.js         — LandingView + WorldView routes
src/main.js                 — remove Supabase/Google imports
src/App.vue                 — replace with minimal RouterView shell
src/stores/avatarStore.js   — strip Slack/Google fields, keep identity core
src/composables/useRealtimeSocket.js — keep WS bus, widen to LLUDP messages
package.json                — remove @supabase/supabase-js, yjs, y-protocols
```

---

## Task 1: Strip AVAverse

**Files:** Delete list above + modify `package.json`

- [ ] **Step 1: Delete dead files**

```powershell
cd "C:\Users\gene1\Downloads\Pages\git\QuickerStorm"
Remove-Item -Recurse -Force src/api/supabase
Remove-Item -Force src/composables/useSlack.js, src/composables/useJitsiMeet.js
Remove-Item -Force src/composables/useGoogleCalendar.js, src/composables/useGmailNotify.js
Remove-Item -Force src/composables/useCollabDoc.js, src/composables/useWhiteboard.js
Remove-Item -Force src/composables/useTaskBoard.js, src/composables/useYjsProvider.js
Remove-Item -Force src/composables/usePolls.js, src/composables/useDeliveryBots.js
Remove-Item -Force src/composables/useKudos.js, src/composables/useArrivalChime.js
Remove-Item -Force src/composables/usePoseSync.js
Remove-Item -Recurse -Force src/composables/centipede
Remove-Item -Recurse -Force src/components/collab
Remove-Item -Recurse -Force src/components/office
Remove-Item -Recurse -Force src/office3d
Remove-Item -Force src/stores/AuthStore.js, src/stores/docsStore.js
Remove-Item -Force src/views/HomeView.vue, src/views/MetricsView.vue, src/views/TeamView.vue
Remove-Item -Force server/supabase.ts
Remove-Item -Force server/handlers/collab.ts, server/handlers/collab-permissions.ts
Remove-Item -Force server/handlers/connect4.ts
Remove-Item -Force server/state/docs.ts
```

- [ ] **Step 2: Remove dead dependencies from package.json**

In `package.json`, remove these from `dependencies`:
```json
"@supabase/supabase-js": "^2.103.2",
"y-protocols": "^1.0.7",
"yjs": "^13.6.30"
```

Keep everything else (Three.js, GSAP, chart.js, etc. are all useful).

- [ ] **Step 3: Reinstall**

```powershell
npm install
```

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "chore: strip AVAverse — remove Supabase, collab, office, Slack, Google"
```

---

## Task 2: Replace shared/protocol.js

**Files:** Modify `shared/protocol.js`

- [ ] **Step 1: Replace with LLUDP envelope types**

Overwrite `shared/protocol.js`:

```javascript
/**
 * shared/protocol.js — WebSocket envelope types for QuickerStorm LLUDP bridge.
 * Imported by Bun server and Vue client.
 * Convention: client→server and server→client messages use { t, d } envelope.
 */

// ── Client → Server ─────────────────────────────────────────────────────
export const C = {
  LOGIN:        'login',      // { grid, username, password }
  LOGOUT:       'logout',     // {}
  MOVE:         'move',       // { controlFlags, bodyRot, headRot, camCenter, camAt, camLeft, camUp, far }
  CHAT:         'chat',       // { message, type, channel }
  CAPS_FETCH:   'caps_fetch', // { url, method, body? } — CORS proxy
}

// ── Server → Client ─────────────────────────────────────────────────────
export const S = {
  LOGIN_OK:     'login_ok',   // { agentId, sessionId, simIp, simPort, seedCap, regionName }
  LOGIN_FAIL:   'login_fail', // { message }
  OBJECT_UPDATE:'obj_upd',    // { objects: [{ localId, fullId, pcode, pos, rot, scale, name }] }
  CHAT_MSG:     'chat_msg',   // { fromName, sourceId, type, channel, message, pos }
  REGION_INFO:  'region',     // { name, handle, waterHeight }
  TELEPORT_OK:  'tp_ok',      // { regionName, seedCap }
  CAPS_RESULT:  'caps_result',// { id, status, body }
  ERROR:        'error',      // { code, message }
}

// ── WebRTC voice signaling (keep for proximity voice) ───────────────────
export const SIG = {
  OFFER:        'offer',
  ANSWER:       'answer',
  ICE:          'ice',
  PEER_JOINED:  'peer-joined',
  PEER_LEFT:    'peer-left',
}
```

- [ ] **Step 2: Commit**

```powershell
git add shared/protocol.js
git commit -m "feat(protocol): replace AVA WS types with LLUDP bridge envelope"
```

---

## Task 3: Grid Config

**Files:** Create `src/config/grids.json`, create `server/lib/grids.ts`, create `server/__tests__/` dir

- [ ] **Step 1: Create grids.json**

Create `src/config/grids.json`:

```json
{
  "agni": {
    "name": "Second Life",
    "nick": "agni",
    "loginURI": "https://login.agni.lindenlab.com/cgi-bin/login.cgi",
    "slurl_base": "secondlife://",
    "system": true
  },
  "aditi": {
    "name": "Second Life Beta",
    "nick": "aditi",
    "loginURI": "https://login.aditi.lindenlab.com/cgi-bin/login.cgi",
    "slurl_base": "secondlife://",
    "system": true
  },
  "osgrid": {
    "name": "OSGrid",
    "nick": "osgrid",
    "loginURI": "https://login.osgrid.org/",
    "slurl_base": "hop://login.osgrid.org/",
    "system": false
  },
  "kitely": {
    "name": "Kitely",
    "nick": "kitely",
    "loginURI": "https://grid.kitely.com:8002/",
    "slurl_base": "kitely://",
    "system": false
  },
  "neverworld": {
    "name": "Neverworld Grid",
    "nick": "neverworld",
    "loginURI": "https://neverworld.net:8002/",
    "slurl_base": "hop://neverworld.net/",
    "system": false
  }
}
```

> Verify loginURIs against each grid's public documentation before first live test.

- [ ] **Step 2: Create server/lib/grids.ts**

```typescript
// server/lib/grids.ts — load and validate grid config
import { readFileSync } from 'fs'
import { join } from 'path'

export interface Grid {
  name: string
  nick: string
  loginURI: string
  slurl_base: string
  system: boolean
}

let _grids: Record<string, Grid> | null = null

export function getGrids(): Record<string, Grid> {
  if (_grids) return _grids
  const raw = readFileSync(join(process.cwd(), 'src/config/grids.json'), 'utf8')
  _grids = JSON.parse(raw) as Record<string, Grid>
  return _grids
}

export function getGrid(nick: string): Grid | undefined {
  return getGrids()[nick]
}
```

- [ ] **Step 3: Create test dir and write test**

```powershell
mkdir server/__tests__
```

Create `server/__tests__/grids.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { getGrid, getGrids } from '../lib/grids'

describe('grids', () => {
  it('loads all grids', () => {
    const grids = getGrids()
    expect(Object.keys(grids).length).toBeGreaterThan(0)
  })

  it('returns agni grid with correct loginURI', () => {
    const g = getGrid('agni')
    expect(g).toBeDefined()
    expect(g!.loginURI).toContain('agni.lindenlab.com')
  })

  it('returns undefined for unknown grid', () => {
    expect(getGrid('nonexistent')).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run test**

```powershell
cd server && bun test __tests__/grids.test.ts
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```powershell
cd ..
git add src/config/grids.json server/lib/grids.ts server/__tests__/grids.test.ts
git commit -m "feat(grids): grid config JSON + server loader + tests"
```

---

## Task 4: XML-RPC Client

**Files:** Create `server/lib/xmlrpc.ts`, `server/__tests__/xmlrpc.test.ts`

The SL/OpenSim login protocol uses XML-RPC. Password must be sent as `$1$` + MD5 hash of the plaintext password.

- [ ] **Step 1: Write failing test**

Create `server/__tests__/xmlrpc.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { buildLoginXml, parseLoginResponse, hashPassword } from '../lib/xmlrpc'

describe('xmlrpc', () => {
  it('hashPassword produces $1$-prefixed md5', () => {
    // echo -n "testpass" | md5sum → 179ad45c6ce2cb97cf1029e212046e81
    expect(hashPassword('testpass')).toBe('$1$179ad45c6ce2cb97cf1029e212046e81')
  })

  it('buildLoginXml produces valid XML-RPC envelope', () => {
    const xml = buildLoginXml({ first: 'John', last: 'Doe', hashedPass: '$1$abc', start: 'last' })
    expect(xml).toContain('<methodName>login_to_simulator</methodName>')
    expect(xml).toContain('<name>first</name>')
    expect(xml).toContain('<string>John</string>')
    expect(xml).toContain('$1$abc')
  })

  it('parseLoginResponse extracts success fields', () => {
    const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>true</string></value></member>
      <member><name>session_id</name><value><string>aaaabbbb-0000-1111-2222-ccccddddeeee</string></value></member>
      <member><name>agent_id</name><value><string>11112222-3333-4444-5555-666677778888</string></value></member>
      <member><name>sim_ip</name><value><string>127.0.0.1</string></value></member>
      <member><name>sim_port</name><value><i4>9000</i4></value></member>
      <member><name>circuit_code</name><value><i4>12345</i4></value></member>
      <member><name>seed_capability</name><value><string>https://example.com/cap/abc</string></value></member>
    </struct></value></param></params></methodResponse>`
    const result = parseLoginResponse(xml)
    expect(result.login).toBe(true)
    expect(result.session_id).toBe('aaaabbbb-0000-1111-2222-ccccddddeeee')
    expect(result.sim_port).toBe(9000)
    expect(result.circuit_code).toBe(12345)
  })

  it('parseLoginResponse extracts failure message', () => {
    const xml = `<?xml version="1.0"?><methodResponse><params><param><value><struct>
      <member><name>login</name><value><string>false</string></value></member>
      <member><name>message</name><value><string>Bad credentials</string></value></member>
    </struct></value></param></params></methodResponse>`
    const result = parseLoginResponse(xml)
    expect(result.login).toBe(false)
    expect(result.message).toBe('Bad credentials')
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```powershell
cd server && bun test __tests__/xmlrpc.test.ts
```

Expected: FAIL — `Cannot find module '../lib/xmlrpc'`

- [ ] **Step 3: Implement server/lib/xmlrpc.ts**

```typescript
// server/lib/xmlrpc.ts — minimal XML-RPC client for SL/OpenSim grid login
import { createHash } from 'crypto'

export interface LoginParams {
  first: string
  last: string
  hashedPass: string  // already $1$-prefixed md5
  start: string       // 'last', 'home', or 'uri:region&x&y&z'
}

export interface LoginResult {
  login: boolean
  session_id?: string
  agent_id?: string
  sim_ip?: string
  sim_port?: number
  circuit_code?: number
  seed_capability?: string
  region_x?: number
  region_y?: number
  message?: string
}

/** Hash plaintext password per SL protocol: "$1$" + md5(password) */
export function hashPassword(plaintext: string): string {
  const md5 = createHash('md5').update(plaintext, 'utf8').digest('hex')
  return `$1$${md5}`
}

/** Build the XML-RPC login_to_simulator request body */
export function buildLoginXml(p: LoginParams): string {
  const str = (name: string, val: string) =>
    `<member><name>${name}</name><value><string>${val}</string></value></member>`
  const bool = (name: string, val: boolean) =>
    `<member><name>${name}</name><value><boolean>${val ? 1 : 0}</boolean></value></member>`

  return `<?xml version="1.0"?>
<methodCall>
  <methodName>login_to_simulator</methodName>
  <params><param><value><struct>
    ${str('first', p.first)}
    ${str('last', p.last)}
    ${str('passwd', p.hashedPass)}
    ${str('start', p.start)}
    ${str('channel', 'QuickerStorm')}
    ${str('version', '0.1.0')}
    ${str('platform', 'web')}
    ${str('mac', '00:00:00:00:00:00')}
    ${str('id0', '00000000-0000-0000-0000-000000000000')}
    ${bool('agree_to_tos', true)}
    ${bool('read_critical', true)}
  </struct></value></param></params>
</methodCall>`
}

/** Parse an XML-RPC methodResponse struct into a flat object */
export function parseLoginResponse(xml: string): LoginResult {
  const members: Record<string, string> = {}

  // Extract all <member> blocks
  const memberRe = /<member>\s*<name>([^<]+)<\/name>\s*<value>\s*(?:<([^>]+)>)?([^<]*)(?:<\/[^>]+>)?\s*<\/value>\s*<\/member>/g
  let m: RegExpExecArray | null
  while ((m = memberRe.exec(xml)) !== null) {
    const [, name, , value] = m
    members[name.trim()] = value.trim()
  }

  const login = members['login'] === 'true' || members['login'] === '1'
  if (!login) {
    return { login: false, message: members['message'] || 'Login failed' }
  }

  return {
    login: true,
    session_id:      members['session_id'],
    agent_id:        members['agent_id'],
    sim_ip:          members['sim_ip'],
    sim_port:        parseInt(members['sim_port'] ?? '0', 10),
    circuit_code:    parseInt(members['circuit_code'] ?? '0', 10),
    seed_capability: members['seed_capability'],
    region_x:        parseInt(members['region_x'] ?? '0', 10),
    region_y:        parseInt(members['region_y'] ?? '0', 10),
  }
}

/** POST an XML-RPC request; returns parsed body string */
export async function xmlRpcPost(uri: string, body: string): Promise<string> {
  const res = await fetch(uri, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
    body,
  })
  if (!res.ok) throw new Error(`XML-RPC HTTP error ${res.status}`)
  return res.text()
}
```

- [ ] **Step 4: Run tests — expect pass**

```powershell
bun test __tests__/xmlrpc.test.ts
```

Expected: 4 passing

- [ ] **Step 5: Commit**

```powershell
cd ..
git add server/lib/xmlrpc.ts server/__tests__/xmlrpc.test.ts
git commit -m "feat(server): XML-RPC login client + hash + parser + tests"
```

---

## Task 5: Session State

**Files:** Create `server/state/sessions.ts`

- [ ] **Step 1: Create sessions.ts**

```typescript
// server/state/sessions.ts — per-user circuit state for LLUDP bridge
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'

export interface CircuitState {
  agentId:     string
  sessionId:   string
  simIp:       string
  simPort:     number
  circuitCode: number
  seqNum:      number   // next outgoing sequence number (increment before use)
  pendingAcks: number[] // incoming reliable packet IDs awaiting our ack
  // Reliable packets we sent, waiting for sim's ack
  reliableOut: Map<number, { buf: Buffer; sentAt: number; retries: number }>
  udpSocket:   dgram.Socket
  ws:          ServerWebSocket<unknown>
}

const sessions = new Map<string, CircuitState>()

export function createSession(id: string, state: CircuitState): void {
  sessions.set(id, state)
}

export function getSession(id: string): CircuitState | undefined {
  return sessions.get(id)
}

export function deleteSession(id: string): void {
  const s = sessions.get(id)
  if (s) {
    try { s.udpSocket.close() } catch {}
    sessions.delete(id)
  }
}

export function allSessions(): Map<string, CircuitState> {
  return sessions
}
```

- [ ] **Step 2: Commit**

```powershell
git add server/state/sessions.ts
git commit -m "feat(server): per-session circuit state map"
```

---

## Task 6: LLUDP Codec

**Files:** Create `server/lib/lludp-codec.ts`, `server/__tests__/lludp-codec.test.ts`

LLUDP packet layout:
```
[1]  Flags  — 0x10=reliable, 0x40=has-acks, 0x01=zero-coded
[4]  Sequence number (big-endian uint32)
[1]  Extra bytes count (always 0 for us)
[N]  Message ID:
       High freq (0x01–0xFE):       1 byte
       Medium freq (0xFF, 0x01–FE): 2 bytes
       Low freq (0xFF,0xFF, u16BE):  4 bytes
       Fixed (0xFF,0xFF,0xFF, u8):   4 bytes
[…]  Body (message-specific)
[…]  Appended acks if Flags & 0x40: [u8 count][u32 seq…]
```

Verify these IDs in `phoenix-firestorm/indra/newview/app_settings/message.xml`:

| Message | Freq | ID bytes |
|---------|------|----------|
| AgentUpdate | High | `0x04` |
| UseCircuitCode | Low | `0xFF 0xFF 0x00 0x03` |
| CompleteAgentMovement | Low | `0xFF 0xFF 0x00 0xF9` |
| LogoutRequest | Low | `0xFF 0xFF 0x00 0xFC` |
| PacketAck | Fixed | `0xFF 0xFF 0xFF 0xFB` |
| ChatFromViewer | Low | verify in message.xml |
| ChatFromSimulator | Low | verify in message.xml |
| ObjectUpdate | Low | verify in message.xml |
| ImprovedTerseObjectUpdate | High | verify in message.xml |

- [ ] **Step 1: Write failing tests**

Create `server/__tests__/lludp-codec.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import {
  buildHeader, parseHeader,
  encodeUseCircuitCode,
  encodeCompleteAgentMovement,
  encodePacketAck,
  encodeLogoutRequest,
  parseMsgType,
  decodeChatFromSimulator,
  decodeZeroCoded,
  encodeZeroCoded,
} from '../lib/lludp-codec'

const AGENT_ID  = '11112222-3333-4444-5555-666677778888'
const SESSION_ID = 'aaaabbbb-0000-1111-2222-ccccddddeeee'

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '')
  return Buffer.from(hex, 'hex')
}

describe('buildHeader / parseHeader', () => {
  it('round-trips a reliable header', () => {
    const hdr = buildHeader({ seq: 42, reliable: true, hasAcks: false, zeroCoded: false })
    const parsed = parseHeader(hdr)
    expect(parsed.seq).toBe(42)
    expect(parsed.reliable).toBe(true)
    expect(parsed.hasAcks).toBe(false)
  })
})

describe('zero coding', () => {
  it('decodes zero runs correctly', () => {
    // 0x00 0x03 means three zero bytes
    const encoded = Buffer.from([0x01, 0x00, 0x03, 0x02])
    const decoded = decodeZeroCoded(encoded)
    expect(decoded).toEqual(Buffer.from([0x01, 0x00, 0x00, 0x00, 0x02]))
  })

  it('encodes consecutive zeros', () => {
    const raw = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x02])
    const enc = encodeZeroCoded(raw)
    expect(enc).toEqual(Buffer.from([0x01, 0x00, 0x03, 0x02]))
  })
})

describe('encodeUseCircuitCode', () => {
  it('produces a buffer with correct circuit code', () => {
    const buf = encodeUseCircuitCode({ agentId: AGENT_ID, sessionId: SESSION_ID, circuitCode: 12345, seq: 1 })
    expect(buf.length).toBeGreaterThan(10)
    // bytes 5 == 0 (no extra), bytes 6-9 == Low freq ID 0xFF 0xFF 0x00 0x03
    expect(buf[6]).toBe(0xFF)
    expect(buf[7]).toBe(0xFF)
    expect(buf[8]).toBe(0x00)
    expect(buf[9]).toBe(0x03)
  })
})

describe('encodePacketAck', () => {
  it('encodes multiple ack IDs', () => {
    const buf = encodePacketAck([1, 2, 3], 10)
    expect(buf).toBeDefined()
    expect(buf.length).toBeGreaterThan(6)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```powershell
cd server && bun test __tests__/lludp-codec.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement server/lib/lludp-codec.ts**

```typescript
// server/lib/lludp-codec.ts — LLUDP binary packet encoder/decoder for Phase 1 messages
// Reference: http://wiki.secondlife.com/wiki/LLUDP
// Message IDs: verify against phoenix-firestorm/indra/newview/app_settings/message.xml

// ── Flags ────────────────────────────────────────────────────────────────
const FLAG_RELIABLE    = 0x10
const FLAG_HAS_ACKS    = 0x40
const FLAG_ZERO_CODED  = 0x01

// ── Message ID bytes (verify against message.xml) ─────────────────────────
// Low frequency prefix
const LOW = Buffer.from([0xFF, 0xFF])
// Fixed frequency prefix
const FIXED = Buffer.from([0xFF, 0xFF, 0xFF])

const MSG_ID = {
  AgentUpdate:             Buffer.from([0x04]),                     // High #4
  UseCircuitCode:          Buffer.from([0xFF, 0xFF, 0x00, 0x03]),   // Low #3
  CompleteAgentMovement:   Buffer.from([0xFF, 0xFF, 0x00, 0xF9]),   // Low #249
  LogoutRequest:           Buffer.from([0xFF, 0xFF, 0x00, 0xFC]),   // Low #252
  PacketAck:               Buffer.from([0xFF, 0xFF, 0xFF, 0xFB]),   // Fixed #251
  // Verify these in message.xml:
  ChatFromViewer:          Buffer.from([0xFF, 0xFF, 0x00, 0x50]),   // TODO verify
  ChatFromSimulator:       Buffer.from([0xFF, 0xFF, 0x00, 0x8B]),   // TODO verify
  ObjectUpdate:            Buffer.from([0xFF, 0xFF, 0x00, 0x0C]),   // TODO verify
  ImprovedTerseObjectUpdate: Buffer.from([0xFF, 0xFF, 0x00, 0x0B]),// TODO verify
}

// ── UUID helpers ─────────────────────────────────────────────────────────
export function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

export function bytesToUuid(buf: Buffer, offset = 0): string {
  const h = buf.slice(offset, offset + 16).toString('hex')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

// ── Zero coding ──────────────────────────────────────────────────────────
export function decodeZeroCoded(buf: Buffer): Buffer {
  const out: number[] = []
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x00) {
      const count = buf[++i] ?? 1
      for (let z = 0; z < count; z++) out.push(0x00)
    } else {
      out.push(buf[i])
    }
  }
  return Buffer.from(out)
}

export function encodeZeroCoded(buf: Buffer): Buffer {
  const out: number[] = []
  let i = 0
  while (i < buf.length) {
    if (buf[i] === 0x00) {
      let count = 0
      while (i < buf.length && buf[i] === 0x00 && count < 255) { count++; i++ }
      out.push(0x00, count)
    } else {
      out.push(buf[i++])
    }
  }
  return Buffer.from(out)
}

// ── Header ───────────────────────────────────────────────────────────────
interface HeaderOpts { seq: number; reliable: boolean; hasAcks: boolean; zeroCoded: boolean }

export function buildHeader(o: HeaderOpts): Buffer {
  const flags = (o.reliable ? FLAG_RELIABLE : 0)
              | (o.hasAcks  ? FLAG_HAS_ACKS  : 0)
              | (o.zeroCoded ? FLAG_ZERO_CODED : 0)
  const hdr = Buffer.alloc(6)
  hdr[0] = flags
  hdr.writeUInt32BE(o.seq, 1)
  hdr[5] = 0  // no extra bytes
  return hdr
}

export interface ParsedHeader {
  flags:      number
  reliable:   boolean
  hasAcks:    boolean
  zeroCoded:  boolean
  seq:        number
  extraBytes: number
  bodyOffset: number // where body starts (after header + extra)
}

export function parseHeader(buf: Buffer): ParsedHeader {
  const flags     = buf[0]
  const seq       = buf.readUInt32BE(1)
  const extraBytes = buf[5]
  return {
    flags,
    reliable:   (flags & FLAG_RELIABLE)   !== 0,
    hasAcks:    (flags & FLAG_HAS_ACKS)   !== 0,
    zeroCoded:  (flags & FLAG_ZERO_CODED) !== 0,
    seq,
    extraBytes,
    bodyOffset: 6 + extraBytes,
  }
}

// ── Message type detection ────────────────────────────────────────────────
export function parseMsgType(buf: Buffer, bodyOffset: number): { type: string; dataOffset: number } {
  const b0 = buf[bodyOffset]
  if (b0 !== 0xFF) {
    // High frequency — 1 byte ID
    return { type: `high:${b0}`, dataOffset: bodyOffset + 1 }
  }
  const b1 = buf[bodyOffset + 1]
  if (b1 !== 0xFF) {
    // Medium frequency — 2 bytes
    return { type: `med:${b1}`, dataOffset: bodyOffset + 2 }
  }
  const b2 = buf[bodyOffset + 2]
  if (b2 !== 0xFF) {
    // Low frequency — 4 bytes, ID is uint16 from bytes 2-3
    const id = buf.readUInt16BE(bodyOffset + 2)
    return { type: `low:${id}`, dataOffset: bodyOffset + 4 }
  }
  // Fixed — 4 bytes
  const id = buf[bodyOffset + 3]
  return { type: `fixed:${id}`, dataOffset: bodyOffset + 4 }
}

// ── Outgoing message encoders ─────────────────────────────────────────────

interface CircuitParams { agentId: string; sessionId: string; circuitCode: number; seq: number }

export function encodeUseCircuitCode(p: CircuitParams): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  body.writeUInt32LE(p.circuitCode, 32)
  return Buffer.concat([hdr, MSG_ID.UseCircuitCode, body])
}

export function encodeCompleteAgentMovement(p: CircuitParams): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 4)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  body.writeUInt32LE(p.circuitCode, 32)
  return Buffer.concat([hdr, MSG_ID.CompleteAgentMovement, body])
}

export function encodePacketAck(ackIds: number[], seq: number): Buffer {
  const hdr  = buildHeader({ seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(1 + ackIds.length * 4)
  body[0] = ackIds.length
  ackIds.forEach((id, i) => body.writeUInt32LE(id, 1 + i * 4))
  return Buffer.concat([hdr, MSG_ID.PacketAck, body])
}

export function encodeLogoutRequest(p: { agentId: string; sessionId: string; seq: number }): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(32)
  uuidToBytes(p.agentId).copy(body, 0)
  uuidToBytes(p.sessionId).copy(body, 16)
  return Buffer.concat([hdr, MSG_ID.LogoutRequest, body])
}

interface AgentUpdateParams {
  agentId:    string
  sessionId:  string
  seq:        number
  controlFlags: number   // bitmask: 0x01=fwd, 0x02=back, 0x04=left, 0x08=right, 0x10=up, 0x20=down
  bodyRot:    [number, number, number]  // quaternion xyz (w derived)
  headRot:    [number, number, number]
  camCenter:  [number, number, number]
  camAt:      [number, number, number]
  camLeft:    [number, number, number]
  camUp:      [number, number, number]
  far:        number
}

export function encodeAgentUpdate(p: AgentUpdateParams): Buffer {
  // AgentUpdate: High freq, NOT reliable (sent at ~10Hz, dropped if lost)
  const hdr = buildHeader({ seq: p.seq, reliable: false, hasAcks: false, zeroCoded: false })
  const body = Buffer.allocUnsafe(16 + 16 + 12 + 12 + 1 + 12 + 12 + 12 + 12 + 4 + 4 + 1)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);   off += 16
  uuidToBytes(p.sessionId).copy(body, off); off += 16
  // BodyRotation (3 floats = xyz of quaternion)
  p.bodyRot.forEach(v => { body.writeFloatLE(v, off); off += 4 })
  // HeadRotation
  p.headRot.forEach(v => { body.writeFloatLE(v, off); off += 4 })
  body[off++] = 0  // State
  // Camera vectors
  p.camCenter.forEach(v => { body.writeFloatLE(v, off); off += 4 })
  p.camAt.forEach(v    => { body.writeFloatLE(v, off); off += 4 })
  p.camLeft.forEach(v  => { body.writeFloatLE(v, off); off += 4 })
  p.camUp.forEach(v    => { body.writeFloatLE(v, off); off += 4 })
  body.writeFloatLE(p.far, off); off += 4
  body.writeUInt32LE(p.controlFlags, off); off += 4
  body[off++] = 0  // Flags
  return Buffer.concat([hdr, MSG_ID.AgentUpdate, body])
}

export function encodeChatFromViewer(p: {
  agentId: string; sessionId: string; seq: number
  message: string; chatType: number; channel: number
}): Buffer {
  const hdr  = buildHeader({ seq: p.seq, reliable: true, hasAcks: false, zeroCoded: false })
  const msgBuf = Buffer.from(p.message, 'utf8')
  const body = Buffer.allocUnsafe(32 + 1 + msgBuf.length + 1 + 4)
  let off = 0
  uuidToBytes(p.agentId).copy(body, off);    off += 16
  uuidToBytes(p.sessionId).copy(body, off);  off += 16
  body[off++] = msgBuf.length  // variable1 length prefix
  msgBuf.copy(body, off);      off += msgBuf.length
  body[off++] = p.chatType
  body.writeInt32LE(p.channel, off)
  return Buffer.concat([hdr, MSG_ID.ChatFromViewer, body])
}

// ── Incoming message decoders ─────────────────────────────────────────────

export interface ChatFromSimData {
  fromName: string
  sourceId: string
  chatType: number
  channel:  number
  message:  string
  position: [number, number, number]
}

export function decodeChatFromSimulator(buf: Buffer, dataOffset: number): ChatFromSimData {
  let off = dataOffset
  // FromName: variable1 (1-byte length prefix)
  const nameLen = buf[off++]
  const fromName = buf.slice(off, off + nameLen).toString('utf8'); off += nameLen
  // SourceID: UUID (16 bytes)
  const sourceId = bytesToUuid(buf, off); off += 16
  // OwnerID: UUID (16 bytes) — skip
  off += 16
  const sourceType = buf[off++]  // unused in Phase 1
  const chatType   = buf[off++]
  const audible    = buf[off++]  // unused
  // Position: 3 floats
  const px = buf.readFloatLE(off); off += 4
  const py = buf.readFloatLE(off); off += 4
  const pz = buf.readFloatLE(off); off += 4
  // Message: variable2 (2-byte length prefix)
  const msgLen = buf.readUInt16LE(off); off += 2
  const message = buf.slice(off, off + msgLen).toString('utf8')
  return { fromName, sourceId, chatType, channel: 0, message, position: [px, py, pz] }
}

export interface ObjectData {
  localId:  number
  fullId:   string
  pcode:    number  // 9=prim, 47=avatar
  scale:    [number, number, number]
  pos:      [number, number, number]
  nameValue: string  // raw NameValue string (contains avatar display name as KEY=VALUE pairs)
}

/**
 * Minimal ObjectUpdate decoder — extracts position and type.
 * ObjectUpdate is complex; this handles the common FULL_UPDATE case.
 * See http://wiki.secondlife.com/wiki/ObjectUpdate for full spec.
 */
export function decodeObjectUpdate(buf: Buffer, dataOffset: number): ObjectData[] {
  const objects: ObjectData[] = []
  let off = dataOffset

  // RegionData block (1)
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16

  // ObjectData block (variable count)
  const count = buf[off++]
  for (let i = 0; i < count && off < buf.length; i++) {
    const localId = buf.readUInt32LE(off); off += 4
    const state   = buf[off++]
    const fullId  = bytesToUuid(buf, off); off += 16
    off += 4   // CRC
    const pcode = buf[off++]
    const material = buf[off++]
    const clickAction = buf[off++]
    const sx = buf.readFloatLE(off); off += 4  // Scale
    const sy = buf.readFloatLE(off); off += 4
    const sz = buf.readFloatLE(off); off += 4
    // ObjectData variable1: packed position/velocity/rotation
    const odLen = buf[off++]; off += odLen
    const parentId    = buf.readUInt32LE(off); off += 4
    const updateFlags = buf.readUInt32LE(off); off += 4
    // Skip path/profile params (10 bytes)
    off += 10
    // Skip variable fields: TextureEntry, TextureAnim, NameValue, Data, Text, MediaURL
    // Each variable2 has 2-byte length prefix
    const skipVar2 = () => { const len = buf.readUInt16LE(off); off += 2 + len }
    const skipVar1 = () => { const len = buf[off++]; off += len }
    skipVar2()  // TextureEntry
    skipVar2()  // TextureAnim
    // NameValue: variable2
    const nvLen = buf.readUInt16LE(off); off += 2
    const nameValue = buf.slice(off, off + nvLen).toString('utf8'); off += nvLen
    skipVar1()  // Data
    skipVar1()  // Text
    skipVar1()  // MediaURL
    // Position is inside ObjectData blob above — for now use a rough extraction
    // TODO: parse ObjectData blob properly per update flags
    // As a Phase 1 placeholder, return zero position until ObjectData blob parser is implemented
    objects.push({ localId, fullId, pcode, scale: [sx, sy, sz], pos: [0, 0, 0], nameValue })
  }
  return objects
}
```

> **Note:** `decodeObjectUpdate` has a TODO for position extraction from the ObjectData blob — the packed binary format is complex and requires reading the Firestorm source (`llviewerobjectlist.cpp`, `processObjectUpdate`). Phase 1 can use `ImprovedTerseObjectUpdate` for position once the circuit is established, which is simpler.

- [ ] **Step 4: Run tests — expect pass**

```powershell
bun test __tests__/lludp-codec.test.ts
```

Expected: 5 passing

- [ ] **Step 5: Commit**

```powershell
cd ..
git add server/lib/lludp-codec.ts server/__tests__/lludp-codec.test.ts
git commit -m "feat(server): LLUDP codec — header, zero-coding, Phase 1 message encoders/decoders"
```

---

## Task 7: Circuit Manager

**Files:** Create `server/lib/circuit.ts`, `server/__tests__/circuit.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/__tests__/circuit.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test'
import { nextSeq, queueAck, flushAcks, trackReliable, ackReceived } from '../lib/circuit'
import type { CircuitState } from '../state/sessions'

function makeState(): Partial<CircuitState> {
  return { seqNum: 0, pendingAcks: [], reliableOut: new Map() }
}

describe('nextSeq', () => {
  it('increments and wraps at 0xFFFFFFFF', () => {
    const s = makeState() as CircuitState
    expect(nextSeq(s)).toBe(1)
    expect(nextSeq(s)).toBe(2)
    s.seqNum = 0xFFFFFFFF
    expect(nextSeq(s)).toBe(1)  // wraps, never returns 0
  })
})

describe('ack queue', () => {
  it('queues and flushes acks', () => {
    const s = makeState() as CircuitState
    queueAck(s, 10)
    queueAck(s, 11)
    const flushed = flushAcks(s)
    expect(flushed).toEqual([10, 11])
    expect(s.pendingAcks).toHaveLength(0)
  })
})

describe('reliable tracking', () => {
  it('tracks sent packet and removes on ack', () => {
    const s = makeState() as CircuitState
    const buf = Buffer.from([1, 2, 3])
    trackReliable(s, 5, buf)
    expect(s.reliableOut.has(5)).toBe(true)
    ackReceived(s, 5)
    expect(s.reliableOut.has(5)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```powershell
cd server && bun test __tests__/circuit.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement server/lib/circuit.ts**

```typescript
// server/lib/circuit.ts — circuit sequence numbers, ack queue, reliable retransmit
import type { CircuitState } from '../state/sessions'
import { encodePacketAck } from './lludp-codec'

const MAX_RETRIES    = 5
const RETRY_INTERVAL = 1000  // ms before first retry

/** Increment and return next sequence number; wraps at 0xFFFFFFFF, never returns 0 */
export function nextSeq(s: CircuitState): number {
  s.seqNum = (s.seqNum >= 0xFFFFFFFF) ? 1 : s.seqNum + 1
  return s.seqNum
}

/** Queue an incoming reliable packet ID for acking back to sim */
export function queueAck(s: CircuitState, seq: number): void {
  s.pendingAcks.push(seq)
}

/** Return and clear the pending ack list */
export function flushAcks(s: CircuitState): number[] {
  const acks = [...s.pendingAcks]
  s.pendingAcks = []
  return acks
}

/** Track an outgoing reliable packet for potential retransmit */
export function trackReliable(s: CircuitState, seq: number, buf: Buffer): void {
  s.reliableOut.set(seq, { buf, sentAt: Date.now(), retries: 0 })
}

/** Remove a reliable packet when the sim acks it */
export function ackReceived(s: CircuitState, seq: number): void {
  s.reliableOut.delete(seq)
}

/** Called on a timer — retransmit overdue reliable packets, drop after MAX_RETRIES */
export function retransmitOverdue(s: CircuitState): void {
  const now = Date.now()
  for (const [seq, entry] of s.reliableOut) {
    const due = entry.sentAt + RETRY_INTERVAL * Math.pow(2, entry.retries)
    if (now < due) continue
    if (entry.retries >= MAX_RETRIES) {
      console.warn(`[circuit] dropping reliable seq ${seq} after ${MAX_RETRIES} retries`)
      s.reliableOut.delete(seq)
      continue
    }
    entry.retries++
    entry.sentAt = now
    s.udpSocket.send(entry.buf, s.simPort, s.simIp)
  }
}

/** Send queued acks to sim if any pending. Call before sending other packets. */
export function sendPendingAcks(s: CircuitState): void {
  const acks = flushAcks(s)
  if (acks.length === 0) return
  const seq = nextSeq(s)
  const buf = encodePacketAck(acks, seq)
  s.udpSocket.send(buf, s.simPort, s.simIp)
}
```

- [ ] **Step 4: Run tests — expect pass**

```powershell
bun test __tests__/circuit.test.ts
```

Expected: 3 passing

- [ ] **Step 5: Commit**

```powershell
cd ..
git add server/lib/circuit.ts server/__tests__/circuit.test.ts
git commit -m "feat(server): circuit manager — seq nums, ack queue, reliable retransmit"
```

---

## Task 8: Login Handler

**Files:** Create `server/handlers/login.ts`

- [ ] **Step 1: Create server/handlers/login.ts**

```typescript
// server/handlers/login.ts — XML-RPC login proxy + LLUDP circuit setup
import * as dgram from 'dgram'
import type { ServerWebSocket } from 'bun'
import { getGrid } from '../lib/grids'
import { hashPassword, buildLoginXml, parseLoginResponse, xmlRpcPost } from '../lib/xmlrpc'
import { encodeUseCircuitCode, encodeCompleteAgentMovement } from '../lib/lludp-codec'
import { nextSeq, trackReliable } from '../lib/circuit'
import { createSession, deleteSession } from '../state/sessions'
import { handleUdpMessage } from './lludp'
import { S } from '../../shared/protocol.js'

export async function handleLogin(
  ws: ServerWebSocket<unknown>,
  sessionId: string,
  data: { grid: string; username: string; password: string }
): Promise<void> {
  const grid = getGrid(data.grid)
  if (!grid) {
    ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: `Unknown grid: ${data.grid}` } }))
    return
  }

  // Split "FirstName LastName" or use first="" last="Resident"
  const parts = data.username.trim().split(/\s+/)
  const first = parts[0]
  const last  = parts.length > 1 ? parts.slice(1).join(' ') : 'Resident'

  const hashedPass = hashPassword(data.password)
  const loginXml   = buildLoginXml({ first, last, hashedPass, start: 'last' })

  let loginResult
  try {
    const responseXml = await xmlRpcPost(grid.loginURI, loginXml)
    loginResult = parseLoginResponse(responseXml)
  } catch (err) {
    ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: `Network error: ${(err as Error).message}` } }))
    return
  }

  if (!loginResult.login) {
    ws.send(JSON.stringify({ t: S.LOGIN_FAIL, d: { message: loginResult.message } }))
    return
  }

  // Open UDP socket for this session
  const udpSocket = dgram.createSocket('udp4')

  const circuit = {
    agentId:     loginResult.agent_id!,
    sessionId:   loginResult.session_id!,
    simIp:       loginResult.sim_ip!,
    simPort:     loginResult.sim_port!,
    circuitCode: loginResult.circuit_code!,
    seqNum:      0,
    pendingAcks: [] as number[],
    reliableOut: new Map(),
    udpSocket,
    ws,
  }

  createSession(sessionId, circuit)

  // Wire up UDP → WS relay
  udpSocket.on('message', (msg: Buffer) => handleUdpMessage(sessionId, msg))
  udpSocket.on('error', (err: Error) => {
    console.error(`[udp:${sessionId}] error:`, err)
    deleteSession(sessionId)
  })

  // Bind then start circuit setup
  udpSocket.bind(() => {
    const seq1 = nextSeq(circuit)
    const useCircuit = encodeUseCircuitCode({
      agentId: circuit.agentId,
      sessionId: circuit.sessionId,
      circuitCode: circuit.circuitCode,
      seq: seq1,
    })
    trackReliable(circuit, seq1, useCircuit)
    udpSocket.send(useCircuit, circuit.simPort, circuit.simIp)

    const seq2 = nextSeq(circuit)
    const completeMove = encodeCompleteAgentMovement({
      agentId: circuit.agentId,
      sessionId: circuit.sessionId,
      circuitCode: circuit.circuitCode,
      seq: seq2,
    })
    trackReliable(circuit, seq2, completeMove)
    udpSocket.send(completeMove, circuit.simPort, circuit.simIp)

    // Tell browser login succeeded
    ws.send(JSON.stringify({
      t: S.LOGIN_OK,
      d: {
        agentId:    loginResult.agent_id,
        sessionId:  loginResult.session_id,
        simIp:      loginResult.sim_ip,
        simPort:    loginResult.sim_port,
        seedCap:    loginResult.seed_capability,
      }
    }))
  })
}

export function handleLogout(ws: ServerWebSocket<unknown>, sessionId: string): void {
  const session = (await import('../state/sessions')).getSession(sessionId)
  // (dynamic import avoids circular dep)
  deleteSession(sessionId)
}
```

> **Note:** `handleLogout` uses dynamic import to avoid circular dependency. Alternatively, pass the session as a parameter from `index.ts`.

- [ ] **Step 2: Commit**

```powershell
git add server/handlers/login.ts
git commit -m "feat(server): login handler — XML-RPC proxy + UDP circuit setup"
```

---

## Task 9: LLUDP Bridge Handler

**Files:** Create `server/handlers/lludp.ts`

- [ ] **Step 1: Create server/handlers/lludp.ts**

```typescript
// server/handlers/lludp.ts — UDP→WS relay: decode incoming LLUDP packets, forward to browser
import { getSession } from '../state/sessions'
import { parseHeader, parseMsgType, decodeChatFromSimulator, decodeObjectUpdate, decodeZeroCoded, encodeAgentUpdate, encodeChatFromViewer } from '../lib/lludp-codec'
import { queueAck, nextSeq, trackReliable, ackReceived, retransmitOverdue, sendPendingAcks } from '../lib/circuit'
import { S, C } from '../../shared/protocol.js'

// Message type codes (low freq IDs) — verify against message.xml
const LOW_CHAT_FROM_SIM    = 139   // TODO verify
const LOW_OBJECT_UPDATE    = 12    // TODO verify
const LOW_OBJECT_UPDATE_TERSE = 11 // TODO verify (ImprovedTerseObjectUpdate)
const FIXED_PACKET_ACK     = 251   // PacketAck fixed ID

/** Called when a UDP packet arrives from the grid sim */
export function handleUdpMessage(sessionId: string, rawBuf: Buffer): void {
  const session = getSession(sessionId)
  if (!session) return

  let buf = rawBuf
  const hdr = parseHeader(buf)

  // Decode zero-coded body if needed
  if (hdr.zeroCoded) {
    const body = decodeZeroCoded(buf.slice(hdr.bodyOffset))
    buf = Buffer.concat([buf.slice(0, hdr.bodyOffset), body])
  }

  // Queue ack for reliable packets
  if (hdr.reliable) queueAck(session, hdr.seq)

  const { type, dataOffset } = parseMsgType(buf, hdr.bodyOffset)

  if (type === `fixed:${FIXED_PACKET_ACK}`) {
    // Sim is acking our reliable packets
    const count = buf[dataOffset]
    for (let i = 0; i < count; i++) {
      const ackSeq = buf.readUInt32LE(dataOffset + 1 + i * 4)
      ackReceived(session, ackSeq)
    }
    return
  }

  if (type === `low:${LOW_CHAT_FROM_SIM}`) {
    try {
      const chat = decodeChatFromSimulator(buf, dataOffset)
      session.ws.send(JSON.stringify({ t: S.CHAT_MSG, d: chat }))
    } catch (e) { console.warn('[lludp] chat decode error', e) }
    return
  }

  if (type === `low:${LOW_OBJECT_UPDATE}`) {
    try {
      const objects = decodeObjectUpdate(buf, dataOffset)
      if (objects.length > 0) {
        session.ws.send(JSON.stringify({ t: S.OBJECT_UPDATE, d: { objects } }))
      }
    } catch (e) { console.warn('[lludp] objectUpdate decode error', e) }
    return
  }

  // Flush any pending acks after processing
  sendPendingAcks(session)
}

/** Called when a WS message arrives from the browser wanting to move/chat */
export function handleClientMessage(sessionId: string, msg: { t: string; d: unknown }): void {
  const session = getSession(sessionId)
  if (!session) return

  if (msg.t === C.MOVE) {
    const d = msg.d as { controlFlags: number; bodyRot: [number,number,number]; headRot: [number,number,number]; camCenter: [number,number,number]; camAt: [number,number,number]; camLeft: [number,number,number]; camUp: [number,number,number]; far: number }
    const seq = nextSeq(session)
    const pkt = encodeAgentUpdate({
      agentId:   session.agentId,
      sessionId: session.sessionId,
      seq,
      ...d,
    })
    session.udpSocket.send(pkt, session.simPort, session.simIp)
    return
  }

  if (msg.t === C.CHAT) {
    const d = msg.d as { message: string; chatType: number; channel: number }
    const seq = nextSeq(session)
    const pkt = encodeChatFromViewer({ agentId: session.agentId, sessionId: session.sessionId, seq, ...d })
    trackReliable(session, seq, pkt)
    session.udpSocket.send(pkt, session.simPort, session.simIp)
    return
  }
}

/** Start per-session retransmit timer. Returns cleanup fn. */
export function startCircuitTimers(sessionId: string): () => void {
  const timer = setInterval(() => {
    const s = getSession(sessionId)
    if (!s) { clearInterval(timer); return }
    retransmitOverdue(s)
    sendPendingAcks(s)
  }, 500)
  return () => clearInterval(timer)
}
```

- [ ] **Step 2: Commit**

```powershell
git add server/handlers/lludp.ts
git commit -m "feat(server): LLUDP bridge handler — UDP→WS relay, client move/chat dispatch"
```

---

## Task 10: Caps Proxy + Wire server/index.ts

**Files:** Create `server/handlers/caps.ts`, modify `server/index.ts`

- [ ] **Step 1: Create server/handlers/caps.ts**

```typescript
// server/handlers/caps.ts — CORS proxy for HTTP capability calls
import type { ServerWebSocket } from 'bun'
import { S } from '../../shared/protocol.js'

export async function handleCapsFetch(
  ws: ServerWebSocket<unknown>,
  requestId: string,
  url: string,
  method = 'POST',
  body?: string
): Promise<void> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/llsd+xml', 'Accept': 'application/llsd+xml' },
      body: method !== 'GET' ? body : undefined,
    })
    const text = await res.text()
    ws.send(JSON.stringify({ t: S.CAPS_RESULT, d: { id: requestId, status: res.status, body: text } }))
  } catch (err) {
    ws.send(JSON.stringify({ t: S.ERROR, d: { code: 'caps_error', message: (err as Error).message } }))
  }
}
```

- [ ] **Step 2: Modify server/index.ts**

Replace the WS message handler section. Find the existing `message` handler in `server/index.ts` and replace it. The key addition is routing `C.LOGIN`, `C.MOVE`, `C.CHAT`, `C.LOGOUT`, `C.CAPS_FETCH` to the new handlers:

```typescript
// At top of server/index.ts, add imports:
import { handleLogin } from './handlers/login'
import { handleClientMessage, startCircuitTimers } from './handlers/lludp'
import { handleCapsFetch } from './handlers/caps'
import { deleteSession } from './state/sessions'
import { C } from '../shared/protocol.js'

// In the Bun.serve websocket handlers, replace/extend message handler:
websocket: {
  message(ws: ServerWebSocket<{ sessionId: string }>, raw: string | Buffer) {
    if (typeof raw !== 'string') return  // binary frames not used here

    let msg: { t: string; d: unknown }
    try { msg = JSON.parse(raw) } catch { return }

    const { sessionId } = ws.data

    if (msg.t === C.LOGIN) {
      handleLogin(ws, sessionId, msg.d as { grid: string; username: string; password: string })
      return
    }

    if (msg.t === C.LOGOUT) {
      deleteSession(sessionId)
      return
    }

    if (msg.t === C.CAPS_FETCH) {
      const d = msg.d as { id: string; url: string; method?: string; body?: string }
      handleCapsFetch(ws, d.id, d.url, d.method, d.body)
      return
    }

    // MOVE and CHAT go to LLUDP bridge
    handleClientMessage(sessionId, msg)
  },

  open(ws: ServerWebSocket<{ sessionId: string }>) {
    // sessionId assigned at upgrade time — see existing upgrade handler
    startCircuitTimers(ws.data.sessionId)
  },

  close(ws: ServerWebSocket<{ sessionId: string }>) {
    deleteSession(ws.data.sessionId)
  },
}
```

> The existing `server/index.ts` uses a `sockets` Map and upgrade handler. Ensure the upgrade handler assigns `data: { sessionId: crypto.randomUUID() }` when calling `server.upgrade(req)`.

- [ ] **Step 3: Commit**

```powershell
git add server/handlers/caps.ts server/index.ts
git commit -m "feat(server): caps CORS proxy + wire login/lludp/caps into index.ts"
```

---

## Task 11: Pinia Stores

**Files:** Create `src/stores/gridStore.js`, `sessionStore.js`, `worldStore.js`, `chatStore.js`, `uiStore.js`. Create `src/__tests__/stores/gridStore.test.js`.

- [ ] **Step 1: Write failing test for gridStore**

```powershell
mkdir src/__tests__/stores
```

Create `src/__tests__/stores/gridStore.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGridStore } from '@/stores/gridStore'

beforeEach(() => setActivePinia(createPinia()))

describe('gridStore', () => {
  it('has grids list', () => {
    const store = useGridStore()
    expect(store.grids.length).toBeGreaterThan(0)
  })

  it('selects a grid', () => {
    const store = useGridStore()
    store.selectGrid('osgrid')
    expect(store.selectedGrid?.nick).toBe('osgrid')
  })

  it('loginState defaults to idle', () => {
    const store = useGridStore()
    expect(store.loginState).toBe('idle')
  })
})
```

- [ ] **Step 2: Run to confirm fail**

```powershell
npx vitest run src/__tests__/stores/gridStore.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Create src/stores/gridStore.js**

```javascript
// src/stores/gridStore.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import gridsJson from '@/config/grids.json'

export const useGridStore = defineStore('grid', () => {
  const grids = Object.entries(gridsJson).map(([nick, g]) => ({ nick, ...g }))
  const selectedNick = ref(grids[0]?.nick ?? 'agni')
  const loginState   = ref('idle')  // 'idle' | 'loading' | 'connected' | 'error'
  const loginError   = ref('')

  const selectedGrid = computed(() => grids.find(g => g.nick === selectedNick.value) ?? null)

  function selectGrid(nick) { selectedNick.value = nick }
  function setLoginState(state, error = '') {
    loginState.value = state
    loginError.value = error
  }

  return { grids, selectedNick, selectedGrid, loginState, loginError, selectGrid, setLoginState }
})
```

- [ ] **Step 4: Create src/stores/sessionStore.js**

```javascript
// src/stores/sessionStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSessionStore = defineStore('session', () => {
  const agentId    = ref('')
  const sessionId  = ref('')
  const simIp      = ref('')
  const simPort    = ref(0)
  const seedCap    = ref('')
  const regionName = ref('')
  const connected  = ref(false)

  function setSession(data) {
    agentId.value    = data.agentId ?? ''
    sessionId.value  = data.sessionId ?? ''
    simIp.value      = data.simIp ?? ''
    simPort.value    = data.simPort ?? 0
    seedCap.value    = data.seedCap ?? ''
    regionName.value = data.regionName ?? ''
    connected.value  = true
  }

  function clearSession() {
    agentId.value = sessionId.value = simIp.value = seedCap.value = regionName.value = ''
    simPort.value = 0
    connected.value = false
  }

  return { agentId, sessionId, simIp, simPort, seedCap, regionName, connected, setSession, clearSession }
})
```

- [ ] **Step 5: Create src/stores/worldStore.js**

```javascript
// src/stores/worldStore.js — object map driven by ObjectUpdate LLUDP messages
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const PCODE_PRIM   = 9
export const PCODE_AVATAR = 47

export const useWorldStore = defineStore('world', () => {
  // Map<localId (number), object>
  const objects = ref(new Map())

  function upsertObject(obj) {
    // obj: { localId, fullId, pcode, pos, rot, scale, name }
    objects.value.set(obj.localId, { ...objects.value.get(obj.localId), ...obj })
  }

  function removeObject(localId) { objects.value.delete(localId) }

  function clearAll() { objects.value.clear() }

  const avatars = computed(() =>
    [...objects.value.values()].filter(o => o.pcode === PCODE_AVATAR)
  )
  const prims = computed(() =>
    [...objects.value.values()].filter(o => o.pcode === PCODE_PRIM)
  )

  return { objects, avatars, prims, upsertObject, removeObject, clearAll }
})
```

- [ ] **Step 6: Create src/stores/chatStore.js**

```javascript
// src/stores/chatStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX_MESSAGES = 200

export const useChatStore = defineStore('chat', () => {
  const messages = ref([])  // [{ id, fromName, message, chatType, timestamp }]

  function addMessage(msg) {
    messages.value.push({ id: crypto.randomUUID(), timestamp: Date.now(), ...msg })
    if (messages.value.length > MAX_MESSAGES) messages.value.shift()
  }

  function clear() { messages.value = [] }

  return { messages, addMessage, clear }
})
```

- [ ] **Step 7: Create src/stores/uiStore.js**

```javascript
// src/stores/uiStore.js
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const mode          = ref('3d')      // '3d' | '2d'
  const showAvatarList = ref(true)
  const showMinimap   = ref(true)
  const showChat      = ref(true)

  function toggleMode() { mode.value = mode.value === '3d' ? '2d' : '3d' }

  return { mode, showAvatarList, showMinimap, showChat, toggleMode }
})
```

- [ ] **Step 8: Run gridStore tests**

```powershell
npx vitest run src/__tests__/stores/gridStore.test.js
```

Expected: 3 passing

- [ ] **Step 9: Commit**

```powershell
git add src/stores/gridStore.js src/stores/sessionStore.js src/stores/worldStore.js
git add src/stores/chatStore.js src/stores/uiStore.js
git add src/__tests__/stores/gridStore.test.js
git commit -m "feat(stores): gridStore, sessionStore, worldStore, chatStore, uiStore"
```

---

## Task 12: WS Composables

**Files:** Modify `src/composables/useRealtimeSocket.js`, create `src/composables/useLLUDP.js`, `src/composables/useGridLogin.js`, `src/composables/useLocalChat.js`

- [ ] **Step 1: Update useRealtimeSocket.js**

`useRealtimeSocket.js` is already a solid WS singleton with `send`, `emit`, `on`, `off`. Only change needed: remove any AVA-specific logic, ensure `emit` sends `{ t, d }` envelope (it already does via the existing `emit` function). No structural changes needed — keep as-is.

Search for and remove any import of `supabase` or `AuthStore` if present in the file.

```powershell
# Verify no leftover Supabase imports
Select-String -Path src/composables/useRealtimeSocket.js -Pattern "supabase|AuthStore"
```

If any found, remove those lines.

- [ ] **Step 2: Create src/composables/useLLUDP.js**

```javascript
// src/composables/useLLUDP.js — client-side encoder: encode move/chat → WS → Bun → UDP
import { useRealtimeSocket } from './useRealtimeSocket'
import { C } from '@shared/protocol.js'

export function useLLUDP() {
  const { emit } = useRealtimeSocket()

  /**
   * Send avatar movement update.
   * @param {Object} p
   * @param {number}   p.controlFlags  bitmask: 0x01=fwd,0x02=back,0x04=left,0x08=right,0x10=up,0x20=down
   * @param {number[]} p.bodyRot       [x,y,z] quaternion components
   * @param {number[]} p.headRot       [x,y,z]
   * @param {number[]} p.camCenter     [x,y,z] world pos
   * @param {number[]} p.camAt         [x,y,z] unit vector
   * @param {number[]} p.camLeft       [x,y,z]
   * @param {number[]} p.camUp         [x,y,z]
   * @param {number}   p.far           view distance
   */
  function sendMove(p) {
    emit(C.MOVE, p)
  }

  function sendChat(message, chatType = 1, channel = 0) {
    emit(C.CHAT, { message, chatType, channel })
  }

  function sendLogout() {
    emit(C.LOGOUT, {})
  }

  return { sendMove, sendChat, sendLogout }
}
```

- [ ] **Step 3: Create src/composables/useGridLogin.js**

```javascript
// src/composables/useGridLogin.js — orchestrates login: WS connect → LOGIN message → handle response
import { useRealtimeSocket } from './useRealtimeSocket'
import { useGridStore } from '@/stores/gridStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useRouter } from 'vue-router'
import { S, C } from '@shared/protocol.js'

export function useGridLogin() {
  const { connect, on, off, emit } = useRealtimeSocket()
  const gridStore    = useGridStore()
  const sessionStore = useSessionStore()
  const router       = useRouter()

  async function login(username, password) {
    gridStore.setLoginState('loading')

    connect()  // idempotent

    // Wait for WS connection, then send login
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 10_000)

      function onOpen() {
        clearTimeout(timeout)
        resolve()
        off('connected', onOpen)
      }

      on('connected', onOpen)

      // If already connected, resolve immediately
      const { connected } = useRealtimeSocket()
      if (connected.value) { clearTimeout(timeout); resolve() }
    })

    emit(C.LOGIN, {
      grid:     gridStore.selectedNick,
      username,
      password,
    })

    return new Promise((resolve, reject) => {
      function onOk(msg) {
        off(S.LOGIN_OK,   onOk)
        off(S.LOGIN_FAIL, onFail)
        sessionStore.setSession(msg.d)
        gridStore.setLoginState('connected')
        router.push('/world')
        resolve(msg.d)
      }
      function onFail(msg) {
        off(S.LOGIN_OK,   onOk)
        off(S.LOGIN_FAIL, onFail)
        gridStore.setLoginState('error', msg.d.message)
        reject(new Error(msg.d.message))
      }
      on(S.LOGIN_OK,   onOk)
      on(S.LOGIN_FAIL, onFail)
    })
  }

  return { login }
}
```

- [ ] **Step 4: Create src/composables/useLocalChat.js**

```javascript
// src/composables/useLocalChat.js — receive ChatFromSim messages, send ChatFromViewer
import { onMounted, onUnmounted } from 'vue'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { useChatStore } from '@/stores/chatStore'
import { S } from '@shared/protocol.js'

export function useLocalChat() {
  const { on, off }  = useRealtimeSocket()
  const { sendChat } = useLLUDP()
  const chatStore    = useChatStore()

  function onChatMsg(msg) {
    chatStore.addMessage(msg.d)
  }

  onMounted(() => on(S.CHAT_MSG, onChatMsg))
  onUnmounted(() => off(S.CHAT_MSG, onChatMsg))

  function send(message, channel = 0) {
    sendChat(message, 1 /* normal */, channel)
    // Optimistically add own message
    chatStore.addMessage({ fromName: 'Me', message, chatType: 1 })
  }

  return { messages: chatStore.messages, send }
}
```

- [ ] **Step 5: Commit**

```powershell
git add src/composables/useLLUDP.js src/composables/useGridLogin.js src/composables/useLocalChat.js
git add src/composables/useRealtimeSocket.js
git commit -m "feat(composables): useLLUDP, useGridLogin, useLocalChat"
```

---

## Task 13: Landing Page Components + View

**Files:** Create `src/components/GridSelector.vue`, `src/components/LoginForm.vue`, `src/views/LandingView.vue`

- [ ] **Step 1: Create src/components/GridSelector.vue**

```vue
<script setup>
import { useGridStore } from '@/stores/gridStore'
const store = useGridStore()
</script>

<template>
  <select
    class="w-full px-3 py-2 rounded bg-card border border-brd text-t1 focus:outline-none focus:ring-2 focus:ring-accent"
    :value="store.selectedNick"
    @change="store.selectGrid($event.target.value)"
  >
    <option v-for="g in store.grids" :key="g.nick" :value="g.nick">{{ g.name }}</option>
  </select>
</template>
```

- [ ] **Step 2: Create src/components/LoginForm.vue**

```vue
<script setup>
import { ref } from 'vue'
import { useGridLogin } from '@/composables/useGridLogin'
import { useGridStore } from '@/stores/gridStore'

const { login } = useGridLogin()
const gridStore = useGridStore()

const username = ref('')
const password = ref('')
const error    = ref('')

async function submit() {
  error.value = ''
  try {
    await login(username.value, password.value)
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <form class="flex flex-col gap-3" @submit.prevent="submit">
    <input
      v-model="username"
      type="text"
      placeholder="First Last"
      autocomplete="username"
      class="px-3 py-2 rounded bg-card border border-brd text-t1 placeholder-t2 focus:outline-none focus:ring-2 focus:ring-accent"
      required
    />
    <input
      v-model="password"
      type="password"
      placeholder="Password"
      autocomplete="current-password"
      class="px-3 py-2 rounded bg-card border border-brd text-t1 focus:outline-none focus:ring-2 focus:ring-accent"
      required
    />
    <button
      type="submit"
      class="px-4 py-2 rounded bg-accent text-white font-semibold hover:bg-accent2 disabled:opacity-50 transition-colors"
      :disabled="gridStore.loginState === 'loading'"
    >
      {{ gridStore.loginState === 'loading' ? 'Connecting…' : 'Log In' }}
    </button>
    <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>
  </form>
</template>
```

- [ ] **Step 3: Create src/views/LandingView.vue**

```vue
<script setup>
import GridSelector from '@/components/GridSelector.vue'
import LoginForm from '@/components/LoginForm.vue'
import { useTheme } from '@/composables/useTheme'
const { isDark, toggle } = useTheme()
</script>

<template>
  <div class="min-h-screen bg-bg flex flex-col items-center justify-center px-4">

    <!-- Header -->
    <div class="w-full max-w-md mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-display text-t1">QuickerStorm</h1>
        <p class="text-t2 text-sm mt-1">Web viewer for OpenSimulator &amp; Second Life</p>
      </div>
      <button class="text-t2 hover:text-t1 transition-colors" @click="toggle" :title="isDark ? 'Light mode' : 'Dark mode'">
        {{ isDark ? '☀' : '🌙' }}
      </button>
    </div>

    <!-- Login card -->
    <div class="w-full max-w-md bg-card border border-brd rounded-xl p-6 flex flex-col gap-4 shadow-lg">
      <div>
        <label class="block text-t2 text-xs mb-1 uppercase tracking-wide">Grid</label>
        <GridSelector />
      </div>
      <LoginForm />
    </div>

    <!-- Disclaimer -->
    <div class="w-full max-w-md mt-6 text-center text-t2 text-xs leading-relaxed">
      <p>
        QuickerStorm is an independent open-source project.<br/>
        Not affiliated with, endorsed by, or sponsored by Linden Research, Inc.<br/>
        <em>Second Life®</em> is a registered trademark of Linden Research, Inc.
      </p>
      <p class="mt-2">
        Credentials are transmitted once for grid login only and are never stored.<br/>
        Session token held in browser memory only.
      </p>
      <p class="mt-3 text-t2/60">
        Inspired by Firestorm Viewer · SpeedLight · Built with Vue 3 · Three.js · Bun · WebRTC
      </p>
    </div>

  </div>
</template>
```

- [ ] **Step 4: Commit**

```powershell
git add src/components/GridSelector.vue src/components/LoginForm.vue src/views/LandingView.vue
git commit -m "feat(ui): landing page — grid selector, login form, disclaimer"
```

---

## Task 14: Router + App.vue + main.js

**Files:** Modify `src/router/index.js`, `src/App.vue`, `src/main.js`, `src/stores/avatarStore.js`

- [ ] **Step 1: Replace src/router/index.js**

```javascript
import { createRouter, createWebHashHistory } from 'vue-router'
import { useSessionStore } from '@/stores/sessionStore'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/',      redirect: '/landing' },
    { path: '/landing', name: 'Landing', component: () => import('@/views/LandingView.vue') },
    { path: '/world',  name: 'World',   component: () => import('@/views/WorldView.vue'),
      beforeEnter: () => {
        const session = useSessionStore()
        if (!session.connected) return '/landing'
      }
    },
    { path: '/:pathMatch(.*)*', redirect: '/landing' },
  ],
})

export default router
```

- [ ] **Step 2: Replace src/App.vue**

```vue
<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <RouterView />
</template>
```

- [ ] **Step 3: Replace src/main.js**

```javascript
import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index.js'

if (typeof __BUILD_TIME__ !== 'undefined') {
  console.log(`%cQuickerStorm %cbuild ${__BUILD_TIME__}`, 'color:#00b4d8;font-weight:700', 'color:#7ab8d0')
}

const app = createApp(App)
app.use(createPinia())
app.use(router)

app.directive('click-outside', {
  mounted(el, binding) {
    el._clickOutside = (e) => { if (!el.contains(e.target)) binding.value(e) }
    document.addEventListener('click', el._clickOutside, true)
  },
  unmounted(el) {
    document.removeEventListener('click', el._clickOutside, true)
  },
})

app.mount('#app')
```

- [ ] **Step 4: Strip Slack/Google from avatarStore.js**

In `src/stores/avatarStore.js`, remove: `slackId`, `avaEmail`, `slackUserToken`, `slackTeamId`, `statusEmoji`, `statusMessage`, `slackStatus` (computed), and all Slack-related actions. Keep: `displayName`, `title`, `initials`, `color`, `skinTone`, `hairColor`, `hairStyle`, `status`, `avatarUrl`, `isSetupDone`.

Open the file, find each Slack-specific `ref()` and remove it along with any actions that reference it.

- [ ] **Step 5: Verify dev server starts**

```powershell
npm run dev
```

Browse to `http://localhost:5173` — should show the landing page with grid selector and login form. No console errors about missing modules.

- [ ] **Step 6: Commit**

```powershell
git add src/router/index.js src/App.vue src/main.js src/stores/avatarStore.js
git commit -m "feat(app): replace router + App shell + strip Supabase/Slack from avatarStore"
```

---

## Task 15: Three.js World Engine

**Files:** Create `src/composables/useWorldEngine.js`, `src/composables/use2DFallback.js`

- [ ] **Step 1: Create src/composables/use2DFallback.js**

```javascript
// src/composables/use2DFallback.js — detect low-end/mobile; expose mode toggle
import { ref, onMounted } from 'vue'

const is2D = ref(false)

export function use2DFallback() {
  function detect() {
    const mobile  = /Mobi|Android/i.test(navigator.userAgent)
    const lowMem  = navigator.deviceMemory !== undefined && navigator.deviceMemory < 2
    const noGL    = (() => { try { const c = document.createElement('canvas'); return !c.getContext('webgl2') && !c.getContext('webgl') } catch { return true } })()
    is2D.value = mobile || lowMem || noGL
  }

  onMounted(detect)

  function setMode(mode) { is2D.value = mode === '2d' }

  return { is2D, setMode }
}
```

- [ ] **Step 2: Create src/composables/useWorldEngine.js**

This replaces `useOfficeEngine.js` for SL/OpenSim world rendering.

```javascript
// src/composables/useWorldEngine.js — Three.js scene driven by LLUDP ObjectUpdate data
import { onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import gsap from 'gsap'
import { useWorldStore, PCODE_AVATAR, PCODE_PRIM } from '@/stores/worldStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useRealtimeSocket } from './useRealtimeSocket'
import { useLLUDP } from './useLLUDP'
import { S } from '@shared/protocol.js'

// SL uses Z-up; Three.js uses Y-up. Convert: THREE.Vector3(sl.x, sl.z, -sl.y)
function slToThree(x, y, z) { return new THREE.Vector3(x, z, -y) }

export function useWorldEngine(canvasRef) {
  const worldStore   = useWorldStore()
  const sessionStore = useSessionStore()
  const { on, off }  = useRealtimeSocket()
  const { sendMove } = useLLUDP()

  let renderer, labelRenderer, scene, camera, animId
  const meshMap = new Map()  // localId → THREE.Mesh

  // ── Input state ─────────────────────────────────────────────────────────
  const keys = {}
  let controlFlags = 0
  let agentUpdateTimer = null

  const CTRL = {
    FORWARD:  0x01,
    BACKWARD: 0x02,
    LEFT:     0x04,
    RIGHT:    0x08,
    UP:       0x10,
    DOWN:     0x20,
  }

  function onKeyDown(e) {
    keys[e.code] = true
    updateControlFlags()
  }
  function onKeyUp(e) {
    keys[e.code] = false
    updateControlFlags()
  }
  function updateControlFlags() {
    controlFlags = 0
    if (keys['KeyW'] || keys['ArrowUp'])    controlFlags |= CTRL.FORWARD
    if (keys['KeyS'] || keys['ArrowDown'])  controlFlags |= CTRL.BACKWARD
    if (keys['KeyA'] || keys['ArrowLeft'])  controlFlags |= CTRL.LEFT
    if (keys['KeyD'] || keys['ArrowRight']) controlFlags |= CTRL.RIGHT
    if (keys['PageUp'])                     controlFlags |= CTRL.UP
    if (keys['PageDown'])                   controlFlags |= CTRL.DOWN
  }

  function sendAgentUpdate() {
    sendMove({
      controlFlags,
      bodyRot:   [0, 0, 0],
      headRot:   [0, 0, 0],
      camCenter: [camera.position.x, -camera.position.z, camera.position.y],
      camAt:     [0, 0, 1],
      camLeft:   [-1, 0, 0],
      camUp:     [0, 1, 0],
      far:       128,
    })
  }

  // ── Scene setup ──────────────────────────────────────────────────────────
  function initScene() {
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87ceeb)  // sky blue placeholder
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.002)

    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 512)
    camera.position.set(0, 2, 10)

    renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping

    labelRenderer = new CSS2DRenderer()
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.top = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'
    canvasRef.value.parentElement.appendChild(labelRenderer.domElement)

    // Terrain placeholder
    const terrain = new THREE.Mesh(
      new THREE.PlaneGeometry(256, 256, 64, 64),
      new THREE.MeshStandardMaterial({ color: 0x4a7c59 })
    )
    terrain.rotation.x = -Math.PI / 2
    terrain.receiveShadow = true
    scene.add(terrain)

    // Lighting
    const sun = new THREE.DirectionalLight(0xfff4e6, 1.5)
    sun.position.set(50, 80, 50)
    sun.castShadow = true
    scene.add(sun)
    scene.add(new THREE.AmbientLight(0x6688cc, 0.4))

    // Resize observer
    const ro = new ResizeObserver(onResize)
    ro.observe(canvasRef.value.parentElement)

    onResize()
  }

  function onResize() {
    const el = canvasRef.value?.parentElement
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
  }

  // ── Mesh management ───────────────────────────────────────────────────────
  const PRIM_GEOM = {
    9:  () => new THREE.BoxGeometry(1, 1, 1),     // default prim → box
    47: () => new THREE.CapsuleGeometry(0.3, 1.2, 4, 8),  // avatar
  }

  function upsertMesh(obj) {
    let mesh = meshMap.get(obj.localId)
    if (!mesh) {
      const geo = (PRIM_GEOM[obj.pcode] ?? PRIM_GEOM[9])()
      const mat = obj.pcode === PCODE_AVATAR
        ? new THREE.MeshStandardMaterial({ color: 0x00b4d8 })
        : new THREE.MeshStandardMaterial({ color: 0xcccccc })
      mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true

      if (obj.pcode === PCODE_AVATAR) {
        // Name tag
        const div = document.createElement('div')
        div.className = 'qs-nametag'
        div.style.cssText = 'color:#fff;font-size:0.75rem;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;white-space:nowrap;'
        div.textContent = obj.name ?? 'Avatar'
        const label = new CSS2DObject(div)
        label.position.set(0, 1.2, 0)
        mesh.add(label)
      }

      scene.add(mesh)
      meshMap.set(obj.localId, mesh)
    }

    // Scale (SL → Three.js)
    if (obj.scale) mesh.scale.set(obj.scale[0], obj.scale[2], obj.scale[1])

    // Position — animate smoothly
    if (obj.pos) {
      const target = slToThree(obj.pos[0], obj.pos[1], obj.pos[2])
      gsap.to(mesh.position, { x: target.x, y: target.y, z: target.z, duration: 0.1, overwrite: true })
    }
  }

  function removeMesh(localId) {
    const mesh = meshMap.get(localId)
    if (mesh) { scene.remove(mesh); meshMap.delete(localId) }
  }

  // ── Incoming object updates ───────────────────────────────────────────────
  function onObjectUpdate(msg) {
    for (const obj of (msg.d?.objects ?? [])) {
      worldStore.upsertObject(obj)
      upsertMesh(obj)
    }
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  function animate() {
    animId = requestAnimationFrame(animate)
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  onMounted(() => {
    initScene()
    animate()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    agentUpdateTimer = setInterval(sendAgentUpdate, 100)  // 10 Hz
    on(S.OBJECT_UPDATE, onObjectUpdate)
  })

  onUnmounted(() => {
    cancelAnimationFrame(animId)
    clearInterval(agentUpdateTimer)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup',   onKeyUp)
    off(S.OBJECT_UPDATE, onObjectUpdate)
    renderer?.dispose()
    labelRenderer?.domElement.remove()
    worldStore.clearAll()
  })

  return { scene, camera }
}
```

- [ ] **Step 3: Commit**

```powershell
git add src/composables/useWorldEngine.js src/composables/use2DFallback.js
git commit -m "feat(3d): useWorldEngine Three.js scene + use2DFallback detection"
```

---

## Task 16: World View + UI Components

**Files:** Create `src/components/WorldCanvas.vue`, `src/components/HUDLayer.vue`, `src/components/AvatarList.vue`, `src/components/MinimapOverlay.vue`, `src/components/ChatBar.vue`, `src/components/SimpleWorldView.vue`, `src/views/WorldView.vue`

- [ ] **Step 1: Create src/components/WorldCanvas.vue**

```vue
<script setup>
import { ref } from 'vue'
import { useWorldEngine } from '@/composables/useWorldEngine'
const canvasRef = ref(null)
useWorldEngine(canvasRef)
</script>

<template>
  <div class="relative w-full h-full">
    <canvas ref="canvasRef" class="w-full h-full block" />
  </div>
</template>
```

- [ ] **Step 2: Create src/components/HUDLayer.vue**

```vue
<script setup>
import { useSessionStore } from '@/stores/sessionStore'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket'
const session   = useSessionStore()
const { connected } = useRealtimeSocket()
</script>

<template>
  <div class="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none select-none">
    <span class="text-xs bg-black/50 text-white px-2 py-0.5 rounded">
      {{ session.regionName || 'Unknown Region' }}
    </span>
    <span class="text-xs" :class="connected ? 'text-green-400' : 'text-red-400'">
      {{ connected ? '● Connected' : '○ Disconnected' }}
    </span>
  </div>
</template>
```

- [ ] **Step 3: Create src/components/AvatarList.vue**

```vue
<script setup>
import { useWorldStore } from '@/stores/worldStore'
const world = useWorldStore()
</script>

<template>
  <div class="absolute right-0 top-0 h-full w-48 bg-side/80 backdrop-blur border-l border-brd overflow-y-auto">
    <p class="text-t2 text-xs px-3 py-2 uppercase tracking-wide">Nearby ({{ world.avatars.length }})</p>
    <ul>
      <li v-for="av in world.avatars" :key="av.localId" class="px-3 py-1 text-sm text-t1 truncate hover:bg-card/50">
        {{ av.name || av.fullId?.slice(0, 8) || 'Avatar' }}
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 4: Create src/components/MinimapOverlay.vue**

```vue
<script setup>
import { computed } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
const world  = useWorldStore()
const SIZE   = 128
const REGION = 256  // SL region is 256×256m

const dots = computed(() =>
  world.avatars.map(av => ({
    id: av.localId,
    x:  av.pos ? (av.pos[0] / REGION) * SIZE : SIZE / 2,
    y:  av.pos ? SIZE - (av.pos[1] / REGION) * SIZE : SIZE / 2,
  }))
)
</script>

<template>
  <div class="absolute bottom-16 left-2 bg-black/60 rounded">
    <svg :width="SIZE" :height="SIZE">
      <rect width="100%" height="100%" fill="transparent" />
      <!-- Grid lines -->
      <line x1="64" y1="0" x2="64" y2="128" stroke="#ffffff18" stroke-width="1"/>
      <line x1="0" y1="64" x2="128" y2="64" stroke="#ffffff18" stroke-width="1"/>
      <!-- Avatar dots -->
      <circle v-for="d in dots" :key="d.id" :cx="d.x" :cy="d.y" r="3" fill="#00b4d8" />
    </svg>
  </div>
</template>
```

- [ ] **Step 5: Create src/components/ChatBar.vue**

```vue
<script setup>
import { ref } from 'vue'
import { useLocalChat } from '@/composables/useLocalChat'
const { messages, send } = useLocalChat()
const input = ref('')

function submit() {
  const msg = input.value.trim()
  if (!msg) return
  send(msg)
  input.value = ''
}

const CHAT_TYPES = { 0: 'text-t2 italic', 1: 'text-t1', 2: 'text-yellow-400 font-semibold' }
</script>

<template>
  <div class="absolute bottom-0 left-0 right-48 flex flex-col">
    <!-- Message history -->
    <div class="max-h-36 overflow-y-auto px-3 py-1 flex flex-col-reverse gap-0.5">
      <div v-for="m in [...messages].reverse().slice(0, 40)" :key="m.id"
           :class="['text-sm', CHAT_TYPES[m.chatType] ?? 'text-t1']">
        <span class="text-accent font-medium">{{ m.fromName }}:</span>
        {{ m.message }}
      </div>
    </div>
    <!-- Input -->
    <form class="flex gap-2 px-3 py-2 bg-side/80 backdrop-blur border-t border-brd" @submit.prevent="submit">
      <input
        v-model="input"
        type="text"
        placeholder="Say something…"
        class="flex-1 bg-card border border-brd text-t1 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        maxlength="1023"
      />
      <button type="submit" class="px-3 py-1 bg-accent text-white rounded text-sm hover:bg-accent2">Send</button>
    </form>
  </div>
</template>
```

- [ ] **Step 6: Create src/components/SimpleWorldView.vue**

```vue
<script setup>
// 2D top-down fallback view — HTML canvas, no Three.js
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useWorldStore } from '@/stores/worldStore'
import { useLocalChat } from '@/composables/useLocalChat'
const world = useWorldStore()
const { messages, send } = useLocalChat()

const canvasRef = ref(null)
const input = ref('')
const SIZE = 256  // px

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1a2a1a'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.strokeStyle = '#ffffff18'
  ctx.beginPath()
  ctx.moveTo(SIZE/2, 0); ctx.lineTo(SIZE/2, SIZE)
  ctx.moveTo(0, SIZE/2); ctx.lineTo(SIZE, SIZE/2)
  ctx.stroke()
  // Draw avatars
  for (const av of world.avatars) {
    const x = av.pos ? (av.pos[0] / 256) * SIZE : SIZE / 2
    const y = av.pos ? SIZE - (av.pos[1] / 256) * SIZE : SIZE / 2
    ctx.fillStyle = '#00b4d8'
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '10px sans-serif'
    ctx.fillText(av.name ?? 'Avatar', x + 6, y + 4)
  }
}

let rafId
function loop() { draw(); rafId = requestAnimationFrame(loop) }
onMounted(loop)
onUnmounted(() => cancelAnimationFrame(rafId))
</script>

<template>
  <div class="flex flex-col h-full bg-bg text-t1">
    <div class="flex-1 flex items-center justify-center">
      <canvas ref="canvasRef" :width="256" :height="256" class="rounded border border-brd" />
    </div>
    <div class="max-h-32 overflow-y-auto px-3 py-1 bg-side border-t border-brd">
      <div v-for="m in [...messages].reverse().slice(0,20)" :key="m.id" class="text-sm py-0.5">
        <span class="text-accent">{{ m.fromName }}:</span> {{ m.message }}
      </div>
    </div>
    <form class="flex gap-2 p-2 bg-side border-t border-brd" @submit.prevent="() => { send(input); input = '' }">
      <input v-model="input" class="flex-1 bg-card border border-brd rounded px-2 py-1 text-sm text-t1" placeholder="Say something…" />
      <button class="px-3 py-1 bg-accent text-white rounded text-sm">Send</button>
    </form>
  </div>
</template>
```

- [ ] **Step 7: Create src/views/WorldView.vue**

```vue
<script setup>
import { use2DFallback } from '@/composables/use2DFallback'
import { useUiStore } from '@/stores/uiStore'
import WorldCanvas from '@/components/WorldCanvas.vue'
import SimpleWorldView from '@/components/SimpleWorldView.vue'
import HUDLayer from '@/components/HUDLayer.vue'
import AvatarList from '@/components/AvatarList.vue'
import MinimapOverlay from '@/components/MinimapOverlay.vue'
import ChatBar from '@/components/ChatBar.vue'

const { is2D, setMode } = use2DFallback()
const ui = useUiStore()
</script>

<template>
  <div class="w-screen h-screen overflow-hidden bg-bg relative">

    <!-- 2D Fallback -->
    <SimpleWorldView v-if="is2D" />

    <!-- 3D World -->
    <template v-else>
      <WorldCanvas class="absolute inset-0" />
      <HUDLayer />
      <AvatarList v-if="ui.showAvatarList" />
      <MinimapOverlay v-if="ui.showMinimap" />
      <ChatBar v-if="ui.showChat" />

      <!-- Mode toggle button -->
      <button
        class="absolute top-2 right-52 text-xs bg-black/50 text-white px-2 py-0.5 rounded hover:bg-black/70"
        @click="setMode(is2D ? '3d' : '2d')"
      >
        2D View
      </button>
    </template>

  </div>
</template>
```

- [ ] **Step 8: Commit**

```powershell
git add src/components/WorldCanvas.vue src/components/HUDLayer.vue src/components/AvatarList.vue
git add src/components/MinimapOverlay.vue src/components/ChatBar.vue src/components/SimpleWorldView.vue
git add src/views/WorldView.vue
git commit -m "feat(ui): WorldView, WorldCanvas, HUDLayer, AvatarList, Minimap, ChatBar, 2D fallback"
```

---

## Task 17: Deploy Files

**Files:** Create `deploy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/cloudflare-tunnel.md`, `deploy/synology-setup.md`

- [ ] **Step 1: Create deploy/Dockerfile**

```dockerfile
FROM oven/bun:latest AS builder
WORKDIR /app
COPY package*.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:prod

FROM oven/bun:latest
WORKDIR /app
COPY package*.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY server/ ./server/
COPY shared/ ./shared/
COPY src/config/grids.json ./src/config/
COPY --from=builder /app/dist/usaf ./dist/usaf

EXPOSE 8787
ENV STATIC_DIR=/app/dist/usaf
CMD ["bun", "run", "server/index.ts"]
```

- [ ] **Step 2: Create deploy/docker-compose.yml**

```yaml
version: '3.8'

services:
  app:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    container_name: quickerstorm-app
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=8787
      - STATIC_DIR=/app/dist/usaf
      # Add grid-specific env vars here if needed
    # No published ports — Cloudflare Tunnel reaches app container directly
    networks:
      - quickerstorm

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: quickerstorm-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    depends_on:
      - app
    networks:
      - quickerstorm

networks:
  quickerstorm:
    driver: bridge
```

Create `deploy/.env.example`:
```
CF_TUNNEL_TOKEN=your_cloudflare_tunnel_token_here
```

- [ ] **Step 3: Create deploy/cloudflare-tunnel.md**

```markdown
# Cloudflare Tunnel Setup

## One-time setup (Cloudflare dashboard)

1. Log into [Cloudflare Zero Trust](https://one.dash.cloudflare.com/)
2. Navigate to **Networks → Tunnels → Create a tunnel**
3. Name it `quickerstorm`
4. Copy the **tunnel token** — paste into `deploy/.env` as `CF_TUNNEL_TOKEN`
5. Add a public hostname:
   - Subdomain: `app` (or `quickerstorm`)
   - Domain: your domain (e.g. `yourdomain.com`)
   - Service type: `HTTP`
   - URL: `app:8787`  ← container name + port, same Docker network

## WebSocket note

Cloudflare proxies WebSocket upgrades automatically on proxied hostnames.
Ensure the hostname is **proxied** (orange cloud) in Cloudflare DNS.

## Starting the tunnel

```sh
# On Synology via Portainer: import docker-compose.yml as a Stack
# Env var CF_TUNNEL_TOKEN must be set in the Stack's Environment tab

# OR locally for testing:
cd deploy
cp .env.example .env   # fill in CF_TUNNEL_TOKEN
docker compose up -d
```

## Browser client config

Set `VITE_WS_URL=wss://app.yourdomain.com` in `.env.production`.

The Vue client connects to this WSS URL; Cloudflare terminates TLS and
forwards to the Bun container over plain HTTP/WS on port 8787.
```

- [ ] **Step 4: Create deploy/synology-setup.md**

```markdown
# Synology DS923+ Deployment

## Prerequisites

- Docker and Portainer installed via Synology Package Center
- Cloudflare Tunnel token obtained (see cloudflare-tunnel.md)

## Deploy via Portainer

1. In Portainer, go to **Stacks → Add stack**
2. Name: `quickerstorm`
3. Build method: **Git repository**
   - URL: your repo URL
   - Compose path: `deploy/docker-compose.yml`
4. Under **Environment variables**, add:
   - `CF_TUNNEL_TOKEN` = your tunnel token
5. Click **Deploy the stack**

## Build on Synology

Alternatively, build locally and push image to Synology's private registry,
or use `docker buildx` if building on the NAS directly.

## Logs

```sh
# Via Portainer UI: click container → Logs
# Via SSH:
docker logs quickerstorm-app -f
docker logs quickerstorm-tunnel -f
```

## Updating

```sh
# SSH into Synology or use Portainer:
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d --build
```

## Env file for local dev

Copy `deploy/.env.example` → `deploy/.env` and fill in `CF_TUNNEL_TOKEN`.
Never commit `.env` to git.
```

- [ ] **Step 5: Add .env to .gitignore**

Check `deploy/.env` is in `.gitignore`. Add if missing:
```
deploy/.env
```

- [ ] **Step 6: Commit**

```powershell
git add deploy/
git commit -m "feat(deploy): Dockerfile, docker-compose, Cloudflare Tunnel + Synology setup docs"
```

---

## Task 18: Integration Smoke Test

**Files:** No new files — verify the system runs end-to-end

- [ ] **Step 1: Run all server tests**

```powershell
cd server && bun test
```

Expected: all tests passing (grids, xmlrpc, lludp-codec, circuit)

- [ ] **Step 2: Run frontend tests**

```powershell
cd .. && npx vitest run
```

Expected: all tests passing (gridStore)

- [ ] **Step 3: Start dev servers**

Terminal 1:
```powershell
npm run dev:server
```

Terminal 2:
```powershell
npm run dev
```

- [ ] **Step 4: Smoke test**

1. Browse to `http://localhost:5173`
2. Landing page loads with grid selector and login form
3. Select a grid, enter credentials → click Log In
4. Browser DevTools → Network → WS — confirm `login` message sent, `login_ok` or `login_fail` received
5. On success: `WorldView` renders (Three.js canvas, green terrain, HUD, chat bar)
6. DevTools → Console: no module-not-found or import errors

> If login succeeds but no avatars appear: ObjectUpdate decoder TODO (position extraction) is expected at this stage. The circuit is live; positions will appear once `decodeObjectUpdate` blob parsing is completed.

- [ ] **Step 5: Final commit**

```powershell
git add -A
git commit -m "chore: Phase 1 implementation complete — login, LLUDP bridge, basic 3D world"
```

---

## Known Phase 1 Limitations (to address in Phase 2)

| Item | Detail |
|------|--------|
| ObjectUpdate position | `decodeObjectUpdate` has TODO for parsing the packed ObjectData blob. Reference `llviewerobjectlist.cpp` `processObjectUpdate` in Firestorm. Use `ImprovedTerseObjectUpdate` as interim for position updates. |
| Message IDs marked TODO | `ChatFromViewer`, `ChatFromSimulator`, `ObjectUpdate`, `ImprovedTerseObjectUpdate` IDs need verification against `phoenix-firestorm/indra/newview/app_settings/message.xml` |
| Texture loading | J2K decode not implemented; objects appear with flat grey material |
| Real terrain | Heightmap from UDP not yet decoded; flat plane placeholder only |
| Voice | WebRTC signaling needs adapting for SL voice protocol |
| Logout packet | `handleLogout` dynamic import workaround — refactor to pass session as param |
