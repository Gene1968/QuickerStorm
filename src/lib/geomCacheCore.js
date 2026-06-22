// src/lib/geomCacheCore.js — persistent (IndexedDB qs-geom) + in-memory cache of BAKED geometry
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

// TODO: add onblocked/onversionchange handlers before the first DB_VERSION bump (multi-tab
// upgrade hangs otherwise — see objectCache.js for the pattern).

// ── Cap (initCacheCap pattern from textureCache.js) ─────────────────────────
// 0.2/2GB filled to 97% after just two regions (15.9k entries, 11.7k of them per-scale mesh
// copies) — bumped to 0.3 of the origin quota. The 0.3 fraction stays fixed: the origin quota is
// fully apportioned (qs-tex 0.6, qs-geom 0.3, qs-mesh 0.1 = 1.0), so raising the fraction would
// push total IDB usage past the quota → QuotaExceeded on writes, and shrinking tex would starve
// the cold-texture pipeline (the real load bottleneck). The hard cap is the only safe lever: at
// 4GB it CLIPPED geom below its own 0.3 share on machines whose free-disk quota exceeds ~13.3GB
// (0.3 × quota > 4GB). Raised to 8GB so geom can reach its full reserved share on large disks;
// it's still bounded by 0.3 × quota, so this never eats into the tex/mesh shares. On a ~11.6GB
// quota the fraction binds at ~3.48GB and this is a no-op — it only helps on roomier disks.
export const GEOM_CACHE_MAX_BYTES      = 8 * 1024 * 1024 * 1024
export const GEOM_CACHE_FALLBACK_BYTES = 1 * 1024 * 1024 * 1024
const CAP_FRACTION = 0.3
let _capBytes = GEOM_CACHE_FALLBACK_BYTES
// WHY _capExplicit: setGeomCapBytes (test hook / governor escape hatch) must win over
// initGeomCacheCap's storage estimate, even if initGeomCacheCap runs first or runs again.
let _capExplicit = false

export function resolveGeomCap(estimate, fraction = CAP_FRACTION,
	max = GEOM_CACHE_MAX_BYTES, fallback = GEOM_CACHE_FALLBACK_BYTES) {
	const quota = estimate && typeof estimate.quota === 'number' ? estimate.quota : 0
	return quota > 0 ? Math.min(Math.floor(quota * fraction), max) : fallback
}

/**
 * Override the IDB cap used for eviction. Sets _capExplicit so initGeomCacheCap's storage
 * estimate cannot silently clobber a test-set or governor-set value after an await.
 */
export function setGeomCapBytes(n) { _capBytes = n; _capExplicit = true }

let _capInit = null
export function initGeomCacheCap() {
	if (_capInit) return _capInit
	_capInit = (async () => {
		try {
			if (navigator.storage?.estimate) {
				const est = resolveGeomCap(await navigator.storage.estimate())
				// WHY guard: if setGeomCapBytes was called (explicit override) we must not overwrite it.
				if (!_capExplicit) _capBytes = est
			}
		} catch { /* keep fallback */ }
		// WHY persist(): request persistent (non-best-effort) storage so the browser won't evict
		// qs-geom under disk pressure — that's what keeps warm regions warm ACROSS sessions. It's
		// origin-wide (textureCache requests it too), so calling here just makes geom durability
		// independent of whether/when the tex-cache init path ran. Fire-and-forget: Firefox may show
		// a permission doorhanger; don't let an unanswered prompt or rejection block the cap above.
		try { navigator.storage?.persist?.()?.catch?.(() => {}) } catch { /* unsupported */ }
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
		index:    a.index    ? a.index.slice()     : undefined,
		groups:   a.groups ? a.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })) : [],
	}
}

// A record is servable only if every present array is a real TypedArray of the right kind and
// groups (when present) is an Array. Anything else (disk corruption, foreign writes) is evicted
// and treated as a miss — the engine then re-bakes normally (spec: corrupt entry → miss + evict).
function validArrays(a) {
	if (!a || !(a.position instanceof Float32Array)) return false
	if (a.normal !== undefined && !(a.normal instanceof Float32Array)) return false
	if (a.uv !== undefined && !(a.uv instanceof Float32Array)) return false
	if (a.index !== undefined && !(a.index instanceof Uint32Array)) return false
	if (a.groups !== undefined && !Array.isArray(a.groups)) return false
	return true
}

// ── Tier 1: in-memory dedup map (byteLRU, cache owns its arrays) ─────────────
const GEOM_MEM_BUDGET = 128 * 1024 * 1024
const _mem = createByteLRU({ budgetBytes: GEOM_MEM_BUDGET, sizeOf: bytesOfArrays })

let _memBudget = GEOM_MEM_BUDGET
let _pressureCap = Infinity   // heap-pressure cap (bytes); Infinity = no cap. See setGeomMemPressureCap.
// Effective mem-tier budget = min(configured budget, heap-pressure cap). byteLRU evicts to fit now.
function _applyEffectiveBudget() { _mem.setBudget(Math.min(_memBudget, _pressureCap)) }
/**
 * Resize the CPU-RAM mem tier (and scale the write-deferral byte ceiling with it). These pools live
 * only in tab RAM — they never upload to the GPU — so they are budgeted separately from the VRAM
 * memGovernor (see useWorldEngine setAppBytes). byteLRU.setBudget evicts down to fit immediately.
 */
export function setGeomMemBudget(bytes) {
	_memBudget = Math.max(16 * 1024 * 1024, Math.floor(bytes) || GEOM_MEM_BUDGET)
	_applyEffectiveBudget()
	// NOTE: the write-deferral byte ceiling (_ceilingBytes) is intentionally NOT derived from the
	// read-cache budget — coupling them made a smaller RAM cache force write-flushes more often, and
	// those readwrite flushes block the readonly getMany reads (idb=0 / wdog re-bake spiral). The
	// ceiling is about write-buffer HEAP headroom during load, not read-cache size. See _ceilingBytes.
}
/**
 * Heap-pressure cap (FEATURE-GAPS #13): the mem tier lives in the tab heap, so when the process heap
 * nears OOM the engine clamps it hard here so the RAM cache can never crash the tab. Pass null to
 * clear (restore the configured budget). Effective budget = min(configured, cap); the byteLRU evicts
 * down immediately. Survival over warm-cache speed — the IDB tier still serves once the thread frees.
 */
export function setGeomMemPressureCap(bytes) {
	_pressureCap = (bytes == null) ? Infinity : Math.max(16 * 1024 * 1024, Math.floor(bytes))
	_applyEffectiveBudget()
}
export function getGeomMemBudget() { return _memBudget }

/**
 * Auto-default for the CPU-RAM mem-tier budget (MB), used by uiStore when the user has no saved
 * override. WHY heap-based: the mem tier is tab-heap ArrayBuffers, so sizing it off device RAM (which
 * ignores the ~4GB tab cap) OOM'd dense regions (FEATURE-GAPS #13). Take 30% of the heap headroom
 * ABOVE the ~1536MB resident-asset budget (geometry CPU copies + texture bitmaps + worldStore share
 * the heap), clamped 128..1024MB. A 4GB tab heap → ~768MB, enough to hold a heavy region's working
 * set so warm re-entry serves from the SYNC mem tier and bypasses the saturated IDB read path. The
 * runtime heap-pressure cap (setGeomMemPressureCap, driven from cullTick) is the hard safety net on
 * top of this. No heap API (Firefox/Safari, where that cap can't run either) → conservative tiers.
 */
export function computeAutoGeomCacheMb({ heapLimitBytes, deviceMemory } = {}) {
	if (heapLimitBytes) {
		const headroomMb = Math.max(0, heapLimitBytes / 1048576 - 1536)
		return Math.max(128, Math.min(1024, Math.round(headroomMb * 0.30)))
	}
	if (deviceMemory === undefined) return 256
	if (deviceMemory < 4) return 256
	return 384
}

/** Sync lookup. Returns a fresh COPY of the arrays, or null. */
export function geomMemGet(key) {
	const e = _mem.get(key)
	return e ? cloneArrays(e) : null
}
export function getGeomMemBytes() { return _mem.bytes() }
export function geomMemClear() { _mem.clear() }

// ── Tier 2: IndexedDB ────────────────────────────────────────────────────────
let _db = null
let _lastStats = null  // { count, bytes } served from memory (Prefs-starvation lesson)
// Read-priority gate: count of in-flight geomCacheGetMany lookups. A readwrite flush txn queued
// ahead of these readonly lookups blocks them at the IDB level (overlapping [STORE,META] scope),
// which starved warm cache reads during region load (measured: idb hits → 0, the engine's lookup
// watchdog firing 600×, everything re-baked). _flushNow defers while this is > 0. See _flushNow.
let _readsInFlight = 0

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
// Byte ceiling: force a flush past this much buffered geometry. Decoupled from the read-cache budget
// (see setGeomMemBudget) — that coupling was a bug. Kept LOW on purpose: a forced flush writes the
// buffer to disk and RELIEVES heap, so a low ceiling is what keeps a dense cold load heap-safe.
// Raising it to defer writes (to stop flushes blocking reads) backfired — the buffer ballooned in
// the tab heap and tipped it to OOM (108%, frozen). The read-blocking is fixed elsewhere, not here.
let _ceilingBytes = 128 * 1024 * 1024
let _maxDeferMs = 30000                  // time ceiling: never defer a flush longer than this
// Hard cap on the buffered-write HEAP footprint. Under main-thread saturation the byte ceiling's
// forced flushes can't drain fast enough, so the buffer ballooned to ~1GB and blew the tab heap to
// 147% (FEATURE-GAPS #13). Past this cap, geomCacheStore stops buffering NEW keys for IDB (they stay
// in the mem tier this session and re-persist on a calmer later visit) so the buffer can never OOM.
let _writeBufHardCap = 256 * 1024 * 1024
let _writeBufDropped = 0                  // count of persists skipped at the hard cap (telemetry)
// Throttle the forced-flush debug line: it fired per-store while over the ceiling → thousands of
// identical console lines per second on a cold load. Once/second is enough to see the condition.
let _lastForcedLogAt = 0
function _logForcedFlush(reason) {
	const t = Date.now()
	if (t - _lastForcedLogAt < 1000) return
	_lastForcedLogAt = t
	console.debug('[GeomCache] deferred flush forced:', reason, Math.round(_writeBufBytes / 1048576) + 'MB buffered')
}

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
export function setGeomDeferLimits({ ceilingBytes, maxDeferMs, hardCapBytes } = {}) {
	if (typeof ceilingBytes === 'number') _ceilingBytes = ceilingBytes
	if (typeof maxDeferMs === 'number') _maxDeferMs = maxDeferMs
	if (typeof hardCapBytes === 'number') _writeBufHardCap = hardCapBytes
}

/** Test/telemetry hook: current buffered-write heap footprint in bytes. */
export function __getWriteBufBytes() { return _writeBufBytes }

/** Write-buffer telemetry: { bytes, dropped } — surfaces the hard-cap drops (no silent caps). */
export function getGeomWriteBufStats() { return { bytes: _writeBufBytes, dropped: _writeBufDropped } }

// Force a flush if a deferred buffer has hit a ceiling, otherwise stay deferred and re-arm.
function _checkDeferCeilings() {
	_flushTimer = null
	if (!_loading) { _flushNow(); return }
	const overBytes = _writeBufBytes >= _ceilingBytes
	const overTime = _deferStartedAt && (Date.now() - _deferStartedAt) >= _maxDeferMs
	if (overBytes || overTime) {
		_logForcedFlush(overBytes ? 'byte-ceiling' : 'time-ceiling')
		_deferStartedAt = 0
		_flushNow(true)        // accept contention: a buffer this large means we are genuinely cold
		return
	}
	if (_writeBuf.size) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)   // re-arm
}

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
		const bytes = bytesOfArrays(owned)
		const prev = _writeBuf.get(key)
		// Hard bound (see _writeBufHardCap): once the buffer is over cap, skip buffering NEW keys for IDB
		// — the mem tier already holds them this session, and they re-bake+persist on a later, calmer
		// visit. Overwrites of already-buffered keys still proceed (they don't grow the net buffer). This
		// is what keeps the buffer from ballooning to ~1GB under saturation and blowing the tab heap.
		if (prev || _writeBufBytes < _writeBufHardCap) {
			if (prev) _writeBufBytes -= prev.bytes        // overwrite: drop the stale record's bytes
			_writeBuf.set(key, { key, ...owned, bytes, savedAt: now, lastUsed: now })
			_writeBufBytes += bytes
			_scheduleFlush()
		} else {
			_writeBufDropped++
		}
	} catch { /* best-effort persistence; memory tier still works */ }
	return cloneArrays(owned)
}

function _scheduleFlush() {
	// Region-load burst: suspend flushes (no FLUSH_MAX punch-through). _checkDeferCeilings is the
	// only path that can force a flush while loading, and only at the byte/time ceilings.
	if (_loading) {
		if (!_deferStartedAt) _deferStartedAt = Date.now()
		// Byte ceiling: force an immediate flush if the buffer is already over budget. This avoids
		// waiting the full FLUSH_MS tick and keeps RAM bounded on high-volume bake bursts.
		if (_writeBufBytes >= _ceilingBytes) {
			_logForcedFlush('byte-ceiling')
			_deferStartedAt = 0
			_flushNow(true)
			return
		}
		if (!_flushTimer) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
		return
	}
	if (_writeBuf.size >= FLUSH_MAX) { _flushNow(); return }
	if (_flushTimer) return
	_flushTimer = setTimeout(() => { _flushTimer = null; _flushNow() }, FLUSH_MS)
}

async function _flushNow(force = false) {
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	// While loading, only forced flushes (ceilings / exit / pagehide) proceed; everything else stays
	// deferred so reads aren't starved. Outside loading, the original _readsInFlight gate applies.
	if (!force && _loading) {
		if (!_flushTimer) _flushTimer = setTimeout(_checkDeferCeilings, FLUSH_MS)
		return
	}
	// Read-priority: defer the readwrite flush while a getMany lookup is in flight so cache reads
	// aren't starved during load. Writes are re-derivable and cheap to delay. The hard cap
	// (_writeBuf.size >= FLUSH_MAX) and `force` (pagehide / explicit flush) both bypass this, so
	// buffered geometry can never grow unbounded and shutdown persistence still works.
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
	_flushing = (async () => {
		try {
			const db = await openDb()
			await new Promise((resolve, reject) => {
				const tx = db.transaction([STORE, META], 'readwrite')
				const st = tx.objectStore(STORE)
				const mt = tx.objectStore(META)
				const batchKeys = new Set(batch.map(b => b.key))
				// WHY getKey-before-put: keys are content hashes (shape+scale+GEOM_VERSION), so a
				// duplicate key means byte-identical content. We always put (refreshes lastUsed) but
				// only count added bytes for genuinely NEW keys. Without this guard, a whole-region
				// re-bake after a degraded getMany inflates totalBytes by the full region size on every
				// flush window that contains a duplicate, compounding until the cap triggers spurious
				// evictions (totalBytes drifts far above the real IDB footprint).
				let added = 0
				let pending = batch.length
				const afterAllKeys = () => {
					const mreq = mt.get('stats')
					mreq.onsuccess = () => {
						let total = (mreq.result?.totalBytes ?? 0) + added
						if (total <= _capBytes) { finishStats(total); return }
						// Over cap → lastUsed cursor oldest-first; never evict a key just written.
						const cur = st.index('lastUsed').openCursor()
						cur.onsuccess = () => {
							const c = cur.result
							if (!c || total <= _capBytes) { finishStats(total); return }
							if (!batchKeys.has(c.value.key)) { total -= c.value.bytes; c.delete() }
							c.continue()
						}
					}
				}
				let statsResult = null
				const finishStats = (total) => {
					const cReq = st.count()
					cReq.onsuccess = () => {
						mt.put({ k: 'stats', totalBytes: total, count: cReq.result })
						statsResult = { count: cReq.result, bytes: total }
					}
				}
				for (const rec of batch) {
					const gkReq = st.getKey(rec.key)
					gkReq.onsuccess = () => {
						// Always put (refresh lastUsed); only add bytes when key is new.
						st.put(rec)
						if (gkReq.result === undefined) added += rec.bytes
						if (--pending === 0) afterAllKeys()
					}
				}
				tx.oncomplete = () => { if (statsResult) _lastStats = statsResult; resolve() }
				// onabort too: an aborted txn settles NEITHER oncomplete nor onerror — the awaiting
				// flush chain (and everything queued behind _flushing) would hang forever.
				tx.onerror = () => reject(tx.error ?? new Error('flush txn error'))
				tx.onabort = () => reject(tx.error ?? new Error('flush txn aborted'))
			})
		} catch (e) { console.warn('[GeomCache] flush failed:', e) }
	})()
	await _flushing
	_flushing = null
}

/** Test hook: force the write buffer to disk now (bypasses the read-priority gate). */
export async function __flushGeomWritesNow() { await _flushNow(true) }

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
			tx.onabort = resolve
		})
	} catch { /* best-effort LRU */ }
}

/** Test hook: force pending LRU touches to IDB now. */
export async function __flushGeomTouchesNow() { await _flushTouches() }

/**
 * Batch lookup — ONE readonly txn for the whole key list (the drain-tick read). Returns
 * Map<key, arrays>; missing keys are simply absent. Hits are promoted into the memory tier
 * (un-aliased) and LRU-touched. NEVER rejects — IDB failure degrades to an empty Map (all-miss).
 */
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
					// WHY validate before promoting: spec "Error handling / degrade" — a corrupt or
					// unwrappable entry on hit is treated as a MISS and evicted; the engine re-bakes
					// normally. Without this, a corrupt record would enter the memory tier and throw in
					// cloneArrays (aborting this txn, dropping later keys) and again in geomMemGet.
					// Fire-and-forget evict: the readonly txn must not wait on a readwrite txn; the key
					// simply stays absent from the result Map (= miss).
					if (!validArrays(arrays)) { geomCacheEvict(key); return }
					// IDB deserialization already produced fresh arrays → safe for the mem tier to own;
					// hand the CALLER a clone so promotion and hand-out never alias.
					// WHY safe to clobber a newer _mem entry: keys are content hashes (incl. GEOM_VERSION)
					// — same key ⇒ byte-identical arrays.
					_mem.set(key, arrays)
					out.set(key, cloneArrays(arrays))
					_touchLater(key, now)
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve   // degrade: whatever resolved before the error still counts
			tx.onabort = resolve   // aborted read = all-miss for unresolved keys; never hang the drain
		})
	} catch (e) { console.warn('[GeomCache] getMany failed:', e) }
	finally { _readsInFlight-- }
	return out
}

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
			// No-shrink: the engine re-records on every settle EDGE (it dropped its one-shot guard), so a
			// fresh re-entry whose working set hasn't fully reloaded would otherwise overwrite a larger
			// persisted manifest with its smaller early slice — losing warm coverage. Only overwrite when
			// this visit's key set is strictly larger, so the manifest converges UP to the fullest working
			// set ever seen for the region and never oscillates down. Recency-prune still runs every call.
			const exReq = mt.get(`manifest:${regionKey}`)
			exReq.onsuccess = () => {
				const existing = exReq.result?.keys?.length || 0
				if (list.length > existing) mt.put({ k: `manifest:${regionKey}`, keys: list, savedAt: now })
				// Recency prune: collect manifest:* records, delete all but the newest MANIFEST_MAX_REGIONS.
				const seen = []
				const cur = mt.openCursor()
				cur.onsuccess = () => {
					const c = cur.result
					if (c) { if (typeof c.key === 'string' && c.key.startsWith('manifest:')) seen.push({ k: c.key, savedAt: c.value.savedAt || 0 }); c.continue(); return }
					seen.sort((a, b) => b.savedAt - a.savedAt)
					for (const m of seen.slice(MANIFEST_MAX_REGIONS)) mt.delete(m.k)
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve
		})
	} catch { /* best-effort: manifest is an optimization, never block load */ }
}

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

/** Read the stored manifest key list for a region without prefetching into the mem tier.
 *  Used by the thin-client geomCache.js so it can prefetch into its own L1 via its own getMany. */
export async function geomManifestGetKeys(regionKey) {
	if (!regionKey) return null
	try {
		const db = await openDb()
		return await new Promise((resolve) => {
			const tx = db.transaction(META, 'readonly')
			const g = tx.objectStore(META).get(`manifest:${regionKey}`)
			g.onsuccess = () => resolve(g.result?.keys || null)
			tx.onerror = () => resolve(null)
			tx.onabort = () => resolve(null)
		})
	} catch { return null }
}

/** Remove one entry from both tiers (corrupt record, or external invalidation). Best-effort. */
export async function geomCacheEvict(key) {
	_mem.delete(key)
	const bufRec = _writeBuf.get(key)
	if (bufRec) { _writeBufBytes -= bufRec.bytes; _writeBuf.delete(key) }
	try {
		const db = await openDb()
		await new Promise((resolve) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			const st = tx.objectStore(STORE)
			const g = st.get(key)
			g.onsuccess = () => {
				const r = g.result
				if (!r) return
				st.delete(key)
				const mreq = tx.objectStore(META).get('stats')
				mreq.onsuccess = () => {
					const total = Math.max(0, (mreq.result?.totalBytes ?? 0) - (r.bytes || 0))
					const cReq = st.count()
					cReq.onsuccess = () => {
						tx.objectStore(META).put({ k: 'stats', totalBytes: total, count: cReq.result })
						_lastStats = { count: cReq.result, bytes: total }
					}
				}
			}
			tx.oncomplete = resolve
			tx.onerror = resolve
			tx.onabort = resolve
		})
	} catch { /* best-effort */ }
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
			tx.onabort = () => reject(tx.error ?? new Error('stats txn aborted'))
		})
	} catch { return { count: 0, bytes: 0, capBytes: _capBytes } }
}

export async function clearGeomCache() {
	// WHY cancel timer + await in-flight flush first: a committed-after-clear batch could
	// otherwise resurrect records into a freshly cleared store.
	if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null }
	if (_flushing) await _flushing
	_writeBuf.clear()
	_writeBufBytes = 0
	_deferStartedAt = 0
	if (_exitTimer) { clearTimeout(_exitTimer); _exitTimer = null }
	_loading = false
	_lastStats = null
	try {
		const db = await openDb()
		await new Promise((resolve, reject) => {
			const tx = db.transaction([STORE, META], 'readwrite')
			tx.objectStore(STORE).clear()
			tx.objectStore(META).put({ k: 'stats', totalBytes: 0, count: 0 })
			tx.oncomplete = () => { _lastStats = { count: 0, bytes: 0 }; resolve() }
			tx.onerror = () => reject(tx.error)
			tx.onabort = () => reject(tx.error ?? new Error('clear txn aborted'))
		})
	} catch { /* ignore */ }
}
