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

const cache       = new Map()  // uuid → THREE.Texture (base, GPU)
const texInflight = new Map()  // uuid → Promise<THREE.Texture|null>
const urlInflight = new Map()  // uuid → Promise<string|null>  (IDB-or-network data URL)
const pending     = new Map()  // uuid → { resolve, timer }     (in-flight WS request)
const xformCache  = new Map()  // `uuid|repS|repT|offS|offT|rot` → cloned THREE.Texture w/ UV transform
const urlCache    = new Map()  // uuid → PNG data URL (sync mirror; thumbnails + fast re-reads)
const failed      = new Set()  // uuids the sim couldn't serve — don't re-request this session

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

// S.ASSET_DATA → resolve the pending WS request with a data URL (or null on error/missing).
function _onAssetData(d) {
	if (!d || d.assetType !== 'texture') return
	const p = pending.get(d.uuid)
	if (!p) return
	pending.delete(d.uuid)
	clearTimeout(p.timer)
	if (d.error || !d.dataB64) { p.resolve(null); return }
	p.resolve(`data:${d.mime || 'image/png'};base64,${d.dataB64}`)
}

// Fetch a texture's PNG bytes from the server over WS. Resolves the data URL or null (timeout/miss).
function _wsFetch(uuid) {
	_wire()
	const { emit } = useRealtimeSocket()
	const p = new Promise(resolve => {
		// WHY timeout: a UUID the sim can't serve never produces S.ASSET_DATA; without this the
		// resolver (and inflight entry) would leak forever.
		const timer = setTimeout(() => { pending.delete(uuid); resolve(null) }, FETCH_TIMEOUT_MS)
		pending.set(uuid, { resolve, timer })
	})
	emit(C.ASSET_FETCH, { assetType: 'texture', uuid })
	return p
}

// Resolve a UUID to its PNG data URL through all cache layers. Deduped; populates IDB on a miss.
function getDataUrl(uuid) {
	if (!uuid || uuid === ZERO_UUID) return Promise.resolve(null)
	if (urlCache.has(uuid)) return Promise.resolve(urlCache.get(uuid))
	if (failed.has(uuid))   return Promise.resolve(null)
	if (urlInflight.has(uuid)) return urlInflight.get(uuid)

	const p = (async () => {
		const cached = await texCacheGet(uuid)         // IndexedDB (survives reloads)
		if (cached) { urlCache.set(uuid, cached); return cached }
		const net = await _wsFetch(uuid)               // server fetch + transcode
		if (net) { urlCache.set(uuid, net); texCachePut(uuid, net); return net }   // persist for next time
		failed.add(uuid)
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
		.then(tex => { texInflight.delete(uuid); if (tex) cache.set(uuid, tex); return tex })

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
	failed.clear()
}

export function useTextureFetch() {
	return { getTexture, getTextureUrl, clearTextureCache }
}
