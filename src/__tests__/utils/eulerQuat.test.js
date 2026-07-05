// src/__tests__/utils/eulerQuat.test.js — round-trip proof for the Object-tab rotation fields:
// typing Euler degrees must produce a quaternion that displays back as the same degrees.
import { describe, it, expect } from 'vitest'
import { quatToEulerDeg, eulerDegToQuat } from '@/utils/eulerQuat.js'

const deg = (q) => quatToEulerDeg(q).map(parseFloat)

describe('eulerDegToQuat ↔ quatToEulerDeg', () => {
	it('identity: 0,0,0 → unit quaternion', () => {
		expect(eulerDegToQuat(0, 0, 0)).toEqual([0, 0, 0, 1])
	})

	it('round-trips single-axis rotations', () => {
		for (const [x, y, z] of [[90, 0, 0], [0, 45, 0], [0, 0, 180], [30, 0, 0], [0, 0, 270]]) {
			const [rx, ry, rz] = deg(eulerDegToQuat(x, y, z))
			// quatToEulerDeg reports in (-180,180]; compare modulo 360.
			const near = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < 0.15
			expect(near(rx, x), `x ${x} → ${rx}`).toBe(true)
			expect(near(ry, y), `y ${y} → ${ry}`).toBe(true)
			expect(near(rz, z), `z ${z} → ${rz}`).toBe(true)
		}
	})

	it('round-trips combined rotations away from gimbal lock', () => {
		for (const [x, y, z] of [[10, 20, 30], [45, -30, 60], [120, 45, 200], [5.5, 60.1, 359]]) {
			const [rx, ry, rz] = deg(eulerDegToQuat(x, y, z))
			const near = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180) < 0.15
			expect(near(rx, x), `x ${x} → ${rx}`).toBe(true)
			expect(near(ry, y), `y ${y} → ${ry}`).toBe(true)
			expect(near(rz, z), `z ${z} → ${rz}`).toBe(true)
		}
	})

	it('produces normalized quaternions', () => {
		for (const [x, y, z] of [[10, 20, 30], [90, 90, 90], [359, 1, 180]]) {
			const [qx, qy, qz, qw] = eulerDegToQuat(x, y, z)
			expect(Math.hypot(qx, qy, qz, qw)).toBeCloseTo(1, 10)
		}
	})
})
