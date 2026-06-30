import { describe, it, expect } from 'vitest'
import { elevationFromSunDir, dayPhaseFromElevation, samplePalette } from './environment.js'

describe('environment math', () => {
	it('elevation is the SL up-component, clamped', () => {
		expect(elevationFromSunDir([0, 0, 1])).toBeCloseTo(1)
		expect(elevationFromSunDir([1, 0, 0])).toBeCloseTo(0)
		expect(elevationFromSunDir([0, 0, -5])).toBeCloseTo(-1)
	})

	it('dayPhase: noon→1, horizon→~0.5, deep night→0', () => {
		expect(dayPhaseFromElevation(1)).toBeCloseTo(1, 1)
		expect(dayPhaseFromElevation(0)).toBeGreaterThan(0.4)
		expect(dayPhaseFromElevation(0)).toBeLessThan(0.6)
		expect(dayPhaseFromElevation(-1)).toBeCloseTo(0, 1)
	})

	it('palette endpoints: night is dark+dim, day is bright+exposure 1', () => {
		const night = samplePalette(0)
		const day = samplePalette(1)
		expect(night.exposure).toBeLessThan(0.3)
		expect(night.starOpacity).toBeGreaterThan(0.8)
		expect(day.exposure).toBeCloseTo(1)
		expect(day.starOpacity).toBeCloseTo(0)
		expect(day.sunIntensity).toBeGreaterThan(night.sunIntensity)
	})

	it('exposure never exceeds 1 across the whole range', () => {
		for (let p = 0; p <= 1.0001; p += 0.05) {
			expect(samplePalette(p).exposure).toBeLessThanOrEqual(1)
		}
	})

	it('palette interpolates between keyframes (dusk is between night and day)', () => {
		const dusk = samplePalette(0.5)
		expect(dusk.exposure).toBeGreaterThan(samplePalette(0).exposure)
		expect(dusk.exposure).toBeLessThan(samplePalette(1).exposure)
	})
})
