# Heavy-Region Warm-Read Decouple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the warm qs-geom cache actually serve geometry *during* a heavy region load so a revisited dense region loads in seconds instead of re-baking over 2–4 min.

**Architecture:** Break the bake→write→read-starvation cascade by suspending IDB flushes during a region-load burst (writes buffer in RAM, bounded by byte+time ceilings, flush when the load settles). Decouple the CPU-RAM geometry cache from the 1536 MB VRAM governor so the cache can grow (auto-detected + user-overridable) without starving live geometry. Front-load a per-region key manifest into the mem tier on region entry.

**Tech Stack:** Vanilla JS ES modules; IndexedDB (`qs-geom`); `bun:test` + `fake-indexeddb` for unit tests; Vue 3 / Pinia (`uiStore`); Three.js engine (`useWorldEngine.js`). No build-time codegen.

**Verification note:** `npm run lint` is broken repo-wide (ESLint 9 flat-config). Verify via `bun test` + `npm run build:staging`. Engine/UI tasks that can't be unit-tested are verified by build + a live heavy-region load (the project's "done = usable experience" rule).

**Cache-version note:** This touches cache *plumbing* only — no baked-geometry output changes — so **NO `GEOM_VERSION` bump** and no user cache wipe.

---

## File Structure

- `src/lib/byteLRU.js` — add `setBudget(n)` (runtime budget resize + re-evict). Modify.
- `src/lib/geomCache.js` — write-deferral mode, byte/time ceilings, mem-budget setter, manifest record/prefetch. Modify (the core of this plan).
- `src/stores/uiStore.js` — `geomCacheRamMb` persisted setting + auto-detect default + apply-on-init. Modify.
- `src/composables/useWorldEngine.js` — drop cache bytes from the VRAM governor sum; drive `setGeomCacheLoading` from the existing load signal; per-region key tracking + manifest record/prefetch. Modify.
- `src/components/...` Prefs/QuickPrefs control — bind a slider to `geomCacheRamMb`. Modify (additive UI).
- Tests: `src/__tests__/lib/byteLRU.test.js`, `src/__tests__/lib/geomCache.test.js`. Modify.

---

## Task 1: `byteLRU.setBudget` — runtime budget resize

**Files:**
- Modify: `src/lib/byteLRU.js:11-54`
- Test: `src/__tests__/lib/byteLRU.test.js`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/lib/byteLRU.test.js`:

```js
describe('setBudget', () => {
	it('lowering the budget evicts oldest-first until it fits', () => {
		const c = lru(300)
		c.set('a', 100); c.set('b', 100); c.set('c', 100)   // bytes = 300, fits
		c.setBudget(150)                                      // must drop to <=150
		expect(c.has('a')).toBe(false)                        // oldest evicted
		expect(c.has('b')).toBe(false)
		expect(c.has('c')).toBe(true)                         // newest kept
		expect(c.bytes()).toBeLessThanOrEqual(150)
	})
	it('raising the budget evicts nothing', () => {
		const c = lru(300)
		c.set('a', 100); c.set('b', 100)
		c.setBudget(1000)
		expect(c.has('a')).toBe(true)
		expect(c.has('b')).toBe(true)
		expect(c.bytes()).toBe(200)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/byteLRU.test.js`
Expected: FAIL — `c.setBudget is not a function`.

- [ ] **Step 3: Implement `setBudget`**

In `src/lib/byteLRU.js`, change `budgetBytes` from a destructured const to a mutable local and add the method. Replace the function signature line and add to the returned object:

```js
export function createByteLRU({ budgetBytes, sizeOf }) {
	let _budget = budgetBytes          // mutable so setBudget can resize at runtime
	const map = new Map()
	let bytes = 0
	let evictions = 0

	function _evictUntilFit(protectedKey) {
		for (const [k, e] of map) {
			if (bytes <= _budget) break
			if (k === protectedKey) continue
			map.delete(k)
			bytes -= e.b
			evictions++
		}
	}

	return {
		get(key) {
			const e = map.get(key)
			if (!e) return undefined
			map.delete(key)
			map.set(key, e)
			return e.v
		},
		has: (key) => map.has(key),
		set(key, value) {
			const prev = map.get(key)
			if (prev) { map.delete(key); bytes -= prev.b }
			const b = sizeOf(value) || 0
			map.set(key, { v: value, b })
			bytes += b
			if (bytes > _budget) _evictUntilFit(key)
		},
		delete(key) {
			const e = map.get(key)
			if (!e) return false
			map.delete(key)
			bytes -= e.b
			return true
		},
		clear() { map.clear(); bytes = 0 },
		// Resize the budget at runtime; shrinking evicts oldest-first until it fits (no protected key).
		setBudget(n) { _budget = n; if (bytes > _budget) _evictUntilFit(null) },
		budget: () => _budget,
		size: () => map.size,
		bytes: () => bytes,
		evictions: () => evictions,
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/byteLRU.test.js`
Expected: PASS (all existing byteLRU tests + the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/byteLRU.js src/__tests__/lib/byteLRU.test.js
git commit -m "feat: byteLRU runtime setBudget + re-evict"
```

---

## Task 2: geomCache write-deferral (the keystone)

Suspend flushes during a load burst; bound the buffer with byte + time ceilings; flush on a debounced exit.

**Files:**
- Modify: `src/lib/geomCache.js` (state near :107, `geomCacheStore` :139, `_scheduleFlush` :149, `_flushNow` :155, `geomCacheEvict` :309, `clearGeomCache` :358)
- Test: `src/__tests__/lib/geomCache.test.js`

- [ ] **Step 1: Write the failing tests**

Add these imports to the existing import block in `src/__tests__/lib/geomCache.test.js`:

```js
import {
	resolveGeomCap, geomCacheStore, geomMemGet, geomCacheGetMany, bytesOfArrays,
	getGeomCacheStats, clearGeomCache, geomMemClear, getGeomMemBytes,
	setGeomCapBytes, __flushGeomWritesNow, __flushGeomTouchesNow, geomCacheEvict,
	setGeomCacheLoading, setGeomDeferLimits,
} from '@/lib/geomCache.js'
```

Add a new describe block:

```js
describe('write-deferral (warm-read decouple)', () => {
	const small = () => ({
		position: new Float32Array(3).fill(1), normal: new Float32Array(3).fill(1),
		uv: new Float32Array(2).fill(1), index: new Uint32Array(1).fill(1), groups: [],
	})

	it('while loading, exceeding FLUSH_MAX does NOT flush to IDB', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		setGeomDeferLimits({ ceilingBytes: 1 * GB, maxDeferMs: 60000 })   // ceilings won't fire
		setGeomCacheLoading(true)
		for (let i = 0; i < 250; i++) geomCacheStore(`d${i}`, small())     // > FLUSH_MAX (200)
		await new Promise(r => setTimeout(r, 400))                         // past FLUSH_MS
		expect((await getGeomCacheStats()).count).toBe(0)                  // nothing persisted
		setGeomCacheLoading(false)                                         // debounced exit flushes
		await new Promise(r => setTimeout(r, 900))                         // past exit debounce (750ms)
		expect((await getGeomCacheStats()).count).toBe(250)
		setGeomDeferLimits({ ceilingBytes: 256 * 1024 * 1024, maxDeferMs: 30000 })
	})

	it('byte ceiling forces a flush even while loading', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		const oneBytes = bytesOfArrays(small())
		setGeomDeferLimits({ ceilingBytes: oneBytes * 3, maxDeferMs: 60000 })  // flush after ~3 stores
		setGeomCacheLoading(true)
		for (let i = 0; i < 10; i++) geomCacheStore(`b${i}`, small())
		await new Promise(r => setTimeout(r, 100))
		expect((await getGeomCacheStats()).count).toBeGreaterThan(0)           // ceiling flushed mid-load
		setGeomCacheLoading(false)
		await new Promise(r => setTimeout(r, 900))
		setGeomDeferLimits({ ceilingBytes: 256 * 1024 * 1024, maxDeferMs: 30000 })
	})

	it('time ceiling forces a flush even while loading', async () => {
		geomMemClear(); await clearGeomCache()
		setGeomCapBytes(1 * GB)
		setGeomDeferLimits({ ceilingBytes: 1 * GB, maxDeferMs: 0 })            // time ceiling fires asap
		setGeomCacheLoading(true)
		geomCacheStore('t1', small())
		await new Promise(r => setTimeout(r, 400))                            // past FLUSH_MS check tick
		expect((await getGeomCacheStats()).count).toBe(1)
		setGeomCacheLoading(false)
		await new Promise(r => setTimeout(r, 900))
		setGeomDeferLimits({ ceilingBytes: 256 * 1024 * 1024, maxDeferMs: 30000 })
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: FAIL — `setGeomCacheLoading`/`setGeomDeferLimits` are not exported.

- [ ] **Step 3: Add deferral state**

In `src/lib/geomCache.js`, after the existing `_readsInFlight` declaration (around :107), add:

```js
// ── Write-deferral (warm-read decouple, FEATURE-GAPS #10) ────────────────────
// During a region-load burst the engine sets _loading; while it is true we suspend ALL flushes
// (no FLUSH_MS timer flush, no FLUSH_MAX punch-through) so readwrite flush txns never interleave
// with getMany readonly lookups. That is what breaks the bake→write→read-starvation cascade: a
// buffered write can never block the next cache read. Two bounds keep RAM/deferral finite.
let _loading = false
let _deferStartedAt = 0          // wall-clock of the first deferred write since the last flush (time ceiling)
let _writeBufBytes = 0           // running sum of buffered record bytes (byte ceiling, O(1))
let _exitTimer = null            // trailing debounce so brief load dips don't thrash the flush mode
const LOADING_EXIT_DEBOUNCE_MS = 750
let _ceilingBytes = 256 * 1024 * 1024   // byte ceiling: force a flush past this much buffered geometry
let _maxDeferMs = 30000                  // time ceiling: never defer a flush longer than this

/** Engine signal: true during a region-load burst (suspend flushes), false when the build settles. */
export function setGeomCacheLoading(v) {
	if (v) {
		if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null }
		_loading = true
	} else if (_loading && !_exitTimer) {
		_exitTimer = setTimeout(() => {
			_exitTimer = null; _loading = false; _deferStartedAt = 0; _flushNow(true)
		}, LOADING_EXIT_DEBOUNCE_MS)
	}
}

/** Test/governor hook: tune the deferral safety ceilings. */
export function setGeomDeferLimits({ ceilingBytes, maxDeferMs } = {}) {
	if (typeof ceilingBytes === 'number') _ceilingBytes = ceilingBytes
	if (typeof maxDeferMs === 'number') _maxDeferMs = maxDeferMs
}

// Force a flush if a deferred buffer has hit a ceiling, otherwise stay deferred and re-arm.
function _checkDeferCeilings() {
	_flushTimer = null
	if (!_loading) { _flushNow(); return }
	const overBytes = _writeBufBytes >= _ceilingBytes
	const overTime = _deferStartedAt && (Date.now() - _deferStartedAt) >= _maxDeferMs
	if (overBytes || overTime) {
		console.debug('[GeomCache] deferred flush forced:', overBytes ? 'byte-ceiling' : 'time-ceiling',
			Math.round(_writeBufBytes / 1048576) + 'MB buffered')
		_deferStartedAt = 0
		_flushNow(true)        // accept contention: a buffer this large means we are genuinely cold
		return
	}
	if (_writeBuf.size) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)   // re-arm
}
```

- [ ] **Step 4: Track buffered bytes in `geomCacheStore`**

Replace the body of `geomCacheStore` (:139-147) with byte-accounted buffering:

```js
export function geomCacheStore(key, arrays, now = Date.now()) {
	const owned = { position: arrays.position, normal: arrays.normal, uv: arrays.uv, index: arrays.index, groups: arrays.groups || [] }
	_mem.set(key, owned)
	try {
		const bytes = bytesOfArrays(owned)
		const prev = _writeBuf.get(key)
		if (prev) _writeBufBytes -= prev.bytes        // overwrite: drop the stale record's bytes
		_writeBuf.set(key, { key, ...owned, bytes, savedAt: now, lastUsed: now })
		_writeBufBytes += bytes
		_scheduleFlush()
	} catch { /* best-effort persistence; memory tier still works */ }
	return cloneArrays(owned)
}
```

- [ ] **Step 5: Suspend flushes in `_scheduleFlush`**

Replace `_scheduleFlush` (:149-153):

```js
function _scheduleFlush() {
	// Region-load burst: suspend flushes (no FLUSH_MAX punch-through). _checkDeferCeilings is the
	// only path that can force a flush while loading, and only at the byte/time ceilings.
	if (_loading) {
		if (!_deferStartedAt) _deferStartedAt = Date.now()
		if (!_flushTimer) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
		return
	}
	if (_writeBuf.size >= FLUSH_MAX) { _flushNow(); return }
	if (_flushTimer) return
	_flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
}
```

- [ ] **Step 6: Reset byte total when the buffer drains, and respect loading in `_flushNow`**

In `_flushNow` (:155), update the read-priority guard and zero `_writeBufBytes` when the batch is taken. Replace the guard block and the batch-extraction lines:

```js
async function _flushNow(force = false) {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	// While loading, only forced flushes (ceilings / exit / pagehide) proceed; everything else stays
	// deferred so reads aren't starved. Outside loading, the original _readsInFlight gate applies.
	if (!force && _loading) {
		if (!_flushTimer) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
		return
	}
	if (!force && _readsInFlight > 0 && _writeBuf.size < FLUSH_MAX) {
		if (!_flushTimer) _flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
		return
	}
	if (_flushing) await _flushing
	if (!_writeBuf.size) return
	const batch = [..._writeBuf.values()]
	_writeBuf.clear()
	_writeBufBytes = 0
	_deferStartedAt = 0
	// ... (rest of _flushNow unchanged) ...
```

(Leave the entire `_flushing = (async () => { ... })()` body and the trailing `await _flushing; _flushing = null` exactly as they are.)

- [ ] **Step 7: Keep `_writeBufBytes` in sync on evict + clear**

In `geomCacheEvict` (:312), the line `_writeBuf.delete(key)` becomes byte-aware:

```js
		const bufRec = _writeBuf.get(key)
		if (bufRec) { _writeBufBytes -= bufRec.bytes; _writeBuf.delete(key) }
```

In `clearGeomCache` (:363), after `_writeBuf.clear()` add:

```js
		_writeBufBytes = 0
		_deferStartedAt = 0
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: PASS — all existing tests (incl. the FLUSH_MAX hard-flush test, which runs with `_loading` false) plus the three new deferral tests.

- [ ] **Step 9: Commit**

```bash
git add src/lib/geomCache.js src/__tests__/lib/geomCache.test.js
git commit -m "feat: geomCache write-deferral during region load"
```

---

## Task 3: geomCache mem-budget setter

Let the mem tier be resized at runtime from a CPU-RAM budget.

**Files:**
- Modify: `src/lib/geomCache.js` (`_mem` declaration :89-90, exports)
- Test: `src/__tests__/lib/geomCache.test.js`

- [ ] **Step 1: Write the failing test**

Add `setGeomMemBudget, getGeomMemBudget` to the test import block, then add:

```js
describe('mem-tier budget setter', () => {
	it('shrinking the budget evicts mem-tier entries down to fit', () => {
		geomMemClear()
		const one = bytesOfArrays(mkArrays())
		for (let i = 0; i < 5; i++) geomCacheStore(`mb${i}`, mkArrays())   // 5 entries resident
		setGeomMemBudget(Math.floor(one * 2.5))                            // room for ~2
		expect(getGeomMemBytes()).toBeLessThanOrEqual(Math.floor(one * 2.5))
		expect(getGeomMemBudget()).toBe(Math.floor(one * 2.5))
		setGeomMemBudget(128 * 1024 * 1024)                                // restore default for later tests
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/geomCache.test.js -t "mem-tier budget"`
Expected: FAIL — `setGeomMemBudget` is not exported.

- [ ] **Step 3: Implement the setter**

In `src/lib/geomCache.js`, just after the `_mem` declaration (:90), add. Also have it scale the write ceiling (transient pool tracks the budget, capped):

```js
let _memBudget = GEOM_MEM_BUDGET
/**
 * Resize the CPU-RAM mem tier (and scale the write-deferral byte ceiling with it). These pools live
 * only in tab RAM — they never upload to the GPU — so they are budgeted separately from the VRAM
 * memGovernor (see useWorldEngine setAppBytes). byteLRU.setBudget evicts down to fit immediately.
 */
export function setGeomMemBudget(bytes) {
	_memBudget = Math.max(16 * 1024 * 1024, Math.floor(bytes) || GEOM_MEM_BUDGET)
	_mem.setBudget(_memBudget)
	_ceilingBytes = Math.min(512 * 1024 * 1024, Math.max(128 * 1024 * 1024, Math.floor(_memBudget * 0.25)))
}
export function getGeomMemBudget() { return _memBudget }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: PASS (full file green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geomCache.js src/__tests__/lib/geomCache.test.js
git commit -m "feat: geomCache runtime mem-tier budget setter"
```

---

## Task 4: Per-region manifest record + prefetch

Persist the geomKeys seen in a region; bulk-read them into the mem tier on re-entry. Reuse the existing `META` store (key `manifest:<regionKey>`) — **no DB_VERSION bump**.

**Files:**
- Modify: `src/lib/geomCache.js` (add two functions near the IDB tier)
- Test: `src/__tests__/lib/geomCache.test.js`

- [ ] **Step 1: Write the failing test**

Add `geomManifestRecord, geomManifestPrefetch` to the test import block, then:

```js
describe('per-region manifest prefetch', () => {
	it('records keys for a region and prefetches them into the mem tier on re-entry', async () => {
		geomMemClear(); await clearGeomCache()
		geomCacheStore('mk1', mkArrays(3)); geomCacheStore('mk2', mkArrays(4))
		await __flushGeomWritesNow()
		await geomManifestRecord('region-A', ['mk1', 'mk2'])
		geomMemClear()                                          // simulate fresh region entry
		expect(geomMemGet('mk1')).toBeNull()                   // cold mem tier
		await geomManifestPrefetch('region-A')                 // warms the mem tier from IDB
		expect(geomMemGet('mk1').position[0]).toBe(3)          // now a sync hit
		expect(geomMemGet('mk2').position[0]).toBe(4)
	})
	it('prefetch on an unknown region is a no-op (no throw)', async () => {
		geomMemClear(); await clearGeomCache()
		await geomManifestPrefetch('never-visited')            // must resolve, not throw
		expect(geomMemGet('anything')).toBeNull()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/lib/geomCache.test.js -t "manifest"`
Expected: FAIL — `geomManifestRecord` is not exported.

- [ ] **Step 3: Implement record + prefetch**

In `src/lib/geomCache.js`, after `geomCacheGetMany` (:306), add:

```js
// ── Per-region manifest (front-load): qs-geom META store, key "manifest:<regionKey>" ─────────
// A visit's geomKeys are recorded on settle and bulk-read into the mem tier on re-entry, so a warm
// revisit serves most prims from RAM before the ObjectUpdate storm. Hint only — missing/extra/
// LRU-evicted keys are harmless; requestGeometry remains the source of truth. Reuses META (no bump).
const MANIFEST_MAX_KEYS = 20000   // cap a single region's key list (densest regions ~13-24k prims)
const MANIFEST_MAX_REGIONS = 8    // keep the N most-recent regions; prune older manifests

export async function geomManifestRecord(regionKey, keys, now = Date.now()) {
	if (!regionKey || !keys?.length) return
	const list = keys.length > MANIFEST_MAX_KEYS ? keys.slice(0, MANIFEST_MAX_KEYS) : keys
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction(META, 'readwrite')
			const mt = tx.objectStore(META)
			mt.put({ k: `manifest:${regionKey}`, keys: list, savedAt: now })
			// Recency prune: collect manifest:* records, delete all but the newest MANIFEST_MAX_REGIONS.
			const seen = []
			const cur = mt.openCursor()
			cur.onsuccess = () => {
				const c = cur.result
				if (c) { if (typeof c.key === 'string' && c.key.startsWith('manifest:')) seen.push({ k: c.key, savedAt: c.value.savedAt || 0 }); c.continue(); return }
				seen.sort((a, b) => b.savedAt - a.savedAt)
				for (const m of seen.slice(MANIFEST_MAX_REGIONS)) mt.delete(m.k)
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve
		})
	} catch { /* best-effort: manifest is an optimization, never block load */ }
}

export async function geomManifestPrefetch(regionKey) {
	if (!regionKey) return
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
	} catch { return }
	// getMany promotes hits into the mem tier (the point); the returned Map is discarded.
	if (keys?.length) await geomCacheGetMany(keys)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: PASS (full file green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geomCache.js src/__tests__/lib/geomCache.test.js
git commit -m "feat: geomCache per-region manifest record/prefetch"
```

---

## Task 5: `uiStore.geomCacheRamMb` — auto-detect + persisted override

**Files:**
- Modify: `src/stores/uiStore.js` (after the `drawDistance` block :93-98; export list :309)

- [ ] **Step 1: Add the setting (mirrors the `drawDistance` pattern)**

In `src/stores/uiStore.js`, right after the `setEffectiveDrawDistance` line (:98), add:

```js
	// Geometry-cache CPU-RAM budget (MB). This pool (mem tier + write buffer) lives only in tab RAM
	// and never uploads to the GPU, so it is sized separately from the 1536MB VRAM governor. RAM has
	// no precise web API: navigator.deviceMemory is coarse (capped at 8), so the default is a tier
	// off it and a persisted user override wins (high-end boxes report only "8"). A Prefs slider binds
	// to `geomCacheRamMb`; useWorldEngine applies it via geomCache.setGeomMemBudget on init + on change.
	function _autoGeomCacheMb() {
		const dm = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined
		if (dm === undefined) return 1024     // API absent (e.g. Firefox/Safari) → assume capable
		if (dm < 4) return 256
		if (dm < 8) return 512
		return 1024                            // deviceMemory caps at 8; override goes higher
	}
	const _gcSaved = Number(localStorage.getItem('qs-geom-cache-mb'))
	const geomCacheRamMb = ref(Number.isFinite(_gcSaved) && _gcSaved >= 128 && _gcSaved <= 8192 ? _gcSaved : _autoGeomCacheMb())
	watch(geomCacheRamMb, (v) => localStorage.setItem('qs-geom-cache-mb', String(v)))
	function setGeomCacheRamMb(v) { geomCacheRamMb.value = Math.max(128, Math.min(8192, Math.round(Number(v) || _autoGeomCacheMb()))) }
```

- [ ] **Step 2: Export it**

In the store's return object (the `drawDistance, setDrawDistance, ...` line near :309), add:

```js
		geomCacheRamMb, setGeomCacheRamMb,
```

- [ ] **Step 3: Verify the build**

Run: `npm run build:staging`
Expected: build succeeds (no syntax/import errors). `watch` and `ref` are already imported in `uiStore.js`.

- [ ] **Step 4: Commit**

```bash
git add src/stores/uiStore.js
git commit -m "feat: uiStore geomCacheRamMb setting + auto-detect"
```

---

## Task 6: Decouple cache RAM from the VRAM governor + apply the budget

Drop the cache tier from the governor sum (frees VRAM budget for live geometry → relieves item 13), apply the user budget on init + on change, and report `geomCacheMB` as a separate telemetry segment.

**Files:**
- Modify: `src/composables/useWorldEngine.js` (:37 import, :3143 cull sum, :3954-3955 telemetry, engine init)

- [ ] **Step 1: Import the budget setter**

Change the geomCache import (`useWorldEngine.js:37`) to include the new setter:

```js
import { geomMemGet, geomCacheGetMany, geomCacheStore, getGeomMemBytes, initGeomCacheCap, setGeomMemBudget, getGeomMemBudget, setGeomCacheLoading, geomManifestRecord, geomManifestPrefetch } from '@/lib/geomCache.js'
```

- [ ] **Step 2: Drop cache bytes from the cull-tick governor sum**

At `useWorldEngine.js:3143`, change:

```js
		setAppBytes(getTextureBytes() + getMeshBytes() + _lastGeomB + getGeomMemBytes())
```

to:

```js
		// WHY no getGeomMemBytes(): the geom mem cache tier is CPU-RAM-only (never uploaded to the GPU),
		// so it does not belong in the VRAM budget. Counting it here stole ~128MB+ from live geometry
		// and worsened the cull-spiral (FEATURE-GAPS #13). It has its own RAM budget (setGeomMemBudget).
		setAppBytes(getTextureBytes() + getMeshBytes() + _lastGeomB)
```

- [ ] **Step 3: Report `geomCacheMB` as a separate segment**

At `useWorldEngine.js:3954-3955`, the `[Mem]` line sums `geomCacheB` into the app total. Change the total to exclude it and show it against its own budget. Replace those two lines:

```js
				const line = `[Mem] app ${mb(texB + meshB + geomB)}/${mb(appBudgetBytes())}MB (${(appRatio() * 100).toFixed(0)}%) ${heapSeg}` +
					`${pressure ? ' ⚠THROTTLING' : ''} | texMB=${mb(texB)} meshCacheMB=${mb(meshB)} geomMB=${mb(geomB)} geomCacheMB=${mb(geomCacheB)}/${mb(getGeomMemBudget())}` +
```

- [ ] **Step 4: Apply the user budget on engine init + react to changes**

Find the engine init where other one-shot setup runs (near the `initGeomCacheCap()` call site / engine `onMounted` or the scene-setup function). Add, after the renderer/scene are created:

```js
		// Apply the persisted geom-cache RAM budget and keep it live as the user adjusts the Prefs slider.
		setGeomMemBudget(uiStore.geomCacheRamMb * 1024 * 1024)
		watch(() => uiStore.geomCacheRamMb, (mbVal) => setGeomMemBudget(mbVal * 1024 * 1024))
```

(`watch` and `uiStore` are already imported/used in `useWorldEngine.js`. If `watch` is not yet imported, add it to the existing `vue` import.)

- [ ] **Step 5: Verify the build**

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat: decouple geom cache RAM from VRAM governor + apply budget"
```

---

## Task 7: Engine wiring — drive loading signal + manifest record/prefetch

**Files:**
- Modify: `src/composables/useWorldEngine.js` (state near :341, `cullTick` :3137, `requestGeometry` :362, `onTeleportFinish` :2631)

- [ ] **Step 1: Add per-region key tracking state**

Near the other engine state (after `_geomPending` :341), add:

```js
	// Per-region geomKey set for the manifest (front-load). Reset on region entry; recorded on settle.
	let _regionGeomKeys = new Set()
	let _currentRegionKey = null
	let _manifestRecordedFor = null   // avoid re-recording the same region on every settle
```

- [ ] **Step 2: Collect keys in `requestGeometry`**

In `requestGeometry` (:362), add the key to the region set (first line of the function body):

```js
	function requestGeometry(key, jobThunk, applySwap) {
		_regionGeomKeys.add(key)
		_geomPending++
		_geomLookupBatch.push({ key, jobThunk, applySwap })
		if (_geomLookupBatch.length === 1) queueMicrotask(_flushGeomLookups)
	}
```

- [ ] **Step 3: Drive the loading signal + record manifest from `cullTick`**

`cullTick` runs at 1Hz (`setInterval(cullTick, 1000)` :3921). Inside `cullTick`, after `setAppBytes(...)` (:3143), add:

```js
		// Drive geomCache write-deferral from the same load signal the lit/badge logic uses. While
		// loading, geomCache suspends IDB flushes so warm getMany reads aren't starved (FEATURE-GAPS #10).
		const tStat = getTextureStats(), mStat = getMeshStats()
		const loading = pendingMeshIds.size > 50 || tStat.queued > 0 || tStat.inflight > 0 || mStat.queued > 0 || _geomPending > 25
		setGeomCacheLoading(loading)
		// On settle, persist this region's key manifest once for fast warm re-entry.
		if (!loading && _currentRegionKey && _currentRegionKey !== _manifestRecordedFor && _regionGeomKeys.size) {
			_manifestRecordedFor = _currentRegionKey
			geomManifestRecord(_currentRegionKey, [..._regionGeomKeys])
		}
```

(`getTextureStats` and `getMeshStats` are already imported — they are used by the 1Hz lit-shading logic at :3572.)

- [ ] **Step 4: Reset tracking + prefetch on region entry**

In `onTeleportFinish` (:2631), inside the `if (d?.regionHandle)` block after `sessionStore.regionX/regionY` are set (:2676), add:

```js
				// Warm-read front-load: switch region key, reset per-region tracking, prefetch its
				// manifest into the mem tier before the ObjectUpdate storm (FEATURE-GAPS #10).
				_currentRegionKey = `${sessionStore.regionX}-${sessionStore.regionY}`
				_regionGeomKeys = new Set()
				_manifestRecordedFor = null
				geomManifestPrefetch(_currentRegionKey)   // fire-and-forget; populates the mem tier
```

- [ ] **Step 5: Verify the build**

Run: `npm run build:staging`
Expected: build succeeds.

- [ ] **Step 6: Live verification (the real bar)**

Run `npm run dev` + the Bun WS server, log into a **previously-visited** dense region, watch the `[Bake]`/`[Mem]` telemetry:
- During the load burst: `idb` hits stay > 0, `wdog` near 0 (was 487), `[Mem]` shows `geomCacheMB` separate from the app total.
- Wall-clock load drops from minutes toward seconds vs the prior 2–4 min.
- A cold region still loads and the deferral ceilings flush (look for `deferred flush forced` debug lines); no wedge.
Expected: warm revisit is dramatically faster; no new `⚠THROTTLING` from the cache change.

- [ ] **Step 7: Commit**

```bash
git add src/composables/useWorldEngine.js
git commit -m "feat: wire region-load deferral signal + manifest prefetch"
```

---

## Task 8: Prefs slider for geom cache RAM (additive UI)

Bind a control to `uiStore.geomCacheRamMb`, mirroring the planned draw-distance slider.

**Files:**
- Modify: the Preferences ▸ Graphics panel (locate via the existing `drawDistance` / `litShading` binding — `grep -rn "drawDistance" src/components`)

- [ ] **Step 1: Locate the graphics prefs panel**

Run: `grep -rn "litShading\|drawDistance" src/components`
Pick the Preferences/Graphics component that binds those (the draw-distance slider lives next to it per the uiStore note).

- [ ] **Step 2: Add the slider next to draw distance**

Add a labeled range input bound to the store (Tailwind tokens per CLAUDE.md `bg-card`/`text-t1`; tabs for indentation):

```vue
		<label class="block text-t1 text-sm mt-3">
			Geometry cache RAM: {{ uiStore.geomCacheRamMb }} MB
			<input
				type="range" min="128" max="8192" step="128"
				:value="uiStore.geomCacheRamMb"
				@input="e => uiStore.setGeomCacheRamMb(e.target.value)"
				class="w-full accent-accent"
			/>
			<span class="text-t1/60 text-xs">Larger = more warm-cache hits on revisit (uses tab RAM, not VRAM).</span>
		</label>
```

(Ensure `uiStore` is in scope — the panel already references it for `drawDistance`/`litShading`.)

- [ ] **Step 3: Verify the build + manual check**

Run: `npm run build:staging` then `npm run dev`.
Open Preferences ▸ Graphics: the slider shows the current value, dragging updates it, the value persists across reload (localStorage `qs-geom-cache-mb`), and `[Mem]` `geomCacheMB=X/Y` reflects the new budget within a few seconds.

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "feat: Prefs slider for geometry cache RAM budget"
```

---

## Self-Review

**Spec coverage:**
- Write-deferral (spec §1) → Task 2 (`setGeomCacheLoading`, suspend in `_scheduleFlush`/`_flushNow`, byte+time ceilings, exit debounce, pagehide retained). ✓
- CPU-RAM decoupling from VRAM governor (spec §2) → Task 6 (drop `getGeomMemBytes()` from `setAppBytes`; separate telemetry segment). ✓
- Sized cache RAM, auto-detect + override (spec §3) → Task 1 (`byteLRU.setBudget`), Task 3 (`setGeomMemBudget` + write-ceiling scaling), Task 5 (`uiStore.geomCacheRamMb`), Task 8 (slider). ✓
- Manifest prefetch (spec §4) → Task 4 (record/prefetch, META store, no bump, size+recency caps), Task 7 (engine wiring: key collection, record on settle, prefetch on entry). ✓
- Testing (spec) → unit tests in Tasks 1–4; live verification in Task 7. ✓
- No GEOM_VERSION bump (spec) → stated in header + Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Engine init site in Task 6 Step 4 is described by anchor ("after renderer/scene created / near `initGeomCacheCap()`") rather than a fixed line — the only soft locator, unavoidable without re-reading the init function, and bounded by a concrete grep target.

**Type/name consistency:** `setGeomCacheLoading`, `setGeomDeferLimits`, `setGeomMemBudget`, `getGeomMemBudget`, `geomManifestRecord(regionKey, keys, now)`, `geomManifestPrefetch(regionKey)`, `byteLRU.setBudget`/`budget`, `uiStore.geomCacheRamMb`/`setGeomCacheRamMb`, localStorage `qs-geom-cache-mb`, `_regionGeomKeys`/`_currentRegionKey`/`_manifestRecordedFor`, `_writeBufBytes`/`_ceilingBytes`/`_maxDeferMs`/`_deferStartedAt` — used consistently across tasks. `_checkDeferCeilings` referenced by `_scheduleFlush` and `_flushNow` and defined in Task 2 Step 3.
