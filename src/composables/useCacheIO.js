// src/composables/useCacheIO.js — main-thread client for the cache worker. Mirrors useMeshBaker:
// id-correlated requests, outstanding() backpressure, a request timeout → fallback, dead-flag → sync
// fallback. The worker is STATEFUL (owns qs-geom IDB + mem-tier + write buffer) so it is NEVER
// recycled — terminating it would drop buffered writes; the mem-tier is bounded by its own byteLRU.
let worker = null
let dead = false
let nextId = 1
const pending = new Map()   // id → { resolve, fallback, timer }
// Defensive backstop: a worker that neither replies nor errors (e.g. a blocked IDB open) must not hang
// the caller forever — a stuck cache read would leak _geomPending and brick the drain. On trip we run
// the caller's fallback. Generous so it never fires on a healthy-but-busy worker.
const REQUEST_TIMEOUT_MS = 30000
let _singleton = null

// Run a fallback thunk and forward its result to `resolve`. The thunk may return a plain value
// (e.g. `() => new Map()`) OR a promise — Promise.resolve normalizes both, so no fallback can crash
// the transport with "fallback(...).then is not a function".
function _runFallback(fb, resolve) { Promise.resolve(fb()).then(resolve) }

function initWorker() {
	if (worker || dead) return
	try {
		worker = new Worker(new URL('../workers/cacheIO.worker.js', import.meta.url), { type: 'module' })
		worker.onmessage = (e) => {
			const p = pending.get(e.data.id)
			if (!p) return
			pending.delete(e.data.id)
			if (p.timer) clearTimeout(p.timer)
			if (e.data.error) { _runFallback(p.fallback, p.resolve) } else p.resolve(e.data)
		}
		worker.onerror = () => { console.warn('[cacheIO] worker error → main-thread fallback'); killWorker() }
		worker.onmessageerror = () => { console.warn('[cacheIO] worker message error → fallback'); killWorker() }
	} catch { dead = true; worker = null }
}

function killWorker() {
	dead = true
	try { worker?.terminate() } catch { /* ignore */ }
	worker = null
	for (const [, p] of pending) { if (p.timer) clearTimeout(p.timer); _runFallback(p.fallback, p.resolve) }
	pending.clear()
}

/**
 * Send one request to the worker. `transfer` is the transferables list. `fallback` is a thunk that
 * performs the same op on the main thread (the core) and runs if the worker is dead/errors/times out.
 */
function request(msg, transfer = [], fallback) {
	if (dead) return Promise.resolve().then(fallback)
	initWorker()
	if (dead || !worker) return Promise.resolve().then(fallback)
	const id = nextId++
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			if (!pending.has(id)) return
			pending.delete(id)
			_runFallback(fallback, resolve)
		}, REQUEST_TIMEOUT_MS)
		pending.set(id, { resolve, fallback, timer })
		try { worker.postMessage({ id, ...msg }, transfer) }
		catch { clearTimeout(timer); pending.delete(id); _runFallback(fallback, resolve) }
	})
}

function outstanding() { return pending.size }
function isDead() { return dead }
function __killForTest() { killWorker() }

export function useCacheIO() {
	if (!_singleton) _singleton = { request, outstanding, isDead, __killForTest }
	return _singleton
}
