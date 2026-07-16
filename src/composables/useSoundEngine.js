/**
 * useSoundEngine.js — in-world sound playback (S-4/S-5/S-6).
 *
 * One-shot triggered sounds (SoundTrigger → llTriggerSound), looping/attached object sounds
 * (AttachedSound + ObjectUpdate sound fields → llLoopSound), and live gain changes
 * (AttachedSoundGainChange), all positional through Web Audio PannerNodes routed into the
 * "Sounds" channel bus from useAudio (source → gain → panner → soundsGain → master).
 *
 * Firestorm reference map (ALL protocol/behavior decisions ported, not derived):
 *   - process_sound_trigger                llviewermessage.cpp:4871
 *   - process_attached_sound              llviewermessage.cpp:5049
 *   - process_attached_sound_gain_change  llviewermessage.cpp:5106
 *   - postponed_sounds (object not yet arrived) llviewermessage.cpp:5093,
 *     MAXIMUM_PLAY_DELAY = 15 s           llviewermessage.cpp:4479
 *   - setAttachedSound null-UUID / dup-loop / stop semantics llviewerobject.cpp:6606-6700
 *   - LL_SOUND_FLAG_LOOP = 1<<0           lldefs.h:129
 *   - LL_SOUND_FLAG_STOP = 1<<5           lldefs.h:134
 *   - sound cutoff radius (<0.1 m = off; beyond radius = hard mute)
 *                                          llaudiosourcevo.cpp:63-82 checkCutOffRadius
 *   - attenuation: OpenAL inverse-distance model, refDistance 1, rolloff factor 1.0
 *     (AUDIO_LEVEL_ROLLOFF llvieweraudio.cpp:480; per-channel AL_ROLLOFF_FACTOR
 *     llaudioengine_openal.cpp:276)
 *
 * Listener position: sim-authoritative own-avatar position from worldStore.avatarPos
 * (updated by useWorldEngine from ObjectUpdate/TerseUpdate), sampled on the engine tick —
 * chosen over editing useWorldEngine (off-limits) or a rAF (150 ms is plenty for attenuation).
 */
import { S, C } from '@shared/protocol.js'
import { useRealtimeSocket } from '@/composables/useRealtimeSocket.js'
import { useWorldStore } from '@/stores/worldStore.js'
import { getSoundsBus } from '@/composables/useAudio.js'
import { createByteLRU } from '@/lib/byteLRU.js'

// ── Constants ─────────────────────────────────────────────────────────────────
export const LL_SOUND_FLAG_LOOP = 0x01        // FS lldefs.h:129
export const LL_SOUND_FLAG_STOP = 0x20        // FS lldefs.h:134
const FETCH_TIMEOUT_MS   = 15_000             // matches texture-fetch discipline (useTextureFetch)
const POSTPONE_TTL_MS    = 15_000             // FS MAXIMUM_PLAY_DELAY llviewermessage.cpp:4479
const TICK_MS            = 150                // listener + panner + cutoff refresh cadence
const MAX_ONESHOTS       = 32                 // bound concurrent one-shot sources (spam guard)
const BUFFER_LRU_BYTES   = 32 * 1024 * 1024   // decoded-PCM budget (~ a few min of stereo 44.1k)

const NULL_UUID = '00000000-0000-0000-0000-000000000000'
export function isNullUuid(id) { return !id || id === NULL_UUID }

function clamp01(v) { const n = Number(v); return isNaN(n) ? 0 : Math.min(1, Math.max(0, n)) }

// ── Pure helpers (unit-tested in src/__tests__/composables/useSoundEngine.test.js) ────────

/** Decoded AudioBuffer resident size (F32 PCM per channel). */
export function audioBufferBytes(buf) {
	return (buf?.length || 0) * (buf?.numberOfChannels || 1) * 4
}

/**
 * FS cutoff-radius rule (llaudiosourcevo.cpp:63-82): radius < 0.1 m = no cutoff;
 * listener beyond the radius = hard mute (0), inside = the source gain unchanged.
 */
export function effectiveGain(gain, radius, dist) {
	const r = Number(radius) || 0
	if (r >= 0.1 && dist > r) return 0
	return clamp01(gain)
}

/** Rotate vec3 by quaternion [x,y,z,w] (v' = q·v·q⁻¹, expanded). */
export function quatRotate(q, v) {
	const [qx, qy, qz, qw] = q, [vx, vy, vz] = v
	const tx = 2 * (qy * vz - qz * vy)
	const ty = 2 * (qz * vx - qx * vz)
	const tz = 2 * (qx * vy - qy * vx)
	return [
		vx + qw * tx + (qy * tz - qz * ty),
		vy + qw * ty + (qz * tx - qx * tz),
		vz + qw * tz + (qx * ty - qy * tx),
	]
}

/**
 * Region-frame world position of an object, composing parent chains (child-prim pos/rot are
 * parent-relative on the wire). Mirrors FS LLAudioSourceVO::getPosGlobal walking to the root
 * (llaudiosourcevo.cpp:84-104). Returns [x,y,z] or null when the object is unknown.
 */
export function composeWorldPos(objects, localId, maxDepth = 8) {
	let obj = objects.get(localId)
	if (!obj?.pos) return null
	let pos = [obj.pos[0], obj.pos[1], obj.pos[2]]
	let depth = 0
	while (obj.parentId && depth++ < maxDepth) {
		const parent = objects.get(obj.parentId)
		if (!parent?.pos) break
		if (parent.rot) pos = quatRotate(parent.rot, pos)
		pos = [pos[0] + parent.pos[0], pos[1] + parent.pos[1], pos[2] + parent.pos[2]]
		obj = parent
	}
	return pos
}

/** base64 → ArrayBuffer (server sends OGG bytes as dataB64, see server assets.ts sound spec). */
export function b64ToArrayBuffer(b64) {
	const bin = atob(b64)
	const bytes = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
	return bytes.buffer
}

// ── Decoded-buffer cache + WS fetch (S-4) ─────────────────────────────────────
// Reuses the shared byte-budget LRU (src/lib/byteLRU.js — same primitive as the mesh RAM cache).
const _bufferLRU = createByteLRU({ budgetBytes: BUFFER_LRU_BYTES, sizeOf: audioBufferBytes })
const _failed    = new Set()   // negative cache: UUIDs that errored / failed decode
const _pendingWs = new Map()   // uuid → { resolve, timer } — in-flight ASSET_FETCH
const _inflight  = new Map()   // uuid → Promise<AudioBuffer|null> — coalesces concurrent asks

// S.ASSET_DATA (assetType 'sound') → resolve the pending fetch with raw OGG bytes.
// Textures/meshes have their own listeners on the same message type; filter by assetType.
function _onAssetData(d) {
	if (!d || d.assetType !== 'sound') return
	const p = _pendingWs.get(d.uuid)
	if (!p) return
	_pendingWs.delete(d.uuid)
	clearTimeout(p.timer)
	if (d.error || !d.dataB64) { _failed.add(d.uuid); p.resolve(null); return }
	let bytes = null
	try { bytes = b64ToArrayBuffer(d.dataB64) } catch { _failed.add(d.uuid) }
	p.resolve(bytes)
}

/** Fetch + decode a sound asset → AudioBuffer (LRU-cached), or null on miss/timeout/bad data. */
function fetchSoundBuffer(uuid, ctx) {
	const hit = _bufferLRU.get(uuid)
	if (hit) return Promise.resolve(hit)
	if (_failed.has(uuid)) return Promise.resolve(null)
	let p = _inflight.get(uuid)
	if (p) return p
	p = new Promise(resolve => {
		// WHY timeout: a UUID the grid can't serve never produces S.ASSET_DATA — without this the
		// resolver leaks and the sound entry stays wedged in `starting` forever.
		const timer = setTimeout(() => { _pendingWs.delete(uuid); resolve(null) }, FETCH_TIMEOUT_MS)
		_pendingWs.set(uuid, { resolve, timer })
		useRealtimeSocket().emit(C.ASSET_FETCH, { assetType: 'sound', uuid })
	}).then(async bytes => {
		if (!bytes) return null
		try {
			const buf = await ctx.decodeAudioData(bytes)
			_bufferLRU.set(uuid, buf)
			return buf
		} catch { _failed.add(uuid); return null }
	}).finally(() => _inflight.delete(uuid))
	_inflight.set(uuid, p)
	return p
}

// ── Web Audio node plumbing (S-5 + S-8 routing) ───────────────────────────────
function _setNodePos(node, x, y, z) {
	// AudioParam form when available (sample-accurate); setPosition fallback for older engines.
	if (node.positionX) { node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z }
	else if (node.setPosition) node.setPosition(x, y, z)
}

function _setListenerPos(ctx, x, y, z) {
	const l = ctx.listener
	if (!l) return
	if (l.positionX) { l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z }
	else if (l.setPosition) l.setPosition(x, y, z)
}

/**
 * source → per-sound gain → panner → sounds bus (→ master → destination).
 * Panner: inverse distance model, refDistance 1, rolloff 1 = the FS OpenAL defaults
 * (AUDIO_LEVEL_ROLLOFF = 1.0 llvieweraudio.cpp:480; AL_ROLLOFF_FACTOR llaudioengine_openal.cpp:276;
 * OpenAL's default model is inverse-distance-clamped with reference distance 1).
 * WHY equalpower panning: we track listener POSITION only (camera orientation lives in
 * useWorldEngine, off-limits here) — HRTF with a fixed default orientation sounds worse than
 * simple equal-power attenuation panning.
 */
function _spawnNodes(bus, buffer, { gain, pos, loop }) {
	const ctx = bus.ctx
	const src = ctx.createBufferSource()
	src.buffer = buffer
	src.loop = !!loop
	const g = ctx.createGain()
	g.gain.value = clamp01(gain)
	const p = ctx.createPanner()
	p.panningModel = 'equalpower'
	p.distanceModel = 'inverse'
	p.refDistance = 1
	p.rolloffFactor = 1
	if (pos) _setNodePos(p, pos[0], pos[1], pos[2])
	src.connect(g); g.connect(p); p.connect(bus.input)
	return { src, g, p }
}

function _teardownNodes(nodes) {
	if (!nodes) return
	try { nodes.src.onended = null; nodes.src.stop() } catch { /* already stopped */ }
	try { nodes.src.disconnect(); nodes.g.disconnect(); nodes.p.disconnect() } catch { /* ok */ }
}

// ── One-shot triggered sounds (S-4/S-5 — FS process_sound_trigger llviewermessage.cpp:4871) ───
let _oneShotCount = 0

function _onSoundTrigger(d) {
	if (!d || isNullUuid(d.soundId) || !Array.isArray(d.pos)) return
	const bus = getSoundsBus()
	if (!bus) return   // AudioContext not unlocked yet (no user gesture) — nothing can play
	if (_oneShotCount >= MAX_ONESHOTS) return
	fetchSoundBuffer(d.soundId, bus.ctx).then(buffer => {
		if (!buffer) return
		const liveBus = getSoundsBus()
		if (!liveBus || _oneShotCount >= MAX_ONESHOTS) return
		const nodes = _spawnNodes(liveBus, buffer, { gain: clamp01(d.gain), pos: d.pos, loop: false })
		_oneShotCount++
		nodes.src.onended = () => { _oneShotCount--; _teardownNodes(nodes) }
		try { nodes.src.start() } catch { _oneShotCount--; _teardownNodes(nodes) }
	})
}

// Play a sound asset ONCE, NON-positionally at full gain, through the sounds bus — for the inventory
// sound preview (FS floater_preview_sound Play). Skips the panner so a preview isn't attenuated by the
// listener's distance from the origin. Returns true if playback started, false if the AudioContext isn't
// unlocked yet (needs an in-world user gesture first).
export function previewSound(uuid, gain = 1) {
	if (isNullUuid(uuid)) return false
	const bus = getSoundsBus()
	if (!bus) return false
	fetchSoundBuffer(uuid, bus.ctx).then(buffer => {
		if (!buffer) return
		const liveBus = getSoundsBus()
		if (!liveBus) return
		const ctx = liveBus.ctx
		const src = ctx.createBufferSource(); src.buffer = buffer
		const g = ctx.createGain(); g.gain.value = clamp01(gain)
		src.connect(g); g.connect(liveBus.input)
		src.onended = () => { try { src.disconnect(); g.disconnect() } catch { /* ok */ } }
		try { src.start() } catch { try { src.disconnect(); g.disconnect() } catch { /* ok */ } }
	})
	return true
}

// ── Attached / looping object sounds (S-6) ────────────────────────────────────
// localId → { soundId, gain, flags, loop, radius, nodes, starting, played, cut }
const _attached = new Map()
// FS postponed_sounds (llviewermessage.cpp:5093): AttachedSound for an object we haven't seen yet.
const _postponed = new Map()   // fullId → { soundId, gain, flags, ts }

let _world = null   // worldStore instance, set in initSoundEngine

function _stopAttached(localId) {
	const entry = _attached.get(localId)
	if (!entry) return
	_teardownNodes(entry.nodes)
	entry.nodes = null
	_attached.delete(localId)
}

/**
 * Set/replace/clear an object's attached sound. Ports FS LLViewerObject::setAttachedSound
 * (llviewerobject.cpp:6606-6700):
 *   - null SoundID clears a LOOPING source outright; a non-loop source only stops when
 *     LL_SOUND_FLAG_STOP is set (llviewerobject.cpp:6613-6634)
 *   - same looping sound already playing → ignore (just track gain) (llviewerobject.cpp:6655)
 *   - otherwise stop the current sound first (SL-1541 "farts of doom", llviewerobject.cpp:6689)
 */
function _setAttached(localId, { soundId, gain, flags = 0, radius }) {
	const entry = _attached.get(localId)
	const g = clamp01(gain)
	if (isNullUuid(soundId)) {
		if (!entry) return
		if (entry.loop || (flags & LL_SOUND_FLAG_STOP)) _stopAttached(localId)
		return
	}
	const loop = !!(flags & LL_SOUND_FLAG_LOOP)
	if (entry && entry.loop && loop && entry.soundId === soundId) {
		entry.gain = g
		if (radius !== undefined) entry.radius = radius
		if (entry.nodes && !entry.cut) entry.nodes.g.gain.value = g
		return
	}
	const keepRadius = radius !== undefined ? radius : (entry?.radius ?? 0)
	if (entry) _stopAttached(localId)
	_attached.set(localId, {
		soundId, gain: g, flags, loop, radius: keepRadius,
		nodes: null, starting: false, played: false, cut: false,
	})
}

// Start (or restart-after-fetch) an attached entry once bus + buffer are available.
function _ensurePlaying(localId, entry) {
	if (entry.nodes || entry.starting || entry.played) return
	const bus = getSoundsBus()
	if (!bus) return
	entry.starting = true
	fetchSoundBuffer(entry.soundId, bus.ctx).then(buffer => {
		entry.starting = false
		if (_attached.get(localId) !== entry) return          // replaced/killed while fetching
		if (!buffer) { entry.played = true; return }          // dead asset — don't re-ask every tick
		const liveBus = getSoundsBus()
		if (!liveBus) return
		const pos = _world ? composeWorldPos(_world.objects, localId) : null
		const nodes = _spawnNodes(liveBus, buffer, { gain: entry.cut ? 0 : entry.gain, pos, loop: entry.loop })
		entry.nodes = nodes
		if (!entry.loop) {
			nodes.src.onended = () => {
				_teardownNodes(nodes)
				if (entry.nodes === nodes) { entry.nodes = null; entry.played = true }
			}
		}
		try { nodes.src.start() } catch { _teardownNodes(nodes); entry.nodes = null; entry.played = true }
	})
}

// ── Socket handlers ───────────────────────────────────────────────────────────

// S.OBJECT_UPDATE — object payloads now carry { sound: { id, gain, flags, radius } } (S-3);
// drive attached sounds from them and resolve postponed AttachedSounds on object arrival
// (FS set_attached_sound-on-arrival, llviewermessage.cpp:4483).
// sound.id === null is the explicit STOP marker (llStopSound = full update w/ Sound=Zero + STOP
// flag, SoundModule.cs:269-276) — it flows into _setAttached whose isNullUuid branch kills loops.
function _onObjectUpdate(d) {
	const objs = d?.objects
	if (!Array.isArray(objs)) return
	for (const o of objs) {
		if (o?.localId == null) continue
		if (o.sound) {
			_setAttached(o.localId, {
				soundId: o.sound.id, gain: o.sound.gain, flags: o.sound.flags | 0, radius: o.sound.radius,
			})
		}
		if (o.fullId && _postponed.has(o.fullId)) {
			const p = _postponed.get(o.fullId)
			_postponed.delete(o.fullId)
			_setAttached(o.localId, p)
		}
	}
}

// S.ATTACHED_SOUND — FS process_attached_sound (llviewermessage.cpp:5049). Null soundId with a
// known object = cancel; with an UNKNOWN object = clear any postponed entry (llviewermessage.cpp:5098).
function _onAttachedSound(d) {
	if (!d?.objectId || !_world) return
	const localId = _world.localIdForFullId(d.objectId)
	const payload = { soundId: d.soundId, gain: clamp01(d.gain), flags: d.flags | 0 }
	if (localId === undefined) {
		if (!isNullUuid(d.soundId)) _postponed.set(d.objectId, { ...payload, ts: Date.now() })
		else _postponed.delete(d.objectId)
		return
	}
	_setAttached(localId, payload)
}

// S.ATTACHED_SOUND_GAIN — FS process_attached_sound_gain_change (llviewermessage.cpp:5106).
function _onAttachedSoundGain(d) {
	if (!d?.objectId || !_world) return
	const localId = _world.localIdForFullId(d.objectId)
	if (localId === undefined) return
	const entry = _attached.get(localId)
	if (!entry) return
	entry.gain = clamp01(d.gain)
	if (entry.nodes && !entry.cut) entry.nodes.g.gain.value = entry.gain
}

// S.KILL_OBJECT — stop + disconnect sounds of removed objects.
function _onKillObject(d) {
	const ids = d?.ids
	if (!Array.isArray(ids)) return
	for (const id of ids) _stopAttached(id)
}

// ── Engine tick: listener position, panner tracking, cutoff, postponed retry ──
function _tick() {
	const bus = getSoundsBus()
	if (!bus || !_world) return
	const ap = _world.avatarPos
	_setListenerPos(bus.ctx, ap.x, ap.y, ap.z)

	// Postponed AttachedSounds: retry object resolution, expire after the FS play-delay window.
	if (_postponed.size) {
		const now = Date.now()
		for (const [fullId, p] of _postponed) {
			if (now - p.ts > POSTPONE_TTL_MS) { _postponed.delete(fullId); continue }
			const localId = _world.localIdForFullId(fullId)
			if (localId !== undefined) {
				_postponed.delete(fullId)
				_setAttached(localId, p)
			}
		}
	}

	const objects = _world.objects
	for (const [localId, entry] of _attached) {
		_ensurePlaying(localId, entry)
		if (!entry.nodes) continue
		const pos = composeWorldPos(objects, localId)
		if (pos) _setNodePos(entry.nodes.p, pos[0], pos[1], pos[2])
		const dist = pos ? Math.hypot(pos[0] - ap.x, pos[1] - ap.y, pos[2] - ap.z) : 0
		const g = effectiveGain(entry.gain, entry.radius, dist)
		entry.cut = g === 0 && entry.gain > 0
		entry.nodes.g.gain.value = g
	}
}

// ── Init ──────────────────────────────────────────────────────────────────────
let _inited = false
let _tickTimer = null

/** Idempotent — call once from WorldCanvas. Wires socket handlers + starts the position tick. */
export function initSoundEngine() {
	if (_inited || typeof window === 'undefined') return
	_inited = true
	_world = useWorldStore()
	const { on } = useRealtimeSocket()
	// Keyed registrations: an HMR reload of this module re-inits with fresh closures — the key
	// makes on() drop the stale previous handler instead of stacking duplicates.
	on(S.ASSET_DATA,          _onAssetData,         'sndeng:asset')
	on(S.SOUND_TRIGGER,       _onSoundTrigger,      'sndeng:trigger')
	on(S.ATTACHED_SOUND,      _onAttachedSound,     'sndeng:attached')
	on(S.ATTACHED_SOUND_GAIN, _onAttachedSoundGain, 'sndeng:gain')
	on(S.OBJECT_UPDATE,       _onObjectUpdate,      'sndeng:objupd')
	on(S.KILL_OBJECT,         _onKillObject,        'sndeng:kill')
	_tickTimer = setInterval(_tick, TICK_MS)
}

/** Diagnostics: active sources + cache occupancy (console-friendly). */
export function getSoundEngineStats() {
	return {
		attached: _attached.size,
		oneShots: _oneShotCount,
		postponed: _postponed.size,
		cachedBuffers: _bufferLRU.size(),
		cachedBytes: _bufferLRU.bytes(),
		failed: _failed.size,
	}
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		clearInterval(_tickTimer)
		for (const localId of [..._attached.keys()]) _stopAttached(localId)
	})
}
