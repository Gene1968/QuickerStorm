// src/composables/useTextureFetch.js — fetch SL/OpenSim textures by UUID and hand back THREE.Texture.
// Layers (cheapest first): in-memory THREE.Texture cache → in-memory data-URL mirror → IndexedDB
// (persists across reload/relogin, see lib/textureCache.js) → server fetch (C.ASSET_FETCH →
// ViewerAsset/GetTexture cap → J2C→PNG → S.ASSET_DATA). Per-layer dedupe + a negative cache stop
// repeated calls and thrash on the same (or dead) UUIDs.
import * as THREE from 'three'
import { useRealtimeSocket } from './useRealtimeSocket'
import { texCacheGet, texCachePut, texFailedLoad, texFailedMark } from '@/lib/textureCache.js'
import { emergencyHeap } from '@/lib/memGovernor.js'
import { C, S } from '@shared/protocol.js'

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'
const FETCH_TIMEOUT_MS = 30_000
// WHY cap: a region delivers ~1-2k textures. The server transcodes J2C→PNG on a single-instance
// WASM decoder (CPU-bound, serialized on the event loop). Firing every request at once means the
// late ones sit behind hundreds of decodes and blow FETCH_TIMEOUT_MS → negative-cached → invisible
// for the session, and which ones win the race varies per load. Cap concurrent network fetches like
// useMeshFetch does so the queue drains steadily instead of flooding. (texCacheGet/IDB hits and
// in-memory hits don't go through the cap — only true network fetches do.)
// 12: live telemetry showed 0 timeouts at 6 and ~1.3 fetches/s (grid round-trip bound, parallelizable)
// → headroom to roughly double throughput. Raise further only if timeouts stay 0.
const MAX_INFLIGHT = 12

const cache       = new Map()  // uuid → THREE.Texture (base, GPU)
const texInflight = new Map()  // uuid → Promise<THREE.Texture|null>
const urlInflight = new Map()  // uuid → Promise<string|null>  (IDB-or-network data URL)
const pending     = new Map()  // uuid → { resolve, timer }     (in-flight WS request)
const xformCache  = new Map()  // `uuid|repS|repT|offS|offT|rot` → cloned THREE.Texture w/ UV transform
const urlCache    = new Map()  // uuid → PNG data URL (sync mirror; thumbnails + fast re-reads)
const alphaCache  = new Map()  // uuid → bool: PNG carries real transparency (drives blend vs opaque)
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
// WHY a texture-OWN budget (not the shared app budget): on a dense region the geometry pool
// saturates the global budget permanently, which paused texture intake to a trickle — the scene
// finished building but stayed white (observed: ⏱0 timeouts yet ~0.3 fetches/s, intake only during
// momentary budget dips). Textures now gate on their own resident bytes; as they fill, the global
// budget rises and the culler trades far GEOMETRY for them — the right swap, since near geometry
// is R_NEAR-protected and pruneTexturesLRU bounds this pool under pressure. emergencyHeap() stays
// as the true near-OOM stop.
const TEX_INTAKE_BUDGET = 320 * 1048576
function _pump() {
	while (active < MAX_INFLIGHT && netQueue.length && !(emergencyHeap() || getTextureBytes() > TEX_INTAKE_BUDGET)) { active++; netQueue.shift()() }
}

// Re-pump from a periodic caller (the world-engine drain tick) so queued fetches resume after the
// governor pauses them — _pump is otherwise only re-triggered when a slot frees.
export function pumpTextures() { _pump() }

// S.ASSET_DATA → resolve the pending WS request with a data URL (or null on error/missing).
function _onAssetData(d) {
	if (!d || d.assetType !== 'texture') return
	const p = pending.get(d.uuid)
	if (p) pending.delete(d.uuid)
	if (d.error || !d.dataB64) { stats.failed++; failedHard.add(d.uuid); texFailedMark(d.uuid); p?.resolve(null); return }
	stats.done++
	alphaCache.set(d.uuid, !!d.hasAlpha)
	const url = `data:${d.mime || 'image/png'};base64,${d.dataB64}`
	if (p) { p.resolve(url); return }
	// Late arrival — the request already timed out and freed its slot, but the transcode is paid
	// for. Persist it to IDB and clear the timeout strikes so the next soft-retry succeeds from
	// cache instantly. WHY: when the grid answers consistently just above FETCH_TIMEOUT_MS, every
	// batch times out, the late data was discarded, and the retry refetched from scratch — observed
	// as 8.8k queued textures with 12 slots recycling on timeout and zero forward progress for
	// minutes. Persisting late arrivals converts that loop into steady progress at the server's
	// real throughput. (IDB only, NOT urlCache: thousands of pending data-URL strings in a Map
	// would be its own heap hog; texCacheGet picks them up fine.)
	stats.late++
	softAttempts.delete(d.uuid)
	texCachePut(d.uuid, url, !!d.hasAlpha)
}

// Fetch a texture's PNG bytes from the server over WS, gated by MAX_INFLIGHT. Resolves the data URL
// or null (timeout/miss). The slot is held from emit() until S.ASSET_DATA or timeout, so the server's
// serialized J2C decoder is never asked for more than MAX_INFLIGHT textures at once.
function _wsFetch(uuid) {
	_wire()
	stats.requested++
	return new Promise(resolve => {
		const run = async () => {
			// The queue can be thousands deep (hours of slot-time at 12×30s) and late arrivals
			// land in IDB the whole while. Re-check the caches when the slot finally opens —
			// settling from IDB here costs ~ms instead of a 30s timeout AND another server-queue
			// entry (re-asks are what keep the server's FIFO minutes deep in the first place).
			const cachedUrl = urlCache.get(uuid)
				?? await texCacheGet(uuid).then(c => { if (c) alphaCache.set(uuid, c.hasAlpha); return c?.url ?? null }).catch(() => null)
			if (cachedUrl) { active--; _pump(); resolve(cachedUrl); return }
			const { emit } = useRealtimeSocket()
			// settle() runs exactly once: frees the slot, pumps the queue, resolves. Both the data
			// path (via pending.resolve) and the timeout path go through it.
			let settled = false
			const settle = (url) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				pending.delete(uuid)
				active--
				_pump()
				resolve(url)
			}
			// WHY timeout: a UUID the sim can't serve never produces S.ASSET_DATA; without this the
			// resolver, the inflight entry, AND the slot would leak forever (starving the queue).
			const timer = setTimeout(() => {
				stats.timeout++
				softAttempts.set(uuid, (softAttempts.get(uuid) || 0) + 1)  // retryable: server was slow
				settle(null)
			}, FETCH_TIMEOUT_MS)
			pending.set(uuid, { resolve: settle, timer })
			emit(C.ASSET_FETCH, { assetType: 'texture', uuid })
		}
		// active was already incremented by _pump(); queue + pump keeps the bookkeeping in one place.
		netQueue.push(run)
		_pump()
	})
}

/** Live fetch counters (textures). For watching steady population / confirming the cap holds. */
export function getTextureStats() {
	return { ...stats, inflight: active, queued: netQueue.length, cached: cache.size, hardFail: failedHard.size, softWait: softAttempts.size }
}

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

// Resolve a UUID to its PNG data URL through all cache layers. Deduped; populates IDB on a miss.
function getDataUrl(uuid) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (urlCache.has(uuid)) return Promise.resolve(urlCache.get(uuid))
	if (failedHard.has(uuid)) return Promise.resolve(null)                       // server errored — never retry
	if ((softAttempts.get(uuid) || 0) >= MAX_SOFT_RETRY) return Promise.resolve(null)  // timed out too many times
	if (urlInflight.has(uuid)) return urlInflight.get(uuid)

	const p = (async () => {
		const cached = await texCacheGet(uuid)         // IndexedDB (survives reloads)
		if (cached) { urlCache.set(uuid, cached.url); alphaCache.set(uuid, cached.hasAlpha); return cached.url }
		const net = await _wsFetch(uuid)               // server fetch + transcode (sets alphaCache)
		if (net) { urlCache.set(uuid, net); texCachePut(uuid, net, alphaCache.get(uuid) ?? false); return net }   // persist for next time
		// null here = hard error (failedHard set in _onAssetData) or timeout (softAttempts bumped in
		// _wsFetch). Either way classified already — a later getDataUrl call retries soft ones.
		return null
	})().then(url => { urlInflight.delete(uuid); return url })

	urlInflight.set(uuid, p)
	return p
}

// Client-side resident-texture dimension cap. WHY: a dense region holds thousands of THREE.Textures;
// each retains its decoded image in memory at the source PNG size. At 512² that's ~1 MB each — 3.4k
// textures ≈ 3.4 GB, which alone fills Chrome's ~4 GB tab heap and stalls/crashes the load. Downscaling
// the resident image to ≤256² quarters that (~0.9 GB) regardless of the cached PNG size, trading some
// sharpness for the ability to load the whole region. The source img is dropped (GC'd) after the draw.
const MAX_TEX_DIM = 256

// Build a THREE.Texture from a PNG data URL, downscaling the resident image to MAX_TEX_DIM.
function buildTexture(url) {
	return new Promise(resolve => {
		const img = new Image()
		img.onload = () => {
			let source = img
			const longest = Math.max(img.width, img.height)
			if (longest > MAX_TEX_DIM) {
				const s = MAX_TEX_DIM / longest
				const cw = Math.max(1, Math.round(img.width * s))
				const ch = Math.max(1, Math.round(img.height * s))
				const canvas = document.createElement('canvas')
				canvas.width = cw; canvas.height = ch
				const ctx = canvas.getContext('2d')
				if (ctx) { ctx.drawImage(img, 0, 0, cw, ch); source = canvas }
			}
			const tex = new THREE.Texture(source)
			tex.colorSpace = THREE.SRGBColorSpace
			tex.wrapS = tex.wrapT = THREE.RepeatWrapping
			tex.needsUpdate = true
			resolve(tex)
		}
		img.onerror = () => resolve(null)
		img.src = url
	})
}

// Base texture for a UUID (no UV transform). Cached + deduped at the GPU-texture layer.
function getBaseTexture(uuid) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (cache.has(uuid))       { lastUsed.set(uuid, Date.now()); return Promise.resolve(cache.get(uuid)) }
	if (texInflight.has(uuid)) return texInflight.get(uuid)

	const p = getDataUrl(uuid)
		.then(url => (url ? buildTexture(url) : null))
		.then(tex => {
			texInflight.delete(uuid)
			if (tex) {
				tex.userData.hasAlpha = alphaCache.get(uuid) || false
				cache.set(uuid, tex)
				lastUsed.set(uuid, Date.now())
				// Free the in-memory PNG data URL now the GPU texture exists — these strings are big
				// (100s of KB–MB each × ~1500 textures = the tab-crashing heap hog). Thumbnails re-read
				// IndexedDB on demand via getTextureUrl; the GPU texture is what rendering needs.
				urlCache.delete(uuid)
			}
			return tex
		})

	texInflight.set(uuid, p)
	return p
}

/**
 * Resolve a texture UUID to a THREE.Texture, applying the TextureEntry UV transform
 * (repeats / offset / rotation). Returns null on missing/failed/zero UUID.
 *
 * Identity transform (SL defaults 1,1 / 0,0 / 0) returns the shared base texture. Non-identity
 * returns a clone cached by uuid+transform — so prims sharing the same texture+transform reuse ONE
 * GPU texture instead of mutating the shared base (which would corrupt every other prim using it).
 */
export function getTexture(uuid, xform = null) {
	if (uuid) lastUsed.set(uuid, Date.now())   // applied now → protect from LRU prune
	const baseP = getBaseTexture(uuid)
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

/** Resolve a texture UUID to its PNG data URL (for an <img> preview). Null on missing/failed. */
export function getTextureUrl(uuid) {
	return getDataUrl(uuid)
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
		cache.delete(uuid); lastUsed.delete(uuid); urlCache.delete(uuid); alphaCache.delete(uuid)
		const prefix = uuid + '|'
		for (const k of [...xformCache.keys()]) if (k.startsWith(prefix)) xformCache.delete(k)
		n++
	}
	return n
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
	urlCache.clear()
	alphaCache.clear()
	failedHard.clear()
	softAttempts.clear()
}

export function useTextureFetch() {
	return { getTexture, getTextureUrl, clearTextureCache }
}
