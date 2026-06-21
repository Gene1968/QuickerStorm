# Cache I/O Worker (qs-geom + qs-mesh) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move qs-geom + qs-mesh IndexedDB I/O and the large RAM mem-tiers off the main thread into a dedicated Web Worker, so cache reads can't be starved by main-thread load and the engine stops re-baking geometry / re-downloading meshes it already has (root cause in `docs/superpowers/specs/2026-06-21-cache-io-worker-design.md`).

**Architecture:** Extract each cache's IDB logic into a DOM-free `*Core.js` module that runs in the worker AND on the main thread (fallback). A single `cacheIO.worker.js` owns the connections + big mem-tiers. The existing `geomCache.js`/`meshCache.js` become thin clients: small sync L1 + delegate to the worker via `useCacheIO.js` + sync-fallback to the core when the worker is dead. The engine stops the "4 s → re-bake" watchdog and waits for the worker's authoritative hit/miss verdict.

**Tech Stack:** Vue 3 / Three.js, ES module Web Workers (Vite `new Worker(new URL(...), {type:'module'})`), IndexedDB, vitest (`src/lib` + `src/composables` tests run under vitest; the `bun:test` files under `src/__tests__` run under `bun test`). TABS for indentation.

**Phasing:** Phase 1 (Tasks 1–7) = geometry off-thread, independently shippable + live-verifiable (geom `idb` hits on warm Aspen). Phase 2 (Tasks 8–11) = mesh off-thread (re-download stops). Phase 3 (Task 12) = live verify.

**House rules:** Do NOT commit/stage/run git — leave changes in the working tree (the human commits). No cache-version bump (keys unchanged). Behind the `uiStore.cacheWorker` kill-switch with the sync fallback as the floor.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/geomCacheCore.js` | Create (extract) | All qs-geom IDB logic, write-deferral, eviction, manifest, caps, large mem-tier. DOM-free. |
| `src/lib/geomCache.js` | Rewrite → thin client | Small sync L1 + delegate to `useCacheIO` + sync fallback to core. Same public API. |
| `src/lib/meshCacheCore.js` | Create (extract) | qs-mesh IDB logic: get/put/LRU/caps/stats/watchdog. DOM-free. |
| `src/lib/meshCache.js` | Rewrite → thin client | Delegate to `useCacheIO` + sync fallback to core. Same public API. |
| `src/workers/cacheIO.worker.js` | Create | Imports both cores; owns connections + mem-tiers; message router. |
| `src/composables/useCacheIO.js` | Create | Worker lifecycle + protocol + `outstanding()` + dead→sync-fallback + recycle + `takeStats`. |
| `src/stores/uiStore.js` | Edit | `cacheWorker` kill-switch flag (default true). |
| `src/composables/useWorldEngine.js` | Edit | `_flushGeomLookups`: sync-L1-first; remove re-bake watchdog; telemetry. |
| `src/__tests__/lib/geomCache.test.js` etc. | Edit | Re-point existing cache tests at the cores; add wrapper + ownership tests. |

---

## PHASE 1 — Geometry off-thread

### Task 1: Extract `geomCacheCore.js` (pure refactor, no behavior change)

**Files:**
- Create: `src/lib/geomCacheCore.js`
- Modify: `src/lib/geomCache.js`
- Test: existing `src/__tests__/lib/geomCache.test.js` (re-point imports)

**What moves:** Move the ENTIRE current contents of `src/lib/geomCache.js` (verbatim — do not alter logic) into `src/lib/geomCacheCore.js`, EXCEPT the `pagehide` listener block at the bottom (lines ~612-614) which stays out of the core (DOM). Then make `src/lib/geomCache.js` re-export everything from the core so all existing callers keep working unchanged:

- [ ] **Step 1: Create the core by moving the file**

Copy `src/lib/geomCache.js` verbatim to `src/lib/geomCacheCore.js`. Remove the trailing `if (typeof window !== 'undefined') { window.addEventListener('pagehide', …) }` block from the core (the client keeps it). Keep every export name identical.

- [ ] **Step 2: Make `geomCache.js` a re-export shim (temporary, this task only)**

Replace the entire body of `src/lib/geomCache.js` with:

```js
// Thin re-export during the core extraction (Task 1). Task 5 replaces this with the worker client.
export * from './geomCacheCore.js'
import { __flushGeomWritesNow } from './geomCacheCore.js'
if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => { __flushGeomWritesNow() })
}
```

- [ ] **Step 3: Re-point the existing test at the core (keep it green)**

In `src/__tests__/lib/geomCache.test.js`, leave it importing from `@/lib/geomCache.js` (the re-export keeps it valid) OR change to `@/lib/geomCacheCore.js`. Run it:

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: PASS — identical to before (pure move).

- [ ] **Step 4: Verify build + full geom test suite**

Run: `bun test src/__tests__/lib/geomCache.test.js` then `npm run build:staging`
Expected: tests green, build green. No behavior change.

- [ ] **Step 5: Commit** (per house rules: do NOT commit — leave staged in working tree; the human commits. Skip this step.)

---

### Task 2: `useCacheIO.js` wrapper + `cacheIO.worker.js` (geom messages only)

**Files:**
- Create: `src/composables/useCacheIO.js`
- Create: `src/workers/cacheIO.worker.js`
- Test: `src/__tests__/composables/useCacheIO.test.js` (new)

**Worker protocol:** request `{id, op, ...}`; reply `{id, ...result}`. Ops this task: `geomGetMany`, `geomStore`, `geomManifestRecord`, `geomManifestPrefetch`, `geomEvict`, `setLoading`, `geomStats`, `clearGeom`, `flushGeom`. Output arrays transferred; the worker sends CLONES of mem-tier/IDB hits.

- [ ] **Step 1: Write the worker**

```js
// src/workers/cacheIO.worker.js — owns qs-geom IDB + the large geom mem-tier off the main thread.
import * as geom from '../lib/geomCacheCore.js'

// Build a transfer list from an arrays object (position/normal/uv/index buffers).
function arraysTransfer(a) {
	const t = []
	if (a?.position) t.push(a.position.buffer)
	if (a?.normal)   t.push(a.normal.buffer)
	if (a?.uv)       t.push(a.uv.buffer)
	if (a?.index)    t.push(a.index.buffer)
	return t
}

self.onmessage = async (e) => {
	const { id, op } = e.data
	try {
		switch (op) {
			case 'geomGetMany': {
				const map = await geom.geomCacheGetMany(e.data.keys)
				// map: Map<key, arrays(clones already, per geomCacheGetMany)>. Build a plain object + transfer.
				const hits = {}; const transfer = []
				for (const [k, arrays] of map) { hits[k] = arrays; transfer.push(...arraysTransfer(arrays)) }
				self.postMessage({ id, hits }, transfer)
				break
			}
			case 'geomStore': {
				// Worker takes ownership of e.data.arrays (transferred from main). Returned clone is discarded
				// here (main already has its copy for the mesh); store keeps owned in mem-tier + write buffer.
				geom.geomCacheStore(e.data.key, e.data.arrays)
				self.postMessage({ id, ok: true })
				break
			}
			case 'geomManifestRecord': { await geom.geomManifestRecord(e.data.regionKey, e.data.keys); self.postMessage({ id, ok: true }); break }
			case 'geomManifestPrefetch': { await geom.geomManifestPrefetch(e.data.regionKey); self.postMessage({ id, ok: true }); break }
			case 'geomEvict': { await geom.geomCacheEvict(e.data.key); self.postMessage({ id, ok: true }); break }
			case 'setLoading': { geom.setGeomCacheLoading(e.data.v); self.postMessage({ id, ok: true }); break }
			case 'geomStats': { const s = await geom.getGeomCacheStats(); self.postMessage({ id, stats: s }); break }
			case 'clearGeom': { await geom.clearGeomCache(); self.postMessage({ id, ok: true }); break }
			case 'flushGeom': { await geom.__flushGeomWritesNow(); self.postMessage({ id, ok: true }); break }
			default: self.postMessage({ id, error: 'unknown op ' + op })
		}
	} catch (err) { self.postMessage({ id, error: String(err?.message || err) }) }
}
```

- [ ] **Step 2: Write the wrapper test FIRST (dead-worker → sync fallback)**

```js
// src/__tests__/composables/useCacheIO.test.js
import { describe, it, expect, vi } from 'vitest'
import { useCacheIO } from '@/composables/useCacheIO.js'

// In the test env there is no real Worker (or it throws), so useCacheIO must mark itself dead and
// resolve every call via the sync fallback (the core). We assert the fallback is what runs.
describe('useCacheIO fallback', () => {
	it('is dead without a usable Worker and resolves via the provided fallback', async () => {
		const io = useCacheIO()
		// force-dead regardless of env
		io.__killForTest()
		expect(io.isDead()).toBe(true)
		const fallback = vi.fn(async () => 'FELL_BACK')
		const r = await io.request({ op: 'geomStats' }, [], fallback)
		expect(fallback).toHaveBeenCalledTimes(1)
		expect(r).toBe('FELL_BACK')
	})
})
```

- [ ] **Step 3: Run it (fails — module missing)**

Run: `npx vitest run src/__tests__/composables/useCacheIO.test.js`
Expected: FAIL — cannot import `useCacheIO`.

- [ ] **Step 4: Write the wrapper**

```js
// src/composables/useCacheIO.js — main-thread client for the cache worker. Mirrors useMeshBaker:
// id-correlated requests, outstanding() backpressure, dead-flag → sync fallback, recycle, takeStats.
let worker = null
let dead = false
let nextId = 1
let jobsSinceSpawn = 0
const pending = new Map()   // id → { resolve, fallback }
const RECYCLE_AFTER_JOBS = 4000
const stats = { jobs: 0 }
let _singleton = null

function initWorker() {
	if (worker || dead) return
	try {
		worker = new Worker(new URL('../workers/cacheIO.worker.js', import.meta.url), { type: 'module' })
		worker.onmessage = (e) => {
			const p = pending.get(e.data.id)
			if (!p) return
			pending.delete(e.data.id)
			if (e.data.error) { p.fallback().then(p.resolve) } else p.resolve(e.data)
			if (++jobsSinceSpawn >= RECYCLE_AFTER_JOBS && pending.size === 0) {
				jobsSinceSpawn = 0
				try { worker.terminate() } catch { /* ignore */ }
				worker = null   // respawns on next request; dead stays false
			}
		}
		worker.onerror = () => killWorker()
		worker.onmessageerror = () => killWorker()
	} catch { dead = true; worker = null }
}

function killWorker() {
	dead = true
	try { worker?.terminate() } catch { /* ignore */ }
	worker = null
	// Resolve everything in flight via its sync fallback so no caller hangs.
	for (const [, p] of pending) p.fallback().then(p.resolve)
	pending.clear()
}

/**
 * Send one request to the worker. `transfer` is the transferables list. `fallback` is an async
 * thunk that performs the same op on the main thread (the core); it runs if the worker is dead/errors.
 * Returns the worker's reply object (or the fallback's resolved value).
 */
function request(msg, transfer = [], fallback) {
	if (dead) return Promise.resolve().then(fallback)
	initWorker()
	if (dead || !worker) return Promise.resolve().then(fallback)
	const id = nextId++
	stats.jobs++
	return new Promise((resolve) => {
		pending.set(id, { resolve, fallback })
		try { worker.postMessage({ id, ...msg }, transfer) }
		catch { pending.delete(id); fallback().then(resolve) }   // DataCloneError etc.
	})
}

function outstanding() { return pending.size }
function isDead() { return dead }
function takeStats() { const s = { ...stats }; stats.jobs = 0; return s }
function __killForTest() { killWorker() }

export function useCacheIO() {
	if (!_singleton) _singleton = { request, outstanding, isDead, takeStats, __killForTest }
	return _singleton
}
```

- [ ] **Step 5: Run the test (passes)**

Run: `npx vitest run src/__tests__/composables/useCacheIO.test.js`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `npm run build:staging`
Expected: green (Vite resolves the `new Worker(new URL(...))`).

---

### Task 3: Add the `cacheWorker` kill-switch to uiStore

**Files:**
- Modify: `src/stores/uiStore.js`

- [ ] **Step 1: Add the flag**

Find the uiStore state (it persists a set of prefs). Add a boolean `cacheWorker` defaulting to `true`, persisted alongside the other prefs (match the existing persisted-pref pattern in the file — e.g. how `drawDistance`/`geomCacheRamMb` are declared and persisted). Expose it like the others.

- [ ] **Step 2: Build**

Run: `npm run build:staging`
Expected: green.

---

### Task 4: Rewrite `geomCache.js` as the thin client

**Files:**
- Modify: `src/lib/geomCache.js`
- Test: `src/__tests__/lib/geomCache.test.js` (must stay green — in test env the worker is dead → client uses the core fallback, i.e. today's behavior)

**Design:** The client keeps a SMALL sync L1 (re-using a `createByteLRU`, budget 64 MB) for `geomMemGet`/sibling/post-bake hits. `geomCacheGetMany`, `geomCacheStore`, manifest fns, `setGeomCacheLoading`, `clearGeomCache`, stats route to the worker via `useCacheIO` when `uiStore.cacheWorker` is on and the worker is alive; otherwise they call `geomCacheCore` directly (fallback). The L1 is ALSO populated on store + on get-hits so repeat reads serve sync.

- [ ] **Step 1: Write the client**

```js
// src/lib/geomCache.js — thin main-thread client. Big mem-tier + IDB live in the cache worker
// (useCacheIO → cacheIO.worker → geomCacheCore). Here we keep only a small sync L1 for instant
// repeat-hits, and fall back to running the core on the main thread when the worker is unavailable
// (test env, kill-switch off, or worker death). Public API matches the old geomCache.js exactly.
import { createByteLRU } from '@/lib/byteLRU.js'
import { useCacheIO } from '@/composables/useCacheIO.js'
import { useUiStore } from '@/stores/uiStore.js'
import * as core from './geomCacheCore.js'

// Re-export the pure helpers + cap/config setters unchanged (they're process-local knobs the engine
// already calls; the worker reads its own copy of the same constants).
export {
	GEOM_CACHE_MAX_BYTES, GEOM_CACHE_FALLBACK_BYTES, resolveGeomCap, setGeomCapBytes,
	initGeomCacheCap, bytesOfArrays, computeAutoGeomCacheMb, getGeomMemBudget,
	getGeomWriteBufStats, __getWriteBufBytes, setGeomDeferLimits,
} from './geomCacheCore.js'

// Small sync L1 (un-aliased clones, like the core's mem tier).
const L1_BUDGET = 64 * 1024 * 1024
const _l1 = createByteLRU({ budgetBytes: L1_BUDGET, sizeOf: core.bytesOfArrays })
function _cloneArrays(a) {
	return { position: a.position?.slice(), normal: a.normal?.slice(), uv: a.uv?.slice(), index: a.index?.slice(),
		groups: a.groups ? a.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })) : [] }
}

function _useWorker() {
	try { return useUiStore().cacheWorker !== false && !useCacheIO().isDead() } catch { return false }
}

/** Sync L1 lookup. Returns a fresh copy or null. */
export function geomMemGet(key) {
	const e = _l1.get(key)
	return e ? _cloneArrays(e) : null
}
export function getGeomMemBytes() { return _l1.bytes() }
export function geomMemClear() { _l1.clear() }

// Mem-tier sizing: forward to the worker (its tier is the big one); the L1 stays fixed-small.
export function setGeomMemBudget(bytes) { _send({ op: 'setMemBudget', bytes }, [], () => core.setGeomMemBudget(bytes)) }
export function setGeomMemPressureCap(bytes) { _send({ op: 'setMemPressureCap', bytes }, [], () => core.setGeomMemPressureCap(bytes)) }

function _send(msg, transfer, fallback) {
	if (!_useWorker()) return Promise.resolve().then(fallback)
	return useCacheIO().request(msg, transfer, fallback)
}

/** Batch lookup. Worker reads its mem-tier + IDB off-thread; promote hits into the L1. */
export async function geomCacheGetMany(keys) {
	const out = new Map()
	if (!keys.length) return out
	// L1 first (sync) — serve what we can without a round-trip.
	const misses = []
	for (const k of keys) { const e = _l1.get(k); if (e) out.set(k, _cloneArrays(e)); else misses.push(k) }
	if (!misses.length) return out
	if (!_useWorker()) {
		const m = await core.geomCacheGetMany(misses)
		for (const [k, a] of m) { _l1.set(k, a); out.set(k, _cloneArrays(a)) }
		return out
	}
	const reply = await useCacheIO().request({ op: 'geomGetMany', keys: misses }, [], () => core.geomCacheGetMany(misses))
	const hits = reply instanceof Map ? Object.fromEntries(reply) : (reply.hits || {})
	for (const k of Object.keys(hits)) { const a = hits[k]; _l1.set(k, a); out.set(k, _cloneArrays(a)) }
	return out
}

/** Store baked arrays: keep a clone in the L1, ship a clone to the worker (or core) for IDB + big tier. */
export function geomCacheStore(key, arrays) {
	const owned = { position: arrays.position, normal: arrays.normal, uv: arrays.uv, index: arrays.index, groups: arrays.groups || [] }
	_l1.set(key, owned)
	const forWorker = _cloneArrays(owned)
	if (_useWorker()) {
		const transfer = []
		for (const b of ['position', 'normal', 'uv', 'index']) if (forWorker[b]) transfer.push(forWorker[b].buffer)
		useCacheIO().request({ op: 'geomStore', key, arrays: forWorker }, transfer, () => core.geomCacheStore(key, forWorker))
	} else {
		core.geomCacheStore(key, forWorker)
	}
	return _cloneArrays(owned)   // caller's copy
}

export function setGeomCacheLoading(v) { if (_useWorker()) _send({ op: 'setLoading', v }, [], () => core.setGeomCacheLoading(v)); else core.setGeomCacheLoading(v) }
export function geomManifestRecord(regionKey, keys) { return _send({ op: 'geomManifestRecord', regionKey, keys }, [], () => core.geomManifestRecord(regionKey, keys)) }
export function geomManifestPrefetch(regionKey) { return _send({ op: 'geomManifestPrefetch', regionKey }, [], () => core.geomManifestPrefetch(regionKey)) }
export function geomCacheEvict(key) { _l1.delete(key); return _send({ op: 'geomEvict', key }, [], () => core.geomCacheEvict(key)) }
export async function getGeomCacheStats() { const r = await _send({ op: 'geomStats' }, [], () => core.getGeomCacheStats()); return r?.stats || r }
export async function clearGeomCache() { _l1.clear(); return _send({ op: 'clearGeom' }, [], () => core.clearGeomCache()) }
export async function __flushGeomWritesNow() { return _send({ op: 'flushGeom' }, [], () => core.__flushGeomWritesNow()) }
export async function __flushGeomTouchesNow() { return core.__flushGeomTouchesNow() }

if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => { __flushGeomWritesNow() })
}
```

NOTE for the implementer: `geomCacheCore.js` must export `setGeomMemBudget`/`setGeomMemPressureCap` and accept `setMemBudget`/`setMemPressureCap` ops in the worker (Task 2 only added geom read/store ops — ADD `setMemBudget`/`setMemPressureCap` handlers to `cacheIO.worker.js` that call `geom.setGeomMemBudget`/`geom.setGeomMemPressureCap`). Verify these op names match between the worker switch and the client `_send` calls.

- [ ] **Step 2: Add the two missing worker ops**

In `src/workers/cacheIO.worker.js` add to the switch:
```js
			case 'setMemBudget': { geom.setGeomMemBudget(e.data.bytes); self.postMessage({ id, ok: true }); break }
			case 'setMemPressureCap': { geom.setGeomMemPressureCap(e.data.bytes); self.postMessage({ id, ok: true }); break }
```

- [ ] **Step 3: Run the geom cache tests (fallback path) + build**

Run: `bun test src/__tests__/lib/geomCache.test.js` then `npm run build:staging`
Expected: tests PASS (test env → worker dead → client uses core fallback = original behavior), build green. If a test imported internals only on the old `geomCache.js`, re-point that import to `@/lib/geomCacheCore.js`.

---

### Task 5: Ownership test — served hit is independent of the retained copy

**Files:**
- Test: `src/__tests__/lib/geomCache.test.js` (add a case)

- [ ] **Step 1: Add the test**

```js
it('geomCacheStore hands out a copy that does not alias the cached arrays', async () => {
	const { geomCacheStore, geomMemGet } = await import('@/lib/geomCache.js')
	const pos = new Float32Array([1, 2, 3])
	const handed = geomCacheStore('p1:1:owntest', { position: pos, groups: [] })
	handed.position[0] = 999                       // mutate the caller's copy
	const cached = geomMemGet('p1:1:owntest')      // L1 copy must be untouched
	expect(cached.position[0]).toBe(1)
})
```

- [ ] **Step 2: Run + build**

Run: `bun test src/__tests__/lib/geomCache.test.js`
Expected: PASS (clone-at-boundary holds).

---

### Task 6: Engine integration — sync-L1-first + remove the re-bake watchdog

**Files:**
- Modify: `src/composables/useWorldEngine.js` — `_flushGeomLookups` (~lines 433-480) and the `[Bake]` telemetry (~line 4865)

**Current** `_flushGeomLookups` calls `geomCacheGetMany([keys])` with a 4 s `setTimeout` watchdog whose `processHits(new Map())` degrades to all-miss → bake everything. **New behavior:** `geomCacheGetMany` already serves L1 sync (Task 4) and the worker returns authoritative hits; the engine must bake ONLY the keys the worker reports as misses, and must NOT re-bake on a slow read. Keep a long dead-worker backstop.

- [ ] **Step 1: Rewrite the flush body**

Replace the `_flushGeomLookups` watchdog + `processHits` logic with:

```js
	async function _flushGeomLookups() {
		if (!_geomLookupBatch.length) return
		const batch = _geomLookupBatch
		_geomLookupBatch = []
		const byKey = new Map()
		for (const b of batch) { const l = byKey.get(b.key); if (l) l.push(b); else byKey.set(b.key, [b]) }
		let hits
		try {
			// geomCacheGetMany serves L1 sync + worker IDB off-thread; it NEVER rejects (degrades to a
			// partial/empty Map). No re-bake watchdog: a slow read waits for the real verdict instead of
			// re-baking cached geometry (the saturation spiral). The dead-worker backstop lives in
			// useCacheIO (request → sync fallback), so this await still resolves if the worker dies.
			hits = await geomCacheGetMany([...byKey.keys()])
		} catch { hits = new Map() }
		if (_engineDead) { _geomPending -= batch.length; return }
		for (const [key, entries] of byKey) {
			const arrays = hits.get(key)
			if (!arrays) { _bakeGeomGroup(key, entries); continue }   // authoritative miss → bake
			_geomHitIdb++; _geomPending--
			entries[0].applySwap(arrays)
			let evicted = null
			for (let i = 1; i < entries.length; i++) {
				const clone = geomMemGet(key)
				if (clone) { _geomHitIdb++; _geomPending--; entries[i].applySwap(clone) }
				else (evicted ??= []).push(entries[i])
			}
			if (evicted) _bakeGeomGroup(key, evicted)
		}
	}
```

(Delete the old `processHits`/`settled`/`wd`/`GEOM_LOOKUP_WATCHDOG_MS` machinery for this function. If `GEOM_LOOKUP_WATCHDOG_MS` and `_geomLookupWatchdogN` are now unused, remove them and drop `wdog=${_geomLookupWatchdogN}` from the `[Bake]` telemetry line.)

- [ ] **Step 2: Add worker telemetry to the `[Bake]` line**

On the `[Bake]` telemetry line (~4865) append the cache-worker backpressure + stats. Add near the other imports a reference to the IO singleton and extend the string:
```js
		` wkr=${useCacheIO().outstanding()}`
```
(Import `useCacheIO` at the top of useWorldEngine.js if not already; call `.outstanding()`.)

- [ ] **Step 3: Build + full vitest (no new failures)**

Run: `npm run build:staging` then `npx vitest run`
Expected: build green; vitest shows no NEW failures vs the pre-existing `useTeleport` baseline (5) — the geom path now runs through the client (worker dead in tests → core fallback → same behavior).

---

### Task 7: Phase 1 live verify (geometry)

**No code — manual, human drives the client; I watch `server-watch.log`.**

- [ ] Hard-reload the client. Revisit a warm region (ideally Aspen). In the `[Bake]` line, confirm `geomCache idb=` climbs from **0 → high** on the warm revisit (geometry served from cache, not re-baked) and `wkr=` shows worker activity. Confirm no main-thread freeze and that a COLD first-load and a LIGHT region still behave as before.
- [ ] Toggle `uiStore.cacheWorker` off → confirm it falls back to the old main-thread path cleanly (no errors). Toggle back on.

**Phase 1 is shippable here.** Meshes will still re-download until Phase 2.

---

## PHASE 2 — Mesh off-thread

### Task 8: Extract `meshCacheCore.js` (pure refactor)

**Files:**
- Create: `src/lib/meshCacheCore.js`
- Modify: `src/lib/meshCache.js`
- Test: `src/__tests__/lib/meshCache.test.js`

- [ ] **Step 1: Move the file**

Copy `src/lib/meshCache.js` verbatim to `src/lib/meshCacheCore.js` (remove any DOM `pagehide` listener if present — keep it in the client). Replace `src/lib/meshCache.js` body with `export * from './meshCacheCore.js'` (+ the pagehide listener if the original had one).

- [ ] **Step 2: Run tests + build**

Run: `bun test src/__tests__/lib/meshCache.test.js` then `npm run build:staging`
Expected: PASS, green (pure move).

---

### Task 9: Add mesh ops to the worker

**Files:**
- Modify: `src/workers/cacheIO.worker.js`

- [ ] **Step 1: Import the mesh core and add ops**

```js
import * as mesh from '../lib/meshCacheCore.js'
```
Add to the switch:
```js
			case 'meshGet': {
				const subs = await mesh.meshCacheGet(e.data.uuid)
				const transfer = []
				if (subs) for (const s of subs) { transfer.push(s.positions.buffer, s.normals.buffer, s.uvs.buffer, s.indices.buffer) }
				self.postMessage({ id, subs: subs || null }, transfer)
				break
			}
			case 'meshPut': { await mesh.meshCachePut(e.data.uuid, e.data.submeshes); self.postMessage({ id, ok: true }); break }
			case 'meshStats': { const s = await mesh.getMeshCacheStats(); self.postMessage({ id, stats: s }); break }
			case 'clearMesh': { await mesh.clearMeshCache?.(); self.postMessage({ id, ok: true }); break }
```

NOTE: the worker's `meshCacheGet` returns the submeshes it read; it does not retain a separate clone (meshCacheCore has no mem-tier — the RAM tier lives in `useMeshFetch.mem`). Transferring the read result is safe because the core re-reads from IDB next time.

- [ ] **Step 2: Build**

Run: `npm run build:staging`
Expected: green.

---

### Task 10: Rewrite `meshCache.js` as the thin client

**Files:**
- Modify: `src/lib/meshCache.js`
- Test: `src/__tests__/lib/meshCache.test.js`

- [ ] **Step 1: Write the client**

```js
// src/lib/meshCache.js — thin client. qs-mesh IDB lives in the cache worker (useCacheIO →
// cacheIO.worker → meshCacheCore). Falls back to running the core on the main thread when the
// worker is unavailable. Public API matches the old meshCache.js.
import { useCacheIO } from '@/composables/useCacheIO.js'
import { useUiStore } from '@/stores/uiStore.js'
import * as core from './meshCacheCore.js'

export { MESH_CACHE_MAX_BYTES, MESH_CACHE_FALLBACK_BYTES, meshDbConfig, getMeshWatchdogTrips } from './meshCacheCore.js'

function _useWorker() { try { return useUiStore().cacheWorker !== false && !useCacheIO().isDead() } catch { return false } }

export async function meshCacheGet(uuid, now = Date.now()) {
	if (!_useWorker()) return core.meshCacheGet(uuid, now)
	const reply = await useCacheIO().request({ op: 'meshGet', uuid }, [], () => core.meshCacheGet(uuid, now))
	return reply?.subs !== undefined ? reply.subs : reply   // reply.subs (worker) or core's return (fallback)
}

export async function meshCachePut(uuid, submeshes, now = Date.now()) {
	if (!_useWorker()) return core.meshCachePut(uuid, submeshes, now)
	const transfer = []
	for (const s of submeshes) transfer.push(s.positions.buffer, s.normals.buffer, s.uvs.buffer, s.indices.buffer)
	return useCacheIO().request({ op: 'meshPut', uuid, submeshes }, transfer, () => core.meshCachePut(uuid, submeshes, now))
}

export async function getMeshCacheStats() { const r = await (_useWorker() ? useCacheIO().request({ op: 'meshStats' }, [], () => core.getMeshCacheStats()) : core.getMeshCacheStats()); return r?.stats || r }
export async function clearMeshCache() { return _useWorker() ? useCacheIO().request({ op: 'clearMesh' }, [], () => core.clearMeshCache?.()) : core.clearMeshCache?.() }
```

**Ownership note (correctness):** `useMeshFetch` keeps its RAM copy in `mem` (byteLRU) and ALSO calls `meshCachePut`. Because `meshCachePut` now TRANSFERS the submesh buffers to the worker, the caller's arrays would be detached. Fix in Task 11: `useMeshFetch` must put a **clone** to `meshCachePut`, OR `meshCachePut` clones before transfer. Choose: `meshCachePut` clones internally before transferring (one memcpy of re-derivable data, mirrors geomCacheStore). Update Step 1's `meshCachePut` to clone:

```js
export async function meshCachePut(uuid, submeshes, now = Date.now()) {
	if (!_useWorker()) return core.meshCachePut(uuid, submeshes, now)
	const clone = submeshes.map(s => ({
		positions: s.positions.slice(), normals: s.normals.slice(), uvs: s.uvs.slice(), indices: s.indices.slice(),
	}))
	const transfer = []
	for (const s of clone) transfer.push(s.positions.buffer, s.normals.buffer, s.uvs.buffer, s.indices.buffer)
	return useCacheIO().request({ op: 'meshPut', uuid, submeshes: clone }, transfer, () => core.meshCachePut(uuid, clone, now))
}
```

- [ ] **Step 2: Run mesh tests (fallback path) + build**

Run: `bun test src/__tests__/lib/meshCache.test.js` then `npm run build:staging`
Expected: PASS (test env → fallback → original behavior), green. Re-point any internal-only imports to `@/lib/meshCacheCore.js`.

---

### Task 11: Verify `useMeshFetch` integrity with the transferring put

**Files:**
- Modify (if needed): `src/composables/useMeshFetch.js`
- Test: existing mesh-fetch behavior

- [ ] **Step 1: Audit the put call sites**

In `useMeshFetch.js` find both `meshCachePut(uuid, net)` / `meshCachePut(d.meshId, subs)` calls. Confirm the arrays handed to `meshCachePut` are NOT used again by the caller AFTER the call (they're stored in `mem` BEFORE the put). Since Task 10's `meshCachePut` now CLONES before transferring, the caller's `mem` arrays stay valid regardless. Confirm `mem.set(uuid, net)` happens and is not aliased by the transfer. No change needed if the clone-in-put is in place; otherwise clone at the call site.

- [ ] **Step 2: Build + full vitest**

Run: `npm run build:staging` then `npx vitest run`
Expected: green; no new vitest failures vs baseline.

---

## PHASE 3

### Task 12: Full live verify

**No code — human drives, I watch the log.**

- [ ] Warm Aspen revisit: `[Bake] geomCache idb=` high (0 before), `[Mesh]` server decode lines ≈ 0 (served from qs-mesh, not grid), `mesh ✓` served from cache, load completes in **minutes not hours**, no freeze.
- [ ] Regression sweep: COLD first-load of a fresh region still bakes/fetches normally; a LIGHT region loads instantly; a VAR region (1024) loads; crossing to a neighbor region and back works. Timings ≈ pre-change.
- [ ] Kill-switch off → old path, no errors. Worker-death simulation (optional): if the worker is terminated, loads continue via fallback.
- [ ] Update `docs/FEATURE-GAPS.md` (the render/cache section + the `idb=0` items) → root cause fixed via worker; note `PERSISTED false` remains a separate follow-up.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 architecture/modules → Tasks 1,2,4,8,9,10 (+uiStore Task 3). §2 protocol/ownership → Task 2 (geomGet/geomStore transfer + worker-side clone), Task 4 (clone-at-boundary in client store), Tasks 5 & 9–11 (ownership tests + mesh clone-before-transfer). §3 spiral-breaker (sync-L1-first, remove re-bake watchdog, dead-worker backstop) → Task 6 + the backstop in `useCacheIO.request`. §4 coherence/contention (single owner, L1 covers just-baked) → Tasks 4/6. §5 no-regression (sync fallback + kill-switch) → Tasks 2,3,4,10. §6 telemetry/success → Tasks 6,7,12. §7 out-of-scope (tex, persistence) → not touched. All mapped.
- **Placeholder scan:** the "extract verbatim" tasks (1, 8) intentionally MOVE the real current file rather than transcribe it — that's the correct content for a mechanical move, not a placeholder. All new code is concrete. No TBD/`handle edge cases`/`similar to`.
- **Type/name consistency:** op names match between worker switch and client `_send`/`request` calls: `geomGetMany`, `geomStore`, `geomManifestRecord`, `geomManifestPrefetch`, `geomEvict`, `setLoading`, `geomStats`, `clearGeom`, `flushGeom`, `setMemBudget`, `setMemPressureCap` (Tasks 2 + 4 Step 2), `meshGet`, `meshPut`, `meshStats`, `clearMesh` (Task 9 + 10). Reply field names: geom `{hits}`, mesh `{subs}`, stats `{stats}` — consumed accordingly in the client. `useCacheIO()` API (`request`, `outstanding`, `isDead`, `takeStats`, `__killForTest`) consistent across Tasks 2,4,6,10.
- **Gap fixed during review:** Task 4 originally referenced `setMemBudget`/`setMemPressureCap` worker ops not defined in Task 2 → added Task 4 Step 2 to add those handlers. Task 10 `meshCachePut` transfer would detach the caller's arrays → added the clone-before-transfer + Task 11 audit.
