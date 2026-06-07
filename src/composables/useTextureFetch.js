// src/composables/useTextureFetch.js — fetch SL/OpenSim textures by UUID and hand back THREE.Texture.
// Layers (cheapest first): in-memory THREE.Texture cache → in-memory data-URL mirror → IndexedDB
// (persists across reload/relogin, see lib/textureCache.js) → server fetch (C.ASSET_FETCH →
// ViewerAsset/GetTexture cap → J2C→PNG → S.ASSET_DATA). Per-layer dedupe + a negative cache stop
// repeated calls and thrash on the same (or dead) UUIDs.
import * as THREE from 'three'
import { useRealtimeSocket } from './useRealtimeSocket'
import { texCacheGet, texCachePut } from '@/lib/textureCache.js'
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

// Live counters so we can watch steady population (vs flooding) — see getTextureStats().
const stats = { requested: 0, done: 0, failed: 0, timeout: 0 }

const EPS = 1e-4
const isIdentityXform = (x) =>
	!x || (Math.abs(x.repeat[0] - 1) < EPS && Math.abs(x.repeat[1] - 1) < EPS &&
	       Math.abs(x.offset[0]) < EPS && Math.abs(x.offset[1]) < EPS && Math.abs(x.rotation) < EPS)

let _wired = false
function _wire() {
	if (_wired) return
	_wired = true
	useRealtimeSocket().on(S.ASSET_DATA, _onAssetData)
}

// Free an in-flight slot and start the next queued fetch (if any).
function _pump() {
	while (active < MAX_INFLIGHT && netQueue.length) { active++; netQueue.shift()() }
}

// S.ASSET_DATA → resolve the pending WS request with a data URL (or null on error/missing).
function _onAssetData(d) {
	if (!d || d.assetType !== 'texture') return
	const p = pending.get(d.uuid)
	if (!p) return            // already timed out (slot already freed) — ignore late arrival
	pending.delete(d.uuid)
	if (d.error || !d.dataB64) { stats.failed++; failedHard.add(d.uuid); p.resolve(null); return }
	stats.done++
	alphaCache.set(d.uuid, !!d.hasAlpha)
	p.resolve(`data:${d.mime || 'image/png'};base64,${d.dataB64}`)
}

// Fetch a texture's PNG bytes from the server over WS, gated by MAX_INFLIGHT. Resolves the data URL
// or null (timeout/miss). The slot is held from emit() until S.ASSET_DATA or timeout, so the server's
// serialized J2C decoder is never asked for more than MAX_INFLIGHT textures at once.
function _wsFetch(uuid) {
	_wire()
	stats.requested++
	return new Promise(resolve => {
		const run = () => {
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

// Build a THREE.Texture from a PNG data URL.
function buildTexture(url) {
	return new Promise(resolve => {
		const img = new Image()
		img.onload = () => {
			const tex = new THREE.Texture(img)
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
	if (cache.has(uuid))       return Promise.resolve(cache.get(uuid))
	if (texInflight.has(uuid)) return texInflight.get(uuid)

	const p = getDataUrl(uuid)
		.then(url => (url ? buildTexture(url) : null))
		.then(tex => {
			texInflight.delete(uuid)
			if (tex) {
				tex.userData.hasAlpha = alphaCache.get(uuid) || false
				cache.set(uuid, tex)
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
