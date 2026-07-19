// src/composables/useAnimFetch.js — fetch + decode SL animation assets by UUID (bundle 7·D).
//
// Rides the generic asset path (C.ASSET_FETCH assetType:'animation' → ViewerAsset ?animatn_id=,
// same lane sounds use — server side already existed). The raw .anim bytes decode in the browser
// (shared/animDecode.js) and land in the animPlayer registry; callers get back "is it playable".
// Decoded anims are tiny (KBs of keys) and global by UUID, so a plain module Map + the server's
// disk tier is cache enough — no IDB lane needed.
import { useRealtimeSocket } from './useRealtimeSocket'
import { C, S } from '@shared/protocol.js'
import { decodeAnimAsset } from '@shared/animDecode.js'
import { registerAnim, hasAnim } from '@/lib/animPlayer.js'

const FETCH_TIMEOUT_MS = 20_000
const _failed = new Set()     // UUIDs that 404'd or failed decode — never re-ask this session
const _pending = new Map()    // uuid → { resolve, timer } — awaiting S.ASSET_DATA
const _inflight = new Map()   // uuid → Promise<boolean> — coalesces concurrent asks
const stats = { requested: 0, done: 0, failed: 0 }

let _wired = false
function _wire() { if (_wired) return; _wired = true; useRealtimeSocket().on(S.ASSET_DATA, _on, 'animfetch:asset') }

function _on(d) {
	if (!d || d.assetType !== 'animation') return
	const p = _pending.get(d.uuid)
	if (!p) return
	_pending.delete(d.uuid)
	clearTimeout(p.timer)
	if (d.error || !d.dataB64) { p.resolve(false); return }
	try {
		const bin = atob(d.dataB64)
		const u8 = new Uint8Array(bin.length)
		for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
		registerAnim(d.uuid, decodeAnimAsset(u8))
		p.resolve(true)
	} catch (e) {
		console.warn(`[Anim] decode failed ${d.uuid}: ${e?.message || e}`)
		p.resolve(false)
	}
}

/** Ensure an animation asset is decoded + registered. Resolves true when playable. */
export function getAnim(uuid) {
	if (!uuid) return Promise.resolve(false)
	if (hasAnim(uuid)) return Promise.resolve(true)
	if (_failed.has(uuid)) return Promise.resolve(false)
	let p = _inflight.get(uuid)
	if (p) return p
	_wire()
	stats.requested++
	p = new Promise(resolve => {
		// WHY timeout: an asset the grid can't serve never produces S.ASSET_DATA — without this the
		// resolver leaks and the avatar's pending-anim entry stays wedged forever.
		const timer = setTimeout(() => { _pending.delete(uuid); resolve(false) }, FETCH_TIMEOUT_MS)
		_pending.set(uuid, { resolve, timer })
		useRealtimeSocket().emit(C.ASSET_FETCH, { assetType: 'animation', uuid })
	}).then(ok => {
		_inflight.delete(uuid)
		if (ok) stats.done++
		else { stats.failed++; _failed.add(uuid) }
		return ok
	})
	_inflight.set(uuid, p)
	return p
}

/** Live counters (debug). */
export function getAnimStats() { return { ...stats, inflight: _inflight.size } }
