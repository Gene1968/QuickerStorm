// src/lib/scriptedMotion.js — pure math for the 🎬 Scripted-motion & TextureAnim cluster.
// Two ports from Firestorm, kept framework-free so vitest can pin them against FS-derived values:
//   1. stepTextureAnim  — LLViewerTextureAnim::animateTextures (llviewertextureanim.cpp:78–238)
//   2. omegaDeltaQuat   — the ΔQ core of LLViewerObject::applyAngularVelocity (llviewerobject.cpp:7397–7422)
// Everything here works in SL conventions (SL axes, SL quat components); the engine converts to
// Three.js frames at the call site (slToThree / slQuatToThree axis permutation).

// Texture-animation mode flags — FS indra/llprimitive/lltextureanim.h:54–60 (values on the wire).
export const TA_ON        = 0x01
export const TA_LOOP      = 0x02
export const TA_REVERSE   = 0x04
export const TA_PING_PONG = 0x08
export const TA_SMOOTH    = 0x10
export const TA_ROTATE    = 0x20
export const TA_SCALE     = 0x40

// Per-object animation clock. FS equivalents: mTimer (time), mLastTime, mLastFrame
// (llviewertextureanim.cpp:40–41 init: mLastFrame = -1 forces the first update).
export function createTexAnimState() {
	return { time: 0, lastTime: 0, lastFrame: -1 }
}

/**
 * Advance a texture animation by dt seconds. Direct port of
 * LLViewerTextureAnim::animateTextures (llviewertextureanim.cpp:78–238).
 *
 * anim:  { mode, face, sizeX, sizeY, start, length, rate }  (LLTextureAnim wire fields)
 * state: from createTexAnimState() — mutated in place.
 * dt:    seconds since the previous step.
 *
 * Returns null when the displayed frame did not change (FS: mLastFrame == frame_counter,
 * :192 — nothing to re-upload), else { offS, offT, scaleS, scaleT, rot } — the FULL face
 * transform. FS returns partial-change flags and fills the rest from the TE (llvovolume.cpp
 * :758–770), but animated faces bypass the TE entirely on our side (llface.cpp:1739–1759 sets
 * os=ot=0, rot=0, ms=mt=1), so unchanged components are always the identity values here.
 */
export function stepTextureAnim(anim, state, dt) {
	const mode = anim.mode
	if (!(mode & TA_ON)) {
		// :83–88 — anim off: reset the clock so a later re-enable starts fresh.
		state.lastTime = 0
		state.lastFrame = -1
		return null
	}

	// :91–101 — frame count from Length, else the cell grid (min 1).
	const numFrames = anim.length ? anim.length : Math.max(1, (anim.sizeX | 0) * (anim.sizeY | 0))

	// :103–123 — full cycle length (ping-pong doubles it, minus the shared end frames).
	let fullLength
	if (mode & TA_PING_PONG) {
		if (mode & TA_SMOOTH)    fullLength = 2 * numFrames
		else if (mode & TA_LOOP) fullLength = Math.max(1, 2 * numFrames - 2)
		else                     fullLength = Math.max(1, 2 * numFrames - 1)
	} else {
		fullLength = numFrames
	}

	// :126–135 — SMOOTH accumulates dt·rate onto the previous counter (timer is reset each
	// step: getElapsedTimeAndResetF32); discrete modes derive the counter from total elapsed
	// time (getElapsedTimeF32). mLastTime is stored BEFORE the loop wrap, exactly like FS.
	state.time += dt
	let fc
	if (mode & TA_SMOOTH) fc = dt * anim.rate + state.lastTime
	else                  fc = state.time * anim.rate
	state.lastTime = fc

	// :137–144 — LOOP wraps (C fmod keeps the dividend's sign; JS % matches), else clamp.
	if (mode & TA_LOOP) fc = fc % fullLength
	else                fc = Math.min(fullLength - 1, fc)

	// :146–151 — discrete modes floor to a frame index (+0.01 nudge, re-clamped).
	if (!(mode & TA_SMOOTH)) fc = Math.min(fullLength - 1, Math.floor(fc + 0.01))

	// :153–166 — ping-pong folds the second half back.
	if ((mode & TA_PING_PONG) && fc >= numFrames) {
		if (mode & TA_SMOOTH) fc = numFrames - (fc - numFrames)
		else                  fc = (numFrames - 1.99) - (fc - numFrames)
	}

	// :168–178 — reverse mirrors the counter.
	if (mode & TA_REVERSE) {
		if (mode & TA_SMOOTH) fc = numFrames - fc
		else                  fc = (numFrames - 0.99) - fc
	}

	// :180–185 — start-frame offset, then discrete modes round.
	fc += anim.start
	if (!(mode & TA_SMOOTH)) fc = Math.round(fc)

	// :192–194 — same frame as last step → no update.
	if (state.lastFrame === fc) return null
	state.lastFrame = fc

	if (mode & TA_ROTATE) {
		// :195–199 — counter IS the rotation (radians).
		return { offS: 0, offT: 0, scaleS: 1, scaleT: 1, rot: fc }
	}
	if (mode & TA_SCALE) {
		// :200–205 — counter IS the uniform scale.
		return { offS: 0, offT: 0, scaleS: fc, scaleT: fc, rot: 0 }
	}
	// TRANSLATE (:206–235)
	if (anim.sizeX && anim.sizeY) {
		// Cell/sprite grid: repeat = 1/size, offsets step through cells, centered −0.5+0.5·scale.
		const scaleS = 1 / anim.sizeX
		const scaleT = 1 / anim.sizeY
		const xFrame = fc % anim.sizeX               // fmodf (:220)
		const yFrame = Math.trunc(fc / anim.sizeX)   // (S32) cast truncates toward zero (:221)
		return {
			offS: (-0.5 + 0.5 * scaleS) + xFrame * scaleS,   // :224
			offT: (0.5 - 0.5 * scaleT) - yFrame * scaleT,    // :225
			scaleS, scaleT, rot: 0,
		}
	}
	// SMOOTH scroll (sizeX/sizeY = 0): scale 1, offS = counter, offT = 0 (:227–234).
	return { offS: fc, offT: 0, scaleS: 1, scaleT: 1, rot: 0 }
}

// Motion-interpolation cutoff — FS llviewerobject.cpp:141 sMaxUpdateInterpolationTime(3.0):
// "after X seconds with no updates, don't predict object motion" (linear only; FS deliberately
// does NOT kill angular motion — llTargetOmega keeps spinning, see the comment at :2638–2641).
export const MAX_INTERP_S = 3.0

/**
 * ΔQ for one frame of llTargetOmega spin — port of LLViewerObject::applyAngularVelocity
 * (llviewerobject.cpp:7397–7422). angVel is [x,y,z] rad/s in the SL frame; out receives the
 * SL-frame quaternion [x,y,z,w] (axis·sin(θ/2), cos(θ/2) — LLQuaternion::setQuat(angle, axis)).
 * Returns false (out untouched) below FS's dead-band: magVecSquared ≤ 0.00001 (:7404).
 * Composition is the caller's job: LL accumulates rot = rot * dQ in row-vector convention
 * (:7414/:7419), which is quaternion.premultiply(dQ) in Three's column convention.
 */
export function omegaDeltaQuat(angVel, dt, out) {
	const w2 = angVel[0] * angVel[0] + angVel[1] * angVel[1] + angVel[2] * angVel[2]
	if (!(w2 > 0.00001)) return false
	const omega = Math.sqrt(w2)
	const angle = omega * dt
	const s = Math.sin(angle * 0.5) / omega   // sin(θ/2) × normalized axis in one factor
	out[0] = angVel[0] * s
	out[1] = angVel[1] * s
	out[2] = angVel[2] * s
	out[3] = Math.cos(angle * 0.5)
	return true
}
