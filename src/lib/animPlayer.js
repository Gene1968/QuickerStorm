// src/lib/animPlayer.js — SL animation playback onto a live SL skeleton (bundle 7·D).
//
// Plays decoded .anim keyframe motions (shared/animDecode.js) on the THREE.Bone map built by
// slSkeleton.js. Deliberately NOT THREE.AnimationMixer: SL blending is per-JOINT priority
// masking with ease-in/out weights (FS llpose.cpp LLJointStateBlender), which the mixer's
// normalized weight model can't express. With ≤216 joints and a handful of motions per avatar,
// sampling by hand each frame is cheap and matches FS semantics directly.
//
// Simplified FS blend model (llpose.cpp:196-400, llmotioncontroller.cpp:702-740):
//   • per joint, motions apply in ASCENDING priority order: out = slerp(out, motionValue, w)
//     — a full-weight higher-priority motion completely masks lower ones; during its ease
//     in/out the lower-priority result shows through proportionally.
//   • w = cubic_step ease-in × ease-out weight (smoothstep, so starts/stops never pop).
//   • joint priority = per-joint value from the asset, or the motion's base priority when the
//     joint says USE_MOTION_PRIORITY (−1).
// Constraints (IK), hand poses, and emotes are not applied.
//
// Time base: caller passes seconds (performance.now()/1000). Loop semantics (FS
// llkeyframemotion onUpdate): play 0→loop_in once, then cycle [loop_in, loop_out] while
// active; non-looping motions ease out on their own when they reach duration.

import * as THREE from 'three'

const USE_MOTION_PRIORITY = -1

const cubicStep = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

// ── decoded-anim registry (module-level: assets are global by UUID) ─────────────────────────
const _defs = new Map()   // animId → { def, joints: Map<name, joint> }

export function registerAnim(animId, def) {
	if (!def || _defs.has(animId)) return
	const joints = new Map()
	for (const j of def.joints) if (j.rotKeys.length || j.posKeys.length) joints.set(j.name, j)
	_defs.set(animId, { def, joints })
}

export function hasAnim(animId) { return _defs.has(animId) }

// ── key sampling ─────────────────────────────────────────────────────────────────────────────
// keys = [[time, ...values]] in file order (ascending in practice). Returns [k0, k1, f].
function findSpan(keys, t) {
	if (t <= keys[0][0]) return [keys[0], keys[0], 0]
	const last = keys[keys.length - 1]
	if (t >= last[0]) return [last, last, 0]
	let lo = 0, hi = keys.length - 1
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1
		if (keys[mid][0] <= t) lo = mid; else hi = mid
	}
	const k0 = keys[lo], k1 = keys[hi]
	const dt = k1[0] - k0[0]
	return [k0, k1, dt > 1e-6 ? (t - k0[0]) / dt : 0]
}

// nlerp two quats (shortest path) from key rows [t,x,y,z,w] into out {x,y,z,w}.
function sampleRot(keys, t, out) {
	const [a, b, f] = findSpan(keys, t)
	let bx = b[1], by = b[2], bz = b[3], bw = b[4]
	const dot = a[1] * bx + a[2] * by + a[3] * bz + a[4] * bw
	if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw }
	let x = a[1] + (bx - a[1]) * f
	let y = a[2] + (by - a[2]) * f
	let z = a[3] + (bz - a[3]) * f
	let w = a[4] + (bw - a[4]) * f
	const len = Math.hypot(x, y, z, w) || 1
	out.x = x / len; out.y = y / len; out.z = z / len; out.w = w / len
}

function samplePos(keys, t, out) {
	const [a, b, f] = findSpan(keys, t)
	out.x = a[1] + (b[1] - a[1]) * f
	out.y = a[2] + (b[2] - a[2]) * f
	out.z = a[3] + (b[3] - a[3]) * f
}

// ── per-avatar player ────────────────────────────────────────────────────────────────────────
export class AnimPlayer {
	constructor(bones /* Map<jointName, THREE.Bone> from createSLSkeleton */) {
		this.bones = bones
		this.motions = new Map()    // animId → { entry, seq, startAt, stopAt }
		this.wanted = new Map()     // animId → seq (the sim's full signaled set; defs may still be fetching)
		this._touched = new Set()   // bones written last frame (reset to rest when no longer animated)
		// Reusable temps — Quaternion.slerp reads private fields, so these must be real instances.
		this._q = new THREE.Quaternion()
		this._p = new THREE.Vector3()
	}

	/** The sim's FULL signaled set for this avatar (S.AVATAR_ANIMATION — not a delta). Starts
	 *  new/reseq'd ids whose defs are loaded, eases out everything no longer signaled. Returns
	 *  the ids that still need their asset fetched. */
	setSignaled(anims, nowSec) {
		const next = new Map()
		for (const a of anims || []) if (a?.id) next.set(a.id, a.seq | 0)
		this.wanted = next
		const missing = []
		for (const [id, seq] of next) {
			const m = this.motions.get(id)
			if (m && m.seq === seq) { m.stopAt = null; continue }   // unchanged (cancel a pending stop)
			if (_defs.has(id)) this._start(id, seq, nowSec)
			else if (!m) missing.push(id)
		}
		for (const [id, m] of this.motions) {
			if (!next.has(id) && m.stopAt == null) m.stopAt = nowSec
		}
		return missing
	}

	/** An asset fetch finished — start it if the sim still wants it. */
	noteAnimLoaded(animId, nowSec) {
		if (this.wanted.has(animId) && !this.motions.has(animId) && _defs.has(animId)) {
			this._start(animId, this.wanted.get(animId), nowSec)
		}
	}

	_start(id, seq, nowSec) {
		this.motions.set(id, { entry: _defs.get(id), seq, startAt: nowSec, stopAt: null })
	}

	get activeCount() { return this.motions.size }

	/** Sample + blend every active motion, write bone local pos/quat (SL frame). Call once per
	 *  frame before render. Returns true if any bone changed (skeleton is live). */
	update(nowSec) {
		if (!this.motions.size && !this._touched.size) return false
		// Collect contributions per joint: [{prio, w, rotKeys?, posKeys?, t}] — then blend asc.
		const contrib = new Map()
		for (const [id, m] of this.motions) {
			const { def } = m.entry
			const age = nowSec - m.startAt
			// Ease-in weight; ease-out on stop. Fully eased out → drop the motion.
			let w = def.easeIn > 0 ? cubicStep(age / def.easeIn) : 1
			if (m.stopAt != null) {
				const outT = def.easeOut > 0 ? (nowSec - m.stopAt) / def.easeOut : 1
				if (outT >= 1) { this.motions.delete(id); continue }
				w *= 1 - cubicStep(outT)
			} else if (!def.loop && age >= def.duration) {
				m.stopAt = nowSec   // non-loop motion ran out — ease itself out
			}
			if (w <= 0) continue
			// Local clock: one-shot 0→duration; looping cycles [loopIn, loopOut] after lead-in.
			let t
			if (def.loop) {
				const li = Math.max(0, Math.min(def.loopIn, def.duration))
				const lo = Math.max(li, Math.min(def.loopOut, def.duration))
				const span = lo - li
				t = age < li || span <= 1e-4 ? Math.min(age, lo) : li + ((age - li) % span)
			} else {
				t = Math.min(age, def.duration)
			}
			for (const [name, j] of m.entry.joints) {
				const prio = j.priority !== USE_MOTION_PRIORITY ? j.priority : def.basePriority
				let list = contrib.get(name)
				if (!list) { list = []; contrib.set(name, list) }
				list.push({ prio, w, j, t })
			}
		}

		// Bones animated last frame but not this one → back to rest.
		for (const name of this._touched) {
			if (contrib.has(name)) continue
			const b = this.bones.get(name)
			if (b) { b.position.copy(b.userData.restPos); b.quaternion.copy(b.userData.restQuat) }
			this._touched.delete(name)
		}

		const q = this._q, p = this._p
		for (const [name, list] of contrib) {
			const bone = this.bones.get(name)
			if (!bone) continue
			if (list.length > 1) list.sort((a, b) => a.prio - b.prio)
			// Start from rest; ascending priority, each motion slerps in with its ease weight —
			// a settled higher-priority motion (w=1) fully masks everything below it.
			bone.position.copy(bone.userData.restPos)
			bone.quaternion.copy(bone.userData.restQuat)
			for (const c of list) {
				if (c.j.rotKeys.length) {
					sampleRot(c.j.rotKeys, c.t, q)
					if (c.w >= 1) bone.quaternion.copy(q)
					else bone.quaternion.slerp(q, c.w)
				}
				if (c.j.posKeys.length) {
					samplePos(c.j.posKeys, c.t, p)
					// mPelvis pos keys are authored relative to the AVATAR ROOT (FS mRoot sits at the
					// agent position, so pelvis-local-zero ≈ standing height): live data shows stand/walk
					// pelvis keys hover around 0, not ~1.067. Replaying them as absolute local pos drops
					// the whole body ~1m (live 2026-07-19). Anchor pelvis keys at its REST position; every
					// other joint's keys ARE its absolute local offset (wing-fold anims carry
					// rest-magnitude values), matching FS LLJoint::setPosition replace semantics.
					if (name === 'mPelvis') p.add(bone.userData.restPos)
					if (c.w >= 1) bone.position.copy(p)
					else bone.position.lerp(p, c.w)
				}
			}
			this._touched.add(name)
		}
		return true
	}

	dispose() {
		this.motions.clear()
		this.wanted.clear()
		this._touched.clear()
	}
}
