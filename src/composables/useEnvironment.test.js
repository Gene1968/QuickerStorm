import { describe, it, expect } from 'vitest'
import { advanceSunDir, dirFromTimeOfDay } from './useEnvironment.js'

describe('advanceSunDir', () => {
	it('rotates the sun and keeps it unit length', () => {
		const out = advanceSunDir([1, 0, 0], [0, 0, 0.5], 1.0)
		const len = Math.hypot(out[0], out[1], out[2])
		expect(len).toBeCloseTo(1, 3)
		expect(out).not.toEqual([1, 0, 0])
	})

	it('zero angular velocity is identity', () => {
		expect(advanceSunDir([0, 0, 1], [0, 0, 0], 5)).toEqual([0, 0, 1])
	})
})

describe('dirFromTimeOfDay', () => {
	it('noon points up (+Z), midnight points down (-Z)', () => {
		expect(dirFromTimeOfDay(0.5)[2]).toBeCloseTo(1)
		expect(dirFromTimeOfDay(0.0)[2]).toBeCloseTo(-1)
	})

	it('sunrise/sunset are on the horizon (Z≈0)', () => {
		expect(dirFromTimeOfDay(0.25)[2]).toBeCloseTo(0)
		expect(dirFromTimeOfDay(0.75)[2]).toBeCloseTo(0)
	})
})
