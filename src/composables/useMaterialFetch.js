// src/composables/useMaterialFetch.js — fetch + cache prim material descriptors (GLTF PBR + legacy
// RenderMaterials). Mirrors useTextureFetch's in-memory cache + dedupe. Server resolves the cap and
// returns raw GLTF JSON (pbr) or a flat legacy record; the client maps/applies it.
import { useRealtimeSocket } from './useRealtimeSocket'
import { C, S } from '@shared/protocol.js'

const FETCH_TIMEOUT_MS = 30_000
const pbrCache    = new Map()  // uuid → GLTF json (or null)
const legacyCache = new Map()  // uuid → legacy record (or null)
const pending     = new Map()  // `${kind}:${uuid}` → resolve fn

let _wired = false
function _wire() {
	if (_wired) return
	_wired = true
	useRealtimeSocket().on(S.MATERIAL_DATA, _on)
}

function _on(d) {
	if (!d) return
	const cache = d.kind === 'pbr' ? pbrCache : legacyCache
	for (const [uuid, desc] of Object.entries(d.materials || {})) {
		cache.set(uuid, desc)
		const key = `${d.kind}:${uuid}`
		const r = pending.get(key)
		if (r) { pending.delete(key); r(desc) }
	}
}

function _fetch(kind, uuid) {
	if (!uuid) return Promise.resolve(null)
	const cache = kind === 'pbr' ? pbrCache : legacyCache
	if (cache.has(uuid)) return Promise.resolve(cache.get(uuid))
	_wire()
	const { emit } = useRealtimeSocket()
	const key = `${kind}:${uuid}`
	if (pending.has(key)) {
		const prev = pending.get(key)
		return new Promise(res => pending.set(key, v => { prev(v); res(v) }))
	}
	const p = new Promise(res => {
		const t = setTimeout(() => { pending.delete(key); cache.set(uuid, null); res(null) }, FETCH_TIMEOUT_MS)
		pending.set(key, v => { clearTimeout(t); res(v) })
	})
	emit(C.MATERIAL_FETCH, { kind, ids: [uuid] })
	return p
}

export function getPbrMaterial(uuid)    { return _fetch('pbr', uuid) }
export function getLegacyMaterial(uuid) { return _fetch('legacy', uuid) }
