# Materials / PBR (hybrid lit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render prim materials — legacy `RenderMaterials` (normal/spec), GLTF **PBR**, and TE **glow** — by switching only material-bearing prims to a lit `MeshStandardMaterial` while plain prims keep the fast unlit path.

**Architecture:** Server decodes material references (TE fields 8/10/11 + ExtraParam `0x80`). Frontend selects per-prim material (`PBR > legacy > basic`), fetches material assets via `ViewerAsset`/`RenderMaterials` caps (IDB-cached), and builds `MeshStandardMaterial` maps. Decoders are TDD'd against real captured packets.

**Tech Stack:** Bun + TypeScript (server), Vue 3 + Three.js (client), IndexedDB cache, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-03-materials-pbr-design.md`

---

## File Structure

- `server/lib/lludp-codec.ts` — extend `parseTextureEntryFields` (glow/shiny/fullbright/material_id) + new `parseMaterialsExtraParam`; wire into both object decoders.
- `server/handlers/lludp.ts` — TEMP fixture capture (bundle 1, then removed).
- `server/handlers/materials.ts` — NEW: `handleRenderMaterials` (zlib RenderMaterials cap) + PBR material fetch.
- `server/handlers/assets.ts` — add `'material'` asset type (no transcode).
- `shared/protocol.js` — `C.MATERIAL_FETCH` / `S.MATERIAL_DATA`.
- `src/composables/useMaterialFetch.js` — NEW: fetch+parse+cache PBR + legacy materials.
- `src/composables/useWorldEngine.js` — hybrid material selection + lit build + glow.
- `server/__tests__/materials-decode.test.ts`, `server/__tests__/fixtures/*` — tests + captured fixtures.
- `src/__tests__/lib/gltfMaterial.test.js` — pure GLTF→descriptor mapper test.

---

## Bundle 1 — Capture real fixtures (one login)

### Task 1: One-shot capture of material packets + cap responses

**Files:**
- Modify: `server/handlers/lludp.ts` (TEMP capture block)
- Modify: `server/handlers/materials.ts` will not exist yet; capture cap response via a temporary fetch log in `server/handlers/assets.ts`

- [ ] **Step 1: Add packet capture in lludp.ts high:13 + high:12 handlers**

In `server/handlers/lludp.ts`, near the message-type consts add:

```ts
// TEMP (slice 2 fixture capture): dump packets whose decoded objects carry a material reference
// (ExtraParam 0x80 PBR uuid or non-zero TE material_id) so the material decoders can be TDD'd
// offline. Self-disables after CAP_MAX. Remove with its call sites.
const _matCap: Array<{ kind: string; hex: string; dataOffset: number }> = []
const MAT_CAP_MAX = 6
let _matCapDone = false
function captureMaterialFixture(kind: string, buf: Buffer, dataOffset: number, objects: ObjectData[]): void {
	if (_matCapDone) return
	const hit = objects.some(o => o.defaultPbrMaterial || (o.pbrMaterials && o.pbrMaterials.some(Boolean)) || (o.defaultMaterialId))
	if (!hit) return
	_matCap.push({ kind, hex: buf.toString('hex'), dataOffset })
	if (_matCap.length >= MAT_CAP_MAX) {
		_matCapDone = true
		try {
			fs.mkdirSync('server/__tests__/fixtures', { recursive: true })
			fs.writeFileSync('server/__tests__/fixtures/material-packets.json', JSON.stringify(_matCap, null, 2))
			console.log(`[CAPTURE] wrote ${_matCap.length} material-packet fixtures`)
		} catch { /* best-effort */ }
	}
}
```

> NOTE: this capture depends on Bundle 2's decode emitting `defaultPbrMaterial`/`defaultMaterialId`.
> Order of work: do Bundle-2 decode FIRST behind the capture, OR capture raw and inspect. Simpler:
> capture the FIRST N packets that contain ExtraParam bytes `0x80` or a non-zero TE tail, by a raw
> byte scan, so capture does not depend on the decoder. Use this raw variant instead:

```ts
function captureMaterialFixture(kind: string, buf: Buffer, dataOffset: number): void {
	if (_matCapDone) return
	// Raw heuristic: the data region contains an ExtraParam type byte 0x80, OR is long enough to
	// carry a TE material_id. Capture broadly; we filter precisely offline.
	_matCap.push({ kind, hex: buf.toString('hex'), dataOffset })
	if (_matCap.length >= MAT_CAP_MAX) { _matCapDone = true; try { fs.mkdirSync('server/__tests__/fixtures',{recursive:true}); fs.writeFileSync('server/__tests__/fixtures/material-packets.json', JSON.stringify(_matCap,null,2)); console.log(`[CAPTURE] wrote ${_matCap.length}`) } catch {} }
}
```

Call `captureMaterialFixture('compressed', buf, dataOffset)` in the high:13 handler and
`captureMaterialFixture('full', buf, dataOffset)` in the high:12 handler (before decode).

- [ ] **Step 2: Add RenderMaterials cap response capture in assets.ts (temporary)**

In `server/handlers/assets.ts`, add a temporary one-shot: after we add the material fetch path
(Bundle 4) we'll capture; for now, capture a `RenderMaterials` GET-all response with a tiny temp
route. Simplest: in Bundle 4 we capture the cap response the first time `handleRenderMaterials` runs.
Mark TODO; not blocking Bundle 1.

- [ ] **Step 3: Restart server, log in once, confirm fixture written**

```
Stop-Process -Name bun -Force; npm run dev:server   # (Claude runs in background)
```
Log in to a region with materials (a mall). Expected: `[CAPTURE] wrote N` in server stdout and
`server/__tests__/fixtures/material-packets.json` exists.

- [ ] **Step 4: Remove the capture instrumentation; commit fixtures**

Delete `captureMaterialFixture` + its call sites. Keep the JSON fixture.

```bash
git add server/__tests__/fixtures/material-packets.json
git commit -m "test(materials): capture real material-bearing packet fixtures"
```

---

## Bundle 2 — Server decode (TE fields 8/10/11 + ExtraParam 0x80)

### Task 2: ExtraParam 0x80 (PBR material UUIDs) parser

**Files:**
- Modify: `server/lib/lludp-codec.ts`
- Test: `server/__tests__/materials-decode.test.ts`

- [ ] **Step 1: Write failing test (uses captured fixture)**

```ts
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decodeObjectUpdateCompressed, decodeObjectUpdate } from '../lib/lludp-codec'

const pkts = JSON.parse(readFileSync(join(import.meta.dir, 'fixtures/material-packets.json'), 'utf8'))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const decodeAny = (p) => (p.kind === 'compressed'
	? decodeObjectUpdateCompressed(Buffer.from(p.hex,'hex'), p.dataOffset)
	: decodeObjectUpdate(Buffer.from(p.hex,'hex'), p.dataOffset))

describe('material reference decode', () => {
	it('extracts at least one PBR material UUID or legacy material_id across fixtures', () => {
		let found = 0
		for (const p of pkts) for (const o of decodeAny(p)) {
			if (o.defaultPbrMaterial) { expect(o.defaultPbrMaterial).toMatch(UUID_RE); found++ }
			if (o.defaultMaterialId)  { expect(o.defaultMaterialId).toMatch(UUID_RE); found++ }
		}
		expect(found).toBeGreaterThan(0)
	})
})
```

- [ ] **Step 2: Run — expect FAIL** (`defaultPbrMaterial`/`defaultMaterialId` undefined)

Run: `bun test server/__tests__/materials-decode.test.ts`

- [ ] **Step 3: Implement `parseMaterialsExtraParam` + extend TE parser**

Add to `server/lib/lludp-codec.ts`:

```ts
// ExtraParam type 0x80 (MaterialsEP): [count U8][te_index U8][asset_UUID 16B]×count → per-face GLTF
// material asset UUIDs. Returns { default, faces } where default = face-the-most-common or first.
export function parseMaterialsExtraParam(buf: Buffer, start: number, len: number): { faces: Record<number,string> } {
	const faces: Record<number, string> = {}
	let p = start
	const end = start + len
	if (p >= end) return { faces }
	const count = buf[p++]
	for (let i = 0; i < count && p + 17 <= end; i++) {
		const te = buf[p++]
		const uuid = bytesToUuid(buf, p); p += 16
		if (uuid !== '00000000-0000-0000-0000-000000000000') faces[te] = uuid
	}
	return { faces }
}
```

Extend `parseTextureEntryFields` to read fields 8 (bump) and 10 (glow) and 11 (material_id) after
rotation (add readers; material_id is optional — guard `p < end`):

```ts
const bump   = readTEField(buf, p, end, 1, (b,o)=>b[o]);                       p = bump.next
const media  = readTEField(buf, p, end, 1, (b,o)=>b[o]);                       p = media.next
const glow   = readTEField(buf, p, end, 1, (b,o)=>b[o] / 255);                 p = glow.next
let matId = { def: '00000000-0000-0000-0000-000000000000', next: p }
if (p < end) { const m = readTEField(buf, p, end, 16, rUuid); matId = { def: m.def, next: m.next } }
// emit:
res.defaultGlow       = glow.def
res.defaultShiny      = (bump.def >> 6) & 0x03
res.defaultFullbright = (bump.def >> 5) & 0x01
if (matId.def !== ZERO_UUID) res.defaultMaterialId = matId.def
```

Add to `TEFields` + `ObjectData`: `defaultGlow?`, `defaultShiny?`, `defaultFullbright?`,
`defaultMaterialId?`, `defaultPbrMaterial?`, `pbrMaterials?: Array<string|null>`.

In **both** decoders, where ExtraParams are walked, call `parseMaterialsExtraParam` on the `0x80`
entry and set `defaultPbrMaterial` = `faces[0] ?? first value`, `pbrMaterials` from `faces`.
- Compressed decoder: in the ExtraParams loop, when `paramType === 0x80`, parse it (don't just skip).
- Full decoder: replace `skipVar1('ExtraParams')` with a parse that reads count + entries and
  captures `0x80` (keep advancing `off` exactly as before for non-0x80 entries).

- [ ] **Step 4: Run — expect PASS**

Run: `bun test server/__tests__/materials-decode.test.ts`

- [ ] **Step 5: Run full server suite (no regressions)**

Run: `bun test server/__tests__/` — Expected: all pass (prior 54 + new).

- [ ] **Step 6: Commit**

```bash
git add server/lib/lludp-codec.ts server/__tests__/materials-decode.test.ts
git commit -m "feat(materials): decode TE glow/shiny/fullbright/material_id + ExtraParam 0x80 PBR uuids"
```

---

## Bundle 3 — Material foundation (hybrid selection + lit path + glow)

### Task 3: `useMaterialFetch` skeleton + protocol

**Files:**
- Modify: `shared/protocol.js`
- Create: `src/composables/useMaterialFetch.js`

- [ ] **Step 1: Add protocol messages**

In `shared/protocol.js`:
```js
// C:
MATERIAL_FETCH: 'material_fetch',  // { kind:'pbr'|'legacy', ids:string[] }
// S:
MATERIAL_DATA:  'material_data',   // { kind, materials:{ [uuid]: <descriptor> }, error? }
```

- [ ] **Step 2: Create `useMaterialFetch.js` (PBR + legacy fetch, IDB-cached, deduped)**

```js
// src/composables/useMaterialFetch.js — fetch + cache prim material descriptors (PBR GLTF + legacy
// RenderMaterials). Mirrors useTextureFetch's layered cache + dedup.
import { useRealtimeSocket } from './useRealtimeSocket'
import { C, S } from '@shared/protocol.js'

const pbrCache = new Map(), legacyCache = new Map()
const pending = new Map() // `${kind}:${uuid}` → resolve
let _wired = false
function _wire() { if (_wired) return; _wired = true; useRealtimeSocket().on(S.MATERIAL_DATA, _on) }
function _on(d) {
	if (!d) return
	const cache = d.kind === 'pbr' ? pbrCache : legacyCache
	for (const [uuid, desc] of Object.entries(d.materials || {})) {
		cache.set(uuid, desc)
		const p = pending.get(`${d.kind}:${uuid}`); if (p) { pending.delete(`${d.kind}:${uuid}`); p(desc) }
	}
}
function _fetch(kind, uuid) {
	const cache = kind === 'pbr' ? pbrCache : legacyCache
	if (cache.has(uuid)) return Promise.resolve(cache.get(uuid))
	_wire(); const { emit } = useRealtimeSocket()
	const key = `${kind}:${uuid}`
	if (pending.has(key)) return new Promise(r => { const prev = pending.get(key); pending.set(key, v => { prev(v); r(v) }) })
	const p = new Promise(res => { const t = setTimeout(() => { pending.delete(key); res(null) }, 30000); pending.set(key, v => { clearTimeout(t); res(v) }) })
	emit(C.MATERIAL_FETCH, { kind, ids: [uuid] })
	return p
}
export function getPbrMaterial(uuid)    { return uuid ? _fetch('pbr', uuid)    : Promise.resolve(null) }
export function getLegacyMaterial(uuid) { return uuid ? _fetch('legacy', uuid) : Promise.resolve(null) }
```

- [ ] **Step 3: Commit**

```bash
git add shared/protocol.js src/composables/useMaterialFetch.js
git commit -m "feat(materials): material-fetch composable + protocol messages"
```

### Task 4: Hybrid material selection in useWorldEngine (lit for material prims) + glow

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Select lit material for material-bearing prims**

Where the prim material is built (`const mat = new THREE.MeshBasicMaterial(...)`), branch:

```js
const hasMaterial = !isAvatar && !obj._placeholder && (obj.defaultPbrMaterial || obj.defaultMaterialId)
const mat = hasMaterial
	? new THREE.MeshStandardMaterial({ color: primColor, metalness: 0, roughness: 1 })
	: new THREE.MeshBasicMaterial({ color: isAvatar ? 0x00b4d8 : primColor })
```

- [ ] **Step 2: Apply glow as emissive on the lit path**

After building a lit `mat`, if `obj.defaultGlow > 0` or `obj.defaultFullbright`:
```js
if (hasMaterial && (obj.defaultGlow || obj.defaultFullbright)) {
	mat.emissive = new THREE.Color(primColor)
	mat.emissiveIntensity = obj.defaultFullbright ? 1.0 : Math.min(1, obj.defaultGlow * 2)
}
```

- [ ] **Step 3: Ensure normals (flicker fix)**

When building geometry for a material prim, call `geo.computeVertexNormals()` if absent. Verify the
existing `bakePrimScale(buildPrimGeometry(...))` produces normals; if not, add the call.

- [ ] **Step 4: Build + live sanity (no decode of maps yet)**

Run: `npm run build:staging` — Expected: built. Material prims now render lit (shaded), plain prims unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(materials): hybrid lit material selection + glow/fullbright emissive"
```

---

## Bundle 4 — PBR (GLTF) apply

### Task 5: Server PBR material fetch (ViewerAsset?material_id)

**Files:**
- Create: `server/handlers/materials.ts`
- Modify: `server/index.ts` (route `C.MATERIAL_FETCH`)

- [ ] **Step 1: Implement `handleMaterialFetch` (pbr branch)**

```ts
// server/handlers/materials.ts
import { getSession } from '../state/sessions'
import { slog } from '../lib/serverLog'
import { parseLLSD, llsdStr } from '../lib/llsd'
import { S } from '../../shared/protocol.js'

export async function handleMaterialFetch(circuitId: string, req: { kind: string; ids: string[] }): Promise<void> {
	const s = getSession(circuitId); if (!s) return
	if (req.kind === 'pbr') return fetchPbr(s, req.ids)
	return fetchLegacy(s, req.ids)
}

async function fetchPbr(s: any, ids: string[]): Promise<void> {
	const cap = s.caps.get('ViewerAsset') || s.caps.get('GetTexture')
	const materials: Record<string, unknown> = {}
	for (const uuid of ids) {
		if (!cap) break
		try {
			const res = await fetch(`${cap}/?material_id=${uuid}`, { signal: AbortSignal.timeout(20000) })
			if (!res.ok) continue
			const wrap = parseLLSD(await res.text()) as Record<string, unknown> | null
			const json = wrap && typeof wrap === 'object' ? llsdStr((wrap as any).data) : ''
			if (json) materials[uuid] = JSON.parse(json)   // raw GLTF; client maps it
		} catch (e) { slog.warn(s.ws, `[Mat] pbr ${uuid.slice(0,8)} fail: ${(e as Error).message}`) }
	}
	s.ws.send(JSON.stringify({ t: S.MATERIAL_DATA, d: { kind: 'pbr', materials } }))
}
```

(Legacy `fetchLegacy` implemented in Bundle 5; stub it to send empty for now.)

- [ ] **Step 2: Route in server/index.ts**

```ts
import { handleMaterialFetch } from './handlers/materials'
// in switch:
case C.MATERIAL_FETCH: { handleMaterialFetch(circuitId, msg.d as { kind: string; ids: string[] }); break }
```

- [ ] **Step 3: Commit**

```bash
git add server/handlers/materials.ts server/index.ts
git commit -m "feat(materials): server PBR material fetch via ViewerAsset"
```

### Task 6: Pure GLTF→descriptor mapper + apply

**Files:**
- Create: `src/lib/gltfMaterial.js`
- Test: `src/__tests__/lib/gltfMaterial.test.js`
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Write failing test for the mapper**

```js
import { describe, it, expect } from 'bun:test'
import { gltfToDescriptor } from '@/lib/gltfMaterial.js'

const gltf = {
	materials: [{ pbrMetallicRoughness: { baseColorFactor: [1,1,1,1], metallicFactor: 0.5, roughnessFactor: 0.8,
		baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } },
		normalTexture: { index: 2 }, emissiveTexture: { index: 3 }, emissiveFactor: [1,0,0], alphaMode: 'BLEND' }],
	images: [{ uri: 'aaaaaaaa-0000-0000-0000-000000000001' }, { uri: 'bbbbbbbb-0000-0000-0000-000000000002' },
		{ uri: 'cccccccc-0000-0000-0000-000000000003' }, { uri: 'dddddddd-0000-0000-0000-000000000004' }],
	textures: [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }],
}
describe('gltfToDescriptor', () => {
	it('maps texture indices to image UUIDs + factors', () => {
		const d = gltfToDescriptor(gltf)
		expect(d.baseColorTex).toBe('aaaaaaaa-0000-0000-0000-000000000001')
		expect(d.metallicRoughnessTex).toBe('bbbbbbbb-0000-0000-0000-000000000002')
		expect(d.normalTex).toBe('cccccccc-0000-0000-0000-000000000003')
		expect(d.emissiveTex).toBe('dddddddd-0000-0000-0000-000000000004')
		expect(d.metallic).toBe(0.5); expect(d.roughness).toBe(0.8)
		expect(d.alphaMode).toBe('BLEND'); expect(d.emissiveFactor).toEqual([1,0,0])
	})
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun test src/__tests__/lib/gltfMaterial.test.js`

- [ ] **Step 3: Implement `gltfToDescriptor`**

```js
// src/lib/gltfMaterial.js — map an SL/OpenSim GLTF 2.0 material JSON to a flat descriptor of
// texture UUIDs + PBR factors. Texture index → images[textures[index].source].uri (a UUID string).
export function gltfToDescriptor(gltf) {
	const m = gltf?.materials?.[0] ?? {}
	const pbr = m.pbrMetallicRoughness ?? {}
	const texUuid = (info) => {
		if (!info || info.index == null) return null
		const src = gltf.textures?.[info.index]?.source
		return gltf.images?.[src]?.uri ?? null
	}
	return {
		baseColorTex:         texUuid(pbr.baseColorTexture),
		metallicRoughnessTex: texUuid(pbr.metallicRoughnessTexture),
		normalTex:            texUuid(m.normalTexture),
		emissiveTex:          texUuid(m.emissiveTexture),
		baseColorFactor:      pbr.baseColorFactor ?? [1, 1, 1, 1],
		metallic:             pbr.metallicFactor  ?? 1,
		roughness:            pbr.roughnessFactor ?? 1,
		emissiveFactor:       m.emissiveFactor ?? [0, 0, 0],
		alphaMode:            m.alphaMode ?? 'OPAQUE',
		alphaCutoff:          m.alphaCutoff ?? 0.5,
		doubleSided:          !!m.doubleSided,
	}
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun test src/__tests__/lib/gltfMaterial.test.js`

- [ ] **Step 5: Apply PBR descriptor in useWorldEngine**

For prims with `obj.defaultPbrMaterial`, after building the lit `mat`:
```js
getPbrMaterial(obj.defaultPbrMaterial).then(gltf => {
	if (!gltf || !mesh.parent || mesh.material !== mat) return
	const d = gltfToDescriptor(gltf)
	mat.metalness = d.metallic; mat.roughness = d.roughness
	mat.emissive = new THREE.Color(...d.emissiveFactor)
	if (d.doubleSided) mat.side = THREE.DoubleSide
	if (d.alphaMode === 'BLEND') { mat.transparent = true }
	else if (d.alphaMode === 'MASK') { mat.alphaTest = d.alphaCutoff }
	mat.color.setRGB(d.baseColorFactor[0], d.baseColorFactor[1], d.baseColorFactor[2])
	const set = (uuid, slot, cs) => uuid && getTexture(uuid).then(t => { if (t && mesh.material === mat) { if (cs) t.colorSpace = cs; mat[slot] = t; mat.needsUpdate = true } })
	set(d.baseColorTex,         'map',          THREE.SRGBColorSpace)
	set(d.normalTex,            'normalMap')
	set(d.metallicRoughnessTex, 'metalnessMap')   // ORM: also roughnessMap = same texture
	set(d.metallicRoughnessTex, 'roughnessMap')
	set(d.emissiveTex,          'emissiveMap',   THREE.SRGBColorSpace)
	mat.needsUpdate = true
})
```
Import `getPbrMaterial` from `./useMaterialFetch.js` and `gltfToDescriptor` from `@/lib/gltfMaterial.js`.

- [ ] **Step 6: Build + commit**

```bash
npm run build:staging
git add src/lib/gltfMaterial.js src/__tests__/lib/gltfMaterial.test.js src/composables/useWorldEngine.js
git commit -m "feat(materials): GLTF PBR descriptor + MeshStandard apply"
```

---

## Bundle 5 — Legacy RenderMaterials apply

### Task 7: Server legacy material fetch (zlib RenderMaterials)

**Files:**
- Modify: `server/handlers/materials.ts`

- [ ] **Step 1: Capture one RenderMaterials response (temp), inspect XML vs binary LLSD**

Temporarily in `fetchLegacy`, after the cap POST, `fs.writeFileSync('server/__tests__/fixtures/rendermaterials-response.bin', Buffer.from(await res.arrayBuffer()))` once. Inspect: is the inflated payload LLSD-XML (`<llsd>`) or binary? Set the parser accordingly in Step 2. Remove the temp write after.

- [ ] **Step 2: Implement `fetchLegacy` (zlib inflate + LLSD parse)**

```ts
import { inflateSync, gunzipSync } from 'zlib'
import { parseLLSD, parseLLSDBinary, llsdStr, llsdNum } from '../lib/llsd'

async function fetchLegacy(s: any, ids: string[]): Promise<void> {
	const cap = s.caps.get('RenderMaterials')
	const materials: Record<string, unknown> = {}
	if (cap) try {
		// POST a zlib-compressed LLSD array of 16-byte binary material IDs. Build minimal LLSD-XML
		// then deflate. (Confirm the exact zip from the captured request format if this 404s.)
		const idsLlsd = `<?xml version="1.0"?><llsd><array>${ids.map(u => `<binary encoding="base16">${u.replace(/-/g,'')}</binary>`).join('')}</array></llsd>`
		const zipped = require('zlib').deflateSync(Buffer.from(idsLlsd))
		const body = `<?xml version="1.0"?><llsd><map><key>Zipped</key><binary encoding="base64">${zipped.toString('base64')}</binary></map></llsd>`
		const res = await fetch(cap, { method: 'POST', headers: { 'Content-Type': 'application/llsd+xml' }, body, signal: AbortSignal.timeout(20000) })
		if (res.ok) {
			const top = parseLLSD(await res.text()) as Record<string, unknown> | null
			const zb = Buffer.from(llsdStr((top as any)?.Zipped).replace(/\s+/g,''), 'base64')
			const inflated = inflateSync(zb)
			// XML-or-binary per Step 1 inspection:
			const arr = parseLLSD(inflated.toString('utf8')) as any[] | null
			for (const entry of (Array.isArray(arr) ? arr : [])) {
				const id = llsdStr(entry.ID); const M = entry.Material || {}
				materials[id] = {
					normMap: llsdStr(M.NormMap), specMap: llsdStr(M.SpecMap),
					specColor: M.SpecColor, specExp: llsdNum(M.SpecExp),
					alphaMode: llsdNum(M.DiffuseAlphaMode), alphaCutoff: llsdNum(M.AlphaMaskCutoff),
				}
			}
		}
	} catch (e) { slog.warn(s.ws, `[Mat] legacy fail: ${(e as Error).message}`) }
	s.ws.send(JSON.stringify({ t: S.MATERIAL_DATA, d: { kind: 'legacy', materials } }))
}
```

> If Step 1 shows binary LLSD, swap `parseLLSD(inflated.toString('utf8'))` for
> `parseLLSDBinary(inflated).value`. If the request zip format is wrong (cap 404/empty), capture a
> real FS request via the same instrumentation and match its `Zipped` bytes.

- [ ] **Step 3: Commit**

```bash
git add server/handlers/materials.ts
git commit -m "feat(materials): legacy RenderMaterials fetch (zlib LLSD)"
```

### Task 8: Apply legacy material (normal/spec) in useWorldEngine

**Files:**
- Modify: `src/composables/useWorldEngine.js`

- [ ] **Step 1: Apply legacy descriptor**

For prims with `obj.defaultMaterialId` (and no PBR), after building lit `mat`:
```js
getLegacyMaterial(obj.defaultMaterialId).then(m => {
	if (!m || !mesh.parent || mesh.material !== mat) return
	if (m.normMap) getTexture(m.normMap).then(t => { if (t && mesh.material === mat) { mat.normalMap = t; mat.needsUpdate = true } })
	// Specular map → approximate via roughness (MeshStandard has no spec map); shinier = lower roughness.
	mat.roughness = m.specExp ? Math.max(0.1, 1 - m.specExp / 255) : 1
	if (m.alphaMode === 1) mat.transparent = true
	else if (m.alphaMode === 2) mat.alphaTest = (m.alphaCutoff ?? 128) / 255
	mat.needsUpdate = true
})
```
Import `getLegacyMaterial` from `./useMaterialFetch.js`.

- [ ] **Step 2: Build + commit**

```bash
npm run build:staging
git add src/composables/useWorldEngine.js
git commit -m "feat(materials): apply legacy normal/spec material"
```

---

## Bundle 6 — Flicker + live verify

### Task 9: Verify no rotation-flicker on lit prims + live materials

- [ ] **Step 1: Restart server, hard-reload, log in**
- [ ] **Step 2: Observe** material prims (signage/metal/PBR objects). Rotate camera/orbit; confirm no flicker as lit prims rotate. If flicker: ensure `geo.computeVertexNormals()` ran + `flatShading=false`; if persists, set `mat.flatShading=true` or fall back specific pcodes.
- [ ] **Step 3: Confirm** normal/spec depth on legacy prims; metallic/roughness/emissive on PBR prims; glow on glowing prims.
- [ ] **Step 4: Check** `[Mat]` fetch lines in server stdout; confirm material cache hits on relogin.
- [ ] **Step 5: Update memory** (caps-feature-map) with slice-2 result; report to user for commit.

---

## Self-Review notes

- **Spec coverage:** TE glow/shiny/fullbright/material_id (Task 2), ExtraParam 0x80 (Task 2), hybrid
  selection (Task 4), PBR fetch+apply (Tasks 5–6), legacy fetch+apply (Tasks 7–8), flicker (Task 9),
  glow→emissive (Task 4). Overrides + bloom + per-face explicitly out-of-scope (spec).
- **Fixture dependency:** Bundles 2/5 assert against captured real packets/responses; exact UUIDs
  filled from the fixture after Bundle 1 (this is fixture-based TDD, not a placeholder).
- **Unknowns to resolve at impl:** RenderMaterials zipped-LLSD XML-vs-binary (Task 7 Step 1);
  RenderMaterials request zip format (Task 7 note); flicker fix specifics (Task 9 Step 2).
