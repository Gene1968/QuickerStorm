# Mesh Geometry Decode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render mesh prims as real geometry (not cubes) by detecting the mesh asset UUID, fetching + decoding the LLVolumeFaces on the server, and building a THREE.BufferGeometry on the client.

**Architecture:** Server decodes (reuses `parseLLSDBinary` + Bun `zlib`) and ships flat geometry arrays; client builds BufferGeometry and swaps it into the existing prim mesh. UUID-keyed, IndexedDB-cached like textures. Decoders TDD'd against one captured real mesh asset.

**Tech Stack:** Bun + TypeScript (server), Vue 3 + Three.js (client), IndexedDB, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-04-mesh-geometry-design.md`

---

## File Structure

- `server/lib/lludp-codec.ts` — `parseSculptExtraParam`; emit `meshId`/`sculptType` (both decoders).
- `server/lib/meshDecode.ts` — NEW: `parseMeshHeader`, `decodeMeshLOD` (pure, testable).
- `server/handlers/mesh.ts` — NEW: `handleMeshFetch` (+ one-shot asset capture in Bundle A).
- `server/index.ts` — route `C.MESH_FETCH`.
- `shared/protocol.js` — `C.MESH_FETCH`, `S.MESH_DATA`.
- `src/composables/useMeshFetch.js` — NEW: fetch + IndexedDB cache.
- `src/lib/meshCache.js` — NEW: IndexedDB store (mirror `textureCache.js`).
- `src/composables/useWorldEngine.js` — build BufferGeometry, replace cube.
- Tests: `server/__tests__/mesh-decode.test.ts`, fixture `server/__tests__/fixtures/mesh-asset.bin`.

---

## Bundle A — Detect mesh prims + capture one asset

### Task 1: `parseSculptExtraParam` + emit meshId

**Files:**
- Modify: `server/lib/lludp-codec.ts`
- Test: `server/__tests__/mesh-decode.test.ts`

- [ ] **Step 1: Write failing test (synthetic ExtraParam bytes)**

```ts
import { describe, it, expect } from 'bun:test'
import { parseSculptExtraParam } from '../lib/lludp-codec'

describe('parseSculptExtraParam', () => {
	const U = (h: string) => Buffer.from(h.replace(/-/g, ''), 'hex')
	it('reads sculpt UUID + type; flags mesh when type&7==5', () => {
		const uuid = '11223344-5566-7788-99aa-bbccddeeff00'
		const buf = Buffer.concat([U(uuid), Buffer.from([0x05])])   // type 5 = mesh
		expect(parseSculptExtraParam(buf, 0, buf.length)).toEqual({ uuid, sculptType: 5 })
	})
	it('returns null for too-short data', () => {
		expect(parseSculptExtraParam(Buffer.from([1, 2, 3]), 0, 3)).toBe(null)
	})
})
```

- [ ] **Step 2: Run — expect FAIL** (`parseSculptExtraParam` not exported)

Run: `bun test server/__tests__/mesh-decode.test.ts`

- [ ] **Step 3: Implement + wire emit**

Add to `server/lib/lludp-codec.ts` near `parseMaterialsExtraParam`:

```ts
// ExtraParam type 0x30 (Sculpt/Mesh): [sculptTexture UUID 16B][sculptType U8]. sculptType & 0x07:
// 1 sphere, 2 torus, 3 plane, 4 cylinder, 5 MESH. For mesh, the UUID is the mesh asset id.
export function parseSculptExtraParam(buf: Buffer, start: number, len: number): { uuid: string; sculptType: number } | null {
	if (len < 17) return null
	const uuid = bytesToUuid(buf, start)
	const sculptType = buf[start + 16]
	return { uuid, sculptType }
}
```

Add `meshId?: string` and `sculptType?: number` to `ObjectData`. In BOTH decoders' ExtraParams
walk, when `epType === 0x30`, parse it and set (only emit `meshId` for mesh):

```ts
// compressed loop (alongside the 0x80 branch):
if (epType === 0x30 && off + epSize <= dataEnd) {
	const sc = parseSculptExtraParam(buf, off, epSize)
	if (sc) { sculptType = sc.sculptType; if ((sc.sculptType & 0x07) === 5) meshId = sc.uuid }
}
// full loop (alongside the 0x80 branch): same, using q + sz <= epEnd and the local vars.
```

Declare `let meshId: string | undefined; let sculptType: number | undefined` next to `pbrFaces` in
each decoder, and add to each `objects.push`:

```ts
...(meshId ? { meshId } : {}),
...(sculptType != null ? { sculptType } : {}),
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test server/__tests__/mesh-decode.test.ts`

- [ ] **Step 5: Run full server suite (no regression)**

Run: `bun test server/__tests__/` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/lib/lludp-codec.ts server/__tests__/mesh-decode.test.ts
git commit -m "feat(mesh): decode Sculpt ExtraParam 0x30 -> meshId/sculptType"
```

### Task 2: One-shot capture of a real mesh asset

**Files:**
- Modify: `server/handlers/lludp.ts` (TEMP capture — removed after)

- [ ] **Step 1: Add capture in the compressed + full handlers**

In `server/handlers/lludp.ts`, add near the message-type consts:

```ts
// TEMP (mesh bundle A): on first decoded meshId, fetch that mesh asset via the cap and save it as a
// fixture so the mesh decoder is TDD'd offline. Single HTTP fetch (reliable). Remove after capture.
let _meshCapDone = false
async function captureMeshAsset(session: CircuitState, objects: import('../lib/lludp-codec').ObjectData[]): Promise<void> {
	if (_meshCapDone) return
	const withMesh = objects.find(o => o.meshId)
	if (!withMesh) return
	_meshCapDone = true
	const cap = session.caps.get('ViewerAsset') || session.caps.get('GetMesh2') || session.caps.get('GetMesh')
	if (!cap) return
	try {
		const res = await fetch(`${cap}/?mesh_id=${withMesh.meshId}`, { headers: { Accept: 'application/vnd.ll.mesh' } })
		const buf = Buffer.from(await res.arrayBuffer())
		fs.mkdirSync('server/__tests__/fixtures', { recursive: true })
		fs.writeFileSync('server/__tests__/fixtures/mesh-asset.bin', buf)
		console.log(`[CAPTURE] mesh asset ${withMesh.meshId} → ${buf.length}B (status ${res.status})`)
	} catch (e) { console.log(`[CAPTURE] mesh fetch failed: ${(e as Error).message}`) }
}
```

Call `void captureMeshAsset(session, objects)` right after each `decodeObjectUpdate(...)` and
`decodeObjectUpdateCompressed(...)` (inside the `objects.length > 0` blocks).

- [ ] **Step 2: Restart server, log in near mesh objects**

Claude runs: stop bun, `npm run dev:server` (background). User logs in where mesh objects exist
(most furnished regions). Expected: `[CAPTURE] mesh asset … → NNNNN B` in server stdout and
`server/__tests__/fixtures/mesh-asset.bin` exists (non-zero).

- [ ] **Step 3: Remove the capture instrumentation; commit fixture**

Delete `captureMeshAsset` + its call sites.

```bash
git add server/__tests__/fixtures/mesh-asset.bin
git commit -m "test(mesh): capture a real mesh asset fixture"
```

---

## Bundle B — Mesh header parse

### Task 3: `parseMeshHeader`

**Files:**
- Create: `server/lib/meshDecode.ts`
- Test: `server/__tests__/mesh-decode.test.ts`

- [ ] **Step 1: Write failing test (vs captured asset)**

Append to `server/__tests__/mesh-decode.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseMeshHeader } from '../lib/meshDecode'

const meshAsset = readFileSync(join(import.meta.dir, 'fixtures/mesh-asset.bin'))

describe('parseMeshHeader', () => {
	it('parses the LLSD-binary header into LOD offset/size + headerSize', () => {
		const h = parseMeshHeader(meshAsset)
		expect(h.headerSize).toBeGreaterThan(0)
		const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
		expect(lod).toBeDefined()
		expect(lod!.size).toBeGreaterThan(0)
		expect(h.headerSize + lod!.offset + lod!.size).toBeLessThanOrEqual(meshAsset.length)
	})
})
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `bun test server/__tests__/mesh-decode.test.ts`

- [ ] **Step 3: Implement `parseMeshHeader`**

```ts
// server/lib/meshDecode.ts — decode SL/OpenSim mesh assets (application/vnd.ll.mesh).
import { parseLLSDBinary } from './llsd'

export interface LodRef { offset: number; size: number }
export interface MeshHeader { headerSize: number; lods: { high?: LodRef; medium?: LodRef; low?: LodRef; lowest?: LodRef } }

/** Parse the mesh asset header. Offsets in the header are relative to headerSize (end of header). */
export function parseMeshHeader(buf: Buffer): MeshHeader {
	// Strip the optional "<? LLSD/Binary ?>\n" prefix (parseLLSDBinary also handles it, but compute
	// headerSize from the same start it parses from).
	const { value, end } = parseLLSDBinary(buf, 0)
	const m = (value && typeof value === 'object') ? value as Record<string, any> : {}
	const ref = (k: string): LodRef | undefined => {
		const r = m[k]
		return r && typeof r === 'object' && typeof r.offset === 'number' && typeof r.size === 'number'
			? { offset: r.offset, size: r.size } : undefined
	}
	return {
		headerSize: end,
		lods: { high: ref('high_lod'), medium: ref('medium_lod'), low: ref('low_lod'), lowest: ref('lowest_lod') },
	}
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test server/__tests__/mesh-decode.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/lib/meshDecode.ts server/__tests__/mesh-decode.test.ts
git commit -m "feat(mesh): parse mesh asset LLSD-binary header (LOD offsets)"
```

---

## Bundle C — LLVolumeFaces decode

### Task 4: `decodeMeshLOD`

**Files:**
- Modify: `server/lib/meshDecode.ts`
- Test: `server/__tests__/mesh-decode.test.ts`

- [ ] **Step 1: Write failing test (vs captured asset)**

```ts
import { decodeMeshLOD } from '../lib/meshDecode'

describe('decodeMeshLOD', () => {
	it('decodes the best LOD into submeshes with valid geometry', () => {
		const h = parseMeshHeader(meshAsset)
		const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
		const subs = decodeMeshLOD(meshAsset, h.headerSize, lod!)
		expect(subs.length).toBeGreaterThan(0)
		for (const s of subs) {
			expect(s.positions.length).toBeGreaterThan(0)
			expect(s.positions.length % 3).toBe(0)
			expect(s.indices.length % 3).toBe(0)
			const vtx = s.positions.length / 3
			for (const i of s.indices) expect(i).toBeLessThan(vtx)
			for (const p of s.positions) expect(Number.isFinite(p)).toBe(true)
		}
	})
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test server/__tests__/mesh-decode.test.ts`

- [ ] **Step 3: Implement `decodeMeshLOD`**

```ts
import { inflateSync, inflateRawSync } from 'zlib'

export interface Submesh { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array }

function inflateLod(slice: Buffer): Buffer {
	try { return inflateSync(slice) } catch { return inflateRawSync(slice) }
}

// Un-quantize a U16 to [lo,hi]: lo + (u/65535)*(hi-lo).
const dequant = (u: number, lo: number, hi: number) => lo + (u / 65535) * (hi - lo)

export function decodeMeshLOD(buf: Buffer, headerSize: number, lod: LodRef): Submesh[] {
	const slice = buf.subarray(headerSize + lod.offset, headerSize + lod.offset + lod.size)
	const inflated = inflateLod(slice)
	const { value } = parseLLSDBinary(inflated, 0)   // array of submesh maps
	const arr = Array.isArray(value) ? value : []
	const out: Submesh[] = []
	for (const sm of arr) {
		if (!sm || typeof sm !== 'object' || sm.NoGeometry) continue
		const posBuf: Buffer = sm.Position
		const normBuf: Buffer = sm.Normal
		const uvBuf: Buffer = sm.TexCoord0
		const idxBuf: Buffer = sm.TriangleList
		if (!Buffer.isBuffer(posBuf) || !Buffer.isBuffer(idxBuf)) continue
		const pd = sm.PositionDomain ?? { Min: [-0.5, -0.5, -0.5], Max: [0.5, 0.5, 0.5] }
		const tcd = sm.TexCoord0Domain ?? { Min: [0, 0], Max: [1, 1] }
		const vCount = Math.floor(posBuf.length / 6)   // 3 × U16
		const positions = new Float32Array(vCount * 3)
		const normals = new Float32Array(vCount * 3)
		const uvs = new Float32Array(vCount * 2)
		for (let v = 0; v < vCount; v++) {
			positions[v * 3 + 0] = dequant(posBuf.readUInt16LE(v * 6 + 0), pd.Min[0], pd.Max[0])
			positions[v * 3 + 1] = dequant(posBuf.readUInt16LE(v * 6 + 2), pd.Min[1], pd.Max[1])
			positions[v * 3 + 2] = dequant(posBuf.readUInt16LE(v * 6 + 4), pd.Min[2], pd.Max[2])
			if (Buffer.isBuffer(normBuf) && normBuf.length >= v * 6 + 6) {
				normals[v * 3 + 0] = dequant(normBuf.readUInt16LE(v * 6 + 0), -1, 1)
				normals[v * 3 + 1] = dequant(normBuf.readUInt16LE(v * 6 + 2), -1, 1)
				normals[v * 3 + 2] = dequant(normBuf.readUInt16LE(v * 6 + 4), -1, 1)
			}
			if (Buffer.isBuffer(uvBuf) && uvBuf.length >= v * 4 + 4) {
				uvs[v * 2 + 0] = dequant(uvBuf.readUInt16LE(v * 4 + 0), tcd.Min[0], tcd.Max[0])
				uvs[v * 2 + 1] = dequant(uvBuf.readUInt16LE(v * 4 + 2), tcd.Min[1], tcd.Max[1])
			}
		}
		const triCount = Math.floor(idxBuf.length / 2)
		const indices = new Uint16Array(triCount)
		for (let i = 0; i < triCount; i++) indices[i] = idxBuf.readUInt16LE(i * 2)
		out.push({ positions, normals, uvs, indices })
	}
	return out
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test server/__tests__/mesh-decode.test.ts`
(If FAIL on inflate or domains: inspect the captured asset's submesh keys via a one-off script —
the LLSD-binary map keys are case-sensitive: `Position`, `Normal`, `TexCoord0`, `TriangleList`,
`PositionDomain`, `TexCoord0Domain`, `NoGeometry`.)

- [ ] **Step 5: Commit**

```bash
git add server/lib/meshDecode.ts server/__tests__/mesh-decode.test.ts
git commit -m "feat(mesh): decode LLVolumeFaces LOD into geometry arrays"
```

---

## Bundle D — Fetch + client build

### Task 5: Server `handleMeshFetch` + protocol + route

**Files:**
- Create: `server/handlers/mesh.ts`
- Modify: `shared/protocol.js`, `server/index.ts`

- [ ] **Step 1: Protocol messages**

In `shared/protocol.js`:
```js
// C:
MESH_FETCH: 'mesh_fetch',   // { meshId }
// S:
MESH_DATA:  'mesh_data',    // { meshId, submeshes:[{positions:number[],normals:number[],uvs:number[],indices:number[]}], error? }
```

- [ ] **Step 2: Implement handler**

```ts
// server/handlers/mesh.ts
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseMeshHeader, decodeMeshLOD } from '../lib/meshDecode'
import { S } from '../../shared/protocol.js'

export async function handleMeshFetch(circuitId: string, req: { meshId: string }): Promise<void> {
	const s = getSession(circuitId); if (!s) return
	const meshId = req?.meshId
	const send = (d: Record<string, unknown>) => s.ws.send(JSON.stringify({ t: S.MESH_DATA, d: { meshId, ...d } }))
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetMesh2') || s.caps.get('GetMesh')
	if (!cap || !meshId) { send({ error: 'cap_unavailable' }); return }
	try {
		const res = await fetch(`${cap}/?mesh_id=${meshId}`, { headers: { Accept: 'application/vnd.ll.mesh' }, signal: AbortSignal.timeout(25_000) })
		if (!res.ok) { send({ error: `http_${res.status}` }); return }
		const buf = Buffer.from(await res.arrayBuffer())
		const h = parseMeshHeader(buf)
		const lod = h.lods.high ?? h.lods.medium ?? h.lods.low ?? h.lods.lowest
		if (!lod) { send({ error: 'no_lod' }); return }
		const subs = decodeMeshLOD(buf, h.headerSize, lod).map(sm => ({
			positions: Array.from(sm.positions), normals: Array.from(sm.normals),
			uvs: Array.from(sm.uvs), indices: Array.from(sm.indices),
		}))
		send({ submeshes: subs })
		slog.info(s.ws, `[Mesh] ${meshId.slice(0, 8)}… ${buf.length}B → ${subs.length} submesh(es)`)
	} catch (e) { send({ error: (e as Error).message }) }
}
```

- [ ] **Step 3: Route in `server/index.ts`**

```ts
import { handleMeshFetch } from './handlers/mesh'
// in switch:
case C.MESH_FETCH: { handleMeshFetch(circuitId, msg.d as { meshId: string }); break }
```

- [ ] **Step 4: Server bundles**

Run: `bun build server/index.ts --target=bun --outfile=/tmp/qs.js` — Expected: bundles OK.

- [ ] **Step 5: Commit**

```bash
git add server/handlers/mesh.ts shared/protocol.js server/index.ts
git commit -m "feat(mesh): server mesh-fetch handler + protocol"
```

### Task 6: Client `meshCache` (IndexedDB)

**Files:**
- Create: `src/lib/meshCache.js`
- Test: `src/__tests__/lib/meshCache.test.js`

- [ ] **Step 1: Write failing test for the pure key helper**

```js
import { describe, it, expect } from 'bun:test'
import { meshDbConfig } from '@/lib/meshCache.js'
describe('meshCache', () => {
	it('exposes a stable store name + key path', () => {
		expect(meshDbConfig.store).toBe('mesh')
		expect(meshDbConfig.keyPath).toBe('uuid')
	})
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/__tests__/lib/meshCache.test.js`

- [ ] **Step 3: Implement `meshCache.js`** (mirror `textureCache.js`, storing submeshes JSON)

```js
// src/lib/meshCache.js — IndexedDB cache of decoded mesh geometry by asset UUID (immutable).
const DB_NAME = 'qs-mesh', DB_VERSION = 1, STORE = 'mesh'
export const meshDbConfig = { store: STORE, keyPath: 'uuid' }
let _db = null
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE, { keyPath: 'uuid' })
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
		req.onerror = () => reject(req.error)
	})
}
export async function meshCacheGet(uuid) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(uuid)
			req.onsuccess = () => resolve(req.result ? req.result.submeshes : null)
			req.onerror = () => reject(req.error)
		})
	} catch { return null }
}
export async function meshCachePut(uuid, submeshes) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).put({ uuid, submeshes })
			tx.oncomplete = resolve; tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
```

- [ ] **Step 4: Run — expect PASS**; **Step 5: Commit**

```bash
git add src/lib/meshCache.js src/__tests__/lib/meshCache.test.js
git commit -m "feat(mesh): IndexedDB mesh-geometry cache"
```

### Task 7: `useMeshFetch` + BufferGeometry build

**Files:**
- Create: `src/composables/useMeshFetch.js`
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Create `useMeshFetch.js`**

```js
// src/composables/useMeshFetch.js — fetch decoded mesh submeshes by UUID (IndexedDB → server).
import { useRealtimeSocket } from './useRealtimeSocket'
import { meshCacheGet, meshCachePut } from '@/lib/meshCache.js'
import { C, S } from '@shared/protocol.js'

const mem = new Map(), inflight = new Map(), pending = new Map(), failed = new Set()
let _wired = false
function _wire() { if (_wired) return; _wired = true; useRealtimeSocket().on(S.MESH_DATA, _on) }
function _on(d) {
	const p = pending.get(d?.meshId); if (!p) return
	pending.delete(d.meshId)
	p(d.error || !d.submeshes ? null : d.submeshes)
}
export function getMesh(uuid) {
	if (!uuid) return Promise.resolve(null)
	if (mem.has(uuid)) return Promise.resolve(mem.get(uuid))
	if (failed.has(uuid)) return Promise.resolve(null)
	if (inflight.has(uuid)) return inflight.get(uuid)
	_wire(); const { emit } = useRealtimeSocket()
	const p = (async () => {
		const cached = await meshCacheGet(uuid)
		if (cached) { mem.set(uuid, cached); return cached }
		const net = await new Promise(res => {
			const t = setTimeout(() => { pending.delete(uuid); res(null) }, 30000)
			pending.set(uuid, v => { clearTimeout(t); res(v) })
			emit(C.MESH_FETCH, { meshId: uuid })
		})
		if (net) { mem.set(uuid, net); meshCachePut(uuid, net); return net }
		failed.add(uuid); return null
	})().then(r => { inflight.delete(uuid); return r })
	inflight.set(uuid, p)
	return p
}
```

- [ ] **Step 2: Build BufferGeometry + swap into the prim mesh in `useWorldEngine.js`**

Import `getMesh` from `./useMeshFetch.js`. After the prim mesh is created (where `obj.meshId` exists),
fetch and replace the geometry:

```js
if (!isAvatar && !obj._placeholder && obj.meshId) {
	getMesh(obj.meshId).then(subs => {
		if (!subs || !subs.length || !mesh.parent) return
		const g = new THREE.BufferGeometry()
		// Concatenate submeshes into one geometry with groups (one material slot per submesh).
		let vTotal = 0, iTotal = 0
		for (const s of subs) { vTotal += s.positions.length / 3; iTotal += s.indices.length }
		const pos = new Float32Array(vTotal * 3), nor = new Float32Array(vTotal * 3), uv = new Float32Array(vTotal * 2)
		const idx = new Uint32Array(iTotal)
		let vOff = 0, iOff = 0
		for (let gi = 0; gi < subs.length; gi++) {
			const s = subs[gi]; const v = s.positions.length / 3
			pos.set(s.positions, vOff * 3); nor.set(s.normals, vOff * 3); uv.set(s.uvs, vOff * 2)
			for (let k = 0; k < s.indices.length; k++) idx[iOff + k] = s.indices[k] + vOff
			g.addGroup(iOff, s.indices.length, gi)
			vOff += v; iOff += s.indices.length
		}
		g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
		g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
		g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
		g.setIndex(new THREE.BufferAttribute(idx, 1))
		// WHY: mesh asset geometry is unit-ish; bake the prim scale so it matches world size.
		const scaled = bakePrimScale(g, obj.scale)
		const old = mesh.geometry
		mesh.geometry = scaled
		old.dispose()
	})
}
```

- [ ] **Step 3: Build**

Run: `npm run build:staging` — Expected: built.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useMeshFetch.js src/composables/useWorldEngine.js
git commit -m "feat(mesh): fetch + build BufferGeometry, replace cube"
```

---

## Bundle E — Live verify

### Task 8: Verify mesh objects render

- [ ] **Step 1:** Restart server, hard-reload, log in near mesh objects (furniture/buildings).
- [ ] **Step 2:** Confirm mesh prims render as real shapes (not cubes); `[Mesh] …→ N submesh(es)` in
  server stdout; geometry textures via the existing pipeline.
- [ ] **Step 3:** Check no rotation-flicker / NaN (the prim-scale guard already skips bad scale).
- [ ] **Step 4:** Relogin → meshes load from IndexedDB (few/no `[Mesh]` fetch lines).
- [ ] **Step 5:** Update memory (caps-feature-map) + report for commit.

---

## Self-Review notes

- **Spec coverage:** detection (Task 1), capture (Task 2), header (Task 3), LLVolumeFaces (Task 4),
  fetch+protocol (Task 5), IDB cache (Task 6), client build (Task 7), live verify (Task 8). All spec
  components mapped.
- **Type consistency:** `Submesh{positions,normals,uvs,indices}` (typed arrays server-side) →
  serialized as `number[]` in `S.MESH_DATA` → client rebuilds typed arrays. `LodRef{offset,size}`,
  `MeshHeader{headerSize,lods}` consistent across Tasks 3–5.
- **Fixture dependency:** Tasks 3–4 assert structural invariants (counts, finite, in-bounds) against
  the captured `mesh-asset.bin` — not magic values; this is fixture-based TDD.
- **Unknowns to resolve at impl:** exact LLSD-binary submesh key casing + zlib variant (Task 4 Step 4
  note); whether mesh detection fires on full-update prims (shared ExtraParams wiring).
```
