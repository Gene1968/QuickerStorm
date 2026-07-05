// src/utils/eulerQuat.js — quaternion ↔ Euler-degree conversion for the Object edit floater.
// Convention: XYZ "roll/pitch/yaw" with composition q = qZ(yaw)·qY(pitch)·qX(roll) — the same
// mapping FS shows in the Build floater's Rotation spinners (llpanelobject.cpp:2133 sendRotation
// builds LLQuaternion from an LLVector3 of Euler radians; mayaQ XYZ order).

/** Quaternion [x,y,z,w] → Euler degrees ['x.x','y.y','z.z'] (strings, 1 decimal, display-ready). */
export function quatToEulerDeg(q) {
	if (!q) return [0, 0, 0]
	const [x, y, z, w] = q
	const sinr = 2 * (w * x + y * z)
	const cosr = 1 - 2 * (x * x + y * y)
	const roll  = Math.atan2(sinr, cosr)
	const sinp  = 2 * (w * y - z * x)
	const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp)
	const siny  = 2 * (w * z + x * y)
	const cosy  = 1 - 2 * (y * y + z * z)
	const yaw   = Math.atan2(siny, cosy)
	const deg   = (r) => (r * 180 / Math.PI).toFixed(1)
	return [deg(roll), deg(pitch), deg(yaw)]
}

/** Euler degrees (x, y, z) → normalized quaternion [x,y,z,w]. Exact inverse of quatToEulerDeg. */
export function eulerDegToQuat(xDeg, yDeg, zDeg) {
	const h = Math.PI / 360   // deg → rad half-angle
	const cr = Math.cos(xDeg * h), sr = Math.sin(xDeg * h)
	const cp = Math.cos(yDeg * h), sp = Math.sin(yDeg * h)
	const cy = Math.cos(zDeg * h), sy = Math.sin(zDeg * h)
	return [
		sr * cp * cy - cr * sp * sy,
		cr * sp * cy + sr * cp * sy,
		cr * cp * sy - sr * sp * cy,
		cr * cp * cy + sr * sp * sy,
	]
}
