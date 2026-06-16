// src/composables/useTextureFetch.js — fetch SL/OpenSim textures by UUID and hand back THREE.Texture.
// Layers (cheapest first): in-memory THREE.Texture cache → in-memory Blob mirror → IndexedDB
// (persists across reload/relogin, see lib/textureCache.js) → server fetch (C.ASSET_FETCH →
// ViewerAsset/GetTexture cap → J2C→WebP → S.ASSET_DATA). Per-layer dedupe + a negative cache stop
// repeated calls and thrash on the same (or dead) UUIDs.
import * as THREE from 'three'
import { useRealtimeSocket } from './useRealtimeSocket'
import { texCacheGet, texCachePut, texFailedLoad, texFailedMark, texFailedClear } from '@/lib/textureCache.js'
import { heapPush, heapPop } from '@/lib/priorityQueue.js'
import { emergencyHeap, appRatio } from '@/lib/memGovernor.js'
import { C, S } from '@shared/protocol.js'
import { drainWithinBudget } from '@/lib/budgetedDrain.js'

// Decode a base64 payload (as delivered over WS) into a typed Blob for IDB storage + createImageBitmap.
// WHY: storing the Blob (not a data-URL string) drops the +33% base64 inflation and lets the GPU
// texture build via createImageBitmap (no data-URL parse).
function b64ToBlob(b64, mime) {
	const bin = atob(b64)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return new Blob([bytes], { type: mime })
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const FETCH_TIMEOUT_MS = 30_000
// WHY cap: a region delivers ~1-2k textures. The server transcodes J2C→WebP on a single-instance
// WASM decoder (CPU-bound, serialized on the event loop). Firing every request at once means the
// late ones sit behind hundreds of decodes and blow FETCH_TIMEOUT_MS → negative-cached → invisible
// for the session, and which ones win the race varies per load. Cap concurrent network fetches like
// useMeshFetch does so the queue drains steadily instead of flooding. (texCacheGet/IDB hits and
// in-memory hits don't go through the cap — only true network fetches do.)
// Sweet spot = 6. The raise to 12 (chasing "parallelizable headroom") BACKFIRED: live [Asset]
// telemetry on a dense cold region showed per-fetch time ballooning 0.4s → 4.4s as concurrency
// climbed, with NET throughput dropping to ~1/s (vs 0 timeouts + ~1.3/s at 6). The grid's asset
// service is throughput-limited, not cleanly parallel — 12-way concurrency just adds queue latency
// and pushes fetches toward FETCH_TIMEOUT_MS, where they negative-cache and NEVER persist to qs-tex
// (poisoning the warm cache). 6 keeps each fetch fast, every fetch completes, and texCachePut warms
// qs-tex reliably so the NEXT visit is instant. Re-tune only with fresh [Asset] fetch=ms evidence.
const MAX_INFLIGHT = 6

// Per-frame texture build/upload pump (FEATURE-GAPS #11). Blob-ready enqueues a build job; the
// engine drains buildQueue once per frame via pumpTextureBuilds(), spreading the decode/downscale/
// upload cost instead of bursting it (which jams the main thread and starves IDB read callbacks).
const TEX_BUILD_MAX_PER_FRAME = 32   // cap builds STARTED per frame (the real throttle)
const TEX_BUILD_BUDGET_MS     = 4    // wall-clock cap on the synchronous dispatch loop
const buildQueue = []                // { uuid, blob, resolve }
let _renderer = null                 // injected by the engine; if null, uploads stay lazy

const cache       = new Map()  // uuid → THREE.Texture (base, GPU)
const texInflight = new Map()  // uuid → Promise<THREE.Texture|null>
const blobInflight = new Map()  // uuid → Promise<Blob|null>  (IDB-or-network WebP Blob)
const pending     = new Map()  // uuid → { resolve, timer }     (in-flight WS request)
const xformCache  = new Map()  // `uuid|repS|repT|offS|offT|rot` → cloned THREE.Texture w/ UV transform
const blobCache   = new Map()  // uuid → Blob (sync mirror; preview <img> + fast re-reads)
const objUrlCache = new Map()  // uuid → object URL (lazily created for <img> previews; revoked on prune/clear)
const alphaCache  = new Map()  // uuid → bool: WebP carries real transparency (drives blend vs opaque)
// WHY two failure classes: a server ERROR (j2c_decode_incomplete, 404) means the asset can't be
// produced — retrying wastes a slot, so it's permanent. A TIMEOUT means the server was just slow/
// overloaded (serialized J2C decoder under a flood) — likely to succeed once load drops, so it's
// retryable up to MAX_SOFT_RETRY. Conflating them (the old single `failed` set) meant timed-out
// textures stayed white for the session AND never cached → white every reload.
const failedHard  = new Set()  // uuids the server errored on — never retry
const softAttempts = new Map() // uuid → timeout count; retry until MAX_SOFT_RETRY then give up
const MAX_SOFT_RETRY = 4
const netQueue    = []         // queued network fetches awaiting a slot (runs: () => void)
let   active      = 0          // in-flight network fetches (≤ MAX_INFLIGHT)
// LRU bookkeeping for in-memory eviction. WHY: the `cache`/`xformCache` Maps grow UNBOUNDED — every
// texture ever seen stays resident (~0.25 MB each at 256²), so exploring a dense region accumulates
// gigabytes the mesh culler can't free (it disposes geometry, not these Maps). lastUsed lets the cull
// tick prune the least-recently-applied textures when over the memory budget.
const lastUsed    = new Map()  // uuid → last-access timestamp (ms)
const TEX_PRUNE_AGE_MS = 20000 // never prune a texture applied within the last 20s (avoid blanking near faces)

// Live counters so we can watch steady population (vs flooding) — see getTextureStats().
const stats = { requested: 0, done: 0, failed: 0, timeout: 0, late: 0 }

// DIAG(webp-trickle): per-leg slot-cycle timing — queue-wait | IDB recheck | net round trip | server
// handler time (from the reply's tMs). Read via getTextureStats().timing; remove once the trickle
// bottleneck is identified.
const timing = { qWait: { n: 0, ms: 0, max: 0 }, idb: { n: 0, ms: 0, max: 0 }, net: { n: 0, ms: 0, max: 0 }, srv: { n: 0, ms: 0, max: 0 } }
function _acc(k, ms) { const t = timing[k]; t.n++; t.ms += ms; if (ms > t.max) t.max = ms }

const EPS = 1e-4
const isIdentityXform = (x) =>
	!x || (Math.abs(x.repeat[0] - 1) < EPS && Math.abs(x.repeat[1] - 1) < EPS &&
	       Math.abs(x.offset[0]) < EPS && Math.abs(x.offset[1]) < EPS && Math.abs(x.rotation) < EPS)

let _wired = false
function _wire() {
	if (_wired) return
	_wired = true
	useRealtimeSocket().on(S.ASSET_DATA, _onAssetData)
	// WHY: populate failedHard from IDB on first use so reloads skip ~63 dead textures immediately,
	// avoiding wasted grid fetches + event-loop-blocking J2C decodes for known-bad UUIDs.
	texFailedLoad().then(uuids => { for (const u of uuids) failedHard.add(u) })
}

// Free an in-flight slot and start the next queued fetch (if any).
// WHY gate on the shared APP budget, not a fixed texture-only cap (FEATURE-GAPS #13 near-aware textures,
// 2026-06-16): the old fixed 320 MB `TEX_INTAKE_BUDGET` STRANDED intake on a warm heavy region. Warm IDB
// hits bypass this gate and fill `cache` well past 320 MB (live: cached=3375 ≈ 0.5–0.9 GB), after which
// the pump pauses PERMANENTLY — and nothing frees room, because pruneTexturesLRU only runs when over the
// ~2 GB app budget, which a warm region doesn't reach. Result: inflight=0, queued=4472, done=24 — wedged,
// not slow. Gating on `appRatio()` instead lets textures use real app headroom (≈1.7 GB unused there),
// and when they DO fill the app budget the culler trades far GEOMETRY + pruneTexturesLRU sheds far/old
// textures (LRU = near-aware: near faces are re-applied within 20 s so they're protected). emergencyHeap()
// remains the hard near-OOM stop. Near-first heap-pop is unchanged so visible faces still fetch first.
function _pump() {
	while (active < MAX_INFLIGHT && netQueue.length && !(emergencyHeap() || appRatio() >= 1.0)) {
		active++
		heapPop(netQueue).run()   // nearest queued fetch first (near-first load)
	}
}

// Re-pump from a periodic caller (the world-engine drain tick) so queued fetches resume after the
// governor pauses them — _pump is otherwise only re-triggered when a slot frees.
export function pumpTextures() { _pump() }

/** Engine injects the THREE renderer so the build pump can upload deterministically (initTexture).
 *  If never set (e.g. tests, pre-init), textures fall back to lazy upload at render() — no hard dep. */
export function setTextureRenderer(r) { _renderer = r }

// S.ASSET_DATA → resolve the pending WS request with a WebP Blob (or null on error/missing).
function _onAssetData(d) {
	if (!d || d.assetType !== 'texture') return
	const p = pending.get(d.uuid)
	if (p) pending.delete(d.uuid)
	if (d.error || !d.dataB64) { stats.failed++; failedHard.add(d.uuid); texFailedMark(d.uuid); p?.resolve(null); return }
	stats.done++
	if (typeof d.tMs === 'number') _acc('srv', d.tMs)   // DIAG(webp-trickle)
	alphaCache.set(d.uuid, !!d.hasAlpha)
	let blob = null
	try { blob = b64ToBlob(d.dataB64, d.mime || 'image/webp') } catch { /* malformed payload */ }
	if (p) { p.resolve(blob); return }
	if (!blob) return
	// Late arrival — the request already timed out and freed its slot, but the transcode is paid
	// for. Persist it to IDB and clear the timeout strikes so the next soft-retry succeeds from
	// cache instantly. WHY: when the grid answers consistently just above FETCH_TIMEOUT_MS, every
	// batch times out, the late data was discarded, and the retry refetched from scratch — observed
	// as 8.8k queued textures with 12 slots recycling on timeout and zero forward progress for
	// minutes. Persisting late arrivals converts that loop into steady progress at the server's
	// real throughput. (IDB only, NOT blobCache: thousands of pending Blobs in a Map would be its
	// own heap hog; texCacheGet picks them up fine.)
	stats.late++
	softAttempts.delete(d.uuid)
	texCachePut(d.uuid, blob, !!d.hasAlpha)
}

// Fetch a texture's WebP bytes from the server over WS, gated by MAX_INFLIGHT. Resolves the Blob
// or null (timeout/miss). The slot is held from emit() until S.ASSET_DATA or timeout, so the server's
// serialized J2C decoder is never asked for more than MAX_INFLIGHT textures at once.
function _wsFetch(uuid, priority = Infinity) {
	_wire()
	stats.requested++
	return new Promise(resolve => {
		const tQueued = performance.now()   // DIAG(webp-trickle)
		const run = async () => {
			const tRun = performance.now()           // DIAG(webp-trickle)
			_acc('qWait', tRun - tQueued)            // DIAG(webp-trickle)
			// The queue can be thousands deep (hours of slot-time at 12×30s) and late arrivals
			// land in IDB the whole while. Re-check the caches when the slot finally opens —
			// settling from IDB here costs ~ms instead of a 30s timeout AND another server-queue
			// entry (re-asks are what keep the server's FIFO minutes deep in the first place).
			const cachedBlob = blobCache.get(uuid)
				?? await texCacheGet(uuid).then(c => { if (c) alphaCache.set(uuid, c.hasAlpha); return c?.blob ?? null }).catch(() => null)
			_acc('idb', performance.now() - tRun)    // DIAG(webp-trickle)
			if (cachedBlob) { active--; _pump(); resolve(cachedBlob); return }
			const { emit } = useRealtimeSocket()
			// settle() runs exactly once: frees the slot, pumps the queue, resolves. Both the data
			// path (via pending.resolve) and the timeout path go through it.
			let settled = false
			let tEmit = 0   // DIAG(webp-trickle)
			const settle = (blob, viaTimeout = false) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				pending.delete(uuid)
				if (!viaTimeout && tEmit) _acc('net', performance.now() - tEmit)   // DIAG(webp-trickle)
				active--
				_pump()
				resolve(blob)
			}
			// WHY timeout: a UUID the sim can't serve never produces S.ASSET_DATA; without this the
			// resolver, the inflight entry, AND the slot would leak forever (starving the queue).
			const timer = setTimeout(() => {
				stats.timeout++
				softAttempts.set(uuid, (softAttempts.get(uuid) || 0) + 1)  // retryable: server was slow
				settle(null, true)
			}, FETCH_TIMEOUT_MS)
			pending.set(uuid, { resolve: settle, timer })
			tEmit = performance.now()   // DIAG(webp-trickle)
			emit(C.ASSET_FETCH, { assetType: 'texture', uuid })
		}
		// active was already incremented by _pump(); queue + pump keeps the bookkeeping in one place.
		heapPush(netQueue, { run, priority })   // min-heap by distance; _pump dispatches nearest first
		_pump()
	})
}

/** Live fetch counters (textures). For watching steady population / confirming the cap holds. */
export function getTextureStats() {
	// DIAG(webp-trickle): avg/max per slot-cycle leg. net includes client event-loop delay + transit +
	// server time; srv is the server handler's own measure — (net − srv) ≈ loop/transit overhead.
	const f = (t) => ({ n: t.n, avg: t.n ? Math.round(t.ms / t.n) : 0, max: Math.round(t.max) })
	return {
		...stats, inflight: active, queued: netQueue.length, buildQueued: buildQueue.length, cached: cache.size, hardFail: failedHard.size, softWait: softAttempts.size,
		timing: { qWait: f(timing.qWait), idb: f(timing.idb), net: f(timing.net), srv: f(timing.srv) },
	}
}

// DIAG(webp-trickle): console access to the LIVE module instance — a bare dynamic import from
// DevTools can resolve a second, zero-counter copy after an HMR update. Dev-only.
if (import.meta.env.DEV) globalThis.__texStats = getTextureStats

// Estimated JS-heap bytes held by resident texture bitmaps (decoded RGBA: w*h*4 per base texture).
// UV-transform clones share the base's image source, so only base textures are counted.
export function getTextureBytes() {
	let b = 0
	for (const tex of cache.values()) {
		const img = tex?.image
		if (img?.width) b += img.width * img.height * 4
	}
	return b
}

// Resolve a UUID to its WebP Blob through all cache layers. Deduped; populates IDB on a miss.
function getBlob(uuid, priority = Infinity) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (blobCache.has(uuid)) return Promise.resolve(blobCache.get(uuid))
	if (failedHard.has(uuid)) return Promise.resolve(null)                       // server errored — never retry
	if ((softAttempts.get(uuid) || 0) >= MAX_SOFT_RETRY) return Promise.resolve(null)  // timed out too many times
	if (blobInflight.has(uuid)) return blobInflight.get(uuid)

	const p = (async () => {
		const cached = await texCacheGet(uuid)         // IndexedDB (survives reloads). #11: the read's
		// watchdog is raised (see GET_WATCHDOG_MS) so a slow-but-completing read RESOLVES THE REAL BLOB
		// here instead of false-missing → network. Only a genuine miss (fast null) or a truly-stuck
		// read (past the long watchdog) falls through to the network — no refetch storm.
		if (cached) { blobCache.set(uuid, cached.blob); alphaCache.set(uuid, cached.hasAlpha); return cached.blob }
		const net = await _wsFetch(uuid, priority)     // server fetch + transcode (sets alphaCache)
		if (net) { blobCache.set(uuid, net); texCachePut(uuid, net, alphaCache.get(uuid) ?? false); return net }   // persist for next time
		// null here = hard error (failedHard set in _onAssetData) or timeout (softAttempts bumped in
		// _wsFetch). Either way classified already — a later getBlob call retries soft ones.
		return null
	})().then(blob => { blobInflight.delete(uuid); return blob })

	blobInflight.set(uuid, p)
	return p
}

// Client-side resident-texture dimension cap. WHY: a dense region holds thousands of THREE.Textures;
// each retains its decoded image in memory at the source size. At 512² that's ~1 MB each — 3.4k
// textures ≈ 3.4 GB, which alone fills Chrome's ~4 GB tab heap and stalls/crashes the load. Downscaling
// the resident image to ≤256² quarters that (~0.9 GB) regardless of the cached WebP size, trading some
// sharpness for the ability to load the whole region.
const MAX_TEX_DIM = 256

// Build a THREE.Texture from a WebP Blob, downscaling the resident image to MAX_TEX_DIM.
// WHY imageOrientation:'flipY' + tex.flipY=false: the old path uploaded an <img> with Three's
// default flipY=true (UNPACK_FLIP_Y_WEBGL). WebGL IGNORES that pixel-store flag for ImageBitmap
// sources, so we bake the flip into the decode instead and disable Three's flip — otherwise the
// canvas-downscale branch (a canvas DOES honor the flag) and the direct-bitmap branch would
// disagree on orientation. Both branches now carry pre-flipped pixels + flipY=false → UVs match
// the previous Image-element behavior exactly.
// WHY premultiplyAlpha:'none': WebGL ignores texture.premultiplyAlpha for ImageBitmap sources —
// the creation-time option governs, and the browser default may premultiply (darkened cutout
// edges vs the old straight-alpha <img> path); 'none' pins straight alpha.
async function buildTexture(blob) {
	let bitmap
	try { bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' }) } catch { return null }
	let source = bitmap
	const longest = Math.max(bitmap.width, bitmap.height)
	if (longest > MAX_TEX_DIM) {
		const s = MAX_TEX_DIM / longest
		const cw = Math.max(1, Math.round(bitmap.width * s))
		const ch = Math.max(1, Math.round(bitmap.height * s))
		const canvas = document.createElement('canvas')
		canvas.width = cw; canvas.height = ch
		const ctx = canvas.getContext('2d')
		if (ctx) { ctx.drawImage(bitmap, 0, 0, cw, ch); source = canvas; bitmap.close?.() }
	}
	const tex = new THREE.Texture(source)
	tex.flipY = false
	tex.colorSpace = THREE.SRGBColorSpace
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping
	tex.needsUpdate = true
	return tex
}

// Base texture for a UUID (no UV transform). Cached + deduped at the GPU-texture layer.
function getBaseTexture(uuid, priority = Infinity) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (cache.has(uuid))       { lastUsed.set(uuid, Date.now()); return Promise.resolve(cache.get(uuid)) }
	if (texInflight.has(uuid)) return texInflight.get(uuid)

	// Blob-ready is cheap; defer the expensive buildTexture+upload to the per-frame budgeted pump.
	const p = getBlob(uuid, priority).then(blob => {
		if (!blob) { texInflight.delete(uuid); return null }
		return new Promise((resolve) => { buildQueue.push({ uuid, blob, resolve }) })
	})

	texInflight.set(uuid, p)
	return p
}

// One build job: decode+downscale (buildTexture), upload now (initTexture, off the render() critical
// path), then run the post-build bookkeeping getBaseTexture used to do and resolve the awaiting
// promise. Async — the pump dispatches these at a bounded rate; continuations land as decode
// completes. A failed decode resolves null (consumer keeps its placeholder).
async function _processBuild({ uuid, blob, resolve }) {
	let tex = null
	try { tex = await buildTexture(blob) } catch { /* buildTexture currently returns null on failure; guard future changes */ }
	texInflight.delete(uuid)
	if (tex) {
		try { _renderer?.initTexture(tex) } catch { /* lazy upload at render() remains the fallback */ }
		tex.userData.hasAlpha = alphaCache.get(uuid) || false
		cache.set(uuid, tex)
		lastUsed.set(uuid, Date.now())
		// Free the in-memory Blob mirror now the GPU texture exists — thousands of resident
		// Blobs would be their own heap hog. Previews re-read IndexedDB on demand via
		// getTextureUrl; the GPU texture is what rendering needs.
		blobCache.delete(uuid)
	}
	resolve(tex)
}

/** Drain the texture build queue within this frame's budget. Driven once per frame by the engine. */
export function pumpTextureBuilds() {
	return drainWithinBudget({
		queue: buildQueue,
		maxItems: TEX_BUILD_MAX_PER_FRAME,
		budgetMs: TEX_BUILD_BUDGET_MS,
		processOne: _processBuild,
		onError: (e) => console.warn('[Tex] build pump error:', e),
	})
}

/**
 * Resolve a texture UUID to a THREE.Texture, applying the TextureEntry UV transform
 * (repeats / offset / rotation). Returns null on missing/failed/zero UUID.
 *
 * Identity transform (SL defaults 1,1 / 0,0 / 0) returns the shared base texture. Non-identity
 * returns a clone cached by uuid+transform — so prims sharing the same texture+transform reuse ONE
 * GPU texture instead of mutating the shared base (which would corrupt every other prim using it).
 */
// Synchronous "is the base GPU texture already resident?" peek. Returns the cached THREE.Texture or
// null WITHOUT kicking off a fetch — used by the instancing migrate pass as a readiness gate (the
// async getTexture() always returns a truthy Promise, so it can't gate "ready vs not-ready").
export function peekTexture(uuid) {
	if (!uuid || uuid === ZERO_UUID) return null
	const t = cache.get(uuid)
	if (t) lastUsed.set(uuid, Date.now())   // counted as applied → protect from LRU prune
	return t || null
}

export function getTexture(uuid, xform = null, priority = Infinity) {
	if (uuid) lastUsed.set(uuid, Date.now())   // applied now → protect from LRU prune
	const baseP = getBaseTexture(uuid, priority)
	if (isIdentityXform(xform)) return baseP
	const key = `${uuid}|${xform.repeat[0]}|${xform.repeat[1]}|${xform.offset[0]}|${xform.offset[1]}|${xform.rotation}`
	if (xformCache.has(key)) return Promise.resolve(xformCache.get(key))
	return baseP.then(base => {
		if (!base) return null
		if (xformCache.has(key)) return xformCache.get(key)
		const t = base.clone()
		t.userData.hasAlpha = base.userData.hasAlpha
		t.wrapS = t.wrapT = THREE.RepeatWrapping
		t.repeat.set(xform.repeat[0], xform.repeat[1])
		t.offset.set(xform.offset[0], xform.offset[1])
		t.center.set(0.5, 0.5)            // rotate/scale about the face center (SL behavior)
		t.rotation = xform.rotation
		t.colorSpace = THREE.SRGBColorSpace
		t.needsUpdate = true
		xformCache.set(key, t)
		return t
	})
}

/** Resolve a texture UUID to an object URL for an <img> preview. Null on missing/failed.
 *  Cached + reused per uuid; revoked by pruneTexturesLRU / clearTextureCache. */
export function getTextureUrl(uuid) {
	const existing = objUrlCache.get(uuid)
	if (existing) return Promise.resolve(existing)
	return getBlob(uuid).then(blob => {
		if (!blob) return null
		const u = URL.createObjectURL(blob)
		objUrlCache.set(uuid, u)
		return u
	})
}

// Drop up to `maxPerCall` least-recently-applied textures (base + their UV clones) from the in-memory
// Maps — WITHOUT calling dispose(). WHY no dispose: a texture may still be the .map of a VISIBLE mesh's
// material (textures are shared across prims); disposing would render that face broken and backfill
// would not heal it (the .map isn't null). Instead we just release our Map references: textures used
// only by already-evicted meshes then have zero references and the GC frees their decoded image (the
// ~0.25 MB JS-heap hog); textures still on a resident mesh stay alive via that material's reference, so
// nothing blanks. Re-fetched from IDB if needed again. Skips anything applied within TEX_PRUNE_AGE_MS.
// Called by the cull tick ONLY while over the memory budget, so the steady state never churns.
// (GPU-side disposal of evicted-mesh textures needs ref-counting — tracked as follow-up; the immediate
// crash is JS-heap, which GC reclaims here.) Returns count dropped.
export function pruneTexturesLRU(maxPerCall = 64, now = Date.now()) {
	if (!cache.size) return 0
	const eligible = []
	for (const uuid of cache.keys()) {
		if (now - (lastUsed.get(uuid) || 0) > TEX_PRUNE_AGE_MS) eligible.push(uuid)
	}
	eligible.sort((a, b) => (lastUsed.get(a) || 0) - (lastUsed.get(b) || 0))   // oldest first
	let n = 0
	for (const uuid of eligible) {
		if (n >= maxPerCall) break
		cache.delete(uuid); lastUsed.delete(uuid); alphaCache.delete(uuid)
		blobCache.delete(uuid)
		const ou = objUrlCache.get(uuid); if (ou) { URL.revokeObjectURL(ou); objUrlCache.delete(uuid) }
		const prefix = uuid + '|'
		for (const k of [...xformCache.keys()]) if (k.startsWith(prefix)) xformCache.delete(k)
		n++
	}
	return n
}

/**
 * Force a fresh re-fetch of specific texture UUIDs — the manual "Refresh textures" escape hatch for an
 * object stuck bare (hard-errored or soft-timed-out past the retry budget). Clears EVERY in-memory layer
 * for each uuid (failure classes, GPU/blob caches, in-flight dedupes, UV clones, object URLs) plus the
 * persisted IDB negative-cache mark, so the next getTexture() re-pulls through IDB→network. Does NOT
 * dispose live THREE.Textures: another mesh may still reference one via its material.map (textures are
 * shared) — dropping our cache entry just means a fresh copy is built on the next fetch. The engine
 * re-applies to the object's mesh after calling this; _pump() resumes any queue freed by clearing fails.
 */
export function refreshTextures(uuids) {
	for (const uuid of uuids) {
		if (!uuid || uuid === ZERO_UUID) continue
		failedHard.delete(uuid)
		softAttempts.delete(uuid)
		cache.delete(uuid)
		blobCache.delete(uuid)
		blobInflight.delete(uuid)
		texInflight.delete(uuid)
		lastUsed.delete(uuid)
		alphaCache.delete(uuid)
		const ou = objUrlCache.get(uuid); if (ou) { URL.revokeObjectURL(ou); objUrlCache.delete(uuid) }
		const prefix = uuid + '|'
		for (const k of [...xformCache.keys()]) if (k.startsWith(prefix)) xformCache.delete(k)
		texFailedClear(uuid)   // best-effort: drop the persisted negative-cache mark too
	}
	_pump()
}

/**
 * Free in-memory/GPU textures (call on engine teardown). Does NOT clear the IndexedDB cache —
 * that persistence is the whole point; next session repopulates the in-memory layer from it fast.
 */
export function clearTextureCache() {
	for (const tex of cache.values()) tex.dispose?.()
	for (const tex of xformCache.values()) tex.dispose?.()
	cache.clear()
	xformCache.clear()
	for (const u of objUrlCache.values()) URL.revokeObjectURL(u)
	objUrlCache.clear()
	blobCache.clear()
	alphaCache.clear()
	failedHard.clear()
	softAttempts.clear()
}

export function useTextureFetch() {
	return { getTexture, getTextureUrl, clearTextureCache }
}
