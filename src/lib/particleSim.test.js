import { describe, it, expect } from 'vitest'
import { PSIM, maxLiveParticles, createEmitterState, stepEmitter, sampleAppearance } from './particleSim.js'

const basePsys = {
	pattern: PSIM.PATTERN_DROP, burstRate: 0.1, burstRadius: 0, burstPartCount: 2,
	burstSpeedMin: 1, burstSpeedMax: 1, maxAge: 0, startAge: 0, innerAngle: 0, outerAngle: 0,
	angularVelocity: [0, 0, 0], partAccel: [0, 0, 0],
	partFlags: PSIM.PART_INTERP_COLOR | PSIM.PART_INTERP_SCALE, partMaxAge: 1.0,
	startColor: [1, 0, 0, 1], endColor: [0, 0, 1, 0], startScale: [0.5, 0.5], endScale: [1.5, 1.5],
	startGlow: 0, endGlow: 0, blendFuncSource: 7, blendFuncDest: 9,
}
const rng = () => 0.5

describe('maxLiveParticles', () => {
	it('scales with life/rate*count and clamps to cap', () => {
		expect(maxLiveParticles({ ...basePsys, burstRate: 0.1, partMaxAge: 1, burstPartCount: 2 }, 10000))
			.toBe(Math.ceil(1 / 0.1) * 2 + 2)
		expect(maxLiveParticles({ ...basePsys, burstRate: 0.01, partMaxAge: 30, burstPartCount: 100 }, 512)).toBe(512)
	})
})

describe('stepEmitter', () => {
	it('spawns one burst per burstRate elapsed', () => {
		const st = createEmitterState(basePsys, 64)
		stepEmitter(st, basePsys, 0.25, [0, 0, 0], null, rng)
		expect(st.count).toBe(4)
	})

	it('DROP pattern gives ~zero initial velocity', () => {
		const st = createEmitterState(basePsys, 64)
		stepEmitter(st, basePsys, 0.1, [0, 0, 0], null, rng)
		expect(Math.hypot(st.vx[0], st.vy[0], st.vz[0])).toBeLessThan(1e-6)
	})

	it('EXPLODE pattern gives speed within [min,max]', () => {
		const ps = { ...basePsys, pattern: PSIM.PATTERN_EXPLODE, burstSpeedMin: 2, burstSpeedMax: 4 }
		const st = createEmitterState(ps, 64)
		stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng)
		const spd = Math.hypot(st.vx[0], st.vy[0], st.vz[0])
		expect(spd).toBeGreaterThanOrEqual(2 - 1e-3)
		expect(spd).toBeLessThanOrEqual(4 + 1e-3)
	})

	it('EXPLODE ignores source rotation (isotropic — matches FS)', () => {
		// rng=0.5 → rejection loop degenerates → fallback dir [0,0,1]; speed=2.
		const ps = { ...basePsys, pattern: PSIM.PATTERN_EXPLODE, burstSpeedMin: 2, burstSpeedMax: 2 }
		const st = createEmitterState(ps, 64)
		const rot90x = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] // 90° about X: would send +Z→-Y if applied
		stepEmitter(st, ps, 0.1, [0, 0, 0], rot90x, rng)
		expect(st.vz[0]).toBeCloseTo(2, 5)                // velocity stays on +Z (NOT rotated)
		expect(Math.abs(st.vy[0])).toBeLessThan(1e-6)
	})

	it('ANGLE applies source rotation', () => {
		// inner=outer=0 → base dir [0,0,1]; USE_NEW_ANGLE skips the legacy double-rot;
		// srcRot 90° about X → [0,-1,0].
		const ps = { ...basePsys, pattern: PSIM.PATTERN_ANGLE, srcFlags: PSIM.SRC_USE_NEW_ANGLE, innerAngle: 0, outerAngle: 0, burstSpeedMin: 1, burstSpeedMax: 1 }
		const st = createEmitterState(ps, 64)
		const rot90x = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
		stepEmitter(st, ps, 0.1, [0, 0, 0], rot90x, rng)
		expect(st.vy[0]).toBeCloseTo(-1, 5)               // +Z rotated 90° about X → -Y
		expect(Math.abs(st.vz[0])).toBeLessThan(1e-6)
	})

	it('ANGLE_CONE_EMPTY emits stationary particles (matches FS)', () => {
		const ps = { ...basePsys, pattern: PSIM.PATTERN_ANGLE_CONE_EMPTY, burstSpeedMin: 5, burstSpeedMax: 5 }
		const st = createEmitterState(ps, 64)
		stepEmitter(st, ps, 0.1, [3, 0, 0], null, rng)
		expect(st.count).toBeGreaterThan(0)
		expect(Math.hypot(st.vx[0], st.vy[0], st.vz[0])).toBeLessThan(1e-6)
		expect(st.px[0]).toBeCloseTo(3, 5)                // at source, no offset
	})

	it('spawnEnabled=false ages existing particles without spawning new ones (drain when far)', () => {
		const ps = { ...basePsys, burstRate: 0.1, burstPartCount: 2, partMaxAge: 0.3 }
		const st = createEmitterState(ps, 64)
		stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng)            // spawn (default enabled)
		const after = st.count
		expect(after).toBeGreaterThan(0)
		stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng, false)     // far: no new spawns
		expect(st.count).toBeLessThanOrEqual(after)
		for (let i = 0; i < 5; i++) stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng, false)
		expect(st.count).toBe(0)                                  // aged out / drained
	})

	it('retires particles past partMaxAge and never exceeds capacity', () => {
		const ps = { ...basePsys, burstRate: 0.01, burstPartCount: 50, partMaxAge: 0.5 }
		const st = createEmitterState(ps, 16)
		let maxSeen = 0, minSeen = Infinity
		for (let i = 0; i < 20; i++) {
			stepEmitter(st, ps, 0.1, [0, 0, 0], null, rng)
			expect(st.count).toBeLessThanOrEqual(16)   // cap invariant holds EVERY step
			maxSeen = Math.max(maxSeen, st.count)
			minSeen = Math.min(minSeen, st.count)
		}
		expect(maxSeen).toBe(16)   // filled to capacity (spawn + clamp)
		expect(minSeen).toBe(0)    // fully retired at least once (retirement works)
	})

	it('applies partAccel and source position offset', () => {
		const ps = { ...basePsys, partAccel: [0, -10, 0] }
		const st = createEmitterState(ps, 64)
		stepEmitter(st, ps, 0.1, [5, 0, 0], null, rng)
		expect(st.px[0]).toBeCloseTo(5, 1)
		expect(st.vy[0]).toBeCloseTo(-10 * 0.1, 3)
	})
})

describe('sampleAppearance', () => {
	it('interpolates color/alpha/scale across normalized age', () => {
		const a0 = sampleAppearance(basePsys, 0)
		expect(a0.color).toEqual([1, 0, 0]); expect(a0.alpha).toBe(1); expect(a0.scale).toBeCloseTo(0.5, 3)
		const a1 = sampleAppearance(basePsys, 1)
		expect(a1.color[2]).toBeCloseTo(1, 3); expect(a1.alpha).toBeCloseTo(0, 3); expect(a1.scale).toBeCloseTo(1.5, 3)
	})
	it('holds start values when interp flags are off', () => {
		const ps = { ...basePsys, partFlags: 0 }
		const a = sampleAppearance(ps, 1)
		expect(a.color).toEqual([1, 0, 0]); expect(a.alpha).toBe(1); expect(a.scale).toBeCloseTo(0.5, 3)
	})
})
