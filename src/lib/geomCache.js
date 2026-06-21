// src/lib/geomCache.js — thin main-thread client. Big mem-tier + IDB live in the cache worker
// (useCacheIO → cacheIO.worker → geomCacheCore). Here we keep only a small sync L1 for instant
// repeat-hits, and fall back to running the core on the main thread when the worker is unavailable
// (test env, kill-switch off, or worker death). Public API matches the old geomCache.js exactly.
import { createByteLRU } from '@/lib/byteLRU.js'
import { useCacheIO } from '@/composables/useCacheIO.js'
import { useUiStore } from '@/stores/uiStore.js'
import * as core from './geomCacheCore.js'

// Request DURABLE (non-best-effort) origin storage from the MAIN thread. WHY here: the cache cores now
// run in a Web Worker, and navigator.storage.persist() in a WorkerNavigator context is denied — so
// qs-geom/qs-mesh/qs-tex stayed best-effort and Chrome evicted them between reloads (a warm region
// reloaded COLD). persist() is origin-wide, so this one main-thread call covers all three caches.
// Logged so we can confirm whether the browser granted it. Fire-and-forget; never blocks.
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
	Promise.resolve(navigator.storage.persisted?.()).then(already => {
		if (already) { console.debug('[geomCache] storage already persisted (durable)'); return }
		return navigator.storage.persist().then(granted => console.debug('[geomCache] storage.persist() granted=', granted))
	}).catch(() => { /* unsupported / denied — caches still work, just evictable */ })
}

export {
	GEOM_CACHE_MAX_BYTES, GEOM_CACHE_FALLBACK_BYTES, resolveGeomCap, setGeomCapBytes,
	initGeomCacheCap, bytesOfArrays, computeAutoGeomCacheMb, getGeomMemBudget,
	getGeomWriteBufStats, __getWriteBufBytes, setGeomDeferLimits,
} from './geomCacheCore.js'

const L1_BUDGET = 64 * 1024 * 1024
const _l1 = createByteLRU({ budgetBytes: L1_BUDGET, sizeOf: core.bytesOfArrays })
function _cloneArrays(a) {
	return { position: a.position?.slice(), normal: a.normal?.slice(), uv: a.uv?.slice(), index: a.index?.slice(),
		groups: a.groups ? a.groups.map(g => ({ start: g.start, count: g.count, materialIndex: g.materialIndex })) : [] }
}

function _useWorker() {
	try { return useUiStore().cacheWorker !== false && !useCacheIO().isDead() } catch { return false }
}
// Whether the user WANTS the worker (kill-switch on) — independent of whether it's currently alive.
// Reads of geometry route through the worker whenever wanted; if the worker is dead/stalled the
// request DEGRADES TO MISS (→ bake), NOT to core-on-main (which starves under the same load we moved
// IDB off-thread to escape — that hang latches _geomPending and bricks the drain). Manual kill-switch
// OFF still uses the core path below (the user's deliberate fallback).
function _workerWanted() {
	try { return useUiStore().cacheWorker !== false } catch { return false }
}

export function geomMemGet(key) {
	const e = _l1.get(key)
	return e ? _cloneArrays(e) : null
}
export function getGeomMemBytes() { return _l1.bytes() }
export function geomMemClear() { _l1.clear() }

function _send(msg, transfer, fallback) {
	if (!_useWorker()) return Promise.resolve().then(fallback)
	return useCacheIO().request(msg, transfer, fallback)
}

export function setGeomMemBudget(bytes) { if (_useWorker()) _send({ op: 'setMemBudget', bytes }, [], () => core.setGeomMemBudget(bytes)); else core.setGeomMemBudget(bytes) }
export function setGeomMemPressureCap(bytes) { if (_useWorker()) _send({ op: 'setMemPressureCap', bytes }, [], () => core.setGeomMemPressureCap(bytes)); else core.setGeomMemPressureCap(bytes) }

export async function geomCacheGetMany(keys, now) {
	const out = new Map()
	if (!keys.length) return out
	const misses = []
	for (const k of keys) { const e = _l1.get(k); if (e) out.set(k, _cloneArrays(e)); else misses.push(k) }
	if (!misses.length) return out
	if (!_workerWanted()) {
		// Manual kill-switch OFF → deliberate old main-thread path.
		const m = await core.geomCacheGetMany(misses, now)
		for (const [k, a] of m) { _l1.set(k, a); out.set(k, _cloneArrays(a)) }
		return out
	}
	// Worker path. Fallback (dead/timeout) = EMPTY map → the engine bakes these keys (always resolves,
	// never hangs). NOT core.geomCacheGetMany on main — that re-reads the starved IDB and re-bricks.
	const reply = await useCacheIO().request({ op: 'geomGetMany', keys: misses }, [], () => new Map())
	const hits = reply instanceof Map ? Object.fromEntries(reply) : (reply.hits || {})
	for (const k of Object.keys(hits)) { const a = hits[k]; _l1.set(k, a); out.set(k, _cloneArrays(a)) }
	return out
}

export function geomCacheStore(key, arrays, now) {
	const owned = { position: arrays.position, normal: arrays.normal, uv: arrays.uv, index: arrays.index, groups: arrays.groups || [] }
	_l1.set(key, owned)
	const forWorker = _cloneArrays(owned)
	if (_useWorker()) {
		const transfer = []
		for (const b of ['position', 'normal', 'uv', 'index']) if (forWorker[b]) transfer.push(forWorker[b].buffer)
		useCacheIO().request({ op: 'geomStore', key, arrays: forWorker, now }, transfer, () => core.geomCacheStore(key, forWorker, now))
	} else {
		core.geomCacheStore(key, forWorker, now)
	}
	return _cloneArrays(owned)
}

export function setGeomCacheLoading(v) { if (_useWorker()) _send({ op: 'setLoading', v }, [], () => core.setGeomCacheLoading(v)); else core.setGeomCacheLoading(v) }
export function geomManifestRecord(regionKey, keys) { return _send({ op: 'geomManifestRecord', regionKey, keys }, [], () => core.geomManifestRecord(regionKey, keys)) }
export async function geomManifestPrefetch(regionKey) {
	if (_useWorker()) return useCacheIO().request({ op: 'geomManifestPrefetch', regionKey }, [], () => core.geomManifestPrefetch(regionKey))
	// No-worker fallback: read manifest keys via core then prefetch into _l1 via client's geomCacheGetMany
	const keys = await core.geomManifestGetKeys(regionKey)
	if (keys?.length) await geomCacheGetMany(keys)
}
export function geomCacheEvict(key) { _l1.delete(key); return _send({ op: 'geomEvict', key }, [], () => core.geomCacheEvict(key)) }
export async function getGeomCacheStats() { const r = await _send({ op: 'geomStats' }, [], () => core.getGeomCacheStats()); return r?.stats || r }
export async function clearGeomCache() { _l1.clear(); return _send({ op: 'clearGeom' }, [], () => core.clearGeomCache()) }
export async function __flushGeomWritesNow() { return _send({ op: 'flushGeom' }, [], () => core.__flushGeomWritesNow()) }
export async function __flushGeomTouchesNow() { return core.__flushGeomTouchesNow() }

if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => { __flushGeomWritesNow() })
}
