// shared/animDecode.js — parser for the Second Life / OpenSim .anim asset binary
// (LLKeyframeMotion internal format). Raw binary, no gzip, all little-endian.
//
// Ported from Firestorm indra/llcharacter/llkeyframemotion.cpp
// LLKeyframeMotion::deserialize (~line 1231), plus:
//   - indra/llmath/llquantize.h            (U16_to_F32)
//   - indra/llmath/llquaternion.cpp        (mayaQ, operator*, unpackFromVector3)
// We do not apply constraints (IK) — only skip past them.
//
// Lives in shared/ because the BROWSER decodes .anim bytes (fetched via the generic
// ASSET_FETCH assetType:'animation' path) while the server test-pins the format.
//
// Decoded shape (JSON-serializable):
//   {
//     version, subVersion, basePriority, duration, emoteName,
//     loopIn, loopOut, loop, easeIn, easeOut, handPose,
//     joints: [{ name, priority, rotKeys: [[t,qx,qy,qz,qw]…], posKeys: [[t,x,y,z]…] }]
//   }
// rotKeys quats are SL-frame joint-local; posKeys are SL metres, joint-local.

// llcharacter/llkeyframemotion.h: MAX_ANIM_DURATION
const MAX_ANIM_DURATION = 60.0
// llcharacter/llcharacter.h: LL_CHARACTER_MAX_ANIMATED_JOINTS
const LL_CHARACTER_MAX_ANIMATED_JOINTS = 216
// lljoint.h: LL_MAX_PELVIS_OFFSET (applies to ALL joints' position keys)
const LL_MAX_PELVIS_OFFSET = 5.0
// llkeyframemotion.cpp: MAX_CONSTRAINTS
const MAX_CONSTRAINTS = 10
// chainLength(1) + type(1) + sourceVolume(16) + sourceOffset(12) + targetVolume(16)
// + targetOffset(12) + targetDir(12) + easeInStart/Stop/easeOutStart/Stop(4*4) = 86
const CONSTRAINT_BYTES = 86
// lljoint.h: LLJoint::ADDITIVE_PRIORITY == 7, LLJoint::USE_MOTION_PRIORITY == -1
const ADDITIVE_PRIORITY = 7
const USE_MOTION_PRIORITY = -1

const DEG_TO_RAD = Math.PI / 180

class Reader {
	constructor(buf) {
		this.buf = buf
		this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
		this.offset = 0
	}

	need(n, what) {
		if (this.offset + n > this.buf.length) {
			throw new Error(
				`animDecode: truncated buffer reading ${what} at offset ${this.offset} ` +
					`(need ${n} bytes, have ${this.buf.length - this.offset})`,
			)
		}
	}

	u8(what) { this.need(1, what); const v = this.view.getUint8(this.offset); this.offset += 1; return v }
	u16(what) { this.need(2, what); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v }
	u32(what) { this.need(4, what); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v }
	s32(what) { this.need(4, what); const v = this.view.getInt32(this.offset, true); this.offset += 4; return v }
	f32(what) { this.need(4, what); const v = this.view.getFloat32(this.offset, true); this.offset += 4; return v }
	skip(n, what) { this.need(n, what); this.offset += n }

	str(what) {
		let end = this.offset
		while (end < this.buf.length && this.buf[end] !== 0) end++
		if (end >= this.buf.length) {
			throw new Error(`animDecode: unterminated string reading ${what} at offset ${this.offset}`)
		}
		const s = new TextDecoder('utf-8').decode(this.buf.subarray(this.offset, end))
		this.offset = end + 1
		return s
	}
}

// llmath/llquantize.h: U16_to_F32 — ported exactly, including the near-zero snap.
function u16ToF32(ival, lower, upper) {
	const delta = upper - lower
	let val = ival * (1 / 65535) * delta + lower
	const maxError = delta / 65535
	if (Math.abs(val) < maxError) val = 0
	return val
}

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v
}

// llmath/llquaternion.cpp: LLQuaternion(F32 angle, const LLVector3 &vec) → [x,y,z,w]
function axisAngleQuat(angleRad, ax, ay, az) {
	const mag = Math.sqrt(ax * ax + ay * ay + az * az)
	if (mag <= 1e-8) return [0, 0, 0, 1]
	const half = angleRad * 0.5
	const c = Math.cos(half)
	const s = Math.sin(half) / mag
	return [ax * s, ay * s, az * s, c]
}

// llmath/llquaternion.cpp: operator*(const LLQuaternion &a, const LLQuaternion &b)
// (does NOT renormalize the result, matching the reference)
function quatMul(a, b) {
	const [ax, ay, az, aw] = a
	const [bx, by, bz, bw] = b
	return [
		bw * ax + bx * aw + by * az - bz * ay,
		bw * ay + by * aw + bz * ax - bx * az,
		bw * az + bz * aw + bx * ay - by * ax,
		bw * aw - bx * ax - by * ay - bz * az,
	]
}

// llmath/llquaternion.cpp: mayaQ(x, y, z, LLQuaternion::ZYX) → ret = zQ * yQ * xQ
// Inputs are DEGREES (mayaQ applies DEG_TO_RAD internally).
function mayaQZYX(xDeg, yDeg, zDeg) {
	const xQ = axisAngleQuat(xDeg * DEG_TO_RAD, 1, 0, 0)
	const yQ = axisAngleQuat(yDeg * DEG_TO_RAD, 0, 1, 0)
	const zQ = axisAngleQuat(zDeg * DEG_TO_RAD, 0, 0, 1)
	return quatMul(quatMul(zQ, yQ), xQ)
}

// llmath/llquaternion.cpp: LLQuaternion::unpackFromVector3 — w = +sqrt(1 - |xyz|²)
function unpackFromVector3(x, y, z) {
	const t = 1 - (x * x + y * y + z * z)
	const w = t > 0 ? Math.sqrt(t) : 0
	return [x, y, z, w]
}

/**
 * Decode a .anim asset (Uint8Array of the raw asset bytes) into keyframe data.
 * Throws Error (with byte offset) on malformed input.
 */
export function decodeAnimAsset(buf) {
	const r = new Reader(buf)

	const version = r.u16('version')
	const subVersion = r.u16('sub_version')

	let legacy
	if (version === 0 && subVersion === 1) {
		legacy = true
	} else if (version === 1 && subVersion === 0) {
		legacy = false
	} else {
		throw new Error(`animDecode: bad version ${version}.${subVersion} at offset ${r.offset}`)
	}

	let basePriority = r.s32('base_priority')
	if (basePriority >= ADDITIVE_PRIORITY) {
		basePriority = ADDITIVE_PRIORITY - 1
	} else if (basePriority < USE_MOTION_PRIORITY) {
		throw new Error(`animDecode: bad base_priority ${basePriority} at offset ${r.offset}`)
	}

	const duration = r.f32('duration')
	if (!Number.isFinite(duration) || duration > MAX_ANIM_DURATION) {
		throw new Error(`animDecode: invalid duration ${duration} at offset ${r.offset}`)
	}

	const emoteName = r.str('emote_name')

	const loopIn = r.f32('loop_in_point')
	if (!Number.isFinite(loopIn)) {
		throw new Error(`animDecode: invalid loop_in_point at offset ${r.offset}`)
	}
	const loopOut = r.f32('loop_out_point')
	if (!Number.isFinite(loopOut)) {
		throw new Error(`animDecode: invalid loop_out_point at offset ${r.offset}`)
	}

	const loopRaw = r.s32('loop')
	const loop = loopRaw !== 0

	const easeIn = r.f32('ease_in_duration')
	if (!Number.isFinite(easeIn)) {
		throw new Error(`animDecode: invalid ease_in_duration at offset ${r.offset}`)
	}
	const easeOut = r.f32('ease_out_duration')
	if (!Number.isFinite(easeOut)) {
		throw new Error(`animDecode: invalid ease_out_duration at offset ${r.offset}`)
	}

	const handPose = r.u32('hand_pose')

	const numJoints = r.u32('num_joints')
	if (numJoints === 0 || numJoints > LL_CHARACTER_MAX_ANIMATED_JOINTS) {
		throw new Error(`animDecode: bad num_joints ${numJoints} at offset ${r.offset}`)
	}

	const joints = []

	for (let i = 0; i < numJoints; i++) {
		const name = r.str('joint_name')
		if (name === 'mScreen' || name === 'mRoot') {
			throw new Error(`animDecode: attempted to animate special joint '${name}' at offset ${r.offset}`)
		}

		const priority = r.s32('joint_priority')
		if (priority < USE_MOTION_PRIORITY) {
			throw new Error(`animDecode: bad joint_priority ${priority} for joint '${name}' at offset ${r.offset}`)
		}

		const numRotKeys = r.s32('num_rot_keys')
		if (numRotKeys < 0) {
			throw new Error(`animDecode: bad num_rot_keys ${numRotKeys} for joint '${name}' at offset ${r.offset}`)
		}

		const rotKeys = []
		for (let k = 0; k < numRotKeys; k++) {
			let time, qx, qy, qz, qw

			if (legacy) {
				time = r.f32('rot key time')
				if (!Number.isFinite(time)) {
					throw new Error(`animDecode: non-finite rotation key time (joint '${name}', key ${k}) at offset ${r.offset}`)
				}
				const rx = r.f32('rot_angle_x')
				const ry = r.f32('rot_angle_y')
				const rz = r.f32('rot_angle_z')
				if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) {
					throw new Error(`animDecode: non-finite legacy rotation angles (joint '${name}', key ${k}) at offset ${r.offset}`)
				}
				;[qx, qy, qz, qw] = mayaQZYX(rx, ry, rz)
			} else {
				const timeRaw = r.u16('rot key time')
				time = u16ToF32(timeRaw, 0, duration)
				const xRaw = r.u16('rot_angle_x')
				const yRaw = r.u16('rot_angle_y')
				const zRaw = r.u16('rot_angle_z')
				const x = u16ToF32(xRaw, -1, 1)
				const y = u16ToF32(yRaw, -1, 1)
				const z = u16ToF32(zRaw, -1, 1)
				;[qx, qy, qz, qw] = unpackFromVector3(x, y, z)
			}

			if (![qx, qy, qz, qw].every(Number.isFinite)) {
				throw new Error(`animDecode: non-finite quaternion (joint '${name}', key ${k}) at offset ${r.offset}`)
			}

			rotKeys.push([time, qx, qy, qz, qw])
		}

		const numPosKeys = r.s32('num_pos_keys')
		if (numPosKeys < 0) {
			throw new Error(`animDecode: bad num_pos_keys ${numPosKeys} for joint '${name}' at offset ${r.offset}`)
		}

		const posKeys = []
		for (let k = 0; k < numPosKeys; k++) {
			let time, x, y, z

			if (legacy) {
				time = r.f32('pos key time')
				if (!Number.isFinite(time)) {
					throw new Error(`animDecode: non-finite position key time (joint '${name}', key ${k}) at offset ${r.offset}`)
				}
				x = clamp(r.f32('pos_x'), -LL_MAX_PELVIS_OFFSET, LL_MAX_PELVIS_OFFSET)
				y = clamp(r.f32('pos_y'), -LL_MAX_PELVIS_OFFSET, LL_MAX_PELVIS_OFFSET)
				z = clamp(r.f32('pos_z'), -LL_MAX_PELVIS_OFFSET, LL_MAX_PELVIS_OFFSET)
			} else {
				const timeRaw = r.u16('pos key time')
				time = u16ToF32(timeRaw, 0, duration)
				const xRaw = r.u16('pos_x')
				const yRaw = r.u16('pos_y')
				const zRaw = r.u16('pos_z')
				x = u16ToF32(xRaw, -LL_MAX_PELVIS_OFFSET, LL_MAX_PELVIS_OFFSET)
				y = u16ToF32(yRaw, -LL_MAX_PELVIS_OFFSET, LL_MAX_PELVIS_OFFSET)
				z = u16ToF32(zRaw, -LL_MAX_PELVIS_OFFSET, LL_MAX_PELVIS_OFFSET)
			}

			posKeys.push([time, x, y, z])
		}

		joints.push({ name, priority, rotKeys, posKeys })
	}

	// Constraints tail: fixed 86 bytes/constraint. Bad count → treat as 0 (warn, don't throw);
	// we don't apply constraints, so just skip past the bytes when the count is sane.
	const numConstraints = r.s32('num_constraints')
	if (numConstraints >= 0 && numConstraints <= MAX_CONSTRAINTS) {
		r.skip(numConstraints * CONSTRAINT_BYTES, 'constraints')
	}

	return {
		version,
		subVersion,
		basePriority,
		duration,
		emoteName,
		loopIn,
		loopOut,
		loop,
		easeIn,
		easeOut,
		handPose,
		joints,
	}
}
