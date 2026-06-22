# Warm-Region Geometry Rebuild (Approach A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make warm-region re-entry rebuild from the RAM-resident geometry working set instead of re-baking, by having the cache worker's batch read serve from its in-memory tier before touching IndexedDB — and label the load badge accurately (rebuilding-from-cache vs downloading).

**Architecture:** The geom cache worker (`geomCacheCore.js`) already holds a large (auto-sized ~768 MB) in-memory tier `_mem` and a manifest prefetch that warms it on region entry — but `geomCacheGetMany` (the drain's read path) **never reads `_mem`**; it always issues IDB `get`s, which starve under main-thread saturation (`idb=0` → re-bake spiral). The keystone fix is one change: serve `_mem` hits first, IDB only for misses. Then surface a warm/cold + bake-vs-download signal so the badge reads truthfully.

**Tech Stack:** Vue 3 SPA, Web Worker (`cacheIO.worker.js`), IndexedDB (`qs-geom`), byteLRU mem tier, `bun:test` + `fake-indexeddb`, Vite build.

**Verification bar (live, the real test):** on a warm Aspen reload in `server-watch.log`, geom `miss`→~0, `[Drain] queued` collapses in seconds, `near=` climbs off ~22 m unaided, badge reads "Rebuilding from cache" briefly then clears. (Owner: Gene drives the client; Claude owns the Bun server + log.)

---

## Task 1 (KEYSTONE): Worker mem tier serves batch reads

**Why:** `geomCacheGetMany` opens an IDB readonly txn and `st.get(key)`s every key — it never consults `_mem`. So the manifest prefetch (which warms `_mem`) and IDB-hit promotion (`_mem.set` on hit) are **dead weight on the read path**, and every warm read is an IDB read that can starve. Serving `_mem` first turns the prefetched working set into the actual warm-serving tier — Approach A's whole point.

**Files:**
- Modify: `src/lib/geomCacheCore.js:437-475` (`geomCacheGetMany`)
- Test: `src/__tests__/lib/geomCacheCore.warm.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/geomCacheCore.warm.test.js`. These import the **core** directly (not the
`geomCache.js` client) so the client's own L1 can't mask the core behavior:

```js
// src/__tests__/lib/geomCacheCore.warm.test.js
// Approach A keystone: geomCacheGetMany must serve the in-memory tier (_mem) BEFORE IndexedDB, so a
// warm working set (prefetch / promotion) is returned from RAM and the starvation-prone IDB read is
// only used for genuine mem misses. Tests hit the core module directly to bypass the client L1.
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'bun:test'
import {
	geomCacheStore, geomCacheGetMany, geomMemClear, geomMemGet,
	clearGeomCache, __flushGeomWritesNow, setGeomCapBytes,
} from '@/lib/geomCacheCore.js'

const mkArrays = (fill = 1, verts = 12) => ({
	position: new Float32Array(verts * 3).fill(fill),
	normal:   new Float32Array(verts * 3).fill(fill),
	uv:       new Float32Array(verts * 2).fill(fill),
	index:    new Uint32Array(verts).fill(fill),
	groups:   [{ start: 0, count: verts, materialIndex: 0 }],
})

describe('geomCacheGetMany serves the mem tier before IDB (Approach A keystone)', () => {
	it('returns a mem-tier entry that was NEVER flushed to IDB', async () => {
		geomMemClear(); await clearGeomCache(); setGeomCapBytes(1024 ** 3)
		geomCacheStore('warm1', mkArrays(7))     // populates _mem AND the write buffer — but we do NOT flush
		// IDB has no 'warm1' yet. Before the fix this MISSES (empty Map); after the fix it hits from _mem.
		const m = await geomCacheGetMany(['warm1'])
		expect(m.has('warm1')).toBe(true)
		expect(m.get('warm1').position[0]).toBe(7)
	})

	it('mem hit does not alias the cached entry (clone-on-hand-out invariant)', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('warm2', mkArrays(4))
		const m = await geomCacheGetMany(['warm2'])
		m.get('warm2').position[0] = 999
		expect(geomMemGet('warm2').position[0]).toBe(4)   // entry unharmed
	})

	it('mixed batch: one mem hit + one IDB-only hit both returned', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('idbOnly', mkArrays(5))
		await __flushGeomWritesNow()      // 'idbOnly' is now in IDB
		geomMemClear()                    // drop it from _mem → it must come from IDB
		geomCacheStore('memOnly', mkArrays(8))   // in _mem only (unflushed)
		const m = await geomCacheGetMany(['memOnly', 'idbOnly'])
		expect(m.get('memOnly').position[0]).toBe(8)   // from mem
		expect(m.get('idbOnly').position[0]).toBe(5)   // from IDB
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/geomCacheCore.warm.test.js`
Expected: FAIL — first test gets an empty Map (`m.has('warm1')` is `false`) because the current
`geomCacheGetMany` only reads IDB, where `warm1` was never flushed.

- [ ] **Step 3: Implement the mem-first read**

In `src/lib/geomCacheCore.js`, replace the body of `geomCacheGetMany` (lines 437-475) with this. The
only change is the new mem-first pass + iterating `misses` instead of `keys` in the IDB loop; the IDB
`onsuccess` body, validation, promotion, and resolve handlers are unchanged:

```js
export async function geomCacheGetMany(keys, now = Date.now()) {
	const out = new Map()
	if (!keys.length) return out
	// Approach A keystone: serve the in-memory tier FIRST. The warm-region working set (manifest
	// prefetch + IDB-hit promotion) lives in _mem, so a warm revisit returns from RAM and never issues
	// the IDB read that starves under main-thread saturation (idb=0 → re-bake spiral). Only true mem
	// misses fall through to IDB. _mem.get touches LRU recency, so the actively-read warm set stays hot
	// and in-session bakes evict genuinely-cold entries instead — no explicit pinning needed.
	const misses = []
	for (const key of keys) {
		const e = _mem.get(key)
		if (e) { out.set(key, cloneArrays(e)); _touchLater(key, now) }
		else misses.push(key)
	}
	if (!misses.length) return out
	_readsInFlight++   // read-priority gate (see _flushNow); always paired with the finally below
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(STORE, 'readonly')
			const st = tx.objectStore(STORE)
			for (const key of misses) {
				const g = st.get(key)
				g.onsuccess = () => {
					const r = g.result
					if (!r) return
					const arrays = { position: r.position, normal: r.normal, uv: r.uv, index: r.index, groups: r.groups || [] }
					if (!validArrays(arrays)) { geomCacheEvict(key); return }
					_mem.set(key, arrays)
					out.set(key, cloneArrays(arrays))
					_touchLater(key, now)
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve
		})
	} catch (e) { console.warn('[GeomCache] getMany failed:', e) }
	finally { _readsInFlight-- }
	return out
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `bun test src/__tests__/lib/geomCacheCore.warm.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing geom cache suite to confirm no regressions**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: PASS — every existing test that exercises the IDB path calls `geomMemClear()` first, so the
mem-first pass is a miss there and behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/geomCacheCore.js src/__tests__/lib/geomCacheCore.warm.test.js
git commit -m "fix(cache): geom getMany serves mem tier before IDB"
```

---

## Task 2: Warmth signal from manifest prefetch

**Why:** The badge needs to say "Rebuilding from cache" (warm) vs "Building scene" (cold). The cheapest
truthful signal is "did this region have a persisted manifest at entry?" — i.e. did prefetch warm any
keys. Make prefetch report that count up the worker boundary so the engine can set a `_regionWarm` flag.

**Files:**
- Modify: `src/lib/geomCacheCore.js:518-533` (`geomManifestPrefetch`)
- Modify: `src/workers/cacheIO.worker.js:27`
- Modify: `src/lib/geomCache.js:98-103` (`geomManifestPrefetch`)
- Test: `src/__tests__/lib/geomCacheCore.warm.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/lib/geomCacheCore.warm.test.js`:

```js
import { geomManifestRecord, geomManifestPrefetch } from '@/lib/geomCacheCore.js'

describe('geomManifestPrefetch reports how many keys it warmed', () => {
	it('returns the warmed key count for a known region', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('wm1', mkArrays(1)); geomCacheStore('wm2', mkArrays(2))
		await __flushGeomWritesNow()
		await geomManifestRecord('warm-region', ['wm1', 'wm2'])
		geomMemClear()
		const n = await geomManifestPrefetch('warm-region')
		expect(n).toBe(2)
	})
	it('returns 0 for an unknown (cold) region', async () => {
		geomMemClear(); await clearGeomCache()
		const n = await geomManifestPrefetch('never-seen')
		expect(n).toBe(0)
	})
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/geomCacheCore.warm.test.js`
Expected: FAIL — `geomManifestPrefetch` currently returns `undefined`, so `expect(n).toBe(2)` fails.

- [ ] **Step 3: Implement — core returns the warmed count**

In `src/lib/geomCacheCore.js`, change `geomManifestPrefetch` (lines 518-533) to return the count:

```js
export async function geomManifestPrefetch(regionKey) {
	if (!regionKey) return 0
	let keys = null
	try {
		const db = await openDb()
		keys = await new Promise((resolve) => {
			const tx = db.transaction(META, 'readonly')
			const g = tx.objectStore(META).get(`manifest:${regionKey}`)
			g.onsuccess = () => resolve(g.result?.keys || null)
			tx.onerror = () => resolve(null)
			tx.onabort = () => resolve(null)
		})
	} catch { return 0 }
	// getMany promotes hits into the mem tier (the point); the returned Map is discarded.
	if (keys?.length) { await geomCacheGetMany(keys); return keys.length }
	return 0
}
```

- [ ] **Step 4: Propagate the count through the worker**

In `src/workers/cacheIO.worker.js`, change the `geomManifestPrefetch` case (line 27) to return `warmed`:

```js
			case 'geomManifestPrefetch': { const warmed = await geom.geomManifestPrefetch(e.data.regionKey); self.postMessage({ id, warmed }); break }
```

- [ ] **Step 5: Propagate the count through the client**

In `src/lib/geomCache.js`, change `geomManifestPrefetch` (lines 98-103) to resolve a number on both paths:

```js
export async function geomManifestPrefetch(regionKey) {
	if (_useWorker()) {
		const r = await useCacheIO().request({ op: 'geomManifestPrefetch', regionKey }, [], () => core.geomManifestPrefetch(regionKey))
		return (typeof r === 'number') ? r : (r?.warmed ?? 0)
	}
	// No-worker fallback: read manifest keys via core then prefetch into _l1 via client's geomCacheGetMany
	const keys = await core.geomManifestGetKeys(regionKey)
	if (keys?.length) { await geomCacheGetMany(keys); return keys.length }
	return 0
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/__tests__/lib/geomCacheCore.warm.test.js src/__tests__/lib/geomCache.test.js`
Expected: PASS — new warmth tests pass; existing manifest tests (which ignore the return value) still pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/geomCacheCore.js src/workers/cacheIO.worker.js src/lib/geomCache.js src/__tests__/lib/geomCacheCore.warm.test.js
git commit -m "feat(cache): prefetch reports warmed key count"
```

---

## Task 3: loadBadge — bake-vs-download + warm-vs-cold labels (pure)

**Why:** "Objects N downloading" is misleading when the real wait is CPU baking. Add a bake branch and a
warm variant. The new fields default to `0`/`false`, so **all existing loadBadge tests stay green**
unchanged — only new branches add behavior.

**Files:**
- Modify: `src/lib/loadBadge.js`
- Test: `src/__tests__/lib/loadBadge.test.js` (append new cases)

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/lib/loadBadge.test.js` (inside the `describe('loadBadgeView', …)` block, before
its closing `})`):

```js
	// Approach A: distinguish CPU baking from network download, and warm (cache) from cold rebuilds.
	it('warm region, geometry loading → "Rebuilding from cache — N%"', () => {
		const v = loadBadgeView({ ...base, pct: 60, warm: true }, false, 5)
		expect(v.label).toBe('Rebuilding from cache — 60%')
	})

	it('cold region, geometry loading → unchanged "Nearby scene N% loaded"', () => {
		const v = loadBadgeView({ ...base, pct: 60, warm: false }, false, 5)
		expect(v.label).toBe('Nearby scene 60% loaded')
	})

	it('pct 100, build backlog, no network → "Building scene — N objects" (cold)', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 320, netInflight: 0, objPending: 0 }, false, 5)
		expect(v.label).toBe('Building scene — 320 objects')
	})

	it('pct 100, build backlog, no network, warm → "Rebuilding from cache — N objects"', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 320, netInflight: 0, warm: true }, false, 5)
		expect(v.label).toBe('Rebuilding from cache — 320 objects')
	})

	it('network fetches in flight → still "Objects N downloading"', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 50, netInflight: 12, objPending: 460 }, false, 5)
		expect(v.label).toBe('Objects 460 downloading')
	})

	it('build backlog alone keeps the badge shown', () => {
		const v = loadBadgeView({ ...base, pct: 100, buildPending: 5, objPending: 0, texPending: 0 }, false, 5)
		expect(v.show).toBe(true)
	})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/lib/loadBadge.test.js`
Expected: FAIL — e.g. the warm case returns `'Nearby scene 60% loaded'`, not `'Rebuilding from cache — 60%'`.

- [ ] **Step 3: Implement the new label logic**

In `src/lib/loadBadge.js`, replace the `loadBadgeView` function body with this. New: read `buildPending`,
`netInflight`, `warm`; warm variant of the pct<100 line; a bake branch before the download branch:

```js
export function loadBadgeView(cs, entering, terrainPatchCount = 0) {
	const pct = cs?.pct ?? 100
	const objPending = cs?.objPending ?? 0
	const texPending = cs?.texPending ?? 0
	const buildPending = cs?.buildPending ?? 0
	const netInflight = cs?.netInflight ?? 0
	const warm = !!cs?.warm

	const show = !!entering || pct < 100 || objPending > 0 || texPending > 0 || buildPending > 0

	let label
	if (entering) {
		label = terrainPatchCount > 0 ? 'Loading terrain…' : 'Entering region…'
	} else if (pct < 100) {
		if (warm) {
			label = `Rebuilding from cache — ${pct}%`
		} else {
			const phase = cs?.atTarget ? 'Overall scene' : 'Nearby scene'
			const preface = cs?.massive ? 'Major new scenery to cache: ' : ''
			label = `${preface}${phase} ${pct}% loaded`
		}
	} else if (buildPending > 0 && netInflight === 0) {
		// Build backlog with nothing on the wire = CPU baking, not downloading.
		label = warm ? `Rebuilding from cache — ${buildPending} objects` : `Building scene — ${buildPending} objects`
	} else if (objPending > 0) {
		label = `Objects ${objPending} downloading`
	} else if (texPending > 0) {
		label = `Textures ${texPending} left`
	} else {
		label = ''   // not shown
	}

	return { show, label, title: buildTitle(cs) }
}
```

- [ ] **Step 4: Run the full badge suite to verify pass (old + new)**

Run: `bun test src/__tests__/lib/loadBadge.test.js`
Expected: PASS — all original cases (defaults make `buildPending`/`netInflight`/`warm` inert) plus the
6 new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadBadge.js src/__tests__/lib/loadBadge.test.js
git commit -m "feat(badge): bake-vs-download + warm rebuild labels"
```

---

## Task 4: Feed the badge — cullStats fields + region-warm flag

**Why:** Task 3's pure logic needs `buildPending`, `netInflight`, and `warm` in `cullStats`.
`updateCullStats` already computes the texture/mesh/sculpt stats; add the three fields. Set `_regionWarm`
from Task 2's prefetch count at region entry. The badge component already passes the whole `cullStats`
object to `loadBadgeView`, so new fields flow through with no component change.

**Files:**
- Modify: `src/composables/useWorldEngine.js:430-432` (region-warm flag declaration)
- Modify: `src/composables/useWorldEngine.js:3664-3668` (set `_regionWarm` from prefetch)
- Modify: `src/composables/useWorldEngine.js:3481-3491` (`updateCullStats` payload)

- [ ] **Step 1: Declare the region-warm flag**

In `src/composables/useWorldEngine.js`, next to the existing per-region manifest state (around line
430-432, after `let _wasLoading = false`), add:

```js
		// Approach A: true when this region had a persisted geom manifest at entry (prefetch warmed keys),
		// so the load badge can read "Rebuilding from cache" instead of "Building scene". Best-effort.
		let _regionWarm = false
```

- [ ] **Step 2: Set the flag from the prefetch count on region entry**

In `src/composables/useWorldEngine.js`, in the region-change block (lines 3664-3669), replace the
fire-and-forget prefetch call:

```js
		if (regionKey !== _currentRegionKey) {
			_currentRegionKey = regionKey
			_regionGeomKeys = new Set()
			_wasLoading = true   // entering a region = loading; the next loading→false is its first settle edge
			_regionWarm = false
			geomManifestPrefetch(regionKey).then(n => { _regionWarm = (n || 0) > 0 })   // warms the mem tier; flag warm if a manifest existed
		}
```

- [ ] **Step 3: Add the three fields to the cullStats payload**

In `src/composables/useWorldEngine.js`, in `updateCullStats`, extend the `worldStore.setCullStats({…})`
object (lines 3482-3491) with `buildPending`, `netInflight`, and `warm` (the `mx`/`sx`/`tx` stats are
already in scope from lines 3476-3481):

```js
		worldStore.setCullStats({
			resident, known, evicted: evicted.size, pct,
			atTarget: _effNear >= ddTarget,
			massive: _loadEpisodeStart > 0 && (now - _loadEpisodeStart) >= MAJOR_LOAD_MS,
			effNear: Math.round(_effNear),
			texPending: tx.queued + tx.inflight + tx.buildQueued,
			texFailed: tx.hardFail,
			objPending: (mx.queued ?? 0) + (mx.inflight ?? 0) + (sx.queued ?? 0) + (sx.inflight ?? 0),
			objFailed: (mx.failed ?? 0) + (sx.failed ?? 0),
			buildPending: pendingMeshIds.size,
			netInflight: (mx.inflight ?? 0) + (sx.inflight ?? 0) + (tx.inflight ?? 0),
			warm: _regionWarm,
		})
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build:prod`
Expected: build succeeds (Vite emits `dist/prod/` with no errors).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat(badge): feed buildPending/netInflight/warm to cullStats"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `bun test`
Expected: PASS — no new failures vs baseline (the warm-read, badge, and engine changes add tests; none
regress).

- [ ] **Step 2: Run the production build**

Run: `npm run build:prod`
Expected: build succeeds.

- [ ] **Step 3: Live-verify on a warm Aspen reload (with Gene driving)**

Hard-reload into Aspen. In `server-watch.log`, confirm against the 2026-06-22 baseline:
- geom `miss` drops to near-zero on the warm reload (was 200–280/window);
- geom hits stay high and steady (served from RAM; `idb=0` is now *good*, not starvation);
- `[Drain] queued` collapses in seconds instead of trickling ~15 min;
- `near=` climbs off ~22 m without manual intervention;
- the badge reads "Rebuilding from cache …" briefly, then clears.

If any signal is unchanged, STOP and re-open the design — do not patch around it (per Gene's
stop-patching directive). Record the result in `docs/FEATURE-GAPS.md` and the session memory.

---

## Notes for the implementer

- **Do not bump `GEOM_VERSION`** — Approach A reads the existing `qs-geom` store as-is. The format change
  belongs to Approach C (packed buffers), so the cache format is bumped only once.
- **Out of scope:** mesh/sculpt/texture caches, render/LOD/static-merge (that's C), and the Aspen
  terrain fall-to-1m bug (logged separately in `docs/FEATURE-GAPS.md` → Movement & Physics).
- **Commits:** Gene commits (per project rule); subjects above are ≤50 chars and drafted for him.
- Approach C (packed per-region rebuild-ready buffers + far-field static merge) gets its own spec after A
  is live-verified.
- **Why this is smaller than the spec implied:** the spec's §3.1/§3.3 (region-sized warm set, batched
  reads, near-first warm order) and §3.2 (auto-sized RAM budget, Prefs override) are **already built** —
  the manifest prefetch reads the whole working set in one batched `getMany`, and the mem-tier budget is
  auto-sized to the region at startup (`useWorldEngine.js:4745` + `uiStore` `computeAutoGeomCacheMb`, no
  Prefs change needed). The single defeated link was `geomCacheGetMany` never consulting `_mem`. Task 1
  repairs that link, which activates all of it. **Deferred to a later pass (not needed for v1):** when a
  region's working set exceeds the RAM budget, `byteLRU` keeps a recent subset and the drain re-reads IDB
  for the rest (the existing, safe fallback — a smaller instant bubble, no regression). Explicit
  near-first *warm-load selection* of the resident subset is an Approach-C-adjacent refinement, not v1.
```
