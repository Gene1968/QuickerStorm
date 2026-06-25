import { describe, it, expect } from 'vitest'
import { computeInterestRadius } from '@/lib/interestRadiusClient'

describe('computeInterestRadius', () => {
	it('returns the full draw distance once the arrival ramp completes and no pressure', () => {
		const r = computeInterestRadius({ drawDistance: 192, underPressure: false, arrivalElapsedMs: 60000 })
		expect(r).toBe(192)
	})
	it('ramps from ~half the target right after arrival', () => {
		const r = computeInterestRadius({ drawDistance: 192, underPressure: false, arrivalElapsedMs: 0 })
		expect(r).toBe(96)
	})
	it('uses a 50m floor for the ramp start on small draw distances', () => {
		const r = computeInterestRadius({ drawDistance: 64, underPressure: false, arrivalElapsedMs: 0 })
		expect(r).toBe(50)
	})
	it('shrinks the target under memory pressure', () => {
		const r = computeInterestRadius({ drawDistance: 192, underPressure: true, arrivalElapsedMs: 60000 })
		expect(r).toBe(115)
	})
	it('never exceeds the (pressure-adjusted) target during the ramp', () => {
		const r = computeInterestRadius({ drawDistance: 96, underPressure: false, arrivalElapsedMs: 999999 })
		expect(r).toBe(96)
	})
})
