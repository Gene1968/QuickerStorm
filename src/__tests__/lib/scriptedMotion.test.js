// src/__tests__/lib/scriptedMotion.test.js — pins the FS ports in scriptedMotion.js against
// hand-derived expected values from llviewertextureanim.cpp:78–238 and llviewerobject.cpp:7397.
import { describe, it, expect } from 'vitest'
import {
	TA_ON, TA_LOOP, TA_REVERSE, TA_PING_PONG, TA_SMOOTH, TA_ROTATE, TA_SCALE,
	createTexAnimState, stepTextureAnim, omegaDeltaQuat, MAX_INTERP_S,
} from '@/lib/scriptedMotion.js'

const EPS = 1e-9

describe('stepTextureAnim — SMOOTH scroll (mode 0x13 = ON|LOOP|SMOOTH, the live-region case)', () => {
	const anim = { mode: TA_ON | TA_LOOP | TA_SMOOTH, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 0, rate: 0.15 }

	it('accumulates offS by rate·dt per step, offT stays 0, scale identity', () => {
		const st = createTexAnimState()
		// FS :129 fc = dt·rate + lastTime; :232 offS = (-0.5 + 0.5·1) + fc = fc
		let r = stepTextureAnim(anim, st, 0.5)
		expect(r.offS).toBeCloseTo(0.075, 12)
		expect(r.offT).toBe(0)
		expect(r.scaleS).toBe(1)
		expect(r.scaleT).toBe(1)
		expect(r.rot).toBe(0)
		r = stepTextureAnim(anim, st, 0.5)
		expect(r.offS).toBeCloseTo(0.15, 12)
	})

	it('LOOP wraps at full_length (num_frames = max(1, 0·0) = 1)', () => {
		const st = createTexAnimState()
		stepTextureAnim(anim, st, 6)      // lastTime = 0.9
		const r = stepTextureAnim(anim, st, 1)   // 0.9 + 0.15 = 1.05 → fmod 1 → 0.05
		expect(r.offS).toBeCloseTo(0.05, 12)
	})

	it('negative rate (water −0.02) scrolls the other way — fmod keeps the sign like C', () => {
		const water = { ...anim, rate: -0.02 }
		const st = createTexAnimState()
		const r = stepTextureAnim(water, st, 1)
		expect(r.offS).toBeCloseTo(-0.02, 12)     // JS % of negative dividend is negative, matching fmodf
	})

	it('returns null when the counter did not move (dt = 0)', () => {
		const st = createTexAnimState()
		stepTextureAnim(anim, st, 0.5)
		expect(stepTextureAnim(anim, st, 0)).toBeNull()
	})
})

describe('stepTextureAnim — cell/sprite animation (sizeX/sizeY > 0)', () => {
	// 4×2 grid, 2 frames/s, LOOP: num_frames = 8, full_length = 8.
	const anim = { mode: TA_ON | TA_LOOP, face: -1, sizeX: 4, sizeY: 2, start: 0, length: 0, rate: 2 }

	it('frame 2 → repeat 1/size, centered offsets stepping through the grid', () => {
		const st = createTexAnimState()
		// t = 1.3s → fc = 2.6 → floor(2.61) = 2 → round(2) = 2; x = 2%4 = 2, y = trunc(2/4) = 0
		const r = stepTextureAnim(anim, st, 1.3)
		expect(r.scaleS).toBeCloseTo(0.25, 12)                       // 1/sizeX  (:218)
		expect(r.scaleT).toBeCloseTo(0.5, 12)                        // 1/sizeY  (:219)
		expect(r.offS).toBeCloseTo((-0.5 + 0.125) + 2 * 0.25, 12)    // :224 = 0.125
		expect(r.offT).toBeCloseTo((0.5 - 0.25) - 0 * 0.5, 12)       // :225 = 0.25
	})

	it('second row: frame 5 → x = 1, y = 1', () => {
		const st = createTexAnimState()
		const r = stepTextureAnim(anim, st, 2.6)   // fc = 5.2 → frame 5
		expect(r.offS).toBeCloseTo((-0.5 + 0.125) + 1 * 0.25, 12)   // = -0.125
		expect(r.offT).toBeCloseTo((0.5 - 0.25) - 1 * 0.5, 12)      // = -0.25
	})

	it('same frame twice → null (no re-upload, FS :192)', () => {
		const st = createTexAnimState()
		stepTextureAnim(anim, st, 1.3)             // frame 2
		expect(stepTextureAnim(anim, st, 0.01)).toBeNull()   // still frame 2
	})

	it('LOOP wraps the grid: t = 4.1s → fc = 8.2 → fmod 8 = 0.2 → frame 0', () => {
		const st = createTexAnimState()
		const r = stepTextureAnim(anim, st, 4.1)
		expect(r.offS).toBeCloseTo(-0.5 + 0.125, 12)
		expect(r.offT).toBeCloseTo(0.5 - 0.25, 12)
	})

	it('non-LOOP clamps at full_length − 1 (last frame parks)', () => {
		const once = { ...anim, mode: TA_ON }      // no LOOP
		const st = createTexAnimState()
		const r = stepTextureAnim(once, st, 100)   // fc = 200 → min(7, …) = 7 → x=3, y=1
		expect(r.offS).toBeCloseTo((-0.5 + 0.125) + 3 * 0.25, 12)
		expect(r.offT).toBeCloseTo((0.5 - 0.25) - 1 * 0.5, 12)
	})

	it('start offset shifts the frame counter (FS :180 frame_counter += mStart)', () => {
		const withStart = { ...anim, start: 3 }
		const st = createTexAnimState()
		const r = stepTextureAnim(withStart, st, 0.2)   // fc = 0.4 → floor 0 → +3 → round 3
		expect(r.offS).toBeCloseTo((-0.5 + 0.125) + 3 * 0.25, 12)   // x = 3, y = 0
	})
})

describe('stepTextureAnim — PING_PONG / REVERSE folds', () => {
	it('SMOOTH ping-pong folds the second half back: fc = n − (fc − n)', () => {
		// length 4, SMOOTH|LOOP|PING_PONG: full_length = 8. lastTime accumulates.
		const anim = { mode: TA_ON | TA_LOOP | TA_SMOOTH | TA_PING_PONG, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 4, rate: 1 }
		const st = createTexAnimState()
		const r = stepTextureAnim(anim, st, 5)   // fc = 5 ≥ 4 → 4 − (5 − 4) = 3
		expect(r.offS).toBeCloseTo(3, 12)
	})

	it('discrete ping-pong uses the −1.99 fold (FS :163)', () => {
		// length 4, LOOP|PING_PONG (not smooth): full_length = 2·4 − 2 = 6.
		const anim = { mode: TA_ON | TA_LOOP | TA_PING_PONG, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 4, rate: 1 }
		const st = createTexAnimState()
		// t = 5 → fc = 5 → floor(5.01) = 5 ≥ 4 → (4 − 1.99) − (5 − 4) = 1.01 → round = 1
		const r = stepTextureAnim(anim, st, 5)
		expect(r.offS).toBeCloseTo(1, 12)
	})

	it('SMOOTH reverse mirrors: fc = n − fc (FS :172)', () => {
		const anim = { mode: TA_ON | TA_LOOP | TA_SMOOTH | TA_REVERSE, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 4, rate: 1 }
		const st = createTexAnimState()
		const r = stepTextureAnim(anim, st, 1)   // fc = 1 → 4 − 1 = 3
		expect(r.offS).toBeCloseTo(3, 12)
	})

	it('discrete reverse mirrors with −0.99 (FS :176)', () => {
		const anim = { mode: TA_ON | TA_LOOP | TA_REVERSE, face: -1, sizeX: 4, sizeY: 2, start: 0, length: 0, rate: 1 }
		const st = createTexAnimState()
		// t = 2 → fc = 2 → floor(2.01) = 2 → (8 − 0.99) − 2 = 5.01 → round 5 → x=1, y=1
		const r = stepTextureAnim(anim, st, 2)
		expect(r.offS).toBeCloseTo((-0.5 + 0.125) + 1 * 0.25, 12)
		expect(r.offT).toBeCloseTo((0.5 - 0.25) - 1 * 0.5, 12)
	})
})

describe('stepTextureAnim — ROTATE / SCALE modes', () => {
	it('ROTATE: the counter IS the rotation in radians (FS :195–199)', () => {
		const anim = { mode: TA_ON | TA_SMOOTH | TA_LOOP, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 0, rate: 0.5 }
		const rot = { ...anim, mode: anim.mode | TA_ROTATE, length: 100 }   // full_length 100, no early wrap
		const st = createTexAnimState()
		const r = stepTextureAnim(rot, st, 2)   // fc = 1
		expect(r.rot).toBeCloseTo(1, 12)
		expect(r.scaleS).toBe(1)
		expect(r.offS).toBe(0)
	})

	it('SCALE: the counter IS the uniform repeat (FS :200–205)', () => {
		const anim = { mode: TA_ON | TA_SMOOTH | TA_LOOP | TA_SCALE, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 100, rate: 0.5 }
		const st = createTexAnimState()
		const r = stepTextureAnim(anim, st, 3)   // fc = 1.5
		expect(r.scaleS).toBeCloseTo(1.5, 12)
		expect(r.scaleT).toBeCloseTo(1.5, 12)
		expect(r.rot).toBe(0)
	})

	it('anim OFF resets the clock and reports nothing (FS :83–88)', () => {
		const anim = { mode: TA_LOOP | TA_SMOOTH, face: -1, sizeX: 0, sizeY: 0, start: 0, length: 0, rate: 1 }   // no ON bit
		const st = createTexAnimState()
		st.lastTime = 5; st.lastFrame = 5
		expect(stepTextureAnim(anim, st, 1)).toBeNull()
		expect(st.lastTime).toBe(0)
		expect(st.lastFrame).toBe(-1)
	})
})

describe('omegaDeltaQuat — llTargetOmega ΔQ (llviewerobject.cpp:7397)', () => {
	it('π rad/s about +Z for 0.5 s → 90° about Z: [0, 0, sin45°, cos45°]', () => {
		const out = [0, 0, 0, 0]
		expect(omegaDeltaQuat([0, 0, Math.PI], 0.5, out)).toBe(true)
		expect(out[0]).toBeCloseTo(0, 12)
		expect(out[1]).toBeCloseTo(0, 12)
		expect(out[2]).toBeCloseTo(Math.sin(Math.PI / 4), 12)
		expect(out[3]).toBeCloseTo(Math.cos(Math.PI / 4), 12)
	})

	it('axis is normalized: [3, 0, 4] rad/s (|ω| = 5) for dt = 0.1 → angle 0.5 about (0.6, 0, 0.8)', () => {
		const out = [0, 0, 0, 0]
		omegaDeltaQuat([3, 0, 4], 0.1, out)
		const s = Math.sin(0.25)
		expect(out[0]).toBeCloseTo(0.6 * s, 12)
		expect(out[1]).toBeCloseTo(0, 12)
		expect(out[2]).toBeCloseTo(0.8 * s, 12)
		expect(out[3]).toBeCloseTo(Math.cos(0.25), 12)
		// unit quaternion
		expect(out[0] ** 2 + out[1] ** 2 + out[2] ** 2 + out[3] ** 2).toBeCloseTo(1, 12)
	})

	it('dead-band: |ω|² ≤ 0.00001 → false, out untouched (FS :7404 omega > 0.00001f)', () => {
		const out = [9, 9, 9, 9]
		expect(omegaDeltaQuat([0, 0, 0], 1, out)).toBe(false)
		expect(omegaDeltaQuat([0.003, 0, 0], 1, out)).toBe(false)   // 9e-6 ≤ 1e-5
		expect(out).toEqual([9, 9, 9, 9])
		expect(omegaDeltaQuat([0.004, 0, 0], 1, out)).toBe(true)    // 1.6e-5 > 1e-5
	})

	it('integrating 4 half-second steps of π/2 rad/s about Z composes to 180°', () => {
		// Hamilton product in column convention: q_new = dQ ⊗ q_old (LL row-order rot*dQ transposed).
		const mul = (a, b) => ([   // a ⊗ b
			a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
			a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
			a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
			a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
		])
		let q = [0, 0, 0, 1]
		const dq = [0, 0, 0, 0]
		for (let i = 0; i < 4; i++) {
			omegaDeltaQuat([0, 0, Math.PI / 2], 0.5, dq)
			q = mul(dq, q)
		}
		// 4 × 45° = 180° about Z → [0, 0, 1, 0] (sign-insensitive)
		expect(Math.abs(q[2])).toBeCloseTo(1, 12)
		expect(Math.abs(q[3])).toBeCloseTo(0, 12)
		expect(Math.abs(q[0])).toBeLessThan(EPS)
		expect(Math.abs(q[1])).toBeLessThan(EPS)
	})
})

describe('constants', () => {
	it('mode flags match FS lltextureanim.h:54–60', () => {
		expect([TA_ON, TA_LOOP, TA_REVERSE, TA_PING_PONG, TA_SMOOTH, TA_ROTATE, TA_SCALE])
			.toEqual([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40])
	})
	it('linear-interp cutoff matches FS sMaxUpdateInterpolationTime (llviewerobject.cpp:141)', () => {
		expect(MAX_INTERP_S).toBe(3.0)
	})
})
