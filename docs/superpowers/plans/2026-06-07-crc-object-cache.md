# CRC Object Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make objects seen in a prior session survive reload by replicating Firestorm's persistent per-object cache + CRC negotiation, instead of our whole-region-overwrite snapshot.

**Architecture:** OpenSim sends `ObjectUpdateCached` probes carrying `(localId, PseudoCRC)`. Today the server discards the CRC and re-requests everything. We will: (1) decode and carry the CRC end-to-end, (2) forward probes to the client, (3) have the client partition them against a persistent per-object IndexedDB cache keyed by `(regionKey, localId)` with stored CRC, requesting full updates only for misses, and (4) persist each decoded object incrementally (no overwrite) and evict on KillObject.

**Tech Stack:** Bun + TypeScript (server, `server/`), Vue 3 + Vite + IndexedDB (client, `src/`), shared JS protocol (`shared/`). Tests via `vitest`.

**Conventions:** Tabs not spaces. `@/` → `src/`, `@shared/` → `shared/`. Server logs via `slog`. Do NOT commit unless the human asks (project rule); the `git commit` steps below are written but defer to the human.

---

## Step 0 — Empirical confirmation (manual, do FIRST)

The whole protocol depends on OpenSim actually sending us `ObjectUpdateCached` probes.
`encodeRegionHandshakeReply` (`server/lib/lludp-codec.ts:1935`) already sends `Flags=0`
(bit `0x2` clear), and the existing handler at `server/handlers/lludp.ts:577` already logs
`[ObjCached] +N ids enqueued` — so probes are believed to arrive. **Confirm before building:**

- [ ] Run the dev server (`npm run dev:server`) against a populated region, log in, and grep
  its stdout for `[ObjCached]`. If present, probes work → proceed. If absent after ~30s in a
  region with objects, STOP: the handshake/flags path is broken and must be fixed first
  (this plan assumes probes arrive).

---

## File Structure

- `shared/protocol.js` — add `S.OBJ_CACHE_PROBE` (server→client) and `C.OBJ_CACHE_MISS` (client→server).
- `server/lib/lludp-codec.ts` — `decodeObjectUpdateCached` returns `{localId,crc}[]`; add `crc` to `ObjectData` and capture it in `decodeObjectUpdate` + `decodeObjectUpdateCompressed`.
- `server/handlers/lludp.ts` — probe handler forwards `OBJ_CACHE_PROBE`; new `C.OBJ_CACHE_MISS` inbound handler enqueues into `cacheMissPending`.
- `src/lib/probePartition.js` (new) — pure `partitionProbes(probes, crcMap)`.
- `src/lib/objectCache.js` — rewrite to a per-object store with `crc`; new API `objCachePut`/`objCacheGetAll`/`objCacheCrcMap`/`objCacheEvict`.
- `src/composables/useWorldEngine.js` — persist each object on update, handle probes, evict on kill, pre-seed from `objCacheGetAll`.
- Tests: `server/__tests__/objupdate-crc.test.ts`, `src/__tests__/lib/probePartition.test.js`, `src/__tests__/lib/objectCache.test.js`.

---

## Phase 0 — Protocol + CRC decode (server, offline TDD)

### Task 1: Add message types

**Files:**
- Modify: `shared/protocol.js:48` (end of `C` block) and `shared/protocol.js:90` (end of `S` block)

- [ ] **Step 1: Add `C.OBJ_CACHE_MISS`** — inside the `C = { ... }` object, after `AVATAR_PICKER_REQ` (line 47):

```js
	AVATAR_PICKER_REQ: 'avatar_picker_req', // { query, queryId } — AvatarPickerRequest (Low 26) for Add-Friend name search
	OBJ_CACHE_MISS:   'obj_cache_miss',   // { ids:number[] } — client cache lacks/mismatches these probed localIds; request full updates
```

- [ ] **Step 2: Add `S.OBJ_CACHE_PROBE`** — inside the `S = { ... }` object, after `FRIEND_RIGHTS_CHANGED` (line 90):

```js
	FRIEND_RIGHTS_CHANGED:'friend_rights_changed',// { agentId, relatedId, rights } — inbound ChangeUserRights (Low 321)
	OBJ_CACHE_PROBE:      'obj_cache_probe',      // { probes:[{localId,crc}] } — sim's ObjectUpdateCached; client decides hit/miss vs its IDB cache
```

- [ ] **Step 3: Commit**

```bash
git add shared/protocol.js
git commit -m "feat(protocol): add OBJ_CACHE_PROBE / OBJ_CACHE_MISS message types"
```

---

### Task 2: `decodeObjectUpdateCached` returns `{localId, crc}` pairs

**Files:**
- Modify: `server/lib/lludp-codec.ts:411-423`
- Test: `server/__tests__/objupdate-crc.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { decodeObjectUpdateCached } from '../lib/lludp-codec'

function buildCachedPacket(entries: Array<[number, number]>): { buf: Buffer; off: number } {
	// dataOffset points at RegionHandle. Layout: RegionHandle(8) TimeDilation(2) count(1) then
	// per entry: localId(4) crc(4) updateFlags(4) = 12 bytes.
	const buf = Buffer.alloc(8 + 2 + 1 + entries.length * 12)
	let p = 11 // 8 + 2 + 1
	buf[10] = entries.length // count
	for (const [localId, crc] of entries) {
		buf.writeUInt32LE(localId, p); p += 4
		buf.writeUInt32LE(crc, p); p += 4
		buf.writeUInt32LE(0, p); p += 4 // updateFlags
	}
	return { buf, off: 0 }
}

describe('decodeObjectUpdateCached', () => {
	it('returns localId+crc pairs and skips localId 0', () => {
		const { buf, off } = buildCachedPacket([[101, 5555], [0, 9], [202, 6666]])
		expect(decodeObjectUpdateCached(buf, off)).toEqual([
			{ localId: 101, crc: 5555 },
			{ localId: 202, crc: 6666 },
		])
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/objupdate-crc.test.ts`
Expected: FAIL — current function returns `number[]`, not objects.

- [ ] **Step 3: Implement** — replace `server/lib/lludp-codec.ts:411-423`:

```ts
export function decodeObjectUpdateCached(buf: Buffer, dataOffset: number): Array<{ localId: number; crc: number }> {
  const out: Array<{ localId: number; crc: number }> = []
  let off = dataOffset
  off += 8   // RegionHandle U64
  off += 2   // TimeDilation U16
  const count = buf[off++]
  for (let i = 0; i < count && off + 7 < buf.length; i++) {
    const localId = buf.readUInt32LE(off); off += 4
    const crc = buf.readUInt32LE(off); off += 4
    if (localId !== 0) out.push({ localId, crc })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/objupdate-crc.test.ts`
Expected: PASS

> NOTE: this breaks the caller at `server/handlers/lludp.ts:583` (it iterates `ids` as numbers). That caller is rewritten in Task 4; the project may not typecheck cleanly until then — that's expected within this phase.

- [ ] **Step 5: Commit**

```bash
git add server/lib/lludp-codec.ts server/__tests__/objupdate-crc.test.ts
git commit -m "feat(codec): decode CRC from ObjectUpdateCached probes"
```

---

### Task 3: Capture `crc` in full + compressed object updates

**Files:**
- Modify: `server/lib/lludp-codec.ts` — `ObjectData` interface (line 992), `decodeObjectUpdate` (line 1245), `decodeObjectUpdateCompressed` (line 1058)
- Test: `server/__tests__/objupdate-crc.test.ts` (append)

- [ ] **Step 1: Add `crc` to the `ObjectData` interface** — after line 1000 (`parentId?`):

```ts
  parentId?:     number   // U32 — 0=root, else localId of parent prim (linked sets)
  crc?:          number   // U32 PseudoCRC from ObjectUpdate/Compressed — increments on change; used for cache validation
```

- [ ] **Step 2: Capture crc in `decodeObjectUpdate`** — replace `server/lib/lludp-codec.ts:1244-1245`:

```ts
      const fullId   = bytesToUuid(buf, off); off += 16
      const crc      = buf.readUInt32LE(off); off += 4   // PseudoCRC
```

  Then, where the object record is pushed (find the `objects.push({ ... })` for this function), add `crc,` to the pushed object. (Search within `decodeObjectUpdate` for `objects.push(`.)

- [ ] **Step 3: Capture crc in `decodeObjectUpdateCompressed`** — replace `server/lib/lludp-codec.ts:1058`:

```ts
      const crc = buf.readUInt32LE(off); off += 4   // PseudoCRC (was skipped)
```

  Then add `crc,` to this function's `objects.push({ ... })` record.

- [ ] **Step 4: Write the failing test** — append to `server/__tests__/objupdate-crc.test.ts`:

```ts
import { decodeObjectUpdateCompressed } from '../lib/lludp-codec'

describe('decodeObjectUpdateCompressed crc', () => {
	it('surfaces the per-object crc', () => {
		// Minimal compressed entry: UpdateFlags(4) dataLen(2) then >=64 fixed bytes.
		// fullId(16) localId(4) pcode(1) state(1) crc(4) ... — crc at byte 22 of the data block.
		const dataLen = 64
		const buf = Buffer.alloc(8 + 2 + 1 + 4 + 2 + dataLen)
		let p = 0
		buf.writeBigUInt64LE(0n, p); p += 8   // RegionHandle
		buf.writeUInt16LE(0, p); p += 2       // TimeDilation
		buf[p++] = 1                          // count
		buf.writeUInt32LE(0, p); p += 4       // UpdateFlags
		buf.writeUInt16LE(dataLen, p); p += 2 // dataLen
		const dataStart = p
		// fullId 16 bytes (zeros) then localId, pcode, state, crc
		buf.writeUInt32LE(7777, dataStart + 16)      // localId
		buf[dataStart + 20] = 9                       // pcode (prim)
		buf[dataStart + 21] = 0                       // state
		buf.writeUInt32LE(123456, dataStart + 22)     // crc
		const objs = decodeObjectUpdateCompressed(buf, 0)
		expect(objs[0]?.crc).toBe(123456)
	})
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/__tests__/objupdate-crc.test.ts`
Expected: PASS (the crc assertion). If the existing compressed decoder bails early on the all-zero TE, ensure the test packet has the minimum valid fixed block; adjust padding so `dataLen >= 64` and decode reaches the crc read.

- [ ] **Step 6: Regression — full object-update suite still green**

Run: `npx vitest run server/__tests__/full-objupdate-decode.test.ts server/__tests__/compressed-decode.test.ts`
Expected: PASS (crc is additive; offsets unchanged — we replaced `off += 4` skips with reads of the same 4 bytes).

- [ ] **Step 7: Commit**

```bash
git add server/lib/lludp-codec.ts server/__tests__/objupdate-crc.test.ts
git commit -m "feat(codec): surface PseudoCRC on full + compressed object updates"
```

---

## Phase 1 — Retention (server forward + client cache)

### Task 4: Server forwards probes instead of blind-requesting

**Files:**
- Modify: `server/handlers/lludp.ts:577-605`

- [ ] **Step 1: Replace the probe handler body** (`server/handlers/lludp.ts:577-605`):

```ts
	if (type === `high:${HIGH_OBJECT_UPDATE_CACHED}`) {
		// WHY: Sim sends ObjectUpdateCached with (localId, PseudoCRC) when it believes we have
		// objects cached. We forward the probes to the client, which owns the persistent IDB
		// cache and decides hit (CRC match → render from cache, no request) vs miss (→ request
		// full update via C.OBJ_CACHE_MISS, which feeds the existing cacheMissPending drain).
		// Objects already fulfilled this session (server objCache) are dropped — the client
		// already has them rendered.
		try {
			const probes = decodeObjectUpdateCached(buf, dataOffset)
				.filter(p => !session.objCache.has(p.localId))
			if (probes.length > 0) {
				session.ws.send(JSON.stringify({ t: S.OBJ_CACHE_PROBE, d: { probes } }))
				if (!session.loggedTypes.has('objcache')) {
					session.loggedTypes.add('objcache')
					slog.info(session.ws, `[ObjCached] forwarded ${probes.length} probes to client for CRC check`)
				}
			}
		} catch (e) { slog.warn(session.ws, `ObjectUpdateCached decode error: ${(e as Error).message}`) }
		return
	}
```

- [ ] **Step 2: Verify the project still imports `decodeObjectUpdateCached`** (it does, `server/handlers/lludp.ts:9`). No new import needed; `S` is already imported (line 32).

- [ ] **Step 3: Sanity build the server** (no dedicated unit test for the WS push; covered by the live test)

Run: `bun build server/index.ts --target=bun --outfile=/dev/null`
Expected: no type/parse errors.

- [ ] **Step 4: Commit**

```bash
git add server/handlers/lludp.ts
git commit -m "feat(circuit): forward ObjectUpdateCached probes to client for CRC decision"
```

---

### Task 5: Server handles `C.OBJ_CACHE_MISS`

**Files:**
- Modify: `server/handlers/lludp.ts:1224` (after the `C.OBJECT_DESELECT` block)

- [ ] **Step 1: Add the inbound handler** — insert after line 1224 (the closing `}` of the `OBJECT_DESELECT` block):

```ts
	if (msg.t === C.OBJ_CACHE_MISS) {
		// WHY: client checked the forwarded probes against its persistent cache and these
		// localIds are misses (absent or CRC mismatch). Feed the existing paced drain, skipping
		// ids already fulfilled or already queued (same guard the old auto-enqueue used).
		const d = msg.d as { ids: number[] }
		if (!d.ids?.length) return
		let enqueued = 0
		for (const id of d.ids) {
			if (session.objCache.has(id)) continue
			if (session.cacheMissPending.includes(id)) continue
			session.cacheMissPending.push(id)
			enqueued++
		}
		if (enqueued > 0) session.lastCacheEnumAt = Date.now()
		return
	}
```

- [ ] **Step 2: Build the server**

Run: `bun build server/index.ts --target=bun --outfile=/dev/null`
Expected: no errors (`C`, `session.objCache`, `session.cacheMissPending`, `session.lastCacheEnumAt` all already exist).

- [ ] **Step 3: Commit**

```bash
git add server/handlers/lludp.ts
git commit -m "feat(circuit): enqueue client cache-miss ids into RequestMultipleObjects drain"
```

---

### Task 6: Pure `partitionProbes`

**Files:**
- Create: `src/lib/probePartition.js`
- Test: `src/__tests__/lib/probePartition.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { partitionProbes } from '@/lib/probePartition.js'

describe('partitionProbes', () => {
	it('hit when crc matches, miss when absent or differs', () => {
		const crcMap = new Map([[101, 5555], [202, 6666]])
		const probes = [
			{ localId: 101, crc: 5555 },  // hit
			{ localId: 202, crc: 9999 },  // mismatch → miss
			{ localId: 303, crc: 1 },     // absent → miss
		]
		expect(partitionProbes(probes, crcMap)).toEqual({ hits: [101], misses: [202, 303] })
	})

	it('empty crcMap → all miss', () => {
		const probes = [{ localId: 1, crc: 2 }, { localId: 3, crc: 4 }]
		expect(partitionProbes(probes, new Map())).toEqual({ hits: [], misses: [1, 3] })
	})

	it('probe missing crc → miss', () => {
		const crcMap = new Map([[1, 0]])
		expect(partitionProbes([{ localId: 1 }], crcMap)).toEqual({ hits: [], misses: [1] })
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/probePartition.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/lib/probePartition.js`:

```js
// src/lib/probePartition.js — pure decision for ObjectUpdateCached probes.
// WHY: given the sim's (localId, crc) probes and our persistent cache's localId→crc map,
// a probe is a HIT only when we hold that localId AND the stored crc equals the probed crc.
// Anything else (absent, crc differs, probe lacks a crc) is a MISS → request a full update.
// Total + pure: never throws, no I/O — unit-testable and safe to call in hot paths.
export function partitionProbes(probes, crcMap) {
	const hits = []
	const misses = []
	for (const p of probes ?? []) {
		const have = crcMap.get(p.localId)
		if (have !== undefined && p.crc !== undefined && have === p.crc) hits.push(p.localId)
		else misses.push(p.localId)
	}
	return { hits, misses }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/probePartition.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/probePartition.js src/__tests__/lib/probePartition.test.js
git commit -m "feat(cache): pure partitionProbes (CRC hit/miss decision)"
```

---

### Task 7: Rewrite `objectCache.js` to a per-object store

**Files:**
- Modify: `src/lib/objectCache.js` (full rewrite)
- Test: `src/__tests__/lib/objectCache.test.js` (create)

The existing whole-region API (`objCacheLoad`/`objCacheSave`) is replaced. New per-object store
keyed by `[regionKey, localId]`, storing `{ regionKey, localId, fullId, crc, data, savedAt }`.
Bump `DB_VERSION` to 2 and recreate the store (old snapshot format discarded — cache is a
rebuildable optimization).

- [ ] **Step 1: Write the failing test** — uses `fake-indexeddb` (already a dev dep if other IDB tests exist; if not, the test imports it). Create `src/__tests__/lib/objectCache.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
	objCachePut, objCacheGetAll, objCacheCrcMap, objCacheEvict, objCacheClearAll,
} from '@/lib/objectCache.js'

const KEY = '1000_1000'

describe('objectCache per-object store', () => {
	beforeEach(async () => { await objCacheClearAll() })

	it('put then getAll returns the object data; accumulates without shrinking', async () => {
		await objCachePut(KEY, { localId: 1, fullId: 'a', crc: 11, pcode: 9 })
		await objCachePut(KEY, { localId: 2, fullId: 'b', crc: 22, pcode: 9 })
		// A later session that only re-puts ONE object must NOT drop the other (no overwrite).
		await objCachePut(KEY, { localId: 1, fullId: 'a', crc: 99, pcode: 9 })
		const all = await objCacheGetAll(KEY)
		expect(all.length).toBe(2)
		expect(all.find(o => o.localId === 1).crc).toBe(99) // upserted
		expect(all.find(o => o.localId === 2).crc).toBe(22) // retained
	})

	it('crcMap reflects stored crc', async () => {
		await objCachePut(KEY, { localId: 5, fullId: 'e', crc: 555, pcode: 9 })
		const m = await objCacheCrcMap(KEY)
		expect(m.get(5)).toBe(555)
	})

	it('evict removes one object', async () => {
		await objCachePut(KEY, { localId: 7, fullId: 'g', crc: 7, pcode: 9 })
		await objCacheEvict(KEY, 7)
		expect((await objCacheGetAll(KEY)).length).toBe(0)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/objectCache.test.js`
Expected: FAIL — new exports don't exist.

  If the run errors on missing `fake-indexeddb`, install it: `npm i -D fake-indexeddb` (check `package.json` first — other cache tests like a `textureCache` test may already pull it in).

- [ ] **Step 3: Implement** — replace the entire contents of `src/lib/objectCache.js`:

```js
// src/lib/objectCache.js — persistent (IndexedDB) per-object cache, per region.
// WHY: replicate Firestorm's llvocache — accumulate one record PER OBJECT (keyed by
// region + localId) with its PseudoCRC, instead of one whole-region snapshot that gets
// overwritten. On reload we pre-seed the scene from these records (instant paint) and the
// sim's ObjectUpdateCached probes tell us, per object, whether our cached CRC is still
// valid (hit → keep) or stale/missing (miss → re-fetch). Per-object writes mean a session
// that re-sees fewer objects can no longer shrink the persisted set. See partitionProbes.
const DB_NAME    = 'qs-objects'
const DB_VERSION = 2                 // v1 was a whole-region snapshot store; recreated here.
const STORE      = 'objects'         // { regionKey, localId, fullId, crc, data, savedAt }

// Keep at most this many regions cached (LRU by most-recent savedAt per region).
const MAX_REGIONS = 12

let _db = null
function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			// Drop any prior store(s) — old v1 'regions' snapshot format is incompatible.
			for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
			const s = db.createObjectStore(STORE, { keyPath: ['regionKey', 'localId'] })
			s.createIndex('regionKey', 'regionKey')
			s.createIndex('savedAt', 'savedAt')
		}
		req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
		req.onerror   = () => reject(req.error)
	})
}

/** Upsert one object for a region. `obj` must carry localId; fullId/crc optional. */
export async function objCachePut(regionKey, obj, now = Date.now()) {
	if (!regionKey || typeof obj?.localId !== 'number') return
	try {
		// JSON round-trip → plain, structured-cloneable snapshot (obj may be a Vue proxy).
		const data = JSON.parse(JSON.stringify(obj))
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).put({
				regionKey, localId: obj.localId, fullId: obj.fullId ?? null,
				crc: typeof obj.crc === 'number' ? obj.crc : null, data, savedAt: now,
			})
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch (e) { console.warn('[ObjCache] put failed:', e) }
}

/** All cached object `data` records for a region (for pre-seed). */
export async function objCacheGetAll(regionKey) {
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE)
				.index('regionKey').getAll(IDBKeyRange.only(regionKey))
			req.onsuccess = () => resolve((req.result || []).map(r => r.data))
			req.onerror   = () => reject(req.error)
		})
	} catch (e) { console.warn('[ObjCache] getAll failed:', e); return [] }
}

/** Map<localId, crc> for a region (for probe partitioning). Skips entries with null crc. */
export async function objCacheCrcMap(regionKey) {
	const map = new Map()
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE)
				.index('regionKey').openCursor(IDBKeyRange.only(regionKey))
			req.onsuccess = () => {
				const c = req.result
				if (!c) return resolve()
				if (typeof c.value.crc === 'number') map.set(c.value.localId, c.value.crc)
				c.continue()
			}
			req.onerror = () => reject(req.error)
		})
	} catch (e) { console.warn('[ObjCache] crcMap failed:', e) }
	return map
}

/** Remove one object (KillObject / genuine delete). */
export async function objCacheEvict(regionKey, localId) {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).delete([regionKey, localId])
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}

/** Stats for Preferences UI: { regions, objects }. */
export async function getObjectCacheStats() {
	try {
		const db = await openDb()
		const rows = await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
			req.onsuccess = () => resolve(req.result || [])
			req.onerror = () => reject(req.error)
		})
		const regions = new Set(rows.map(r => r.regionKey))
		return { regions: regions.size, objects: rows.length }
	} catch { return { regions: 0, objects: 0 } }
}

/** Evict whole regions beyond MAX_REGIONS, oldest (by newest-object savedAt) first. */
export async function objCachePruneRegions() {
	try {
		const db = await openDb()
		const rows = await new Promise((resolve, reject) => {
			const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
			req.onsuccess = () => resolve(req.result || [])
			req.onerror = () => reject(req.error)
		})
		const newest = new Map() // regionKey → max savedAt
		for (const r of rows) newest.set(r.regionKey, Math.max(newest.get(r.regionKey) ?? 0, r.savedAt))
		const ordered = [...newest.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0])
		const toDrop = ordered.slice(0, Math.max(0, ordered.length - MAX_REGIONS))
		if (!toDrop.length) return
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE).index('regionKey')
			for (const key of toDrop) {
				const cur = st.openKeyCursor(IDBKeyRange.only(key))
				cur.onsuccess = () => { const c = cur.result; if (c) { tx.objectStore(STORE).delete(c.primaryKey); c.continue() } }
			}
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch (e) { console.warn('[ObjCache] prune failed:', e) }
}

/** Clear everything. */
export async function objCacheClearAll() {
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction(STORE, 'readwrite')
			tx.objectStore(STORE).clear()
			tx.oncomplete = resolve
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/objectCache.test.js`
Expected: PASS

- [ ] **Step 5: Fix other importers of the old API** — the old `objCacheLoad`/`objCacheSave`/`objCacheClearRegion` are gone. Find references:

Run: `grep -rn "objCacheLoad\|objCacheSave\|objCacheClearRegion\|getObjectCacheStats" src/`
Expected importers: `src/composables/useWorldEngine.js` (rewired in Task 8) and possibly a Preferences component using `getObjectCacheStats` (still exported — unchanged signature) and `objCacheClearRegion`/`objCacheClearAll` (a "clear object cache" button). If a Prefs component calls `objCacheClearRegion(key)`, repoint it to `objCacheClearAll()` (per-region clear is no longer offered) or add a small region-clear helper. Note the file:line here when found and adjust in this step.

- [ ] **Step 6: Commit**

```bash
git add src/lib/objectCache.js src/__tests__/lib/objectCache.test.js
git commit -m "feat(cache): per-object IDB store with CRC (replaces whole-region snapshot)"
```

---

### Task 8: Wire the engine — persist on update, partition probes, evict on kill, pre-seed

**Files:**
- Modify: `src/composables/useWorldEngine.js` — import (line 21), `loadRegionCache`/`saveRegionCache` (226-266), `onObjectUpdate` (1780-1794), `onKillObject` (2164-2190), handler registration (~2891), teleport/unmount save calls (2098, 2938)

- [ ] **Step 1: Update imports** — replace `src/composables/useWorldEngine.js:21`:

```js
import { objCachePut, objCacheGetAll, objCacheCrcMap, objCacheEvict, objCachePruneRegions } from '@/lib/objectCache.js'
import { partitionProbes } from '@/lib/probePartition.js'
```

- [ ] **Step 2: Replace `loadRegionCache`/`saveRegionCache`** (`src/composables/useWorldEngine.js:236-266`) with a pre-seed loader + per-object persistence. The `regionCacheKey()` helper (lines 229-235) stays unchanged. `_lastObjSaveAt`/`_lastObjSaveCount` (227-228) are removed.

```js
		async function preseedRegionCache() {
			const key = regionCacheKey()
			if (!key || key === _objCacheLoadedKey) return
			_objCacheLoadedKey = key
			const cached = await objCacheGetAll(key)
			if (!cached || !cached.length) return
			let n = 0
			for (const o of cached) {
				if (o.pcode === PCODE_AVATAR || typeof o.localId !== 'number') continue
				if (worldStore.objects.has(o.localId)) continue
				worldStore.upsertObject(o)
				pendingMeshIds.add(o.localId)
				n++
			}
			if (n) debugStore.push('info', `[ObjCache] pre-seeded ${n} cached objects for ${key}`)
			objCachePruneRegions()  // LRU housekeeping (fire-and-forget)
		}
		// WHY: persist each non-avatar object as it arrives/updates. Per-object upsert (no
		// whole-region overwrite) so a session that re-sees fewer objects cannot shrink the
		// cache. Avatars are transient (not cached).
		function persistObjects(objs) {
			const key = regionCacheKey()
			if (!key) return
			for (const o of objs) {
				if (o.pcode === PCODE_AVATAR || typeof o.localId !== 'number') continue
				objCachePut(key, o)
			}
		}
```

- [ ] **Step 3: Add the probe handler** — add this function near `onObjectUpdate` (e.g. after the `onObjectUpdate` definition, before `onKillObject`):

```js
	async function onObjCacheProbe(payload) {
		// WHY: sim's ObjectUpdateCached, forwarded by the server. CRC-match against our
		// persistent cache → hit (already pre-seeded/rendered, no request). Miss → ask server
		// to request a full update (C.OBJ_CACHE_MISS → cacheMissPending drain).
		const probes = payload?.probes ?? []
		if (!probes.length) return
		const key = regionCacheKey()
		if (!key) { wsEmit(C.OBJ_CACHE_MISS, { ids: probes.map(p => p.localId) }); return }
		const crcMap = await objCacheCrcMap(key)
		const { hits, misses } = partitionProbes(probes, crcMap)
		if (misses.length) wsEmit(C.OBJ_CACHE_MISS, { ids: misses })
		if (hits.length) debugStore.push('info', `[ObjCache] ${hits.length} probe hits (cached), ${misses.length} misses requested`)
	}
```

  Ensure `C` is imported in this file (it is — used at `wsEmit(C.OBJECT_SELECT, ...)` line 1840).

- [ ] **Step 4: Call pre-seed + persist from `onObjectUpdate`** — in `src/composables/useWorldEngine.js`, replace line 1786 (`loadRegionCache()`) and the save call at 1794:

  Line 1786 — change `loadRegionCache()` → `preseedRegionCache()`.

  Around line 1791-1794, replace the throttled `saveRegionCache()` with a per-object persist of the just-decoded batch. Add right after `const objs = payload?.objects ?? []` (line 1783):

```js
		const objs = payload?.objects ?? []
		persistObjects(objs)
```

  And DELETE the `saveRegionCache()` call (line 1794) — persistence is now per-object on arrival. (The surrounding 5s diag log block stays.)

- [ ] **Step 5: Evict on kill** — in `onKillObject` (`src/composables/useWorldEngine.js:2176-2180`), add an evict alongside the worldStore removal:

```js
		const key = regionCacheKey()
		const keepOnKill = import.meta.env.VITE_KEEP_CACHE_ON_KILL === 'true'
		for (const id of all) {
			pendingMeshIds.delete(id)  // perf: drop a queued-but-unbuilt mesh
			removeMesh(id)
			worldStore.removeObject(id)
			if (key && !keepOnKill) objCacheEvict(key, id)
		}
```

  WHY the guard: stock OpenSim has `ObjectsCullingByDistance=false`, so KillObject = genuine
  delete → evict. Grids that enable culling can set `VITE_KEEP_CACHE_ON_KILL=true` so a
  cull-kill does not drop the cached object.

- [ ] **Step 6: Register the probe handler** — near the other `on(S.X, ...)` registrations (around line 2891, where `on(S.KILL_OBJECT, onKillObject)` is):

```js
		on(S.OBJ_CACHE_PROBE, onObjCacheProbe)
```

  And in the matching `off(...)` cleanup block (around line 2931):

```js
		off(S.OBJ_CACHE_PROBE, onObjCacheProbe)
```

  Confirm `S` is imported in this file (it is — used in the existing `on(S.KILL_OBJECT, ...)`).

- [ ] **Step 7: Remove stale whole-region save calls** — at the teleport scene-clear (`src/composables/useWorldEngine.js:2098`) and unmount (`:2938`), DELETE the `saveRegionCache(true)` calls. Objects are already persisted incrementally as they arrive, so nothing is lost. Leave `_objCacheLoadedKey = null` at line 2099 (still needed to re-pre-seed the destination region).

- [ ] **Step 8: Build to verify wiring**

Run: `npm run build:staging`
Expected: build succeeds, emits `dist/staging/`. (ESLint is known-broken repo-wide — do NOT rely on `npm run lint`; the Vite build is the gate per project memory.)

- [ ] **Step 9: Run the full client test suite**

Run: `npx vitest run`
Expected: all green, including the new `probePartition` and `objectCache` tests, and no regressions in existing `useWorldEngine`/world tests.

- [ ] **Step 10: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): CRC-gated object cache — persist per-object, probe partition, evict on kill, pre-seed"
```

---

## Phase 2 — Instant render-from-cache on hit (optional, after live verify)

Phase 1 already renders cached objects via `preseedRegionCache` on region enter, so hits need
no extra work for the common reload case. Phase 2 covers the case where the sim probes an
object that was NOT pre-seeded (e.g. it entered the region after our last visit but is in our
cache from a different approach) — explicitly hydrating hits into the scene at probe time.

- [ ] **Step 1:** In `onObjCacheProbe`, for each hit not already in `worldStore`, load its data
  and upsert. Add a cache getter `objCacheGet(regionKey, localId)` to `objectCache.js`
  (single-record `get([regionKey, localId])`), TDD it like Task 7, then in the handler:

```js
		for (const id of hits) {
			if (worldStore.objects.has(id)) continue
			const data = await objCacheGet(key, id)
			if (data) { worldStore.upsertObject(data); pendingMeshIds.add(id) }
		}
```

- [ ] **Step 2:** Commit `feat(render): hydrate probe-hit objects from cache at probe time`.

Defer Phase 2 until live testing shows pre-seed alone leaves gaps.

---

## Live verification (manual, after Phase 1)

- [ ] Restart `npm run dev:server` (bun --watch is unreliable on Windows — restart manually).
- [ ] Log into a heavy region; let it load; reload the browser tab.
- [ ] Confirm: scene repaints immediately from cache (pre-seed), server log shows
  `[ObjCached] forwarded N probes`, client log shows `probe hits (cached)`, and the
  RequestMultipleObjects volume on reload is far lower than a cold load.
- [ ] Walk away and back / relog twice: objects seen before persist (do not disappear).
- [ ] Delete a prim in-world (if you have rights) and relog: it should NOT ghost back
  (evict-on-kill). If it ghosts, the grid likely culls — set `VITE_KEEP_CACHE_ON_KILL` only
  if you confirm culling is on, otherwise investigate.

---

## Self-Review notes

- **Spec coverage:** units 1–5 → Tasks 1–8; CRC reseed accepted (no hardening task, by decision);
  eviction guard `VITE_KEEP_CACHE_ON_KILL` → Task 8 Step 5; pre-seed → Task 8 Step 2; degrade-to-miss
  → `partitionProbes` empty-map test + `onObjCacheProbe` no-key fallback. Step 0 empirical gate present.
- **Naming consistency:** `objCachePut/objCacheGetAll/objCacheCrcMap/objCacheEvict/objCachePruneRegions`,
  `partitionProbes`, `preseedRegionCache`, `persistObjects`, `onObjCacheProbe`, `S.OBJ_CACHE_PROBE`,
  `C.OBJ_CACHE_MISS` — used identically across server, shared, and client tasks.
- **Known follow-ups:** `getObjectCacheStats` return shape unchanged (regions/objects) so the Prefs
  card keeps working; Task 7 Step 5 repoints any `objCacheClearRegion` caller.
