# Instant-Load Geometry Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist worker-baked geometry (the `{position, normal, uv, index, groups}` arrays) in IndexedDB keyed by shape+scale hash, with an in-memory dedup tier, so region re-entry rebuilds geometry from cache instead of re-baking ~10–24k prims.

**Architecture:** Three tiers — (1) in-memory `byteLRU` dedup map (sync hits, no placeholder cube), (2) new `qs-geom` IDB database (drain-aligned batch reads, buffered batch writes, lastUsed-LRU cap), (3) existing worker bake as the miss path, promoting results into tiers 1+2. Spec: `docs/superpowers/specs/2026-06-12-instant-load-geometry-cache-design.md` — read it first.

**Tech Stack:** Vanilla JS (tabs, no TS in src/), IndexedDB, `bun test` + `fake-indexeddb/auto`, existing utils `createByteLRU` / `geometryFromArrays`.

**Repo conventions that apply to every task:** tabs not spaces; `@/` import alias for `src/`; `// WHY:` comments for non-obvious logic; Conventional Commits; do NOT run `npm run lint` (ESLint flat-config broken repo-wide — verify with `bun test` + `npx vite build` instead).

**File map:**

| File | Action | Responsibility |
|---|---|---|
| `src/lib/fnv1a.js` | Create | Pure FNV-1a 32-bit hash over bytes (two-seed use gives 64-bit keys) |
| `src/lib/geomKey.js` | Create | Pure cache-key derivation (prim/mesh/sculpt + scale) |
| `src/lib/primGeometry.js` | Modify | Export `GEOM_VERSION` constant |
| `src/lib/geomCache.js` | Create | `qs-geom` IDB + memory tier + clone-on-hand-out + stats |
| `src/composables/useWorldEngine.js` | Modify | Hit/miss wiring in `upsertMesh`, microtask-batched lookups, telemetry |
| `src/composables/useCacheStats.js` | Modify | Geometry cache card data |
| `src/components/PreferencesFloater.vue` | Modify | Geometry cache card UI |
| `src/__tests__/lib/fnv1a.test.js` | Create | Hash tests |
| `src/__tests__/lib/geomKey.test.js` | Create | Key determinism + per-field sensitivity |
| `src/__tests__/lib/geomCache.test.js` | Create | IDB roundtrip, coalescing, cap eviction, copy-on-hand-out |

---

### Task 1: FNV-1a hash util

**Files:**
- Create: `src/lib/fnv1a.js`
- Test: `src/__tests__/lib/fnv1a.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/lib/fnv1a.test.js
import { describe, it, expect } from 'bun:test'
import { fnv1a32, fnv1aHex64 } from '@/lib/fnv1a.js'

const bytes = (s) => new TextEncoder().encode(s)

describe('fnv1a32', () => {
	it('matches known FNV-1a vectors with the standard offset basis', () => {
		expect(fnv1a32(bytes(''))).toBe(0x811c9dc5)
		expect(fnv1a32(bytes('a'))).toBe(0xe40c292c)
		expect(fnv1a32(bytes('foobar'))).toBe(0xbf9cf968)
	})
	it('is deterministic and input-sensitive', () => {
		const u = new Uint8Array([1, 2, 3, 4])
		expect(fnv1a32(u)).toBe(fnv1a32(new Uint8Array([1, 2, 3, 4])))
		expect(fnv1a32(u)).not.toBe(fnv1a32(new Uint8Array([1, 2, 3, 5])))
	})
	it('a different seed produces an independent hash', () => {
		const u = bytes('hello')
		expect(fnv1a32(u, 0x811c9dc5)).not.toBe(fnv1a32(u, 0xcbf29ce4))
	})
})

describe('fnv1aHex64', () => {
	it('returns 16 lowercase hex chars', () => {
		expect(fnv1aHex64(bytes('hello'))).toMatch(/^[0-9a-f]{16}$/)
	})
	it('differs when any byte differs', () => {
		expect(fnv1aHex64(new Uint8Array([0]))).not.toBe(fnv1aHex64(new Uint8Array([1])))
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/fnv1a.test.js`
Expected: FAIL — `Cannot find module '@/lib/fnv1a.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/fnv1a.js — FNV-1a 32-bit hash over a byte array.
// WHY: cache keys for baked geometry need a fast, dependency-free, deterministic hash.
// Two runs with independent seeds concatenate to a 64-bit hex key (collision odds at
// ~100k distinct shapes are negligible); no cryptographic strength needed.
export function fnv1a32(bytes, seed = 0x811c9dc5) {
	let h = seed >>> 0
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i]
		// h *= 16777619 in 32-bit space, via shifts (avoids Math.imul portability questions: imul is
		// ES6-universal, but the shift form is the canonical public-domain FNV trick and equally fast)
		h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
	}
	return h >>> 0
}

const hex8 = (n) => n.toString(16).padStart(8, '0')

/** 64-bit hex key: standard-basis FNV-1a ∥ alternate-seed FNV-1a over the same bytes. */
export function fnv1aHex64(bytes) {
	return hex8(fnv1a32(bytes, 0x811c9dc5)) + hex8(fnv1a32(bytes, 0xcbf29ce4))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/fnv1a.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/fnv1a.js src/__tests__/lib/fnv1a.test.js
git commit -m "feat(render): fnv1a hash util for geometry cache keys"
```

---

### Task 2: GEOM_VERSION + key derivation

**Files:**
- Modify: `src/lib/primGeometry.js` (top of file, after imports)
- Create: `src/lib/geomKey.js`
- Test: `src/__tests__/lib/geomKey.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/lib/geomKey.test.js
import { describe, it, expect } from 'bun:test'
import { primGeomKey, meshGeomKey, sculptGeomKey, SHAPE_KEY_FIELDS } from '@/lib/geomKey.js'
import { GEOM_VERSION } from '@/lib/primGeometry.js'

const SHAPE = {
	pathCurve: 16, profileCurve: 1, pathBegin: 0, pathEnd: 50000,
	profileBegin: 0, profileEnd: 50000, pathScaleX: 100, pathScaleY: 100,
	pathShearX: 0, pathShearY: 0, pathTwist: 0, pathTwistBegin: 0,
	pathRadiusOffset: 0, pathTaperX: 0, pathTaperY: 0,
	pathRevolutions: 0, pathSkew: 0, profileHollow: 0,
}
const SCALE = [1, 2, 0.5]

describe('primGeomKey', () => {
	it('is deterministic and carries the version + p1 prefix', () => {
		const k = primGeomKey(SHAPE, SCALE)
		expect(k).toBe(primGeomKey({ ...SHAPE }, [...SCALE]))
		expect(k.startsWith(`p1:${GEOM_VERSION}:`)).toBe(true)
	})
	it('keys all 18 shape fields — changing ANY field changes the key', () => {
		expect(SHAPE_KEY_FIELDS.length).toBe(18)
		const base = primGeomKey(SHAPE, SCALE)
		for (const f of SHAPE_KEY_FIELDS) {
			expect(primGeomKey({ ...SHAPE, [f]: (SHAPE[f] || 0) + 1 }, SCALE)).not.toBe(base)
		}
	})
	it('changing any scale component changes the key', () => {
		const base = primGeomKey(SHAPE, SCALE)
		expect(primGeomKey(SHAPE, [1.001, 2, 0.5])).not.toBe(base)
		expect(primGeomKey(SHAPE, [1, 2.001, 0.5])).not.toBe(base)
		expect(primGeomKey(SHAPE, [1, 2, 0.501])).not.toBe(base)
	})
	it('missing/undefined shape fields read as 0 (matches decode defaults)', () => {
		const zeros = Object.fromEntries(SHAPE_KEY_FIELDS.map(f => [f, 0]))
		expect(primGeomKey({}, SCALE)).toBe(primGeomKey(zeros, SCALE))
		expect(primGeomKey(undefined, SCALE)).toBe(primGeomKey(zeros, SCALE))
	})
})

describe('meshGeomKey / sculptGeomKey', () => {
	it('embed asset id, version, and scale hash', () => {
		const k = meshGeomKey('aaaa-bbbb', SCALE)
		expect(k.startsWith(`m1:${GEOM_VERSION}:aaaa-bbbb:`)).toBe(true)
		expect(k).not.toBe(meshGeomKey('aaaa-bbbb', [9, 9, 9]))
		expect(meshGeomKey('xxxx', SCALE)).not.toBe(meshGeomKey('yyyy', SCALE))
	})
	it('sculpt key includes sculptType (type changes decode output)', () => {
		expect(sculptGeomKey('ssss', 1, SCALE)).not.toBe(sculptGeomKey('ssss', 2, SCALE))
		expect(sculptGeomKey('ssss', 1, SCALE).startsWith(`s1:${GEOM_VERSION}:ssss:1:`)).toBe(true)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/geomKey.test.js`
Expected: FAIL — `Cannot find module '@/lib/geomKey.js'`

- [ ] **Step 3: Add GEOM_VERSION to primGeometry.js**

Insert after the `import * as THREE from 'three'` line in `src/lib/primGeometry.js`:

```js
// WHY: cache-buster for the persistent baked-geometry cache (qs-geom). Bump whenever any
// function in this file changes its OUTPUT for the same inputs (new deform support, segment
// count changes, axis-map fixes…). Old entries become unreachable and age out via LRU.
export const GEOM_VERSION = 1
```

- [ ] **Step 4: Write geomKey.js**

```js
// src/lib/geomKey.js — pure cache-key derivation for the baked-geometry cache (qs-geom).
// Key prefixes: p1=prim shape bake, m1=mesh-asset bake, s1=sculpt bake. GEOM_VERSION rides
// in every key so a bake-code change invalidates without migration.
import { fnv1aHex64 } from '@/lib/fnv1a.js'
import { GEOM_VERSION } from '@/lib/primGeometry.js'

// WHY all 18 PrimShape fields (not just the 6 buildPrimGeometry consumes today): when
// hollow/cut/shear deforms land (Phase-3 backlog), shapes differing only in those fields
// must not collide with stale entries baked before the feature existed. Field order is
// FROZEN — reordering changes every key (equivalent to a version bump, but accidental).
export const SHAPE_KEY_FIELDS = [
	'pathCurve', 'profileCurve', 'pathBegin', 'pathEnd', 'profileBegin', 'profileEnd',
	'pathScaleX', 'pathScaleY', 'pathShearX', 'pathShearY', 'pathTwist', 'pathTwistBegin',
	'pathRadiusOffset', 'pathTaperX', 'pathTaperY', 'pathRevolutions', 'pathSkew', 'profileHollow',
]

// WHY Float32: scale arrives as wire Float32; canonicalizing through a Float32Array makes
// the hash immune to Float64 representation noise while staying exact for re-fed values.
function scaleBytes(scale) {
	const f = new Float32Array(3)
	f[0] = scale?.[0] ?? 1; f[1] = scale?.[1] ?? 1; f[2] = scale?.[2] ?? 1
	return new Uint8Array(f.buffer)
}

export function scaleHash(scale) {
	return fnv1aHex64(scaleBytes(scale))
}

export function primGeomKey(shape, scale) {
	// 18 × Int32 fields + 3 × Float32 scale = 84 bytes, hashed as one buffer.
	const buf = new ArrayBuffer(SHAPE_KEY_FIELDS.length * 4 + 12)
	const dv = new DataView(buf)
	for (let i = 0; i < SHAPE_KEY_FIELDS.length; i++) {
		dv.setInt32(i * 4, shape?.[SHAPE_KEY_FIELDS[i]] ?? 0)
	}
	new Uint8Array(buf).set(scaleBytes(scale), SHAPE_KEY_FIELDS.length * 4)
	return `p1:${GEOM_VERSION}:${fnv1aHex64(new Uint8Array(buf))}`
}

export function meshGeomKey(meshId, scale) {
	return `m1:${GEOM_VERSION}:${meshId}:${scaleHash(scale)}`
}

// sculptType is part of the key because getSculpt(sculptId, sculptType) decodes differently
// per type. (Mirror/invert are not passed to the decoder today, so they are not keyed; if
// the decoder grows those params, add them here AND bump GEOM_VERSION.)
export function sculptGeomKey(sculptId, sculptType, scale) {
	return `s1:${GEOM_VERSION}:${sculptId}:${sculptType}:${scaleHash(scale)}`
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/__tests__/lib/geomKey.test.js src/__tests__/lib/primGeometry.test.js`
Expected: PASS (geomKey tests green; primGeometry tests still green after the GEOM_VERSION addition)

- [ ] **Step 6: Commit**

```bash
git add src/lib/geomKey.js src/lib/primGeometry.js src/__tests__/lib/geomKey.test.js
git commit -m "feat(render): geometry cache key derivation (18-field shape + scale hash)"
```

---

### Task 3: geomCache.js — IDB tier

**Files:**
- Create: `src/lib/geomCache.js`
- Test: `src/__tests__/lib/geomCache.test.js`

This module follows three proven in-repo patterns — read them before writing: `src/lib/textureCache.js` (initCacheCap, batched touches, in-txn cap eviction, `_lastStats`), `src/lib/objectCache.js:66-125` (coalescing write buffer), `src/lib/meshCache.js` (meta-store stats).

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/lib/geomCache.test.js
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import {
	resolveGeomCap, geomCacheStore, geomMemGet, geomCacheGetMany, bytesOfArrays,
	getGeomCacheStats, clearGeomCache, geomMemClear, getGeomMemBytes,
	setGeomCapBytes, __flushGeomWritesNow,
} from '@/lib/geomCache.js'

const GB = 1024 ** 3
const mkArrays = (fill = 1, verts = 12) => ({
	position: new Float32Array(verts * 3).fill(fill),
	normal:   new Float32Array(verts * 3).fill(fill),
	uv:       new Float32Array(verts * 2).fill(fill),
	index:    new Uint32Array(verts).fill(fill),
	groups:   [{ start: 0, count: verts, materialIndex: 0 }],
})

describe('resolveGeomCap', () => {
	it('caps at 20% of quota, hard max 2GB, 1GB fallback', () => {
		expect(resolveGeomCap({ quota: 5 * GB })).toBe(1 * GB)
		expect(resolveGeomCap({ quota: 100 * GB })).toBe(2 * GB)   // 20% would be 20GB → clamp
		expect(resolveGeomCap({})).toBe(1 * GB)
		expect(resolveGeomCap(undefined)).toBe(1 * GB)
	})
})

describe('bytesOfArrays', () => {
	it('sums the four typed-array byteLengths', () => {
		const a = mkArrays(1, 10)
		expect(bytesOfArrays(a)).toBe(120 + 120 + 80 + 40)
	})
	it('tolerates missing arrays (uv-less geometry)', () => {
		expect(bytesOfArrays({ position: new Float32Array(3) })).toBe(12)
	})
})

describe('memory tier — clone-on-hand-out invariant', () => {
	it('store returns a copy; mutating it does not corrupt the cached entry', async () => {
		geomMemClear(); await clearGeomCache()
		const handed = geomCacheStore('k1', mkArrays(7))
		handed.position[0] = 999                       // simulate in-place ratio rescale
		expect(geomMemGet('k1').position[0]).toBe(7)   // entry unharmed
	})
	it('geomMemGet returns a fresh copy each time', () => {
		geomMemClear()
		geomCacheStore('k2', mkArrays(3))
		const a = geomMemGet('k2'), b = geomMemGet('k2')
		expect(a.position).not.toBe(b.position)
		a.position[0] = 42
		expect(b.position[0]).toBe(3)
	})
	it('miss returns null; bytes are tracked', () => {
		geomMemClear()
		expect(geomMemGet('nope')).toBeNull()
		geomCacheStore('k3', mkArrays())
		expect(getGeomMemBytes()).toBe(bytesOfArrays(mkArrays()))
	})
})

describe('IDB tier', () => {
	it('roundtrips arrays through the write buffer and getMany, preserving types + groups', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r1', mkArrays(5))
		await __flushGeomWritesNow()
		geomMemClear()                                  // force the IDB path
		const m = await geomCacheGetMany(['r1', 'missing'])
		expect(m.size).toBe(1)
		const a = m.get('r1')
		expect(a.position).toBeInstanceOf(Float32Array)
		expect(a.index).toBeInstanceOf(Uint32Array)
		expect(a.position[0]).toBe(5)
		expect(a.groups).toEqual([{ start: 0, count: 12, materialIndex: 0 }])
	})
	it('getMany promotes hits into the memory tier', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r2', mkArrays(9))
		await __flushGeomWritesNow()
		geomMemClear()
		await geomCacheGetMany(['r2'])
		expect(geomMemGet('r2').position[0]).toBe(9)    // now a sync hit
	})
	it('promotion does not alias the returned arrays', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r3', mkArrays(4))
		await __flushGeomWritesNow()
		geomMemClear()
		const m = await geomCacheGetMany(['r3'])
		m.get('r3').position[0] = 777
		expect(geomMemGet('r3').position[0]).toBe(4)
	})
	it('latest-wins coalescing in the write buffer', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('r4', mkArrays(1))
		geomCacheStore('r4', mkArrays(2))
		await __flushGeomWritesNow()
		geomMemClear()
		const m = await geomCacheGetMany(['r4'])
		expect(m.get('r4').position[0]).toBe(2)
	})
	it('stats reflect flushed entries; clear resets', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('s1', mkArrays())
		await __flushGeomWritesNow()
		const st = await getGeomCacheStats()
		expect(st.count).toBe(1)
		expect(st.bytes).toBe(bytesOfArrays(mkArrays()))
		expect(st.capBytes).toBeGreaterThan(0)
		await clearGeomCache()
		expect((await getGeomCacheStats()).count).toBe(0)
	})
	it('evicts oldest-lastUsed entries when over cap', async () => {
		geomMemClear(); await clearGeomCache()
		const one = bytesOfArrays(mkArrays())
		setGeomCapBytes(Math.floor(one * 2.5))          // room for 2 of 3
		geomCacheStore('old', mkArrays(), 1000)
		await __flushGeomWritesNow()
		geomCacheStore('mid', mkArrays(), 2000)
		await __flushGeomWritesNow()
		geomCacheStore('new', mkArrays(), 3000)
		await __flushGeomWritesNow()
		geomMemClear()
		const m = await geomCacheGetMany(['old', 'mid', 'new'])
		expect(m.has('old')).toBe(false)                // oldest evicted
		expect(m.has('mid')).toBe(true)
		expect(m.has('new')).toBe(true)
		setGeomCapBytes(1 * GB)                          // restore for later tests
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: FAIL — `Cannot find module '@/lib/geomCache.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/geomCache.js — persistent (IndexedDB qs-geom) + in-memory cache of BAKED geometry
// arrays, keyed by shape+scale hash (see geomKey.js). WHY: every session re-baked all region
// geometry (~10-24k prims) — pure waste, since bake output is a deterministic function of the
// key. Re-entry now rebuilds from cache; identical shape+scale prims bake once per session.
// WHY own DB: IDB locking is per-database — qs-tex write storms can never starve these reads
// (texCacheGet measured 3.3-3.7s avg behind texCachePut locks on the shared-DB pattern).
//
// INVARIANT (correctness-critical): a cache entry's arrays are NEVER aliased by any mesh.
// geometryFromArrays wraps without copying and the engine ratio-rescales geometry IN PLACE on
// scale change, so every hand-out is a fresh copy. IDB reads deserialize fresh arrays already;
// the memory tier slices explicitly. See the spec's "Array ownership" section.
import { createByteLRU } from '@/lib/byteLRU.js'

const DB_NAME = 'qs-geom', DB_VERSION = 1, STORE = 'geom', META = 'meta'

// ── Cap (initCacheCap pattern from textureCache.js) ─────────────────────────
export const GEOM_CACHE_MAX_BYTES      = 2 * 1024 * 1024 * 1024
export const GEOM_CACHE_FALLBACK_BYTES = 1 * 1024 * 1024 * 1024
const CAP_FRACTION = 0.2
let _capBytes = GEOM_CACHE_FALLBACK_BYTES

export function resolveGeomCap(estimate, fraction = CAP_FRACTION,
	max = GEOM_CACHE_MAX_BYTES, fallback = GEOM_CACHE_FALLBACK_BYTES) {
	const quota = estimate && typeof estimate.quota === 'number' ? estimate.quota : 0
	return quota > 0 ? Math.min(Math.floor(quota * fraction), max) : fallback
}

/** Test hook + governor escape hatch. */
export function setGeomCapBytes(n) { _capBytes = n }

let _capInit = null
export function initGeomCacheCap() {
	if (_capInit) return _capInit
	_capInit = (async () => {
		try {
			if (navigator.storage?.estimate) _capBytes = resolveGeomCap(await navigator.storage.estimate())
		} catch { /* keep fallback */ }
		console.debug('[GeomCache] cap', Math.round(_capBytes / 1048576) + 'MB')
		return _capBytes
	})()
	return _capInit
}

// ── Shared helpers ───────────────────────────────────────────────────────────
export function bytesOfArrays(a) {
	return (a.position?.byteLength || 0) + (a.normal?.byteLength || 0) +
	       (a.uv?.byteLength || 0) + (a.index?.byteLength || 0)
}

function cloneArrays(a) {
	return {
		position: a.position ? a.position.slice() : undefined,
		normal:   a.normal   ? a.normal.slice()   : undefined,
		uv:       a.uv       ? a.uv.slice()       : undefined,
		index:    a.index    ? a.index.slice()    : undefined,
		groups:   a.groups ? a.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })) : [],
	}
}

// ── Tier 1: in-memory dedup map (byteLRU, cache owns its arrays) ─────────────
const GEOM_MEM_BUDGET = 128 * 1024 * 1024
const _mem = createByteLRU({ budgetBytes: GEOM_MEM_BUDGET, sizeOf: bytesOfArrays })

/** Sync lookup. Returns a fresh COPY of the arrays, or null. */
export function geomMemGet(key) {
	const e = _mem.get(key)
	return e ? cloneArrays(e) : null
}
export function getGeomMemBytes() { return _mem.bytes() }
export function geomMemClear() { _mem.clear() }   // requires the byteLRU.clear() addition below

// ── Tier 2: IndexedDB ────────────────────────────────────────────────────────
let _db = null
let _lastStats = null  // { count, bytes } served from memory (Prefs-starvation lesson)

function openDb() {
	if (_db) return Promise.resolve(_db)
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION)
		req.onupgradeneeded = (e) => {
			const db = e.target.result
			if (!db.objectStoreNames.contains(STORE)) {
				const s = db.createObjectStore(STORE, { keyPath: 'key' })
				s.createIndex('lastUsed', 'lastUsed')
			}
			if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' })
		}
		req.onsuccess = (e) => { _db = e.target.result; initGeomCacheCap(); resolve(_db) }
		req.onerror = () => reject(req.error)
	})
}

// Buffered writes (objectCache writeBuf pattern): one txn per flush window, latest-wins.
// WHY: a cold first visit bakes thousands of geometries in minutes; one readwrite txn each
// would serialize IDB and starve every reader (measured on tex/obj caches).
const FLUSH_MS = 300
const FLUSH_MAX = 200       // geometry records are bigger than object records → lower cap
const _writeBuf = new Map() // key → { key, …arrays, bytes, savedAt, lastUsed }
let _flushTimer = null
let _flushing = null

/**
 * Store baked arrays under `key`. The cache TAKES OWNERSHIP of `arrays`; the caller gets a
 * fresh copy back and must use only that copy (worker-transferred buffers come straight here).
 */
export function geomCacheStore(key, arrays, now = Date.now()) {
	const owned = { position: arrays.position, normal: arrays.normal, uv: arrays.uv, index: arrays.index, groups: arrays.groups || [] }
	_mem.set(key, owned)
	try {
		_writeBuf.set(key, { key, ...owned, bytes: bytesOfArrays(owned), savedAt: now, lastUsed: now })
		_scheduleFlush()
	} catch { /* best-effort persistence; memory tier still works */ }
	return cloneArrays(owned)
}

function _scheduleFlush() {
	if (_writeBuf.size >= FLUSH_MAX) { _flushNow(); return }
	if (_flushTimer) return
	_flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
}

async function _flushNow() {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	if (_flushing) await _flushing
	if (!_writeBuf.size) return
	const batch = [..._writeBuf.values()]
	_writeBuf.clear()
	_flushing = (async () => {
		try {
			const db = await openDb()
			await new Promise((resolve, reject) => {
				const tx = db.transaction([STORE, META], 'readwrite')
				const st = tx.objectStore(STORE)
				const mt = tx.objectStore(META)
				const batchKeys = new Set(batch.map(b => b.key))
				let added = 0
				for (const rec of batch) { st.put(rec); added += rec.bytes }
				let pending = null
				const finishStats = (total) => {
					const cReq = st.count()
					cReq.onsuccess = () => {
						mt.put({ k: 'stats', totalBytes: total, count: cReq.result })
						pending = { count: cReq.result, bytes: total }
					}
				}
				const mreq = mt.get('stats')
				mreq.onsuccess = () => {
					let total = (mreq.result?.totalBytes ?? 0) + added
					if (total <= _capBytes) { finishStats(total); return }
					// Over cap → lastUsed cursor oldest-first; never evict a key just written
					// (textureCache "can't evict itself" rule, extended to the whole batch).
					const cur = st.index('lastUsed').openCursor()
					cur.onsuccess = () => {
						const c = cur.result
						if (!c || total <= _capBytes) { finishStats(total); return }
						if (!batchKeys.has(c.value.key)) { total -= c.value.bytes; c.delete() }
						c.continue()
					}
				}
				tx.oncomplete = () => { if (pending) _lastStats = pending; resolve() }
				tx.onerror = () => reject(tx.error)
			})
		} catch (e) { console.warn('[GeomCache] flush failed:', e) }
	})()
	await _flushing
	_flushing = null
}

/** Test hook: force the write buffer to disk now. */
export async function __flushGeomWritesNow() { await _flushNow() }

// Batched LRU touches (textureCache flushTouches pattern, 10s cadence — reads stay readonly).
const _touchQueue = new Map()
let _touchTimer = null
function _touchLater(key, now) {
	_touchQueue.set(key, now)
	if (_touchTimer) return
	_touchTimer = setTimeout(_flushTouches, 10000)
}
async function _flushTouches() {
	_touchTimer = null
	if (!_touchQueue.size) return
	const batch = [..._touchQueue]; _touchQueue.clear()
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(STORE, 'readwrite')
			const st = tx.objectStore(STORE)
			for (const [key, now] of batch) {
				const g = st.get(key)
				g.onsuccess = () => { const r = g.result; if (r) { r.lastUsed = now; st.put(r) } }
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
		})
	} catch { /* best-effort LRU */ }
}

/**
 * Batch lookup — ONE readonly txn for the whole key list (the drain-tick read). Returns
 * Map<key, arrays>; missing keys are simply absent. Hits are promoted into the memory tier
 * (un-aliased) and LRU-touched. NEVER rejects — IDB failure degrades to an empty Map (all-miss).
 */
export async function geomCacheGetMany(keys, now = Date.now()) {
	const out = new Map()
	if (!keys.length) return out
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(STORE, 'readonly')
			const st = tx.objectStore(STORE)
			for (const key of keys) {
				const g = st.get(key)
				g.onsuccess = () => {
					const r = g.result
					if (!r) return
					const arrays = { position: r.position, normal: r.normal, uv: r.uv, index: r.index, groups: r.groups || [] }
					// IDB deserialization already produced fresh arrays → safe for the mem tier to own;
					// hand the CALLER a clone so promotion and hand-out never alias.
					_mem.set(key, arrays)
					out.set(key, cloneArrays(arrays))
					_touchLater(key, now)
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve   // degrade: whatever resolved before the error still counts
		})
	} catch (e) { console.warn('[GeomCache] getMany failed:', e) }
	return out
}

/** { count, bytes, capBytes } — memory-served after first flush (Prefs pattern). */
export async function getGeomCacheStats() {
	if (_lastStats) return { ..._lastStats, capBytes: _capBytes }
	try {
		const db = await openDb()
		return await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readonly')
			const countReq = tx.objectStore(STORE).count()
			const metaReq = tx.objectStore(META).get('stats')
			let count = 0, bytes = 0
			countReq.onsuccess = () => { count = countReq.result }
			metaReq.onsuccess = () => { bytes = metaReq.result?.totalBytes ?? 0 }
			tx.oncomplete = () => { _lastStats = { count, bytes }; resolve({ count, bytes, capBytes: _capBytes }) }
			tx.onerror = () => reject(tx.error)
		})
	} catch { return { count: 0, bytes: 0, capBytes: _capBytes } }
}

export async function clearGeomCache() {
	_writeBuf.clear()
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).clear()
			tx.objectStore(META).put({ k: 'stats', totalBytes: 0, count: 0 })
			tx.oncomplete = () => { _lastStats = { count: 0, bytes: 0 }; resolve() }
			tx.onerror = () => reject(tx.error)
		})
	} catch { /* ignore */ }
}
```

**Required companion edit:** `createByteLRU` (in `src/lib/byteLRU.js`) exposes no `clear()`. Add one method to its returned object:

```js
		clear() { map.clear(); bytes = 0 },
```

Add one test to `src/__tests__/lib/byteLRU.test.js`:

```js
it('clear() empties the map and resets bytes', () => {
	const lru = createByteLRU({ budgetBytes: 100, sizeOf: () => 10 })
	lru.set('a', 1); lru.set('b', 2)
	lru.clear()
	expect(lru.size()).toBe(0)
	expect(lru.bytes()).toBe(0)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/lib/geomCache.test.js src/__tests__/lib/byteLRU.test.js`
Expected: PASS. If the cap-eviction test is flaky on ordering, confirm the three stores flushed in three separate txns (each `__flushGeomWritesNow()` awaited) so `lastUsed` values 1000/2000/3000 actually persist distinctly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geomCache.js src/lib/byteLRU.js src/__tests__/lib/geomCache.test.js src/__tests__/lib/byteLRU.test.js
git commit -m "feat(render): qs-geom baked-geometry cache (IDB + memory dedup tier)"
```

---

### Task 4: Engine wiring — hit/miss paths in upsertMesh + microtask-batched lookups

**Files:**
- Modify: `src/composables/useWorldEngine.js` (imports ~line 1-60; `upsertMesh` isNew block ~lines 1638-1788; counters near `_applyN`; mount init near `initCacheCap` usage if present, else near `_meshDrainTimer` setup ~line 3598)

No new unit test file — this is wiring into a 3700-line composable with no existing test harness; correctness is covered by the geomCache/geomKey unit tests plus the live-verify task. Keep each edit minimal and surgical.

- [ ] **Step 1: Add imports**

Near the existing `primGeometry.js` imports at the top of `useWorldEngine.js` (it already imports `bakePrimScale`, `geometryFromArrays`, `geometryHasFiniteVerts`):

```js
import { geomMemGet, geomCacheGetMany, geomCacheStore, getGeomMemBytes, initGeomCacheCap } from '@/lib/geomCache.js'
import { primGeomKey, meshGeomKey, sculptGeomKey } from '@/lib/geomKey.js'
```

- [ ] **Step 2: Add counters + the batched-lookup dispatcher**

Next to the existing `_applyN/_applyMs/_applyMaxMs` declarations:

```js
// Geometry-cache telemetry (reported + reset by the 5s [Bake] line)
let _geomHitMem = 0, _geomHitIdb = 0, _geomMiss = 0

// WHY microtask batching: every requestGeometry() call within one synchronous burst (one
// drainMeshQueue tick, one evict re-stream pass…) coalesces into ONE qs-geom readonly txn —
// the per-prim-transaction storm is the exact pattern that starved texCacheGet. Same trick
// as useMeshBaker's flush.
let _geomLookupBatch = []
function requestGeometry(key, jobThunk, applySwap) {
	_geomLookupBatch.push({ key, jobThunk, applySwap })
	if (_geomLookupBatch.length === 1) queueMicrotask(_flushGeomLookups)
}
function _flushGeomLookups() {
	if (!_geomLookupBatch.length) return
	const batch = _geomLookupBatch
	_geomLookupBatch = []
	geomCacheGetMany(batch.map(b => b.key)).then(hits => {
		for (const b of batch) {
			const arrays = hits.get(b.key)
			if (arrays) { _geomHitIdb++; b.applySwap(arrays); continue }
			_geomMiss++
			b.jobThunk().then(out => {
				if (!out || out.bad) { b.applySwap(out); return }
				// Store FIRST (cache takes ownership of the worker-transferred buffers), swap the
				// returned copy — applySwap may ratio-rescale in place, which must never touch the entry.
				b.applySwap(geomCacheStore(b.key, out))
			})
		}
	})
}
```

- [ ] **Step 3: Tier-1 sync hit replaces the placeholder cube**

In `upsertMesh`'s `isNew` block (currently ~line 1638), the placeholder geometry creation reads:

```js
let geo = isAvatar
	? new THREE.CapsuleGeometry(0.33, 0.96, 4, 8)
	: bakePrimScale(new THREE.BoxGeometry(1, 1, 1), obj.scale)
```

Replace with (note: this moves the `bakeScale` snapshot up from ~line 1714 — delete the old `const bakeScale = ...` line there):

```js
// Geometry cache: a tier-1 (memory) hit means the FINAL baked geometry is available
// synchronously — build with it directly, no placeholder cube, no bake dispatch.
// bakeScale snapshot moved up here: the cache key needs it before geometry creation.
const bakeScale = obj.scale ? obj.scale.slice() : [1, 1, 1]
const geomKey = (isAvatar || obj._placeholder) ? null
	: obj.meshId   ? meshGeomKey(obj.meshId, bakeScale)
	: obj.sculptId ? sculptGeomKey(obj.sculptId, obj.sculptType ?? 1, bakeScale)
	: primGeomKey(obj.shape, bakeScale)
const cachedArrays = geomKey ? geomMemGet(geomKey) : null
if (cachedArrays) _geomHitMem++
let geo = isAvatar
	? new THREE.CapsuleGeometry(0.33, 0.96, 4, 8)
	: cachedArrays
		? geometryFromArrays(cachedArrays)
		: bakePrimScale(new THREE.BoxGeometry(1, 1, 1), obj.scale)
```

The existing NaN guard, material creation, and `computeVertexNormals`-if-lit lines that follow operate on `geo` and need no change (cached arrays always carry normals — both bake paths produce them).

- [ ] **Step 4: Extract applySwap's finishing tail and reuse it**

Inside `applySwap` (~lines 1746-1753), the post-swap finishing currently reads:

```js
	// Planar texgen: regenerate UVs for planar faces now the final scaled geometry exists
	// (applies to single- and multi-material objects alike — UVs live on the geometry).
	const faceMap = obj.meshId ? null : primFaceMap(obj.shape)
	applyPlanarUVs(mesh, obj, faceMap)
	// Mesh per-face: now the grouped geometry exists, replace the single material with a
	// per-submesh material array (each face's texture + tint). Only for multi-textured meshes.
	if (meshMulti) buildFaceMaterials(mesh, obj)
	else if (primMulti) buildFaceMaterials(mesh, obj, faceMap)
```

Extract it into a sibling closure defined just ABOVE `applySwap` (same captured scope), and call it from `applySwap`'s tail:

```js
// Post-geometry finishing shared by the hot-swap path and the sync cache-hit path:
// planar-face UV regen + per-face material array (both need the final grouped geometry).
const finishGeom = () => {
	const faceMap = obj.meshId ? null : primFaceMap(obj.shape)
	applyPlanarUVs(mesh, obj, faceMap)
	if (meshMulti) buildFaceMaterials(mesh, obj)
	else if (primMulti) buildFaceMaterials(mesh, obj, faceMap)
}
```

…and in `applySwap`, replace those extracted lines with `finishGeom()`. (The `_applyN++` timing lines stay in `applySwap` unchanged.)

`finishGeom` references `mesh`, which is assigned a few lines later (`mesh = new THREE.Mesh(geo, mat)`) — that's fine for closures, but BOTH definitions must sit textually before the dispatch block in Step 5 executes them. `applySwap`/`finishGeom` are only ever invoked after `mesh` exists.

- [ ] **Step 5: Replace the three bake dispatches with cache-aware dispatch**

The current dispatch block (~lines 1775-1788):

```js
		if (!isAvatar && !obj._placeholder && obj.meshId) {
			getMesh(obj.meshId).then(subs => {
				if (!subs || !subs.length) return
				return meshBaker.bake({ kind: 'submesh', subs: plainSubs(subs), scale: bakeScale }).then(applySwap)
			})
		} else if (!isAvatar && !obj._placeholder && obj.sculptId) {
			getSculpt(obj.sculptId, obj.sculptType ?? 1).then(subs => {
				if (!subs || !subs.length) return
				return meshBaker.bake({ kind: 'submesh', subs: plainSubs(subs), scale: bakeScale }).then(applySwap)
			})
		} else if (!isAvatar && !obj._placeholder) {
			// plain prim shape → bake the real geometry off-thread, swap over the placeholder cube
			meshBaker.bake({ kind: 'prim', shape: plainShape, scale: bakeScale }).then(applySwap)
		}
```

Replace with:

```js
		if (!isAvatar && !obj._placeholder) {
			if (cachedArrays) {
				// Tier-1 hit: geometry is already final (created in Step 3) — run only the
				// post-swap finishing. Mesh/sculpt hits never even fetch the raw asset.
				finishGeom()
			} else {
				// Miss path, deferred behind one batched qs-geom lookup (an IDB hit swaps like a
				// worker result; a true miss runs this thunk → bake → persist).
				// WHY thunk: a mesh/sculpt cache hit must skip getMesh/getSculpt entirely — the
				// raw-submesh fetch only happens when the baked cache truly misses.
				const jobThunk = obj.meshId
					? () => getMesh(obj.meshId).then(subs =>
						(subs && subs.length) ? meshBaker.bake({ kind: 'submesh', subs: plainSubs(subs), scale: bakeScale }) : null)
					: obj.sculptId
						? () => getSculpt(obj.sculptId, obj.sculptType ?? 1).then(subs =>
							(subs && subs.length) ? meshBaker.bake({ kind: 'submesh', subs: plainSubs(subs), scale: bakeScale }) : null)
						: () => meshBaker.bake({ kind: 'prim', shape: plainShape, scale: bakeScale })
				requestGeometry(geomKey, jobThunk, applySwap)
			}
		}
```

The `plainSubs`/`plainShape` definitions (~lines 1763-1773) stay exactly where they are — they're still used by the thunks.

- [ ] **Step 6: Init the cap on mount**

In `onMounted`/startup where `_meshDrainTimer` is created (~line 3598), add one line before the interval setup:

```js
	initGeomCacheCap()
```

- [ ] **Step 7: Build check**

Run: `npx vite build --mode staging`
Expected: build succeeds, no unresolved imports. (Behavioral verification is Task 6 — don't claim the wiring works yet.)

- [ ] **Step 8: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(render): geometry cache hit/miss wiring in upsertMesh (sync mem hits skip placeholder; batched IDB lookups; bakes persist)"
```

---

### Task 5: Telemetry + Prefs cache card

**Files:**
- Modify: `src/composables/useWorldEngine.js` (the 3s `_assetStatsTimer` block, ~lines 3611-3680)
- Modify: `src/composables/useCacheStats.js`
- Modify: `src/components/PreferencesFloater.vue` (after the Mesh Cache card, ~line 621)

- [ ] **Step 1: [Mem] line + governor accounting**

In the `_assetStatsTimer` callback (~line 3630), the app-byte sum and [Mem] line read:

```js
			const texB = getTextureBytes(), meshB = getMeshBytes()
			setAppBytes(texB + meshB + geomB)
```

Change to (tier-1 cache bytes are OUR resident bytes — the governor must see them):

```js
			const texB = getTextureBytes(), meshB = getMeshBytes(), geomCacheB = getGeomMemBytes()
			setAppBytes(texB + meshB + geomB + geomCacheB)
```

And in the `line` template (~line 3637-3639), extend the resident breakdown segment:

```js
				const line = `[Mem] app ${mb(texB + meshB + geomB + geomCacheB)}/${mb(appBudgetBytes())}MB (${(appRatio() * 100).toFixed(0)}%) ${heapSeg}` +
					`${pressure ? ' ⚠THROTTLING' : ''} | texMB=${mb(texB)} meshCacheMB=${mb(meshB)} geomMB=${mb(geomB)} geomCacheMB=${mb(geomCacheB)}` +
					` | tex q=${t.queued} cache=${t.cached} | mesh q=${m.queued} cache=${m.cached} | objs=${meshMap.size} evicted=${evicted.size} buildQ=${pendingMeshIds.size}`
```

- [ ] **Step 2: [Bake] line hit/miss counters**

The [Bake] block (~lines 3667-3673) becomes:

```js
			// Where bake time actually goes: worker-side geometry ms vs main-thread applySwap ms,
			// plus how much baking the geometry cache AVOIDED (hit=mem+idb vs miss=real bakes).
			const bs = meshBaker.takeStats()
			if (bs.jobs || _applyN || _geomHitMem || _geomHitIdb) {
				const bline = `[Bake] worker jobs=${bs.jobs} batches=${bs.batches} bakeMs=${bs.bakeMs.toFixed(0)} (avg ${(bs.jobs ? bs.bakeMs / bs.jobs : 0).toFixed(1)}ms/job) | apply n=${_applyN} avg=${(_applyN ? _applyMs / _applyN : 0).toFixed(1)}ms max=${_applyMaxMs.toFixed(1)}ms | outstanding=${meshBaker.outstanding()}` +
					` | geomCache hit=${_geomHitMem + _geomHitIdb} (mem=${_geomHitMem} idb=${_geomHitIdb}) miss=${_geomMiss}`
				debugStore.push('info', bline)
				try { wsEmit(C.CLIENT_LOG, { level: 'info', msg: bline, stack: '' }) } catch { /* ignore */ }
				_applyN = 0; _applyMs = 0; _applyMaxMs = 0
				_geomHitMem = 0; _geomHitIdb = 0; _geomMiss = 0
			}
```

- [ ] **Step 3: useCacheStats geometry card data**

In `src/composables/useCacheStats.js`, add the import, ref, load, clear, and returns (mirror the mesh entries exactly):

```js
import { getGeomCacheStats, clearGeomCache } from '@/lib/geomCache.js'
```

```js
	const geomStats = ref({ count: 0, bytes: 0, capBytes: 0, loading: false, unavailable: false })
```

In `refresh()` add: `load(getGeomCacheStats, geomStats)`
Add: `async function clearGeom() { await clearGeomCache(); await load(getGeomCacheStats, geomStats) }`
Extend the return: `return { texStats, meshStats, objStats, geomStats, refresh, clearTex, clearMesh, clearObj, clearGeom }`

- [ ] **Step 4: PreferencesFloater card**

Insert after the Mesh Cache card's closing `</div>` (~line 621), matching the existing card markup exactly:

```html
						<!-- Geometry Cache (baked shape+scale geometry — instant region re-entry) -->
						<div class="pf-cache-card">
							<div class="pf-cache-header">
								<span class="pf-cache-title">Geometry Cache</span>
								<button class="qs-btn ui-btn flex flex-col font-bold text-xs px-3 py-1" @click="cache.clearGeom()" :disabled="cache.geomStats.value.loading">
									Clear Geometry
									<small class="font-normal">(forces full re-bake)</small>
								</button>
							</div>
							<div class="pf-cache-stats">
								<template v-if="cache.geomStats.value.loading">
									<span class="pf-cache-stat text-tm">Loading…</span>
								</template>
								<template v-else-if="cache.geomStats.value.unavailable">
									<span class="pf-cache-stat text-tm">Unavailable</span>
								</template>
								<template v-else>
									<span class="pf-cache-stat">
										<span class="pf-cache-label">Entries</span>
										<span class="pf-cache-val">{{ cache.geomStats.value.count.toLocaleString() }}</span>
									</span>
									<span class="pf-cache-sep">·</span>
									<span class="pf-cache-stat">
										<span class="pf-cache-label">Size</span>
										<span class="pf-cache-val">{{ formatBytes(cache.geomStats.value.bytes) }}</span>
									</span>
								</template>
							</div>
						</div>
```

- [ ] **Step 5: Build + full test sweep**

Run: `bun test && npx vite build --mode staging`
Expected: all tests PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useWorldEngine.js src/composables/useCacheStats.js src/components/PreferencesFloater.vue
git commit -m "feat(render): geometry-cache telemetry ([Bake]/[Mem]) + Prefs cache card"
```

---

### Task 6: Live verification (before/after metric)

No code. Run the app and verify against the spec's success metric. Per `dev-environment` memory: Vite is on port **5174**; Bun WS server runs as a tracked background task on 8787; **bun --watch hot-restarts on server edits and drops the user's circuit** — no server files change in this plan, so don't touch `server/`.

- [ ] **Step 1: Cold baseline** — log in to a dense region (La Isla Bonita) with Geometry Cache cleared (Prefs ▸ Network ▸ Clear Geometry). Capture from the client debug panel: `[Drain] built (N/s)`, `[Bake] geomCache hit/miss` (expect hit≈0 on first load, mem hits > 0 from intra-region duplicate shapes), `[Mem] geomCacheMB`, time until buildQ=0.

- [ ] **Step 2: Warm re-entry** — reload the tab, same region. Expect: `[Bake] geomCache hit` dominated by idb+mem, `miss` near zero (only never-seen shapes), `[Drain] built (N/s)` substantially higher than baseline, placeholder-cube flash visibly reduced, faster time-to-fully-rendered. Capture the same numbers.

- [ ] **Step 3: Texture cross-check** — on the warm load, read `JSON.stringify(__texStats())` from the console (NEVER `await import(...)` — it creates a second zero-counter module instance). Compare per-leg timing (qWait/idb/net/srv) vs the 2026-06-12 baseline in memory: texture legs should be less starved now that geometry isn't saturating the main thread. **If the texture queue still fully stalls, that confirms the separate stall bug — record it, don't chase it in this branch.**

- [ ] **Step 4: Prefs panel** — Geometry Cache card shows non-zero Entries/Size; Clear Geometry empties it; next reload rebuilds via misses (no errors).

- [ ] **Step 5: Report** — paste before/after `[Drain]`/`[Bake]` lines to Gene with the commit-ready summary. **Do NOT commit anything beyond the task commits above; Gene commits after live verification per repo workflow.**

---

## Self-review notes (already applied)

- Spec coverage: tiers 1/2/3 (Tasks 3-4), keying incl. 18 fields + GEOM_VERSION (Task 2), drain-aligned batching via microtask coalescing (Task 4 Step 2 — covers drain ticks AND evict re-stream), mesh/sculpt skip-raw-read (Task 4 Step 5 thunk), array-ownership invariant (Task 3 tests + store-first-swap-copy in Task 4 Step 2), degrade paths (geomCacheGetMany never rejects), telemetry (Task 5), cap/LRU/touches (Task 3), Prefs row (Task 5), live verify incl. texture cross-check (Task 6).
- Known deviation from spec wording: spec says "one batch read per drain tick"; implementation batches per synchronous burst via microtask — same transaction count for drain ticks, strictly better for non-drain call sites.
- `geomMemClear` requires the small `byteLRU.clear()` addition — included in Task 3 with its own test.
